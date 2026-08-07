import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_BAND, BAND_HEIGHT_MIN, BAND_HEIGHT_MAX,
  BAND_LOGO_SCALE_MIN, BAND_LOGO_SCALE_MAX,
  normalizeBand, bandHasContent, bandAppliesTo, computeBandLayout,
} from '../src/photoBand.js';

// ── normalizeBand ────────────────────────────────────────────────────────

test('normalizeBand renvoie les valeurs par défaut sur une entrée absente', () => {
  assert.deepEqual(normalizeBand(null), DEFAULT_BAND);
  assert.deepEqual(normalizeBand(undefined), DEFAULT_BAND);
  assert.deepEqual(normalizeBand('bandeau'), DEFAULT_BAND);
});

test('normalizeBand borne la hauteur dans les deux sens', () => {
  assert.equal(normalizeBand({ height: 5 }).height, BAND_HEIGHT_MAX);
  assert.equal(normalizeBand({ height: 0 }).height, BAND_HEIGHT_MIN);
  assert.equal(normalizeBand({ height: 0.18 }).height, 0.18);
});

test('normalizeBand borne l\'opacité (une bande invisible n\'est pas une option)', () => {
  assert.equal(normalizeBand({ opacity: 0 }).opacity, 0.2);
  assert.equal(normalizeBand({ opacity: 3 }).opacity, 1);
});

// Une couleur relue du localStorage part directement dans ctx.fillStyle : une
// valeur qui n'est pas du #rrggbb doit être remplacée, jamais transmise.
test('normalizeBand rejette les couleurs qui ne sont pas du #rrggbb', () => {
  assert.equal(normalizeBand({ color1: 'red' }).color1, DEFAULT_BAND.color1);
  assert.equal(normalizeBand({ color1: '#fff' }).color1, DEFAULT_BAND.color1);
  assert.equal(normalizeBand({ titleColor: 'url(x)' }).titleColor, DEFAULT_BAND.titleColor);
  assert.equal(normalizeBand({ color1: '#A1B2C3' }).color1, '#A1B2C3');
});

test('normalizeBand replie les énumérations inconnues', () => {
  assert.equal(normalizeBand({ fill: 'damier' }).fill, DEFAULT_BAND.fill);
  assert.equal(normalizeBand({ logoPos: 'top' }).logoPos, 'none');
  assert.equal(normalizeBand({ scope: 'last' }).scope, 'all');
});

// Le sens du dégradé a été retiré des réglages : une configuration enregistrée
// avant ce changement ne doit pas le réintroduire par la porte de derrière.
test('le sens du dégradé n\'est plus un réglage', () => {
  const cfg = normalizeBand({ fill: 'gradient', gradientDir: 'vertical' });
  assert.ok(!('gradientDir' in cfg));
  assert.equal(cfg.fill, 'gradient');
});

test('normalizeBand garde les valeurs valides', () => {
  const cfg = normalizeBand({ enabled: true, fill: 'gradient', logoPos: 'right', scope: 'first', title: 'GARAGE X' });
  assert.equal(cfg.enabled, true);
  assert.equal(cfg.fill, 'gradient');
  assert.equal(cfg.logoPos, 'right');
  assert.equal(cfg.scope, 'first');
  assert.equal(cfg.title, 'GARAGE X');
});

// ── bandHasContent ───────────────────────────────────────────────────────

test('bandHasContent : un fond suffit', () => {
  assert.equal(bandHasContent({ fill: 'solid' }), true);
  assert.equal(bandHasContent({ fill: 'gradient' }), true);
});

test('bandHasContent : sans fond, il faut du texte ou un logo', () => {
  assert.equal(bandHasContent({ fill: 'none' }), false);
  assert.equal(bandHasContent({ fill: 'none', title: '   ' }), false);
  assert.equal(bandHasContent({ fill: 'none', title: 'Garage' }), true);
  assert.equal(bandHasContent({ fill: 'none', subtitle: '06 12 34 56 78' }), true);
});

// Le logo seul, sans bande ni écriture : la case cochée ne suffit pas, encore
// faut-il qu'un logo ait été importé.
test('bandHasContent : logo seul uniquement si un logo est chargé', () => {
  assert.equal(bandHasContent({ fill: 'none', logoPos: 'left' }, false), false);
  assert.equal(bandHasContent({ fill: 'none', logoPos: 'left' }, true), true);
  assert.equal(bandHasContent({ fill: 'none', logoPos: 'none' }, true), false);
});

