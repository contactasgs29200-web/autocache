// tests/stripeShapes.test.js
// Ces lecteurs existent parce que Stripe a déplacé des champs entre deux
// versions d'API, et que le code les cherchait au seul ancien emplacement. Les
// deux pannes qui en ont découlé — dates « Invalid Date » dans l'espace client,
// et surtout `invoice.paid` / `invoice.payment_failed` sans effet — étaient
// silencieuses : aucune exception, juste une condition jamais vérifiée.
//
// D'où ces cas : chaque champ est éprouvé dans SA FORME ANCIENNE et dans SA
// FORME NOUVELLE, avec les charges utiles telles que Stripe les émet.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { periodOf, subscriptionIdOfInvoice } from '../api/_stripeShapes.js';

/* ── periodOf : bornes de la période facturée ── */

test('periodOf lit l’ancien emplacement, sur l’abonnement', () => {
  assert.deepEqual(
    periodOf({ current_period_start: 100, current_period_end: 200 }),
    { start: 100, end: 200 },
  );
});

test('periodOf lit le nouvel emplacement, sur la ligne d’abonnement', () => {
  const sub = { items: { data: [{ current_period_start: 100, current_period_end: 200 }] } };
  assert.deepEqual(periodOf(sub), { start: 100, end: 200 });
});

test('periodOf rend null plutôt qu’undefined quand la période est introuvable', () => {
  // L'interface teste `periodEnd` avant de formater : `null` la fait taire,
  // `undefined` produisait « Invalid Date » et « NaN jour ».
  assert.deepEqual(periodOf({}), { start: null, end: null });
  assert.deepEqual(periodOf(null), { start: null, end: null });
});

/* ── subscriptionIdOfInvoice : abonnement rattaché à une facture ── */

test('subscriptionIdOfInvoice lit l’ancien champ `subscription`', () => {
  assert.equal(subscriptionIdOfInvoice({ subscription: 'sub_123' }), 'sub_123');
});

test('subscriptionIdOfInvoice lit le nouveau champ `parent.subscription_details`', () => {
  const invoice = { parent: { subscription_details: { subscription: 'sub_456' } } };
  assert.equal(subscriptionIdOfInvoice(invoice), 'sub_456');
});

test('subscriptionIdOfInvoice se rabat sur les lignes de la facture', () => {
  const invoice = {
    lines: { data: [{ parent: { subscription_item_details: { subscription: 'sub_789' } } }] },
  };
  assert.equal(subscriptionIdOfInvoice(invoice), 'sub_789');
});

test('subscriptionIdOfInvoice accepte un abonnement développé en objet', () => {
  // Une facture récupérée avec `expand` porte l'objet entier, pas son
  // identifiant : `stripe.subscriptions.retrieve(objet)` échouerait.
  assert.equal(
    subscriptionIdOfInvoice({ subscription: { id: 'sub_abc', status: 'active' } }),
    'sub_abc',
  );
});

test('subscriptionIdOfInvoice rend null pour une facture sans abonnement', () => {
  // Facture ponctuelle : ni suspension ni remise à zéro du quota à en tirer.
  assert.equal(subscriptionIdOfInvoice({ id: 'in_1', lines: { data: [] } }), null);
  assert.equal(subscriptionIdOfInvoice({}), null);
});

test('subscriptionIdOfInvoice ignore une valeur vide et poursuit la recherche', () => {
  const invoice = {
    subscription: '',
    parent: { subscription_details: { subscription: 'sub_ok' } },
  };
  assert.equal(subscriptionIdOfInvoice(invoice), 'sub_ok');
});
