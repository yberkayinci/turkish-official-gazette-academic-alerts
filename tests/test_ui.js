const assert = require('assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.resolve(__dirname, '../Index.html'), 'utf8');
const scriptMatches = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];

assert.strictEqual(scriptMatches.length, 1, 'Dashboard should contain one local script');
new Function(scriptMatches[0][1]);

[
  'Primary recipient',
  'Check every',
  'Full AI',
  'Summary only',
  'Keyword mode',
  'Gemini API key',
  'Required keywords',
  'Recent activity',
].forEach((label) => assert(html.includes(label), `Missing dashboard control: ${label}`));

assert(html.includes('aria-live="polite"'), 'Dashboard needs an accessible live region');
assert(html.includes('prefers-reduced-motion'), 'Dashboard should respect reduced-motion preferences');
assert(html.includes('autocomplete="off"'), 'API key must not use browser autocomplete');
assert(!html.includes('.innerHTML'), 'User-facing data must not be rendered with innerHTML');
assert(!html.includes('localStorage'), 'Secrets and settings must not be placed in localStorage');
assert(!html.includes('RECIPIENT_EMAIL'), 'Runtime recipient properties must not be embedded in the UI');

console.log('Dashboard UI structure and client-side safety checks passed.');
