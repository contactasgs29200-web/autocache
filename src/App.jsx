import { useState, useRef, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://vwfqwfmrllnbbxyvhjht.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ3ZnF3Zm1ybGxuYmJ4eXZoamh0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyNjUxMjgsImV4cCI6MjA4OTg0MTEyOH0.0BJUku8o25mEOmpx4rXiPkHLEI-GkxmCGBCRc00M4OA";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

// ── Helper : clip arrondi sur un contexte canvas ─────────────────────────
// radius : 0–50, représente le rayon en % de H (50 = pilule)
function applyRoundedClip(ctx, W, H, radius) {
  const r = Math.min(Math.round(Math.min(radius, 50) / 100 * H), W / 2, H / 2);
  if (r <= 0) return;
  ctx.beginPath();
  ctx.moveTo(r, 0);       ctx.lineTo(W - r, 0);
  ctx.arcTo(W, 0,   W,     r,   r);
  ctx.lineTo(W, H - r);
  ctx.arcTo(W, H,   W - r, H,   r);
  ctx.lineTo(r, H);
  ctx.arcTo(0, H,   0,     H - r, r);
  ctx.lineTo(0, r);
  ctx.arcTo(0, 0,   r,     0,   r);
  ctx.closePath();
  ctx.clip();
}

// ── Cache plaque généré ───────────────────────────────────────────────────
// Génère un canvas 1040×220 (ratio 4.73:1) avec texte, couleurs et coins arrondis.
// radius : 0 = coins droits, 50 = forme de pilule (% de H)
function makeLogoDataURL(text, bg, fg, radius) {
  const W = 1040, H = 220;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d");

  applyRoundedClip(ctx, W, H, radius);

  // Fond principal
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Texte principal (taille auto)
  const txt = (text.trim() || "VOTRE TEXTE").toUpperCase();
  ctx.fillStyle = fg;
  let sz = Math.round(H * 0.52);
  ctx.font = `bold ${sz}px Arial, sans-serif`;
  while (ctx.measureText(txt).width > W * 0.88 && sz > 16) {
    sz -= 2;
    ctx.font = `bold ${sz}px Arial, sans-serif`;
  }
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(txt, W / 2, H / 2);

  return c.toDataURL("image/png");
}

function toBase64(file, maxPx = 1600, quality = 0.92) {
  return new Promise((res, rej) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const w = img.naturalWidth || img.width;
      const h = img.naturalHeight || img.height;
      const scale = Math.min(1, maxPx / Math.max(w, h));
      const c = document.createElement("canvas");
      c.width = Math.round(w * scale);
      c.height = Math.round(h * scale);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      res({ b64: c.toDataURL("image/jpeg", quality).split(",")[1], imgW: c.width, imgH: c.height });
    };
    img.onerror = rej;
    img.src = url;
  });
}

function loadImg(src) {
  return new Promise((res, rej) => {
    const i = new Image();
    i.crossOrigin = "anonymous";
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = src;
  });
}

function lerp(a, b, t) { return a + (b - a) * t; }

function extractJSON(txt) {
  let depth = 0, start = -1;
  for (let i = 0; i < txt.length; i++) {
    if (txt[i] === '{') { if (depth === 0) start = i; depth++; }
    else if (txt[i] === '}') { depth--; if (depth === 0 && start !== -1) return txt.slice(start, i + 1); }
  }
  return null;
}

// Estimate perspective angle from plate's horizontal position in the image.
// Most dealer photos have the car at a 3/4 angle — apply a generous minimum.
// plate center > 0.5 → car faces right (hood right) → near_side = "left"
// plate center < 0.5 → car faces left  (hood left)  → near_side = "right"
// Fallback heuristique : utilisé uniquement si GPT-4o échoue.
// Pas de minimum forcé : plaque centrée → vue de face → 0°.
function estimateAngleFromPosition(plate) {
  const cx = (plate.tl.x + plate.tr.x) / 2;
  const offset = Math.abs(cx - 0.5);
  if (offset < 0.06) return { near_side: "none", angle_deg: 0 }; // vue de face
  const near_side = cx >= 0.5 ? "left" : "right";
  const angle_deg = Math.round(Math.min(35, offset * 70));
  return { near_side, angle_deg };
}

// Build trapezoid corners from PR bounding box + perspective angle.
// Ancrage sur le BAS de la boîte PR (ymax) : le bas de la plaque est fiable.
// Le HAUT de la boîte PR est souvent trop haut (inclut cadre plastique / renfoncement).
// Hauteur théorique 520×110 mm : plus stable que la hauteur détectée.
function buildCorners(plate, near_side, angle_deg) {
  const pw  = plate.tr.x - plate.tl.x;
  const cx  = (plate.tl.x + plate.tr.x) / 2;

  // Hauteur : ratio théorique (520 × 110 mm) — indépendant du bruit PR sur le haut de boîte
  const ph = pw / 4.73;

  // Ancrer sur le BAS de la boîte PR plutôt que le centre
  // → immunise contre l'excès de plastique/cadre inclus AU-DESSUS de la plaque
  const cy = plate.bl.y - ph * 0.5;

  const theta  = angle_deg * Math.PI / 180;
  const PERSP  = 0.40;
  const nearH  = ph * (1 + Math.sin(theta) * PERSP);
  const farH   = ph * (1 - Math.sin(theta) * PERSP);
  const leftH  = near_side === "left"  ? nearH : near_side === "right" ? farH : ph;
  const rightH = near_side === "right" ? nearH : near_side === "left"  ? farH : ph;

  const phDetected = plate.bl.y - plate.tl.y;
  console.log(`%c[AutoCache] near_side=${near_side} angle=${angle_deg}° ph=${ph.toFixed(4)} phDetected=${phDetected.toFixed(4)} cy=${cy.toFixed(4)} yBottom=${plate.bl.y.toFixed(4)}`, "color:orange;font-weight:bold");
  return {
    tl: { x: Math.max(0, cx - pw * 0.5), y: Math.max(0, cy - leftH  * 0.5) },
    tr: { x: Math.min(1, cx + pw * 0.5), y: Math.max(0, cy - rightH * 0.5) },
    br: { x: Math.min(1, cx + pw * 0.5), y: Math.min(1, cy + rightH * 0.5) },
    bl: { x: Math.max(0, cx - pw * 0.5), y: Math.min(1, cy + leftH  * 0.5) },
  };
}

// Perspective-correct rendering via horizontal strip decomposition.
// tl/tr/br/bl are canvas pixel coords of the plate's 4 corners.
function drawPerspective(ctx, img, tl, tr, br, bl) {
  const STEPS = 80;
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  ctx.save();
  for (let i = 0; i < STEPS; i++) {
    const t1 = i / STEPS, t2 = (i + 1) / STEPS, tm = (t1 + t2) / 2;
    const x00 = lerp(tl.x, bl.x, t1), y00 = lerp(tl.y, bl.y, t1);
    const x10 = lerp(tr.x, br.x, t1), y10 = lerp(tr.y, br.y, t1);
    const x01 = lerp(tl.x, bl.x, t2), y01 = lerp(tl.y, bl.y, t2);
    const x11 = lerp(tr.x, br.x, t2), y11 = lerp(tr.y, br.y, t2);
    const mlx = lerp(tl.x, bl.x, tm), mly = lerp(tl.y, bl.y, tm);
    const mrx = lerp(tr.x, br.x, tm), mry = lerp(tr.y, br.y, tm);
    const sym = ih * tm;
    const srcStripH = ih / STEPS;
    const avgDx = ((x01 - x00) + (x11 - x10)) / 2;
    const avgDy = ((y01 - y00) + (y11 - y10)) / 2;
    const a = (mrx - mlx) / iw;
    const b = (mry - mly) / iw;
    const c = avgDx / srcStripH;
    const d = avgDy / srcStripH;
    const e = mlx - c * sym;
    const f = mly - d * sym;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x00, y00); ctx.lineTo(x10, y10);
    ctx.lineTo(x11, y11); ctx.lineTo(x01, y01);
    ctx.closePath();
    ctx.clip();
    ctx.transform(a, b, c, d, e, f);
    ctx.drawImage(img, 0, 0, iw, ih);
    ctx.restore();
  }
  ctx.restore();
}

// ── Correction de balance des blancs ─────────────────────────────────────────
// Simule un éclairage plus blanc/neutre en supprimant la dominante jaune/chaude
// typique des showrooms (LED 3000–4000 K → rendu 5500 K neutre).
// Pas d'auto-niveaux : aucun risque de saturer les hautes lumières.
function autoEnhance(ctx, W, H) {
  const id = ctx.getImageData(0, 0, W, H);
  const d  = id.data;

  // LUT par canal : gamma 0.93 (relève les tons moyens) + correction WB renforcée
  // R : −10 %  (retire plus de rouge chaud)
  // G : −3 %   (quasi-neutre)
  // B : +15 %  (bleu froid plus prononcé → blanc très pur)
  const rLUT = new Uint8Array(256);
  const gLUT = new Uint8Array(256);
  const bLUT = new Uint8Array(256);
  for (let v = 0; v < 256; v++) {
    const g = Math.pow(v / 255, 0.93); // gamma plus marqué (tons moyens plus lumineux)
    rLUT[v] = Math.min(255, Math.round(g * 255 * 0.90));
    gLUT[v] = Math.min(255, Math.round(g * 255 * 0.97));
    bLUT[v] = Math.min(255, Math.round(g * 255 * 1.15));
  }

  // Saturation boost : pousse chaque canal loin de la luminance moyenne
  const SAT = 1.22; // +22 % de saturation
  for (let i = 0; i < d.length; i += 4) {
    const r = rLUT[d[i]];
    const g = gLUT[d[i + 1]];
    const b = bLUT[d[i + 2]];
    const lum = r * 0.299 + g * 0.587 + b * 0.114; // luminance perceptive
    d[i]     = Math.max(0, Math.min(255, Math.round(lum + (r - lum) * SAT)));
    d[i + 1] = Math.max(0, Math.min(255, Math.round(lum + (g - lum) * SAT)));
    d[i + 2] = Math.max(0, Math.min(255, Math.round(lum + (b - lum) * SAT)));
  }
  ctx.putImageData(id, 0, 0);
}

