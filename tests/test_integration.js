const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const store = Object.create(null);
const sentEmails = [];
const triggers = [];
let geminiCalls = 0;

const dailyHtml = `
<html><body>
  <h6>04 Ağustos 2026 Tarihli ve 33330 Sayılı Resmî Gazete</h6>
  <a href="/eskiler/2026/08/20260804.pdf">PDF Görüntüle</a>
  <a href="/eskiler/2026/08/20260804-1.htm">–– Örnek Yönetmelik</a>
  <a href="/ilanlar/eskiilanlar/2026/08/20260804-4.htm">c - Çeşitli İlânlar</a>
</body></html>`;

const announcementHtml = `
<html><body>
  <a href="20260804-4-1.pdf">Örnek Üniversitesi Rektörlüğünden:</a>
  <a href="20260804-4-2.pdf">Örnek Bakanlıktan:</a>
</body></html>`;

function textResponse(status, text) {
  return {
    getResponseCode: () => status,
    getContentText: () => text,
    getBlob: () => ({ getBytes: () => Array.from(Buffer.from(text)) }),
  };
}

function binaryResponse(bytes) {
  return {
    getResponseCode: () => 200,
    getContentText: () => '',
    getBlob: () => ({ getBytes: () => Array.from(bytes).map((byte) => (byte > 127 ? byte - 256 : byte)) }),
  };
}

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
        setProperty: (key, value) => {
          store[key] = String(value);
        },
        deleteProperty: (key) => {
          delete store[key];
        },
      };
    },
  },
  MailApp: {
    getRemainingDailyQuota: () => 100,
    sendEmail: (message) => sentEmails.push(message),
  },
  LockService: {
    getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }),
  },
  ScriptApp: {
    getProjectTriggers: () => triggers,
    deleteTrigger: () => {},
    newTrigger() {
      const builder = {
        timeBased: () => builder,
        atHour: () => builder,
        nearMinute: () => builder,
        everyDays: () => builder,
        everyHours: () => builder,
        inTimezone: () => builder,
        create: () => builder,
      };
      return builder;
    },
  },
  Utilities: {
    DigestAlgorithm: { SHA_256: 'SHA_256' },
    computeDigest(_algorithm, value) {
      return Array.from(crypto.createHash('sha256').update(String(value)).digest()).map((byte) =>
        byte > 127 ? byte - 256 : byte
      );
    },
    base64Encode: (bytes) => Buffer.from(bytes.map((byte) => (byte < 0 ? byte + 256 : byte))).toString('base64'),
    newBlob: (value) => ({ getBytes: () => Array.from(Buffer.from(String(value), 'utf8')) }),
    sleep: () => {},
    formatDate(date, _timeZone, pattern) {
      const parts = {
        yyyy: '2026',
        MM: '08',
        dd: '04',
        H: '10',
      };
      return parts[pattern];
    },
  },
  UrlFetchApp: {
    fetch(url, options = {}) {
      if (url === 'https://www.resmigazete.gov.tr/04.08.2026') {
        return textResponse(200, dailyHtml);
      }
      if (url === 'https://www.resmigazete.gov.tr/ilanlar/eskiilanlar/2026/08/20260804-4.htm') {
        return textResponse(200, announcementHtml);
      }
      if (url === 'https://www.resmigazete.gov.tr/ilanlar/eskiilanlar/2026/08/20260804-4-1.pdf') {
        return binaryResponse(Buffer.from('%PDF-1.7\nmock academic document'));
      }
      if (url === 'https://www.resmigazete.gov.tr/ilanlar/eskiilanlar/2026/08/20260804-4-2.pdf') {
        return binaryResponse(Buffer.from('%PDF-1.7\nmock nonacademic document'));
      }
      if (url.startsWith('https://generativelanguage.googleapis.com/')) {
        geminiCalls += 1;
        assert.strictEqual(options.headers['x-goog-api-key'], 'test-api-key-that-is-long-enough');
        assert(!url.includes('test-api-key'));
        const request = JSON.parse(options.payload);
        assert(request.generationConfig.responseFormat.text.schema);
        assert.strictEqual(request.generationConfig.thinkingConfig.thinkingLevel, 'low');
        const isPdf = request.contents[0].parts.some((part) => part.inline_data);
        const pdfPart = request.contents[0].parts.find((part) => part.inline_data);
        const pdfText = pdfPart
          ? Buffer.from(pdfPart.inline_data.data, 'base64').toString('utf8')
          : '';
        const isResearchAssistantPdf = isPdf && !pdfText.includes('nonacademic');
        const data = isResearchAssistantPdf
          ? {
              document_type: 'academic_recruitment',
              has_research_assistant: true,
              uncertain: false,
              needs_manual_review: false,
              document_summary: 'Bir araştırma görevlisi kadrosu bulunuyor.',
              positions: [
                {
                  university: 'Örnek Üniversitesi',
                  unit: 'Mühendislik Fakültesi',
                  department: 'Bilgisayar Mühendisliği',
                  field: 'Yazılım',
                  title: 'Araştırma Görevlisi',
                  status: 'new',
                  count: 1,
                  degree: '5',
                  ales: 'Sayısal 70',
                  foreign_language: '50',
                  special_conditions: ['Yüksek lisans yapıyor olmak'],
                  application_deadline: '14.08.2026',
                  application_method: 'Şahsen veya posta',
                  evidence: 'Araştırma Görevlisi, 1 adet',
                  source_page: '2',
                },
              ],
            }
          : isPdf
            ? {
                document_type: 'other',
                has_research_assistant: false,
                uncertain: false,
                needs_manual_review: false,
                document_summary: 'Araştırma görevlisi kadrosu yok.',
                positions: [],
              }
            : { bullets: ['Bir yönetmelik ve çeşitli ilanlar yayımlandı.'], notable: [] };
        return textResponse(
          200,
          JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(data) }] } }] })
        );
      }
      throw new Error(`Unexpected URL: ${url}`);
    },
  },
};