// ── bandAppliesTo ────────────────────────────────────────────────────────

test('bandAppliesTo : portée « toutes »', () => {
  assert.equal(bandAppliesTo({ scope: 'all' }, 0, 'a', null), true);
  assert.equal(bandAppliesTo({ scope: 'all' }, 7, 'h', null), true);
});

test('bandAppliesTo : portée « première photo »', () => {
  assert.equal(bandAppliesTo({ scope: 'first' }, 0, 'a', null), true);
  assert.equal(bandAppliesTo({ scope: 'first' }, 1, 'b', null), false);
});

test('bandAppliesTo : portée « sélection »', () => {
  const sel = new Set(['b']);
  assert.equal(bandAppliesTo({ scope: 'selected' }, 0, 'a', sel), false);
  assert.equal(bandAppliesTo({ scope: 'selected' }, 1, 'b', sel), true);
  // Sélection absente : rien ne s'applique, plutôt que tout.
  assert.equal(bandAppliesTo({ scope: 'selected' }, 1, 'b', null), false);
});

// ── computeBandLayout ────────────────────────────────────────────────────

test('la hauteur suit la LARGEUR de la photo, pas sa hauteur', () => {
  // Même largeur, formats différents → même bande : le texte garde la même
  // taille apparente d'une photo à l'autre.
  const a = computeBandLayout({ cfg: { height: 0.12 }, width: 2000 });
  const b = computeBandLayout({ cfg: { height: 0.12 }, width: 2000 });
  assert.equal(a.H, 240);
  assert.equal(b.H, a.H);
  assert.equal(computeBandLayout({ cfg: { height: 0.12 }, width: 1000 }).H, 120);
});

test('sans logo, le texte occupe toute la largeur moins les marges', () => {
  const l = computeBandLayout({ cfg: { logoPos: 'none' }, width: 2000 });
  assert.equal(l.logo, null);
  assert.equal(l.text.x, l.pad);
  assert.equal(l.text.w, l.W - l.pad * 2);
  assert.equal(l.text.cx, l.W / 2);
});

test('logo à gauche : la colonne de texte commence après le logo', () => {
  const l = computeBandLayout({ cfg: { logoPos: 'left' }, width: 2000, logoAspect: 1 });
  assert.ok(l.logo);
  assert.equal(l.logo.x, l.pad);
  assert.ok(l.text.x > l.logo.x + l.logo.w, 'le texte ne chevauche pas le logo');
  assert.equal(l.text.x + l.text.w, l.W - l.pad);
});

test('logo à droite : le logo est collé au bord droit, le texte reste à gauche', () => {
  const l = computeBandLayout({ cfg: { logoPos: 'right' }, width: 2000, logoAspect: 1 });
  assert.equal(l.logo.x + l.logo.w, l.W - l.pad);
  assert.equal(l.text.x, l.pad);
  assert.ok(l.text.x + l.text.w < l.logo.x, 'le texte ne chevauche pas le logo');
});

test('le logo est centré verticalement et tient dans la bande', () => {
  const l = computeBandLayout({ cfg: { logoPos: 'left', logoScale: 1 }, width: 2000, logoAspect: 2.5 });
  assert.ok(l.logo.y >= 0);
  assert.ok(l.logo.y + l.logo.h <= l.H);
  assert.equal(l.logo.y, Math.round((l.H - l.logo.h) / 2));
  // Logo large : il reste de la place pour le texte.
  assert.ok(l.text.w > 0);
});