// ── Détection des optiques via GPT-4o ────────────────────────────────────────
async function detectHeadlights(b64) {
  try {
    const r = await fetch("/api/headlights", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ b64 }),
    });
    const data = await r.json();
    console.log("Headlights API response:", data);
    return Array.isArray(data.lights) ? data.lights : [];
  } catch(e) {
    console.error("detectHeadlights error:", e);
    return [];
  }
}

// ── Lustrage des optiques : correction chromatique localisée ─────────────────
// Pour chaque pixel jauni dans la boîte englobante, on calcule sa luminance
// moyenne et on ramène R et B vers cette valeur neutre (bilan des blancs local).
// La force de correction augmente avec le degré de jaunissement du pixel.
function polishHeadlights(ctx, lights, W, H) {
  for (const light of lights) {
    const pad = 0.02;
    const px = Math.max(0, Math.round((light.x - pad) * W));
    const py = Math.max(0, Math.round((light.y - pad) * H));
    const pw = Math.min(W - px, Math.round((light.w + pad * 2) * W));
    const ph = Math.min(H - py, Math.round((light.h + pad * 2) * H));
    if (pw < 4 || ph < 4) continue;

    const id = ctx.getImageData(px, py, pw, ph);
    const d  = id.data;

    for (let j = 0; j < ph; j++) {
      for (let i = 0; i < pw; i++) {
        const idx = (j * pw + i) * 4;
        const r = d[idx], g = d[idx + 1], b = d[idx + 2];

        // Jaunissement = excès de rouge par rapport au bleu
        const yellowness = (r - b) / 255;
        if (yellowness < 0.03) continue; // pixel déjà assez neutre → on ne touche pas

        // Fonte aux bords pour éviter les rectangles visibles
        const ex = Math.min(i, pw - 1 - i) / (pw * 0.15);
        const ey = Math.min(j, ph - 1 - j) / (ph * 0.15);
        const edge = Math.min(1, ex, ey);

        // Intensité : pleine correction dès 12 % de jaunissement (yellowness ≥ 0.12)
        const blend = edge * Math.min(1, yellowness * 8);

        // Cible neutre froide : R pousse sous la luminance, B au-dessus
        // → résultat légèrement bleuté/blanc comme un optique propre
        const lum = (r + g + b) / 3;
        const targetR = Math.min(r, lum * 0.92); // R descend sous la luminance
        const targetB = Math.max(b, lum * 1.10); // B monte au-dessus de la luminance

        // Clarté forte pour simuler le polissage / verre transparent
        const boost = blend * 30;

        d[idx]     = Math.max(0, Math.min(255, r + (targetR - r) * blend + boost));
        d[idx + 1] = Math.max(0, Math.min(255, g                          + boost));
        d[idx + 2] = Math.max(0, Math.min(255, b + (targetB - b) * blend + boost));
      }
    }
    ctx.putImageData(id, px, py);
  }
}

// Détecte l'orientation réelle de la voiture via GPT-4o Vision (detail:low, ~$0.001)
// Retourne { near_side: "left"|"right"|"none", angle_deg: number }
// ou null en cas d'échec (fallback sur estimateAngleFromPosition)
async function detectCarAngle(b64) {
  try {
    const r = await fetch("/api/corners", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ b64 }),
    });
    const data = await r.json();
    if (typeof data.near_side === 'string' && typeof data.angle_deg === 'number') {
      console.log(`%c[AutoCache] GPT-4o angle → near_side=${data.near_side} angle=${data.angle_deg}°`, "color:cyan;font-weight:bold");
      return { near_side: data.near_side, angle_deg: data.angle_deg };
    }
    return null;
  } catch(e) {
    console.error("detectCarAngle error:", e);
    return null;
  }
}

async function detectPlate(b64, imgW, imgH) {
  try {
    const r = await fetch("/api/platerecognizer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ b64, imgW, imgH }),
    });
    const data = await r.json();
    if (data.found) console.log(`PR raw: TL(${data.tl.x.toFixed(3)},${data.tl.y.toFixed(3)}) TR(${data.tr.x.toFixed(3)},${data.tr.y.toFixed(3)}) BR(${data.br.x.toFixed(3)},${data.br.y.toFixed(3)}) BL(${data.bl.x.toFixed(3)},${data.bl.y.toFixed(3)})`);
    console.log("Plate detection:", data);
    return data;
  } catch(e) {
    console.error("detectPlate error:", e);
    return { found: false };
  }
}

async function processPhoto(photoFile, logoImg, adj, bgColor = "#ffffff", enhance = false, headlightPolish = false) {
  const { b64, imgW, imgH } = await toBase64(photoFile);
  // Détection plaque + angle voiture + optiques en parallèle (aucun délai cumulé)
  const [plate, angleData, lights] = await Promise.all([
    detectPlate(b64, imgW, imgH),
    detectCarAngle(b64),
    headlightPolish ? detectHeadlights(b64) : Promise.resolve([]),
  ]);
  const photoURL = URL.createObjectURL(photoFile);
  const photoImg = await loadImg(photoURL);
  URL.revokeObjectURL(photoURL);
  const c = document.createElement("canvas");
  c.width = photoImg.naturalWidth;
  c.height = photoImg.naturalHeight;
  const ctx = c.getContext("2d");
  ctx.filter = `brightness(${adj.brightness}) contrast(${adj.contrast}) saturate(${adj.saturation})`;
  ctx.drawImage(photoImg, 0, 0);
  ctx.filter = "none";
  // Correction de balance des blancs globale
  if (enhance) autoEnhance(ctx, c.width, c.height);
  // Lustrage des optiques : correction chromatique localisée sur les phares/feux
  if (lights.length > 0) polishHeadlights(ctx, lights, c.width, c.height);
  // Save photo without plate for later re-rendering in "Ajuster" mode
  const baseDataURL = c.toDataURL("image/jpeg", 0.93);
  let plateFound = false;
  let savedCorners = null;
  if (plate.found && logoImg) {
    plateFound = true;
    console.log(`PR detected: TL(${plate.tl.x.toFixed(3)},${plate.tl.y.toFixed(3)}) TR(${plate.tr.x.toFixed(3)},${plate.tr.y.toFixed(3)}) plateText="${plate.plateText}"`);

    // Angle réel via GPT-4o (corners.js), fallback heuristique si échec
    const { near_side, angle_deg } = angleData ?? estimateAngleFromPosition(plate);
    savedCorners = buildCorners(plate, near_side, angle_deg);

    // Convert to canvas pixels and draw
    const toPixel = p => ({ x: p.x * c.width, y: p.y * c.height });
    const ptl = toPixel(savedCorners.tl), ptr = toPixel(savedCorners.tr);
    const pbr = toPixel(savedCorners.br), pbl = toPixel(savedCorners.bl);
    console.log(`Drawing: TL(${Math.round(ptl.x)},${Math.round(ptl.y)}) TR(${Math.round(ptr.x)},${Math.round(ptr.y)}) BR(${Math.round(pbr.x)},${Math.round(pbr.y)}) BL(${Math.round(pbl.x)},${Math.round(pbl.y)})`);
    // Remplir le trapèze avec bgColor : comble les micro-écarts entre bandes et sert de fond aux coins arrondis
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(ptl.x, ptl.y);
    ctx.lineTo(ptr.x, ptr.y);
    ctx.lineTo(pbr.x, pbr.y);
    ctx.lineTo(pbl.x, pbl.y);
    ctx.closePath();
    ctx.fillStyle = bgColor;
    ctx.fill();
    ctx.restore();
    drawPerspective(ctx, logoImg, ptl, ptr, pbr, pbl);
  }
  return { name: photoFile.name, processed: c.toDataURL("image/jpeg", 0.93), plateFound, baseDataURL, corners: savedCorners };
}

const Slider = ({ label, value, min, max, step, onChange }) => (
  <div style={{ marginBottom: 18 }}>
    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 7 }}>
      <span style={{ fontSize: 10, letterSpacing: 2, textTransform: "uppercase", color: "#777", fontFamily: "'JetBrains Mono',monospace" }}>{label}</span>
      <span style={{ fontSize: 11, color: "#f26522", fontFamily: "'JetBrains Mono',monospace" }}>{value.toFixed(2)}</span>
    </div>
    <input type="range" min={min} max={max} step={step} value={value}
      onChange={e => onChange(parseFloat(e.target.value))}
      style={{ width: "100%", accentColor: "#f26522", cursor: "pointer" }} />
  </div>
);

