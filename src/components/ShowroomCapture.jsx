import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_VIEWS,
  createOrbitTracker, shouldCapture, degreesToNext,
  blurScore, meanLuma, subjectFill, frameQuality,
  clampViews, frameFileName, isSpinUsable,
} from "../showroomInteractif.js";

// =============================================================================
//  Showroom interactif — capture guidée « tour du véhicule ».
//
//  L'utilisateur tourne autour de la voiture ; l'anneau de progression indique
//  où il en est et l'app déclenche automatiquement à chaque vue, à condition
//  que la prise passe les contrôles qualité (netteté, cadrage, exposition).
//
//  Tout est local : flux caméra analysé dans un canvas hors écran, aucune image
//  envoyée nulle part pendant la capture. Coût marginal nul.
//
//  Deux modes selon l'appareil :
//    - AUTO   : la boussole est disponible → déclenchement à l'angle voulu.
//    - MANUEL : pas de boussole (ou permission refusée) → l'utilisateur
//               déclenche lui-même, guidé par le compteur de vues.
// =============================================================================

// Résolution de l'analyse qualité. Minuscule volontairement : on cherche un
// ordre de grandeur de netteté, pas un diagnostic — et ça doit tenir 5 fois par
// seconde sur un téléphone d'entrée de gamme.
const ANALYSIS_W = 96;
const ANALYSIS_H = 72;
const ANALYSIS_INTERVAL_MS = 200;

// Délai minimum entre deux déclenchements : évite la rafale si l'utilisateur
// pivote vite ou si la boussole saute.
const MIN_SHOT_INTERVAL_MS = 700;

const ACCENT = "#f26522";

