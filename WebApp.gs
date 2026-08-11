/**
 * Private dashboard and versioned runtime configuration.
 *
 * Deploy this project as a web app that executes as the owner and is accessible
 * only to the owner. This project is intentionally single-tenant.
 */

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Official Gazette Monitor')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

function getDashboardState() {
  try {
    return dashboardSuccess_('Dashboard loaded.', getDashboardState_());
  } catch (error) {
    return dashboardFailure_('STATE_LOAD_FAILED', safeUiError_(error));
  }
}

function saveDashboardSettings(request) {
  try {
    const response = withScriptLock_(function () {
      const props = PropertiesService.getScriptProperties();
      const current = getAppSettings_();
      const validated = validateDashboardSettings_(request, current);
      const newApiKey = validated.newApiKey;
      const storedApiKey = safeText_(props.getProperty(RG_PROPERTY_KEYS.API_KEY)).trim();
      const effectiveApiKey = newApiKey || storedApiKey;
      let verifiedHash = '';

      if (validated.settings.aiMode !== 'off') {
        verifiedHash = apiKeyVerificationHash_(effectiveApiKey);
        if (
          newApiKey ||
          props.getProperty(RG_PROPERTY_KEYS.API_KEY_VERIFIED_HASH) !== verifiedHash
        ) {
          testGeminiConnection_(effectiveApiKey);
        }
      }

      props.setProperty(RG_PROPERTY_KEYS.RECIPIENT_EMAIL, validated.primaryRecipient);
      saveJsonProperty_(RG_PROPERTY_KEYS.SETTINGS, validated.settings);
      if (newApiKey) props.setProperty(RG_PROPERTY_KEYS.API_KEY, newApiKey);
      if (verifiedHash) {
        props.setProperty(RG_PROPERTY_KEYS.API_KEY_VERIFIED_HASH, verifiedHash);
      }
      if (validated.removeApiKey) {
        props.deleteProperty(RG_PROPERTY_KEYS.API_KEY);
        props.deleteProperty(RG_PROPERTY_KEYS.API_KEY_VERIFIED_HASH);
      }

      let scheduleWarning = '';
      try {
        refreshTriggers();
      } catch (scheduleError) {
        scheduleWarning =
          'Settings were saved, but the monitoring schedule could not be updated. Use Repair schedule.';
        console.error('Scheduler reconciliation failed: ' + safeErrorMessage_(scheduleError));
      }
      logActivity_(
        'settings_saved',
        scheduleWarning ? 'warning' : 'success',
        scheduleWarning || 'Settings were saved and the monitoring schedule was updated.'
      );
      return dashboardSuccess_(
        scheduleWarning || 'Settings saved. Monitoring schedule updated.',
        getDashboardState_()
      );
    });
    return response && response.skipped
      ? dashboardFailure_('APP_BUSY', 'Another operation is still running. Try again shortly.')
      : response;
  } catch (error) {
    return dashboardFailure_('SETTINGS_INVALID', safeUiError_(error));
  }
}

function testRecipientEmail() {
  try {
    const settings = getAppSettings_();
    const recipients = getRecipientEmails_();
    if (MailApp.getRemainingDailyQuota() < recipients.length) {
      throw new Error('There is not enough email-recipient quota remaining today.');
    }
    const message = {
      to: recipients[0],
      subject: '[Official Gazette Monitor] Test email',
      body:
        'Email delivery is configured correctly.\n\n' +
        'The monitor will use these saved recipients for future alerts.',
      htmlBody:
        '<div style="font-family:Arial,sans-serif;max-width:620px;color:#182230;line-height:1.6">' +
        '<div style="display:inline-block;background:#e8f5ee;color:#18794e;padding:5px 10px;border-radius:999px;font-weight:700">Delivery verified</div>' +
        '<h1 style="font-size:24px;margin:18px 0 8px">Your email channel is ready.</h1>' +
        '<p>The Official Gazette Monitor will use your saved recipients for future alerts.</p>' +
        '<p style="font-size:12px;color:#667085;margin-top:28px">Independent monitoring tool. Always verify the official publication.</p>' +
        '</div>',
      name: settings.senderName,
    };
    if (recipients.length > 1) message.bcc = recipients.slice(1).join(',');
    MailApp.sendEmail(message);
    logActivity_('email_test', 'success', 'A test email was sent successfully.', {
      recipientCount: recipients.length,
    });
    return dashboardSuccess_('Test email sent successfully.', getDashboardState_());
  } catch (error) {
    logActivity_('email_test', 'error', safeUiError_(error));
    return dashboardFailure_('EMAIL_TEST_FAILED', safeUiError_(error));
  }
}

