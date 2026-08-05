import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validatePublication, acceptanceState, bindingVersion, hashContent,
  earliestEffectiveDate, suggestedEffectiveDate, minimumNoticeDays,
  CHANGE_KINDS, DEFAULT_NOTICE_DAYS, SUMMARY_MIN,
} from '../src/legalTerms.js';
import { renderMarkdown, escapeHtml, firstHeading } from '../src/markdownLite.js';
import { BASELINE_MARKDOWN } from '../src/legalBaseline.js';

const T0 = new Date('2026-08-05T12:00:00.000Z');
const jours = (n) => new Date(T0.getTime() + n * 86400000);
const CORPS = 'Article 1 — Objet. '.repeat(30); // au-delà du minimum exigé

const base = (extra = {}) => ({
  title: 'Conditions Générales de Vente',
  summary: 'Le tarif mensuel passe de 12,90 € à 14,90 € à compter de la date indiquée.',
  kind: 'substantive',
  body: CORPS,
  ...extra,
});

// ── Préavis ────────────────────────────────────────────────────────────────

test('une modification substantielle exige trente jours de préavis', () => {
  assert.equal(minimumNoticeDays('substantive'), DEFAULT_NOTICE_DAYS);
  const trop_tot = validatePublication(base({ effectiveAt: jours(10).toISOString() }), T0);
  assert.equal(trop_tot.ok, false);
  assert.match(trop_tot.error, /préavis/);

  const ok = validatePublication(base({ effectiveAt: jours(31).toISOString() }), T0);
  assert.equal(ok.ok, true);
  assert.equal(ok.value.noticeDays, 30);
});

test('une correction de forme peut prendre effet immédiatement', () => {
  const r = validatePublication(base({ kind: 'minor', effectiveAt: T0.toISOString() }), T0);
  assert.equal(r.ok, true);
  assert.equal(r.value.kind, 'minor');
});

test('sans préavis, « aujourd\'hui » vaut maintenant et non minuit', () => {
  // Le formulaire ne saisit qu'une date : choisir le jour même produirait sinon
  // une date antérieure à la publication, rejetée comme rétroactive.
  const jourMeme = '2026-08-05T00:00:00.000Z';
  const r = validatePublication(base({ kind: 'minor', effectiveAt: jourMeme }), T0);
  assert.equal(r.ok, true);
  assert.equal(r.value.effectiveAt, T0.toISOString());
  // La veille reste refusée, préavis nul ou non.
  assert.equal(validatePublication(base({ kind: 'minor', effectiveAt: '2026-08-04T00:00:00.000Z' }), T0).ok, false);
  // Et la date proposée par défaut pour ces natures est bien le jour même.
  assert.equal(suggestedEffectiveDate('minor', T0).toISOString().slice(0, 10), '2026-08-05');
});

test('une mise en conformité légale n\'attend pas non plus', () => {
  const r = validatePublication(base({ kind: 'legal', effectiveAt: T0.toISOString() }), T0);
  assert.equal(r.ok, true);
});

test('aucune version ne peut entrer en vigueur avant sa publication', () => {
  // Une modification rétroactive serait inopposable : elle est refusée à la
  // source plutôt que d'être publiée puis contestée.
  const r = validatePublication(base({ kind: 'minor', effectiveAt: jours(-3).toISOString() }), T0);
  assert.equal(r.ok, false);
  assert.match(r.error, /rétroactive|préavis/);
});

test('un préavis volontairement plus long est accepté, un plus court refusé', () => {
  assert.equal(validatePublication(base({ noticeDays: 60, effectiveAt: jours(61).toISOString() }), T0).ok, true);
  assert.equal(validatePublication(base({ noticeDays: 5 }), T0).ok, false);
});

test('la date proposée par défaut respecte déjà le préavis', () => {
  const proposee = suggestedEffectiveDate('substantive', T0);
  assert.ok(proposee.getTime() >= earliestEffectiveDate('substantive', T0).getTime());
  assert.equal(validatePublication(base({ effectiveAt: proposee.toISOString() }), T0).ok, true);
});

// ── Obligation d'information ───────────────────────────────────────────────

test('le résumé des modifications est obligatoire', () => {
  const sans = validatePublication(base({ summary: '' }), T0);
  assert.equal(sans.ok, false);
  assert.match(sans.error, /[Rr]ésumé/);
  assert.equal(validatePublication(base({ summary: 'a'.repeat(SUMMARY_MIN - 1) }), T0).ok, false);
});

test('un titre ou un texte vide bloque la publication', () => {
  assert.equal(validatePublication(base({ title: '  ' }), T0).ok, false);
  assert.equal(validatePublication(base({ body: 'trop court' }), T0).ok, false);
});

test('une nature de modification non précisée est refusée', () => {
  assert.equal(validatePublication(base({ kind: undefined }), T0).ok, false);
  assert.equal(validatePublication(base({ kind: 'peu-importe' }), T0).ok, false);
});

// ── Empreinte ──────────────────────────────────────────────────────────────

test('l\'empreinte distingue deux textes, et ne varie pas pour un même texte', () => {
  assert.equal(hashContent('abc'), hashContent('abc'));
  assert.notEqual(hashContent('abc'), hashContent('abd'));
  // Une virgule déplacée change l'empreinte : c'est ce qui rend l'acceptation
  // vérifiable mot pour mot.
  assert.notEqual(hashContent(CORPS), hashContent(CORPS + ' '));
});

