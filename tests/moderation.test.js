import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateSanction, sanctionState, banDurationFor, sanctionPatch, liftPatch,
  sanitizeReason, sanctionMessage, formatRemaining,
  SUSPENSION_MAX_HOURS, PERMANENT_BAN_DURATION, NO_BAN, SANCTION_HISTORY_MAX,
} from '../src/moderation.js';

const T0 = new Date('2026-08-05T12:00:00.000Z');
const plus = (h) => new Date(T0.getTime() + h * 3600000);

// ── Prononcé d'une sanction ────────────────────────────────────────────────

test('une suspension calcule son échéance à partir de la durée demandée', () => {
  const r = validateSanction({ type: 'suspension', hours: 72, reason: 'Partage de compte', by: 'admin@x.fr' }, T0);
  assert.equal(r.ok, true);
  assert.equal(r.sanction.until, plus(72).toISOString());
  assert.equal(r.sanction.reason, 'Partage de compte');
  assert.equal(r.sanction.by, 'admin@x.fr');
});

test('un bannissement n\'a pas d\'échéance', () => {
  const r = validateSanction({ type: 'ban', reason: 'Fraude au paiement' }, T0);
  assert.equal(r.ok, true);
  assert.equal(r.sanction.until, null);
});

test('le motif est obligatoire : c\'est lui qui est communiqué à l\'utilisateur', () => {
  assert.equal(validateSanction({ type: 'ban', reason: '' }, T0).ok, false);
  assert.equal(validateSanction({ type: 'ban', reason: '  ' }, T0).ok, false);
  assert.equal(validateSanction({ type: 'suspension', hours: 24 }, T0).ok, false);
});

test('une durée absurde est refusée plutôt que bornée en silence', () => {
  assert.equal(validateSanction({ type: 'suspension', hours: 0, reason: 'test' }, T0).ok, false);
  assert.equal(validateSanction({ type: 'suspension', hours: -5, reason: 'test' }, T0).ok, false);
  assert.equal(validateSanction({ type: 'suspension', hours: SUSPENSION_MAX_HOURS + 1, reason: 'test' }, T0).ok, false);
  assert.equal(validateSanction({ type: 'suspension', hours: 'beaucoup', reason: 'test' }, T0).ok, false);
});

test('un type inconnu est refusé', () => {
  assert.equal(validateSanction({ type: 'avertissement', reason: 'test' }, T0).ok, false);
});

test('le motif est normalisé et borné', () => {
  assert.equal(sanitizeReason('  trop   d\'espaces \n ici '), "trop d'espaces ici");
  assert.equal(sanitizeReason('x'.repeat(900)).length, 500);
});

// ── Lecture de l'état ──────────────────────────────────────────────────────

test('un compte sain n\'est pas sanctionné', () => {
  assert.equal(sanctionState({}).active, false);
  assert.equal(sanctionState(undefined).present, false);
  assert.equal(sanctionState({ sanction: null }).active, false);
});

test('une suspension expire d\'elle-même, sans intervention', () => {
  const { sanction } = validateSanction({ type: 'suspension', hours: 24, reason: 'test' }, T0);
  assert.equal(sanctionState({ sanction }, plus(23)).active, true);
  assert.equal(sanctionState({ sanction }, plus(25)).active, false);
  assert.equal(sanctionState({ sanction }, plus(25)).expired, true);
});

test('un bannissement ne s\'éteint jamais tout seul', () => {
  const { sanction } = validateSanction({ type: 'ban', reason: 'test' }, T0);
  assert.equal(sanctionState({ sanction }, plus(24 * 365 * 10)).active, true);
});

test('une échéance illisible maintient la sanction plutôt que de rouvrir l\'accès', () => {
  const sanction = { type: 'suspension', reason: 'test', until: 'pas-une-date', at: T0.toISOString() };
  assert.equal(sanctionState({ sanction }, plus(1)).active, true);
});

// ── Durée transmise à Supabase ─────────────────────────────────────────────

test('la durée envoyée à Supabase reflète le temps restant, pas la durée initiale', () => {
  const { sanction } = validateSanction({ type: 'suspension', hours: 2, reason: 'test' }, T0);
  assert.equal(banDurationFor(sanction, T0), '120m');
  assert.equal(banDurationFor(sanction, plus(1)), '60m');
  // Une suspension d'une heure ne doit pas se transformer en deux heures par un
  // arrondi à l'heure supérieure.
  const courte = validateSanction({ type: 'suspension', hours: 1, reason: 'test' }, T0).sanction;
  assert.equal(banDurationFor(courte, T0), '60m');
});

test('un bannissement se traduit par une durée hors d\'atteinte, une sanction échue par « none »', () => {
  assert.equal(banDurationFor({ type: 'ban', until: null }), PERMANENT_BAN_DURATION);
  const echue = { type: 'suspension', until: T0.toISOString() };
  assert.equal(banDurationFor(echue, plus(1)), NO_BAN);
  assert.equal(banDurationFor(null), NO_BAN);
});

// ── Historique ─────────────────────────────────────────────────────────────

test('chaque décision est ajoutée en tête de l\'historique, qui reste borné', () => {
  const { sanction } = validateSanction({ type: 'suspension', hours: 24, reason: 'motif A', by: 'a@x.fr' }, T0);
  const p1 = sanctionPatch(sanction, undefined);
  assert.equal(p1.sanction_history.length, 1);
  assert.equal(p1.sanction_history[0].action, 'suspension');

  const p2 = liftPatch(p1.sanction_history, { by: 'a@x.fr', reason: 'régularisé', at: plus(2) });
  assert.equal(p2.sanction, null);           // la levée efface la sanction…
  assert.equal(p2.sanction_history.length, 2); // …mais pas sa trace
  assert.equal(p2.sanction_history[0].action, 'lift');

  let h = [];
  for (let i = 0; i < SANCTION_HISTORY_MAX + 10; i++) h = sanctionPatch(sanction, h).sanction_history;
  assert.equal(h.length, SANCTION_HISTORY_MAX);
});

// ── Message affiché ────────────────────────────────────────────────────────

test('le message adressé à l\'utilisateur porte le motif', () => {
  const { sanction } = validateSanction({ type: 'suspension', hours: 24, reason: 'Partage de compte' }, T0);
  const msg = sanctionMessage(sanctionState({ sanction }, T0));
  assert.match(msg, /suspendu/);
  assert.match(msg, /Partage de compte/);

  const banni = validateSanction({ type: 'ban', reason: 'Fraude' }, T0).sanction;
  assert.match(sanctionMessage(sanctionState({ sanction: banni }, T0)), /Fraude/);
  // Rien à dire d'un compte sain.
  assert.equal(sanctionMessage(sanctionState({}, T0)), '');
});

test('la durée restante se lit en français, dans l\'unité pertinente', () => {
  assert.equal(formatRemaining(30 * 60000), '30 minutes');
  assert.equal(formatRemaining(3 * 3600000), '3 heures');
  assert.equal(formatRemaining(5 * 24 * 3600000), '5 jours');
  assert.equal(formatRemaining(-1), 'quelques instants');
});