function testAiConnection() {
  try {
    const key = getGeminiApiKey_();
    testGeminiConnection_(key);
    PropertiesService.getScriptProperties().setProperty(
      RG_PROPERTY_KEYS.API_KEY_VERIFIED_HASH,
      apiKeyVerificationHash_(key)
    );
    logActivity_('ai_test', 'success', 'The Gemini API connection was verified.');
    return dashboardSuccess_('Gemini connection verified.', getDashboardState_());
  } catch (error) {
    logActivity_('ai_test', 'error', safeUiError_(error));
    return dashboardFailure_('AI_TEST_FAILED', safeUiError_(error));
  }
}

function runCheckNow() {
  const startedAt = new Date();
  try {
    const result = checkTodayNow();
    if (result && result.skipped) {
      throw new Error(result.message || 'Another monitoring check is still running.');
    }
    return dashboardSuccess_('The Official Gazette check completed.', {
      result: result,
      dashboard: getDashboardState_(),
    });
  } catch (error) {
    recordRunResult_('manual', startedAt, null, error);
    return dashboardFailure_('CHECK_FAILED', safeUiError_(error));
  }
}

function repairScheduler() {
  try {
    const response = withScriptLock_(function () {
      refreshTriggers();
      logActivity_('scheduler_repaired', 'success', 'The monitoring scheduler was reconciled.');
      return dashboardSuccess_('Monitoring schedule repaired.', getDashboardState_());
    });
    return response && response.skipped
      ? dashboardFailure_('APP_BUSY', 'Another operation is still running. Try again shortly.')
      : response;
  } catch (error) {
    return dashboardFailure_('SCHEDULER_REPAIR_FAILED', safeUiError_(error));
  }
}

function clearProcessedHistory(confirmation) {
  if (confirmation !== 'CLEAR_PROCESSED_HISTORY') {
    return dashboardFailure_('CONFIRMATION_REQUIRED', 'Confirmation did not match.');
  }
  try {
    const response = withScriptLock_(function () {
      PropertiesService.getScriptProperties().deleteProperty(RG_PROPERTY_KEYS.PROCESSED);
      logActivity_(
        'processed_history_cleared',
        'warning',
        'Processed-publication history was cleared. Existing issues may be emailed again.'
      );
      return dashboardSuccess_('Processed-publication history cleared.', getDashboardState_());
    });
    return response && response.skipped
      ? dashboardFailure_('APP_BUSY', 'Another operation is still running. Try again shortly.')
      : response;
  } catch (error) {
    return dashboardFailure_('CLEAR_HISTORY_FAILED', safeUiError_(error));
  }
}

function clearAnalysisCache(confirmation) {
  if (confirmation !== 'CLEAR_ANALYSIS_CACHE') {
    return dashboardFailure_('CONFIRMATION_REQUIRED', 'Confirmation did not match.');
  }
  try {
    const response = withScriptLock_(function () {
      const props = PropertiesService.getScriptProperties();
      const index = loadJsonProperty_(RG_PROPERTY_KEYS.CACHE_INDEX, {});
      Object.keys(index).forEach(function (key) {
        props.deleteProperty(key);
      });
      props.deleteProperty(RG_PROPERTY_KEYS.CACHE_INDEX);
      logActivity_('analysis_cache_cleared', 'warning', 'The AI analysis cache was cleared.');
      return dashboardSuccess_('AI analysis cache cleared.', getDashboardState_());
    });
    return response && response.skipped
      ? dashboardFailure_('APP_BUSY', 'Another operation is still running. Try again shortly.')
      : response;
  } catch (error) {
    return dashboardFailure_('CLEAR_CACHE_FAILED', safeUiError_(error));
  }
}

