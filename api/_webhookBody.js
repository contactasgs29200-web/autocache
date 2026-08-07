// api/_webhookBody.js
// Reconstitution des OCTETS EXACTS d'un webhook Stripe.
//
// Stripe signe des octets, pas un objet. Vérifier une signature suppose donc de
// disposer du corps tel qu'il est arrivé, à l'octet près. Or ce projet tourne
// en fonctions Vercel : la plateforme analyse le JSON avant que le code ne
// s'exécute, consomme le flux, et ne laisse qu'un objet. La convention
// `config.api.bodyParser = false` qui désactiverait cela est propre à Next.js
// et n'a aucun effet ici.
//
// Reconstruire du JSON à partir de l'objet analysé est possible, mais l'écriture
// doit être IDENTIQUE à celle émise. Une hypothèse implicite avait été faite
// ici — « Stripe émet du JSON compact » — et elle est fausse : les charges
// utiles de Stripe sont indentées de deux espaces. `JSON.stringify(obj)` produit
// donc des octets systématiquement différents, et la signature ne pouvait pas
// correspondre.
//
// Plutôt que de parier sur une seule écriture, on énumère les formes
// plausibles, de la plus fidèle à la plus reconstruite, et on laisse la
// vérification trancher : la bonne est celle dont la signature correspond. Si
// aucune ne correspond, c'est que le secret est en cause — et non plus le corps.

// Charge utile candidate, par ordre de fidéLité décroissante.
export function candidatesFrom(body, streamBytes) {
  const out = [];
  const push = (raw, origine) => { if (raw?.length) out.push({ raw, origine }); };

  // Formes exactes : les octets n'ont pas été retouchés.
  if (Buffer.isBuffer(body)) push(body, "buffer");
  else if (typeof body === "string") push(Buffer.from(body, "utf8"), "texte");
  push(streamBytes, "flux");

  // Formes reconstruites : l'objet analysé re-sérialisé. L'ordre des clés est
  // préservé par l'analyse JSON, seule l'indentation est à deviner — et Stripe
  // indente de deux espaces.
  if (body && typeof body === "object" && !Buffer.isBuffer(body)) {
    push(Buffer.from(JSON.stringify(body, null, 2), "utf8"), "reconstruit-indente");
    push(Buffer.from(JSON.stringify(body), "utf8"), "reconstruit-compact");
  }

  return out;
}

// Le secret vient d'une variable d'environnement, donc d'un copier-coller. Un
// saut de ligne ou une espace en fin de valeur est invisible dans l'interface
// de Vercel et fait échouer toutes les signatures, avec exactement le même
// message qu'un secret erroné.
export function cleanSecret(value) {
  return typeof value === "string" ? value.trim() : "";
}

// Ce qu'on peut dire d'un secret sans jamais l'écrire dans un journal.
export function secretShape(secret) {
  if (!secret) return "absent";
  if (!secret.startsWith("whsec_")) return `préfixe inattendu (${secret.length} caractères)`;
  return `whsec_… (${secret.length} caractères)`;
}