function AuthScreen({ onAuth }) {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const submit = async () => {
    setError(""); setSuccess(""); setLoading(true);
    try {
      if (mode === "login") {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        onAuth(data.user);
      } else {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setSuccess("Compte créé ! Vérifiez votre email puis connectez-vous.");
        setMode("login");
      }
    } catch (e) { setError(e.message || "Une erreur est survenue"); }
    setLoading(false);
  };

  return (
    <div style={{ minHeight: "100vh", background: "#090909", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Rajdhani',sans-serif" }}>
      <div style={{ width: 380, padding: 40, background: "#0f0f0f", border: "1px solid #1c1c1c", borderRadius: 4 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 36 }}>
          <svg width="22" height="22" viewBox="0 0 22 22">
            <polygon points="11,1 21,6 21,16 11,21 1,16 1,6" fill="#f26522" />
            <polygon points="11,5 17,8 17,14 11,17 5,14 5,8" fill="#0f0f0f" />
          </svg>
          <span style={{ fontSize: 19, fontWeight: 700, letterSpacing: 4, textTransform: "uppercase", color: "#ddd5c8" }}>AutoCache</span>
          <span style={{ fontSize: 9, color: "#f26522", letterSpacing: 2, fontFamily: "'JetBrains Mono',monospace" }}>PRO</span>
        </div>
        <div style={{ display: "flex", marginBottom: 28, borderBottom: "1px solid #1c1c1c" }}>
          {[["login", "Connexion"], ["signup", "Inscription"]].map(([m, label]) => (
            <button key={m} onClick={() => { setMode(m); setError(""); setSuccess(""); }} style={{
              flex: 1, background: "transparent", border: "none",
              borderBottom: mode === m ? "2px solid #f26522" : "2px solid transparent",
              color: mode === m ? "#ddd5c8" : "#444", padding: "10px 0",
              cursor: "pointer", fontFamily: "'Rajdhani',sans-serif",
              fontSize: 13, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase",
              transition: "all 0.15s", marginBottom: -1
            }}>{label}</button>
          ))}
        </div>
        {[["Email", email, setEmail, "email"], ["Mot de passe", password, setPassword, "password"]].map(([label, val, set, type]) => (
          <div key={type} style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 9, letterSpacing: 2, color: "#555", textTransform: "uppercase", fontFamily: "'JetBrains Mono',monospace", marginBottom: 6 }}>{label}</div>
            <input type={type} value={val} onChange={e => set(e.target.value)} onKeyDown={e => e.key === "Enter" && submit()}
              style={{ width: "100%", background: "#141414", border: "1px solid #222", color: "#ddd5c8", padding: "10px 12px", borderRadius: 3, fontFamily: "'JetBrains Mono',monospace", fontSize: 12, outline: "none" }} />
          </div>
        ))}
        {error && <div style={{ fontSize: 10, color: "#e55", marginBottom: 14, fontFamily: "'JetBrains Mono',monospace" }}>⚠ {error}</div>}
        {success && <div style={{ fontSize: 10, color: "#5a5", marginBottom: 14, fontFamily: "'JetBrains Mono',monospace" }}>✓ {success}</div>}
        <button onClick={submit} disabled={loading} style={{
          width: "100%", background: "#f26522", color: "#090909", border: "none",
          padding: "13px 24px", cursor: loading ? "wait" : "pointer",
          fontFamily: "'Rajdhani',sans-serif", fontSize: 13, fontWeight: 700,
          letterSpacing: 4, textTransform: "uppercase", borderRadius: 3,
          opacity: loading ? 0.7 : 1, marginTop: 4
        }}>
          {loading ? "..." : mode === "login" ? "Se connecter" : "Créer mon compte"}
        </button>
      </div>
    </div>
  );
}