function clearAiKey(confirmation) {
  if (confirmation !== 'REMOVE_GEMINI_KEY') {
    return dashboardFailure_('CONFIRMATION_REQUIRED', 'Confirmation did not match.');
  }
  try {
    const response = withScriptLock_(function () {
      const settings = getAppSettings_();
      if (settings.aiMode !== 'off') {
        throw new Error('Switch Analysis mode to Keyword mode and save before removing the key.');
      }
      PropertiesService.getScriptProperties().deleteProperty(RG_PROPERTY_KEYS.API_KEY);
      PropertiesService.getScriptProperties().deleteProperty(
        RG_PROPERTY_KEYS.API_KEY_VERIFIED_HASH
      );
      logActivity_('ai_key_removed', 'warning', 'The stored Gemini API key was removed.');
      return dashboardSuccess_('Gemini API key removed.', getDashboardState_());
    });
    return response && response.skipped
      ? dashboardFailure_('APP_BUSY', 'Another operation is still running. Try again shortly.')
      : response;
  } catch (error) {
    return dashboardFailure_('AI_KEY_REMOVE_FAILED', safeUiError_(error));
  }
}

function getDashboardState_() {
  const props = PropertiesService.getScriptProperties();
  const settings = getAppSettings_();
  const primaryRecipient = safeText_(props.getProperty(RG_PROPERTY_KEYS.RECIPIENT_EMAIL));
  const apiKey = safeText_(props.getProperty(RG_PROPERTY_KEYS.API_KEY)).trim();
  const apiKeyVerified = Boolean(apiKey) &&
    props.getProperty(RG_PROPERTY_KEYS.API_KEY_VERIFIED_HASH) ===
      apiKeyVerificationHash_(apiKey);
  const triggerCount = ScriptApp.getProjectTriggers().filter(function (trigger) {
    return trigger.getHandlerFunction() === 'scheduledCheck';
  }).length;
  let remainingQuota = null;
  try {
    remainingQuota = MailApp.getRemainingDailyQuota();
  } catch (_) {
    remainingQuota = null;
  }

  const settingsForClient = JSON.parse(JSON.stringify(settings));
  settingsForClient.primaryRecipient = primaryRecipient;
  return {
    app: {
      name: 'Official Gazette Monitor',
      version: RG_CONFIG.APP_VERSION,
      timeZone: RG_CONFIG.TIME_ZONE,
      officialSource: RG_CONFIG.BASE_URL,
    },
    settings: settingsForClient,
    status: {
      configured: isValidEmailValue_(primaryRecipient) &&
        !settings.settingsCorrupt &&
        (settings.aiMode === 'off' || apiKeyVerified),
      settingsCorrupt: settings.settingsCorrupt,
      apiKeyConfigured: Boolean(apiKey),
      apiKeyVerified: apiKeyVerified,
      monitoringEnabled: settings.monitoringEnabled,
      schedulerHealthy: settings.monitoringEnabled ? triggerCount === 1 : triggerCount === 0,
      triggerCount: triggerCount,
      remainingEmailQuota: remainingQuota,
      processedPublicationCount: Object.keys(
        loadJsonProperty_(RG_PROPERTY_KEYS.PROCESSED, {})
      ).length,
      nextCheckLabel: getNextCheckLabel_(settings),
      lastRun: loadJsonProperty_(RG_PROPERTY_KEYS.LAST_RUN, null),
    },
    activity: loadJsonProperty_(RG_PROPERTY_KEYS.ACTIVITY, []).slice(0, 10),
  };
}

