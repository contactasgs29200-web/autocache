import { useState, useEffect, useRef, useCallback } from "react";

const STORAGE_KEY = "autocache_game_hiscore";

/* ── Game dimensions ──────────────────────────────────────────────────── */
const ROAD_W = 360;
const ROAD_H = 480;
const CAR_W  = 36;
const CAR_H  = 56;
const LANE_PAD = 18;
const CAR_BOTTOM_MARGIN = 16;

/* ── Difficulty curves ────────────────────────────────────────────────── */
const BASE_SPEED        = 130;   // px/s at t=0
const SPEED_RAMP        = 9;     // +px/s per elapsed second
const MAX_SPEED         = 520;   // hard cap
const BASE_SPAWN_DELAY  = 1.30;  // seconds between obstacle spawns at t=0
const MIN_SPAWN_DELAY   = 0.35;
const SPAWN_RAMP        = 0.018; // delay subtracted per elapsed second
const CAR_HORIZ_SPEED   = 280;   // px/s

/**
 * LoadingGame — small endless-runner shown under the processing spinner.
 *  • Space starts (and restarts after a game over).
 *  • ← / → move the orange car.
 */
export default function LoadingGame() {
  const canvasRef = useRef(null);
  const [phase, setPhase] = useState("idle"); // 'idle' | 'playing' | 'gameover'
  const [score, setScore] = useState(0);
  const [hiScore, setHiScore] = useState(() => {
    try { return Number(localStorage.getItem(STORAGE_KEY)) || 0; }
    catch { return 0; }
  });

  /* Game state kept out of React to avoid re-render thrash inside the loop. */
  const stateRef = useRef({
    car:       { x: ROAD_W / 2 },
    obstacles: [],
    speed:     BASE_SPEED,
    elapsed:   0,
    lastSpawn: 0,
    keys:      { left: false, right: false },
    rafId:     0,
    lastT:     0,
  });

  /* ── Reset for a new round ────────────────────────────────────────────── */
  const resetState = useCallback(() => {
    stateRef.current.car       = { x: ROAD_W / 2 };
    stateRef.current.obstacles = [];
    stateRef.current.speed     = BASE_SPEED;
    stateRef.current.elapsed   = 0;
    stateRef.current.lastSpawn = 0;
    stateRef.current.lastT     = performance.now();
  }, []);

  const startGame = useCallback(() => {
    resetState();
    setScore(0);
    setPhase("playing");
  }, [resetState]);

  /* ── Keyboard ────────────────────────────────────────────────────────── */
  useEffect(() => {
    const handleDown = (e) => {
      if (e.key === " " || e.code === "Space") {
        e.preventDefault();
        if (phase === "idle" || phase === "gameover") startGame();
        return;
      }
      if (e.key === "ArrowLeft")  { e.preventDefault(); stateRef.current.keys.left  = true;  }
      if (e.key === "ArrowRight") { e.preventDefault(); stateRef.current.keys.right = true;  }
    };
    const handleUp = (e) => {
      if (e.key === "ArrowLeft")  stateRef.current.keys.left  = false;
      if (e.key === "ArrowRight") stateRef.current.keys.right = false;
    };
    window.addEventListener("keydown", handleDown);
    window.addEventListener("keyup",   handleUp);
    return () => {
      window.removeEventListener("keydown", handleDown);
      window.removeEventListener("keyup",   handleUp);
    };
  }, [phase, startGame]);

  /* ── Main loop (only runs while playing) ──────────────────────────────── */
  useEffect(() => {
    if (phase !== "playing") return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const s = stateRef.current;

    const step = (t) => {
      const dt = Math.min(0.05, (t - s.lastT) / 1000); // clamp dt to handle tab-blur jumps
      s.lastT = t;
      s.elapsed += dt;
      s.speed = Math.min(MAX_SPEED, BASE_SPEED + SPEED_RAMP * s.elapsed);

      /* Car movement */
      const dir = (s.keys.right ? 1 : 0) - (s.keys.left ? 1 : 0);
      s.car.x += dir * CAR_HORIZ_SPEED * dt;
      s.car.x = Math.max(
        LANE_PAD + CAR_W / 2,
        Math.min(ROAD_W - LANE_PAD - CAR_W / 2, s.car.x)
      );

      /* Spawn obstacles */
      const spawnDelay = Math.max(MIN_SPAWN_DELAY, BASE_SPAWN_DELAY - SPAWN_RAMP * s.elapsed);
      if (s.elapsed - s.lastSpawn >= spawnDelay) {
        const w = 32 + Math.random() * 60;
        const x = LANE_PAD + Math.random() * (ROAD_W - 2 * LANE_PAD - w);
        s.obstacles.push({ x, y: -40, w, h: 26 + Math.random() * 12 });
        s.lastSpawn = s.elapsed;
      }

      /* Move + cull obstacles */
      for (const o of s.obstacles) o.y += s.speed * dt;
      s.obstacles = s.obstacles.filter(o => o.y < ROAD_H + 60);

      /* Collision check */
      const carL = s.car.x - CAR_W / 2;
      const carR = s.car.x + CAR_W / 2;
      const carT = ROAD_H - CAR_BOTTOM_MARGIN - CAR_H;
      const carB = ROAD_H - CAR_BOTTOM_MARGIN;
      let hit = false;
      for (const o of s.obstacles) {
        if (carL < o.x + o.w && carR > o.x && carT < o.y + o.h && carB > o.y) {
          hit = true; break;
        }
      }

      const newScore = Math.floor(s.elapsed * 10);
      setScore(newScore);

      /* ── Render ────────────────────────────────────────────────────── */
      // Road background
      ctx.fillStyle = "#0e0e0e";
      ctx.fillRect(0, 0, ROAD_W, ROAD_H);

      // Side rails (warm grey for AutoCache feel)
      ctx.fillStyle = "#181818";
      ctx.fillRect(0, 0, LANE_PAD - 4, ROAD_H);
      ctx.fillRect(ROAD_W - LANE_PAD + 4, 0, 4, ROAD_H);

      // Scrolling dashed centre line
      const dashH = 30, gap = 16;
      const cycle = dashH + gap;
      const offset = ((s.elapsed * s.speed) % cycle);
      ctx.fillStyle = "#2a2a2a";
      for (let y = -cycle + offset; y < ROAD_H; y += cycle) {
        ctx.fillRect(ROAD_W / 2 - 1, y, 2, dashH);
      }

      // Obstacles
      for (const o of s.obstacles) {
        ctx.fillStyle = "#cccccc";
        ctx.fillRect(o.x, o.y, o.w, o.h);
        ctx.fillStyle = "#666666";
        ctx.fillRect(o.x, o.y, o.w, 3);
      }

      // Car (orange, simple rectangle with two windows)
      const cx = s.car.x - CAR_W / 2;
      const cy = ROAD_H - CAR_BOTTOM_MARGIN - CAR_H;
      ctx.fillStyle = "#f26522";
      ctx.fillRect(cx, cy, CAR_W, CAR_H);
      // Roof shadow
      ctx.fillStyle = "rgba(0,0,0,0.18)";
      ctx.fillRect(cx, cy + CAR_H / 2 - 1, CAR_W, 2);
      // Windshield + rear window
      ctx.fillStyle = "#1a1a1a";
      ctx.fillRect(cx + 5, cy + 8,  CAR_W - 10, 12);
      ctx.fillRect(cx + 5, cy + 36, CAR_W - 10, 10);
      // Headlights
      ctx.fillStyle = "#ffe1a8";
      ctx.fillRect(cx + 4,           cy + 2, 6, 3);
      ctx.fillRect(cx + CAR_W - 10,  cy + 2, 6, 3);

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

  /* ── Render ────────────────────────────────────────────────────────── */
  return (
    <div style={{
      width: ROAD_W, marginTop: 18,
      position: "relative",
      fontFamily: "'JetBrains Mono', monospace",
      userSelect: "none",
    }}>
      {/* Score + record */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "baseline",
        padding: "0 4px", marginBottom: 6,
      }}>
        <div style={{ fontSize: 10, color: "#777", letterSpacing: 2, textTransform: "uppercase" }}>
          Record <span style={{ color: "#aaa" }}>{hiScore}</span>
        </div>
        <div style={{ fontSize: 11, color: "#f26522", letterSpacing: 2, textTransform: "uppercase", fontWeight: 700 }}>
          Score {score}
        </div>
      </div>

      {/* Canvas + overlay states */}
      <div style={{ position: "relative", border: "1px solid #222", borderRadius: 3, overflow: "hidden" }}>
        <canvas
          ref={canvasRef}
          width={ROAD_W} height={ROAD_H}
          style={{ display: "block", background: "#0e0e0e", width: ROAD_W, height: ROAD_H }}
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
          }}>
            <div style={{ fontSize: 12, color: "#f26522", letterSpacing: 3, textTransform: "uppercase", fontWeight: 700 }}>
              Mini-jeu d'esquive
            </div>
            <div style={{ fontSize: 11, color: "#aaa", lineHeight: 1.6 }}>
              Appuie sur <kbd style={kbdStyle}>Espace</kbd> pour démarrer
              <br />
              Utilise <kbd style={kbdStyle}>←</kbd> <kbd style={kbdStyle}>→</kbd> pour esquiver
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
          }}>
            <div style={{ fontSize: 13, color: "#f26522", letterSpacing: 3, textTransform: "uppercase", fontWeight: 700 }}>
              Game Over
            </div>
            <div style={{ fontSize: 22, color: "#ddd5c8", fontWeight: 700, letterSpacing: 1 }}>
              {score}
            </div>
            {score === hiScore && score > 0 && (
              <div style={{ fontSize: 10, color: "#f26522", letterSpacing: 2, textTransform: "uppercase" }}>
                ★ Nouveau record !
              </div>
            )}
            <div style={{ fontSize: 10, color: "#aaa", marginTop: 4 }}>
              <kbd style={kbdStyle}>Espace</kbd> pour rejouer
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const kbdStyle = {
  display: "inline-block",
  background: "#1a1a1a",
  border: "1px solid #2a2a2a",
  borderRadius: 3,
  padding: "1px 6px",
  fontSize: 10,
  color: "#ddd5c8",
  fontFamily: "'JetBrains Mono', monospace",
  margin: "0 2px",
};