export default function AutoCache() {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [logo, setLogo] = useState(null);
  const [photos, setPhotos] = useState([]);
  const [results, setResults] = useState([]);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState({ n: 0, total: 0 });
  const [adj, setAdj] = useState({ brightness: 1.05, contrast: 1.1, saturation: 1.2 });
  const [adjEnabled, setAdjEnabled] = useState(false);
  const [enhance, setEnhance] = useState(false);         // amélioration auto des couleurs
  const [headlightPolish, setHeadlightPolish] = useState(false); // lustrage des optiques
  const [tab, setTab] = useState("setup");
  const [dragOver, setDragOver] = useState(null);
  // ── Mode logo : import fichier OU génération texte+couleur ──
  const [logoMode, setLogoMode] = useState("import"); // "import" | "generate"
  const [genText,  setGenText]  = useState("");
  const [genBg,    setGenBg]    = useState("#0d2b6b");
  const [genFg,    setGenFg]    = useState("#ffffff");
  const [logoRadius, setLogoRadius] = useState(1); // 0–10 : arrondi des coins, commun import+génération
  const [lightbox, setLightbox] = useState(null);
  const [cropMode, setCropMode] = useState(false);
  const [cropBox, setCropBox] = useState({ x: 0.1, y: 0.1, w: 0.8, h: 0.8 });
  const [cropDrag, setCropDrag] = useState(null); // { type, startMx, startMy, startBox }
  const [cropAngle, setCropAngle] = useState(180); // 0-360, 180 = photo droite (0° de rotation)
  const [adjustMode, setAdjustMode] = useState(false);
  const [adjustCorners, setAdjustCorners] = useState(null); // { tl, tr, br, bl } normalized 0-1
  const [adjustDrag, setAdjustDrag] = useState(null); // { corner, startMx, startMy, startCorners }
  const [lbZoom, setLbZoom] = useState(1);            // zoom de la lightbox (1 = normal, max 8)
  const [lbPan,  setLbPan]  = useState({ x: 0, y: 0 }); // décalage (px) du calque zoomé
  const [lbPanDrag, setLbPanDrag] = useState(null);   // { startMx, startMy, startPan }
  const logoRef        = useRef();
  const photosRef      = useRef();
  const cropImgRef       = useRef(null); // ref sur l'<img> de la lightbox (hors crop)
  const cropCanvasRef    = useRef(null); // canvas live-preview en mode Rogner
  const cropBaseImgRef   = useRef(null); // photo chargée pour le canvas de rognage
  const lbContainerRef   = useRef(null); // ref sur le conteneur de la lightbox (zoom/pan)
  const adjustCanvasRef  = useRef(null); // canvas live-preview en mode Ajuster
  const adjustBaseImgRef = useRef(null); // photo de base chargée pour le canvas
  const adjustLogoImgRef = useRef(null); // logo traité chargé pour le canvas
  const adjustLogoBgRef  = useRef(null); // couleur de fond du trapèze
  const adjustCornersRef = useRef(null); // derniers coins (mis à jour direct, sans passer par setState)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user || null);
      setAuthLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      setUser(session?.user || null);
    });
    return () => subscription.unsubscribe();
  }, []);

  // Regénère le cache plaque dès qu'un paramètre change (mode génération)
  useEffect(() => {
    if (logoMode !== "generate") return;
    setLogo({ file: null, preview: makeLogoDataURL(genText, genBg, genFg, logoRadius * 5), generated: true, bgColor: genBg });
  }, [logoMode, genText, genBg, genFg, logoRadius]);

  const handleLogoFile = (f) => {
    if (!f?.type.startsWith("image/")) return;
    setLogoMode("import");
    setLogo({ file: f, preview: URL.createObjectURL(f) });
  };

  const handlePhotoFiles = files => {
    const imgs = Array.from(files).filter(f => f.type.startsWith("image/"));
    setPhotos(prev => [...prev, ...imgs.map(f => ({ file: f, preview: URL.createObjectURL(f), id: `${f.name}-${Math.random()}` }))]);
  };

  const start = async () => {
    if (!logo || !photos.length) return;
    setProcessing(true);
    setProgress({ n: 0, total: photos.length });
    setResults([]);
    const rawLogo = await loadImg(logo.preview);
    let logoImg;
    if (logo.generated) {
      // Logo généré : conserver la transparence (coins arrondis perceptibles sur la photo)
      logoImg = rawLogo;
    } else {
      // Logo importé : aplatir sur blanc, avec clip arrondi si logoRadius > 0
      const flatCanvas = document.createElement("canvas");
      flatCanvas.width  = rawLogo.naturalWidth  || rawLogo.width;
      flatCanvas.height = rawLogo.naturalHeight || rawLogo.height;
      const flatCtx = flatCanvas.getContext("2d");
      if (logoRadius > 0) applyRoundedClip(flatCtx, flatCanvas.width, flatCanvas.height, logoRadius * 5);
      flatCtx.fillStyle = "#ffffff";
      flatCtx.fillRect(0, 0, flatCanvas.width, flatCanvas.height);
      flatCtx.drawImage(rawLogo, 0, 0);
      logoImg = flatCanvas;
    }
    const bgColor = logo.bgColor || "#ffffff";
    const all = [];
    for (let i = 0; i < photos.length; i++) {
      const r = await processPhoto(photos[i].file, logoImg, adjEnabled ? adj : { brightness: 1, contrast: 1, saturation: 1 }, bgColor, enhance, headlightPolish);
      all.push({ ...r, logoPreview: logo.preview, bgColor, generated: !!logo.generated });
      setResults([...all]);
      setProgress({ n: i + 1, total: photos.length });
    }
    setProcessing(false);
    setTab("results");
  };

  const downloadOne = r => { const a = document.createElement("a"); a.href = r.processed; a.download = `autocache_${r.name}`; a.click(); };
  const downloadAll = () => results.forEach(downloadOne);
  const pct = progress.total ? Math.round((progress.n / progress.total) * 100) : 0;
  const canStart = logo && photos.length > 0 && !processing;

  const logout = async () => {
    await supabase.auth.signOut();
    setLogo(null); setPhotos([]); setResults([]); setTab("setup");
  };

  const openLightbox  = (r) => {
    setLightbox(r);
    setCropMode(false); setCropBox({ x: 0.1, y: 0.1, w: 0.8, h: 0.8 }); setCropAngle(180);
    setAdjustMode(false); setAdjustCorners(r.corners || null); setAdjustDrag(null);
    setLbZoom(1); setLbPan({ x: 0, y: 0 }); setLbPanDrag(null);
  };
  const closeLightbox = () => {
    setLightbox(null);
    setCropMode(false); setCropDrag(null);
    setAdjustMode(false); setAdjustDrag(null);
    setLbZoom(1); setLbPan({ x: 0, y: 0 }); setLbPanDrag(null);
  };

  const startCropDrag = (e, type) => {
    e.preventDefault(); e.stopPropagation();
    setCropDrag({ type, startMx: e.clientX, startMy: e.clientY, startBox: { ...cropBox } });
  };

  const onCropMouseMove = (e) => {
    if (!cropDrag || !cropCanvasRef.current) return;
    const rect = cropCanvasRef.current.getBoundingClientRect();
    const dx = (e.clientX - cropDrag.startMx) / rect.width;
    const dy = (e.clientY - cropDrag.startMy) / rect.height;
    let { x, y, w, h } = cropDrag.startBox;
    const t = cropDrag.type;
    if (t === 'move')                { x += dx; y += dy; }
    if (t === 'tl' || t === 'bl')   { const nw = w - dx; if (nw > 0.05) { x += dx; w = nw; } }
    if (t === 'tr' || t === 'br')   { w = Math.max(0.05, w + dx); }
    if (t === 'tl' || t === 'tr')   { const nh = h - dy; if (nh > 0.05) { y += dy; h = nh; } }
    if (t === 'bl' || t === 'br')   { h = Math.max(0.05, h + dy); }
    x = Math.max(0, Math.min(1 - w, x));
    y = Math.max(0, Math.min(1 - h, y));
    w = Math.min(1 - x, w); h = Math.min(1 - y, h);
    setCropBox({ x, y, w, h });
  };

  const downloadCropped = () => {
    const canvas = cropCanvasRef.current;
    if (!canvas) return;
    const { x, y, w, h } = cropBox;
    const sx = Math.round(x * canvas.width),  sy = Math.round(y * canvas.height);
    const sw = Math.round(w * canvas.width),   sh = Math.round(h * canvas.height);
    const c = document.createElement('canvas');
    c.width = sw; c.height = sh;
    c.getContext('2d').drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
    const a = document.createElement('a');
    a.href = c.toDataURL('image/jpeg', 0.95);
    a.download = `autocache_rogné_${lightbox.name}`;
    a.click();
  };

  // Tourne + rogne un dataURL (deg = offset depuis 180, soit degrés réels)
  const rotateAndCropDataURL = async (src, deg, box) => {
    if (!src) return null;
    const img = await loadImg(src);
    const rad = deg * Math.PI / 180;
    const W = img.naturalWidth, H = img.naturalHeight;
    const cosA = Math.abs(Math.cos(rad)), sinA = Math.abs(Math.sin(rad));
    const cW = Math.round(W * cosA + H * sinA);
    const cH = Math.round(W * sinA + H * cosA);
    const c1 = document.createElement('canvas');
    c1.width = cW; c1.height = cH;
    const ctx1 = c1.getContext('2d');
    ctx1.save(); ctx1.translate(cW / 2, cH / 2); ctx1.rotate(rad);
    ctx1.drawImage(img, -W / 2, -H / 2); ctx1.restore();
    const sx = Math.round(box.x * cW), sy = Math.round(box.y * cH);
    const sw = Math.round(box.w * cW), sh = Math.round(box.h * cH);
    const c2 = document.createElement('canvas');
    c2.width = sw; c2.height = sh;
    c2.getContext('2d').drawImage(c1, sx, sy, sw, sh, 0, 0, sw, sh);
    return c2.toDataURL('image/jpeg', 0.95);
  };

  // Sauvegarde le rognage (+ rotation) dans le résultat (pour "Tout télécharger")
  const saveCrop = async () => {
    if (!lightbox) return;
    const deg = cropAngle - 180;   // rotation réelle : 0 = photo droite
    const box = cropBox;
    const [croppedProcessed, croppedBase] = await Promise.all([
      rotateAndCropDataURL(lightbox.processed,   deg, box),
      rotateAndCropDataURL(lightbox.baseDataURL, deg, box),
    ]);
    // Les coins de plaque ne sont valides qu'en l'absence de rotation
    let newCorners = null;
    if (deg === 0 && lightbox.corners) {
      const { x, y, w, h } = box;
      const remap = p => ({
        x: Math.max(0, Math.min(1, (p.x - x) / w)),
        y: Math.max(0, Math.min(1, (p.y - y) / h)),
      });
      newCorners = { tl: remap(lightbox.corners.tl), tr: remap(lightbox.corners.tr),
                     br: remap(lightbox.corners.br), bl: remap(lightbox.corners.bl) };
    }
    const updated = { ...lightbox, processed: croppedProcessed,
      baseDataURL: croppedBase ?? lightbox.baseDataURL, corners: newCorners, cropped: true };
    setResults(prev => prev.map(r => r === lightbox ? updated : r));
    setLightbox(updated);
    setAdjustCorners(newCorners);
    setCropAngle(180);
    setCropMode(false);
  };

  // ── Rendu live du canvas de rognage ──────────────────────────────────────
  // angle : valeur du slider (0-360), 180 = photo droite
  const renderCropPreview = (angle) => {
    const canvas = cropCanvasRef.current;
    const img    = cropBaseImgRef.current;
    if (!canvas || !img) return;
    const deg = angle - 180;
    const rad = deg * Math.PI / 180;
    const W = img.naturalWidth, H = img.naturalHeight;
    const cosA = Math.abs(Math.cos(rad)), sinA = Math.abs(Math.sin(rad));
    const cW = Math.round(W * cosA + H * sinA);
    const cH = Math.round(W * sinA + H * cosA);
    canvas.width = cW; canvas.height = cH;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, cW, cH);
    ctx.save(); ctx.translate(cW / 2, cH / 2); ctx.rotate(rad);
    ctx.drawImage(img, -W / 2, -H / 2); ctx.restore();
  };

  // Charge la photo dès que le mode Rogner s'ouvre
  useEffect(() => {
    if (!cropMode || !lightbox?.processed) return;
    let cancelled = false;
    loadImg(lightbox.processed).then(img => {
      if (cancelled) return;
      cropBaseImgRef.current = img;
      renderCropPreview(cropAngle);
    });
    return () => { cancelled = true; };
  }, [cropMode, lightbox?.processed]);

  // ── Mode Ajuster ─────────────────────────────────────────────────────────
  const startAdjustDrag = (e, corner) => {
    e.preventDefault(); e.stopPropagation();
    setAdjustDrag({ corner, startMx: e.clientX, startMy: e.clientY, startCorners: { ...adjustCorners, [corner]: { ...adjustCorners[corner] } } });
  };

  // Rendu direct sur le canvas (pas de setState — pas de re-render — 60 fps)
  const renderAdjustPreview = (corners) => {
    const canvas = adjustCanvasRef.current;
    const baseImg = adjustBaseImgRef.current;
    const logoImg = adjustLogoImgRef.current;
    if (!canvas || !baseImg) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(baseImg, 0, 0);
    if (logoImg && corners) {
      const bgColor = adjustLogoBgRef.current || '#ffffff';
      const W = canvas.width, H = canvas.height;
      const toPixel = p => ({ x: p.x * W, y: p.y * H });
      const ptl = toPixel(corners.tl), ptr = toPixel(corners.tr);
      const pbr = toPixel(corners.br), pbl = toPixel(corners.bl);
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(ptl.x, ptl.y); ctx.lineTo(ptr.x, ptr.y);
      ctx.lineTo(pbr.x, pbr.y); ctx.lineTo(pbl.x, pbl.y);
      ctx.closePath(); ctx.fillStyle = bgColor; ctx.fill();
      ctx.restore();
      drawPerspective(ctx, logoImg, ptl, ptr, pbr, pbl);
    }
  };

  const onAdjustMouseMove = (e) => {
    if (!adjustDrag || !adjustCanvasRef.current) return;
    const rect = adjustCanvasRef.current.getBoundingClientRect();
    const dx = (e.clientX - adjustDrag.startMx) / rect.width;
    const dy = (e.clientY - adjustDrag.startMy) / rect.height;
    const { corner, startCorners } = adjustDrag;
    const newCorners = {
      ...startCorners,
      [corner]: {
        x: Math.max(0, Math.min(1, startCorners[corner].x + dx)),
        y: Math.max(0, Math.min(1, startCorners[corner].y + dy)),
      }
    };
    adjustCornersRef.current = newCorners;
    setAdjustCorners(newCorners);          // met à jour les points oranges
    renderAdjustPreview(newCorners);       // met à jour le canvas en direct
  };

  // ── Zoom / Pan de la lightbox ─────────────────────────────────────────────
  const onLbWheel = (e) => {
    e.preventDefault();
    if (!lbContainerRef.current) return;
    const rect = lbContainerRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.25 : 1 / 1.25;
    const newZoom = Math.max(1, Math.min(8, lbZoom * factor));
    if (newZoom === 1) {
      setLbZoom(1); setLbPan({ x: 0, y: 0 }); return;
    }
    const newX = mx - (mx - lbPan.x) * newZoom / lbZoom;
    const newY = my - (my - lbPan.y) * newZoom / lbZoom;
    setLbZoom(newZoom);
    setLbPan({
      x: Math.max(rect.width  * (1 - newZoom), Math.min(0, newX)),
      y: Math.max(rect.height * (1 - newZoom), Math.min(0, newY)),
    });
  };

  const onLbPanDown = (e) => {
    // Ne pas démarrer le pan si un drag rognage/ajustement est en cours
    if (lbZoom > 1 && !cropDrag && !adjustDrag) {
      e.preventDefault();
      setLbPanDrag({ startMx: e.clientX, startMy: e.clientY, startPan: { ...lbPan } });
    }
  };

  const onLbPanMove = (e) => {
    if (!lbPanDrag || !lbContainerRef.current) return;
    const rect = lbContainerRef.current.getBoundingClientRect();
    const dx = e.clientX - lbPanDrag.startMx;
    const dy = e.clientY - lbPanDrag.startMy;
    setLbPan({
      x: Math.max(rect.width  * (1 - lbZoom), Math.min(0, lbPanDrag.startPan.x + dx)),
      y: Math.max(rect.height * (1 - lbZoom), Math.min(0, lbPanDrag.startPan.y + dy)),
    });
  };

  // Pré-charge photo + logo dans les refs dès que le mode Ajuster s'ouvre,
  // puis rend la preview initiale sur le canvas.
  useEffect(() => {
    if (!adjustMode || !lightbox?.baseDataURL) return;
    let cancelled = false;
    (async () => {
      const baseImg = await loadImg(lightbox.baseDataURL);
      const rawLogo = lightbox.logoPreview ? await loadImg(lightbox.logoPreview) : null;
      if (cancelled) return;
      let logoForRender = null;
      if (rawLogo) {
        if (lightbox.generated) {
          logoForRender = rawLogo;
        } else {
          const flat = document.createElement('canvas');
          flat.width  = rawLogo.naturalWidth  || rawLogo.width;
          flat.height = rawLogo.naturalHeight || rawLogo.height;
          const fctx = flat.getContext('2d');
          if (logoRadius > 0) applyRoundedClip(fctx, flat.width, flat.height, logoRadius * 5);
          fctx.fillStyle = '#ffffff'; fctx.fillRect(0, 0, flat.width, flat.height);
          fctx.drawImage(rawLogo, 0, 0);
          logoForRender = flat;
        }
      }
      adjustBaseImgRef.current = baseImg;
      adjustLogoImgRef.current = logoForRender;
      adjustLogoBgRef.current  = lightbox.bgColor || '#ffffff';
      const canvas = adjustCanvasRef.current;
      if (canvas && !cancelled) {
        canvas.width  = baseImg.naturalWidth;
        canvas.height = baseImg.naturalHeight;
        renderAdjustPreview(adjustCorners);
      }
    })();
    return () => { cancelled = true; };
  }, [adjustMode, lightbox?.baseDataURL]);

  if (authLoading) return (
    <div style={{ minHeight: "100vh", background: "#090909", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ color: "#f26522", fontFamily: "'JetBrains Mono',monospace", fontSize: 11, letterSpacing: 3 }}>CHARGEMENT...</div>
    </div>
  );

  if (!user) return <AuthScreen onAuth={setUser} />;

  return (
    <div>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Rajdhani:wght@500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        input[type=range]{-webkit-appearance:none;height:2px;background:#252525;border-radius:1px;outline:none;width:100%;}
        input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:13px;height:13px;border-radius:50%;background:#f26522;cursor:pointer;}
        ::-webkit-scrollbar{width:3px;}::-webkit-scrollbar-thumb{background:#f26522;border-radius:2px;}
      `}</style>
      <div style={{ fontFamily: "'Rajdhani',sans-serif", background: "#090909", minHeight: "100vh", color: "#ddd5c8" }}>
        <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 28px", height: 56, borderBottom: "1px solid #181818", position: "sticky", top: 0, background: "#090909", zIndex: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <svg width="22" height="22" viewBox="0 0 22 22"><polygon points="11,1 21,6 21,16 11,21 1,16 1,6" fill="#f26522" /><polygon points="11,5 17,8 17,14 11,17 5,14 5,8" fill="#090909" /></svg>
            <span style={{ fontSize: 19, fontWeight: 700, letterSpacing: 4, textTransform: "uppercase" }}>AutoCache</span>
            <span style={{ fontSize: 9, color: "#f26522", letterSpacing: 2, fontFamily: "'JetBrains Mono',monospace" }}>PRO</span>
          </div>
          <nav style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {[["setup", "Configuration"], ["results", `Résultats${results.length ? ` · ${results.length}` : ""}`]].map(([t, label]) => (
              <button key={t} onClick={() => setTab(t)} style={{ background: tab === t ? "#f26522" : "transparent", color: tab === t ? "#090909" : "#555", border: "none", padding: "7px 18px", cursor: "pointer", fontFamily: "'Rajdhani',sans-serif", fontSize: 12, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase" }}>{label}</button>
            ))}
            <div style={{ width: 1, height: 20, background: "#1c1c1c", margin: "0 4px" }} />
            <div style={{ fontSize: 9, color: "#444", fontFamily: "'JetBrains Mono',monospace", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user.email}</div>
            <button onClick={logout} style={{ background: "transparent", border: "1px solid #1e1e1e", color: "#555", padding: "5px 12px", cursor: "pointer", borderRadius: 2, fontFamily: "'Rajdhani',sans-serif", fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase" }}>Déconnexion</button>
          </nav>
        </header>

        {tab === "setup" && (
          <div style={{ maxWidth: 980, margin: "0 auto", padding: "32px 28px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 28, alignItems: "start" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
              <section>
                <div style={{ fontSize: 10, letterSpacing: 3, color: "#f26522", textTransform: "uppercase", marginBottom: 10, fontFamily: "'JetBrains Mono',monospace" }}>01 — Cache plaque</div>

                {/* ── Onglets Import / Générer ── */}
                <div style={{ display: "flex", marginBottom: 14, background: "#0a0a0a", border: "1px solid #1c1c1c", borderRadius: 3, overflow: "hidden" }}>
                  {[["import","Mon logo"],["generate","Générer"]].map(([m, label]) => (
                    <button key={m} onClick={() => {
                      if (m === "import") setLogo(null);
                      setLogoMode(m);
                    }} style={{ flex: 1, background: logoMode === m ? "#f26522" : "transparent", color: logoMode === m ? "#090909" : "#555", border: "none", padding: "8px 0", cursor: "pointer", fontFamily: "'Rajdhani',sans-serif", fontSize: 11, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase" }}>
                      {label}
                    </button>
                  ))}
                </div>

                {/* ── Mode : importer un fichier ── */}
                {logoMode === "import" && (<>
                  <div style={{ fontSize: 10, color: "#444", marginBottom: 10, fontFamily: "'JetBrains Mono',monospace" }}>
                    {logo ? "✓ Logo chargé · cliquer pour changer" : "PNG avec transparence recommandé"}
                  </div>
                  <div onDragOver={e => { e.preventDefault(); setDragOver("logo"); }} onDragLeave={() => setDragOver(null)}
                    onDrop={e => { e.preventDefault(); setDragOver(null); handleLogoFile(e.dataTransfer.files[0]); }}
                    onClick={() => logoRef.current?.click()}
                    style={{ border: `1px solid ${dragOver === "logo" ? "#f26522" : logo ? "#2a2a2a" : "#222"}`, borderRadius: 3, padding: 24, cursor: "pointer", minHeight: 130, display: "flex", alignItems: "center", justifyContent: "center", background: "#0f0f0f" }}>
                    {logo ? (
                      <div style={{ textAlign: "center" }}>
                        <img src={logo.preview} style={{ maxHeight: 80, maxWidth: "100%", objectFit: "contain", borderRadius: logoRadius > 0 ? `${Math.round(logoRadius * 4)}px` : 0 }} />
                        <div style={{ fontSize: 10, color: "#f26522", marginTop: 10 }}>Cliquer pour changer</div>
                      </div>
                    ) : (
                      <div style={{ textAlign: "center", color: "#333" }}>
                        <div style={{ fontSize: 32, marginBottom: 8 }}>⬡</div>
                        <div style={{ fontSize: 12, color: "#444" }}>Glisser votre logo ici</div>
                      </div>
                    )}
                  </div>
                </>)}

                {/* ── Mode : générer texte + couleur ── */}
                {logoMode === "generate" && (
                  <div style={{ background: "#0f0f0f", border: "1px solid #1c1c1c", borderRadius: 3, padding: "16px 14px", display: "flex", flexDirection: "column", gap: 14 }}>

                    {/* Texte */}
                    <div>
                      <div style={{ fontSize: 9, color: "#555", letterSpacing: 2, fontFamily: "'JetBrains Mono',monospace", marginBottom: 6, textTransform: "uppercase" }}>Texte du cache plaque</div>
                      <input
                        type="text" value={genText} onChange={e => setGenText(e.target.value)}
                        placeholder="Nom de votre garage"
                        style={{ width: "100%", background: "#141414", border: "1px solid #2a2a2a", color: "#ddd5c8", padding: "9px 10px", fontFamily: "'Rajdhani',sans-serif", fontSize: 16, fontWeight: 600, borderRadius: 2, outline: "none" }}
                      />
                    </div>

                    {/* Couleur de fond */}
                    <div>
                      <div style={{ fontSize: 9, color: "#555", letterSpacing: 2, fontFamily: "'JetBrains Mono',monospace", marginBottom: 7, textTransform: "uppercase" }}>Couleur de fond</div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                        {["#0d2b6b","#003399","#cc1414","#0d5c1e","#111111","#6b0d1a","#7c4700","#f26522"].map(col => (
                          <div key={col} onClick={() => setGenBg(col)}
                            style={{ width: 26, height: 26, background: col, borderRadius: 3, cursor: "pointer", border: genBg === col ? "2px solid #f26522" : "2px solid transparent", flexShrink: 0 }} />
                        ))}
                        <input type="color" value={genBg} onChange={e => setGenBg(e.target.value)}
                          title="Couleur personnalisée"
                          style={{ width: 26, height: 26, padding: 0, border: "1px solid #2a2a2a", borderRadius: 3, cursor: "pointer", background: "none" }} />
                      </div>
                    </div>

                    {/* Couleur du texte */}
                    <div>
                      <div style={{ fontSize: 9, color: "#555", letterSpacing: 2, fontFamily: "'JetBrains Mono',monospace", marginBottom: 7, textTransform: "uppercase" }}>Couleur du texte</div>
                      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        {["#ffffff","#ffcc00","#000000","#ff6600"].map(col => (
                          <div key={col} onClick={() => setGenFg(col)}
                            style={{ width: 26, height: 26, background: col, borderRadius: 3, cursor: "pointer", border: genFg === col ? "2px solid #f26522" : "2px solid #2a2a2a", flexShrink: 0 }} />
                        ))}
                        <input type="color" value={genFg} onChange={e => setGenFg(e.target.value)}
                          title="Couleur personnalisée"
                          style={{ width: 26, height: 26, padding: 0, border: "1px solid #2a2a2a", borderRadius: 3, cursor: "pointer", background: "none" }} />
                      </div>
                    </div>

                    {/* Aperçu live */}
                    {logo?.preview && (
                      <div>
                        <div style={{ fontSize: 9, color: "#444", letterSpacing: 2, fontFamily: "'JetBrains Mono',monospace", marginBottom: 6, textTransform: "uppercase" }}>Aperçu</div>
                        <img src={logo.preview} style={{ width: "100%", display: "block", border: "1px solid #2a2a2a" }} />
                      </div>
                    )}
                  </div>
                )}

                <input ref={logoRef} type="file" accept="image/*" style={{ display: "none" }} onChange={e => handleLogoFile(e.target.files[0])} />

                {/* ── Arrondi des coins (global import + génération) ── */}
                <div style={{ marginTop: 16, background: "#0f0f0f", border: "1px solid #1c1c1c", borderRadius: 3, padding: "14px 16px" }}>
                  <Slider label="Arrondi des coins" value={logoRadius} min={0} max={10} step={1} onChange={setLogoRadius} />
                </div>
              </section>

              <section>
                {/* ── Cases à cocher : améliorations photo ── */}
                {[
                  {
                    active: enhance,
                    toggle: () => setEnhance(p => !p),
                    icon: "✨",
                    label: "Amélioration automatique",
                    sub: "Supprime la dominante jaune · Éclairage plus blanc et neutre",
                  },
                  {
                    active: headlightPolish,
                    toggle: () => setHeadlightPolish(p => !p),
                    icon: "💡",
                    label: "Lustrage des optiques",
                    sub: "Réduit le jaunissement des phares et feux · IA GPT-4o",
                  },
                ].map(({ active, toggle, icon, label, sub }) => (
                  <div key={label}
                    onClick={toggle}
                    style={{ marginBottom: 8, display: "flex", alignItems: "center", gap: 12, padding: "11px 14px", background: active ? "rgba(242,101,34,0.08)" : "#0a0a0a", border: `1px solid ${active ? "#f26522" : "#1c1c1c"}`, borderRadius: 3, cursor: "pointer", userSelect: "none" }}
                  >
                    <div style={{ width: 16, height: 16, borderRadius: 3, border: `2px solid ${active ? "#f26522" : "#333"}`, background: active ? "#f26522" : "transparent", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {active && <span style={{ color: "#090909", fontSize: 11, fontWeight: 900, lineHeight: 1 }}>✓</span>}
                    </div>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", color: active ? "#f26522" : "#666", fontFamily: "'Rajdhani',sans-serif" }}>{icon} {label}</div>
                      <div style={{ fontSize: 9, color: "#444", fontFamily: "'JetBrains Mono',monospace", marginTop: 2 }}>{sub}</div>
                    </div>
                  </div>
                ))}

                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                  <div style={{ fontSize: 10, letterSpacing: 3, color: adjEnabled ? "#f26522" : "#333", textTransform: "uppercase", fontFamily: "'JetBrains Mono',monospace" }}>03 — Ajustements photo</div>
                  <button onClick={() => setAdjEnabled(p => !p)} style={{ background: adjEnabled ? "#f26522" : "#141414", border: `1px solid ${adjEnabled ? "#f26522" : "#2a2a2a"}`, color: adjEnabled ? "#090909" : "#444", padding: "4px 13px", cursor: "pointer", fontFamily: "'JetBrains Mono',monospace", fontSize: 9, letterSpacing: 2, textTransform: "uppercase", borderRadius: 2 }}>
                    {adjEnabled ? "ON" : "OFF"}
                  </button>
                </div>
                <div style={{ background: "#0f0f0f", border: "1px solid #1c1c1c", borderRadius: 3, padding: "20px 18px", opacity: adjEnabled ? 1 : 0.35, pointerEvents: adjEnabled ? "auto" : "none" }}>
                  <Slider label="Luminosité" value={adj.brightness} min={0.7} max={1.5} step={0.01} onChange={v => setAdj(p => ({...p, brightness: v}))} />
                  <Slider label="Contraste" value={adj.contrast} min={0.7} max={1.6} step={0.01} onChange={v => setAdj(p => ({...p, contrast: v}))} />
                  <Slider label="Saturation" value={adj.saturation} min={0.5} max={2.0} step={0.01} onChange={v => setAdj(p => ({...p, saturation: v}))} />
                </div>
              </section>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
              <section>
                <div style={{ fontSize: 10, letterSpacing: 3, color: "#f26522", textTransform: "uppercase", marginBottom: 12, fontFamily: "'JetBrains Mono',monospace" }}>02 — Photos de véhicules</div>
                <div onDragOver={e => { e.preventDefault(); setDragOver("photos"); }} onDragLeave={() => setDragOver(null)}
                  onDrop={e => { e.preventDefault(); setDragOver(null); handlePhotoFiles(e.dataTransfer.files); }}
                  onClick={() => photosRef.current?.click()}
                  style={{ border: `1px dashed ${dragOver === "photos" ? "#f26522" : "#222"}`, borderRadius: 3, padding: "22px 16px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", background: "#0f0f0f", marginBottom: 12 }}>
                  <div style={{ textAlign: "center", color: "#333" }}>
                    <div style={{ fontSize: 30, marginBottom: 8 }}>◈</div>
                    <div style={{ fontSize: 12, color: "#444" }}>Glisser les photos ici</div>
                    <div style={{ fontSize: 10, marginTop: 3, color: "#2a2a2a" }}>JPG, PNG — plusieurs fichiers acceptés</div>
                  </div>
                </div>
                <input ref={photosRef} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={e => handlePhotoFiles(e.target.files)} />
                {photos.length > 0 && (
                  <>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 5, maxHeight: 210, overflowY: "auto", marginBottom: 10 }}>
                      {photos.map(p => (
                        <div key={p.id} style={{ position: "relative" }}>
                          <img src={p.preview} style={{ width: "100%", aspectRatio: "4/3", objectFit: "cover", borderRadius: 2, border: "1px solid #1c1c1c", display: "block" }} />
                          <button onClick={e => { e.stopPropagation(); setPhotos(prev => prev.filter(x => x.id !== p.id)); }}
                            style={{ position: "absolute", top: 2, right: 2, width: 15, height: 15, borderRadius: "50%", background: "#f26522", border: "none", color: "#090909", fontSize: 9, cursor: "pointer", fontWeight: 700 }}>×</button>
                        </div>
                      ))}
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: 10, color: "#555", fontFamily: "'JetBrains Mono',monospace" }}>{photos.length} photo{photos.length > 1 ? "s" : ""}</span>
                      <button onClick={() => setPhotos([])} style={{ background: "transparent", border: "1px solid #1e1e1e", color: "#555", padding: "3px 10px", cursor: "pointer", fontFamily: "'Rajdhani',sans-serif", fontSize: 10, letterSpacing: 1, textTransform: "uppercase", borderRadius: 2 }}>Tout effacer</button>
                    </div>
                  </>
                )}
              </section>

              <section>
                <button onClick={start} disabled={!canStart} style={{ width: "100%", background: canStart ? "#f26522" : "#141414", color: canStart ? "#090909" : "#333", border: "none", padding: "15px 24px", cursor: canStart ? "pointer" : "not-allowed", fontFamily: "'Rajdhani',sans-serif", fontSize: 15, fontWeight: 700, letterSpacing: 4, textTransform: "uppercase", borderRadius: 3 }}>
                  {processing ? `Traitement... ${progress.n} / ${progress.total}` : `Lancer — ${photos.length} photo${photos.length > 1 ? "s" : ""}`}
                </button>
                {processing && (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ height: 2, background: "#181818", borderRadius: 1, overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${pct}%`, background: "#f26522", transition: "width 0.4s ease" }} />
                    </div>
                    <div style={{ marginTop: 5, fontSize: 9, color: "#555", fontFamily: "'JetBrains Mono',monospace", textAlign: "right" }}>{pct}%</div>
                  </div>
                )}
                {!logo && <div style={{ marginTop: 10, fontSize: 10, color: "#444", fontFamily: "'JetBrains Mono',monospace" }}>⚠ Chargez votre logo pour continuer</div>}
              </section>
            </div>
          </div>
        )}

        {tab === "results" && (
          <div style={{ maxWidth: 1200, margin: "0 auto", padding: "32px 28px" }}>
            {results.length === 0 ? (
              <div style={{ textAlign: "center", padding: "80px 0", color: "#333" }}>
                <div style={{ fontSize: 48, marginBottom: 16 }}>◈</div>
                <div style={{ fontSize: 14, letterSpacing: 2, textTransform: "uppercase" }}>Aucun résultat</div>
              </div>
            ) : (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
                  <div>
                    <div style={{ fontSize: 10, letterSpacing: 3, color: "#f26522", textTransform: "uppercase", fontFamily: "'JetBrains Mono',monospace" }}>{results.length} photo{results.length > 1 ? "s" : ""} traitée{results.length > 1 ? "s" : ""}</div>
                    <div style={{ marginTop: 4, fontSize: 10, color: "#444", fontFamily: "'JetBrains Mono',monospace" }}>
                      {results.filter(r => r.plateFound).length} détectée{results.filter(r => r.plateFound).length > 1 ? "s" : ""} · {results.filter(r => !r.plateFound).length} non détectée{results.filter(r => !r.plateFound).length > 1 ? "s" : ""}
                    </div>
                  </div>
                  {!processing && <button onClick={downloadAll} style={{ background: "#f26522", color: "#090909", border: "none", padding: "9px 22px", cursor: "pointer", fontFamily: "'Rajdhani',sans-serif", fontSize: 12, fontWeight: 700, letterSpacing: 3, textTransform: "uppercase", borderRadius: 3 }}>Tout télécharger ({results.length})</button>}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 14 }}>
                  {results.map((r, i) => (
                    <div key={i} style={{ background: "#0f0f0f", border: "1px solid #1a1a1a", borderRadius: 3, overflow: "hidden" }}>
                      <div style={{ position: "relative", cursor: "zoom-in" }} onClick={() => openLightbox(r)} title="Cliquer pour agrandir">
                        <img src={r.processed} style={{ width: "100%", aspectRatio: "4/3", objectFit: "contain", background: "#111", display: "block" }} />
                        <div style={{ position: "absolute", top: 8, left: 8, display: "flex", gap: 4, flexWrap: "wrap" }}>
                          <span style={{ background: r.plateFound ? "rgba(22,163,74,0.9)" : "rgba(220,38,38,0.9)", color: "#fff", fontSize: 8, padding: "3px 7px", borderRadius: 2, fontFamily: "'JetBrains Mono',monospace" }}>
                            {r.plateFound ? "✓ PLAQUE CACHÉE" : "⚠ NON DÉTECTÉE"}
                          </span>
                          {r.cropped && (
                            <span style={{ background: "rgba(242,101,34,0.85)", color: "#fff", fontSize: 8, padding: "3px 7px", borderRadius: 2, fontFamily: "'JetBrains Mono',monospace" }}>✂ ROGNÉ</span>
                          )}
                        </div>
                        <div style={{ position: "absolute", bottom: 8, right: 8, background: "rgba(0,0,0,0.6)", borderRadius: 2, padding: "3px 7px", fontSize: 9, color: "#aaa", fontFamily: "'JetBrains Mono',monospace" }}>🔍 Agrandir</div>
                      </div>
                      <div style={{ padding: "9px 11px", display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid #161616" }}>
                        <div style={{ fontSize: 10, color: "#444", fontFamily: "'JetBrains Mono',monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "68%" }}>{r.name}</div>
                        <button onClick={() => downloadOne(r)} style={{ background: "transparent", border: "1px solid #2a2a2a", color: "#f26522", padding: "4px 11px", cursor: "pointer", fontFamily: "'Rajdhani',sans-serif", fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", borderRadius: 2 }}>DL</button>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* ── Lightbox + rognage ──────────────────────────────────── */}
      {lightbox && (
        <div
          onClick={cropMode || adjustMode ? undefined : closeLightbox}
          onMouseMove={e => { onCropMouseMove(e); onAdjustMouseMove(e); onLbPanMove(e); }}
          onMouseUp={() => {
            setCropDrag(null);
            // Auto-sauvegarde dès qu'un coin est relâché
            if (adjustDrag && adjustCornersRef.current) {
              const canvas = adjustCanvasRef.current;
              if (canvas) {
                const newDataURL = canvas.toDataURL('image/jpeg', 0.93);
                const latestCorners = adjustCornersRef.current;
                const updated = { ...lightbox, processed: newDataURL, corners: latestCorners };
                setResults(prev => prev.map(r => r === lightbox ? updated : r));
                setLightbox(updated);
              }
            }
            setAdjustDrag(null);
            setLbPanDrag(null);
          }}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.93)", zIndex: 1000, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 16, userSelect: "none" }}
        >
          {/* ── Barre du haut ── */}
          <div onClick={e => e.stopPropagation()} style={{ width: "100%", maxWidth: 1100, display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, padding: "0 4px", flexWrap: "wrap", gap: 8 }}>
            <div style={{ fontSize: 10, color: "#555", fontFamily: "'JetBrains Mono',monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "40%" }}>{lightbox.name}</div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>

              {/* Bouton Rogner toggle */}
              <button
                onClick={e => {
                  e.stopPropagation();
                  setCropMode(c => {
                    if (!c) {
                      setCropAngle(180);
                      setCropBox({ x: 0.1, y: 0.1, w: 0.8, h: 0.8 });
                    }
                    return !c;
                  });
                  setAdjustMode(false); setAdjustDrag(null);
                }}
                style={{ background: cropMode ? "#f26522" : "#181818", color: cropMode ? "#090909" : "#aaa", border: `1px solid ${cropMode ? "#f26522" : "#2a2a2a"}`, padding: "7px 14px", cursor: "pointer", fontFamily: "'Rajdhani',sans-serif", fontSize: 11, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", borderRadius: 2 }}
              >✂ Rogner</button>

              {/* Bouton Ajuster — visible seulement si plaque détectée */}
              {lightbox.plateFound && lightbox.corners && (
                <button
                  onClick={e => { e.stopPropagation(); const nm = !adjustMode; if (nm) adjustCornersRef.current = lightbox.corners; setAdjustMode(nm); setCropMode(false); setCropDrag(null); setAdjustCorners(lightbox.corners); }}
                  style={{ background: adjustMode ? "#e8a020" : "#181818", color: adjustMode ? "#090909" : "#e8a020", border: `1px solid ${adjustMode ? "#e8a020" : "#3a2800"}`, padding: "7px 14px", cursor: "pointer", fontFamily: "'Rajdhani',sans-serif", fontSize: 11, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", borderRadius: 2 }}
                >⊹ Ajuster</button>
              )}

              {/* Télécharger / Fermer ajustement */}
              {adjustMode ? (
                <button
                  onClick={e => { e.stopPropagation(); setAdjustMode(false); setAdjustDrag(null); }}
                  style={{ background: "#e8a020", color: "#090909", border: "none", padding: "7px 18px", cursor: "pointer", fontFamily: "'Rajdhani',sans-serif", fontSize: 12, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", borderRadius: 2 }}
                >✓ Terminé</button>
              ) : cropMode ? (<>
                <button
                  onClick={e => { e.stopPropagation(); saveCrop(); }}
                  style={{ background: "#2a6b2a", color: "#ddd5c8", border: "1px solid #3a8a3a", padding: "7px 14px", cursor: "pointer", fontFamily: "'Rajdhani',sans-serif", fontSize: 11, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", borderRadius: 2 }}
                >💾 Sauvegarder</button>
                <button
                  onClick={e => { e.stopPropagation(); downloadCropped(); }}
                  style={{ background: "#f26522", color: "#090909", border: "none", padding: "7px 18px", cursor: "pointer", fontFamily: "'Rajdhani',sans-serif", fontSize: 12, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", borderRadius: 2 }}
                >⬇ Télécharger rogné</button>
              </>) : (
                <button
                  onClick={e => { e.stopPropagation(); downloadOne(lightbox); }}
                  style={{ background: "#f26522", color: "#090909", border: "none", padding: "7px 18px", cursor: "pointer", fontFamily: "'Rajdhani',sans-serif", fontSize: 12, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", borderRadius: 2 }}
                >⬇ Télécharger</button>
              )}

              <button onClick={closeLightbox} style={{ background: "#181818", color: "#aaa", border: "1px solid #2a2a2a", padding: "7px 14px", cursor: "pointer", fontFamily: "'JetBrains Mono',monospace", fontSize: 14, borderRadius: 2 }}>✕</button>
            </div>
          </div>

          {/* ── Image + overlay rognage/ajustement ── */}
          <div
            ref={lbContainerRef}
            onClick={e => e.stopPropagation()}
            onWheel={onLbWheel}
            onMouseDown={onLbPanDown}
            onDoubleClick={e => { e.stopPropagation(); setLbZoom(1); setLbPan({ x: 0, y: 0 }); }}
            style={{
              position: "relative", display: "inline-block", maxWidth: "100%",
              borderRadius: 3, border: "1px solid #222", overflow: "hidden", lineHeight: 0,
              touchAction: "none",
              cursor: lbZoom > 1 ? (lbPanDrag ? "grabbing" : "grab") : "default",
            }}
          >
            {/* Indicateur de zoom */}
            {lbZoom > 1.05 && (
              <div style={{ position: "absolute", top: 8, right: 8, background: "rgba(0,0,0,0.75)", color: "#f26522", fontSize: 10, fontFamily: "'JetBrains Mono',monospace", padding: "3px 8px", borderRadius: 2, zIndex: 30, pointerEvents: "none", letterSpacing: 1 }}>
                ×{lbZoom.toFixed(1)}
              </div>
            )}
            {/* Calque zoomé — transform appliqué ici, les overlays bougent avec l'image */}
            <div style={{
              transform: `translate(${lbPan.x}px, ${lbPan.y}px) scale(${lbZoom})`,
              transformOrigin: "0 0",
              position: "relative",
              display: "inline-block",
              lineHeight: 0,
            }}>
            {adjustMode ? (
              <canvas
                ref={adjustCanvasRef}
                style={{ display: "block", maxWidth: "min(1100px, 100vw - 32px)", maxHeight: "72vh" }}
              />
            ) : cropMode ? (
              <canvas
                ref={cropCanvasRef}
                style={{ display: "block", maxWidth: "min(1100px, 100vw - 32px)", maxHeight: "72vh" }}
              />
            ) : (
              <img
                ref={cropImgRef}
                src={lightbox.processed}
                style={{ display: "block", maxWidth: "min(1100px, 100vw - 32px)", maxHeight: "79vh", objectFit: "contain", pointerEvents: "none" }}
              />
            )}

            {/* ── Overlay Ajuster : 4 points oranges draggables ── */}
            {adjustMode && adjustCorners && (
              <div style={{ position: "absolute", inset: 0, cursor: adjustDrag ? "grabbing" : "crosshair" }}>
                {/* Contour du trapèze — viewBox 0-100 = % de l'image, pas d'unité % en SVG */}
                <svg
                  viewBox="0 0 100 100"
                  preserveAspectRatio="none"
                  style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
                >
                  <polygon
                    points={[
                      `${adjustCorners.tl.x * 100},${adjustCorners.tl.y * 100}`,
                      `${adjustCorners.tr.x * 100},${adjustCorners.tr.y * 100}`,
                      `${adjustCorners.br.x * 100},${adjustCorners.br.y * 100}`,
                      `${adjustCorners.bl.x * 100},${adjustCorners.bl.y * 100}`,
                    ].join(" ")}
                    fill="rgba(232,160,32,0.08)"
                    stroke="#e8a020"
                    strokeWidth="0.4"
                    strokeDasharray="2.5 1.5"
                    vectorEffect="non-scaling-stroke"
                  />
                </svg>
                {/* Points de coin draggables */}
                {[["tl","nwse-resize"],["tr","nesw-resize"],["br","nwse-resize"],["bl","nesw-resize"]].map(([corner, cur]) => (
                  <div
                    key={corner}
                    onMouseDown={e => startAdjustDrag(e, corner)}
                    style={{
                      position: "absolute",
                      left: `${adjustCorners[corner].x * 100}%`,
                      top:  `${adjustCorners[corner].y * 100}%`,
                      width: 12, height: 12,
                      background: "#e8a020",
                      border: "2px solid #fff",
                      borderRadius: "50%",
                      transform: "translate(-50%,-50%)",
                      cursor: cur,
                      zIndex: 10,
                      boxShadow: "0 0 5px rgba(0,0,0,0.8)",
                    }}
                  />
                ))}
              </div>
            )}

            {cropMode && (
              <div style={{ position: "absolute", inset: 0, cursor: cropDrag?.type === "move" ? "grabbing" : "default" }}>
                {/* Zones sombres hors sélection */}
                <div style={{ position: "absolute", inset: 0, pointerEvents: "none", background: `linear-gradient(to bottom, rgba(0,0,0,0.6) ${cropBox.y*100}%, transparent ${cropBox.y*100}%, transparent ${(cropBox.y+cropBox.h)*100}%, rgba(0,0,0,0.6) ${(cropBox.y+cropBox.h)*100}%)` }} />
                <div style={{ position: "absolute", top: `${cropBox.y*100}%`, height: `${cropBox.h*100}%`, left: 0, width: `${cropBox.x*100}%`, background: "rgba(0,0,0,0.6)", pointerEvents: "none" }} />
                <div style={{ position: "absolute", top: `${cropBox.y*100}%`, height: `${cropBox.h*100}%`, right: 0, width: `${(1-cropBox.x-cropBox.w)*100}%`, background: "rgba(0,0,0,0.6)", pointerEvents: "none" }} />

                {/* Rectangle de rognage (déplacer) */}
                <div
                  onMouseDown={e => startCropDrag(e, "move")}
                  style={{ position: "absolute", left: `${cropBox.x*100}%`, top: `${cropBox.y*100}%`, width: `${cropBox.w*100}%`, height: `${cropBox.h*100}%`, border: "2px solid #f26522", cursor: "move", boxSizing: "border-box" }}
                >
                  {/* Grille tiers */}
                  {[33.33, 66.66].map(p => (
                    <span key={`h${p}`} style={{ position: "absolute", top: `${p}%`, left: 0, right: 0, height: 1, background: "rgba(242,101,34,0.3)", pointerEvents: "none" }} />
                  ))}
                  {[33.33, 66.66].map(p => (
                    <span key={`v${p}`} style={{ position: "absolute", left: `${p}%`, top: 0, bottom: 0, width: 1, background: "rgba(242,101,34,0.3)", pointerEvents: "none" }} />
                  ))}

                  {/* Poignées de coin */}
                  {[["tl",0,0,"nwse-resize"],["tr","100%",0,"nesw-resize"],["br","100%","100%","nwse-resize"],["bl",0,"100%","nesw-resize"]].map(([type,left,top,cur]) => (
                    <div key={type} onMouseDown={e => startCropDrag(e, type)} style={{ position: "absolute", left, top, width: 14, height: 14, background: "#f26522", transform: "translate(-50%,-50%)", cursor: cur, borderRadius: 2, zIndex: 2 }} />
                  ))}
                </div>
              </div>
            )}
            </div>{/* fin calque zoomé */}
          </div>

          {/* ── Jauge d'inclinaison (mode Rogner) ── */}
          {cropMode && (
            <div onClick={e => e.stopPropagation()} style={{ width: "100%", maxWidth: "min(1100px, 100vw - 32px)", marginTop: 10, padding: "10px 16px 8px", background: "#0f0f0f", border: "1px solid #222", borderRadius: 3 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 7 }}>
                <span style={{ fontSize: 10, letterSpacing: 2, textTransform: "uppercase", color: "#777", fontFamily: "'JetBrains Mono',monospace" }}>Inclinaison</span>
                <span style={{ fontSize: 11, color: "#f26522", fontFamily: "'JetBrains Mono',monospace" }}>
                  {cropAngle === 180 ? "0°" : `${cropAngle > 180 ? "+" : ""}${cropAngle - 180}°`}
                </span>
              </div>
              <input
                type="range" min={0} max={360} step={1} value={cropAngle}
                onChange={e => {
                  const a = parseFloat(e.target.value);
                  setCropAngle(a);
                  renderCropPreview(a);
                }}
                style={{ width: "100%", accentColor: "#f26522", cursor: "pointer" }}
              />
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, fontSize: 9, color: "#333", fontFamily: "'JetBrains Mono',monospace" }}>
                <span>−180°</span><span>0°</span><span>+180°</span>
              </div>
            </div>
          )}

          {/* ── Pied ── */}
          <div style={{ marginTop: 10, fontSize: 9, color: "#444", fontFamily: "'JetBrains Mono',monospace", textAlign: "center" }}>
            {adjustMode
              ? "Glisser un point orange pour repositionner le coin · Le résultat s'applique en temps réel"
              : cropMode
              ? "Inclinaison · Glisser la zone · Coins oranges pour redimensionner · 💾 Sauvegarder"
              : lbZoom > 1
              ? "Molette pour zoomer · Glisser pour se déplacer · Double-clic pour réinitialiser"
              : "Molette pour zoomer · ✂ Rogner · ⊹ Ajuster · Cliquer en dehors pour fermer"}
          </div>
        </div>
      )}
    </div>
  );
}
