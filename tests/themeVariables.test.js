import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Les couleurs de l'interface passent toutes par des variables CSS déclarées
// dans index.html, en deux jeux : thème jour et thème nuit.
//
// Le piège que ce test ferme : une variable qui n'existe pas ne provoque
// AUCUNE erreur. `background: var(--c-0d0d0d)` — nom plausible, jamais
// déclaré — rend simplement la déclaration invalide, et le fond devient
// transparent. Le panneau d'administration s'est retrouvé en production avec
// l'application visible au travers, textes superposés, pour cette seule
// raison. Le symptôme ne désigne pas sa cause : on cherche un z-index, une
// opacité, un empilement, jamais une faute de frappe dans un nom de couleur.
//
// Une variable ne s'invente donc plus sans que ce test le dise.

const RACINE = new URL('..', import.meta.url).pathname;

function fichiersSources(dossier, acc = []) {
  for (const entree of readdirSync(dossier)) {
    const chemin = join(dossier, entree);
    if (statSync(chemin).isDirectory()) fichiersSources(chemin, acc);
    else if (/\.(jsx?|html)$/.test(entree)) acc.push(chemin);
  }
  return acc;
}

const sources = [join(RACINE, 'index.html'), ...fichiersSources(join(RACINE, 'src'))];

// Déclarations : « --nom: valeur ». Usages : « var(--nom) ».
const declarees = new Set();
const utilisees = new Map(); // nom → fichiers

for (const fichier of sources) {
  const texte = readFileSync(fichier, 'utf8');
  for (const [, nom] of texte.matchAll(/(--[\w-]+)\s*:\s*[^;{]/g)) declarees.add(nom);
  for (const [, nom] of texte.matchAll(/var\((--[\w-]+)\)/g)) {
    const court = fichier.slice(RACINE.length);
    if (!utilisees.has(nom)) utilisees.set(nom, new Set());
    utilisees.get(nom).add(court);
  }
}

test('le projet déclare bien des variables de thème', () => {
  // Garde-fou du test lui-même : si l'extraction cassait, il passerait à vide
  // et ne protégerait plus rien.
  assert.ok(declarees.size > 20, `seulement ${declarees.size} variables trouvées`);
  assert.ok(utilisees.size > 10, `seulement ${utilisees.size} variables utilisées`);
});

test('aucune couleur ne référence une variable qui n\'existe pas', () => {
  const inconnues = [...utilisees.entries()]
    .filter(([nom]) => !declarees.has(nom))
    .map(([nom, fichiers]) => `${nom} (${[...fichiers].join(', ')})`);

  assert.deepEqual(
    inconnues, [],
    `Variables CSS jamais déclarées — la règle sera ignorée en silence :\n  ${inconnues.join('\n  ')}\n`
    + `Déclarez-les dans les DEUX thèmes d'index.html, ou reprenez une variable existante.`,
  );
});

test('chaque variable de couleur existe dans les deux thèmes', () => {
  // Une variable déclarée seulement en thème nuit disparaît en thème jour :
  // même effet qu'une variable inexistante, mais pour la moitié des visiteurs
  // seulement — donc plus difficile encore à reproduire.
  const html = readFileSync(join(RACINE, 'index.html'), 'utf8');
  // Uniquement les blocs `:root` qui DÉCLARENT des couleurs. Une règle telle
  // que `html,body{ background:var(--c-1c1c1c) }` mentionne une variable sans
  // en définir aucune : la compter comme un jeu de thème ferait échouer la
  // comparaison sans qu'aucun thème ne soit en cause.
  const blocs = [...html.matchAll(/:root(?:\[[^\]]*\])?\s*\{([^{}]*)\}/g)]
    .map(m => m[1])
    .filter(b => /--c-[\w-]+\s*:/.test(b));
  assert.equal(blocs.length, 2, `${blocs.length} jeu(x) de variables de couleur trouvé(s), 2 attendus (jour et nuit)`);

  const parBloc = blocs.map(b => new Set([...b.matchAll(/(--c-[\w-]+)\s*:/g)].map(m => m[1])));
  const reference = parBloc[0];
  for (let i = 1; i < parBloc.length; i++) {
    const manquantes = [...reference].filter(v => !parBloc[i].has(v));
    const surnumeraires = [...parBloc[i]].filter(v => !reference.has(v));
    assert.deepEqual(
      [...manquantes, ...surnumeraires], [],
      `Jeux de variables désaccordés entre thèmes : ${[...manquantes, ...surnumeraires].join(', ')}`,
    );
  }
});