store.GEMINI_API_KEY = 'test-api-key-that-is-long-enough';
store.RECIPIENT_EMAIL = 'alerts@example.com';
vm.createContext(context);
['Code.gs', 'WebApp.gs'].forEach((filename) => {
  const codePath = path.resolve(__dirname, '..', filename);
  vm.runInContext(fs.readFileSync(codePath, 'utf8'), context, { filename: codePath });
});

const first = context.monitorDate_(new Date('2026-08-04T10:00:00+03:00'), false);
assert.strictEqual(first.sent, 1);
assert.strictEqual(sentEmails.length, 1);
assert(sentEmails[0].subject.includes('Research Assistant: 1'));
assert(sentEmails[0].htmlBody.includes('Örnek Üniversitesi'));
assert(sentEmails[0].htmlBody.includes('Open official notice'));
assert.strictEqual(geminiCalls, 3, 'Two PDF analyses and one headline summary expected');

const second = context.monitorDate_(new Date('2026-08-04T12:00:00+03:00'), false);
assert.strictEqual(second.sent, 0);
assert.strictEqual(second.skipped, 1);
assert.strictEqual(sentEmails.length, 1, 'Processed issue must not be emailed twice');
assert.strictEqual(geminiCalls, 3, 'Deduplication must happen before AI calls');

const forced = context.monitorDate_(new Date('2026-08-04T13:00:00+03:00'), true);
assert.strictEqual(forced.sent, 1);
assert.strictEqual(sentEmails.length, 2, 'Force resend must produce a new message');
assert.strictEqual(geminiCalls, 6, 'Force resend must bypass the document analysis cache');

const originalFind = context.findAcademicCandidates_;
const originalAnalyze = context.analyzeAcademicCandidates_;
const originalSummarize = context.summarizeHeadlines_;
context.findAcademicCandidates_ = () => [{ title: 'Belirsiz belge', url: 'https://www.resmigazete.gov.tr/example.pdf' }];
context.analyzeAcademicCandidates_ = () => [
  {
    title: 'Belirsiz belge',
    url: 'https://www.resmigazete.gov.tr/example.pdf',
    status: 'ok',
    analysis: {
      hasResearchAssistant: true,
      needsManualReview: true,
      uncertain: true,
      documentSummary: 'Kadro var ancak tablo okunamadı.',
      positions: [],
    },
  },
];
context.summarizeHeadlines_ = () => ({ bullets: ['Özet'], notable: [] });
const manualReviewReport = context.buildPublicationReport_(
  {
    title: 'Test',
    items: [{ title: 'Başlık', url: 'https://www.resmigazete.gov.tr/' }],
    pageUrl: 'https://www.resmigazete.gov.tr/',
    pdfUrl: 'https://www.resmigazete.gov.tr/test.pdf',
  },
  { deadline: Date.now() + 100000 },
  false
);
assert.strictEqual(manualReviewReport.positions.length, 0);
assert.strictEqual(manualReviewReport.reviewNeeded.length, 1, 'Unparsed positive document must require manual review');
context.findAcademicCandidates_ = originalFind;
context.analyzeAcademicCandidates_ = originalAnalyze;
context.summarizeHeadlines_ = originalSummarize;

console.log('End-to-end mocked Apps Script test passed.');