function getAppSettings_() {
  const props = PropertiesService.getScriptProperties();
  const rawValue = props.getProperty(RG_PROPERTY_KEYS.SETTINGS);
  let raw = {};
  let settingsCorrupt = false;
  if (rawValue) {
    try {
      raw = JSON.parse(rawValue);
      if (!raw || Object.prototype.toString.call(raw) !== '[object Object]') {
        throw new Error('Stored settings must be an object.');
      }
    } catch (_) {
      raw = {};
      settingsCorrupt = true;
    }
  }
  const hasApiKey = Boolean(props.getProperty(RG_PROPERTY_KEYS.API_KEY));
  const aiMode = ['off', 'summary_only', 'full'].indexOf(raw.aiMode) !== -1
    ? raw.aiMode
    : raw.aiEnabled === false
      ? 'off'
      : hasApiKey
        ? 'full'
        : RG_DEFAULT_SETTINGS.aiMode || 'off';
  const interval = Number(raw.checkIntervalHours);
  const startHour = normalizeHour_(raw.activeStartHour, RG_DEFAULT_SETTINGS.activeStartHour);
  const endHour = normalizeHour_(raw.activeEndHour, RG_DEFAULT_SETTINGS.activeEndHour);

  return {
    version: 2,
    revision: normalizeInteger_(raw.revision, 0, 0, 1000000000),
    monitoringEnabled: normalizeBoolean_(
      raw.monitoringEnabled,
      settingsCorrupt ? false : RG_DEFAULT_SETTINGS.monitoringEnabled
    ),
    checkIntervalHours: RG_ALLOWED_INTERVALS.indexOf(interval) !== -1
      ? interval
      : RG_DEFAULT_SETTINGS.checkIntervalHours,
    activeStartHour: startHour,
    activeEndHour: endHour >= startHour ? endHour : RG_DEFAULT_SETTINGS.activeEndHour,
    includeYesterday: normalizeBoolean_(raw.includeYesterday, RG_DEFAULT_SETTINGS.includeYesterday),
    includeSupplements: normalizeBoolean_(raw.includeSupplements, RG_DEFAULT_SETTINGS.includeSupplements),
    aiMode: aiMode,
    aiEnabled: aiMode !== 'off',
    summarizeHeadlines: normalizeBoolean_(
      raw.summarizeHeadlines,
      RG_DEFAULT_SETTINGS.summarizeHeadlines
    ),
    customModel: '',
    deliveryPolicy: RG_ALLOWED_DELIVERY_POLICIES.indexOf(raw.deliveryPolicy) !== -1
      ? raw.deliveryPolicy
      : RG_DEFAULT_SETTINGS.deliveryPolicy,
    senderName: normalizeStoredSenderName_(raw.senderName),
    additionalRecipients: normalizeRecipientList_(raw.additionalRecipients || [], false),
    notifyErrors: normalizeBoolean_(raw.notifyErrors, RG_DEFAULT_SETTINGS.notifyErrors),
    notifyNoPublication: normalizeBoolean_(
      raw.notifyNoPublication,
      RG_DEFAULT_SETTINGS.notifyNoPublication
    ),
    includeHeadlines: normalizeBoolean_(raw.includeHeadlines, RG_DEFAULT_SETTINGS.includeHeadlines),
    requiredKeywords: normalizeStoredKeywordList_(raw.requiredKeywords),
    excludedKeywords: normalizeStoredKeywordList_(raw.excludedKeywords),
    preferredInstitutions: normalizeStoredKeywordList_(raw.preferredInstitutions),
    includeCorrections: normalizeBoolean_(
      raw.includeCorrections,
      RG_DEFAULT_SETTINGS.includeCorrections
    ),
    includeCancellations: normalizeBoolean_(
      raw.includeCancellations,
      RG_DEFAULT_SETTINGS.includeCancellations
    ),
    includeUncertain: normalizeBoolean_(raw.includeUncertain, RG_DEFAULT_SETTINGS.includeUncertain),
    updatedAt: safeText_(raw.updatedAt),
    settingsCorrupt: settingsCorrupt,
  };
}

