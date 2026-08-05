import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  limitWithBonus, normalizeBonus, carryBonus, quotaSnapshot,
  monthKey, recordMonthly, monthlySeries, HISTORY_MONTHS_MAX,
} from '../src/subscriptionQuota.js';

// ── Crédits accordés à la main ─────────────────────────────────────────────

test('les crédits accordés s\'ajoutent au quota de la formule', () => {
  assert.equal(limitWithBonus('premium', 'monthly', 500), 1500);
  assert.equal(limitWithBonus('premium', 'weekly', 250), 500);
  assert.equal(limitWithBonus('trial', null, 20), 50); // 30 d'essai + 20 accordées
});

test('un solde absurde vaut zéro plutôt que de fausser le quota', () => {
  assert.equal(normalizeBonus(undefined), 0);
  assert.equal(normalizeBonus(-50), 0);
  assert.equal(normalizeBonus('beaucoup'), 0);
  assert.equal(normalizeBonus(12.7), 12);
});

test('au renouvellement, le solde ne perd que ce qui a été pris dessus', () => {
  // 1 000 de formule + 500 accordées. 1 200 consommées → 200 pris sur le solde.
  assert.equal(carryBonus(500, 1200, 1000), 300);
  // Consommation inférieure au quota de base : le solde est intact.
  assert.equal(carryBonus(500, 800, 1000), 500);
  // Tout le solde consommé : il ne devient pas négatif.
  assert.equal(carryBonus(500, 5000, 1000), 0);
});

// ── Photographie du quota ──────────────────────────────────────────────────

const T = (s) => new Date(s);

test('l\'essai gratuit ne se renouvelle jamais', () => {
  const q = quotaSnapshot(
    { plan: 'trial', photosUsed: 30, periodStart: '2026-01-01T00:00:00Z' },
    T('2026-08-05T12:00:00Z'),
  );
  assert.equal(q.limit, 30);
  assert.equal(q.used, 30);
  assert.equal(q.remaining, 0);
  assert.equal(q.renewed, false);
  assert.equal(q.periodEnd, null);
});

test('un abonné revenu après une fenêtre voit son quota rouvert, sans écriture préalable', () => {
  // C'est le point qui manquait : l'affichage montrait l'ancien compteur
  // jusqu'à la première photo traitée.
  const q = quotaSnapshot(
    { plan: 'premium', formule: 'monthly', photosUsed: 900, periodStart: '2026-06-10T00:00:00Z' },
    T('2026-08-05T12:00:00Z'),
  );
  assert.equal(q.renewed, true);
  assert.equal(q.used, 0);
  assert.equal(q.remaining, 1000);
  // La fenêtre avance d'un mois plein, sans se recaler sur « maintenant » : le
  // 10 reste le jour anniversaire, et la période en cours court jusqu'au 10 août.
  assert.equal(q.periodStart, '2026-07-10T00:00:00.000Z');
  assert.equal(q.periodEnd, '2026-08-10T00:00:00.000Z');
});

test('dans la fenêtre en cours, rien n\'est réinitialisé', () => {
  const q = quotaSnapshot(
    { plan: 'premium', formule: 'monthly', photosUsed: 400, periodStart: '2026-07-20T00:00:00Z' },
    T('2026-08-05T12:00:00Z'),
  );
  assert.equal(q.renewed, false);
  assert.equal(q.used, 400);
  assert.equal(q.remaining, 600);
});

test('le renouvellement décompte les crédits réellement consommés', () => {
  const q = quotaSnapshot(
    { plan: 'premium', formule: 'monthly', photosUsed: 1200, periodStart: '2026-06-01T00:00:00Z', bonus: 500 },
    T('2026-08-05T12:00:00Z'),
  );
  assert.equal(q.bonus, 300);   // 200 pris sur les 500 accordées
  assert.equal(q.limit, 1300);
  assert.equal(q.used, 0);
});

test('un abonné sans ancre en reçoit une, sans perdre son compteur', () => {
  const maintenant = T('2026-08-05T12:00:00Z');
  const q = quotaSnapshot({ plan: 'premium', formule: 'monthly', photosUsed: 120, periodStart: null }, maintenant);
  assert.equal(q.periodStart, maintenant.toISOString());
  assert.equal(q.used, 120);
});

test('un compteur négatif ou illisible ne crée pas de quota supplémentaire', () => {
  const q = quotaSnapshot({ plan: 'premium', formule: 'monthly', photosUsed: -50, periodStart: '2026-08-01T00:00:00Z' }, T('2026-08-05T12:00:00Z'));
  assert.equal(q.used, 0);
  assert.equal(q.remaining, 1000);
});

// ── Historique mensuel ─────────────────────────────────────────────────────

test('les mois sont indexés en temps universel', () => {
  assert.equal(monthKey(T('2026-08-05T12:00:00Z')), '2026-08');
  assert.equal(monthKey(T('2026-01-01T00:30:00Z')), '2026-01');
  assert.equal(monthKey('pas-une-date').length, 7); // repli sur le mois courant
});

test('les traitements s\'additionnent dans le mois en cours', () => {
  let h = recordMonthly(undefined, 10, T('2026-08-05T12:00:00Z'));
  h = recordMonthly(h, 5, T('2026-08-20T12:00:00Z'));
  h = recordMonthly(h, 7, T('2026-09-02T12:00:00Z'));
  assert.deepEqual(h, { '2026-08': 15, '2026-09': 7 });
});

test('l\'historique est borné : il voyage dans chaque jeton de session', () => {
  let h = {};
  for (let i = 0; i < HISTORY_MONTHS_MAX + 12; i++) {
    h = recordMonthly(h, 1, new Date(Date.UTC(2020, i, 15)));
  }
  assert.equal(Object.keys(h).length, HISTORY_MONTHS_MAX);
  // Ce sont les mois les plus récents qui sont conservés.
  assert.ok(Object.keys(h).sort()[0] > '2020-12');
});

test('une valeur douteuse n\'empoisonne pas l\'historique', () => {
  const h = recordMonthly({ '2026-08': 'beaucoup' }, 5, T('2026-08-05T12:00:00Z'));
  assert.equal(h['2026-08'], 5);
  assert.deepEqual(recordMonthly({}, -3, T('2026-08-05T12:00:00Z')), { '2026-08': 0 });
});

test('la série affichée comble les mois sans usage', () => {
  const s = monthlySeries({ '2026-08': 42, '2026-05': 10 }, 12, T('2026-08-05T12:00:00Z'));
  assert.equal(s.length, 12);
  assert.deepEqual(s[0], { month: '2026-08', photos: 42 });
  assert.deepEqual(s[1], { month: '2026-07', photos: 0 });
  assert.deepEqual(s[3], { month: '2026-05', photos: 10 });
  // La série remonte bien douze mois, changement d'année compris.
  assert.equal(s[11].month, '2025-09');
});
