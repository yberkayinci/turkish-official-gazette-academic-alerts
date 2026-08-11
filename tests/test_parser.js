const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const context = {
  console,
  Utilities: {
    DigestAlgorithm: { SHA_256: 'SHA_256' },
    computeDigest(_algorithm, value) {
      return Array.from(crypto.createHash('sha256').update(String(value)).digest()).map((byte) =>
        byte > 127 ? byte - 256 : byte
      );
    },
  },
};
vm.createContext(context);
['Code.gs', 'WebApp.gs'].forEach((filename) => {
  const codePath = path.resolve(__dirname, '..', filename);
  vm.runInContext(fs.readFileSync(codePath, 'utf8'), context, { filename: codePath });
});

const dateParts = {
  year: '2026',
  month: '08',
  day: '04',
  iso: '2026-08-04',
  compact: '20260804',
  displayNumeric: '04.08.2026',
  human: '4 Ağustos 2026',
};

const dailyHtml = `
<!doctype html><html><body>
  <h6>04 Ağustos 2026 Tarihli ve 33330 Sayılı Resmî Gazete</h6>
  <a href="https://www.resmigazete.gov.tr/eskiler/2026/08/20260804.pdf">PDF Görüntüle</a>
  <a href="https://www.resmigazete.gov.tr/eskiler/2026/08/20260804-1.htm">–– İlk Yönetmelik</a>
  <a href="/ilanlar/eskiilanlar/2026/08/20260804-4.htm">c - Çeşitli İlânlar</a>
  <a href="/fihrist?tarih=2026-08-04&amp;mukerrer=1">1. Mükerrer</a>
  <a href="/fihrist?mukerrer=7&amp;tarih=2026-08-04">7. Mükerrer</a>
  <a href="/fihrist?tarih=2026-08-03&amp;mukerrer=2">Dünün mükerreri</a>
</body></html>`;

const parsed = context.parseIssuePage_(
  dailyHtml,
  'https://www.resmigazete.gov.tr/04.08.2026',
  dateParts,
  0
);
assert(parsed, 'Normal issue should parse');
assert.strictEqual(parsed.pdfUrl, 'https://www.resmigazete.gov.tr/eskiler/2026/08/20260804.pdf');
assert.strictEqual(parsed.items.length, 2);
assert.strictEqual(parsed.items[0].title, 'Çeşitli İlânlar', 'Announcement index must be prioritized');
assert.strictEqual(parsed.items[1].title, 'İlk Yönetmelik');
assert(parsed.title.includes('33330'));

assert.deepStrictEqual(
  Array.from(
    context.discoverMukerrerNumbers_(
      dailyHtml,
      'https://www.resmigazete.gov.tr/04.08.2026',
      dateParts
    )
  ),
  [1, 2, 3, 4, 5, 6, 7]
);

const wrongDateHtml = dailyHtml.replaceAll('20260804', '20260803');
assert.strictEqual(
  context.parseIssuePage_(
    wrongDateHtml,
    'https://www.resmigazete.gov.tr/05.08.2026',
    dateParts,
    0
  ),
  null,
  'A successful page that falls back to another date must be rejected'
);

const noPublicationHtml = '<html><body>Bugün Resmî Gazete yayımlanmamaktadır.</body></html>';
assert.strictEqual(
  context.parseIssuePage_(
    noPublicationHtml,
    'https://www.resmigazete.gov.tr/01.01.2026',
    dateParts,
    0
  ),
  null
);

const mukerrerHtml = `
<html><body>
  04 Ağustos 2026 Tarihli ve 33330 Sayılı Resmî Gazete 1. Mükerrer
  <a href="/eskiler/2026/08/20260804M1.pdf">PDF Görüntüle</a>
  <a href="/eskiler/2026/08/20260804M1-1.pdf">–– Cumhurbaşkanı Kararı</a>
</body></html>`;
const extra = context.parseIssuePage_(
  mukerrerHtml,
  'https://www.resmigazete.gov.tr/fihrist?tarih=2026-08-04&mukerrer=1',
  dateParts,
  1
);
assert(extra, 'Mükerrer issue should parse');
assert.strictEqual(extra.mukerrerNumber, 1);
assert.strictEqual(extra.items[0].title, 'Cumhurbaşkanı Kararı');

const announcementHtml = `
<html><body>
  <a href="20260804-4-1.pdf">Sivas Cumhuriyet Üniversitesi Rektörlüğünden:</a>
  <a href="20260804-4-2.pdf">İçişleri Bakanlığından:</a>
  <a href="20260804-4-3.pdf">İstanbul Teknik Üniversitesi Rektörlüğünden:</a>
</body></html>`;
const announcementLinks = context.extractAnchors_(
  announcementHtml,
  'https://www.resmigazete.gov.tr/ilanlar/eskiilanlar/2026/08/20260804-4.htm'
);
assert.strictEqual(announcementLinks.length, 3);
assert.strictEqual(
  announcementLinks[0].url,
  'https://www.resmigazete.gov.tr/ilanlar/eskiilanlar/2026/08/20260804-4-1.pdf'
);
assert.strictEqual(context.isAcademicCandidateTitle_(announcementLinks[0].text), true);
assert.strictEqual(context.isAcademicCandidateTitle_(announcementLinks[1].text), false);

assert.strictEqual(
  context.safeOfficialUrl_('https://evil.example/fake.pdf'),
  'https://www.resmigazete.gov.tr/'
);
assert.strictEqual(context.escapeHtml_('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');

console.log('All parser and safety tests passed.');
