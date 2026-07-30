import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  photosForFormule, periodsElapsed, advanceAnchor, quotaLabel,
} from '../src/subscriptionQuota.js';

const at = iso => new Date(iso);

// ── Volumes par formule ────────────────────────────────────────────────────

test('l\'hebdomadaire ouvre 250 photos, les autres 1 000', () => {
  assert.equal(photosForFormule('weekly'), 250);
  assert.equal(photosForFormule('monthly'), 1000);
  assert.equal(photosForFormule('annual'), 1000);
});

test('une formule inconnue retombe sur la règle mensuelle', () => {
  // Comptes crédités par code administrateur : pas de formule enregistrée.
  assert.equal(photosForFormule(undefined), 1000);
  assert.equal(photosForFormule('legacy-pro'), 1000);
});

test('les libellés affichés correspondent aux volumes', () => {
  assert.equal(quotaLabel('weekly'), '250 photos / semaine');
  assert.equal(quotaLabel('monthly'), '1 000 photos / mois');
  assert.equal(quotaLabel('annual'), '1 000 photos / mois');
  assert.equal(quotaLabel(undefined), '1 000 photos / mois');
});

// ── Fenêtre hebdomadaire : 250 photos tous les 7 jours ─────────────────────

test('hebdo : le quota ne se rouvre pas avant le septième jour', () => {
  const anchor = '2026-03-02T10:00:00.000Z';
  assert.equal(periodsElapsed('weekly', anchor, at('2026-03-05T10:00:00Z')), 0);
  assert.equal(periodsElapsed('weekly', anchor, at('2026-03-08T09:00:00Z')), 0);
  assert.equal(periodsElapsed('weekly', anchor, at('2026-03-09T10:00:00Z')), 1);
});

test('hebdo : quatre semaines valent quatre fenêtres, soit 1 000 photos', () => {
  const anchor = '2026-03-02T10:00:00.000Z';
  const fenetres = periodsElapsed('weekly', anchor, at('2026-03-30T10:00:00Z'));
  assert.equal(fenetres, 4);
  assert.equal(fenetres * photosForFormule('weekly'), 1000,
    'quatre semaines d\'hebdo doivent représenter le volume mensuel des autres formules');
});

test('hebdo : une absence prolongée ne cumule pas les quotas', () => {
  // Trois semaines sans revenir : au retour on ouvre UNE fenêtre de 250,
  // pas trois. L'ancre est avancée pour rester alignée sur le jour d'échéance.
  const anchor = '2026-03-02T10:00:00.000Z';
  const periods = periodsElapsed('weekly', anchor, at('2026-03-23T10:00:00Z'));
  assert.equal(periods, 3);
  const suivante = advanceAnchor('weekly', anchor, periods);
  assert.equal(suivante, '2026-03-23T10:00:00.000Z');
  // Le quota rouvert reste celui d'une seule fenêtre.
  assert.equal(photosForFormule('weekly'), 250);
});

// ── Fenêtre mensuelle ──────────────────────────────────────────────────────

test('mensuel : un mois révolu à la date anniversaire, pas la veille', () => {
  const anchor = '2026-03-10T09:00:00.000Z';
  assert.equal(periodsElapsed('monthly', anchor, at('2026-04-09T23:00:00Z')), 0);
  assert.equal(periodsElapsed('monthly', anchor, at('2026-04-10T09:00:00Z')), 1);
});

test('annuel : le quota reste mensuel, pas annuel', () => {
  const anchor = '2026-01-15T00:00:00.000Z';
  assert.equal(periodsElapsed('annual', anchor, at('2026-07-15T00:00:00Z')), 6);
  assert.equal(periodsElapsed('annual', anchor, at('2027-01-15T00:00:00Z')), 12);
});

test('mensuel : franchit correctement une fin de mois plus courte', () => {
  const anchor = '2026-01-31T08:00:00.000Z';
  assert.equal(periodsElapsed('monthly', anchor, at('2026-02-28T08:00:00Z')), 0);
  assert.equal(periodsElapsed('monthly', anchor, at('2026-03-31T08:00:00Z')), 2);
});

// ── Avance de l'ancre ──────────────────────────────────────────────────────

test('l\'ancre mensuelle conserve le jour d\'échéance', () => {
  assert.equal(advanceAnchor('monthly', '2026-01-15T08:00:00.000Z', 2),
    '2026-03-15T08:00:00.000Z');
});

test('l\'ancre n\'avance pas sans fenêtre écoulée', () => {
  const anchor = '2026-05-01T00:00:00.000Z';
  assert.equal(advanceAnchor('weekly', anchor, 0), anchor);
  assert.equal(advanceAnchor('monthly', anchor, 0), anchor);
});

// ── Robustesse ─────────────────────────────────────────────────────────────

test('une ancre illisible ne réinitialise rien par accident', () => {
  assert.equal(periodsElapsed('weekly', 'pas-une-date', at('2026-05-01T00:00:00Z')), 0);
  assert.equal(periodsElapsed('monthly', undefined, at('2026-05-01T00:00:00Z')), 0);
});

test('une ancre dans le futur ne renvoie jamais un négatif', () => {
  assert.equal(periodsElapsed('weekly', '2026-09-01T00:00:00.000Z', at('2026-05-01T00:00:00Z')), 0);
  assert.equal(periodsElapsed('monthly', '2026-09-01T00:00:00.000Z', at('2026-05-01T00:00:00Z')), 0);
});
