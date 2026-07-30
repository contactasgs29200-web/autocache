import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monthsElapsed } from '../api/stripe-webhook.js';

// Le quota est mensuel quelle que soit la cadence de facturation (CGV art. 3).
// `monthsElapsed` est le garde-fou qui empêche un encaissement hebdomadaire de
// réaccorder 1 000 photos chaque semaine : le webhook ne remet le compteur à
// zéro que lorsque cette fonction renvoie au moins 1.

test('aucun mois révolu quelques jours après le point de départ', () => {
  const anchor = '2026-03-10T09:00:00.000Z';
  assert.equal(monthsElapsed(anchor, new Date('2026-03-17T09:00:00Z')), 0);
  assert.equal(monthsElapsed(anchor, new Date('2026-03-31T23:59:00Z')), 0);
});

test('un mois révolu à la date anniversaire, pas la veille', () => {
  const anchor = '2026-03-10T09:00:00.000Z';
  assert.equal(monthsElapsed(anchor, new Date('2026-04-09T23:00:00Z')), 0);
  assert.equal(monthsElapsed(anchor, new Date('2026-04-10T09:00:00Z')), 1);
});

test('quatre encaissements hebdomadaires ne valent pas quatre quotas', () => {
  const anchor = '2026-03-05T12:00:00.000Z';
  const semaines = ['2026-03-12', '2026-03-19', '2026-03-26', '2026-04-02']
    .map(d => monthsElapsed(anchor, new Date(`${d}T12:00:00Z`)));
  assert.deepEqual(semaines, [0, 0, 0, 0], 'aucune de ces échéances ne doit rouvrir le quota');
  assert.equal(monthsElapsed(anchor, new Date('2026-04-05T12:00:00Z')), 1);
});

test('compte les mois cumulés sur une formule annuelle', () => {
  const anchor = '2026-01-15T00:00:00.000Z';
  assert.equal(monthsElapsed(anchor, new Date('2026-07-15T00:00:00Z')), 6);
  assert.equal(monthsElapsed(anchor, new Date('2027-01-15T00:00:00Z')), 12);
});

test('franchit correctement une fin de mois plus courte', () => {
  // Point de départ au 31 : février n'a pas de 31, le mois ne doit être
  // considéré révolu qu'au 31 mars.
  const anchor = '2026-01-31T08:00:00.000Z';
  assert.equal(monthsElapsed(anchor, new Date('2026-02-28T08:00:00Z')), 0);
  assert.equal(monthsElapsed(anchor, new Date('2026-03-31T08:00:00Z')), 2);
});

test('une ancre illisible ne réinitialise rien par accident', () => {
  assert.equal(monthsElapsed('pas-une-date', new Date('2026-05-01T00:00:00Z')), 0);
});

test('une ancre dans le futur ne renvoie jamais un négatif', () => {
  assert.equal(monthsElapsed('2026-09-01T00:00:00.000Z', new Date('2026-05-01T00:00:00Z')), 0);
});
