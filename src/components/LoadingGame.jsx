import { useState, useEffect, useRef, useCallback } from "react";

const STORAGE_KEY = "autocache_game_hiscore";

/* ── Game dimensions ──────────────────────────────────────────────────── */
const ROAD_H = 480;
const CAR_W  = 38;
const CAR_H  = 58;
const EDGE   = 18;               // bordure (rail) de chaque côté
const CAR_BOTTOM_MARGIN = 16;

/* ── Lane system — la route démarre à 3 voies puis s'élargit à 5 ─────────
 * Largeur de voie constante + route centrée : quand on passe de 3 à 5 voies,
 * les 3 voies d'origine conservent exactement leur position et deux nouvelles
 * voies apparaissent symétriquement (une à gauche, une à droite). */
const LANE_W      = 72;
const START_LANES = 3;
const MAX_LANES   = 5;
const ROAD_W      = MAX_LANES * LANE_W + 2 * EDGE; // largeur du canvas (5 voies max)
const CENTER_X    = ROAD_W / 2;

/* Centre en X d'une voie donnée pour un nombre de voies courant. */
function laneCenterX(i, laneCount) {
  return CENTER_X + (i - (laneCount - 1) / 2) * LANE_W;
}

/* ── Difficulty curves ────────────────────────────────────────────────── */
const BASE_SPEED        = 130;   // px/s at t=0
const SPEED_RAMP        = 9;     // +px/s per elapsed second
const MAX_SPEED         = 520;
const BASE_SPAWN_DELAY  = 1.30;
const MIN_SPAWN_DELAY   = 0.40;
const SPAWN_RAMP        = 0.018;

/* ── Niveau 2 : débloqué une fois le score de 100 dépassé ─────────────────
 * Deux voies supplémentaires s'ouvrent et le rythme s'accélère légèrement. */
const LEVEL2_SCORE      = 100;   // score à dépasser
const LEVEL2_SPEED_MULT = 1.10;  // un peu plus rapide
const LEVEL2_SPAWN_MULT = 0.82;  // voitures un peu plus fréquentes
const LEVELUP_FLASH_SEC = 1.6;   // durée de la bannière "niveau 2"

/* Snap-to-lane animation speed (lerp factor 0..1 per frame) */
const LANE_SNAP_RATE    = 0.22;
/* Swipe threshold in pixels before a lane change fires */
const SWIPE_THRESHOLD   = 30;

/**
 * LoadingGame — small endless-runner shown under the processing spinner.
 *  • Press Space OR tap the canvas to start.
 *  • Desktop: ← / → arrow keys move one lane.
 *  • Mobile: swipe left / right to move one lane.
 */
