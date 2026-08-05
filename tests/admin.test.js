import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAdminEmail, parseAdminEmails, normalizeEmail, OWNER_EMAIL } from '../src/admin.js';

test('seule l\'adresse propriétaire est administratrice par défaut', () => {
  assert.equal(isAdminEmail(OWNER_EMAIL), true);
  assert.equal(isAdminEmail('quelquun@example.com'), false);
});

test('la casse et les espaces ne changent pas le verdict', () => {
  assert.equal(isAdminEmail('  Contact.ASGS29200@Gmail.com '), true);
});

test('une adresse absente, vide ou non textuelle est refusée', () => {
  // Sans cette garantie, un compte sans email hériterait du panneau dès lors
  // qu'une entrée vide traînerait dans la liste.
  assert.equal(isAdminEmail(undefined), false);
  assert.equal(isAdminEmail(''), false);
  assert.equal(isAdminEmail(null), false);
  assert.equal(isAdminEmail({ toString: () => OWNER_EMAIL }), false);
});

test('une adresse voisine ne passe pas', () => {
  assert.equal(isAdminEmail('contact.asgs29200@gmail.com.attaquant.fr'), false);
  assert.equal(isAdminEmail('xcontact.asgs29200@gmail.com'), false);
});

test('la variable d\'environnement remplace la liste, mais jamais par du vide', () => {
  assert.deepEqual(parseAdminEmails('a@x.fr, B@Y.fr'), ['a@x.fr', 'b@y.fr']);
  // Une variable vide ou blanche doit retomber sur le propriétaire : sinon une
  // faute de frappe au déploiement fermerait le panneau à tout le monde.
  assert.deepEqual(parseAdminEmails(''), [OWNER_EMAIL]);
  assert.deepEqual(parseAdminEmails('   '), [OWNER_EMAIL]);
  assert.deepEqual(parseAdminEmails(undefined), [OWNER_EMAIL]);
});

test('la liste fournie est la seule reconnue', () => {
  const liste = parseAdminEmails('patron@garage.fr');
  assert.equal(isAdminEmail('patron@garage.fr', liste), true);
  assert.equal(isAdminEmail(OWNER_EMAIL, liste), false);
});

test('normalizeEmail ne casse pas sur une valeur non textuelle', () => {
  assert.equal(normalizeEmail(42), '');
  assert.equal(normalizeEmail(null), '');
});
