// src/components/AdminPanel.jsx
// Panneau d'administration : clients, quotas, sanctions, conditions générales.
//
// Ce composant n'autorise rien. Il n'est monté que pour l'administrateur, mais
// c'est un confort d'affichage : chaque route qu'il appelle vérifie de son côté
// l'email porté par le jeton de session. Retirer la condition d'affichage ne
// donnerait accès à rien — les réponses seraient des 404.
//
// Deux principes de présentation, tenus partout :
//   - aucune action destructrice sans confirmation explicite ni motif ;
//   - ce qui est affiché est calculé par les MÊMES fonctions que celles qui
//     décomptent et qui refusent (`src/subscriptionQuota.js`,
//     `src/moderation.js`). L'écran ne peut donc pas annoncer un quota que le
//     serveur ne reconnaîtrait pas.

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { formatPhotos, quotaLabel, FORMULE_QUOTA } from "../subscriptionQuota.js";
import { SUSPENSION_PRESETS, REASON_MAX, formatDateFr, formatRemaining } from "../moderation.js";
import {
  CHANGE_KIND_LIST, CHANGE_KINDS, LEGAL_GUARANTEES, suggestedEffectiveDate,
  earliestEffectiveDate, hashContent, SUMMARY_MIN,
} from "../legalTerms.js";
import { BASELINE_MARKDOWN, BASELINE_TITLE, BASELINE_SUMMARY } from "../legalBaseline.js";
import { renderMarkdown } from "../markdownLite.js";

const ORANGE = "#f26522";
const ROUGE = "#c0392b";
const VERT = "#2a9d5c";

const S = {
  label: { fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: "var(--c-888)", fontFamily: "var(--font-apple)" },
  carte: { background: "var(--c-141414)", border: "1px solid var(--c-222)", borderRadius: 4, padding: 14 },
  champ: {
    width: "100%", background: "var(--c-1a1a1a)", border: "1px solid var(--c-2a2a2a)",
    color: "var(--c-ddd5c8)", padding: "9px 11px", borderRadius: 3,
    fontFamily: "var(--font-apple)", fontSize: 13, outline: "none", boxSizing: "border-box",
  },
  bouton: {
    background: "var(--c-1c1c1c)", color: "var(--c-ddd)", border: "1px solid var(--c-333)",
    padding: "8px 13px", borderRadius: 3, cursor: "pointer", fontFamily: "var(--font-apple)",
    fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", minHeight: "unset",
  },
};

const bouton = (extra = {}) => ({ ...S.bouton, ...extra });
const boutonPlein = (couleur, extra = {}) => bouton({ background: couleur, color: "#090909", borderColor: couleur, ...extra });