// Le curseur de taille monte au-delà de la hauteur utile pour que le logo
// morde sur les marges : il ne doit jamais dépasser la bande pour autant.
test('à la taille maximale, le logo reste dans la bande', () => {
  assert.equal(normalizeBand({ logoScale: 9 }).logoScale, BAND_LOGO_SCALE_MAX);
  assert.equal(normalizeBand({ logoScale: 0 }).logoScale, BAND_LOGO_SCALE_MIN);
  for (const aspect of [0.2, 0.5, 1, 3, 12]) {
    for (const height of [BAND_HEIGHT_MIN, 0.12, BAND_HEIGHT_MAX]) {
      for (const pos of ['left', 'right']) {
        const cfg = { logoPos: pos, logoScale: BAND_LOGO_SCALE_MAX, height };
        const l = computeBandLayout({ cfg, width: 2000, logoAspect: aspect });
        const where = `aspect ${aspect} hauteur ${height} ${pos}`;
        assert.ok(l.logo.y >= 0 && l.logo.y + l.logo.h <= l.H, where);
        assert.ok(l.logo.x >= 0 && l.logo.x + l.logo.w <= l.W, where);
      }
    }
  }
});

// Un logo panoramique (bandeau de marque très allongé) doit être ramené dans
// la bande, sans écraser le texte ni sortir du cadre.
test('logo panoramique : borné en largeur, proportions gardées', () => {
  const aspect = 12;
  const avecTexte = computeBandLayout({ cfg: { logoPos: 'left', title: 'GARAGE', subtitle: 'Occasions' }, width: 2000, logoAspect: aspect });
  assert.ok(avecTexte.logo.w <= 2000 * 0.45 + 1, 'le logo laisse la place au texte');
  assert.ok(avecTexte.text.w > 0);
  assert.ok(avecTexte.text.x > avecTexte.logo.x + avecTexte.logo.w);
  // Proportions conservées à un pixel d'arrondi près.
  assert.ok(Math.abs(avecTexte.logo.w / avecTexte.logo.h - aspect) < 0.2);

  const seul = computeBandLayout({ cfg: { logoPos: 'left' }, width: 2000, logoAspect: aspect });
  assert.ok(seul.logo.x + seul.logo.w <= seul.W, 'sans texte, le logo reste dans le cadre');
  assert.ok(seul.logo.w > avecTexte.logo.w, 'sans texte, il peut être plus large');
});

test('logoAspect nul → pas de logo, même si une position est demandée', () => {
  const l = computeBandLayout({ cfg: { logoPos: 'left' }, width: 2000, logoAspect: 0 });
  assert.equal(l.logo, null);
  assert.equal(l.text.x, l.pad);
});

test('le titre seul est centré verticalement dans la bande', () => {
  const l = computeBandLayout({ cfg: { title: 'GARAGE X' }, width: 2000 });
  assert.equal(l.title.show, true);
  assert.equal(l.subtitle.show, false);
  assert.ok(Math.abs(l.title.cy - l.H / 2) < 1, 'titre seul → centré');
});

test('titre + sous-titre : bloc empilé, centré, et contenu dans la bande', () => {
  const l = computeBandLayout({ cfg: { title: 'GARAGE X', subtitle: '06 12 34 56 78' }, width: 2000 });
  assert.equal(l.subtitle.show, true);
  assert.ok(l.title.cy < l.subtitle.cy, 'le sous-titre est sous le titre');
  // Le bloc reste dans la bande, marges comprises.
  assert.ok(l.title.cy - l.title.size / 2 >= 0);
  assert.ok(l.subtitle.cy + l.subtitle.size / 2 <= l.H);
  // Et il est centré : autant d'espace au-dessus qu'en dessous.
  const top = l.title.cy - l.title.size / 2;
  const bottom = l.H - (l.subtitle.cy + l.subtitle.size / 2);
  assert.ok(Math.abs(top - bottom) < 1);
});

test('le titre est plus gros quand il est seul', () => {
  const seul = computeBandLayout({ cfg: { title: 'GARAGE X' }, width: 2000 });
  const duo  = computeBandLayout({ cfg: { title: 'GARAGE X', subtitle: 'Occasions' }, width: 2000 });
  assert.ok(seul.title.size > duo.title.size);
});

test('une hauteur minuscule ne produit ni dimension nulle ni négative', () => {
  const l = computeBandLayout({ cfg: { height: BAND_HEIGHT_MIN, title: 'X', subtitle: 'y', logoPos: 'left' }, width: 320, logoAspect: 1 });
  assert.ok(l.H >= 1 && l.pad >= 1 && l.inner >= 1);
  assert.ok(l.text.w >= 1);
  assert.ok(l.title.size >= 1 && l.subtitle.size >= 1);
  assert.ok(l.logo.w >= 1 && l.logo.h >= 1);
});
