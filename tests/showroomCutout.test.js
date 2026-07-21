import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickProvider } from '../api/showroom-cutout.js';

test('aucune clé → null (le frontend replie sur @imgly)', () => {
  assert.equal(pickProvider({}), null);
});

test('Photoroom prioritaire quand les deux clés sont présentes', () => {
  assert.equal(pickProvider({ PHOTOROOM_API_KEY: 'a', REMOVEBG_API_KEY: 'b' }), 'photoroom');
});

test('remove.bg seul → removebg', () => {
  assert.equal(pickProvider({ REMOVEBG_API_KEY: 'b' }), 'removebg');
});

test('SHOWROOM_CUTOUT_PROVIDER force le fournisseur', () => {
  const env = { PHOTOROOM_API_KEY: 'a', REMOVEBG_API_KEY: 'b' };
  assert.equal(pickProvider({ ...env, SHOWROOM_CUTOUT_PROVIDER: 'removebg' }), 'removebg');
  assert.equal(pickProvider({ ...env, SHOWROOM_CUTOUT_PROVIDER: 'photoroom' }), 'photoroom');
});

test('fournisseur forcé sans sa clé → null (pas de repli silencieux vers l\'autre)', () => {
  assert.equal(pickProvider({ REMOVEBG_API_KEY: 'b', SHOWROOM_CUTOUT_PROVIDER: 'photoroom' }), null);
});