export default function LoadingGame({ gated = false }) {
  const canvasRef = useRef(null);
  // 'hidden' : rien n'est affiché sauf une phrase d'invitation (mode `gated`,
  // utilisé sous le spinner de chargement — le jeu ne démarre PAS d'office).
  // 'idle' | 'playing' | 'gameover' : déroulé normal une fois lancé.
  const [phase, setPhase] = useState(gated ? "hidden" : "idle");
  const [score, setScore] = useState(0);
  const [hiScore, setHiScore] = useState(() => {
    try { return Number(localStorage.getItem(STORAGE_KEY)) || 0; }
    catch { return 0; }
  });

  /* Game state kept out of React to avoid re-render thrash inside the loop. */
  const stateRef = useRef({
    lane:      1,                                  // current lane index (target)
    carX:      laneCenterX(1, START_LANES),        // smooth-interpolated x
    obstacles: [],                                 // [{ lane, x, y, w, h, hue }]
    speed:     BASE_SPEED,
    elapsed:   0,
    lastSpawn: 0,
    laneCount: START_LANES,                        // nombre de voies ouvertes
    level:     1,                                  // 1 = 3 voies, 2 = 5 voies
    flash:     0,                                  // secondes restantes de la bannière "niveau 2"
    rafId:     0,
    lastT:     0,
  });

  /* Refs for swipe detection */
  const touchStartXRef = useRef(0);
  const touchSwipedRef = useRef(false);

  /* ── Reset for a new round ────────────────────────────────────────────── */
  const resetState = useCallback(() => {
    stateRef.current.lane      = 1;
    stateRef.current.carX      = laneCenterX(1, START_LANES);
    stateRef.current.obstacles = [];
    stateRef.current.speed     = BASE_SPEED;
    stateRef.current.elapsed   = 0;
    stateRef.current.lastSpawn = 0;
    stateRef.current.laneCount = START_LANES;
    stateRef.current.level     = 1;
    stateRef.current.flash     = 0;
    stateRef.current.lastT     = performance.now();
  }, []);

  const startGame = useCallback(() => {
    resetState();
    setScore(0);
    setPhase("playing");
  }, [resetState]);

  /* ── Lane move ────────────────────────────────────────────────────────── */
  const moveLane = useCallback((dir) => {
    const s = stateRef.current;
    s.lane = Math.max(0, Math.min(s.laneCount - 1, s.lane + dir));
  }, []);

  /* ── Keyboard ────────────────────────────────────────────────────────── */
  useEffect(() => {
    const handleDown = (e) => {
      if (e.key === " " || e.code === "Space") {
        e.preventDefault();
        if (phase === "hidden" || phase === "idle" || phase === "gameover") startGame();
        return;
      }
      if (phase === "playing") {
        if (e.key === "ArrowLeft")  { e.preventDefault(); moveLane(-1); }
        if (e.key === "ArrowRight") { e.preventDefault(); moveLane(+1); }
      }
    };
    window.addEventListener("keydown", handleDown);
    return () => window.removeEventListener("keydown", handleDown);
  }, [phase, startGame, moveLane]);

  /* ── Touch / swipe ────────────────────────────────────────────────────── */
  const onTouchStart = useCallback((e) => {
    if (phase !== "playing") {
      e.preventDefault();
      startGame();
      return;
    }
    if (e.touches.length === 0) return;
    touchStartXRef.current = e.touches[0].clientX;
    touchSwipedRef.current = false;
  }, [phase, startGame]);

  const onTouchMove = useCallback((e) => {
    if (phase !== "playing" || touchSwipedRef.current) return;
    if (e.touches.length === 0) return;
    e.preventDefault();
    const dx = e.touches[0].clientX - touchStartXRef.current;
    if (dx >  SWIPE_THRESHOLD) { moveLane(+1); touchSwipedRef.current = true; }
    if (dx < -SWIPE_THRESHOLD) { moveLane(-1); touchSwipedRef.current = true; }
  }, [phase, moveLane]);

  const onTouchEnd = useCallback(() => {
    touchSwipedRef.current = false;
  }, []);

  /* ── Main loop (only runs while playing) ──────────────────────────────── */
  useEffect(() => {
    if (phase !== "playing") return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const s = stateRef.current;

    const step = (t) => {
      const dt = Math.min(0.05, (t - s.lastT) / 1000);
      s.lastT = t;
      s.elapsed += dt;
      if (s.flash > 0) s.flash = Math.max(0, s.flash - dt);

      const speedMult = s.level >= 2 ? LEVEL2_SPEED_MULT : 1;
      s.speed = Math.min(MAX_SPEED, (BASE_SPEED + SPEED_RAMP * s.elapsed) * speedMult);

      /* Animate car toward its target lane */
      const targetX = laneCenterX(s.lane, s.laneCount);
      s.carX += (targetX - s.carX) * LANE_SNAP_RATE;

      /* Spawn opposing white cars */
      const spawnMult  = s.level >= 2 ? LEVEL2_SPAWN_MULT : 1;
      const spawnDelay = Math.max(MIN_SPAWN_DELAY, (BASE_SPAWN_DELAY - SPAWN_RAMP * s.elapsed) * spawnMult);
      if (s.elapsed - s.lastSpawn >= spawnDelay) {
        const lane = Math.floor(Math.random() * s.laneCount);
        s.obstacles.push({
          lane,
          x: laneCenterX(lane, s.laneCount),
          y: -CAR_H,
          w: CAR_W,
          h: CAR_H,
        });
        s.lastSpawn = s.elapsed;
      }

      /* Move + cull obstacles */
      for (const o of s.obstacles) o.y += s.speed * dt;
      s.obstacles = s.obstacles.filter(o => o.y < ROAD_H + 60);

      /* Collision (AABB) */
      const carL = s.carX - CAR_W / 2;
      const carR = s.carX + CAR_W / 2;
      const carT = ROAD_H - CAR_BOTTOM_MARGIN - CAR_H;
      const carB = ROAD_H - CAR_BOTTOM_MARGIN;
      let hit = false;
      for (const o of s.obstacles) {
        const oL = o.x - o.w / 2, oR = o.x + o.w / 2;
        const oT = o.y,          oB = o.y + o.h;
        if (carL < oR && carR > oL && carT < oB && carB > oT) {
          hit = true; break;
        }
      }

      const newScore = Math.floor(s.elapsed * 10);
      setScore(newScore);

      /* Niveau 2 : dès que le score dépasse 100, deux voies s'ouvrent
       * (une à gauche, une à droite) et le rythme s'accélère un peu. */
      if (s.level < 2 && newScore > LEVEL2_SCORE) {
        s.level     = 2;
        s.laneCount = MAX_LANES;
        s.lane     += 1;            // conserve la position physique (route élargie symétriquement)
        s.flash     = LEVELUP_FLASH_SEC;
      }

      /* Bords de la route courante (centrée, élargie au niveau 2) */
      const roadHalf  = (s.laneCount * LANE_W) / 2;
      const roadLeft  = CENTER_X - roadHalf;
      const roadRight = CENTER_X + roadHalf;

      /* ── Render ────────────────────────────────────────────────────── */
      // Hors-route (sombre) sur tout le canvas
      ctx.fillStyle = "#060606";
      ctx.fillRect(0, 0, ROAD_W, ROAD_H);
      // Chaussée active
      ctx.fillStyle = "#0e0e0e";
      ctx.fillRect(roadLeft, 0, roadRight - roadLeft, ROAD_H);

      // Side rails (bords de la chaussée active)
      ctx.fillStyle = "#181818";
      ctx.fillRect(roadLeft, 0, 4, ROAD_H);
      ctx.fillRect(roadRight - 4, 0, 4, ROAD_H);

      // Scrolling dashed lane lines
      const dashH = 30, gap = 16;
      const cycle = dashH + gap;
      const offset = (s.elapsed * s.speed) % cycle;
      ctx.fillStyle = "#2a2a2a";
      for (let i = 1; i < s.laneCount; i++) {
        const lx = roadLeft + LANE_W * i;
        for (let y = -cycle + offset; y < ROAD_H; y += cycle) {
          ctx.fillRect(lx - 1, y, 2, dashH);
        }
      }

      // Opposing white cars (drawn facing the player)
      for (const o of s.obstacles) {
        drawCar(ctx, o.x - o.w / 2, o.y, o.w, o.h, "#dddddd", true);
      }

      // Player car (orange)
      const cx = s.carX - CAR_W / 2;
      const cy = ROAD_H - CAR_BOTTOM_MARGIN - CAR_H;
      drawCar(ctx, cx, cy, CAR_W, CAR_H, "#f26522", false);

      // Bannière "niveau 2" (fondu sortant)
      if (s.flash > 0) {
        const a = Math.min(1, s.flash / LEVELUP_FLASH_SEC);
        ctx.save();
        ctx.globalAlpha = a;
        ctx.fillStyle = "#f26522";
        ctx.textAlign = "center";
        ctx.font = "700 26px 'Rajdhani', sans-serif";
        ctx.fillText("NIVEAU 2", CENTER_X, ROAD_H / 2 - 8);
        ctx.font = "700 13px 'JetBrains Mono', monospace";
        ctx.fillStyle = "#ddd5c8";
        ctx.fillText("5 VOIES · PLUS RAPIDE", CENTER_X, ROAD_H / 2 + 16);
        ctx.restore();
      }

      if (hit) {
        if (newScore > hiScore) {
          setHiScore(newScore);
          try { localStorage.setItem(STORAGE_KEY, String(newScore)); } catch { /* ignore */ }
        }
        setPhase("gameover");
        return;
      }

      s.rafId = requestAnimationFrame(step);
    };

    s.lastT = performance.now();
    s.rafId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(s.rafId);
  }, [phase, hiScore]);

  /* ── Mode `gated` : tant que le jeu n'a pas été lancé, on n'affiche pas
   *    le plateau — juste une petite phrase d'invitation en bas. ─────────── */
  if (phase === "hidden") {
    return (
      <button
        type="button"
        onClick={startGame}
        style={{
          marginTop: 14,
          background: "none", border: "none", cursor: "pointer",
          fontFamily: "var(--font-apple)",
          fontSize: 11, color: "#888", letterSpacing: 1.5,
          textTransform: "uppercase", lineHeight: 1.6,
          userSelect: "none",
        }}
      >
        Appuie sur la barre <kbd style={kbdStyle}>Espace</kbd> pour lancer le mini-jeu
      </button>
    );
  }

  /* ── Render ────────────────────────────────────────────────────────── */
  return (
    <div style={{
      width: ROAD_W, marginTop: 18,
      position: "relative",
      fontFamily: "var(--font-apple)",
      userSelect: "none",
    }}>
      {/* Score + record */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "baseline",
        padding: "0 4px", marginBottom: 6,
      }}>
        <div style={{ fontSize: 11, color: "#888", letterSpacing: 2, textTransform: "uppercase" }}>
          Record <span style={{ color: "#bbb" }}>{hiScore}</span>
        </div>
        <div style={{ fontSize: 12, color: "#f26522", letterSpacing: 2, textTransform: "uppercase", fontWeight: 700 }}>
          Score {score}
        </div>
      </div>

      {/* Canvas + overlay states */}
      <div
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        style={{ position: "relative", border: "1px solid #222", borderRadius: 3, overflow: "hidden", touchAction: "none" }}
      >
        <canvas
          ref={canvasRef}
          width={ROAD_W} height={ROAD_H}
          style={{ display: "block", background: "#0e0e0e", width: ROAD_W, height: ROAD_H, touchAction: "none" }}
        />

        {phase === "idle" && (
          <div style={{
            position: "absolute", inset: 0,
            display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center",
            gap: 12,
            background: "rgba(10,10,10,0.85)",
            color: "#ddd",
            textAlign: "center",
            padding: 16,
            cursor: "pointer",
          }}>
            <div style={{ fontSize: 13, color: "#f26522", letterSpacing: 3, textTransform: "uppercase", fontWeight: 700 }}>
              Mini-jeu d'esquive
            </div>
            <div style={{ fontSize: 12, color: "#bbb", lineHeight: 1.7 }}>
              <kbd style={kbdStyle}>Espace</kbd> ou <kbd style={kbdStyle}>tap</kbd> pour démarrer
              <br />
              <kbd style={kbdStyle}>←</kbd> <kbd style={kbdStyle}>→</kbd> ou <kbd style={kbdStyle}>swipe</kbd> pour changer de voie
            </div>
          </div>
        )}

        {phase === "gameover" && (
          <div style={{
            position: "absolute", inset: 0,
            display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center",
            gap: 10,
            background: "rgba(10,10,10,0.92)",
            color: "#ddd",
            textAlign: "center",
            padding: 16,
            cursor: "pointer",
          }}>
            <div style={{ fontSize: 14, color: "#f26522", letterSpacing: 3, textTransform: "uppercase", fontWeight: 700 }}>
              Game Over
            </div>
            <div style={{ fontSize: 23, color: "#ddd5c8", fontWeight: 700, letterSpacing: 1 }}>
              {score}
            </div>
            {score === hiScore && score > 0 && (
              <div style={{ fontSize: 11, color: "#f26522", letterSpacing: 2, textTransform: "uppercase" }}>
                ★ Nouveau record !
              </div>
            )}
            <div style={{ fontSize: 11, color: "#bbb", marginTop: 4 }}>
              <kbd style={kbdStyle}>Espace</kbd> ou <kbd style={kbdStyle}>tap</kbd> pour rejouer
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Draw a small car (body + windows + lights) ─────────────────────── */
function drawCar(ctx, x, y, w, h, color, oncoming) {
  // Body
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
  // Subtle roof shadow line in the middle
  ctx.fillStyle = "rgba(0,0,0,0.18)";
  ctx.fillRect(x, y + h / 2 - 1, w, 2);
  // Windshield + rear window
  ctx.fillStyle = "#1a1a1a";
  if (oncoming) {
    // Player-facing car: windshield near the bottom (toward the player)
    ctx.fillRect(x + 5, y + h - 22, w - 10, 12);
    ctx.fillRect(x + 5, y + 4,      w - 10, 10);
  } else {
    // Player car: windshield near the top
    ctx.fillRect(x + 5, y + 8,      w - 10, 12);
    ctx.fillRect(x + 5, y + h - 22, w - 10, 10);
  }
  // Lights at the leading edge
  ctx.fillStyle = "#ffe1a8";
  const ly = oncoming ? y + h - 4 : y + 2;
  ctx.fillRect(x + 4,         ly, 6, 3);
  ctx.fillRect(x + w - 10,    ly, 6, 3);
}

const kbdStyle = {
  display: "inline-block",
  background: "#1a1a1a",
  border: "1px solid #2a2a2a",
  borderRadius: 3,
  padding: "1px 6px",
  fontSize: 11,
  color: "#ddd5c8",
  fontFamily: "var(--font-apple)",
  margin: "0 2px",
};