function validateDashboardSettings_(request, current) {
  if (!request || Object.prototype.toString.call(request) !== '[object Object]') {
    throw new Error('Settings payload is missing.');
  }
  const allowedKeys = [
    'revision',
    'primaryRecipient',
    'additionalRecipients',
    'senderName',
    'monitoringEnabled',
    'checkIntervalHours',
    'activeStartHour',
    'activeEndHour',
    'includeYesterday',
    'includeSupplements',
    'aiMode',
    'summarizeHeadlines',
    'deliveryPolicy',
    'notifyErrors',
    'notifyNoPublication',
    'includeHeadlines',
    'requiredKeywords',
    'excludedKeywords',
    'preferredInstitutions',
    'includeCorrections',
    'includeCancellations',
    'includeUncertain',
    'apiKey',
    'removeApiKey',
  ];
  Object.keys(request).forEach(function (key) {
    if (allowedKeys.indexOf(key) === -1) throw new Error('Unknown setting: ' + key);
  });

  [
    'monitoringEnabled',
    'includeYesterday',
    'includeSupplements',
    'summarizeHeadlines',
    'notifyErrors',
    'notifyNoPublication',
    'includeHeadlines',
    'includeCorrections',
    'includeCancellations',
    'includeUncertain',
    'removeApiKey',
  ].forEach(function (key) {
    if (typeof request[key] !== 'boolean') throw new Error('Invalid boolean setting: ' + key);
  });
  ['revision', 'checkIntervalHours', 'activeStartHour', 'activeEndHour'].forEach(function (key) {
    if (typeof request[key] !== 'number' || !Number.isInteger(request[key])) {
      throw new Error('Invalid numeric setting: ' + key);
    }
  });
  if (typeof request.apiKey !== 'string') throw new Error('The API key value must be text.');

  const revision = normalizeInteger_(request.revision, -1, -1, 1000000000);
  if (revision !== current.revision) {
    throw new Error('Settings changed in another tab. Reload the dashboard and try again.');
  }
  const primaryRecipient = normalizeEmail_(request.primaryRecipient);
  const additionalRecipients = normalizeRecipientList_(request.additionalRecipients || [], true)
    .filter(function (email) {
      return email.toLowerCase() !== primaryRecipient.toLowerCase();
    });
  if (additionalRecipients.length > 2) {
    throw new Error('A maximum of three total recipients is supported.');
  }

  const interval = Number(request.checkIntervalHours);
  if (RG_ALLOWED_INTERVALS.indexOf(interval) === -1) {
    throw new Error('Choose a supported monitoring interval.');
  }
  const startHour = normalizeInteger_(request.activeStartHour, -1, 0, 23);
  const endHour = normalizeInteger_(request.activeEndHour, -1, 0, 23);
  if (startHour < 0 || endHour < startHour) {
    throw new Error('Active hours must be between 00:00 and 23:00, with the end after the start.');
  }
  const aiMode = safeText_(request.aiMode);
  if (['off', 'summary_only', 'full'].indexOf(aiMode) === -1) {
    throw new Error('Choose a supported analysis mode.');
  }
  const deliveryPolicy = safeText_(request.deliveryPolicy);
  if (RG_ALLOWED_DELIVERY_POLICIES.indexOf(deliveryPolicy) === -1) {
    throw new Error('Choose a supported delivery policy.');
  }
  const newApiKey = safeText_(request.apiKey).trim();
  if (newApiKey && (newApiKey.length < 20 || newApiKey.length > 256 || /\s/.test(newApiKey))) {
    throw new Error('The Gemini API key format is invalid.');
  }
  const removeApiKey = request.removeApiKey === true;
  const existingApiKey = Boolean(
    PropertiesService.getScriptProperties().getProperty(RG_PROPERTY_KEYS.API_KEY)
  );
  if (aiMode !== 'off' && removeApiKey) {
    throw new Error('Disable AI before removing the Gemini API key.');
  }
  if (aiMode !== 'off' && !newApiKey && !existingApiKey) {
    throw new Error('A Gemini API key is required for the selected analysis mode.');
  }
  if (aiMode === 'off' && newApiKey) {
    throw new Error('Enable an AI analysis mode before adding or replacing a Gemini API key.');
  }

  const settings = {
    version: 2,
    revision: current.revision + 1,
    monitoringEnabled: request.monitoringEnabled === true,
    checkIntervalHours: interval,
    activeStartHour: startHour,
    activeEndHour: endHour,
    includeYesterday: request.includeYesterday === true,
    includeSupplements: request.includeSupplements === true,
    aiMode: aiMode,
    aiEnabled: aiMode !== 'off',
    summarizeHeadlines: aiMode === 'summary_only' ? true : request.summarizeHeadlines === true,
    customModel: '',
    deliveryPolicy: deliveryPolicy,
    senderName: normalizeSenderName_(request.senderName),
    additionalRecipients: additionalRecipients,
    notifyErrors: request.notifyErrors === true,
    notifyNoPublication: request.notifyNoPublication === true,
    includeHeadlines: request.includeHeadlines === true,
    requiredKeywords: normalizeKeywordList_(request.requiredKeywords || []),
    excludedKeywords: normalizeKeywordList_(request.excludedKeywords || []),
    preferredInstitutions: normalizeKeywordList_(request.preferredInstitutions || []),
    includeCorrections: request.includeCorrections === true,
    includeCancellations: request.includeCancellations === true,
    includeUncertain: request.includeUncertain === true,
    updatedAt: new Date().toISOString(),
  };
  const serialized = JSON.stringify(settings);
  if (Utilities.newBlob(serialized, 'application/json').getBytes().length > 8000) {
    throw new Error('The settings payload is too large. Reduce the number of filters.');
  }
  return {
    settings: settings,
    primaryRecipient: primaryRecipient,
    newApiKey: newApiKey,
    removeApiKey: removeApiKey,
  };
}

