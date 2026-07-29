import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AZIMUTH_SECTORS, BANDS, BAND_LABELS,
  createOrbitTracker, createCoverageMap, guidanceFor, isScanUsable,
  pitchFromBeta, bandFromPitch, sectorFromAngle,
  blurScore, meanLuma, subjectFill, frameQuality,
  frameFileName,
} from "../showroomInteractif.js";

// =============================================================================
//  Showroom interactif — scan guidé du véhicule.
//
//  L'utilisateur fait le tour du véhicule ET balaie de haut en bas. L'app
//  découpe la surface à couvrir en une grille azimut × hauteur (12 secteurs ×
//  3 bandes = 36 cases) et guide le remplissage case par case, comme un
//  enrôlement d'empreinte remplit la surface du doigt : « levez l'appareil »,
//  « continuez d'avancer », « revenez en arrière ».
//
//  Tout est local : le flux caméra est analysé dans un canvas hors écran,
//  aucune image ne quitte l'appareil pendant le scan. Coût marginal nul.
//
//  Deux modes selon l'appareil :
//    - AUTO   : capteurs disponibles → position déduite, déclenchement auto.
//    - MANUEL : pas de capteurs → l'utilisateur désigne lui-même la hauteur
//               visée et déclenche ; la progression azimutale avance d'un
//               secteur à chaque prise.
// =============================================================================

const ANALYSIS_W = 96;
const ANALYSIS_H = 72;
const ANALYSIS_INTERVAL_MS = 200;
const MIN_SHOT_INTERVAL_MS = 600;

const ACCENT = "#f26522";
const RING_RADIUS = { low: 30, mid: 43, high: 56 };

