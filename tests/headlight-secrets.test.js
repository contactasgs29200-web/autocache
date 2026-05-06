// Sanity check: no API key is ever hardcoded in the headlight pipeline files.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

const FILES_TO_SCAN = [
  'api/lustrage-pro.js',
  'api/headlights.js',
  'api/_lib/headlight/index.js',
  'api/_lib/headlight/composite.js',
  'api/_lib/headlight/mask.js',
  'api/_lib/headlight/prompts.js',
  'api/_lib/headlight/providers/base.js',
  'api/_lib/headlight/providers/index.js',
  'api/_lib/headlight/providers/openai.js',
  'api/_lib/headlight/providers/replicate.js',
  'api/_lib/headlight/providers/stability.js',
];

// Heuristic regex set: matches typical real keys, NOT the env var names.
const SECRET_PATTERNS = [
  /sk-[A-Za-z0-9]{20,}/,                 // OpenAI live key
  /sk-proj-[A-Za-z0-9]{20,}/,            // OpenAI project key
  /\br8_[A-Za-z0-9]{20,}/,               // Replicate token
  /\bsk-[A-Za-z0-9]{20,}stability/i,     // Stability sample
  /api[_-]?key\s*[:=]\s*["'][A-Za-z0-9_\-]{24,}["']/i,
  /authorization\s*[:=]\s*["']Bearer\s+[A-Za-z0-9_\-]{20,}["']/i,
];

test('no hardcoded API keys in headlight source files', () => {
  for (const rel of FILES_TO_SCAN) {
    const file = path.join(ROOT, rel);
    assert.ok(fs.existsSync(file), `expected ${rel} to exist`);
    const src = fs.readFileSync(file, 'utf8');
    for (const re of SECRET_PATTERNS) {
      assert.equal(re.test(src), false, `${rel} appears to contain a hardcoded secret matching ${re}`);
    }
    // Cross-check: every key access goes through env, not literals.
    if (rel.includes('providers/')) {
      assert.ok(/this\.apiKey/.test(src) || !/Authorization|Bearer/i.test(src),
        `${rel} uses Authorization without going through this.apiKey`);
    }
  }
});

test('lustrage-pro.js does not reference yellow→white pixel filters', () => {
  const src = fs.readFileSync(path.join(ROOT, 'api/lustrage-pro.js'), 'utf8');
  // The new pipeline must not contain the legacy "yellow pixel replacement"
  // logic. We grep for tell-tale strings of the old approach.
  const banned = [
    'yellowToWhite',
    'replaceYellowPixels',
    'rgbToWhite',
    'pixel = 255,255,255',
  ];
  for (const phrase of banned) {
    assert.equal(src.includes(phrase), false, `lustrage-pro.js still contains ${phrase}`);
  }
});