function getRecipientEmails_() {
  const primary = normalizeEmail_(
    PropertiesService.getScriptProperties().getProperty(RG_PROPERTY_KEYS.RECIPIENT_EMAIL)
  );
  const recipients = [primary].concat(getAppSettings_().additionalRecipients);
  const seen = {};
  return recipients.filter(function (email) {
    const key = email.toLowerCase();
    if (seen[key]) return false;
    seen[key] = true;
    return true;
  });
}

function getGeminiModel_() {
  return RG_CONFIG.GEMINI_MODEL;
}

function apiKeyVerificationHash_(key) {
  return shortHash_(safeText_(key) + '|' + getGeminiModel_());
}

function shouldRunScheduledNow_(date, settings) {
  const hour = Number(Utilities.formatDate(date, RG_CONFIG.TIME_ZONE, 'H'));
  if (hour < settings.activeStartHour || hour > settings.activeEndHour) {
    return { due: false, message: 'Outside the configured active hours.' };
  }
  if (settings.notifyNoPublication && hour === settings.activeEndHour) {
    return { due: true, message: 'The configured final daily check is due.' };
  }
  const lastValue = PropertiesService.getScriptProperties().getProperty(
    RG_PROPERTY_KEYS.LAST_SCHEDULED_AT
  );
  const lastTime = Date.parse(lastValue || 0);
  if (lastTime && date.getTime() - lastTime < settings.checkIntervalHours * 3600000 - 60000) {
    return { due: false, message: 'The configured interval has not elapsed yet.' };
  }
  return { due: true, message: 'Scheduled check is due.' };
}

function markScheduledRun_(date) {
  PropertiesService.getScriptProperties().setProperty(
    RG_PROPERTY_KEYS.LAST_SCHEDULED_AT,
    date.toISOString()
  );
}

function getNextCheckLabel_(settings) {
  if (!settings.monitoringEnabled) return 'Monitoring is paused';
  const last = PropertiesService.getScriptProperties().getProperty(
    RG_PROPERTY_KEYS.LAST_SCHEDULED_AT
  );
  if (!last) return 'Within the next hour';
  const next = new Date(Date.parse(last) + settings.checkIntervalHours * 3600000);
  if (next.getTime() <= Date.now()) return 'Due within the next active hour';
  return 'Approximately ' + Utilities.formatDate(next, RG_CONFIG.TIME_ZONE, 'dd MMM yyyy, HH:mm');
}

function recordRunResult_(mode, startedAt, result, error) {
  try {
    const completedAt = new Date();
    const aggregate = aggregateRunResult_(result);
    const record = {
      mode: mode,
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      status: error ? 'error' : 'success',
      found: aggregate.found,
      sent: aggregate.sent,
      skipped: aggregate.skipped,
      filtered: aggregate.filtered,
      message: error ? safeUiError_(error) : 'Monitoring check completed.',
    };
    saveJsonProperty_(RG_PROPERTY_KEYS.LAST_RUN, record);
    logActivity_(
      'monitoring_check',
      error ? 'error' : 'success',
      error
        ? safeUiError_(error)
        : 'Check completed: ' + aggregate.found + ' issue(s), ' + aggregate.sent + ' email(s).',
      aggregate
    );
  } catch (recordError) {
    console.warn('Run status could not be recorded: ' + safeErrorMessage_(recordError));
  }
}

function aggregateRunResult_(result) {
  const parts = result && (result.today || result.yesterday)
    ? [result.today, result.yesterday]
    : [result];
  return parts.filter(Boolean).reduce(
    function (total, item) {
      total.found += Number(item.found) || 0;
      total.sent += Number(item.sent) || 0;
      total.skipped += Number(item.skipped) || 0;
      total.filtered += Number(item.filtered) || 0;
      return total;
    },
    { found: 0, sent: 0, skipped: 0, filtered: 0 }
  );
}