export default function ShowroomCapture({ onDone, onClose }) {
  const videoRef = useRef(null);
  const analysisCanvasRef = useRef(null);
  const captureCanvasRef = useRef(null);
  const streamRef = useRef(null);
  const trackerRef = useRef(createOrbitTracker());
  const coverageRef = useRef(createCoverageMap(AZIMUTH_SECTORS, BANDS));
  const lastShotAtRef = useRef(0);
  const shotsRef = useRef([]);
  const pitchRef = useRef(0);
  const detachRef = useRef(null);

  const [cameraError, setCameraError] = useState(null);
  const [ready, setReady] = useState(false);
  const [manualMode, setManualMode] = useState(false);
  const [tracking, setTracking] = useState(false);
  const [manualBand, setManualBand] = useState("mid");
  const [shots, setShots] = useState([]);
  const [quality, setQuality] = useState({ ok: false, code: "wait", message: "Initialisation…" });
  const [guidance, setGuidance] = useState({ action: "wait", message: "Initialisation…" });
  const [position, setPosition] = useState({ sector: 0, band: "mid" });
  const [coverageTick, setCoverageTick] = useState(0);   // force le rendu de la grille
  const [flash, setFlash] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [finishing, setFinishing] = useState(false);

  const coverage = coverageRef.current;
  const complete = coverage.complete;

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

  // ── Capteurs d'orientation ────────────────────────────────────────────────
  // `alpha`/`webkitCompassHeading` donne le tour autour du véhicule, `beta`
  // la hauteur visée. Sans les deux, le scan guidé n'a pas de position à
  // suivre et bascule en manuel.
  const startTracking = useCallback(async () => {
    setTracking(true);
    let gotEvent = false;

    const handler = (e) => {
      gotEvent = true;
      const heading = typeof e.webkitCompassHeading === "number"
        ? e.webkitCompassHeading
        : (typeof e.alpha === "number" ? 360 - e.alpha : NaN);
      if (Number.isFinite(heading)) trackerRef.current.push(heading);
      if (typeof e.beta === "number") pitchRef.current = pitchFromBeta(e.beta);

      setPosition({
        sector: sectorFromAngle(trackerRef.current.progress, AZIMUTH_SECTORS),
        band: bandFromPitch(pitchRef.current),
      });
    };

    try {
      const DOE = typeof window !== "undefined" ? window.DeviceOrientationEvent : null;
      if (!DOE) { setManualMode(true); return; }
      if (typeof DOE.requestPermission === "function") {
        const res = await DOE.requestPermission();
        if (res !== "granted") { setManualMode(true); return; }
      }
      window.addEventListener("deviceorientation", handler, true);
      detachRef.current = () => window.removeEventListener("deviceorientation", handler, true);
      // Aucun événement en 1,5 s = pas de capteur exploitable (ordinateur de
      // bureau, capteur absent) → mode manuel.
      setTimeout(() => { if (!gotEvent) setManualMode(true); }, 1500);
    } catch {
      setManualMode(true);
    }
  }, []);

  useEffect(() => () => { detachRef.current?.(); }, []);

  // En mode manuel, la hauteur est choisie par l'utilisateur et le secteur
  // avance d'un cran à chaque prise.
  useEffect(() => {
    if (!manualMode) return;
    setPosition({
      sector: shotsRef.current.length % AZIMUTH_SECTORS,
      band: manualBand,
    });
  }, [manualMode, manualBand, shots.length]);

  // ── Prise de vue ──────────────────────────────────────────────────────────
  const takeShot = useCallback(async (sector, band) => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const now = Date.now();
    if (now - lastShotAtRef.current < MIN_SHOT_INTERVAL_MS) return;
    if (coverageRef.current.isCovered(sector, band)) return;
    lastShotAtRef.current = now;

    const canvas = captureCanvasRef.current || document.createElement("canvas");
    captureCanvasRef.current = canvas;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0);
    const blob = await new Promise(res => canvas.toBlob(res, "image/jpeg", 0.92));
    if (!blob) return;

    const index = shotsRef.current.length;
    coverageRef.current.mark(sector, band, index);
    shotsRef.current = [...shotsRef.current, { blob, url: URL.createObjectURL(blob), index, sector, band }];
    setShots(shotsRef.current);
    setCoverageTick(t => t + 1);
    setFlash(true);
    setTimeout(() => setFlash(false), 140);
  }, []);

  // ── Boucle d'analyse + déclenchement ──────────────────────────────────────
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
      const verdict = frameQuality({
        blurVar: blurScore(gray, ANALYSIS_W, ANALYSIS_H),
        fill: subjectFill(gray, ANALYSIS_W, ANALYSIS_H),
        luma: meanLuma(gray),
      });
      setQuality(verdict);

      const sector = manualMode ? shotsRef.current.length % AZIMUTH_SECTORS
        : sectorFromAngle(trackerRef.current.progress, AZIMUTH_SECTORS);
      const band = manualMode ? manualBand : bandFromPitch(pitchRef.current);
      const g = guidanceFor(coverageRef.current, sector, band, trackerRef.current.direction);
      setGuidance(g);

      if (!manualMode && g.action === "capture" && verdict.ok) takeShot(sector, band);
    }, ANALYSIS_INTERVAL_MS);

    return () => clearInterval(id);
  }, [ready, reviewing, manualMode, manualBand, takeShot]);

  // ── Sortie ────────────────────────────────────────────────────────────────
  const undoLast = useCallback(() => {
    const last = shotsRef.current[shotsRef.current.length - 1];
    if (!last) return;
    URL.revokeObjectURL(last.url);
    coverageRef.current.unmarkShot(last.index);
    shotsRef.current = shotsRef.current.slice(0, -1);
    setShots(shotsRef.current);
    setCoverageTick(t => t + 1);
  }, []);

  const finish = useCallback(() => {
    if (finishing) return;
    setFinishing(true);
    // La ligne médiane porte le tour 360° : elle est remise en tête, dans
    // l'ordre des secteurs, pour que la rotation soit continue. Les vues
    // basses et hautes suivent — traitées comme des photos normales, mais
    // hors du carrousel.
    const ring = shotsRef.current.filter(s => s.band === "mid").sort((a, b) => a.sector - b.sector);
    const extras = shotsRef.current.filter(s => s.band !== "mid");
    const files = [
      ...ring.map((s, i) => new File([s.blob], frameFileName(i, ring.length), { type: "image/jpeg" })),
      ...extras.map((s, i) => new File([s.blob], `showroom_detail_${String(i + 1).padStart(2, "0")}.jpg`, { type: "image/jpeg" })),
    ];
    onDone?.(files, { ringCount: ring.length });
  }, [finishing, onDone]);

  useEffect(() => () => { shotsRef.current.forEach(s => URL.revokeObjectURL(s.url)); }, []);

  const started = tracking || manualMode || shots.length > 0;
  const usable = isScanUsable(coverage);
  const grid = coverage.snapshot();

  // ── Écran de revue ────────────────────────────────────────────────────────
  if (reviewing) {
    return (
      <div style={{ position: "fixed", inset: 0, background: "#050505", zIndex: 9500, overflowY: "auto", fontFamily: "var(--font-apple)", padding: 20 }}>
        <div style={{ maxWidth: 520, margin: "0 auto" }}>
          <div style={{ fontSize: 13, letterSpacing: 3, color: ACCENT, textTransform: "uppercase", marginBottom: 6 }}>Scan terminé</div>
          <div style={{ fontSize: 12, color: "var(--c-ddd)", marginBottom: 18, lineHeight: 1.6 }}>
            {shots.length} vues · couverture {Math.round(coverage.ratio * 100)} %
            {!complete && " — les zones manquantes n’empêchent pas le traitement."}
          </div>

          <CoverageGrid grid={grid} position={null} />

          <div style={{ fontSize: 11, color: "var(--c-aaa)", margin: "18px 0", lineHeight: 1.7 }}>
            Ces vues vont être traitées comme des photos normales : détection et
            masquage de la plaque, fond, colorimétrie. Le tour 360° sera
            disponible à l’arrivée, construit à partir des {shots.filter(s => s.band === "mid").length} vues
            de la ligne médiane.
          </div>

          <div style={{ display: "flex", gap: 6, overflowX: "auto", marginBottom: 18, paddingBottom: 2 }}>
            {shots.map(s => (
              <img key={s.index} src={s.url} alt=""
                style={{ height: 54, width: 72, objectFit: "cover", borderRadius: 2, border: "1px solid var(--c-252525)", flexShrink: 0 }} />
            ))}
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setReviewing(false)}
              style={{ flex: "0 0 auto", background: "transparent", border: "1px solid var(--c-2a2a2a)", color: "var(--c-ddd)", padding: "12px 18px", fontSize: 11, letterSpacing: 2, textTransform: "uppercase", borderRadius: 3, cursor: "pointer", fontFamily: "var(--font-apple)" }}>
              Continuer le scan
            </button>
            <button onClick={finish} disabled={finishing}
              style={{ flex: 1, background: "#27ae60", border: "none", color: "#fff", padding: "12px 0", fontSize: 13, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", borderRadius: 3, cursor: finishing ? "default" : "pointer", fontFamily: "var(--font-apple)" }}>
              {finishing ? "Transfert…" : "Traiter ces vues"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Écran de scan ─────────────────────────────────────────────────────────
  return (
    <div style={{ position: "fixed", inset: 0, background: "#050505", zIndex: 9500, display: "flex", flexDirection: "column", fontFamily: "var(--font-apple)" }}>
      <div style={{ position: "relative", flex: 1, overflow: "hidden", background: "#000" }}>
        <video ref={videoRef} playsInline muted autoPlay
          style={{ width: "100%", height: "100%", objectFit: "cover", display: cameraError ? "none" : "block" }} />

        {cameraError && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: 30, textAlign: "center", color: "var(--c-ddd)", fontSize: 13, lineHeight: 1.6 }}>
            {cameraError}
          </div>
        )}

        {flash && <div style={{ position: "absolute", inset: 0, background: "#fff", opacity: 0.5, pointerEvents: "none" }} />}

        {!cameraError && (
          <div style={{ position: "absolute", top: 12, left: "50%", transform: "translateX(-50%)", pointerEvents: "none" }}>
            <CoverageGrid grid={grid} position={started ? position : null} tick={coverageTick} />
          </div>
        )}

        {/* Consigne principale */}
        {!cameraError && started && (
          <div style={{
            position: "absolute", bottom: 14, left: "50%", transform: "translateX(-50%)",
            background: "rgba(0,0,0,0.75)", borderRadius: 4, padding: "10px 20px",
            border: `1px solid ${guidance.action === "capture" && quality.ok ? "#27ae60" : "rgba(255,255,255,0.18)"}`,
            maxWidth: "90%", textAlign: "center",
          }}>
            <div style={{ fontSize: 13, color: guidance.action === "capture" && quality.ok ? "#27ae60" : "#fff", letterSpacing: 1 }}>
              {complete ? "Scan complet ✓" : !quality.ok ? quality.message : guidance.message}
            </div>
            <div style={{ fontSize: 11, color: "var(--c-aaa)", marginTop: 4 }}>
              {coverage.filled} / {coverage.total} zones · {BAND_LABELS[position.band]}
            </div>
          </div>
        )}

        {!cameraError && !started && (
          <div style={{ position: "absolute", bottom: 14, left: "50%", transform: "translateX(-50%)", background: "rgba(0,0,0,0.75)", borderRadius: 4, padding: "10px 20px", maxWidth: "90%", textAlign: "center" }}>
            <div style={{ fontSize: 12, color: "#fff", letterSpacing: 1 }}>
              Placez-vous à ~3 m du véhicule, face à l’avant
            </div>
          </div>
        )}
      </div>

      {/* ── Barre de contrôle ── */}
      <div style={{ background: "var(--c-141414)", borderTop: "1px solid var(--c-2a2a2a)", padding: "12px 16px 16px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <div style={{ fontSize: 12, letterSpacing: 2, color: ACCENT, textTransform: "uppercase" }}>Showroom interactif</div>
          <div style={{ fontSize: 11, color: "var(--c-aaa)" }}>{Math.round(coverage.ratio * 100)} %</div>
        </div>

        <div style={{ height: 3, background: "var(--c-1e1e1e)", borderRadius: 2, marginBottom: 12, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${Math.round(coverage.ratio * 100)}%`, background: ACCENT, transition: "width 0.25s" }} />
        </div>

        {/* Sélecteur de hauteur — mode manuel uniquement */}
        {manualMode && started && (
          <div style={{ display: "flex", gap: 4, marginBottom: 12 }}>
            {BANDS.map(b => (
              <button key={b} onClick={() => setManualBand(b)}
                style={{ flex: 1, background: manualBand === b ? ACCENT : "transparent", border: `1px solid ${manualBand === b ? ACCENT : "var(--c-2a2a2a)"}`, color: manualBand === b ? "#090909" : "var(--c-ddd)", padding: "8px 0", fontSize: 10, letterSpacing: 1, textTransform: "uppercase", borderRadius: 3, cursor: "pointer", fontFamily: "var(--font-apple)" }}>
                {BAND_LABELS[b]}
              </button>
            ))}
          </div>
        )}

        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onClose}
            style={{ flex: "0 0 auto", background: "transparent", border: "1px solid var(--c-2a2a2a)", color: "var(--c-ddd)", padding: "12px 14px", fontSize: 11, letterSpacing: 2, textTransform: "uppercase", borderRadius: 3, cursor: "pointer", fontFamily: "var(--font-apple)" }}>
            Annuler
          </button>

          {shots.length > 0 && (
            <button onClick={undoLast}
              style={{ flex: "0 0 auto", background: "transparent", border: "1px solid var(--c-2a2a2a)", color: "var(--c-ddd)", padding: "12px 14px", fontSize: 11, letterSpacing: 2, textTransform: "uppercase", borderRadius: 3, cursor: "pointer", fontFamily: "var(--font-apple)" }}>
              Reprendre
            </button>
          )}

          {!started && !cameraError ? (
            <button onClick={startTracking}
              style={{ flex: 1, background: ACCENT, border: "none", color: "#090909", padding: "12px 0", fontSize: 13, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", borderRadius: 3, cursor: "pointer", fontFamily: "var(--font-apple)" }}>
              Démarrer le scan
            </button>
          ) : (
            <>
              {!complete && (
                <button onClick={() => takeShot(position.sector, position.band)}
                  disabled={!quality.ok || !!cameraError || coverage.isCovered(position.sector, position.band)}
                  style={{ flex: 1, background: quality.ok && !coverage.isCovered(position.sector, position.band) ? "#fff" : "var(--c-1a1a1a)", border: "none", color: quality.ok && !coverage.isCovered(position.sector, position.band) ? "#090909" : "var(--c-444)", padding: "12px 0", fontSize: 13, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", borderRadius: 3, cursor: "pointer", fontFamily: "var(--font-apple)" }}>
                  {coverage.isCovered(position.sector, position.band) ? "Zone déjà couverte" : "Capturer"}
                </button>
              )}
              {usable && (
                <button onClick={() => setReviewing(true)}
                  style={{ flex: complete ? 1 : "0 0 auto", background: "#27ae60", border: "none", color: "#fff", padding: complete ? "12px 0" : "12px 16px", fontSize: 13, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", borderRadius: 3, cursor: "pointer", fontFamily: "var(--font-apple)" }}>
                  {complete ? `Terminer — ${shots.length} vues` : "Terminer"}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Grille de couverture ─────────────────────────────────────────────────────
// Trois anneaux concentriques (bas de caisse au centre, toit à l'extérieur),
// douze secteurs chacun. La case visée est cerclée de blanc, les cases
// couvertes passent en orange : la progression se lit d'un coup d'œil.
function CoverageGrid({ grid, position, tick }) {
  return (
    <svg viewBox="0 0 130 130" style={{ width: 126, height: 126 }} key={tick}>
      <circle cx="65" cy="65" r="62" fill="rgba(0,0,0,0.4)" />
      {grid.map(row => (
        <g key={row.band}>
          {row.cells.map((filled, s) => {
            const a = (s / row.cells.length) * 2 * Math.PI - Math.PI / 2;
            const r = RING_RADIUS[row.band];
            const cx = 65 + r * Math.cos(a);
            const cy = 65 + r * Math.sin(a);
            const isCurrent = position && position.sector === s && position.band === row.band;
            return (
              <circle key={s} cx={cx} cy={cy} r={isCurrent ? 5 : 3.4}
                fill={filled ? ACCENT : "rgba(255,255,255,0.22)"}
                stroke={isCurrent ? "#fff" : "none"} strokeWidth={isCurrent ? 1.8 : 0} />
            );
          })}
        </g>
      ))}
      <text x="65" y="69" textAnchor="middle" fill="rgba(255,255,255,0.85)" fontSize="11" fontFamily="var(--font-apple)">
        {grid.reduce((n, r) => n + r.cells.filter(Boolean).length, 0)}/{grid.reduce((n, r) => n + r.cells.length, 0)}
      </text>
    </svg>
  );
}
