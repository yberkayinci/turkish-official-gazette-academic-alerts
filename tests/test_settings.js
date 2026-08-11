const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const store = Object.create(null);
const triggers = [];
const emails = [];
let fetchCalls = 0;
let allowGemini = false;

const context = {
  console,
  Date,
  JSON,
  Object,
  Array,
  Math,
  Number,
  String,
  Boolean,
  RegExp,
  encodeURIComponent,
  decodeURIComponent,
  PropertiesService: {
    getScriptProperties() {
      return {
        getProperty: (key) => (Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null),
        setProperty: (key, value) => { store[key] = String(value); },
        deleteProperty: (key) => { delete store[key]; },
      };
    },
  },
  LockService: {
    getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }),
  },
  ScriptApp: {
    getProjectTriggers: () => triggers.slice(),
    deleteTrigger(trigger) {
      const index = triggers.indexOf(trigger);
      if (index >= 0) triggers.splice(index, 1);
    },
    newTrigger(handler) {
      const trigger = { getHandlerFunction: () => handler };
      const builder = {
        timeBased: () => builder,
        everyHours: () => builder,
        create: () => { triggers.push(trigger); return trigger; },
      };
      return builder;
    },
  },
  MailApp: {
    getRemainingDailyQuota: () => 95,
    sendEmail: (message) => emails.push(message),
  },
  HtmlService: {
    createHtmlOutputFromFile() {
      return {
        setTitle() { return this; },
        addMetaTag() { return this; },
      };
    },
  },
  Utilities: {
    DigestAlgorithm: { SHA_256: 'SHA_256' },
    computeDigest(_algorithm, value) {
      return Array.from(crypto.createHash('sha256').update(String(value)).digest()).map((byte) =>
        byte > 127 ? byte - 256 : byte
      );
    },
    newBlob: (value) => ({ getBytes: () => Array.from(Buffer.from(String(value), 'utf8')) }),
    formatDate(_date, _timeZone, pattern) {
      if (pattern === 'H') return '10';
      if (pattern === 'dd MMM yyyy, HH:mm') return '04 Aug 2026, 13:00';
      return { yyyy: '2026', MM: '08', dd: '04' }[pattern] || '';
    },
    sleep: () => {},
    base64Encode: () => '',
  },
  UrlFetchApp: {
    fetch() {
      fetchCalls += 1;
      if (allowGemini) {
        return {
          getResponseCode: () => 200,
          getContentText: () => JSON.stringify({
            candidates: [{ content: { parts: [{ text: '{"ok":true}' }] }, finishReason: 'STOP' }],
          }),
        };
      }
      throw new Error('Gemini must not be called in keyword mode');
    },
  },
};

vm.createContext(context);
['Code.gs', 'WebApp.gs'].forEach((filename) => {
  const codePath = path.resolve(__dirname, '..', filename);
  vm.runInContext(fs.readFileSync(codePath, 'utf8'), context, { filename: codePath });
});

store.RECIPIENT_EMAIL = 'legacy@example.com';
store.GEMINI_API_KEY = 'legacy-api-key-that-is-long-enough';

const legacyState = context.getDashboardState();
assert.strictEqual(legacyState.ok, true);
assert.strictEqual(legacyState.data.settings.aiMode, 'full', 'A legacy API key should migrate to full AI');
assert.strictEqual(legacyState.data.status.apiKeyConfigured, true);
assert.strictEqual(JSON.stringify(legacyState).includes('legacy-api-key-that-is-long-enough'), false);

const initialRequest = {
  revision: 0,
  primaryRecipient: 'owner@example.com',
  additionalRecipients: ['advisor@example.com'],
  senderName: 'Gazette Research Desk',
  monitoringEnabled: true,
  checkIntervalHours: 3,
  activeStartHour: 6,
  activeEndHour: 23,
  includeYesterday: true,
  includeSupplements: true,
  aiMode: 'off',
  summarizeHeadlines: false,
  deliveryPolicy: 'matches_only',
  notifyErrors: true,
  notifyNoPublication: false,
  includeHeadlines: true,
  requiredKeywords: [],
  excludedKeywords: [],
  preferredInstitutions: [],
  includeCorrections: true,
  includeCancellations: true,
  includeUncertain: true,
  apiKey: '',
  removeApiKey: false,
};
const saved = context.saveDashboardSettings(initialRequest);

assert.strictEqual(saved.ok, true);
assert.strictEqual(saved.data.settings.revision, 1);
assert.strictEqual(saved.data.settings.aiMode, 'off');
assert.strictEqual(saved.data.settings.primaryRecipient, 'owner@example.com');
assert.deepStrictEqual(Array.from(saved.data.settings.additionalRecipients), ['advisor@example.com']);
assert.strictEqual(triggers.length, 1, 'Exactly one scheduler must exist');
assert.strictEqual(fetchCalls, 0, 'Keyword mode must not call Gemini');

