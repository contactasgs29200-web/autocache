import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  GUIDED_STEPS, BONUS_STEP,
  plateQuadForStep, quadBBox, coverSourceRect,
  nextPendingStepIndex, isTourComplete, orderedShots, tourProgress,
  blurScore, meanLuma, frameAdvice,
} from "../guidedTour.js";

// =============================================================================
//  Parcours photo guidé — prise de vue depuis l'app.
//
//  Quatre photos imposées (3/4 avant gauche, face, 3/4 avant droit, arrière),
//  puis autant de photos bonus que voulu. Sur les quatre imposées, le CACHE
//  PLAQUE est déjà dessiné au milieu du viseur : l'utilisateur cadre son
//  véhicule pour que la plaque tombe dedans, et la photo part avec la position
//  du cache (`plateHint`) — le pipeline sait déjà où chercher.
//
//  Ce qui est capturé est exactement ce qui est visé : la photo est recadrée
//  sur la zone visible du viseur (object-fit: cover), sans quoi le cache ne
//  tomberait pas au même endroit dans le fichier produit.
//
//  Tout reste local : aucun appel réseau pendant la prise de vue.
// =============================================================================

const ACCENT = "#f26522";
const ANALYSIS_W = 96;
const ANALYSIS_H = 72;
const ANALYSIS_INTERVAL_MS = 250;

const BTN = {
  background: "transparent",
  border: "1px solid var(--c-2a2a2a)",
  color: "var(--c-ddd)",
  padding: "12px 14px",
  fontSize: 11,
  letterSpacing: 2,
  textTransform: "uppercase",
  borderRadius: 3,
  cursor: "pointer",
  fontFamily: "var(--font-apple)",
};