export default function ShowroomCapture({ views = DEFAULT_VIEWS, onDone, onClose }) {
  const total = clampViews(views);

  const videoRef = useRef(null);
  const analysisCanvasRef = useRef(null);
  const captureCanvasRef = useRef(null);
  const streamRef = useRef(null);
  const trackerRef = useRef(createOrbitTracker());
  const lastShotAtRef = useRef(0);
  // Miroir des prises pour les callbacks : le state React n'est pas lisible
  // depuis la boucle d'analyse sans re-souscrire à chaque frame.
  const shotsRef = useRef([]);

  const [cameraError, setCameraError] = useState(null);
  const [ready, setReady] = useState(false);
  const [manualMode, setManualMode] = useState(false);
  const [tracking, setTracking] = useState(false);   // le tour a été démarré
  const [progress, setProgress] = useState(0);        // degrés parcourus
  const [shots, setShots] = useState([]);             // { url, blob, index }
  const [quality, setQuality] = useState({ ok: false, code: "wait", message: "Initialisation…" });
  const [flash, setFlash] = useState(false);
  const [finishing, setFinishing] = useState(false);

  const done = shots.length >= total;

  // ── Caméra ────────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        });
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setReady(true);
      } catch (e) {
        setCameraError(
          e?.name === "NotAllowedError"
            ? "Accès caméra refusé. Autorisez la caméra dans les réglages du navigateur."
            : "Caméra indisponible sur cet appareil."
        );
      }
    })();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    };
  }, []);

  // ── Boussole ──────────────────────────────────────────────────────────────
  // iOS exige une demande de permission déclenchée par un geste utilisateur ;
  // elle est donc câblée sur le bouton « Démarrer le tour » plus bas.
  const attachOrientation = useCallback(() => {
    const handler = (e) => {
      // webkitCompassHeading (iOS) est déjà un cap vrai ; alpha est relatif à
      // l'orientation initiale, ce qui suffit puisqu'on ne mesure que des écarts.
      const heading = typeof e.webkitCompassHeading === "number"
        ? e.webkitCompassHeading
        : (typeof e.alpha === "number" ? 360 - e.alpha : NaN);
      if (!Number.isFinite(heading)) return;
      trackerRef.current.push(heading);
      setProgress(trackerRef.current.progress);
    };
    window.addEventListener("deviceorientation", handler, true);
    return () => window.removeEventListener("deviceorientation", handler, true);
  }, []);

  const [orientationDetach, setOrientationDetach] = useState(null);

  const startOrbitTracking = useCallback(async () => {
    setTracking(true);
    try {
      const DOE = typeof window !== "undefined" ? window.DeviceOrientationEvent : null;
      if (DOE && typeof DOE.requestPermission === "function") {
        const res = await DOE.requestPermission();
        if (res !== "granted") { setManualMode(true); return; }
      } else if (!DOE) {
        setManualMode(true); return;
      }
      const detach = attachOrientation();
      setOrientationDetach(() => detach);
      // Si aucun événement n'arrive en 1,5 s, l'appareil n'a pas de boussole
      // exploitable (ordinateur de bureau, capteur absent) → mode manuel.
      const startedAt = trackerRef.current.progress;
      setTimeout(() => {
        if (trackerRef.current.progress === startedAt && trackerRef.current.travelled === 0) {
          setManualMode(true);
        }
      }, 1500);
    } catch {
      setManualMode(true);
    }
  }, [attachOrientation]);

  useEffect(() => () => { if (orientationDetach) orientationDetach(); }, [orientationDetach]);

  // ── Prise de vue ──────────────────────────────────────────────────────────
  const takeShot = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const now = Date.now();
    if (now - lastShotAtRef.current < MIN_SHOT_INTERVAL_MS) return;
    lastShotAtRef.current = now;

    const canvas = captureCanvasRef.current || document.createElement("canvas");
    captureCanvasRef.current = canvas;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0);

    const blob = await new Promise(res => canvas.toBlob(res, "image/jpeg", 0.92));
    if (!blob) return;

    const index = shotsRef.current.length;
    const shot = { blob, url: URL.createObjectURL(blob), index };
    shotsRef.current = [...shotsRef.current, shot];
    setShots(shotsRef.current);
    setFlash(true);
    setTimeout(() => setFlash(false), 140);
  }, []);

  // ── Boucle d'analyse qualité + déclenchement automatique ──────────────────
  useEffect(() => {
    if (!ready || done) return;
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
      const verdict = frameQuality({
        blurVar: blurScore(gray, ANALYSIS_W, ANALYSIS_H),
        fill: subjectFill(gray, ANALYSIS_W, ANALYSIS_H),
        luma: meanLuma(gray),
      });
      setQuality(verdict);

      // Déclenchement auto : seulement si la boussole pilote le tour ET que la
      // prise est bonne. En mode manuel, l'utilisateur garde la main.
      if (!manualMode && verdict.ok &&
          shouldCapture(trackerRef.current.progress, shotsRef.current.length, total)) {
        takeShot();
      }
    }, ANALYSIS_INTERVAL_MS);

    return () => clearInterval(id);
  }, [ready, done, manualMode, total, takeShot]);

  // ── Sortie ────────────────────────────────────────────────────────────────
  const finish = useCallback(async () => {
    if (finishing) return;
    setFinishing(true);
    const files = shotsRef.current.map((s, i) => new File(
      [s.blob], frameFileName(i, total), { type: "image/jpeg" }
    ));
    onDone?.(files);
  }, [finishing, onDone, total]);

  const undoLast = useCallback(() => {
    const last = shotsRef.current[shotsRef.current.length - 1];
    if (!last) return;
    URL.revokeObjectURL(last.url);
    shotsRef.current = shotsRef.current.slice(0, -1);
    setShots(shotsRef.current);
  }, []);

  // Libère les aperçus si l'utilisateur ferme sans valider.
  useEffect(() => () => { shotsRef.current.forEach(s => URL.revokeObjectURL(s.url)); }, []);

  const pct = Math.min(100, Math.round((shots.length / total) * 100));
  const remaining = manualMode ? null : Math.round(degreesToNext(progress, shots.length, total));
  // « Démarré » dépend du clic, pas du premier mouvement : sinon un utilisateur
  // qui vise mal au départ (aucune prise validée, boussole immobile) reverrait
  // le bouton de démarrage et redemanderait la permission en boucle.
  const started = tracking || manualMode || shots.length > 0;

  return (
    <div style={{
      position: "fixed", inset: 0, background: "#050505", zIndex: 9500,
      display: "flex", flexDirection: "column", fontFamily: "var(--font-apple)",
    }}>
      {/* ── Flux caméra ── */}
      <div style={{ position: "relative", flex: 1, overflow: "hidden", background: "#000" }}>
        <video
          ref={videoRef} playsInline muted autoPlay
          style={{ width: "100%", height: "100%", objectFit: "cover", display: cameraError ? "none" : "block" }}
        />

        {cameraError && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: 30, textAlign: "center", color: "var(--c-ddd)", fontSize: 13, lineHeight: 1.6 }}>
            {cameraError}
          </div>
        )}

        {/* Voile de déclenchement */}
        {flash && <div style={{ position: "absolute", inset: 0, background: "#fff", opacity: 0.5, pointerEvents: "none" }} />}

        {/* ── Anneau de progression ── */}
        {!cameraError && (
          <svg viewBox="0 0 120 120" style={{ position: "absolute", top: 16, left: "50%", transform: "translateX(-50%)", width: 108, height: 108, pointerEvents: "none" }}>
            <circle cx="60" cy="60" r="52" fill="none" stroke="rgba(0,0,0,0.45)" strokeWidth="10" />
            {Array.from({ length: total }, (_, i) => {
              const a = (i / total) * 2 * Math.PI - Math.PI / 2;
              const captured = i < shots.length;
              const isNext = i === shots.length;
              return (
                <circle
                  key={i}
                  cx={60 + 52 * Math.cos(a)} cy={60 + 52 * Math.sin(a)}
                  r={isNext ? 4.5 : 3}
                  fill={captured ? ACCENT : isNext ? "#fff" : "rgba(255,255,255,0.28)"}
                />
              );
            })}
            <text x="60" y="56" textAnchor="middle" fill="#fff" fontSize="20" fontWeight="700" fontFamily="var(--font-apple)">
              {shots.length}
            </text>
            <text x="60" y="72" textAnchor="middle" fill="rgba(255,255,255,0.6)" fontSize="11" fontFamily="var(--font-apple)">
              / {total}
            </text>
          </svg>
        )}

        {/* ── Consigne / verdict qualité ── */}
        {!cameraError && (
          <div style={{
            position: "absolute", bottom: 14, left: "50%", transform: "translateX(-50%)",
            background: "rgba(0,0,0,0.72)", borderRadius: 4, padding: "9px 18px",
            border: `1px solid ${quality.ok ? "#27ae60" : "rgba(255,255,255,0.18)"}`,
            maxWidth: "88%", textAlign: "center",
          }}>
            <div style={{ fontSize: 12, color: quality.ok ? "#27ae60" : "#e8b84b", letterSpacing: 1 }}>
              {done ? "Tour complet ✓" : !started ? "Placez le véhicule dans le cadre" : quality.message}
            </div>
            {!done && started && quality.ok && !manualMode && remaining > 0 && (
              <div style={{ fontSize: 11, color: "var(--c-aaa)", marginTop: 3 }}>
                Continuez d’avancer — encore {remaining}°
              </div>
            )}
            {!done && manualMode && (
              <div style={{ fontSize: 11, color: "var(--c-aaa)", marginTop: 3 }}>
                Mode manuel — avancez d’environ {Math.round(360 / total)}° entre chaque prise
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Barre de contrôle ── */}
      <div style={{ background: "var(--c-141414)", borderTop: "1px solid var(--c-2a2a2a)", padding: "14px 16px 18px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <div style={{ fontSize: 12, letterSpacing: 2, color: ACCENT, textTransform: "uppercase" }}>
            Showroom interactif
          </div>
          <div style={{ fontSize: 11, color: "var(--c-aaa)" }}>{pct} %</div>
        </div>

        <div style={{ height: 3, background: "var(--c-1e1e1e)", borderRadius: 2, marginBottom: 14, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${pct}%`, background: ACCENT, transition: "width 0.25s" }} />
        </div>

        {/* Bande d'aperçus */}
        {shots.length > 0 && (
          <div style={{ display: "flex", gap: 4, overflowX: "auto", marginBottom: 14, paddingBottom: 2 }}>
            {shots.map(s => (
              <img key={s.index} src={s.url} alt=""
                style={{ height: 42, width: 56, objectFit: "cover", borderRadius: 2, border: "1px solid var(--c-252525)", flexShrink: 0 }} />
            ))}
          </div>
        )}

        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onClose}
            style={{ flex: "0 0 auto", background: "transparent", border: "1px solid var(--c-2a2a2a)", color: "var(--c-ddd)", padding: "12px 16px", fontSize: 11, letterSpacing: 2, textTransform: "uppercase", borderRadius: 3, cursor: "pointer", fontFamily: "var(--font-apple)" }}>
            Annuler
          </button>

          {shots.length > 0 && !done && (
            <button onClick={undoLast}
              style={{ flex: "0 0 auto", background: "transparent", border: "1px solid var(--c-2a2a2a)", color: "var(--c-ddd)", padding: "12px 16px", fontSize: 11, letterSpacing: 2, textTransform: "uppercase", borderRadius: 3, cursor: "pointer", fontFamily: "var(--font-apple)" }}>
              Reprendre
            </button>
          )}

          {!started && !cameraError ? (
            <button onClick={startOrbitTracking}
              style={{ flex: 1, background: ACCENT, border: "none", color: "#090909", padding: "12px 0", fontSize: 13, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", borderRadius: 3, cursor: "pointer", fontFamily: "var(--font-apple)" }}>
              Démarrer le tour
            </button>
          ) : (
            <>
              {/* Le tour peut toujours être clos dès qu'il est exploitable :
                  un obstacle (mur, autre véhicule) empêche parfois de boucler
                  les 360°, et rester coincé sans pouvoir valider serait pire
                  qu'un tour de 20 vues. */}
              {!done && (
                <button onClick={takeShot} disabled={!quality.ok || !!cameraError}
                  style={{ flex: 1, background: quality.ok ? "#fff" : "var(--c-1a1a1a)", border: "none", color: quality.ok ? "#090909" : "var(--c-444)", padding: "12px 0", fontSize: 13, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", borderRadius: 3, cursor: quality.ok ? "pointer" : "default", fontFamily: "var(--font-apple)" }}>
                  {manualMode ? "Prendre la vue" : "Déclencher"}
                </button>
              )}
              {isSpinUsable(shots.length, total) && (
                <button onClick={finish} disabled={finishing}
                  style={{ flex: done ? 1 : "0 0 auto", background: "#27ae60", border: "none", color: "#fff", padding: done ? "12px 0" : "12px 18px", fontSize: 13, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", borderRadius: 3, cursor: finishing ? "default" : "pointer", fontFamily: "var(--font-apple)" }}>
                  {finishing ? "Transfert…" : done ? `Utiliser ces ${shots.length} vues` : `Terminer (${shots.length})`}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