// ── Acceptation ────────────────────────────────────────────────────────────

const doc = (extra = {}) => ({
  version: 3, kind: 'substantive', contentHash: 'abc-1', effectiveAt: jours(10).toISOString(), ...extra,
});

test('pendant le préavis, la nouvelle version informe mais ne bloque pas', () => {
  const e = acceptanceState({ doc: doc(), accepted: { version: 2, hash: 'x' }, now: T0 });
  assert.equal(e.mode, 'info');
  assert.equal(e.blocking, false);
  assert.equal(e.inForce, false);
});

test('une fois en vigueur et non acceptée, elle bloque — avec sortie par la résiliation', () => {
  const e = acceptanceState({ doc: doc({ effectiveAt: jours(-1).toISOString() }), accepted: { version: 2 }, now: T0 });
  assert.equal(e.mode, 'blocking');
  assert.equal(e.mayTerminate, true);
});

test('la version acceptée ne redemande rien', () => {
  const e = acceptanceState({
    doc: doc({ effectiveAt: jours(-1).toISOString() }),
    accepted: { version: 3, hash: 'abc-1' },
    now: T0,
  });
  assert.equal(e.mode, 'none');
  assert.equal(e.required, false);
});

test('une acceptation portant sur un texte différent ne vaut pas acceptation', () => {
  // Même numéro de version mais empreinte différente : le texte a changé.
  const e = acceptanceState({
    doc: doc({ effectiveAt: jours(-1).toISOString() }),
    accepted: { version: 3, hash: 'ancienne-empreinte' },
    now: T0,
  });
  assert.equal(e.mode, 'blocking');
});

test('une correction de forme ne demande aucune acceptation', () => {
  const e = acceptanceState({ doc: doc({ kind: 'minor', effectiveAt: jours(-1).toISOString() }), accepted: null, now: T0 });
  assert.equal(e.mode, 'none');
});

test('une mise en conformité légale informe sans jamais couper l\'accès', () => {
  const e = acceptanceState({ doc: doc({ kind: 'legal', effectiveAt: jours(-1).toISOString() }), accepted: null, now: T0 });
  assert.equal(e.mode, 'info');
  assert.equal(e.blocking, false);
  assert.equal(CHANGE_KINDS.legal.blocking, false);
});

test('sans version publiée, rien n\'est demandé', () => {
  assert.equal(acceptanceState({ doc: null, accepted: null, now: T0 }).mode, 'none');
  assert.equal(acceptanceState({}).mode, 'none');
});

// ── Version applicable ─────────────────────────────────────────────────────

test('la version qui lie un client est celle en vigueur, pas la dernière publiée', () => {
  const docs = [
    { version: 1, effectiveAt: jours(-90).toISOString() },
    { version: 2, effectiveAt: jours(-10).toISOString() },
    { version: 3, effectiveAt: jours(+20).toISOString() }, // encore sous préavis
  ];
  assert.equal(bindingVersion(docs, { version: 1 }, T0), 2);
  assert.equal(bindingVersion([], { version: 1 }, T0), 1);
  assert.equal(bindingVersion([], null, T0), null);
});

// ── Rendu du texte ─────────────────────────────────────────────────────────

test('le texte saisi ne peut jamais devenir du balisage', () => {
  const html = renderMarkdown('<script>alert(1)</script>\n\nTexte normal');
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.equal(escapeHtml('a & b "c" <d>'), 'a &amp; b &quot;c&quot; &lt;d&gt;');
});

test('un lien au schéma dangereux perd son lien, pas son texte', () => {
  const html = renderMarkdown('[cliquez](javascript:alert(1))');
  assert.ok(!html.includes('href'));
  assert.ok(html.includes('cliquez'));
  assert.ok(renderMarkdown('[nous écrire](mailto:contact@x.fr)').includes('href="mailto:contact@x.fr"'));
  assert.ok(renderMarkdown('[site](https://x.fr)').includes('href="https://x.fr"'));
});

test('titres, listes, tableaux et gras sont rendus', () => {
  const html = renderMarkdown([
    '# Titre',
    '',
    '## Article 1',
    '',
    'Un **mot** important.',
    '',
    '- premier',
    '- second',
    '',
    '| Formule | Tarif |',
    '|---|---|',
    '| Mensuel | 12,90 € |',
  ].join('\n'));
  assert.ok(html.includes('<h1>Titre</h1>'));
  assert.ok(html.includes('<h2>Article 1</h2>'));
  assert.ok(html.includes('<strong>mot</strong>'));
  assert.ok(html.includes('<li>premier</li>'));
  assert.ok(html.includes('<th>Formule</th>'));
  assert.ok(html.includes('<td>12,90 €</td>'));
});

test('le texte de référence est un document complet et publiable', () => {
  assert.equal(firstHeading(BASELINE_MARKDOWN), 'Mentions Légales');
  const r = validatePublication(base({ body: BASELINE_MARKDOWN, effectiveAt: jours(31).toISOString() }), T0);
  assert.equal(r.ok, true);
  // Les deux clauses qui donnent une base contractuelle au panneau doivent y être.
  assert.match(BASELINE_MARKDOWN, /Modification des présentes conditions/);
  assert.match(BASELINE_MARKDOWN, /suspension ou résiliation à l'initiative du Prestataire est motivée/);
});
