// tests/webhookBody.test.js
// Le webhook Stripe a été refusé 40 fois de suite avec « No signatures found
// matching the expected signature for payload ». La cause tenait à une
// hypothèse jamais vérifiée : le code reconstruisait le corps avec
// `JSON.stringify(obj)`, en supposant que Stripe émet du JSON compact. Stripe
// l'indente de deux espaces. Les octets différaient donc à chaque fois, et
// aucune signature ne pouvait correspondre.
//
// Ces cas figent la règle : plusieurs écritures sont proposées, l'indentée est
// proposée AVANT la compacte, et les formes exactes passent avant les
// reconstruites.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Stripe from 'stripe';
import { candidatesFrom, cleanSecret, secretShape } from '../api/_webhookBody.js';

const origines = list => list.map(c => c.origine);

test('un corps déjà brut est proposé tel quel, sans reconstruction', () => {
  const raw = Buffer.from('{"id":"evt_1"}', 'utf8');
  const c = candidatesFrom(raw, null);
  assert.deepEqual(origines(c), ['buffer']);
  assert.equal(c[0].raw, raw);
});

test('un corps texte est converti sans passer par une analyse JSON', () => {
  // Ré-analyser puis re-sérialiser perdrait l'écriture d'origine, qui est
  // précisément ce que Stripe a signé.
  const c = candidatesFrom('{"id":"evt_1"}', null);
  assert.deepEqual(origines(c), ['texte']);
  assert.equal(c[0].raw.toString('utf8'), '{"id":"evt_1"}');
});

test('le flux intact est proposé quand la plateforme n’a rien analysé', () => {
  const c = candidatesFrom(undefined, Buffer.from('{"id":"evt_1"}', 'utf8'));
  assert.deepEqual(origines(c), ['flux']);
});

test('un corps analysé propose l’écriture indentée avant la compacte', () => {
  // L'ordre décide : les deux sont testées, mais celle de Stripe doit être
  // rencontrée en premier pour que le cas courant coûte un seul calcul.
  const c = candidatesFrom({ id: 'evt_1', type: 'invoice.paid' }, null);
  assert.deepEqual(origines(c), ['reconstruit-indente', 'reconstruit-compact']);
});

test('l’écriture indentée reproduit exactement le format émis par Stripe', () => {
  const objet = { id: 'evt_1', data: { object: { id: 'in_1' } } };
  const c = candidatesFrom(objet, null);
  assert.equal(c[0].raw.toString('utf8'), JSON.stringify(objet, null, 2));
  assert.match(c[0].raw.toString('utf8'), /^\{\n {2}"id": "evt_1",/);
});

test('les formes exactes précèdent les reconstruites', () => {
  const c = candidatesFrom({ id: 'evt_1' }, Buffer.from('{"id":"evt_1"}', 'utf8'));
  assert.deepEqual(origines(c), ['flux', 'reconstruit-indente', 'reconstruit-compact']);
});

test('aucune candidate quand il n’y a rien à vérifier', () => {
  // Mieux vaut zéro candidate qu'un tampon vide : un corps vide produirait un
  // message d'erreur trompeur, parlant de signature là où il n'y a pas de
  // charge utile.
  assert.deepEqual(candidatesFrom(undefined, null), []);
  assert.deepEqual(candidatesFrom(Buffer.alloc(0), null), []);
  assert.deepEqual(candidatesFrom('', null), []);
});

/* ── Vérification de bout en bout, contre une vraie signature Stripe ── */

// Le reste de ce fichier décrit ce que le code PROPOSE. Ce cas-ci vérifie que
// la proposition est acceptée par la bibliothèque de Stripe elle-même : on
// signe une charge utile au format réellement émis, on simule la plateforme qui
// l'analyse en objet — ce que fait Vercel — et on exige que la signature soit
// retrouvée. C'est exactement le chemin qui échouait en production.
test('une charge utile analysée par la plateforme reste vérifiable', () => {
  const stripe = new Stripe('sk_test_pourLesTests');
  const secret = 'whsec_pourLesTests';
  const evenement = {
    id: 'evt_1',
    type: 'invoice.paid',
    data: { object: { id: 'in_1', parent: { subscription_details: { subscription: 'sub_1' } } } },
  };

  // Format d'émission de Stripe : JSON indenté de deux espaces.
  const charge = JSON.stringify(evenement, null, 2);
  const entete = stripe.webhooks.generateTestHeaderString({ payload: charge, secret });

  // Ce que la fonction reçoit sur Vercel : l'objet analysé, le flux épuisé.
  const candidats = candidatesFrom(JSON.parse(charge), null);

  let verifie = null;
  let origine = null;
  for (const c of candidats) {
    try {
      verifie = stripe.webhooks.constructEvent(c.raw, entete, secret);
      origine = c.origine;
      break;
    } catch { /* écriture suivante */ }
  }

  assert.ok(verifie, 'aucune écriture du corps n’a satisfait la signature');
  assert.equal(origine, 'reconstruit-indente');
  assert.equal(verifie.type, 'invoice.paid');
});

test('une charge utile compacte est retrouvée elle aussi', () => {
  // Stripe indente aujourd'hui ; rien ne garantit qu'il indentera toujours.
  // Les deux écritures sont proposées, donc les deux doivent aboutir.
  const stripe = new Stripe('sk_test_pourLesTests');
  const secret = 'whsec_pourLesTests';
  const evenement = { id: 'evt_2', type: 'checkout.session.completed' };
  const charge = JSON.stringify(evenement);
  const entete = stripe.webhooks.generateTestHeaderString({ payload: charge, secret });

  let verifie = null;
  let origine = null;
  for (const c of candidatesFrom(JSON.parse(charge), null)) {
    try {
      verifie = stripe.webhooks.constructEvent(c.raw, entete, secret);
      origine = c.origine;
      break;
    } catch { /* écriture suivante */ }
  }

  assert.ok(verifie, 'aucune écriture du corps n’a satisfait la signature');
  assert.equal(origine, 'reconstruit-compact');
});

test('un secret erroné n’est validé par aucune écriture', () => {
  // Sans quoi le diagnostic mentirait : « aucune candidate ne convient » doit
  // vouloir dire « le secret est en cause », et rien d'autre.
  const stripe = new Stripe('sk_test_pourLesTests');
  const charge = JSON.stringify({ id: 'evt_3' }, null, 2);
  const entete = stripe.webhooks.generateTestHeaderString({ payload: charge, secret: 'whsec_leBon' });

  for (const c of candidatesFrom(JSON.parse(charge), null)) {
    assert.throws(() => stripe.webhooks.constructEvent(c.raw, entete, 'whsec_leMauvais'));
  }
});

test('un secret collé avec un saut de ligne est nettoyé', () => {
  // Invisible dans l'interface de Vercel, et rigoureusement indistinguable d'un
  // secret erroné du point de vue du message d'erreur.
  assert.equal(cleanSecret('whsec_abc\n'), 'whsec_abc');
  assert.equal(cleanSecret('  whsec_abc  '), 'whsec_abc');
  assert.equal(cleanSecret(undefined), '');
});

test('la description d’un secret ne divulgue jamais sa valeur', () => {
  const secret = 'whsec_' + 'x'.repeat(32);
  const forme = secretShape(secret);
  assert.ok(!forme.includes('xxxx'), 'le secret ne doit pas apparaître dans le journal');
  assert.match(forme, /whsec_… \(38 caractères\)/);
  assert.equal(secretShape(''), 'absent');
  assert.match(secretShape('sk_live_truc'), /préfixe inattendu/);
});
