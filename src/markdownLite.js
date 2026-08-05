// src/markdownLite.js
// Rendu d'un sous-ensemble de Markdown vers du HTML, sans dépendance.
//
// Pourquoi ne pas stocker directement du HTML pour les CGV : le texte est saisi
// dans un panneau d'administration puis affiché à tous les visiteurs. Accepter
// du HTML, c'est accepter d'exécuter ce qui y sera collé un jour — un script,
// une balise `<iframe>`, un `onerror=`. Le Markdown supprime la question à la
// racine : TOUT est échappé d'abord, et seules les balises produites ici
// existent dans la sortie. Il n'y a aucun chemin par lequel le texte saisi
// devienne du balisage.
//
// Sous-ensemble volontairement étroit, mais suffisant pour un document
// juridique : titres, paragraphes, listes, tableaux, gras, italique, liens,
// filets de séparation.

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(text) {
  return String(text ?? "").replace(/[&<>"']/g, c => ESCAPES[c]);
}

// Schémas autorisés dans un lien. `javascript:` n'y est évidemment pas, et la
// liste est fermée (autorisation explicite) plutôt qu'ouverte avec exclusions :
// une liste d'interdits oublie toujours un schéma.
const SCHEMES = /^(https?:\/\/|mailto:|tel:|\/|#)/i;

function safeHref(url) {
  const u = String(url ?? "").trim();
  return SCHEMES.test(u) ? escapeHtml(u) : "";
}

// Mise en forme à l'intérieur d'une ligne. Le texte arrive DÉJÀ échappé.
function inline(escaped) {
  return escaped
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, texte, url) => {
      const href = safeHref(url);
      // Un lien au schéma refusé perd son lien, pas son texte : le document
      // reste lisible, seule la destination douteuse disparaît.
      return href ? `<a href="${href}" rel="noopener noreferrer">${texte}</a>` : texte;
    })
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

function isTableSeparator(line) {
  return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);
}

function tableCells(line) {
  return line.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map(c => c.trim());
}

// Convertit un document Markdown en HTML. Le résultat est sûr à insérer tel
// quel : il ne contient que les balises générées ci-dessous.
export function renderMarkdown(markdown) {
  const lignes = String(markdown ?? "").replace(/\r\n?/g, "\n").split("\n");
  const out = [];

  let paragraphe = [];
  let liste = null;

  const viderParagraphe = () => {
    if (paragraphe.length) {
      out.push(`<p>${inline(escapeHtml(paragraphe.join(" ")))}</p>`);
      paragraphe = [];
    }
  };
  const viderListe = () => {
    if (liste) {
      out.push(`<ul>${liste.map(li => `<li>${inline(escapeHtml(li))}</li>`).join("")}</ul>`);
      liste = null;
    }
  };
  const vider = () => { viderParagraphe(); viderListe(); };

  for (let i = 0; i < lignes.length; i++) {
    const ligne = lignes[i];

    if (!ligne.trim()) { vider(); continue; }

    const titre = /^(#{1,4})\s+(.*)$/.exec(ligne);
    if (titre) {
      vider();
      const niveau = titre[1].length;
      out.push(`<h${niveau}>${inline(escapeHtml(titre[2].trim()))}</h${niveau}>`);
      continue;
    }

    if (/^\s*(---+|___+|\*\*\*+)\s*$/.test(ligne)) {
      vider();
      out.push('<hr class="separator">');
      continue;
    }

    const puce = /^\s*[-*+]\s+(.*)$/.exec(ligne);
    if (puce) {
      viderParagraphe();
      liste = liste ?? [];
      liste.push(puce[1].trim());
      continue;
    }

    // Tableau : une ligne d'en-tête suivie d'une ligne de séparation.
    if (ligne.includes("|") && isTableSeparator(lignes[i + 1] ?? "")) {
      vider();
      const entetes = tableCells(ligne);
      const corps = [];
      i += 2;
      while (i < lignes.length && lignes[i].includes("|") && lignes[i].trim()) {
        corps.push(tableCells(lignes[i]));
        i++;
      }
      i--; // la boucle principale reprend sur la ligne non consommée
      const thead = `<thead><tr>${entetes.map(c => `<th>${inline(escapeHtml(c))}</th>`).join("")}</tr></thead>`;
      const tbody = `<tbody>${corps.map(r => `<tr>${r.map(c => `<td>${inline(escapeHtml(c))}</td>`).join("")}</tr>`).join("")}</tbody>`;
      out.push(`<table>${thead}${tbody}</table>`);
      continue;
    }

    viderListe();
    paragraphe.push(ligne.trim());
  }

  vider();
  return out.join("\n");
}

// Extrait le premier titre de niveau 1, utilisé comme titre par défaut d'une
// version publiée.
export function firstHeading(markdown) {
  const m = /^#\s+(.+)$/m.exec(String(markdown ?? ""));
  return m ? m[1].trim() : "";
}