const savedSettings = context.getAppSettings_();
const firstScheduledAt = new Date('2026-08-04T07:00:00Z');
assert.strictEqual(context.shouldRunScheduledNow_(firstScheduledAt, savedSettings).due, true);
context.markScheduledRun_(firstScheduledAt);
assert.strictEqual(
  context.shouldRunScheduledNow_(new Date('2026-08-04T08:00:00Z'), savedSettings).due,
  false,
  'The hourly trigger must respect the configured three-hour interval'
);
assert.strictEqual(
  context.shouldRunScheduledNow_(new Date('2026-08-04T10:01:00Z'), savedSettings).due,
  true
);
const finalCheckSettings = Object.assign({}, savedSettings, {
  notifyNoPublication: true,
  activeEndHour: 10,
  checkIntervalHours: 24,
});
assert.strictEqual(
  context.shouldRunScheduledNow_(new Date('2026-08-04T10:30:00Z'), finalCheckSettings).due,
  true,
  'No-publication alerts need a final active-hour check even when the normal interval is not due'
);

const stale = context.saveDashboardSettings({ ...saved.data.settings, revision: 0, apiKey: '', removeApiKey: false });
assert.strictEqual(stale.ok, false);
assert.strictEqual(stale.errorCode, 'SETTINGS_INVALID');

const unknown = context.saveDashboardSettings({
  ...saved.data.settings,
  primaryRecipient: 'owner@example.com',
  apiKey: '',
  removeApiKey: false,
  injectedSetting: true,
});
assert.strictEqual(unknown.ok, false, 'Unknown settings must be rejected');

context.findAcademicCandidates_ = () => [
  { title: 'Örnek Üniversitesi Rektörlüğünden', url: 'https://www.resmigazete.gov.tr/example.pdf' },
];
const keywordReport = context.buildPublicationReport_(
  {
    title: 'Test issue',
    type: 'normal',
    items: [{ title: 'Miscellaneous Notices', url: 'https://www.resmigazete.gov.tr/notices.htm' }],
    pageUrl: 'https://www.resmigazete.gov.tr/',
    pdfUrl: 'https://www.resmigazete.gov.tr/test.pdf',
  },
  { deadline: Date.now() + 100000 },
  false
);
assert.strictEqual(keywordReport.analysisMode, 'off');
assert.strictEqual(keywordReport.positions.length, 0);
assert.strictEqual(keywordReport.reviewNeeded.length, 1);
assert(keywordReport.reviewNeeded[0].message.includes('Keyword mode'));
assert.strictEqual(fetchCalls, 0);

const emailTest = context.testRecipientEmail();
assert.strictEqual(emailTest.ok, true);
assert.strictEqual(emails.length, 1);
assert.strictEqual(emails[0].to, 'owner@example.com');
assert.strictEqual(emails[0].bcc, 'advisor@example.com');

const removed = context.clearAiKey('REMOVE_GEMINI_KEY');
assert.strictEqual(removed.ok, true);
assert.strictEqual(Object.prototype.hasOwnProperty.call(store, 'GEMINI_API_KEY'), false);

const invalidOffKey = context.saveDashboardSettings({
  ...initialRequest,
  revision: 1,
  apiKey: 'new-api-key-that-is-long-enough',
});
assert.strictEqual(invalidOffKey.ok, false, 'A key must not be stored while AI is disabled');

allowGemini = true;
const aiSaved = context.saveDashboardSettings({
  ...initialRequest,
  revision: 1,
  aiMode: 'full',
  summarizeHeadlines: true,
  apiKey: 'verified-api-key-that-is-long-enough',
});
assert.strictEqual(aiSaved.ok, true);
assert.strictEqual(fetchCalls, 1, 'A new key must be verified exactly once before storage');
assert.strictEqual(aiSaved.data.status.apiKeyVerified, true);
assert.strictEqual(
  JSON.stringify(aiSaved).includes('verified-api-key-that-is-long-enough'),
  false,
  'The verified key must not be returned to the browser'
);

const storedSettings = JSON.parse(store.RG_SETTINGS_V2);
storedSettings.includeHeadlines = false;
storedSettings.summarizeHeadlines = true;
store.RG_SETTINGS_V2 = JSON.stringify(storedSettings);
let summaryCalls = 0;
context.findAcademicCandidates_ = () => [];
context.summarizeHeadlines_ = () => {
  summaryCalls += 1;
  return { bullets: ['Summary'], notable: [] };
};
const summaryWithoutFullList = context.buildPublicationReport_(
  {
    title: 'Summary test',
    type: 'normal',
    items: [{ title: 'Headline', url: 'https://www.resmigazete.gov.tr/headline' }],
    pageUrl: 'https://www.resmigazete.gov.tr/',
    pdfUrl: 'https://www.resmigazete.gov.tr/summary.pdf',
  },
  { deadline: Date.now() + 100000 },
  false
);
assert.strictEqual(summaryCalls, 1, 'Summary generation must be independent from the full headline list');
assert.strictEqual(summaryWithoutFullList.includeHeadlines, false);

store.RG_SETTINGS_V2 = '{not valid json';
const corruptState = context.getDashboardState();
assert.strictEqual(corruptState.ok, true);
assert.strictEqual(corruptState.data.status.settingsCorrupt, true);
assert.strictEqual(corruptState.data.settings.monitoringEnabled, false);

console.log('Dashboard settings, migration, and keyword-mode tests passed.');