export default function GuidedTour({ logoPreview, onDone, onClose }) {
  const videoRef = useRef(null);
  const frameRef = useRef(null);          // conteneur du viseur (zone visible)
  const analysisCanvasRef = useRef(null);
  const captureCanvasRef = useRef(null);
  const streamRef = useRef(null);
  const shotsRef = useRef([]);

  const [cameraError, setCameraError] = useState(null);
  const [ready, setReady] = useState(false);
  const [shots, setShots] = useState([]);
  const [stepIndex, setStepIndex] = useState(0);   // index dans GUIDED_STEPS
  const [bonusMode, setBonusMode] = useState(false);
  const [quality, setQuality] = useState(null);
  const [flash, setFlash] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [frameSize, setFrameSize] = useState({ w: 3, h: 4 });

  const step = bonusMode ? BONUS_STEP : GUIDED_STEPS[stepIndex];
  const progress = tourProgress(shots);
  const complete = isTourComplete(shots);

  // Le gabarit dépend du rapport largeur/hauteur du viseur : sur un écran
  // étroit, une plaque n'occupe pas la même fraction de hauteur que de largeur.
  const aspect = frameSize.w / Math.max(1, frameSize.h);
  const quad = useMemo(
    () => (bonusMode ? null : plateQuadForStep(step.id, aspect)),
    [bonusMode, step.id, aspect],
  );

  // ── Caméra ────────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        setReady(true);
      } catch (e) {
        setCameraError(
          e?.name === "NotAllowedError"
            ? "Accès caméra refusé. Autorisez la caméra dans les réglages du navigateur."
            : "Caméra indisponible sur cet appareil. Importez vos photos depuis la galerie."
        );
      }
    })();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    };
  }, []);

  // Le flux est (re)branché à chaque apparition du viseur, pas seulement à
  // l'obtention de la caméra : l'écran de revue démonte la balise <video>, et
  // sans ce rebranchement le retour au viseur affichait une image noire — donc
  // une photo bonus impossible à prendre.
  useEffect(() => {
    if (reviewing || !streamRef.current) return;
    const video = videoRef.current;
    if (!video) return;
    if (video.srcObject !== streamRef.current) video.srcObject = streamRef.current;
    video.play().catch(() => {});
  }, [reviewing, ready]);

  // Taille du viseur — recalculée à la rotation de l'écran.
  useEffect(() => {
    const measure = () => {
      const el = frameRef.current;
      if (el?.clientWidth && el?.clientHeight) {
        setFrameSize({ w: el.clientWidth, h: el.clientHeight });
      }
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("orientationchange", measure);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("orientationchange", measure);
    };
  }, [reviewing]);

  // ── Contrôle qualité (indicatif, jamais bloquant) ─────────────────────────
  // Un conseil « stabilisez » vaut mieux qu'un déclencheur grisé : sur une
  // photo d'annonce prise à contre-jour, c'est l'utilisateur qui décide.
  useEffect(() => {
    if (!ready || reviewing) return;
    const canvas = analysisCanvasRef.current || document.createElement("canvas");
    analysisCanvasRef.current = canvas;
    canvas.width = ANALYSIS_W;
    canvas.height = ANALYSIS_H;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    const id = setInterval(() => {
      const video = videoRef.current;
      if (!video || !video.videoWidth) return;
      ctx.drawImage(video, 0, 0, ANALYSIS_W, ANALYSIS_H);
      const { data } = ctx.getImageData(0, 0, ANALYSIS_W, ANALYSIS_H);
      const gray = new Float32Array(ANALYSIS_W * ANALYSIS_H);
      for (let i = 0; i < gray.length; i++) {
        gray[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
      }
      setQuality(frameAdvice({
        blurVar: blurScore(gray, ANALYSIS_W, ANALYSIS_H),
        luma: meanLuma(gray),
      }));
    }, ANALYSIS_INTERVAL_MS);

    return () => clearInterval(id);
  }, [ready, reviewing]);

  // ── Prise de vue ──────────────────────────────────────────────────────────
  const takeShot = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || busy) return;
    setBusy(true);
    try {
      const box = frameRef.current;
      const src = coverSourceRect(
        video.videoWidth, video.videoHeight,
        box?.clientWidth ?? 0, box?.clientHeight ?? 0,
      );
      if (!src) return;

      const canvas = captureCanvasRef.current || document.createElement("canvas");
      captureCanvasRef.current = canvas;
      canvas.width = Math.max(1, Math.round(src.sw));
      canvas.height = Math.max(1, Math.round(src.sh));
      canvas.getContext("2d").drawImage(
        video, src.sx, src.sy, src.sw, src.sh, 0, 0, canvas.width, canvas.height,
      );
      const blob = await new Promise(res => canvas.toBlob(res, "image/jpeg", 0.92));
      if (!blob) return;

      const shot = {
        blob,
        url: URL.createObjectURL(blob),
        stepId: step.id,
        // Le cache est dessiné dans le viseur, donc dans la zone capturée :
        // ses coordonnées normalisées valent telles quelles dans la photo.
        plateHint: bonusMode ? null : plateQuadForStep(step.id, canvas.width / canvas.height),
      };

      // Reprendre une étape remplace sa photo au lieu d'en empiler une seconde.
      const previous = bonusMode ? -1 : shotsRef.current.findIndex(s => s.stepId === step.id);
      if (previous >= 0) {
        URL.revokeObjectURL(shotsRef.current[previous].url);
        shotsRef.current = shotsRef.current.map((s, i) => (i === previous ? shot : s));
      } else {
        shotsRef.current = [...shotsRef.current, shot];
      }
      setShots(shotsRef.current);
      setFlash(true);
      setTimeout(() => setFlash(false), 140);

      if (!bonusMode) {
        const next = nextPendingStepIndex(shotsRef.current);
        if (next >= 0) setStepIndex(next);
        else setReviewing(true);      // les 4 imposées sont faites
      }
    } finally {
      setBusy(false);
    }
  }, [busy, bonusMode, step.id]);

  const retakeStep = useCallback((stepId) => {
    const idx = GUIDED_STEPS.findIndex(s => s.id === stepId);
    setReviewing(false);
    if (idx >= 0) { setBonusMode(false); setStepIndex(idx); }
    else setBonusMode(true);
  }, []);

  const dropShot = useCallback((shot) => {
    URL.revokeObjectURL(shot.url);
    shotsRef.current = shotsRef.current.filter(s => s !== shot);
    setShots(shotsRef.current);
  }, []);

  const finish = useCallback(() => {
    if (finishing) return;
    setFinishing(true);
    const items = orderedShots(shotsRef.current).map(({ shot, name, stepId }) => ({
      file: new File([shot.blob], name, { type: "image/jpeg" }),
      plateHint: shot.plateHint ?? null,
      stepId,
    }));
    onDone?.(items);
  }, [finishing, onDone]);

  useEffect(() => () => { shotsRef.current.forEach(s => URL.revokeObjectURL(s.url)); }, []);

  // ── Écran de revue ────────────────────────────────────────────────────────
  if (reviewing) {
    const ordered = orderedShots(shots);
    return (
      <div style={{ position: "fixed", inset: 0, background: "var(--c-121212)", zIndex: 9500, overflowY: "auto", fontFamily: "var(--font-apple)", padding: 20 }}>
        <div style={{ maxWidth: 520, margin: "0 auto" }}>
          <div style={{ fontSize: 13, letterSpacing: 3, color: ACCENT, textTransform: "uppercase", marginBottom: 6 }}>
            Parcours photo guidé
          </div>
          <div style={{ fontSize: 12, color: "var(--c-ddd)", marginBottom: 18, lineHeight: 1.6 }}>
            {progress.done} / {progress.total} vues imposées
            {progress.bonus > 0 && ` · ${progress.bonus} photo${progress.bonus > 1 ? "s" : ""} bonus`}
            {!complete && " — il manque des vues, vous pouvez continuer."}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8, marginBottom: 18 }}>
            {ordered.map(({ shot, stepId }, i) => (
              <div key={i} style={{ position: "relative" }}>
                <img src={shot.url} alt=""
                  style={{ width: "100%", aspectRatio: "4/3", objectFit: "cover", borderRadius: 3, border: "1px solid var(--c-252525)", display: "block" }} />
                <div style={{ position: "absolute", left: 0, bottom: 0, right: 0, background: "rgba(0,0,0,0.6)", color: "#fff", fontSize: 10, letterSpacing: 1, padding: "4px 6px", textTransform: "uppercase", borderRadius: "0 0 3px 3px" }}>
                  {(stepId === BONUS_STEP.id ? BONUS_STEP : GUIDED_STEPS.find(s => s.id === stepId))?.label}
                </div>
                <button onClick={() => (stepId === BONUS_STEP.id ? dropShot(shot) : retakeStep(stepId))}
                  style={{ position: "absolute", top: 4, right: 4, background: "rgba(0,0,0,0.7)", border: "1px solid var(--c-2a2a2a)", color: "#fff", fontSize: 9, letterSpacing: 1, textTransform: "uppercase", padding: "3px 7px", borderRadius: 2, cursor: "pointer", fontFamily: "var(--font-apple)" }}>
                  {stepId === BONUS_STEP.id ? "Supprimer" : "Reprendre"}
                </button>
              </div>
            ))}
          </div>

          <div style={{ fontSize: 11, color: "var(--c-aaa)", marginBottom: 18, lineHeight: 1.7 }}>
            Le cache plaque est déjà positionné sur les vues du parcours : il sera
            posé exactement là où vous avez aligné la plaque. Vous pourrez ensuite
            l’ajuster, en ajouter un autre, ou rogner chaque photo comme
            d’habitude.
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={() => { setReviewing(false); setBonusMode(false); }} style={BTN}>
              {complete ? "Revoir le parcours" : "Continuer le parcours"}
            </button>
            <button onClick={() => { setReviewing(false); setBonusMode(true); }} style={BTN}>
              + Photo bonus
            </button>
            <button onClick={finish} disabled={finishing || !shots.length}
              style={{ flex: 1, minWidth: 150, background: shots.length ? "#27ae60" : "var(--c-1a1a1a)", border: "none", color: shots.length ? "#fff" : "var(--c-444)", padding: "12px 0", fontSize: 13, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", borderRadius: 3, cursor: finishing || !shots.length ? "default" : "pointer", fontFamily: "var(--font-apple)" }}>
              {finishing ? "Transfert…" : `Utiliser ces ${ordered.length} photos`}
            </button>
          </div>

          <button onClick={onClose}
            style={{ ...BTN, width: "100%", marginTop: 10, borderColor: "var(--c-1e1e1e)" }}>
            Annuler le parcours
          </button>
        </div>
      </div>
    );
  }

  // ── Viseur ────────────────────────────────────────────────────────────────
  return (
    <div style={{ position: "fixed", inset: 0, background: "var(--c-121212)", zIndex: 9500, display: "flex", flexDirection: "column", fontFamily: "var(--font-apple)" }}>
      <div ref={frameRef} style={{ position: "relative", flex: 1, overflow: "hidden", background: "#000" }}>
        <video ref={videoRef} playsInline muted autoPlay
          style={{ width: "100%", height: "100%", objectFit: "cover", display: cameraError ? "none" : "block" }} />

        {cameraError && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: 30, textAlign: "center", color: "var(--c-ddd)", fontSize: 13, lineHeight: 1.6 }}>
            {cameraError}
          </div>
        )}

        {flash && <div style={{ position: "absolute", inset: 0, background: "#fff", opacity: 0.5, pointerEvents: "none" }} />}

        <button onClick={onClose} aria-label="Annuler le parcours"
          style={{ position: "absolute", top: 10, left: 10, width: 34, height: 34, borderRadius: "50%", background: "rgba(0,0,0,0.55)", border: "1px solid rgba(255,255,255,0.2)", color: "#fff", fontSize: 16, lineHeight: 1, cursor: "pointer", fontFamily: "var(--font-apple)" }}>
          ×
        </button>

        {/* Gabarit du cache plaque, au milieu du viseur */}
        {!cameraError && quad && (
          <PlateGuide quad={quad} logoPreview={logoPreview} size={frameSize} />
        )}

        {/* Progression des 4 vues imposées */}
        {!cameraError && (
          <div style={{ position: "absolute", top: 12, left: 0, right: 0, display: "flex", justifyContent: "center", gap: 6, pointerEvents: "none" }}>
            {GUIDED_STEPS.map((s, i) => {
              const done = shots.some(sh => sh.stepId === s.id);
              const current = !bonusMode && i === stepIndex;
              return (
                <div key={s.id}
                  style={{ width: 44, height: 4, borderRadius: 2, background: done ? ACCENT : current ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.25)" }} />
              );
            })}
          </div>
        )}

        {/* Consigne */}
        {!cameraError && (
          <div style={{ position: "absolute", bottom: 14, left: "50%", transform: "translateX(-50%)", background: "rgba(0,0,0,0.75)", borderRadius: 4, padding: "10px 20px", border: "1px solid rgba(255,255,255,0.18)", maxWidth: "90%", textAlign: "center" }}>
            <div style={{ fontSize: 13, color: "#fff", letterSpacing: 1 }}>{step.instruction}</div>
            {/* Cette bulle est posée sur l'image de la caméra, pas sur une
                surface de l'app : ses couleurs sont figées claires, une
                variable de thème y virerait au gris sombre en thème JOUR. */}
            <div style={{ fontSize: 11, color: quality ? "#e8a33d" : "rgba(255,255,255,0.72)", marginTop: 4, lineHeight: 1.5 }}>
              {quality ? quality.message : bonusMode ? step.detail : "Cadrez pour que la plaque entre dans le cache"}
            </div>
          </div>
        )}
      </div>

      {/* ── Barre de contrôle ── */}
      <div style={{ background: "var(--c-141414)", borderTop: "1px solid var(--c-2a2a2a)", padding: "12px 16px 16px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <div style={{ fontSize: 12, letterSpacing: 2, color: ACCENT, textTransform: "uppercase" }}>
            {bonusMode ? "Photo bonus" : `Vue ${stepIndex + 1} / ${GUIDED_STEPS.length} — ${step.label}`}
          </div>
          <div style={{ fontSize: 11, color: "var(--c-aaa)" }}>
            {progress.done}/{progress.total}{progress.bonus > 0 ? ` +${progress.bonus}` : ""}
          </div>
        </div>

        {/* Choix direct d'une vue : on peut commencer par celle qu'on veut. */}
        {!bonusMode && (
          <div style={{ display: "flex", gap: 4, marginBottom: 12 }}>
            {GUIDED_STEPS.map((s, i) => {
              const done = shots.some(sh => sh.stepId === s.id);
              const active = i === stepIndex;
              return (
                <button key={s.id} onClick={() => setStepIndex(i)}
                  style={{ flex: 1, background: active ? ACCENT : "transparent", border: `1px solid ${active ? ACCENT : done ? "rgba(242,101,34,0.5)" : "var(--c-2a2a2a)"}`, color: active ? "#090909" : done ? ACCENT : "var(--c-ddd)", padding: "8px 0", fontSize: 9, letterSpacing: 0.5, textTransform: "uppercase", borderRadius: 3, cursor: "pointer", fontFamily: "var(--font-apple)" }}>
                  {done ? "✓ " : ""}{s.label}
                </button>
              );
            })}
          </div>
        )}

        {/* Le déclencheur occupe la largeur : c'est le geste qu'on répète, et
            trois boutons de plus sur la même ligne le réduiraient à rien sur
            un écran de téléphone. « Annuler » vit en haut du viseur. */}
        <div style={{ display: "flex", gap: 8 }}>
          {complete && (
            <button onClick={() => setBonusMode(v => !v)} style={{ ...BTN, flex: "0 0 auto", padding: "12px 12px", fontSize: 10 }}>
              {bonusMode ? "Le tour" : "+ Bonus"}
            </button>
          )}

          <button onClick={takeShot} disabled={!!cameraError || busy || !ready}
            style={{ flex: 1, background: cameraError || !ready ? "var(--c-1a1a1a)" : ACCENT, border: "none", color: cameraError || !ready ? "var(--c-444)" : "#090909", padding: "12px 0", fontSize: 13, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", borderRadius: 3, cursor: cameraError || busy || !ready ? "default" : "pointer", fontFamily: "var(--font-apple)" }}>
            {busy ? "…" : !bonusMode && shots.some(s => s.stepId === step.id) ? "Reprendre" : "Photographier"}
          </button>

          {shots.length > 0 && (
            <button onClick={() => setReviewing(true)}
              style={{ ...BTN, flex: "0 0 auto", background: "#27ae60", border: "none", color: "#fff", fontWeight: 700, fontSize: 11 }}>
              Terminer
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Gabarit du cache plaque ──────────────────────────────────────────────────
// Le cache réel de l'utilisateur (son logo) est affiché dans le quadrilatère,
// pas un rectangle abstrait : ce qu'il voit pendant la visée est ce qui sera
// posé sur la photo. À défaut de logo, un cadre marqué « PLAQUE » suffit.
// Le SVG travaille en PIXELS du viseur (pas en 0–1 étirés) : un viewBox carré
// déformé par `preserveAspectRatio: none` étirerait aussi le texte et les
// traits, et le gabarit ne ressemblerait plus à une plaque.
function PlateGuide({ quad, logoPreview, size }) {
  const W = Math.max(1, size?.w ?? 1), H = Math.max(1, size?.h ?? 1);
  const px = p => ({ x: p.x * W, y: p.y * H });
  const pts = [quad.tl, quad.tr, quad.br, quad.bl].map(px);
  const poly = pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const b = quadBBox(quad);
  const box = { x: b.x1 * W, y: b.y1 * H, w: (b.x2 - b.x1) * W, h: (b.y2 - b.y1) * H };
  const cx = (pts[0].x + pts[2].x) / 2;
  const cy = (pts[0].y + pts[2].y) / 2;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H}
      style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      <defs>
        <clipPath id="plateGuideClip" clipPathUnits="userSpaceOnUse">
          <polygon points={poly} />
        </clipPath>
      </defs>

      {logoPreview ? (
        <g clipPath="url(#plateGuideClip)">
          <image href={logoPreview} preserveAspectRatio="none"
            x={box.x} y={box.y} width={box.w} height={box.h} opacity="0.92" />
        </g>
      ) : (
        <polygon points={poly} fill="rgba(0,0,0,0.55)" />
      )}

      <polygon points={poly} fill="none" stroke={ACCENT} strokeWidth="2" />

      {!logoPreview && (
        <text x={cx} y={cy + box.h * 0.16} textAnchor="middle"
          fill="rgba(255,255,255,0.9)" fontSize={Math.max(9, box.h * 0.42)}
          letterSpacing="2" fontFamily="var(--font-apple)">
          PLAQUE
        </text>
      )}

      {/* Repères de centrage : ils donnent l'axe du véhicule sans masquer le cadre. */}
      <line x1={cx} y1="0" x2={cx} y2={box.y - 14}
        stroke="rgba(255,255,255,0.25)" strokeWidth="1" />
      <line x1={cx} y1={box.y + box.h + 14} x2={cx} y2={H}
        stroke="rgba(255,255,255,0.25)" strokeWidth="1" />
    </svg>
  );
}