function logActivity_(type, status, message, details) {
  try {
    const activity = loadJsonProperty_(RG_PROPERTY_KEYS.ACTIVITY, []);
    const safeDetails = details && typeof details === 'object'
      ? JSON.parse(JSON.stringify(details))
      : {};
    const entry = {
      id: shortHash_(new Date().toISOString() + '|' + type + '|' + Math.random()),
      at: new Date().toISOString(),
      type: safeText_(type).slice(0, 60),
      status: ['success', 'warning', 'error', 'info'].indexOf(status) !== -1
        ? status
        : 'info',
      message: safeText_(message).slice(0, 320),
      details: safeDetails,
    };
    saveJsonProperty_(RG_PROPERTY_KEYS.ACTIVITY, [entry].concat(activity).slice(0, 10));
  } catch (error) {
    console.warn('Activity could not be recorded: ' + safeErrorMessage_(error));
  }
}

function normalizeRecipientList_(values, strict) {
  if (!Array.isArray(values)) {
    if (strict) throw new Error('Recipients must be provided as a list.');
    return [];
  }
  if (strict && values.length > 2) {
    throw new Error('A maximum of two additional recipients is supported.');
  }
  const seen = {};
  const normalized = [];
  values.forEach(function (value) {
    try {
      normalized.push(normalizeEmail_(value));
    } catch (error) {
      if (strict) throw error;
    }
  });
  return normalized.filter(function (email) {
    const key = email.toLowerCase();
    if (seen[key]) return false;
    seen[key] = true;
    return true;
  }).slice(0, 2);
}

function normalizeStoredSenderName_(value) {
  try {
    return normalizeSenderName_(value || RG_DEFAULT_SETTINGS.senderName);
  } catch (_) {
    return RG_DEFAULT_SETTINGS.senderName;
  }
}

function normalizeStoredKeywordList_(values) {
  try {
    return normalizeKeywordList_(Array.isArray(values) ? values : []);
  } catch (_) {
    return [];
  }
}

function normalizeEmail_(value) {
  if (typeof value !== 'string') throw new Error('Recipient email must be text.');
  const email = safeText_(value).trim();
  if (
    !email ||
    email.length > 254 ||
    /[\r\n]/.test(email) ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    throw new Error('Enter a valid recipient email address.');
  }
  return email;
}

function isValidEmailValue_(value) {
  try {
    normalizeEmail_(value);
    return true;
  } catch (_) {
    return false;
  }
}

function normalizeSenderName_(value) {
  if (typeof value !== 'string') throw new Error('Sender name must be text.');
  const name = safeText_(value).trim();
  if (name.length < 2 || name.length > 80 || /[\r\n\x00-\x1f]/.test(name)) {
    throw new Error('Sender name must contain 2 to 80 safe characters.');
  }
  return name;
}

function normalizeKeywordList_(values) {
  if (!Array.isArray(values)) throw new Error('Filters must be provided as a list.');
  if (values.length > 20) throw new Error('Each filter list supports up to 20 items.');
  const seen = {};
  return values.map(function (value) {
    if (typeof value !== 'string') throw new Error('Every filter must be text.');
    const item = safeText_(value).trim().replace(/\s+/g, ' ');
    if (!item || item.length > 60 || /[\r\n\x00-\x1f]/.test(item)) {
      throw new Error('Each filter must contain 1 to 60 safe characters.');
    }
    return item;
  }).filter(function (item) {
    const key = normalizeTurkish_(item);
    if (seen[key]) return false;
    seen[key] = true;
    return true;
  });
}

function normalizeBoolean_(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

function normalizeHour_(value, fallback) {
  return normalizeInteger_(value, fallback, 0, 23);
}

function normalizeInteger_(value, fallback, minimum, maximum) {
  const number = Number(value);
  return Number.isInteger(number) && number >= minimum && number <= maximum
    ? number
    : fallback;
}

function dashboardSuccess_(message, data) {
  return { ok: true, message: message, data: data || null, errorCode: '' };
}

function dashboardFailure_(code, message) {
  return { ok: false, message: message, data: null, errorCode: code };
}

function safeUiError_(error) {
  return safeErrorMessage_(error).slice(0, 320);
}