function dateCourte(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function dateHeure(iso) {
  return iso ? formatDateFr(iso) || "—" : "—";
}

function Pastille({ couleur, children, titre }) {
  return (
    <span title={titre} style={{
      display: "inline-block", padding: "2px 7px", borderRadius: 2, fontSize: 9, fontWeight: 700,
      letterSpacing: 1, textTransform: "uppercase", fontFamily: "var(--font-apple)",
      color: couleur, border: `1px solid ${couleur}`, background: `${couleur}14`, whiteSpace: "nowrap",
    }}>{children}</span>
  );
}

function Chiffre({ valeur, libelle, accent }) {
  return (
    <div style={{ ...S.carte, padding: "12px 14px", minWidth: 0 }}>
      <div style={{ fontSize: 22, fontWeight: 700, color: accent ?? "var(--c-ddd5c8)", fontFamily: "var(--font-apple)", lineHeight: 1.2 }}>{valeur}</div>
      <div style={{ ...S.label, marginTop: 4 }}>{libelle}</div>
    </div>
  );
}

// Barre de consommation. Le dépassement du quota de base par les crédits
// accordés est montré dans une seconde teinte : sans cela, un compte crédité
// afficherait une barre pleine sans qu'on sache d'où vient le supplément.
function Jauge({ used, base, limit }) {
  const total = Math.max(limit, used, 1);
  const partBase = Math.min(used, base) / total * 100;
  const partBonus = Math.max(0, used - base) / total * 100;
  const restant = Math.max(0, limit - used);
  const critique = restant === 0;
  return (
    <div>
      <div style={{ height: 6, background: "var(--c-222)", borderRadius: 3, overflow: "hidden", display: "flex" }}>
        <div style={{ width: `${partBase}%`, background: critique ? ROUGE : ORANGE }} />
        <div style={{ width: `${partBonus}%`, background: VERT }} />
      </div>
      <div style={{ fontSize: 11, color: "var(--c-9a9a9a)", marginTop: 6, fontFamily: "var(--font-apple)" }}>
        {formatPhotos(used)} / {formatPhotos(limit)} photos · <span style={{ color: critique ? ROUGE : "var(--c-ddd)" }}>{formatPhotos(restant)} restantes</span>
        {limit > base && <span style={{ color: VERT }}> · dont {formatPhotos(limit - base)} accordées</span>}
      </div>
    </div>
  );
}

// Histogramme des douze derniers mois. Douze colonnes, pas de bibliothèque :
// l'information tient dans la hauteur relative et le chiffre au survol.
function HistoriqueMensuel({ series }) {
  const max = Math.max(1, ...series.map(m => m.photos));
  const ordre = [...series].reverse(); // du plus ancien au plus récent
  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 72 }}>
        {ordre.map(m => (
          <div key={m.month} title={`${m.month} — ${formatPhotos(m.photos)} photos`}
            style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-end", height: "100%" }}>
            <div style={{
              height: `${Math.max(m.photos > 0 ? 6 : 2, (m.photos / max) * 100)}%`,
              background: m.photos > 0 ? ORANGE : "var(--c-252525)", borderRadius: "2px 2px 0 0",
            }} />
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
        {ordre.map(m => (
          <div key={m.month} style={{ flex: 1, textAlign: "center", fontSize: 8, color: "var(--c-666)", fontFamily: "var(--font-apple)" }}>
            {m.month.slice(5)}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Fiche détaillée d'un compte ───────────────────────────────────────────
function FicheClient({ fiche, onAction, occupe, message }) {
  const [heures, setHeures] = useState(72);
  const [motif, setMotif] = useState("");
  const [credits, setCredits] = useState(100);
  const [compteur, setCompteur] = useState(String(fiche.quota.used));
  const [confirmation, setConfirmation] = useState(null); // "ban" | "lift" | null

  useEffect(() => {
    setCompteur(String(fiche.quota.used));
    setMotif("");
    setConfirmation(null);
  }, [fiche.id, fiche.quota.used]);

  const s = fiche.sanction;
  const sousSanction = s.active;

  const bloc = (titre, contenu, extra = {}) => (
    <div style={{ ...S.carte, ...extra }}>
      <div style={{ ...S.label, marginBottom: 10 }}>{titre}</div>
      {contenu}
    </div>
  );

  const ligne = (k, v) => (
    <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "4px 0", fontSize: 12, fontFamily: "var(--font-apple)" }}>
      <span style={{ color: "var(--c-777)" }}>{k}</span>
      <span style={{ color: "var(--c-ddd5c8)", textAlign: "right", wordBreak: "break-word" }}>{v}</span>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {message && (
        <div style={{
          ...S.carte, borderColor: message.type === "err" ? ROUGE : VERT,
          color: message.type === "err" ? ROUGE : VERT,
          fontSize: 12, fontFamily: "var(--font-apple)",
        }}>{message.text}</div>
      )}

      {sousSanction && (
        <div style={{ ...S.carte, borderColor: ROUGE, background: "rgba(192,57,43,0.08)" }}>
          <div style={{ ...S.label, color: ROUGE, marginBottom: 6 }}>
            {s.type === "ban" ? "Compte banni" : "Accès suspendu"}
          </div>
          <div style={{ fontSize: 12, color: "var(--c-ddd5c8)", fontFamily: "var(--font-apple)", lineHeight: 1.6 }}>
            Motif : {s.reason || "—"}<br />
            Prononcée le {dateHeure(s.at)}{s.by ? ` par ${s.by}` : ""}
            {s.until && <><br />Échéance : {dateHeure(s.until)} (dans {formatRemaining(s.remainingMs)})</>}
          </div>
        </div>
      )}

      {bloc("Identité", <>
        {ligne("Email", fiche.email ?? "—")}
        {ligne("Email vérifié", fiche.emailConfirmed ? "Oui" : "Non")}
        {ligne("Identifiant", <code style={{ fontSize: 10 }}>{fiche.id}</code>)}
        {ligne("Inscription", dateHeure(fiche.createdAt))}
        {ligne("Dernière connexion", dateHeure(fiche.lastSignInAt))}
        {ligne("Méthode", fiche.provider ?? "—")}
      </>)}

      {bloc("Profil", <>
        {ligne("Nom", fiche.profile.fullName ?? "—")}
        {ligne("Téléphone", fiche.profile.phone ?? "—")}
        {ligne("Email d'export", fiche.profile.exportEmail ?? "—")}
        {ligne("Didacticiel vu", fiche.profile.tutorialSeen ? "Oui" : "Non")}
        {ligne("CGV acceptées", fiche.cgv ? `Version ${fiche.cgv.version} · ${dateCourte(fiche.cgv.at)}` : "Aucune version enregistrée")}
      </>)}

      {bloc("Abonnement", <>
        {ligne("Plan", fiche.plan === "trial" ? "Essai gratuit" : "Abonnement")}
        {ligne("Formule", fiche.formule ? quotaLabel(fiche.formule) : "—")}
        {ligne("Origine", fiche.planSource === "admin" ? "Octroi manuel" : fiche.planSource === "promo" ? "Code administrateur" : fiche.planSource === "stripe" ? "Stripe" : "—")}
        {ligne("Client Stripe", fiche.stripeCustomerId ?? "—")}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 12 }}>
          {fiche.plan === "trial" ? (
            Object.keys(FORMULE_QUOTA).map(f => (
              <button key={f} disabled={occupe} style={boutonPlein(ORANGE)}
                onClick={() => onAction("set-plan", { plan: "premium", formule: f })}>
                Ouvrir · {f === "weekly" ? "hebdo" : f === "monthly" ? "mensuel" : "annuel"}
              </button>
            ))
          ) : (<>
            <select value={fiche.formule ?? "monthly"} disabled={occupe}
              onChange={e => onAction("set-plan", { plan: "premium", formule: e.target.value })}
              style={{ ...S.champ, width: "auto", padding: "7px 9px", fontSize: 12 }}>
              {Object.keys(FORMULE_QUOTA).map(f => <option key={f} value={f}>{quotaLabel(f)}</option>)}
            </select>
            <button disabled={occupe} style={bouton({ color: ROUGE, borderColor: "rgba(192,57,43,0.5)" })}
              onClick={() => onAction("set-plan", { plan: "trial" })}>
              Ramener à l'essai
            </button>
          </>)}
        </div>
        {fiche.planSource === "stripe" && (
          <div style={{ fontSize: 10, color: "var(--c-777)", marginTop: 8, fontFamily: "var(--font-apple)", lineHeight: 1.5 }}>
            Cet abonnement vient de Stripe. Le modifier ici ne modifie ni la facturation ni le prélèvement,
            qui restent pilotés par Stripe.
          </div>
        )}
      </>)}

      {bloc("Quota", <>
        <Jauge used={fiche.quota.used} base={fiche.quota.base} limit={fiche.quota.limit} />
        <div style={{ marginTop: 10 }}>
          {ligne("Quota de la formule", `${formatPhotos(fiche.quota.base)} photos`)}
          {ligne("Crédits accordés", `${formatPhotos(fiche.quota.bonus)} photos`)}
          {ligne("Période en cours", fiche.quota.periodStart ? `${dateCourte(fiche.quota.periodStart)} → ${dateCourte(fiche.quota.periodEnd)}` : "—")}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, marginTop: 12 }}>
          <input type="number" value={credits} min={1} onChange={e => setCredits(e.target.value)}
            style={{ ...S.champ, width: 90, padding: "7px 9px", fontSize: 12 }} />
          <button disabled={occupe} style={boutonPlein(VERT)}
            onClick={() => onAction("grant-photos", { photos: Number(credits) })}>
            + Accorder
          </button>
          <button disabled={occupe} style={bouton()}
            onClick={() => onAction("grant-photos", { photos: -Math.abs(Number(credits)) })}>
            − Retirer
          </button>
          {[100, 250, 1000].map(n => (
            <button key={n} disabled={occupe} style={bouton({ padding: "6px 9px" })}
              onClick={() => onAction("grant-photos", { photos: n })}>+{n}</button>
          ))}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, marginTop: 8 }}>
          <input type="number" value={compteur} min={0} onChange={e => setCompteur(e.target.value)}
            style={{ ...S.champ, width: 90, padding: "7px 9px", fontSize: 12 }} />
          <button disabled={occupe} style={bouton()}
            onClick={() => onAction("set-used", { used: Number(compteur) })}>
            Fixer le compteur
          </button>
          <button disabled={occupe} style={bouton()}
            onClick={() => onAction("reset-quota", {})}>
            Réinitialiser la période
          </button>
        </div>
        <div style={{ fontSize: 10, color: "var(--c-777)", marginTop: 8, fontFamily: "var(--font-apple)", lineHeight: 1.5 }}>
          Les crédits accordés s'ajoutent au quota de la formule et ne sont entamés qu'une fois celui-ci
          épuisé. Ils survivent au renouvellement de la période, diminués de ce qui a réellement été consommé.
        </div>
      </>)}

      {bloc("Consommation mensuelle", <>
        <HistoriqueMensuel series={fiche.monthly} />
        <div style={{ marginTop: 10 }}>
          {ligne("Ce mois-ci", `${formatPhotos(fiche.monthly[0]?.photos ?? 0)} photos`)}
          {ligne("Douze derniers mois", `${formatPhotos(fiche.monthly.reduce((s2, m) => s2 + m.photos, 0))} photos`)}
          {ligne("Depuis l'inscription", `${formatPhotos(fiche.photosTotal)} photos`)}
        </div>
        {fiche.photosTotal === 0 && (
          <div style={{ fontSize: 10, color: "var(--c-777)", marginTop: 8, fontFamily: "var(--font-apple)", lineHeight: 1.5 }}>
            L'historique se remplit à partir des traitements enregistrés depuis la mise en service de cette page.
            Un compte ancien peut donc afficher zéro tout en ayant consommé son quota.
          </div>
        )}
      </>)}

      {/* ── Sanctions ── */}
      {bloc(sousSanction ? "Lever la sanction" : "Suspendre ou bannir", <>
        {fiche.isAdmin ? (
          <div style={{ fontSize: 12, color: "var(--c-9a9a9a)", fontFamily: "var(--font-apple)" }}>
            Ce compte est administrateur : il ne peut pas être sanctionné depuis le panneau.
          </div>
        ) : sousSanction ? (
          <>
            <textarea value={motif} onChange={e => setMotif(e.target.value)} rows={2}
              placeholder="Motif de la levée (facultatif, conservé dans l'historique)"
              style={{ ...S.champ, resize: "vertical" }} />
            <button disabled={occupe} style={{ ...boutonPlein(VERT), marginTop: 8 }}
              onClick={() => onAction("lift", { reason: motif })}>
              Rétablir l'accès
            </button>
          </>
        ) : (
          <>
            <textarea value={motif} onChange={e => setMotif(e.target.value)} rows={2} maxLength={REASON_MAX}
              placeholder="Motif — obligatoire, il est affiché à l'utilisateur"
              style={{ ...S.champ, resize: "vertical" }} />
            <div style={{ ...S.label, margin: "12px 0 6px" }}>Durée de la suspension</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {SUSPENSION_PRESETS.map(p => (
                <button key={p.hours} onClick={() => setHeures(p.hours)}
                  style={bouton(heures === p.hours ? { background: ORANGE, color: "#090909", borderColor: ORANGE } : {})}>
                  {p.label}
                </button>
              ))}
              <input type="number" value={heures} min={1} onChange={e => setHeures(Number(e.target.value))}
                title="Durée en heures"
                style={{ ...S.champ, width: 80, padding: "7px 9px", fontSize: 12 }} />
              <span style={{ ...S.label, alignSelf: "center" }}>heures</span>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
              <button disabled={occupe || motif.trim().length < 3} style={boutonPlein(ORANGE)}
                onClick={() => onAction("suspend", { hours: heures, reason: motif })}>
                Suspendre {formatRemaining(heures * 3600000)}
              </button>
              {confirmation === "ban" ? (
                <>
                  <button disabled={occupe} style={boutonPlein(ROUGE, { color: "#fff" })}
                    onClick={() => { setConfirmation(null); onAction("ban", { reason: motif }); }}>
                    Confirmer le bannissement
                  </button>
                  <button style={bouton()} onClick={() => setConfirmation(null)}>Annuler</button>
                </>
              ) : (
                <button disabled={occupe || motif.trim().length < 3} style={bouton({ color: ROUGE, borderColor: "rgba(192,57,43,0.5)" })}
                  onClick={() => setConfirmation("ban")}>
                  Bannir définitivement
                </button>
              )}
            </div>
            <div style={{ fontSize: 10, color: "var(--c-777)", marginTop: 10, fontFamily: "var(--font-apple)", lineHeight: 1.5 }}>
              La sanction révoque les sessions ouvertes et le motif est communiqué à l'utilisateur, comme
              le prévoit l'article 8 des CGV. L'accès au portail de facturation reste ouvert : un compte
              sanctionné doit pouvoir résilier son abonnement.
            </div>
          </>
        )}
      </>)}

      {fiche.sanctionHistory.length > 0 && bloc("Historique des sanctions",
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {fiche.sanctionHistory.map((h, i) => (
            <div key={i} style={{ borderLeft: `2px solid ${h.action === "lift" ? VERT : ROUGE}`, paddingLeft: 10, fontSize: 11, fontFamily: "var(--font-apple)", color: "var(--c-9a9a9a)", lineHeight: 1.6 }}>
              <span style={{ color: "var(--c-ddd5c8)" }}>
                {h.action === "ban" ? "Bannissement" : h.action === "suspension" ? "Suspension" : "Levée"}
              </span> · {dateHeure(h.at)}{h.by ? ` · ${h.by}` : ""}
              {h.until && <> · échéance {dateCourte(h.until)}</>}
              {h.reason && <><br />Motif : {h.reason}</>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Onglet Conditions générales ───────────────────────────────────────────
function OngletCGV({ appeler, occupe }) {
  const [etat, setEtat] = useState(null);        // { versions, inForce, pending, baseline }
  const [erreur, setErreur] = useState("");
  const [message, setMessage] = useState(null);
  const [vue, setVue] = useState("versions");    // "versions" | "editeur" | "acceptations"
  const [apercu, setApercu] = useState(false);

  // Brouillon
  const [titre, setTitre] = useState(BASELINE_TITLE);
  const [nature, setNature] = useState("substantive");
  const [resume, setResume] = useState("");
  const [texte, setTexte] = useState(BASELINE_MARKDOWN);
  const [effet, setEffet] = useState("");
  const [preavis, setPreavis] = useState(CHANGE_KINDS.substantive.notice);
  const [confirme, setConfirme] = useState(false);
  const [acceptations, setAcceptations] = useState(null);

  const charger = useCallback(async () => {
    setErreur("");
    const d = await appeler("/api/admin", { resource: "terms", action: "list" });
    if (d.error && !d.setupRequired) { setErreur(d.error); return; }
    setEtat(d);
    if (d.baseline) {
      setTitre(d.baseline.title);
      setResume(BASELINE_SUMMARY);
      setTexte(d.baseline.body);
    } else if (d.versions?.length) {
      const derniere = d.versions[0];
      const complet = await appeler("/api/admin", { resource: "terms", action: "get", version: derniere.version });
      if (complet?.document) { setTitre(complet.document.title); setTexte(complet.document.body); }
    }
  }, [appeler]);

  useEffect(() => { charger(); }, [charger]);

  // La date proposée suit la nature choisie : trente jours pour une
  // modification substantielle, immédiate pour une correction de forme.
  useEffect(() => {
    const k = CHANGE_KINDS[nature];
    setPreavis(k.notice);
    setEffet(suggestedEffectiveDate(nature).toISOString().slice(0, 10));
  }, [nature]);

  const empreinte = useMemo(() => hashContent(texte.trim()), [texte]);
  const minimum = useMemo(() => earliestEffectiveDate(nature, new Date(), preavis), [nature, preavis]);
  const prochaine = (etat?.versions?.[0]?.version ?? 0) + 1;

  const publier = async () => {
    setMessage(null);
    const d = await appeler("/api/admin", { resource: "terms",
      action: "publish", title: titre, summary: resume, kind: nature,
      body: texte, effectiveAt: effet ? `${effet}T00:00:00.000Z` : undefined, noticeDays: preavis,
    });
    if (d.ok) {
      setMessage({ type: "ok", text: d.message });
      setConfirme(false);
      setResume("");
      setVue("versions");
      charger();
    } else {
      setMessage({ type: "err", text: d.error ?? "Publication refusée." });
    }
  };

  const voirAcceptations = async (version) => {
    const d = await appeler("/api/admin", { resource: "terms", action: "acceptances", version });
    setAcceptations({ version, ...d });
    setVue("acceptations");
  };

  const restaurer = async (version) => {
    const d = await appeler("/api/admin", { resource: "terms", action: "get", version });
    if (d?.document) {
      setTitre(d.document.title);
      setTexte(d.document.body);
      setResume(`Retour au texte de la version ${version} du ${dateCourte(d.document.effective_at)}.`);
      setVue("editeur");
    }
  };

  if (etat?.setupRequired) {
    return (
      <div style={{ ...S.carte, borderColor: ORANGE }}>
        <div style={{ ...S.label, color: ORANGE, marginBottom: 8 }}>Installation requise</div>
        <div style={{ fontSize: 12, color: "var(--c-ddd5c8)", fontFamily: "var(--font-apple)", lineHeight: 1.7 }}>
          La gestion des conditions générales s'appuie sur trois tables — versions, acceptations et journal
          d'audit — qui n'existent pas encore. Ouvrez l'éditeur SQL de votre projet Supabase et exécutez le
          fichier <code style={{ color: ORANGE }}>{etat.migration}</code> présent dans le dépôt, puis rouvrez cette page.
          <br /><br />
          Jusque-là, tout le reste du panneau fonctionne, et la page <code>/cgv.html</code> continue d'afficher
          les conditions actuelles.
        </div>
      </div>
    );
  }

  if (!etat) return <div style={{ ...S.carte, fontSize: 12, color: "var(--c-9a9a9a)" }}>Chargement…</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {[["versions", "Versions"], ["editeur", "Rédiger une version"], ...(acceptations ? [["acceptations", "Acceptations"]] : [])].map(([k, l]) => (
          <button key={k} onClick={() => setVue(k)}
            style={bouton(vue === k ? { background: ORANGE, color: "#090909", borderColor: ORANGE } : {})}>{l}</button>
        ))}
      </div>

      {erreur && <div style={{ ...S.carte, borderColor: ROUGE, color: ROUGE, fontSize: 12 }}>{erreur}</div>}
      {message && (
        <div style={{ ...S.carte, borderColor: message.type === "err" ? ROUGE : VERT, color: message.type === "err" ? ROUGE : VERT, fontSize: 12, fontFamily: "var(--font-apple)" }}>
          {message.text}
        </div>
      )}

      {vue === "versions" && (
        <>
          {etat.versions.length === 0 ? (
            <div style={{ ...S.carte, fontSize: 12, color: "var(--c-9a9a9a)", fontFamily: "var(--font-apple)", lineHeight: 1.7 }}>
              Aucune version publiée. La page <code>/cgv.html</code> affiche actuellement le texte statique du
              site. La première publication reprendra ce texte — préchargé dans l'éditeur — et prendra le relais.
            </div>
          ) : etat.versions.map(v => {
            const enVigueur = etat.inForce?.version === v.version;
            const aVenir = new Date(v.effective_at).getTime() > Date.now();
            const k = CHANGE_KINDS[v.kind] ?? CHANGE_KINDS.substantive;
            return (
              <div key={v.version} style={{ ...S.carte, borderColor: enVigueur ? ORANGE : "var(--c-222)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: "var(--c-ddd5c8)", fontFamily: "var(--font-apple)" }}>Version {v.version}</span>
                  {enVigueur && <Pastille couleur={ORANGE}>En vigueur</Pastille>}
                  {aVenir && <Pastille couleur={VERT} titre="Publiée, applicable à la date d'effet">À venir</Pastille>}
                  {!enVigueur && !aVenir && <Pastille couleur="var(--c-666)">Archivée</Pastille>}
                  <Pastille couleur="var(--c-888)">{k.label}</Pastille>
                </div>
                <div style={{ fontSize: 12, color: "var(--c-9a9a9a)", fontFamily: "var(--font-apple)", lineHeight: 1.7 }}>
                  {v.summary}
                  <br />
                  Publiée le {dateHeure(v.published_at)}{v.published_by ? ` par ${v.published_by}` : ""} ·
                  entrée en vigueur le {dateCourte(v.effective_at)} · préavis {v.notice_days} j ·
                  empreinte <code style={{ fontSize: 10 }}>{v.content_hash}</code>
                </div>
                <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
                  <a href={`/cgv.html?version=${v.version}`} target="_blank" rel="noreferrer" style={{ ...bouton(), textDecoration: "none", display: "inline-block" }}>Lire</a>
                  <button style={bouton()} onClick={() => restaurer(v.version)}>Repartir de ce texte</button>
                  <button style={bouton()} onClick={() => voirAcceptations(v.version)}>Acceptations</button>
                </div>
              </div>
            );
          })}
        </>
      )}

      {vue === "acceptations" && acceptations && (
        <div style={S.carte}>
          <div style={{ ...S.label, marginBottom: 10 }}>
            Acceptations de la version {acceptations.version} — {acceptations.count ?? 0} enregistrées
          </div>
          <div style={{ maxHeight: 320, overflowY: "auto" }}>
            {(acceptations.acceptances ?? []).map(a => (
              <div key={a.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "6px 0", borderBottom: "1px solid var(--c-1a1a1a)", fontSize: 11, fontFamily: "var(--font-apple)" }}>
                <span style={{ color: "var(--c-ddd5c8)" }}>{a.email ?? a.user_id}</span>
                <span style={{ color: "var(--c-777)" }}>{dateHeure(a.accepted_at)}</span>
              </div>
            ))}
            {(acceptations.acceptances ?? []).length === 0 && (
              <div style={{ fontSize: 12, color: "var(--c-9a9a9a)" }}>Aucune acceptation enregistrée pour cette version.</div>
            )}
          </div>
        </div>
      )}

      {vue === "editeur" && (
        <>
          <div style={{ ...S.carte, borderColor: "var(--c-2a2a2a)" }}>
            <div style={{ ...S.label, marginBottom: 10 }}>Nature de la modification</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {CHANGE_KIND_LIST.map(k => (
                <button key={k.key} onClick={() => setNature(k.key)}
                  style={{
                    textAlign: "left", padding: 12, borderRadius: 3, cursor: "pointer",
                    background: nature === k.key ? "rgba(242,101,34,0.08)" : "var(--c-181818)",
                    border: `1px solid ${nature === k.key ? ORANGE : "var(--c-252525)"}`,
                    fontFamily: "var(--font-apple)", minHeight: "unset",
                  }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: nature === k.key ? ORANGE : "var(--c-ddd5c8)", letterSpacing: 1, textTransform: "uppercase" }}>{k.label}</div>
                  <div style={{ fontSize: 11, color: "var(--c-888)", marginTop: 4, lineHeight: 1.5 }}>{k.hint}</div>
                  <div style={{ fontSize: 11, color: "var(--c-9a9a9a)", marginTop: 6, lineHeight: 1.5 }}>{k.consequence}</div>
                </button>
              ))}
            </div>
          </div>

          <div style={S.carte}>
            <div style={{ ...S.label, marginBottom: 6 }}>Titre du document</div>
            <input value={titre} onChange={e => setTitre(e.target.value)} style={S.champ} />

            <div style={{ ...S.label, margin: "14px 0 6px" }}>
              Résumé des modifications — obligatoire, communiqué aux clients ({resume.trim().length}/{SUMMARY_MIN} min)
            </div>
            <textarea value={resume} onChange={e => setResume(e.target.value)} rows={3}
              placeholder="Ce qui change, en clair : « Le tarif mensuel passe de 12,90 € à 14,90 € à compter du… »"
              style={{ ...S.champ, resize: "vertical" }} />

            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 14 }}>
              <div style={{ flex: "1 1 160px" }}>
                <div style={{ ...S.label, marginBottom: 6 }}>Entrée en vigueur</div>
                <input type="date" value={effet} min={minimum.toISOString().slice(0, 10)}
                  onChange={e => setEffet(e.target.value)} style={S.champ} />
              </div>
              <div style={{ flex: "1 1 120px" }}>
                <div style={{ ...S.label, marginBottom: 6 }}>Préavis (jours)</div>
                <input type="number" value={preavis} min={CHANGE_KINDS[nature].notice}
                  onChange={e => setPreavis(Number(e.target.value))} style={S.champ} />
              </div>
            </div>
            <div style={{ fontSize: 10, color: "var(--c-777)", marginTop: 8, fontFamily: "var(--font-apple)", lineHeight: 1.5 }}>
              Au plus tôt le {dateCourte(minimum.toISOString())}. Une date antérieure serait une modification
              rétroactive : elle serait inopposable aux clients déjà abonnés.
            </div>
          </div>

          <div style={S.carte}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, gap: 8, flexWrap: "wrap" }}>
              <div style={S.label}>Texte du document (Markdown)</div>
              <button style={bouton()} onClick={() => setApercu(a => !a)}>{apercu ? "Éditer" : "Aperçu"}</button>
            </div>
            {apercu ? (
              <div className="ac-cgv-apercu"
                style={{ background: "var(--c-0e0e0e)", border: "1px solid var(--c-222)", borderRadius: 3, padding: 16, maxHeight: 460, overflowY: "auto", fontSize: 12, color: "var(--c-bbb)", lineHeight: 1.7 }}
                dangerouslySetInnerHTML={{ __html: renderMarkdown(texte) }} />
            ) : (
              <textarea value={texte} onChange={e => setTexte(e.target.value)} rows={20} spellCheck={false}
                style={{ ...S.champ, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12, lineHeight: 1.6, resize: "vertical" }} />
            )}
            <div style={{ fontSize: 10, color: "var(--c-777)", marginTop: 8, fontFamily: "var(--font-apple)" }}>
              {texte.length} caractères · empreinte <code>{empreinte}</code>
            </div>
          </div>

          <div style={{ ...S.carte, borderColor: "var(--c-2a2a2a)" }}>
            <div style={{ ...S.label, marginBottom: 10 }}>Ce que la publication garantit</div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 11, color: "var(--c-9a9a9a)", fontFamily: "var(--font-apple)", lineHeight: 1.8 }}>
              {LEGAL_GUARANTEES.map((g, i) => <li key={i}>{g}</li>)}
            </ul>
          </div>

          <div style={{ ...S.carte, borderColor: ORANGE }}>
            <div style={{ ...S.label, color: ORANGE, marginBottom: 8 }}>Publication de la version {prochaine}</div>
            <div style={{ fontSize: 12, color: "var(--c-ddd5c8)", fontFamily: "var(--font-apple)", lineHeight: 1.7 }}>
              {CHANGE_KINDS[nature].label} · entrée en vigueur le {dateCourte(effet ? `${effet}T00:00:00Z` : null)} ·
              préavis {preavis} jour{preavis > 1 ? "s" : ""}.
              {CHANGE_KINDS[nature].acceptance
                ? " Les clients en seront informés à leur prochaine visite et leur acceptation sera enregistrée."
                : " Aucune acceptation ne sera demandée : la modification ne touche pas aux obligations des parties."}
            </div>
            <label style={{ display: "flex", alignItems: "flex-start", gap: 8, margin: "12px 0", cursor: "pointer" }}>
              <input type="checkbox" checked={confirme} onChange={e => setConfirme(e.target.checked)} style={{ marginTop: 3 }} />
              <span style={{ fontSize: 11, color: "var(--c-9a9a9a)", fontFamily: "var(--font-apple)", lineHeight: 1.5 }}>
                Je confirme avoir relu le texte, le résumé et la date d'entrée en vigueur. La version publiée
                sera archivée définitivement et ne pourra plus être modifiée.
              </span>
            </label>
            <button disabled={occupe || !confirme || resume.trim().length < SUMMARY_MIN}
              onClick={publier}
              style={boutonPlein(ORANGE, { opacity: (!confirme || resume.trim().length < SUMMARY_MIN) ? 0.45 : 1, padding: "11px 20px" })}>
              Publier la version {prochaine}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ── Panneau ───────────────────────────────────────────────────────────────
export default function AdminPanel({ onClose, authHeaders, isMobile, adminEmail }) {
  const [onglet, setOnglet] = useState("clients");
  const [donnees, setDonnees] = useState(null);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState("");
  const [recherche, setRecherche] = useState("");
  const [filtre, setFiltre] = useState("all");
  const [tri, setTri] = useState("created");
  const [page, setPage] = useState(1);
  const [selection, setSelection] = useState(null);
  const [occupe, setOccupe] = useState(false);
  const [messageFiche, setMessageFiche] = useState(null);

  // Le panneau recouvre l'application : sans ce verrou, faire défiler la fiche
  // d'un client jusqu'en bas continue le geste sur la page qui se trouve
  // derrière, laquelle se retrouve à une position quelconque à la fermeture.
  useEffect(() => {
    const precedent = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = precedent; };
  }, []);

  // Appel générique : jeton de session, JSON, et une erreur toujours
  // exploitable — un `fetch` qui échoue ne doit pas laisser le panneau muet.
  const appeler = useCallback(async (url, corps) => {
    try {
      const r = await fetch(url, { method: "POST", headers: await authHeaders(), body: JSON.stringify(corps) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok && !d.error) d.error = `Erreur ${r.status}.`;
      return d;
    } catch (e) {
      return { error: `Requête impossible : ${e.message}` };
    }
  }, [authHeaders]);

  const charger = useCallback(async () => {
    setChargement(true);
    setErreur("");
    const d = await appeler("/api/admin", { resource: "users", action: "list", search: recherche, filter: filtre, sort: tri, page, perPage: 25 });
    if (d.error) setErreur(d.error); else setDonnees(d);
    setChargement(false);
  }, [appeler, recherche, filtre, tri, page]);

  // La recherche part après une pause de frappe : une requête par caractère
  // parcourrait toute la base à chaque touche.
  useEffect(() => {
    const t = setTimeout(charger, 250);
    return () => clearTimeout(t);
  }, [charger]);

  useEffect(() => { setPage(1); }, [recherche, filtre, tri]);

  const agir = async (action, params) => {
    if (!selection) return;
    setOccupe(true);
    setMessageFiche(null);
    const d = await appeler("/api/admin", { resource: "user-action", action, userId: selection.id, ...params });
    if (d.ok) {
      setSelection(d.user);
      setMessageFiche({ type: "ok", text: d.message });
      // La ligne du tableau est remplacée sur place : recharger la liste
      // entière ferait sauter la position de lecture pour un seul compte.
      setDonnees(prev => prev ? { ...prev, users: prev.users.map(u => u.id === d.user.id ? d.user : u) } : prev);
    } else {
      setMessageFiche({ type: "err", text: d.error ?? "Action refusée." });
    }
    setOccupe(false);
  };

  const stats = donnees?.stats;

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 4000,
      // Fond OPAQUE, et pris dans les variables réellement déclarées par
      // index.html. Une couleur inventée — ce fut « --c-0d0d0d », nom
      // plausible mais jamais déclaré — rend la déclaration invalide : le fond
      // devient transparent et l'application se lit à travers le panneau. Le
      // symptôme ne ressemble pas à sa cause, d'où ce rappel.
      // `tests/themeVariables.test.js` refuse désormais toute variable inconnue.
      background: "var(--c-1c1c1c)",
      display: "flex", flexDirection: "column", overflow: "hidden",
    }}>
      {/* En-tête */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
        padding: isMobile ? "0 12px" : "0 22px", height: 54, borderBottom: "1px solid var(--c-1e1e1e)", flexShrink: 0,
      }}>
        {/* Le titre s'efface sur mobile : les trois commandes doivent tenir en
            entier, un « FERMER » tronqué serait autrement plus gênant qu'un
            titre absent — on sait où l'on se trouve. */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, overflow: "hidden" }}>
          <span style={{ fontSize: isMobile ? 12 : 16, fontWeight: 700, letterSpacing: isMobile ? 1 : 3, textTransform: "uppercase", color: "var(--c-ddd5c8)", fontFamily: "var(--font-apple)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            Administration
          </span>
          {!isMobile && <span style={{ fontSize: 10, color: "var(--c-666)", fontFamily: "var(--font-apple)", overflow: "hidden", textOverflow: "ellipsis" }}>{adminEmail}</span>}
        </div>
        <div style={{ display: "flex", gap: isMobile ? 4 : 6, alignItems: "center", flexShrink: 0 }}>
          {[["clients", "Clients"], ["cgv", "CGV"]].map(([k, l]) => (
            <button key={k} onClick={() => setOnglet(k)}
              style={bouton({ ...(isMobile ? { padding: "8px 9px" } : {}), ...(onglet === k ? { background: ORANGE, color: "#090909", borderColor: ORANGE } : {}) })}>{l}</button>
          ))}
          <button onClick={onClose} style={bouton({ color: "var(--c-9a9a9a)", ...(isMobile ? { padding: "8px 9px" } : {}) })}>Fermer</button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: isMobile ? 12 : 22 }}>
        {onglet === "cgv" ? (
          <div style={{ maxWidth: 860, margin: "0 auto" }}>
            <OngletCGV appeler={appeler} occupe={occupe} />
          </div>
        ) : (
          <div style={{ maxWidth: 1280, margin: "0 auto", display: "flex", flexDirection: "column", gap: 14 }}>
            {/* Chiffres d'ensemble */}
            {stats && (
              <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(${isMobile ? 130 : 150}px, 1fr))`, gap: 10 }}>
                <Chiffre valeur={stats.total} libelle="Comptes inscrits" />
                <Chiffre valeur={stats.paid} libelle="Abonnements actifs" accent={ORANGE} />
                <Chiffre valeur={stats.trial} libelle="En essai gratuit" />
                <Chiffre valeur={stats.newThisMonth} libelle="Inscrits ce mois-ci" />
                <Chiffre valeur={formatPhotos(stats.photosThisMonth)} libelle="Photos ce mois-ci" />
                <Chiffre valeur={stats.sanctioned} libelle="Sous sanction" accent={stats.sanctioned > 0 ? ROUGE : undefined} />
              </div>
            )}
            {stats?.truncated && (
              <div style={{ ...S.carte, borderColor: ORANGE, fontSize: 11, color: "var(--c-9a9a9a)", fontFamily: "var(--font-apple)" }}>
                Plus de 5 000 comptes : la liste est tronquée et les chiffres ci-dessus ne portent que sur les
                comptes chargés. La recherche reste fiable sur cette portion.
              </div>
            )}

            {/* Recherche et filtres */}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <input value={recherche} onChange={e => setRecherche(e.target.value)}
                placeholder="Rechercher un email, un nom, un téléphone, un identifiant…"
                style={{ ...S.champ, flex: "1 1 240px", width: "auto" }} />
              <select value={filtre} onChange={e => setFiltre(e.target.value)} style={{ ...S.champ, width: "auto" }}>
                <option value="all">Tous les comptes</option>
                <option value="paid">Abonnés</option>
                <option value="trial">Essai gratuit</option>
                <option value="sanctioned">Sous sanction</option>
                <option value="unconfirmed">Email non vérifié</option>
              </select>
              <select value={tri} onChange={e => setTri(e.target.value)} style={{ ...S.champ, width: "auto" }}>
                <option value="created">Inscription récente</option>
                <option value="lastSeen">Connexion récente</option>
                <option value="usage">Consommation en cours</option>
                <option value="total">Consommation totale</option>
                <option value="email">Email (A→Z)</option>
              </select>
            </div>

            {erreur && <div style={{ ...S.carte, borderColor: ROUGE, color: ROUGE, fontSize: 12 }}>{erreur}</div>}

            <div style={{ display: "grid", gridTemplateColumns: isMobile || !selection ? "1fr" : "minmax(0, 1fr) minmax(0, 420px)", gap: 14, alignItems: "start" }}>
              {/* Liste */}
              <div style={{ ...S.carte, padding: 0, overflow: "hidden" }}>
                {/* Sur mobile, six colonnes ne tiennent pas dans la largeur : le
                    tableau se coupait au milieu du quota, et l'essentiel — combien
                    de photos restent, depuis quand le compte existe — se trouvait
                    hors écran, derrière un défilement latéral que rien n'annonce.
                    Une fiche par client empile la même information sans jamais
                    déborder. */}
                {isMobile ? (
                  <div>
                    {(donnees?.users ?? []).map(u => (
                      <div key={u.id} onClick={() => { setSelection(u); setMessageFiche(null); }}
                        style={{
                          padding: "12px 14px", cursor: "pointer",
                          borderBottom: "1px solid var(--c-1a1a1a)",
                          background: selection?.id === u.id ? "rgba(242,101,34,0.07)" : "transparent",
                          fontFamily: "var(--font-apple)",
                        }}>
                        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
                          <span style={{ fontSize: 13, color: "var(--c-ddd5c8)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{u.email}</span>
                          <span style={{ fontSize: 11, color: u.plan === "trial" ? "var(--c-9a9a9a)" : ORANGE, whiteSpace: "nowrap", flexShrink: 0 }}>
                            {u.plan === "trial" ? "Essai" : `Abonné · ${u.formule === "weekly" ? "hebdo" : u.formule === "annual" ? "annuel" : "mensuel"}`}
                          </span>
                        </div>
                        <div style={{ fontSize: 11, color: "var(--c-777)", display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", margin: "4px 0 8px" }}>
                          {u.profile.fullName || "—"}
                          {u.sanction.active && <Pastille couleur={ROUGE}>{u.sanction.type === "ban" ? "Banni" : "Suspendu"}</Pastille>}
                          {!u.emailConfirmed && <Pastille couleur="var(--c-888)">Non vérifié</Pastille>}
                          {u.isAdmin && <Pastille couleur={ORANGE}>Admin</Pastille>}
                        </div>
                        <Jauge used={u.quota.used} base={u.quota.base} limit={u.quota.limit} />
                        <div style={{ fontSize: 10, color: "var(--c-777)", marginTop: 6 }}>
                          {formatPhotos(u.monthly[0]?.photos ?? 0)} photo{(u.monthly[0]?.photos ?? 0) > 1 ? "s" : ""} ce mois-ci · inscrit le {dateCourte(u.createdAt)}
                        </div>
                      </div>
                    ))}
                    {!chargement && (donnees?.users ?? []).length === 0 && (
                      <div style={{ padding: 22, textAlign: "center", color: "var(--c-777)", fontSize: 12, fontFamily: "var(--font-apple)" }}>Aucun compte ne correspond.</div>
                    )}
                  </div>
                ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "var(--font-apple)", fontSize: 12 }}>
                    <thead>
                      <tr>
                        {["Client", "Plan", "Quota en cours", "Ce mois", "Inscrit le", ""].map((h, i) => (
                          <th key={i} style={{ ...S.label, textAlign: "left", padding: "10px 12px", borderBottom: "1px solid var(--c-222)", whiteSpace: "nowrap" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(donnees?.users ?? []).map(u => (
                        <tr key={u.id} onClick={() => { setSelection(u); setMessageFiche(null); }}
                          style={{
                            cursor: "pointer", borderBottom: "1px solid var(--c-1a1a1a)",
                            background: selection?.id === u.id ? "rgba(242,101,34,0.07)" : "transparent",
                          }}>
                          <td style={{ padding: "10px 12px", maxWidth: 260 }}>
                            <div style={{ color: "var(--c-ddd5c8)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.email}</div>
                            <div style={{ fontSize: 10, color: "var(--c-777)", display: "flex", gap: 6, alignItems: "center", marginTop: 3, flexWrap: "wrap" }}>
                              {u.profile.fullName || "—"}
                              {u.sanction.active && <Pastille couleur={ROUGE}>{u.sanction.type === "ban" ? "Banni" : "Suspendu"}</Pastille>}
                              {!u.emailConfirmed && <Pastille couleur="var(--c-888)">Non vérifié</Pastille>}
                              {u.isAdmin && <Pastille couleur={ORANGE}>Admin</Pastille>}
                            </div>
                          </td>
                          <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>
                            <span style={{ color: u.plan === "trial" ? "var(--c-9a9a9a)" : ORANGE }}>
                              {u.plan === "trial" ? "Essai" : "Abonné"}
                            </span>
                            {u.formule && <div style={{ fontSize: 10, color: "var(--c-777)" }}>{u.formule === "weekly" ? "hebdo" : u.formule === "monthly" ? "mensuel" : "annuel"}</div>}
                          </td>
                          <td style={{ padding: "10px 12px", minWidth: 130 }}>
                            <Jauge used={u.quota.used} base={u.quota.base} limit={u.quota.limit} />
                          </td>
                          <td style={{ padding: "10px 12px", whiteSpace: "nowrap", color: "var(--c-ddd)" }}>
                            {formatPhotos(u.monthly[0]?.photos ?? 0)}
                          </td>
                          <td style={{ padding: "10px 12px", whiteSpace: "nowrap", color: "var(--c-9a9a9a)" }}>{dateCourte(u.createdAt)}</td>
                          <td style={{ padding: "10px 12px", color: ORANGE, whiteSpace: "nowrap" }}>›</td>
                        </tr>
                      ))}
                      {!chargement && (donnees?.users ?? []).length === 0 && (
                        <tr><td colSpan={6} style={{ padding: 22, textAlign: "center", color: "var(--c-777)" }}>Aucun compte ne correspond.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
                )}

                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "10px 12px", borderTop: "1px solid var(--c-1e1e1e)", flexWrap: "wrap" }}>
                  <span style={{ fontSize: 11, color: "var(--c-777)", fontFamily: "var(--font-apple)" }}>
                    {chargement ? "Chargement…" : `${donnees?.matching ?? 0} compte${(donnees?.matching ?? 0) > 1 ? "s" : ""} · page ${donnees?.page ?? 1}/${donnees?.pages ?? 1}`}
                  </span>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button style={bouton()} disabled={(donnees?.page ?? 1) <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>Précédent</button>
                    <button style={bouton()} disabled={(donnees?.page ?? 1) >= (donnees?.pages ?? 1)} onClick={() => setPage(p => p + 1)}>Suivant</button>
                  </div>
                </div>
              </div>

              {/* Fiche */}
              {selection && (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                    <div style={{ ...S.label, color: ORANGE }}>Fiche client</div>
                    <button style={bouton()} onClick={() => setSelection(null)}>Fermer la fiche</button>
                  </div>
                  <FicheClient fiche={selection} onAction={agir} occupe={occupe} message={messageFiche} />
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
