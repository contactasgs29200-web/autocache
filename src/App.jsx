import { useState, useRef, useEffect, useCallback, Fragment } from "react";
import MaskEditor from "./components/MaskEditor.jsx";
import Tutorial from "./components/Tutorial.jsx";
import HelpWidget from "./components/HelpWidget.jsx";
import LoadingGame from "./components/LoadingGame.jsx";
// @imgly background removal — chargé dynamiquement
let removeBgImgly = null;
import { createClient } from "@supabase/supabase-js";
import { MASK_MODE_CONFIGS, LENS_HALO_THRESHOLDS, FULL_PHOTO_IDENTICAL_THRESHOLDS, SAFE_POLISH_PRESETS } from "../api/_lib/headlight/mask.js";

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.innerWidth <= 767);
  useEffect(() => {
    const h = () => setIsMobile(window.innerWidth <= 767);
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, []);
  return isMobile;
}

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

// ── Polices disponibles pour le cache plaque généré ──────────────────────
const LOGO_FONTS = [
  { key: "impact",    family: "Impact, Arial Black, sans-serif", label: "IMPACT",   weight: "900" },
  { key: "rajdhani",  family: "'Rajdhani', sans-serif",           label: "Rajdhani", weight: "700" },
  { key: "cormorant", family: "'Cormorant Garamond', serif",      label: "Élégant",  weight: "600" },
  { key: "bebas",     family: "'Bebas Neue', sans-serif",         label: "Bebas",    weight: "400" },
  { key: "georgia",   family: "Georgia, serif",                   label: "Georgia",  weight: "700" },
];

// ── Cache plaque généré ───────────────────────────────────────────────────
// Génère un canvas 1040×220 (ratio 4.73:1) avec texte, couleurs et coins arrondis.
// radius : 0 = coins droits, 50 = forme de pilule (% de H)
function makeLogoDataURL(text, bg, fg, radius, fontKey = "impact", borderColor = null, borderWidth = 0) {
  const W = 3120, H = 660;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d");

  applyRoundedClip(ctx, W, H, radius);

  // Liseret : remplir tout avec la couleur du liseret, puis dessiner le fond en retrait
  const bw = Math.round(borderWidth * H / 100); // épaisseur en pixels (% de H)
  if (borderColor && bw > 0) {
    ctx.fillStyle = borderColor;
    ctx.fillRect(0, 0, W, H);
    // Fond principal en retrait
    ctx.save();
    ctx.translate(bw, bw);
    applyRoundedClip(ctx, W - bw * 2, H - bw * 2, Math.max(0, radius - bw));
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W - bw * 2, H - bw * 2);
    ctx.restore();
  } else {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
  }

  // Texte principal (taille auto)
  const txt = (text.trim() || "VOTRE TEXTE").toUpperCase();
  const f = LOGO_FONTS.find(f => f.key === fontKey) ?? LOGO_FONTS[0];
  ctx.fillStyle = fg;
  let sz = Math.round(H * 0.52);
  ctx.font = `${f.weight} ${sz}px ${f.family}`;
  while (ctx.measureText(txt).width > W * 0.88 && sz > 16) {
    sz -= 2;
    ctx.font = `${f.weight} ${sz}px ${f.family}`;
  }
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(txt, W / 2, H / 2);

  return c.toDataURL("image/png");
}

// ── Polices murales (texte sur le mur du showroom) ─────────────────────
const WALL_FONTS = [
  { key: "rajdhani",    family: "'Rajdhani', sans-serif",              label: "Moderne",    weight: "700" },
  { key: "bebas",       family: "'Bebas Neue', sans-serif",            label: "Bebas",      weight: "400" },
  { key: "cormorant",   family: "'Cormorant Garamond', serif",         label: "Élégant",    weight: "600" },
  { key: "impact",      family: "Impact, Arial Black, sans-serif",     label: "Impact",     weight: "900" },
  { key: "georgia",     family: "Georgia, serif",                      label: "Georgia",    weight: "700" },
  { key: "montserrat",  family: "'Montserrat', sans-serif",            label: "Montserrat", weight: "700" },
  { key: "playfair",    family: "'Playfair Display', serif",           label: "Playfair",   weight: "700" },
];

// Génère un PNG transparent avec le texte mural (haute résolution)
function makeWallTextDataURL(text, color, fontKey = "rajdhani", strokeColor = null, strokeWidth = 0, underline = false) {
  const f = WALL_FONTS.find(f => f.key === fontKey) ?? WALL_FONTS[0];
  const txt = text.trim() || "VOTRE ENSEIGNE";
  // Canvas temporaire pour mesurer le texte
  const tmp = document.createElement("canvas");
  const tctx = tmp.getContext("2d");
  const fontSize = 200;
  tctx.font = `${f.weight} ${fontSize}px ${f.family}`;
  const m = tctx.measureText(txt);
  const stroke = strokeColor && strokeWidth > 0 ? strokeWidth * 4 : 0; // ×4 car canvas haute résolution
  const underlinePad = underline ? Math.round(fontSize * 0.12) : 0;
  const W = Math.ceil(m.width) + 80 + stroke * 2;
  const H = fontSize + 60 + stroke * 2 + underlinePad;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d");
  ctx.font = `${f.weight} ${fontSize}px ${f.family}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const cx = W / 2;
  const cy = (H - underlinePad) / 2;
  // Liseré (stroke)
  if (strokeColor && strokeWidth > 0) {
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = stroke;
    ctx.lineJoin = "round";
    ctx.strokeText(txt, cx, cy);
  }
  // Remplissage
  ctx.fillStyle = color;
  ctx.fillText(txt, cx, cy);
  // Soulignement
  if (underline) {
    const metrics = ctx.measureText(txt);
    const lineY = cy + fontSize * 0.58 + underlinePad * 0.5;
    const lineX = cx - metrics.width / 2;
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(4, fontSize * 0.06);
    ctx.moveTo(lineX, lineY);
    ctx.lineTo(lineX + metrics.width, lineY);
    ctx.stroke();
  }
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


// Build trapezoid corners from PR bounding box.
// Stratégie : conserve les X réels de PR (perspective déjà encodée) et le centre Y
// par côté (capture l'inclinaison verticale sur les voitures de 3/4).
// Seule la hauteur est recalculée via le ratio 520×110mm pour corriger PR.
function buildCorners(plate, near_side, angle_deg, plateCenter = null) {
  // Positions X réelles de chaque coin — PR les a déjà en perspective, on les garde
  const tlx = plate.tl.x, trx = plate.tr.x;
  const brx = plate.br.x, blx = plate.bl.x;

  // Centre Y par côté : capture l'inclinaison verticale de la plaque (voiture de 3/4)
  const leftCY  = (plate.tl.y + plate.bl.y) / 2;
  const rightCY = (plate.tr.y + plate.br.y) / 2;
  // Override si GPT-4o a fourni un centre précis
  const leftCYf  = plateCenter ? plateCenter.cy : leftCY;
  const rightCYf = plateCenter ? plateCenter.cy : rightCY;

  // Hauteur : ratio 520×110mm corrigé pour la perspective.
  // Pour les voitures de côté, la largeur apparente est raccourcie par cos(θ),
  // donc on divise par cos(θ) pour retrouver la hauteur réelle.
  const topW  = trx - tlx;
  const botW  = brx - blx;
  const avgW  = (topW + botW) / 2;
  const theta = angle_deg * Math.PI / 180;
  const cosT  = Math.max(0.55, Math.cos(theta)); // cos correction perspective
  const ph    = avgW / cosT / 4.73;

  // Hauteur gauche/droite différente en perspective
  const PERSP  = 0.32;
  const nearH  = ph * (1 + Math.sin(theta) * PERSP);
  const farH   = ph * (1 - Math.sin(theta) * PERSP);
  const leftH  = near_side === "left"  ? nearH : near_side === "right" ? farH : ph;
  const rightH = near_side === "right" ? nearH : near_side === "left"  ? farH : ph;

  return {
    tl: { x: Math.max(0, tlx), y: Math.max(0, leftCYf  - leftH  * 0.5) },
    tr: { x: Math.min(1, trx), y: Math.max(0, rightCYf - rightH * 0.5) },
    br: { x: Math.min(1, brx), y: Math.min(1, rightCYf + rightH * 0.5) },
    bl: { x: Math.max(0, blx), y: Math.min(1, leftCYf  + leftH  * 0.5) },
  };
}

// Conversion corners photo (0-1) ↔ showroom (0-1)
// t = { carX, carY, cw, ch, W, H } issu de compositeCarOnBg
function cornersToShowroom(corners, t) {
  const m = p => ({ x: (t.carX + p.x * t.cw) / t.W, y: (t.carY + p.y * t.ch) / t.H });
  return { tl: m(corners.tl), tr: m(corners.tr), br: m(corners.br), bl: m(corners.bl) };
}
function cornersFromShowroom(sc, t) {
  const u = p => ({
    x: Math.max(0, Math.min(1, (p.x * t.W - t.carX) / t.cw)),
    y: Math.max(0, Math.min(1, (p.y * t.H - t.carY) / t.ch)),
  });
  return { tl: u(sc.tl), tr: u(sc.tr), br: u(sc.br), bl: u(sc.bl) };
}

// Perspective-correct rendering via horizontal strip decomposition.
// tl/tr/br/bl are canvas pixel coords of the plate's 4 corners.
// Quality pipeline: multi-step halving → axis-aligned fast path or
// supersampled perspective rendering → high-quality composite.
function drawPerspective(ctx, img, tl, tr, br, bl) {
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  if (iw < 1 || ih < 1) return;

  // Bounding box of the output quad
  const bboxL = Math.floor(Math.min(tl.x, tr.x, br.x, bl.x));
  const bboxR = Math.ceil(Math.max(tl.x, tr.x, br.x, bl.x));
  const bboxT = Math.floor(Math.min(tl.y, tr.y, br.y, bl.y));
  const bboxB = Math.ceil(Math.max(tl.y, tr.y, br.y, bl.y));
  const plateW = bboxR - bboxL;
  const plateH = bboxB - bboxT;
  if (plateW < 1 || plateH < 1) return;

  // ── Step 1: multi-step halving ──
  // Canvas drawImage handles 2× downscale well but degrades at 4×+.
  // Halve the source progressively until it's close to the output size.
  const targetW = Math.max(plateW * 3, 600);
  let src = img, sw = iw, sh = ih;
  while (sw > targetW * 2 && sw > 2) {
    const half = document.createElement('canvas');
    half.width = Math.round(sw / 2);
    half.height = Math.round(sh / 2);
    const hCtx = half.getContext('2d');
    hCtx.imageSmoothingEnabled = true;
    hCtx.imageSmoothingQuality = 'high';
    hCtx.drawImage(src, 0, 0, half.width, half.height);
    src = half; sw = half.width; sh = half.height;
  }

  // ── Step 2: axis-aligned fast path ──
  // Near-rectangular plates bypass the band decomposition entirely
  // for a single, clean drawImage call.
  const eps = 1.5;
  if (Math.abs(tl.y - tr.y) < eps && Math.abs(bl.y - br.y) < eps &&
      Math.abs(tl.x - bl.x) < eps && Math.abs(tr.x - br.x) < eps) {
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, tl.x, tl.y, tr.x - tl.x, bl.y - tl.y);
    ctx.restore();
    return;
  }

  // ── Step 3: supersampled perspective ──
  const ssScale = Math.max(1, Math.min(sw / plateW, 4));
  const useOffscreen = ssScale > 1.5;

  let tCtx, sTl, sTr, sBr, sBl, offCanvas;
  if (useOffscreen) {
    offCanvas = document.createElement('canvas');
    offCanvas.width = Math.ceil(plateW * ssScale);
    offCanvas.height = Math.ceil(plateH * ssScale);
    tCtx = offCanvas.getContext('2d');
    const m = p => ({ x: (p.x - bboxL) * ssScale, y: (p.y - bboxT) * ssScale });
    sTl = m(tl); sTr = m(tr); sBr = m(br); sBl = m(bl);
  } else {
    tCtx = ctx;
    sTl = tl; sTr = tr; sBr = br; sBl = bl;
  }

  const outH = Math.max(
    Math.abs(sBl.y - sTl.y), Math.abs(sBr.y - sTr.y),
    Math.hypot(sBl.x - sTl.x, sBl.y - sTl.y), Math.hypot(sBr.x - sTr.x, sBr.y - sTr.y)
  );
  const STEPS = Math.max(120, Math.min(800, Math.ceil(outH)));
  tCtx.save();
  tCtx.imageSmoothingEnabled = true;
  tCtx.imageSmoothingQuality = 'high';
  for (let i = 0; i < STEPS; i++) {
    const overlap = 1.5 / outH;
    const t1 = Math.max(0, i / STEPS - overlap), t2 = Math.min(1, (i + 1) / STEPS + overlap), tm = (i + 0.5) / STEPS;
    const x00 = lerp(sTl.x, sBl.x, t1), y00 = lerp(sTl.y, sBl.y, t1);
    const x10 = lerp(sTr.x, sBr.x, t1), y10 = lerp(sTr.y, sBr.y, t1);
    const x01 = lerp(sTl.x, sBl.x, t2), y01 = lerp(sTl.y, sBl.y, t2);
    const x11 = lerp(sTr.x, sBr.x, t2), y11 = lerp(sTr.y, sBr.y, t2);
    const mlx = lerp(sTl.x, sBl.x, tm), mly = lerp(sTl.y, sBl.y, tm);
    const mrx = lerp(sTr.x, sBr.x, tm), mry = lerp(sTr.y, sBr.y, tm);
    const sym = sh * tm;
    const srcStripH = sh / STEPS;
    const avgDx = ((x01 - x00) + (x11 - x10)) / 2;
    const avgDy = ((y01 - y00) + (y11 - y10)) / 2;
    const a = (mrx - mlx) / sw;
    const b = (mry - mly) / sw;
    const c = avgDx / srcStripH;
    const d = avgDy / srcStripH;
    const e = mlx - c * sym;
    const f = mly - d * sym;
    tCtx.save();
    tCtx.beginPath();
    tCtx.moveTo(x00, y00); tCtx.lineTo(x10, y10);
    tCtx.lineTo(x11, y11); tCtx.lineTo(x01, y01);
    tCtx.closePath();
    tCtx.clip();
    tCtx.transform(a, b, c, d, e, f);
    tCtx.drawImage(src, 0, 0, sw, sh);
    tCtx.restore();
  }
  tCtx.restore();

  if (useOffscreen) {
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(offCanvas, bboxL, bboxT, plateW, plateH);
    ctx.restore();
  }
}

// Unified plate overlay renderer — fill bg, perspective draw, feather + boost.
function drawPlateOverlay(ctx, logoImg, ptl, ptr, pbr, pbl, bgColor, renderSource) {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // 1. Fill background behind plate (opaque base)
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(ptl.x, ptl.y); ctx.lineTo(ptr.x, ptr.y);
  ctx.lineTo(pbr.x, pbr.y); ctx.lineTo(pbl.x, pbl.y);
  ctx.closePath();
  ctx.fillStyle = bgColor;
  ctx.fill();
  ctx.restore();

  // 2. Draw perspective-transformed overlay
  drawPerspective(ctx, logoImg, ptl, ptr, pbr, pbl);

  // 3. Edge feather for front_plate_refined (anti-sticker effect)
  if (renderSource === 'front_plate_refined') {
    const plateDiag = Math.hypot(ptr.x - pbl.x, ptr.y - pbl.y);
    const featherPx = Math.max(0.5, Math.min(2, plateDiag * 0.004));

    // Sample surrounding luminosity at 8 boundary points for adaptation
    let lumSum = 0, lumCount = 0;
    const sampleOffsets = [
      { x: ptl.x - 3, y: ptl.y - 3 }, { x: ptr.x + 3, y: ptr.y - 3 },
      { x: pbr.x + 3, y: pbr.y + 3 }, { x: pbl.x - 3, y: pbl.y + 3 },
      { x: (ptl.x + ptr.x) / 2, y: ptl.y - 3 },
      { x: (pbl.x + pbr.x) / 2, y: pbl.y + 3 },
      { x: ptl.x - 3, y: (ptl.y + pbl.y) / 2 },
      { x: ptr.x + 3, y: (ptr.y + pbr.y) / 2 },
    ];
    try {
      for (const sp of sampleOffsets) {
        const sx = Math.round(Math.max(0, Math.min(W - 1, sp.x)));
        const sy = Math.round(Math.max(0, Math.min(H - 1, sp.y)));
        const px = ctx.getImageData(sx, sy, 1, 1).data;
        lumSum += (px[0] * 0.299 + px[1] * 0.587 + px[2] * 0.114) / 255;
        lumCount++;
      }
    } catch (_) { /* CORS / security — skip */ }
    const avgLum = lumCount > 0 ? lumSum / lumCount : 0.5;
    const brightAdj = avgLum < 0.3 ? 0.92 : avgLum > 0.7 ? 1.05 : 1.0;

    // Draw plate region to offscreen, apply feathered edges
    const off = document.createElement('canvas');
    off.width = W; off.height = H;
    const oCtx = off.getContext('2d');
    oCtx.drawImage(ctx.canvas, 0, 0);

    // Soft-edge mask via shadowBlur
    const mask = document.createElement('canvas');
    mask.width = W; mask.height = H;
    const mCtx = mask.getContext('2d');
    mCtx.clearRect(0, 0, W, H);
    mCtx.save();
    mCtx.shadowColor = 'white';
    mCtx.shadowBlur = featherPx;
    mCtx.shadowOffsetX = 0;
    mCtx.shadowOffsetY = 0;
    mCtx.fillStyle = 'white';
    mCtx.beginPath();
    mCtx.moveTo(ptl.x, ptl.y); mCtx.lineTo(ptr.x, ptr.y);
    mCtx.lineTo(pbr.x, pbr.y); mCtx.lineTo(pbl.x, pbl.y);
    mCtx.closePath();
    mCtx.fill();
    mCtx.restore();

    // Apply brightness filter + boost
    const boosted = document.createElement('canvas');
    boosted.width = W; boosted.height = H;
    const bCtx = boosted.getContext('2d');
    bCtx.filter = `brightness(${brightAdj}) saturate(1.15) contrast(1.08)`;
    bCtx.drawImage(off, 0, 0);
    bCtx.filter = 'none';

    // Composite: use mask as alpha over the plate region
    bCtx.globalCompositeOperation = 'destination-in';
    bCtx.drawImage(mask, 0, 0);
    bCtx.globalCompositeOperation = 'source-over';

    // Draw base image without plate overlay, then composite the feathered plate on top
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(ptl.x, ptl.y); ctx.lineTo(ptr.x, ptr.y);
    ctx.lineTo(pbr.x, pbr.y); ctx.lineTo(pbl.x, pbl.y);
    ctx.closePath(); ctx.clip();
    ctx.drawImage(boosted, 0, 0);
    ctx.restore();
    return;
  }

  // 4. Standard boost (non-front-plate) — saturate + contrast clipped to quad
  const tmp = document.createElement('canvas');
  tmp.width = W; tmp.height = H;
  const tCtx = tmp.getContext('2d');
  tCtx.filter = 'saturate(1.15) contrast(1.08)';
  tCtx.drawImage(ctx.canvas, 0, 0);
  tCtx.filter = 'none';
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(ptl.x, ptl.y); ctx.lineTo(ptr.x, ptr.y);
  ctx.lineTo(pbr.x, pbr.y); ctx.lineTo(pbl.x, pbl.y);
  ctx.closePath(); ctx.clip();
  ctx.drawImage(tmp, 0, 0);
  ctx.restore();
}


// ── Amélioration automatique — couleurs froides + flou sol adaptatif ──────────
// Combine la correction colorimétrique (autoEnhance) et un adoucissement
// du sol par flou CSS appliqué uniquement sur la zone basse via masque canvas.
// Aucun appel API, aucune déformation, transitions douces.
function applyFloorBlur(ctx, canvasEl, W, H) {
  const transStart = Math.round(H * 0.82);
  const floorFull  = Math.round(H * 0.92);
  const blurPx     = 2;

  // Copie floutée de l'image déjà traitée (couleurs appliquées)
  const off = document.createElement('canvas');
  off.width = W; off.height = H;
  const octx = off.getContext('2d');
  octx.filter = `blur(${blurPx}px)`;
  octx.drawImage(canvasEl, 0, 0);
  octx.filter = 'none';
  // Très léger éclaircissement pour "nettoyer" visuellement le sol
  octx.fillStyle = 'rgba(255,255,255,0.06)';
  octx.fillRect(0, 0, W, H);

  // Masque dégradé : transparent en haut (garde l'original), opaque en bas (flou)
  const mask = document.createElement('canvas');
  mask.width = W; mask.height = H;
  const mctx = mask.getContext('2d');
  const grad = mctx.createLinearGradient(0, transStart, 0, floorFull);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(0,0,0,1)');
  mctx.fillStyle = grad;
  mctx.fillRect(0, transStart, W, floorFull - transStart);
  mctx.fillStyle = 'black';
  mctx.fillRect(0, floorFull, W, H - floorFull);

  // Applique le masque à la copie floutée (destination-in = garde seulement les zones opaques du masque)
  octx.globalCompositeOperation = 'destination-in';
  octx.drawImage(mask, 0, 0);
  octx.globalCompositeOperation = 'source-over';

  // Superpose le sol flouté sur l'image principale
  ctx.drawImage(off, 0, 0);
}

// ── Amélioration photo style "pro" ────────────────────────────────────────────
// Reproduit le traitement appliqué par les outils IA haut de gamme :
//   1. Refroidissement WB marqué (supprime la dominante jaune/chaude LED)
//   2. Courbe S (ombres plus profondes, hautes lumières préservées)
//   3. Boost de saturation (bleus plus vifs, couleurs carrosserie plus engageantes)
function autoEnhance(ctx, W, H, intensity = 5, photoName = '') {
  const k = Math.max(0, Math.min(5, Number(intensity))) / 5; // 0 = aucun effet, 1 = pleine intensité
  if (k === 0) {
    console.log('[Enhance]', photoName, 'skipped (intensity=0)');
    return;
  }

  const id = ctx.getImageData(0, 0, W, H);
  const d  = id.data;
  const N  = d.length;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  // ── 1. Mesure la dominante réelle sur les mi-tons ──────────────────────
  // Les pixels trop sombres (<25) ou trop clairs (>235) ne portent pas
  // d'information sur la dominante (noirs, ciels brûlés, vitres, etc.)
  // → on les ignore pour estimer la balance des blancs.
  let rSum = 0, gSum = 0, bSum = 0, count = 0;
  const sampleStep = 4 * Math.max(1, Math.floor(N / 4 / 50000)); // ~50k samples max
  for (let i = 0; i < N; i += sampleStep) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const luma = r * 0.299 + g * 0.587 + b * 0.114;
    if (luma < 25 || luma > 235) continue;
    rSum += r; gSum += g; bSum += b;
    count++;
  }

  if (count < 100) {
    console.log('[Enhance]', photoName, 'aborted — too few mid-tone pixels', { count });
    return;
  }

  const rMean = rSum / count;
  const gMean = gSum / count;
  const bMean = bSum / count;
  const gray  = (rMean + gMean + bMean) / 3;

  // ── 2. Gains de balance des blancs (gray-world) ────────────────────────
  // Chaque canal est rééchelonné pour que sa moyenne rejoigne la moyenne
  // globale gris. On borne les gains pour éviter les corrections extrêmes
  // (ex : photo dominée par une seule couleur de carrosserie).
  let rGainFull = clamp(gray / Math.max(rMean, 1), 0.70, 1.40);
  let gGainFull = clamp(gray / Math.max(gMean, 1), 0.70, 1.40);
  let bGainFull = clamp(gray / Math.max(bMean, 1), 0.70, 1.40);

  // Léger biais froid quand il reste une dominante jaune mesurable.
  if (bMean < gMean) {
    bGainFull = clamp(bGainFull * 1.04, 0.70, 1.45);
    rGainFull = clamp(rGainFull * 0.98, 0.65, 1.40);
  }

  // Mix avec l'identité selon l'intensité demandée (0..1).
  const rGain = 1 + (rGainFull - 1) * k;
  const gGain = 1 + (gGainFull - 1) * k;
  const bGain = 1 + (bGainFull - 1) * k;

  // Saturation modérée (un peu plus douce que la version fixe d'avant).
  const sat = 1 + 0.15 * k;

  // ── 3. Application pixel-par-pixel avec soft-clip ──────────────────────
  // Si un canal dépasse 255 après gain, on remet tous les canaux à
  // l'échelle (proportionnel) pour préserver la teinte plutôt que de
  // brûler la zone en pur blanc.
  for (let i = 0; i < N; i += 4) {
    let r = d[i]     * rGain;
    let g = d[i + 1] * gGain;
    let b = d[i + 2] * bGain;

    const maxC = Math.max(r, g, b);
    if (maxC > 255) {
      const scale = 255 / maxC;
      r *= scale; g *= scale; b *= scale;
    }

    // Saturation autour de la luminance (préserve les valeurs neutres).
    const lum = r * 0.299 + g * 0.587 + b * 0.114;
    r = lum + (r - lum) * sat;
    g = lum + (g - lum) * sat;
    b = lum + (b - lum) * sat;

    d[i]     = clamp(Math.round(r), 0, 255);
    d[i + 1] = clamp(Math.round(g), 0, 255);
    d[i + 2] = clamp(Math.round(b), 0, 255);
  }

  ctx.putImageData(id, 0, 0);

  console.log('[Enhance]', photoName, {
    intensity,
    k: +k.toFixed(2),
    midToneSamples: count,
    midToneMean: { r: +rMean.toFixed(1), g: +gMean.toFixed(1), b: +bMean.toFixed(1) },
    gains: { r: +rGain.toFixed(3), g: +gGain.toFixed(3), b: +bGain.toFixed(3) },
    saturation: +sat.toFixed(2),
  });
}

// ── Lustrage des optiques — retouche IA locale au masque ─────────────────────
// Le front détecte les optiques, fabrique un masque, puis l'API réinvente
// uniquement la lentille du phare. Le reste de la voiture reste le canvas source.

function clamp01(v) {
  return Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
}

function normalizedPoint(p) {
  if (Array.isArray(p)) return { x: clamp01(Number(p[0])), y: clamp01(Number(p[1])) };
  return { x: clamp01(Number(p?.x)), y: clamp01(Number(p?.y)) };
}

function normalizeHeadlight(light) {
  const x1 = clamp01(Number(light?.x));
  const y1 = clamp01(Number(light?.y));
  const x2 = clamp01(Number(light?.x) + Number(light?.w));
  const y2 = clamp01(Number(light?.y) + Number(light?.h));
  const x = Math.min(x1, x2);
  const y = Math.min(y1, y2);
  const w = Math.max(0, Math.abs(x2 - x1));
  const h = Math.max(0, Math.abs(y2 - y1));
  const points = Array.isArray(light?.points)
    ? light.points.map(normalizedPoint).filter(p => Number.isFinite(p.x) && Number.isFinite(p.y))
    : [];

  return { x, y, w, h, points };
}

function expandPointAround(cx, cy, p, amount) {
  return {
    x: clamp01(cx + (p.x - cx) * (1 + amount)),
    y: clamp01(cy + (p.y - cy) * (1 + amount)),
  };
}

function drawHeadlightShape(ctx, light, W, H, expand = 0.04) {
  const cx = light.x + light.w / 2;
  const cy = light.y + light.h / 2;

  ctx.beginPath();
  if (light.points.length >= 3) {
    const pts = light.points.map(p => expandPointAround(cx, cy, p, expand));
    // Smooth the polygon with quadratic Bezier curves between midpoints.
    // This avoids hard polygon corners that the AI sometimes turns into
    // visible black lines along the lens edge.
    const n = pts.length;
    const mid = (a, b) => ({ x: (a.x + b.x) / 2 * W, y: (a.y + b.y) / 2 * H });
    const start = mid(pts[0], pts[1]);
    ctx.moveTo(start.x, start.y);
    for (let i = 1; i <= n; i++) {
      const p = pts[i % n];
      const q = pts[(i + 1) % n];
      const end = mid(p, q);
      ctx.quadraticCurveTo(p.x * W, p.y * H, end.x, end.y);
    }
    ctx.closePath();
  } else {
    const rx = Math.max(4, light.w * W * (0.56 + expand));
    const ry = Math.max(4, light.h * H * (0.56 + expand));
    ctx.ellipse(cx * W, cy * H, rx, ry, 0, 0, Math.PI * 2);
  }
  ctx.fill();
}

function drawHeadlightShapes(ctx, lights, W, H, expand = 0.04) {
  lights.forEach(light => drawHeadlightShape(ctx, light, W, H, expand));
}

// ── Headlight restoration pipeline ──────────────────────────────────────────
//
// PRIMARY MODE = full-image edit:
//   the whole photo is sent to the inpainting API with a tight mask that
//   covers ONLY the headlight optics. The strict prompt tells the model
//   to leave everything else alone. The result is validated by comparing
//   diffs inside vs outside the headlight regions: if the model touched
//   anything outside the masked area, we reject and retry once with an
//   even stricter prompt. If both attempts fail validation we fall back
//   to the per-headlight crop pipeline (kept available below).
//
// FALLBACK MODE = per-headlight crops:
//   one independent inpaint call per optic, each on a tight crop around
//   the headlight. Used only when the full-image mode is rejected by the
//   validator twice in a row.
//
// Why this order:
//   the user reported that the per-headlight crop pipeline produced
//   visible seams, missing optics, or grey blobs, while the full-image
//   ChatGPT-style prompt gave a premium-feeling result. Full-image is
//   now the default; per-headlight is a safety net.

// ── Per-headlight crop math (mirrors api/_lib/headlight/crop.js) ────────────
// Used by the FALLBACK pipeline only.
const HEADLIGHT_CROP_MARGIN = 0.6;

function pickHeadlightAspect(ratio) {
  if (ratio > 1.2)  return { workW: 1536, workH: 1024, size: '1536x1024' };
  if (ratio < 0.83) return { workW: 1024, workH: 1536, size: '1024x1536' };
  return { workW: 1024, workH: 1024, size: '1024x1024' };
}

function computeLightCrop(light, W, H, margin = HEADLIGHT_CROP_MARGIN) {
  const bx = light.x * W;
  const by = light.y * H;
  const bw = Math.max(1, light.w * W);
  const bh = Math.max(1, light.h * H);
  const cx = bx + bw / 2;
  const cy = by + bh / 2;

  let cropW = bw * (1 + margin);
  let cropH = bh * (1 + margin);

  let pick = pickHeadlightAspect(cropW / cropH);
  const targetAspect = pick.workW / pick.workH;
  if (cropW / cropH > targetAspect) cropH = cropW / targetAspect;
  else                              cropW = cropH * targetAspect;

  let sx = Math.round(cx - cropW / 2);
  let sy = Math.round(cy - cropH / 2);
  let sw = Math.round(cropW);
  let sh = Math.round(cropH);

  if (sx < 0) sx = 0;
  if (sy < 0) sy = 0;
  if (sx + sw > W) sx = Math.max(0, W - sw);
  if (sy + sh > H) sy = Math.max(0, H - sh);
  if (sw > W) { sx = 0; sw = W; }
  if (sh > H) { sy = 0; sh = H; }

  pick = pickHeadlightAspect(sw / sh);
  return {
    sourceX: sx, sourceY: sy, sourceW: sw, sourceH: sh,
    workW: pick.workW, workH: pick.workH, size: pick.size,
  };
}

function transformLightToCrop(light, crop, W, H) {
  return {
    x: (light.x * W - crop.sourceX) / crop.sourceW,
    y: (light.y * H - crop.sourceY) / crop.sourceH,
    w: (light.w * W) / crop.sourceW,
    h: (light.h * H) / crop.sourceH,
    points: (light.points || []).map(p => ({
      x: (p.x * W - crop.sourceX) / crop.sourceW,
      y: (p.y * H - crop.sourceY) / crop.sourceH,
    })),
  };
}

function dataURLBase64(dataURL) {
  return dataURL.split(',')[1] ?? '';
}

function computeMaskCoverage(maskCanvas) {
  const { width, height } = maskCanvas;
  const data = maskCanvas.getContext('2d').getImageData(0, 0, width, height).data;
  let transparent = 0;
  for (let i = 0; i < data.length; i += 4) if (data[i + 3] < 8) transparent++;
  return transparent / (width * height);
}

// Build the image+mask pair to send to the API for ONE headlight.
function createSingleHeadlightAssets(ctx, light, crop, W, H) {
  const localLight = transformLightToCrop(light, crop, W, H);

  const image = document.createElement('canvas');
  image.width = crop.workW;
  image.height = crop.workH;
  const ictx = image.getContext('2d');
  ictx.imageSmoothingEnabled = true;
  ictx.imageSmoothingQuality = 'high';
  ictx.drawImage(
    ctx.canvas,
    crop.sourceX, crop.sourceY, crop.sourceW, crop.sourceH,
    0, 0, crop.workW, crop.workH,
  );

  const mask = document.createElement('canvas');
  mask.width = crop.workW;
  mask.height = crop.workH;
  const mctx = mask.getContext('2d');
  mctx.fillStyle = 'rgba(0,0,0,1)';
  mctx.fillRect(0, 0, crop.workW, crop.workH);
  mctx.globalCompositeOperation = 'destination-out';
  mctx.fillStyle = 'rgba(0,0,0,1)';
  mctx.filter = `blur(${Math.max(2, Math.round(Math.min(crop.workW, crop.workH) * 0.003))}px)`;
  drawHeadlightShape(mctx, localLight, crop.workW, crop.workH, 0.06);
  mctx.filter = 'none';
  drawHeadlightShape(mctx, localLight, crop.workW, crop.workH, 0.04);
  mctx.globalCompositeOperation = 'source-over';

  const maskCoverage = computeMaskCoverage(mask);
  return {
    imageCanvas: image,
    maskCanvas: mask,
    localLight,
    imageBase64: dataURLBase64(image.toDataURL('image/jpeg', 0.94)),
    imageMime: 'image/jpeg',
    maskBase64: dataURLBase64(mask.toDataURL('image/png')),
    maskCoverage,
    size: crop.size,
  };
}

// Tighter assets for the per-headlight REFINE pass (runs after the full-image
// edit). Differences with createSingleHeadlightAssets:
//   - the polygon is SHRUNK by 1–3% (negative expand) so the editable area is
//     strictly inside the lens, never touching the headlight rim or
//     surrounding bodywork. This prevents the "détourage" / black line we
//     saw on earlier per-headlight runs.
//   - feather is gentler and applied with a smaller blur — keeps the
//     transition smooth without leaking onto the body.
function createRefineAssets(ctx, light, crop, W, H, maskMode = 'tight') {
  const localLight = transformLightToCrop(light, crop, W, H);

  const image = document.createElement('canvas');
  image.width = crop.workW;
  image.height = crop.workH;
  const ictx = image.getContext('2d');
  ictx.imageSmoothingEnabled = true;
  ictx.imageSmoothingQuality = 'high';
  ictx.drawImage(
    ctx.canvas,
    crop.sourceX, crop.sourceY, crop.sourceW, crop.sourceH,
    0, 0, crop.workW, crop.workH,
  );

  const mask = document.createElement('canvas');
  mask.width = crop.workW;
  mask.height = crop.workH;
  const mctx = mask.getContext('2d');
  mctx.fillStyle = 'rgba(0,0,0,1)';
  mctx.fillRect(0, 0, crop.workW, crop.workH);
  mctx.globalCompositeOperation = 'destination-out';

  const layers = (MASK_MODE_CONFIGS[maskMode] || MASK_MODE_CONFIGS.tight).refine.layers;
  for (const layer of layers) {
    const blurPx = layer.blurFactor > 0
      ? Math.max(2, Math.round(Math.min(crop.workW, crop.workH) * layer.blurFactor))
      : 0;
    mctx.filter = blurPx > 0 ? `blur(${blurPx}px)` : 'none';
    drawHeadlightShape(mctx, localLight, crop.workW, crop.workH, layer.expand);
  }
  mctx.filter = 'none';
  mctx.globalCompositeOperation = 'source-over';

  const maskCoverage = computeMaskCoverage(mask);
  return {
    imageCanvas: image,
    maskCanvas: mask,
    localLight,
    imageBase64: dataURLBase64(image.toDataURL('image/jpeg', 0.95)),
    imageMime: 'image/jpeg',
    maskBase64: dataURLBase64(mask.toDataURL('image/png')),
    maskCoverage,
    size: crop.size,
  };
}

// Mean per-pixel RGB diff (0-255) inside an alpha-mask region (alpha<8 = masked).
function diffInsideMask(beforeCanvas, afterCanvas, maskCanvas) {
  const W = beforeCanvas.width;
  const H = beforeCanvas.height;
  const before = beforeCanvas.getContext('2d').getImageData(0, 0, W, H).data;
  const after = afterCanvas.getContext('2d').getImageData(0, 0, W, H).data;
  const mask = maskCanvas.getContext('2d').getImageData(0, 0, W, H).data;
  let total = 0, count = 0;
  for (let i = 0; i < before.length; i += 4) {
    if (mask[i + 3] >= 8) continue;
    const d = Math.abs(before[i] - after[i])
            + Math.abs(before[i + 1] - after[i + 1])
            + Math.abs(before[i + 2] - after[i + 2]);
    total += d / 3;
    count++;
  }
  return count ? total / count : 0;
}

// Per-channel mean RGB of a canvas inside a binary alpha mask (alpha>8 = keep).
function meanRgbInMask(canvas, maskCanvas) {
  const W = canvas.width;
  const H = canvas.height;
  const d = canvas.getContext('2d').getImageData(0, 0, W, H).data;
  const m = maskCanvas.getContext('2d').getImageData(0, 0, W, H).data;
  let sumR = 0, sumG = 0, sumB = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (m[i + 3] < 8) continue;
    sumR += d[i]; sumG += d[i + 1]; sumB += d[i + 2]; n++;
  }
  if (!n) return { r: 0, g: 0, b: 0 };
  return { r: sumR / n, g: sumG / n, b: sumB / n };
}

// Apply per-channel gain (cR, cG, cB) to a canvas in place. Used to nudge the
// AI-generated crop toward the source photo's color stats so the composite
// edge doesn't show a tint shift around the optic.
function applyColorGain(canvas, gainR, gainG, gainB) {
  const W = canvas.width;
  const H = canvas.height;
  const cctx = canvas.getContext('2d');
  const id = cctx.getImageData(0, 0, W, H);
  const d = id.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i]     = Math.max(0, Math.min(255, Math.round(d[i]     * gainR)));
    d[i + 1] = Math.max(0, Math.min(255, Math.round(d[i + 1] * gainG)));
    d[i + 2] = Math.max(0, Math.min(255, Math.round(d[i + 2] * gainB)));
  }
  cctx.putImageData(id, 0, 0);
}

// Anti-artifact validator for the REFINE pass.
// Compares the full-image baseline crop with the AI's refined crop and
// rejects responses that introduce visible defects:
//   - meanRing  : diff in the ~4% ring around the optic. If high, the AI
//                 likely drew a black line / dark border along the lens
//                 edge (the user's main pain point).
//   - meanOut   : diff in the rest of the crop (bumper, body, grille).
//                 If high, the AI touched the bodywork it shouldn't have.
//   - meanIn    : diff inside the optic. Must be > a tiny floor so the
//                 refine actually changed something. If sky-high (> 60),
//                 the AI probably redesigned the lens.
//   - varianceLum : luminance variance INSIDE the optic. If too low, the
//                 refine flattened the lens into a uniform gray patch.
//
// When validation rejects, the orchestrator KEEPS the full-image baseline
// for that optic instead of compositing the refine on top.
function validateRefinePass(baselineCrop, refinedCrop, localLight) {
  const W = baselineCrop.width;
  const H = baselineCrop.height;

  // Three masks in source-crop pixels:
  // - inside: the strict optic interior
  // - ring:   thin band around the optic (where dark-line artifacts appear)
  // - outside: rest of the crop (bumper / body)
  const inside = document.createElement('canvas');
  inside.width = W; inside.height = H;
  const ictx = inside.getContext('2d');
  ictx.fillStyle = 'rgba(255,255,255,1)';
  drawHeadlightShape(ictx, localLight, W, H, -0.02);  // shrunk

  const ring = document.createElement('canvas');
  ring.width = W; ring.height = H;
  const rctx = ring.getContext('2d');
  rctx.fillStyle = 'rgba(255,255,255,1)';
  drawHeadlightShape(rctx, localLight, W, H, 0.06);   // outer
  rctx.globalCompositeOperation = 'destination-out';
  drawHeadlightShape(rctx, localLight, W, H, 0.02);   // punch inner
  rctx.globalCompositeOperation = 'source-over';

  const outside = document.createElement('canvas');
  outside.width = W; outside.height = H;
  const octx = outside.getContext('2d');
  octx.fillStyle = 'rgba(255,255,255,1)';
  octx.fillRect(0, 0, W, H);
  octx.globalCompositeOperation = 'destination-out';
  drawHeadlightShape(octx, localLight, W, H, 0.08);   // erase optic + margin
  octx.globalCompositeOperation = 'source-over';

  const bData = baselineCrop.getContext('2d').getImageData(0, 0, W, H).data;
  const rData = refinedCrop.getContext('2d').getImageData(0, 0, W, H).data;
  const iMask = ictx.getImageData(0, 0, W, H).data;
  const rMask = rctx.getImageData(0, 0, W, H).data;
  const oMask = octx.getImageData(0, 0, W, H).data;

  let inSum = 0, inN = 0;
  let inLumSum = 0, inLumSqSum = 0;
  let ringSum = 0, ringN = 0;
  let outSum = 0, outN = 0;
  let darkPixelsInRing = 0;

  for (let i = 0; i < bData.length; i += 4) {
    const d = (Math.abs(bData[i]     - rData[i])
             + Math.abs(bData[i + 1] - rData[i + 1])
             + Math.abs(bData[i + 2] - rData[i + 2])) / 3;
    if (iMask[i + 3] > 8) {
      inSum += d; inN++;
      const lum = (rData[i] + rData[i + 1] + rData[i + 2]) / 3;
      inLumSum += lum;
      inLumSqSum += lum * lum;
    }
    if (rMask[i + 3] > 8) {
      ringSum += d; ringN++;
      // Did the refine drop a dark pixel where the baseline was brighter?
      const baseLum = (bData[i] + bData[i + 1] + bData[i + 2]) / 3;
      const refLum  = (rData[i] + rData[i + 1] + rData[i + 2]) / 3;
      if (refLum < 50 && baseLum - refLum > 40) darkPixelsInRing++;
    }
    if (oMask[i + 3] > 8) {
      outSum += d; outN++;
    }
  }

  const meanIn    = inN   ? inSum   / inN   : 0;
  const meanRing  = ringN ? ringSum / ringN : 0;
  const meanOut   = outN  ? outSum  / outN  : 0;
  const meanLum   = inN   ? inLumSum / inN  : 0;
  const varianceLum = inN > 1 ? (inLumSqSum / inN) - meanLum * meanLum : 0;
  const pctDarkRing = ringN ? (darkPixelsInRing / ringN) * 100 : 0;

  const THRESHOLDS = {
    meanInMin: 1.0,         // refine must actually do something
    meanInMax: 60,          // not a redesign
    meanRingMax: 22,        // no big drift at the optic edge
    meanOutMax: 8,          // body unchanged
    pctDarkRingMax: 0.5,    // no significant dark pixels added at the edge
    varianceLumMin: 40,     // not a uniform gray patch
  };

  const reasons = [];
  if (meanIn < THRESHOLDS.meanInMin)
    reasons.push(`no-change: meanIn ${meanIn.toFixed(2)} < ${THRESHOLDS.meanInMin}`);
  if (meanIn > THRESHOLDS.meanInMax)
    reasons.push(`redesign-suspected: meanIn ${meanIn.toFixed(2)} > ${THRESHOLDS.meanInMax}`);
  if (meanRing > THRESHOLDS.meanRingMax)
    reasons.push(`ring-drift: meanRing ${meanRing.toFixed(2)} > ${THRESHOLDS.meanRingMax} (dark line risk)`);
  if (pctDarkRing > THRESHOLDS.pctDarkRingMax)
    reasons.push(`dark-line: ${pctDarkRing.toFixed(2)}% dark pixels added to the optic ring`);
  if (meanOut > THRESHOLDS.meanOutMax)
    reasons.push(`outside-changed: meanOut ${meanOut.toFixed(2)} > ${THRESHOLDS.meanOutMax}`);
  if (varianceLum < THRESHOLDS.varianceLumMin)
    reasons.push(`gray-patch: varianceLum ${varianceLum.toFixed(1)} < ${THRESHOLDS.varianceLumMin}`);

  return {
    ok: reasons.length === 0,
    reasons,
    stats: { meanIn, meanRing, meanOut, varianceLum, pctDarkRing, meanLum },
    thresholds: THRESHOLDS,
  };
}

// Composite a per-headlight AI result back into the source canvas at the
// crop's source rectangle, alpha-blended via the headlight polygon mask.
//
// Before blending we measure the AI's color drift in the area AROUND the
// optic (where the source crop and the AI's "unmasked" region should match)
// and apply a small per-channel correction to the AI canvas so the tint of
// the restored optic stays consistent with its surroundings. This is the
// cheap fix for the "visible détourage" the user saw with the per-headlight
// fallback.
function compositeSingleHeadlight(ctx, editedImg, light, crop, W, H, blendParams = null) {
  const params = {
    expandOuter: 0.06,
    expandInner: 0.035,
    edgeBlur: 0.0025,
    aiOpacity: 1.0,
    ...(blendParams || {}),
  };
  const localLight = transformLightToCrop(light, crop, W, H);

  // Draw AI result at crop's SOURCE size (downsample from workW×workH).
  const ai = document.createElement('canvas');
  ai.width = crop.sourceW;
  ai.height = crop.sourceH;
  const aictx = ai.getContext('2d');
  aictx.imageSmoothingEnabled = true;
  aictx.imageSmoothingQuality = 'high';
  aictx.drawImage(editedImg, 0, 0, crop.sourceW, crop.sourceH);

  // Snapshot source crop (the original pixels of this region in the photo).
  const sourceCrop = document.createElement('canvas');
  sourceCrop.width = crop.sourceW;
  sourceCrop.height = crop.sourceH;
  sourceCrop.getContext('2d').drawImage(
    ctx.canvas,
    crop.sourceX, crop.sourceY, crop.sourceW, crop.sourceH,
    0, 0, crop.sourceW, crop.sourceH,
  );

  // Build the "context" mask = pixels OUTSIDE the headlight polygon but
  // INSIDE the crop (i.e. the body/bumper surroundings).
  const contextMask = document.createElement('canvas');
  contextMask.width = crop.sourceW;
  contextMask.height = crop.sourceH;
  const cmctx = contextMask.getContext('2d');
  cmctx.fillStyle = 'rgba(255,255,255,1)';
  cmctx.fillRect(0, 0, crop.sourceW, crop.sourceH);
  cmctx.globalCompositeOperation = 'destination-out';
  drawHeadlightShape(cmctx, localLight, crop.sourceW, crop.sourceH, 0.08); // exclude the optic + small ring
  cmctx.globalCompositeOperation = 'source-over';

  // Color-match: shift AI gains so its "context" mean matches the source's.
  // Clamp gains to a sane range so a bad measurement can't over-correct.
  const srcMean = meanRgbInMask(sourceCrop, contextMask);
  const aiMean = meanRgbInMask(ai, contextMask);
  const safe = (v) => Math.max(0.85, Math.min(1.15, v));
  const gR = aiMean.r > 1 ? safe(srcMean.r / aiMean.r) : 1;
  const gG = aiMean.g > 1 ? safe(srcMean.g / aiMean.g) : 1;
  const gB = aiMean.b > 1 ? safe(srcMean.b / aiMean.b) : 1;
  if (Math.abs(gR - 1) > 0.01 || Math.abs(gG - 1) > 0.01 || Math.abs(gB - 1) > 0.01) {
    applyColorGain(ai, gR, gG, gB);
    console.log('[Headlights] color-match gain', { gR: gR.toFixed(3), gG: gG.toFixed(3), gB: gB.toFixed(3) });
  }

  // Build the alpha mask in source-crop pixels.
  const alpha = document.createElement('canvas');
  alpha.width = crop.sourceW;
  alpha.height = crop.sourceH;
  const actx = alpha.getContext('2d');
  actx.fillStyle = 'rgba(255,255,255,1)';
  actx.filter = `blur(${Math.max(3, Math.round(Math.min(crop.sourceW, crop.sourceH) * params.edgeBlur))}px)`;
  drawHeadlightShape(actx, localLight, crop.sourceW, crop.sourceH, params.expandOuter);
  actx.filter = 'none';
  drawHeadlightShape(actx, localLight, crop.sourceW, crop.sourceH, params.expandInner);

  aictx.globalCompositeOperation = 'destination-in';
  aictx.drawImage(alpha, 0, 0);
  aictx.globalCompositeOperation = 'source-over';

  // Place into the main canvas at the crop's source location.
  const prevAlpha = ctx.globalAlpha;
  ctx.globalAlpha = params.aiOpacity;
  ctx.drawImage(ai, crop.sourceX, crop.sourceY);
  ctx.globalAlpha = prevAlpha;

  return { aiCanvas: ai, alphaCanvas: alpha };
}

// Legacy local polish — only runs when the server explicitly authorizes it
// via HEADLIGHT_AI_FALLBACK_LOCAL=true. Kept on purpose minimal: it does NOT
// claim to produce a premium AI render. It only cleans the masked region with
// a desaturate+brighten pass so the photo is still usable when the AI is down.
function localPolishHeadlights(ctx, W, H, lights) {
  if (!lights.length) return;
  const region = document.createElement('canvas');
  region.width = W;
  region.height = H;
  const rctx = region.getContext('2d');
  rctx.drawImage(ctx.canvas, 0, 0);

  const id = rctx.getImageData(0, 0, W, H);
  const d = id.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    const desat = lum + (r - lum) * 0.3;
    d[i]     = Math.min(255, desat * 1.05);
    d[i + 1] = Math.min(255, (lum + (g - lum) * 0.3) * 1.05);
    d[i + 2] = Math.min(255, (lum + (b - lum) * 0.3) * 1.08);
    // suppress amber tint when channel imbalance suggests oxidation
    if (r > 150 && g > 120 && b < 140 && (max - min) > 20) {
      d[i + 2] = Math.min(255, d[i + 2] + 18);
      d[i + 1] = Math.min(255, d[i + 1] + 4);
      d[i]     = Math.min(255, d[i] - 6);
    }
  }
  rctx.putImageData(id, 0, 0);

  const alpha = document.createElement('canvas');
  alpha.width = W;
  alpha.height = H;
  const actx = alpha.getContext('2d');
  actx.fillStyle = 'rgba(255,255,255,1)';
  actx.filter = `blur(${Math.max(3, Math.round(Math.min(W, H) * 0.003))}px)`;
  drawHeadlightShapes(actx, lights, W, H, 0.06);
  actx.filter = 'none';
  drawHeadlightShapes(actx, lights, W, H, 0.03);

  rctx.globalCompositeOperation = 'destination-in';
  rctx.drawImage(alpha, 0, 0);
  rctx.globalCompositeOperation = 'source-over';
  ctx.drawImage(region, 0, 0);
}

async function detectHeadlights(b64) {
  try {
    const r = await fetch("/api/headlights", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ b64 }),
    });
    const data = await r.json();
    const lights = Array.isArray(data.lights)
      ? data.lights.map(normalizeHeadlight).filter(l => l.w > 0.015 && l.h > 0.015)
      : [];
    console.log(`[Headlights] ${lights.length} phare(s) détecté(s)`, lights);
    return lights;
  } catch(e) {
    console.error("[Headlights] Erreur détection:", e);
    return [];
  }
}

// Debug mode is enabled by appending ?headlightDebug=1 to the URL. When on:
//   - the server returns the mask + raw AI output
//   - we expose the original/mask/AI/composite canvases on
//     `window.__headlightDebug` for inspection in the devtools console.
function isHeadlightDebugEnabled() {
  if (typeof window === "undefined") return false;
  try {
    return new URLSearchParams(window.location.search).get("headlightDebug") === "1";
  } catch { return false; }
}

// ?headlightStrategy=full-image-only   → ignore the validator, never fall back
// ?headlightStrategy=per-headlight-only → skip full-image, go straight to crops
// ?headlightStrategy=auto (default)     → full-image first, fallback if rejected
function getHeadlightStrategyOverride() {
  if (typeof window === "undefined") return "auto";
  try {
    const v = new URLSearchParams(window.location.search).get("headlightStrategy");
    if (v === "full-image-only" || v === "per-headlight-only") return v;
    return "auto";
  } catch { return "auto"; }
}

function getHeadlightMaskMode() {
  if (typeof window === "undefined") return "tight";
  try {
    const v = new URLSearchParams(window.location.search).get("headlightMask");
    if (v && MASK_MODE_CONFIGS[v]) return v;
    return "tight";
  } catch { return "tight"; }
}

const HEADLIGHT_MODES = ['auto', 'full-photo-identical'];

function getHeadlightMode() {
  if (typeof window === "undefined") return "auto";
  try {
    const v = new URLSearchParams(window.location.search).get("headlightMode");
    if (v && HEADLIGHT_MODES.includes(v)) return v;
    return "auto";
  } catch { return "auto"; }
}

function isForceRejectedEnabled() {
  if (typeof window === "undefined") return false;
  try {
    return new URLSearchParams(window.location.search).get("forceRejected") === "1";
  } catch { return false; }
}

function getHeadlightPolishStrength() {
  if (typeof window === "undefined") return SAFE_POLISH_PRESETS.medium;
  try {
    const v = new URLSearchParams(window.location.search).get("headlightPolish");
    if (v && SAFE_POLISH_PRESETS[v]) return SAFE_POLISH_PRESETS[v];
  } catch { /* ignore */ }
  return SAFE_POLISH_PRESETS.medium;
}

// Build a colored "diff map" canvas where pixel intensity = |before - after|.
// Used only in debug to make hidden drift visible.
function buildDiffMap(beforeCanvas, afterCanvas) {
  const W = beforeCanvas.width;
  const H = beforeCanvas.height;
  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  const octx = out.getContext('2d');
  const oid = octx.createImageData(W, H);
  const od = oid.data;
  const a = beforeCanvas.getContext('2d').getImageData(0, 0, W, H).data;
  const b = afterCanvas.getContext('2d').getImageData(0, 0, W, H).data;
  for (let i = 0; i < a.length; i += 4) {
    const d = (Math.abs(a[i] - b[i]) + Math.abs(a[i+1] - b[i+1]) + Math.abs(a[i+2] - b[i+2])) / 3;
    const v = Math.min(255, Math.round(d * 4)); // amplify for visibility
    od[i] = v;            // red channel = diff intensity
    od[i + 1] = 0;
    od[i + 2] = 0;
    od[i + 3] = 255;
  }
  octx.putImageData(oid, 0, 0);
  return out;
}

// Threshold below which we consider the AI returned no visible change in the
// masked region. Mean per-pixel RGB delta on a 0–255 scale.
const HEADLIGHT_NOOP_THRESHOLD = 4;

// ── Full-image mode (PRIMARY) ───────────────────────────────────────────────

// OpenAI gpt-image-1 supported edit sizes. We snap the work canvas to the
// closest aspect so the image+mask we send share the AI output's proportions.
function getFullImageWorkSize(W, H) {
  const ratio = W / Math.max(1, H);
  if (ratio > 1.2)  return { workW: 1536, workH: 1024, size: '1536x1024' };
  if (ratio < 0.83) return { workW: 1024, workH: 1536, size: '1024x1536' };
  return { workW: 1024, workH: 1024, size: '1024x1024' };
}

// Build the (image, mask) pair for the full-image edit:
//   - image: full photo, downsampled to the work size
//   - mask: opaque black everywhere EXCEPT the headlight polygons, which
//           are punched transparent (= editable). Light feather to avoid
//           a hard seam at the edges.
function createFullImageEditAssets(ctx, W, H, lights, maskMode = 'tight') {
  const { workW, workH, size } = getFullImageWorkSize(W, H);

  const image = document.createElement('canvas');
  image.width = workW;
  image.height = workH;
  const ictx = image.getContext('2d');
  ictx.imageSmoothingEnabled = true;
  ictx.imageSmoothingQuality = 'high';
  ictx.drawImage(ctx.canvas, 0, 0, workW, workH);

  const mask = document.createElement('canvas');
  mask.width = workW;
  mask.height = workH;
  const mctx = mask.getContext('2d');
  mctx.fillStyle = 'rgba(0,0,0,1)';
  mctx.fillRect(0, 0, workW, workH);
  mctx.globalCompositeOperation = 'destination-out';
  mctx.fillStyle = 'rgba(0,0,0,1)';

  const layers = (MASK_MODE_CONFIGS[maskMode] || MASK_MODE_CONFIGS.tight).fullImage.layers;
  for (const layer of layers) {
    const blurPx = layer.blurFactor > 0
      ? Math.max(2, Math.round(Math.min(workW, workH) * layer.blurFactor))
      : 0;
    mctx.filter = blurPx > 0 ? `blur(${blurPx}px)` : 'none';
    drawHeadlightShapes(mctx, lights, workW, workH, layer.expand);
  }
  mctx.filter = 'none';
  mctx.globalCompositeOperation = 'source-over';

  let maskCoverage = computeMaskCoverage(mask);

  if (maskMode === 'lens' && maskCoverage < 0.001) {
    console.warn(`[Headlights] lens mask too small (${(maskCoverage * 100).toFixed(3)}%), falling back to tight`);
    return createFullImageEditAssets(ctx, W, H, lights, 'tight');
  }

  console.log(`[Headlights] mask mode = ${maskMode}`);
  console.log(`[Headlights] lens mask coverage = ${(maskCoverage * 100).toFixed(2)}%`);

  return {
    imageCanvas: image,
    maskCanvas: mask,
    imageBase64: dataURLBase64(image.toDataURL('image/jpeg', 0.95)),
    imageMime: 'image/jpeg',
    maskBase64: dataURLBase64(mask.toDataURL('image/png')),
    maskCoverage,
    workW,
    workH,
    size,
  };
}

// Validate that the AI only changed pixels INSIDE the headlight polygons.
// Returns { ok, reasons: [], stats }.
//
// Reality check on the thresholds:
//   - gpt-image-1 RE-ENCODES the whole image even when the mask is
//     respected. The unmasked area is never bit-identical to the input
//     — JPEG/PNG re-encoding alone produces ~5-15 of mean RGB diff.
//   - The composite step only takes pixels INSIDE the mask from the AI,
//     so any drift outside is NEVER visible to the user. The user only
//     sees a "seam" if the drift exists in a ring AROUND the mask
//     (where the alpha gradient blends AI pixels with original pixels).
//
// We therefore:
//   - allow significant `meanOut` (model re-encoding is normal),
//   - track a `meanRing` diff in the ~3% ring around each headlight
//     polygon and reject only if that ring is too different (true seam
//     predictor),
//   - keep `pctHighOut` (catastrophic redesigns) and `meanIn` (no-op
//     detection) as hard floors.
const VALIDATOR_THRESHOLDS = {
  meanInMin: 2,
  meanOutMax: 45,
  meanRingMax: 40,
  pctHighOutMax: 50,
  structuralDiffMax: 80,
};

function validateFullImageResult(beforeCanvas, afterCanvas, lights) {
  const W = beforeCanvas.width;
  const H = beforeCanvas.height;

  // Inside mask: opaque white inside headlight polygons.
  const hl = document.createElement('canvas');
  hl.width = W;
  hl.height = H;
  const hctx = hl.getContext('2d');
  hctx.fillStyle = 'rgba(255,255,255,1)';
  drawHeadlightShapes(hctx, lights, W, H, 0.05);

  // Ring mask: outside the inner polygon but inside an expanded one.
  const ring = document.createElement('canvas');
  ring.width = W;
  ring.height = H;
  const rctx = ring.getContext('2d');
  rctx.fillStyle = 'rgba(255,255,255,1)';
  drawHeadlightShapes(rctx, lights, W, H, 0.12);   // outer
  rctx.globalCompositeOperation = 'destination-out';
  drawHeadlightShapes(rctx, lights, W, H, 0.03);    // punch the inner
  rctx.globalCompositeOperation = 'source-over';

  const before = beforeCanvas.getContext('2d').getImageData(0, 0, W, H).data;
  const after  = afterCanvas.getContext('2d').getImageData(0, 0, W, H).data;
  const inMask = hctx.getImageData(0, 0, W, H).data;
  const ringMask = rctx.getImageData(0, 0, W, H).data;

  let sumIn = 0, countIn = 0;
  let sumOut = 0, countOut = 0;
  let sumRing = 0, countRing = 0;
  let highOut = 0;
  let structuralOut = 0;

  for (let i = 0; i < before.length; i += 4) {
    const d = (Math.abs(before[i]     - after[i])
             + Math.abs(before[i + 1] - after[i + 1])
             + Math.abs(before[i + 2] - after[i + 2])) / 3;
    const inside = inMask[i + 3] > 8;
    const inRing = ringMask[i + 3] > 8;
    if (inside) {
      sumIn += d; countIn++;
    } else {
      sumOut += d; countOut++;
      if (d > 40) highOut++;
      if (d > 80) structuralOut++;
    }
    if (inRing) {
      sumRing += d; countRing++;
    }
  }

  const meanIn   = countIn   ? sumIn   / countIn   : 0;
  const meanOut  = countOut  ? sumOut  / countOut  : 0;
  const meanRing = countRing ? sumRing / countRing : 0;
  const pctHighOut = countOut ? (highOut / countOut) * 100 : 0;
  const pctStructural = countOut ? (structuralOut / countOut) * 100 : 0;

  const reasons = [];
  if (meanIn < VALIDATOR_THRESHOLDS.meanInMin) {
    reasons.push(`no-op: meanDiff inside ${meanIn.toFixed(1)} < ${VALIDATOR_THRESHOLDS.meanInMin}`);
  }
  if (meanOut > VALIDATOR_THRESHOLDS.meanOutMax) {
    reasons.push(`outside-drift: meanDiff outside ${meanOut.toFixed(1)} > ${VALIDATOR_THRESHOLDS.meanOutMax}`);
  }
  if (meanRing > VALIDATOR_THRESHOLDS.meanRingMax) {
    reasons.push(`seam-predicted: ring meanDiff ${meanRing.toFixed(1)} > ${VALIDATOR_THRESHOLDS.meanRingMax}`);
  }
  if (pctHighOut > VALIDATOR_THRESHOLDS.pctHighOutMax) {
    reasons.push(`bleed: ${pctHighOut.toFixed(2)}% of pixels outside the headlights have a strong diff`);
  }
  if (pctStructural > 5) {
    reasons.push(`structural: ${pctStructural.toFixed(2)}% of outside pixels changed > 80 — likely redesigned`);
  }

  return {
    ok: reasons.length === 0,
    reasons,
    stats: { meanIn, meanOut, meanRing, pctHighOut, pctStructural },
    thresholds: VALIDATOR_THRESHOLDS,
  };
}

function validateLensHalo(beforeCanvas, afterCanvas, lights) {
  const W = beforeCanvas.width;
  const H = beforeCanvas.height;

  const outer = document.createElement('canvas');
  outer.width = W; outer.height = H;
  const octx = outer.getContext('2d');
  octx.fillStyle = 'rgba(255,255,255,1)';
  drawHeadlightShapes(octx, lights, W, H, 0.02);
  octx.globalCompositeOperation = 'destination-out';
  drawHeadlightShapes(octx, lights, W, H, -0.04);
  octx.globalCompositeOperation = 'source-over';

  const bData = beforeCanvas.getContext('2d').getImageData(0, 0, W, H).data;
  const aData = afterCanvas.getContext('2d').getImageData(0, 0, W, H).data;
  const ringMask = octx.getImageData(0, 0, W, H).data;

  let ringSum = 0, ringN = 0, changedPixels = 0, darkLinePixels = 0;

  for (let i = 0; i < bData.length; i += 4) {
    if (ringMask[i + 3] < 8) continue;
    const d = (Math.abs(bData[i] - aData[i])
             + Math.abs(bData[i + 1] - aData[i + 1])
             + Math.abs(bData[i + 2] - aData[i + 2])) / 3;
    ringSum += d;
    ringN++;
    if (d > 12) changedPixels++;
    const bLum = (bData[i] + bData[i + 1] + bData[i + 2]) / 3;
    const aLum = (aData[i] + aData[i + 1] + aData[i + 2]) / 3;
    if (aLum < 45 && bLum - aLum > 35) darkLinePixels++;
  }

  const meanRing = ringN ? ringSum / ringN : 0;
  const pctRingChanged = ringN ? (changedPixels / ringN) * 100 : 0;
  const darkLine = ringN ? (darkLinePixels / ringN) * 100 : 0;

  const reasons = [];
  if (meanRing > LENS_HALO_THRESHOLDS.meanRingMax)
    reasons.push(`halo: meanRing ${meanRing.toFixed(2)} > ${LENS_HALO_THRESHOLDS.meanRingMax}`);
  if (pctRingChanged > LENS_HALO_THRESHOLDS.pctRingChangedMax)
    reasons.push(`ring-changed: ${pctRingChanged.toFixed(2)}% > ${LENS_HALO_THRESHOLDS.pctRingChangedMax}%`);
  if (darkLine > LENS_HALO_THRESHOLDS.darkLineMax)
    reasons.push(`dark-line: ${darkLine.toFixed(2)}% > ${LENS_HALO_THRESHOLDS.darkLineMax}%`);

  const ok = reasons.length === 0;
  console.log(`[Headlights] halo validation = ${JSON.stringify({
    ok, meanRing: +meanRing.toFixed(2),
    pctRingChanged: +pctRingChanged.toFixed(2),
    darkLine: +darkLine.toFixed(2),
  })}`);

  return { ok, reasons, stats: { meanRing, pctRingChanged, darkLine }, thresholds: LENS_HALO_THRESHOLDS };
}

function validateFullPhotoIdentical(beforeCanvas, afterCanvas, lights) {
  const W = beforeCanvas.width;
  const H = beforeCanvas.height;

  const hl = document.createElement('canvas');
  hl.width = W; hl.height = H;
  const hctx = hl.getContext('2d');
  hctx.fillStyle = 'rgba(255,255,255,1)';
  drawHeadlightShapes(hctx, lights, W, H, 0.05);

  const ring = document.createElement('canvas');
  ring.width = W; ring.height = H;
  const rctx = ring.getContext('2d');
  rctx.fillStyle = 'rgba(255,255,255,1)';
  drawHeadlightShapes(rctx, lights, W, H, 0.12);
  rctx.globalCompositeOperation = 'destination-out';
  drawHeadlightShapes(rctx, lights, W, H, 0.03);
  rctx.globalCompositeOperation = 'source-over';

  const before = beforeCanvas.getContext('2d').getImageData(0, 0, W, H).data;
  const after = afterCanvas.getContext('2d').getImageData(0, 0, W, H).data;
  const inMask = hctx.getImageData(0, 0, W, H).data;
  const ringMask = rctx.getImageData(0, 0, W, H).data;

  let sumIn = 0, countIn = 0;
  let sumOut = 0, countOut = 0;
  let sumRing = 0, countRing = 0;
  let highOut = 0;

  for (let i = 0; i < before.length; i += 4) {
    const d = (Math.abs(before[i] - after[i])
             + Math.abs(before[i + 1] - after[i + 1])
             + Math.abs(before[i + 2] - after[i + 2])) / 3;
    const inside = inMask[i + 3] > 8;
    const inRing = ringMask[i + 3] > 8;
    if (inside) {
      sumIn += d; countIn++;
    } else {
      sumOut += d; countOut++;
      if (d > 40) highOut++;
    }
    if (inRing) {
      sumRing += d; countRing++;
    }
  }

  const meanIn = countIn ? sumIn / countIn : 0;
  const meanOut = countOut ? sumOut / countOut : 0;
  const meanRing = countRing ? sumRing / countRing : 0;
  const pctHighOut = countOut ? (highOut / countOut) * 100 : 0;

  const T = FULL_PHOTO_IDENTICAL_THRESHOLDS;
  const reasons = [];
  if (meanIn < T.meanInMin)
    reasons.push(`no-op: meanIn ${meanIn.toFixed(1)} < ${T.meanInMin}`);
  if (meanOut > T.meanOutMax)
    reasons.push(`outside-drift: meanOut ${meanOut.toFixed(1)} > ${T.meanOutMax}`);
  if (meanRing > T.meanRingMax)
    reasons.push(`ring-artifact: meanRing ${meanRing.toFixed(1)} > ${T.meanRingMax}`);
  if (pctHighOut > T.pctHighOutMax)
    reasons.push(`bleed: ${pctHighOut.toFixed(2)}% > ${T.pctHighOutMax}%`);

  return {
    ok: reasons.length === 0,
    reasons,
    stats: { meanIn, meanOut, meanRing, pctHighOut },
    thresholds: T,
  };
}

function applyLensEnhancement(ctx, W, H, lights) {
  const lensMask = document.createElement('canvas');
  lensMask.width = W;
  lensMask.height = H;
  const lctx = lensMask.getContext('2d');
  lctx.fillStyle = 'rgba(255,255,255,1)';
  lctx.filter = `blur(${Math.max(1, Math.round(Math.min(W, H) * 0.0015))}px)`;
  drawHeadlightShapes(lctx, lights, W, H, -0.06);
  lctx.filter = 'none';
  drawHeadlightShapes(lctx, lights, W, H, -0.08);

  const id = ctx.getImageData(0, 0, W, H);
  const d = id.data;
  const lm = lctx.getImageData(0, 0, W, H).data;

  const blurred = blurredCopy(ctx.canvas, Math.max(4, Math.round(Math.min(W, H) * 0.02)));
  const bData = blurred.getContext('2d').getImageData(0, 0, W, H).data;

  const sCurve = (v) => {
    const t = v / 255;
    const s = 3 * t * t - 2 * t * t * t;
    return Math.max(0, Math.min(255, Math.round((t + (s - t) * 0.08) * 255)));
  };

  for (let i = 0; i < d.length; i += 4) {
    if (lm[i + 3] < 8) continue;
    const alpha = lm[i + 3] / 255;

    let r = sCurve(d[i]);
    let g = sCurve(d[i + 1]);
    let b = sCurve(d[i + 2]);

    r = Math.min(255, r + 3);
    g = Math.min(255, g + 3);
    b = Math.min(255, b + 4);

    const strength = 0.3;
    const sr = Math.max(0, Math.min(255, Math.round(r + strength * (r - bData[i]))));
    const sg = Math.max(0, Math.min(255, Math.round(g + strength * (g - bData[i + 1]))));
    const sb = Math.max(0, Math.min(255, Math.round(b + strength * (b - bData[i + 2]))));

    d[i]     = Math.round(d[i]     + (sr - d[i])     * alpha);
    d[i + 1] = Math.round(d[i + 1] + (sg - d[i + 1]) * alpha);
    d[i + 2] = Math.round(d[i + 2] + (sb - d[i + 2]) * alpha);
  }
  ctx.putImageData(id, 0, 0);
  console.log('[Headlights] lens post-process applied (dehaze + clarity + unsharp mask)');
}

function applySafeLensPolish(ctx, W, H, lights, maskMode = 'tight', preset = null) {
  const P = preset || getHeadlightPolishStrength();
  const debug = isHeadlightDebugEnabled();
  const expand = maskMode === 'lens' ? -0.06 : 0.02;
  const expandInner = maskMode === 'lens' ? -0.08 : -0.01;

  const lensMask = document.createElement('canvas');
  lensMask.width = W;
  lensMask.height = H;
  const lctx = lensMask.getContext('2d');
  lctx.fillStyle = 'rgba(255,255,255,1)';
  lctx.filter = `blur(${Math.max(2, Math.round(Math.min(W, H) * 0.002))}px)`;
  drawHeadlightShapes(lctx, lights, W, H, expand);
  lctx.filter = 'none';
  drawHeadlightShapes(lctx, lights, W, H, expandInner);

  if (debug && window.__headlightDebug) {
    window.__headlightDebug.safePolishMask = lensMask.toDataURL('image/png');
  }

  let beforeCanvas = null;
  if (debug) {
    beforeCanvas = document.createElement('canvas');
    beforeCanvas.width = W;
    beforeCanvas.height = H;
    beforeCanvas.getContext('2d').drawImage(ctx.canvas, 0, 0);
  }

  const id = ctx.getImageData(0, 0, W, H);
  const d = id.data;
  const lm = lctx.getImageData(0, 0, W, H).data;

  const blurSigma = Math.max(4, Math.round(Math.min(W, H) * 0.018));
  const blurred = blurredCopy(ctx.canvas, blurSigma);
  const bData = blurred.getContext('2d').getImageData(0, 0, W, H).data;

  let yellowSum = 0, yellowAfterSum = 0, deltaSum = 0, maskPx = 0;

  for (let i = 0; i < d.length; i += 4) {
    if (lm[i + 3] < 8) continue;
    const alpha = lm[i + 3] / 255;
    maskPx++;

    const or = d[i], og = d[i + 1], ob = d[i + 2];
    let r = or, g = og, b = ob;

    const yellowness = (r + g) / 2 - b;
    yellowSum += Math.max(0, yellowness);

    // 1. Yellow/orange reduction — strongest lever
    if (yellowness > P.yellowThreshold) {
      const correction = Math.min(yellowness * P.yellowFactor, P.yellowMax);
      r = Math.max(0, Math.round(r - correction * 0.50));
      g = Math.max(0, Math.round(g - correction * 0.40));
      b = Math.min(255, Math.round(b + correction * 0.30));
    }

    // 2. Yellow desaturation — pull yellow/orange hues toward neutral gray
    const maxC = Math.max(r, g, b), minC = Math.min(r, g, b);
    const chroma = maxC - minC;
    if (chroma > 10 && r > b && g > b) {
      const lum = (r + g + b) / 3;
      const desat = P.desatYellow;
      r = Math.round(r + (lum - r) * desat);
      g = Math.round(g + (lum - g) * desat);
      b = Math.round(b + (lum - b) * desat);
    }

    // 3. Opacity lift — brighten cloudy/opaque zones (low luminance in lens)
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    if (lum < 180) {
      const lift = P.opacityLift * (1 - lum / 180);
      r = Math.min(255, Math.round(r + lift));
      g = Math.min(255, Math.round(g + lift));
      b = Math.min(255, Math.round(b + lift));
    }

    // 4. S-curve dehaze — increase local contrast
    const t_r = r / 255, t_g = g / 255, t_b = b / 255;
    const s_r = 3 * t_r * t_r - 2 * t_r * t_r * t_r;
    const s_g = 3 * t_g * t_g - 2 * t_g * t_g * t_g;
    const s_b = 3 * t_b * t_b - 2 * t_b * t_b * t_b;
    r = Math.max(0, Math.min(255, Math.round((t_r + (s_r - t_r) * P.dehaze) * 255)));
    g = Math.max(0, Math.min(255, Math.round((t_g + (s_g - t_g) * P.dehaze) * 255)));
    b = Math.max(0, Math.min(255, Math.round((t_b + (s_b - t_b) * P.dehaze) * 255)));

    // 5. Brightness boost — shift toward transparent white
    r = Math.min(255, r + P.brightness[0]);
    g = Math.min(255, g + P.brightness[1]);
    b = Math.min(255, b + P.brightness[2]);

    // 6. Unsharp mask — sharpening
    const sh = P.sharpen;
    const sr = Math.max(0, Math.min(255, Math.round(r + sh * (r - bData[i]))));
    const sg = Math.max(0, Math.min(255, Math.round(g + sh * (g - bData[i + 1]))));
    const sb = Math.max(0, Math.min(255, Math.round(b + sh * (b - bData[i + 2]))));

    // 7. Highlight preservation — protect specular reflections from clipping
    const origLum = 0.299 * or + 0.587 * og + 0.114 * ob;
    const protect = origLum > 235 ? Math.min(1, (origLum - 235) / 20) : 0;
    const fr = sr + (or - sr) * protect;
    const fg = sg + (og - sg) * protect;
    const fb = sb + (ob - sb) * protect;

    // Blend with feathered mask alpha
    d[i]     = Math.round(d[i]     + (fr - d[i])     * alpha);
    d[i + 1] = Math.round(d[i + 1] + (fg - d[i + 1]) * alpha);
    d[i + 2] = Math.round(d[i + 2] + (fb - d[i + 2]) * alpha);

    const newYellowness = (d[i] + d[i + 1]) / 2 - d[i + 2];
    yellowAfterSum += Math.max(0, newYellowness);
    deltaSum += Math.abs(d[i] - or) + Math.abs(d[i + 1] - og) + Math.abs(d[i + 2] - ob);
  }
  ctx.putImageData(id, 0, 0);

  const stats = {
    yellowBefore: maskPx > 0 ? +(yellowSum / maskPx).toFixed(1) : 0,
    yellowAfter: maskPx > 0 ? +(yellowAfterSum / maskPx).toFixed(1) : 0,
    meanDelta: maskPx > 0 ? +(deltaSum / (maskPx * 3)).toFixed(1) : 0,
    maskPixels: maskPx,
  };

  if (debug && window.__headlightDebug) {
    window.__headlightDebug.beforeSafePolish = beforeCanvas?.toDataURL('image/png');
    window.__headlightDebug.afterSafePolish = ctx.canvas.toDataURL('image/png');
    window.__headlightDebug.safePolishStats = stats;
    window.__headlightDebug.safePolishPreset = P.label;
  }

  console.log(`[Headlights] safe-polish strength = ${P.label}`);
  console.log(`[Headlights] safe-polish stats = yellowBefore:${stats.yellowBefore} yellowAfter:${stats.yellowAfter} meanDelta:${stats.meanDelta}`);
}

// Blur a canvas at sigma pixels using the native canvas filter (browser GPU
// accelerated). Returns a new canvas.
function blurredCopy(sourceCanvas, sigmaPx) {
  const W = sourceCanvas.width;
  const H = sourceCanvas.height;
  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  const c = out.getContext('2d');
  c.filter = `blur(${sigmaPx}px)`;
  c.drawImage(sourceCanvas, 0, 0);
  c.filter = 'none';
  return out;
}

// Frequency separation: recombine the AI's LOW-frequency (color, transparency,
// the things we actually want from the model) with the ORIGINAL's HIGH-frequency
// (sharp edges, fine plastic texture, reflector dots — the things the
// downsample-then-upsample round-trip with gpt-image-1 destroys).
//
//   result = original + boost × (blur(AI) - blur(original))
//
// Algebraically equivalent to:
//   result = blur(AI)×boost + original - blur(original)×boost
//
// When boost=1.0 this collapses to the textbook frequency separation
//   blur(AI) + (original - blur(original)).
//
// We keep each pixel sharp at the photo's native resolution while taking the
// AI's color shift in the masked area. The boost factor lets us amplify the
// AI's low-frequency effect (yellow → clear shift) when the raw AI output is
// too conservative for product taste.
function frequencySeparation(aiCanvas, originalCanvas, sigmaPx, boost = 1.0) {
  const W = aiCanvas.width;
  const H = aiCanvas.height;
  const blurredAI = blurredCopy(aiCanvas, sigmaPx);
  const blurredOrig = blurredCopy(originalCanvas, sigmaPx);

  const result = document.createElement('canvas');
  result.width = W;
  result.height = H;
  const rctx = result.getContext('2d');
  const rid = rctx.createImageData(W, H);
  const rd = rid.data;

  const aData  = blurredAI.getContext('2d').getImageData(0, 0, W, H).data;
  const oData  = originalCanvas.getContext('2d').getImageData(0, 0, W, H).data;
  const obData = blurredOrig.getContext('2d').getImageData(0, 0, W, H).data;
  const k = boost;

  for (let i = 0; i < aData.length; i += 4) {
    rd[i]     = Math.max(0, Math.min(255, oData[i]     + k * (aData[i]     - obData[i])));
    rd[i + 1] = Math.max(0, Math.min(255, oData[i + 1] + k * (aData[i + 1] - obData[i + 1])));
    rd[i + 2] = Math.max(0, Math.min(255, oData[i + 2] + k * (aData[i + 2] - obData[i + 2])));
    rd[i + 3] = 255;
  }
  rctx.putImageData(rid, 0, 0);
  return result;
}

// Composite a full-image AI result back into the source canvas, only inside
// the feathered headlight mask. Uses frequency separation to keep the
// photo's native sharpness while taking the AI's restored color.
//
// Tuning notes:
//   sigmaFactor controls the frequency cutoff (in % of min(W,H)).
//     - too SMALL: the AI's color shift only survives at very coarse scales,
//       so the mid-frequency yellowing of the lens stays in the result.
//     - too LARGE: we'd start losing real detail (reflector ridges, plastic
//       texture) and inheriting the AI's softness.
//     0.015 keeps detail < ~30px sharp while capturing the full yellow→clear
//     shift across the 100-300px lens scale.
//   aiBoost amplifies the low-frequency difference between AI and original.
//     1.0 = pure frequency separation. >1.0 pushes more of the AI's effect
//     through. Safe up to ~1.4; beyond that color drift starts to bleed.
function compositeFullImageResult(ctx, editedImg, lights, W, H, blendParams = null) {
  const params = {
    expandOuter: 0.07,
    expandInner: 0.025,
    edgeBlur: 0.004,
    aiOpacity: 1.0,
    sigmaFactor: 0.015,   // was 0.006 — bumped so mid-frequency yellowing makes it into low-pass
    aiBoost: 1.25,        // amplify AI low-freq shift by 25% to make the restoration clearly visible
    ...(blendParams || {}),
  };

  // 1. Snapshot the original (current ctx state).
  const original = document.createElement('canvas');
  original.width = W;
  original.height = H;
  original.getContext('2d').drawImage(ctx.canvas, 0, 0);

  // 2. Render the AI result up to W×H (this is where the resolution loss lives).
  const aiAtSourceSize = document.createElement('canvas');
  aiAtSourceSize.width = W;
  aiAtSourceSize.height = H;
  const aictx = aiAtSourceSize.getContext('2d');
  aictx.imageSmoothingEnabled = true;
  aictx.imageSmoothingQuality = 'high';
  aictx.drawImage(editedImg, 0, 0, W, H);

  // 3. Frequency separation: AI's color + Original's sharp detail.
  const sigma = Math.max(8, Math.round(Math.min(W, H) * params.sigmaFactor));
  const fused = frequencySeparation(aiAtSourceSize, original, sigma, params.aiBoost);
  console.log(`[Headlights] frequency separation σ=${sigma}px boost=${params.aiBoost}× (photo ${W}×${H}, native detail preserved)`);

  // 4. Build the alpha mask (smooth Bezier polygons, strong outer feather).
  const alpha = document.createElement('canvas');
  alpha.width = W;
  alpha.height = H;
  const actx = alpha.getContext('2d');
  actx.fillStyle = 'rgba(255,255,255,1)';
  actx.filter = `blur(${Math.max(4, Math.round(Math.min(W, H) * params.edgeBlur))}px)`;
  drawHeadlightShapes(actx, lights, W, H, params.expandOuter);
  actx.filter = 'none';
  drawHeadlightShapes(actx, lights, W, H, params.expandInner);

  // 5. Apply alpha mask to the fused canvas.
  const fctx = fused.getContext('2d');
  fctx.globalCompositeOperation = 'destination-in';
  fctx.drawImage(alpha, 0, 0);
  fctx.globalCompositeOperation = 'source-over';

  // 6. Draw fused onto the source canvas.
  const prevAlpha = ctx.globalAlpha;
  ctx.globalAlpha = params.aiOpacity;
  ctx.drawImage(fused, 0, 0);
  ctx.globalAlpha = prevAlpha;

  return { aiAtSourceSize, fusedCanvas: fused, alphaCanvas: alpha };
}

// Full-replace composite: draw the AI image directly onto the canvas.
// The AI regenerates the entire photo (no mask sent), so we use its
// output as-is, upscaled to the original resolution.
function compositeFullReplace(ctx, editedImg, W, H) {
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(editedImg, 0, 0, W, H);
  console.log(`[Headlights] full-replace composite — AI image drawn directly at ${W}×${H}`);
  return {};
}

// One full-image attempt. Returns { ok, validation, ... } without committing
// the composite to ctx — the caller commits only on success.
async function tryFullImageRestoration(ctx, W, H, lights, opts) {
  const { strength = 'restore', strictPrompt = null, debug = false, attempt, maskMode = 'tight', customValidator = null } = opts;
  const assets = createFullImageEditAssets(ctx, W, H, lights, maskMode);
  console.log(`[Headlights] full-image attempt ${attempt}`, {
    workSize: assets.size,
    maskCoveragePct: (assets.maskCoverage * 100).toFixed(2) + '%',
    lights: lights.length,
    strictPrompt: !!strictPrompt,
    maskMode,
  });

  const url = debug ? '/api/lustrage-pro?debug=1' : '/api/lustrage-pro';
  const payload = {
    imageBase64: assets.imageBase64,
    imageMime: assets.imageMime,
    size: assets.size,
    mode: 'ai',
    strength,
  };
  if (strictPrompt) payload.prompt = strictPrompt;

  console.log(`[Headlights] sending full image WITHOUT mask — AI regenerates entire photo`);

  let r, data;
  try {
    r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    data = await r.json().catch(() => ({}));
  } catch (e) {
    console.warn(`[Headlights] full-image attempt ${attempt} network error:`, e.message);
    return { ok: false, reason: 'network', error: e.message, assets };
  }

  if (!r.ok || !data?.imageBase64) {
    console.warn(`[Headlights] full-image attempt ${attempt} API failed`,
      { status: r.status, error: data?.error });
    return {
      ok: false,
      reason: 'ai-failed',
      status: r.status,
      error: data?.error,
      details: data?.details,
      fallback: data?.fallback,
      assets,
    };
  }

  console.log(`[Headlights] full-image attempt ${attempt} AI response`, {
    provider: data.provider,
    model: data.model,
    strength: data.strength,
    outDims: data.outDims,
    effectiveSize: data.effectiveSize,
  });

  const editedImg = await loadImg(`data:image/png;base64,${data.imageBase64}`);

  // Render the AI output onto a W×H canvas so we can compare pixel-for-pixel
  // with the original (which is already at W×H on `ctx`).
  const aiAtSourceSize = document.createElement('canvas');
  aiAtSourceSize.width = W;
  aiAtSourceSize.height = H;
  const aictx = aiAtSourceSize.getContext('2d');
  aictx.imageSmoothingEnabled = true;
  aictx.imageSmoothingQuality = 'high';
  aictx.drawImage(editedImg, 0, 0, W, H);

  const beforeCanvas = document.createElement('canvas');
  beforeCanvas.width = W;
  beforeCanvas.height = H;
  beforeCanvas.getContext('2d').drawImage(ctx.canvas, 0, 0);

  const validatorFn = customValidator || validateFullImageResult;
  const validation = validatorFn(beforeCanvas, aiAtSourceSize, lights);
  console.log(`[Headlights] full-image attempt ${attempt} validation`, {
    ok: validation.ok,
    reasons: validation.reasons,
    stats: {
      meanIn: validation.stats.meanIn.toFixed(2),
      meanOut: validation.stats.meanOut.toFixed(2),
      meanRing: validation.stats.meanRing.toFixed(2),
      pctHighOut: validation.stats.pctHighOut.toFixed(3) + '%',
    },
    thresholds: validation.thresholds,
  });

  if (validation.ok && maskMode === 'lens') {
    const halo = validateLensHalo(beforeCanvas, aiAtSourceSize, lights);
    console.log(`[Headlights] halo check (informational only): ${JSON.stringify({ ok: halo.ok, meanRing: +halo.stats.meanRing.toFixed(2), pctRingChanged: +halo.stats.pctRingChanged.toFixed(2) })}`);
  }

  return {
    ok: validation.ok,
    reason: validation.ok ? null : 'validation',
    assets,
    editedImg,
    aiAtSourceSize,
    beforeCanvas,
    validation,
    aiResponse: data,
    attempt,
  };
}

// ── Per-headlight fallback (FALLBACK ONLY) ──────────────────────────────────

// One independent API call per headlight, in parallel. Each call sees only
// a tight crop around ONE optic, so the model can't redesign anything else.
// Compositing is done sequentially after all calls return.
async function callHeadlightApiForLight(idx, assets, strength, debug) {
  const url = debug ? "/api/lustrage-pro?debug=1" : "/api/lustrage-pro";
  const payload = {
    imageBase64: assets.imageBase64,
    imageMime: assets.imageMime,
    maskBase64: assets.maskBase64,
    size: assets.size,
    maskCoverage: assets.maskCoverage,
    mode: "ai",
    strength,
  };
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data?.imageBase64) {
      console.warn(`[Headlights:#${idx}] API failed`, { status: r.status, error: data?.error, details: data?.details });
      return { ok: false, idx, status: r.status, error: data?.error || "ai-failed", details: data?.details, fallback: data?.fallback };
    }
    return { ok: true, idx, ...data };
  } catch (e) {
    console.warn(`[Headlights:#${idx}] Network error:`, e.message);
    return { ok: false, idx, error: e.message, reason: "network" };
  }
}

async function aiPolishHeadlightsPerLight(ctx, W, H, lights, opts = {}) {
  const { strength = "restore" } = opts;
  const debug = opts.debug || isHeadlightDebugEnabled();

  // 1. Compute crops + assets for each headlight (synchronous, snapshots ctx).
  const tasks = lights.map((light, idx) => {
    const crop = computeLightCrop(light, W, H);
    const assets = createSingleHeadlightAssets(ctx, light, crop, W, H);
    console.log(`[Headlights:#${idx}] crop`, {
      bbox: { x: light.x, y: light.y, w: light.w, h: light.h },
      crop: { x: crop.sourceX, y: crop.sourceY, w: crop.sourceW, h: crop.sourceH },
      sendSize: crop.size,
      maskCoveragePct: (assets.maskCoverage * 100).toFixed(2) + "%",
    });
    return { idx, light, crop, assets };
  });

  if (debug) {
    window.__headlightDebug = window.__headlightDebug || {};
    window.__headlightDebug.fallback = {
      strategy: "per-headlight",
      count: tasks.length,
      lights: [],
    };
    for (const t of tasks) {
      window.__headlightDebug.fallback.lights.push({
        idx: t.idx,
        light: t.light,
        crop: t.crop,
        sentImage: t.assets.imageCanvas,
        sentMask: t.assets.maskCanvas,
        maskCoverage: t.assets.maskCoverage,
      });
    }
    console.log("[Headlights:debug] per-headlight debug stored at window.__headlightDebug.fallback");
  }

  // 2. Parallel API calls (one per headlight).
  const apiResults = await Promise.all(tasks.map(t => callHeadlightApiForLight(t.idx, t.assets, strength, debug)));

  // 3. Sequential composite (avoid canvas race conditions).
  const perLight = [];
  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    const apiR = apiResults[i];
    const dbg = debug ? window.__headlightDebug.fallback.lights[i] : null;

    if (!apiR.ok) {
      console.warn(`[Headlights:#${i}] skipped — API failed`);
      perLight.push({ idx: i, ok: false, error: apiR.error });
      if (dbg) dbg.error = apiR.error;
      continue;
    }

    try {
      const editedImg = await loadImg(`data:image/png;base64,${apiR.imageBase64}`);
      console.log(`[Headlights:#${i}] AI response`, {
        provider: apiR.provider,
        model: apiR.model,
        strength: apiR.strength,
        outDims: apiR.outDims,
        effectiveSize: apiR.effectiveSize,
      });

      // Snapshot just the crop area BEFORE for diff.
      const before = document.createElement("canvas");
      before.width = t.crop.sourceW;
      before.height = t.crop.sourceH;
      before.getContext("2d").drawImage(
        ctx.canvas,
        t.crop.sourceX, t.crop.sourceY, t.crop.sourceW, t.crop.sourceH,
        0, 0, t.crop.sourceW, t.crop.sourceH,
      );

      const { aiCanvas, alphaCanvas } = compositeSingleHeadlight(ctx, editedImg, t.light, t.crop, W, H, apiR.blend);

      const after = document.createElement("canvas");
      after.width = t.crop.sourceW;
      after.height = t.crop.sourceH;
      after.getContext("2d").drawImage(
        ctx.canvas,
        t.crop.sourceX, t.crop.sourceY, t.crop.sourceW, t.crop.sourceH,
        0, 0, t.crop.sourceW, t.crop.sourceH,
      );

      // Build a binary mask in source-crop pixels for the diff (same shape as composite).
      const localLight = transformLightToCrop(t.light, t.crop, W, H);
      const diffMask = document.createElement("canvas");
      diffMask.width = t.crop.sourceW;
      diffMask.height = t.crop.sourceH;
      const dmctx = diffMask.getContext("2d");
      dmctx.fillStyle = "rgba(0,0,0,1)";
      dmctx.fillRect(0, 0, t.crop.sourceW, t.crop.sourceH);
      dmctx.globalCompositeOperation = "destination-out";
      drawHeadlightShape(dmctx, localLight, t.crop.sourceW, t.crop.sourceH, 0.03);
      dmctx.globalCompositeOperation = "source-over";

      const meanDiff = diffInsideMask(before, after, diffMask);
      console.log(`[Headlights:#${i}] post-AI diff (masked region): ${meanDiff.toFixed(2)} /255`);

      if (dbg) {
        dbg.aiResultRaw = editedImg;
        dbg.aiResultAtCropSize = aiCanvas;
        dbg.alphaCanvas = alphaCanvas;
        dbg.beforeCrop = before;
        dbg.afterCrop = after;
        dbg.diffMask = diffMask;
        dbg.meanDiff = meanDiff;
        dbg.provider = apiR.provider;
        dbg.model = apiR.model;
      }

      if (meanDiff < HEADLIGHT_NOOP_THRESHOLD) {
        // Rollback this single headlight to its original pixels.
        ctx.drawImage(before, t.crop.sourceX, t.crop.sourceY);
        console.warn(`[Headlights:#${i}] no visible change (${meanDiff.toFixed(1)}/255), rolled back`);
        perLight.push({ idx: i, ok: false, reason: "no-visible-change", meanDiff, provider: apiR.provider, model: apiR.model });
      } else {
        console.log(`[Headlights:#${i}] composite ✓ (provider=${apiR.provider}, meanDiff=${meanDiff.toFixed(1)})`);
        perLight.push({ idx: i, ok: true, provider: apiR.provider, model: apiR.model, meanDiff });
      }
    } catch (e) {
      console.warn(`[Headlights:#${i}] composite error:`, e.message);
      perLight.push({ idx: i, ok: false, error: e.message, reason: "composite" });
    }
  }

  const successCount = perLight.filter(r => r.ok).length;
  console.log(`[Headlights] done — ${successCount}/${perLight.length} optics restored`);

  // If EVERY headlight failed and the server told us local fallback is OK,
  // run the legacy filter on the still-original canvas.
  if (successCount === 0 && apiResults.some(r => !r.ok && r.fallback === "local")) {
    console.warn("[Headlights] all AI calls failed, running server-authorized local fallback");
    localPolishHeadlights(ctx, W, H, lights);
    return { ok: true, provider: "local-fallback", model: null, perLight };
  }

  return {
    ok: successCount > 0,
    perLight,
    provider: perLight.find(r => r.ok)?.provider,
    model: perLight.find(r => r.ok)?.model,
  };
}

// ── Top-level orchestrator (PRIMARY = full-image, FALLBACK = per-light) ─────
//
// Honors a strategy override via the URL:
//   ?headlightStrategy=auto              (default) → full-image then per-light
//   ?headlightStrategy=full-image-only   → never fall back, always composite
//                                          the best full-image result (use this
//                                          to inspect the raw AI render even
//                                          when the validator would reject it)
//   ?headlightStrategy=per-headlight-only → skip full-image entirely
//
// Order in auto:
//   1. full-image attempt 1 with the default strict prompt
//   2. validate (meanIn/meanOut/meanRing/pctHighOut)
//   3. on failure, full-image attempt 2 with the stricter retry prompt
//   4. on second failure, fallback to per-headlight crops
//   5. if even per-headlight fails AND the server authorizes local fallback,
//      run the legacy canvas-only filter
function persistDebugAttempt(debug, attempt) {
  if (!debug) return;
  const before = attempt.beforeCanvas;
  const after = attempt.aiAtSourceSize;
  const entry = {
    mode: "full-image",
    attempt: attempt.attempt,
    validation: attempt.validation,
    sentImage: attempt.assets?.imageCanvas,
    sentMask: attempt.assets?.maskCanvas,
    aiAtSourceSize: after,
    before,
    diffMap: before && after ? buildDiffMap(before, after) : null,
    ok: attempt.ok,
    reason: attempt.reason,
    error: attempt.error,
    status: attempt.status,
  };
  window.__headlightDebug.attempts.push(entry);
  console.log(`[Headlights:debug] attempt ${entry.attempt} stored at window.__headlightDebug.attempts[${window.__headlightDebug.attempts.length - 1}]`);
}

// ── REFINE PASS (per-optic polish on top of an accepted full-image result) ──
//
// Runs AFTER the full-image edit has been accepted. For each detected
// headlight, builds a tight crop + a SHRUNK mask (interior of the lens only),
// asks the model to polish sharpness / transparency, then validates the
// response against an anti-artifact checklist (dark lines, gray patches,
// bodywork drift, redesign). If the refine validates, it's composited over
// the full-image baseline at that optic. If it doesn't, the baseline is
// preserved untouched.
async function callHeadlightRefineApi(idx, assets, strength, debug, maskMode = 'tight') {
  const url = debug ? "/api/lustrage-pro?debug=1" : "/api/lustrage-pro";
  let prompt = "Refine only this car headlight lens. Make it clearer, sharper, more transparent and professionally polished while preserving the exact original headlight shape, internal reflector details, lens geometry, perspective, highlights and surrounding bodywork. Remove yellow oxidation, haze and cloudiness. Do not redesign the headlight, do not change its shape, do not add black lines, seams, borders, scratches, shadows, stickers, fake reflections, blur or artifacts. The result must remain photorealistic and match the original car.";
  if (maskMode === 'lens') {
    prompt += ' Modify only the transparent headlight lens interior. Do not repaint any circular area around the headlight. Do not alter hood, fender, bumper, paint, panel gaps or reflections. No halo, no circular patch, no oval repaint, no seam, no dark border.';
  }
  const payload = {
    imageBase64: assets.imageBase64,
    imageMime: assets.imageMime,
    maskBase64: assets.maskBase64,
    size: assets.size,
    maskCoverage: assets.maskCoverage,
    mode: "ai",
    strength,
    prompt,
  };
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data?.imageBase64) {
      console.warn(`[Headlights:refine#${idx}] API failed`, { status: r.status, error: data?.error });
      return { ok: false, idx, status: r.status, error: data?.error || "ai-failed", details: data?.details };
    }
    return { ok: true, idx, ...data };
  } catch (e) {
    console.warn(`[Headlights:refine#${idx}] Network error:`, e.message);
    return { ok: false, idx, error: e.message, reason: "network" };
  }
}

async function runRefinePass(ctx, lights, W, H, opts = {}) {
  const { strength = "restore", debug = false, maskMode = 'tight' } = opts;

  // Snapshot the post-full-image baseline so we can rollback per-optic on reject.
  const baseline = document.createElement('canvas');
  baseline.width = W;
  baseline.height = H;
  baseline.getContext('2d').drawImage(ctx.canvas, 0, 0);

  const tasks = lights.map((light, idx) => {
    const crop = computeLightCrop(light, W, H);
    const assets = createRefineAssets(ctx, light, crop, W, H, maskMode);
    console.log(`[Headlights:refine#${idx}] crop`, {
      bbox: { x: light.x.toFixed(3), y: light.y.toFixed(3), w: light.w.toFixed(3), h: light.h.toFixed(3) },
      sendSize: crop.size,
      maskCoveragePct: (assets.maskCoverage * 100).toFixed(2) + '%',
      maskMode,
    });
    return { idx, light, crop, assets };
  });

  if (debug) {
    window.__headlightDebug.refines = tasks.map(t => ({
      idx: t.idx,
      light: t.light,
      crop: t.crop,
      sentImage: t.assets.imageCanvas,
      sentMask: t.assets.maskCanvas,
      maskCoverage: t.assets.maskCoverage,
    }));
  }

  const apiResults = await Promise.all(tasks.map(t =>
    callHeadlightRefineApi(t.idx, t.assets, strength, debug, maskMode)
  ));

  // Sequential validate + composite.
  const perLight = [];
  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    const apiR = apiResults[i];
    const dbg = debug ? window.__headlightDebug.refines[i] : null;

    if (!apiR.ok) {
      console.warn(`[Headlights:refine#${i}] API failed → keep baseline`);
      perLight.push({ idx: i, ok: false, reason: "ai-failed", error: apiR.error });
      if (dbg) dbg.outcome = "ai-failed";
      continue;
    }

    try {
      const editedImg = await loadImg(`data:image/png;base64,${apiR.imageBase64}`);

      // Snapshot the baseline crop (full-image result inside this region).
      const baselineCrop = document.createElement('canvas');
      baselineCrop.width = t.crop.sourceW;
      baselineCrop.height = t.crop.sourceH;
      baselineCrop.getContext('2d').drawImage(
        baseline,
        t.crop.sourceX, t.crop.sourceY, t.crop.sourceW, t.crop.sourceH,
        0, 0, t.crop.sourceW, t.crop.sourceH,
      );

      // Render the AI output at the crop's source size.
      const refinedCrop = document.createElement('canvas');
      refinedCrop.width = t.crop.sourceW;
      refinedCrop.height = t.crop.sourceH;
      const rctx = refinedCrop.getContext('2d');
      rctx.imageSmoothingEnabled = true;
      rctx.imageSmoothingQuality = 'high';
      rctx.drawImage(editedImg, 0, 0, t.crop.sourceW, t.crop.sourceH);

      const localLight = transformLightToCrop(t.light, t.crop, W, H);
      const validation = validateRefinePass(baselineCrop, refinedCrop, localLight);

      console.log(`[Headlights:refine#${i}] validation`, {
        ok: validation.ok,
        reasons: validation.reasons,
        stats: {
          meanIn: validation.stats.meanIn.toFixed(2),
          meanRing: validation.stats.meanRing.toFixed(2),
          meanOut: validation.stats.meanOut.toFixed(2),
          varianceLum: validation.stats.varianceLum.toFixed(1),
          pctDarkRing: validation.stats.pctDarkRing.toFixed(3) + '%',
        },
      });

      if (dbg) {
        dbg.baselineCrop = baselineCrop;
        dbg.refinedCrop = refinedCrop;
        dbg.validation = validation;
        dbg.aiResultRaw = editedImg;
      }

      if (!validation.ok) {
        console.warn(`[Headlights:refine#${i}] ✗ rejected → keep baseline:`, validation.reasons);
        perLight.push({ idx: i, ok: false, reason: "validation-rejected", validation });
        if (dbg) dbg.outcome = "rejected";
        continue;
      }

      // Composite the refine on top of the baseline. Strict mask, no color
      // match (the full-image baseline + the refine are both AI-generated
      // and share the photo's lighting context).
      compositeSingleHeadlight(ctx, editedImg, t.light, t.crop, W, H, {
        expandOuter: 0.03,
        expandInner: -0.005,
        edgeBlur: 0.003,
        aiOpacity: 1.0,
      });

      perLight.push({
        idx: i,
        ok: true,
        provider: apiR.provider,
        model: apiR.model,
        meanIn: validation.stats.meanIn,
        meanRing: validation.stats.meanRing,
      });
      if (dbg) dbg.outcome = "accepted";
      console.log(`[Headlights:refine#${i}] ✓ accepted (meanIn=${validation.stats.meanIn.toFixed(1)})`);
    } catch (e) {
      console.warn(`[Headlights:refine#${i}] composite error → keep baseline:`, e.message);
      perLight.push({ idx: i, ok: false, reason: "composite", error: e.message });
      if (dbg) dbg.outcome = "composite-error";
    }
  }

  const acceptedCount = perLight.filter(r => r.ok).length;
  console.log(`[Headlights] refine pass done — ${acceptedCount}/${perLight.length} optics refined, ${perLight.length - acceptedCount} kept baseline`);
  return perLight;
}

async function runFullPhotoIdentical(ctx, W, H, lights, opts = {}) {
  const { strength = "restore", debug = false, maskMode = "tight", polishPreset = null } = opts;

  const FPI_PROMPT = 'Restore this vehicle photo while preserving the image as faithfully as possible. Recreate the entire photo with the same framing, perspective, lighting, reflections, background, vehicle geometry, paint color, badges, text, and all surrounding details unchanged. The only intended visual change is the two front headlight assemblies: make them look clear, transparent, clean, sharp, realistic, and professionally restored, as if the lenses were in excellent near-new condition. Do not alter nearby body panels, do not create halos, circular patches, seams, tone shifts, or blur around the headlights. Do not distort nearby text, badges, logo, bumper, hood lines, or reflections. Keep the result photorealistic and faithful to the original photo.';
  const FPI_RETRY_PROMPT = 'Reproduce this exact vehicle photo with pixel-level fidelity. The ONLY permitted change: restore the two front headlight lenses to look clear, transparent, clean, sharp, homogeneous, and like new. Everything else MUST be identical: framing, perspective, lighting, reflections, background, vehicle geometry, paint color, body panels, badges, text, logos, bumper, grille, hood, wheels, license plate, windows, mirrors, ground, walls, shadows, and camera angle. Do not create halos, circular patches, seams, tone shifts, blur, or artifacts of any kind. Do not distort text, badges, or any detail near the headlights. The output must be indistinguishable from the input except for the restored headlight lenses.';

  console.log("[Headlights] mode=full-photo-identical — NO per-headlight fallback");

  // ── Attempt 1 ──
  const a1 = await tryFullImageRestoration(ctx, W, H, lights, {
    strength, debug, strictPrompt: FPI_PROMPT, attempt: 1, maskMode,
    customValidator: validateFullPhotoIdentical,
  });
  persistDebugAttempt(debug, a1);

  if (debug && a1.editedImg) {
    window.__headlightDebug.fullPhotoIdentical = true;
    window.__headlightDebug.promptUsed = a1.ok ? 'FPI_PROMPT' : null;
  }

  if (a1.ok) {
    compositeFullReplace(ctx, a1.editedImg, W, H);
    const finalSource = "full-photo-identical:1";
    if (debug) {
      window.__headlightDebug.source = finalSource;
      window.__headlightDebug.finalSource = finalSource;
      window.__headlightDebug.promptUsed = 'FPI_PROMPT';
    }
    console.log(`[Headlights] ✓ full-photo-identical attempt 1 accepted`);
    console.log(`[Headlights] FINAL SOURCE = ${finalSource}`);
    return {
      ok: true,
      mode: "full-photo-identical",
      source: finalSource,
      finalSource,
      attempt: 1,
      maskMode,
      provider: a1.aiResponse?.provider,
      model: a1.aiResponse?.model,
      validation: a1.validation,
    };
  }
  console.warn("[Headlights] ✗ full-photo-identical attempt 1 rejected:", a1.reason, a1.validation?.reasons || a1.error || "");

  // ── Attempt 2 (stricter prompt) ──
  let a2 = null;
  if (a1.reason === 'validation') {
    a2 = await tryFullImageRestoration(ctx, W, H, lights, {
      strength, debug, strictPrompt: FPI_RETRY_PROMPT, attempt: 2, maskMode,
      customValidator: validateFullPhotoIdentical,
    });
    persistDebugAttempt(debug, a2);

    if (a2.ok) {
      compositeFullReplace(ctx, a2.editedImg, W, H);
      const finalSource = "full-photo-identical:2";
      if (debug) {
        window.__headlightDebug.source = finalSource;
        window.__headlightDebug.finalSource = finalSource;
        window.__headlightDebug.promptUsed = 'FPI_RETRY_PROMPT';
      }
      console.log(`[Headlights] ✓ full-photo-identical attempt 2 accepted`);
      console.log(`[Headlights] FINAL SOURCE = ${finalSource}`);
      return {
        ok: true,
        mode: "full-photo-identical",
        source: finalSource,
        finalSource,
        attempt: 2,
        maskMode,
        provider: a2.aiResponse?.provider,
        model: a2.aiResponse?.model,
        validation: a2.validation,
      };
    }
    console.warn("[Headlights] ✗ full-photo-identical attempt 2 rejected:", a2.reason, a2.validation?.reasons || a2.error || "");
  }

  // ── Both attempts rejected ──
  const best = (a2 && a2.editedImg) ? a2 : (a1.editedImg ? a1 : null);

  if (best && isForceRejectedEnabled()) {
    console.warn("[Headlights] full-photo-identical — both rejected, forcing output (forceRejected=1)");
    console.warn("[Headlights] rejection reasons:", best.validation?.reasons);
    compositeFullReplace(ctx, best.editedImg, W, H);
    const finalSource = "full-photo-identical:forced";
    if (debug) {
      window.__headlightDebug.source = finalSource;
      window.__headlightDebug.finalSource = finalSource;
      window.__headlightDebug.promptUsed = best === a2 ? 'FPI_RETRY_PROMPT' : 'FPI_PROMPT';
      window.__headlightDebug.forcedBecause = best.validation?.reasons;
    }
    console.log(`[Headlights] FINAL SOURCE = ${finalSource}`);
    return {
      ok: true,
      mode: "full-photo-identical",
      source: finalSource,
      finalSource,
      forced: true,
      attempt: best.attempt,
      maskMode,
      provider: best.aiResponse?.provider,
      model: best.aiResponse?.model,
      validation: best.validation,
    };
  }

  // Both rejected and forceRejected not enabled — apply safe polish on original
  console.warn("[Headlights] full-photo-identical — both rejected, rejected output NOT used");
  console.warn("[Headlights] rejection reasons:", best?.validation?.reasons);
  applySafeLensPolish(ctx, W, H, lights, maskMode, polishPreset);
  const finalSource = "safe-polish";
  if (debug) {
    window.__headlightDebug.source = finalSource;
    window.__headlightDebug.finalSource = finalSource;
    window.__headlightDebug.rejectedBecause = best?.validation?.reasons;
  }
  console.log(`[Headlights] FINAL SOURCE = ${finalSource}`);
  return {
    ok: true,
    mode: "full-photo-identical",
    source: finalSource,
    finalSource,
    safePolish: true,
    maskMode,
    validation: best?.validation,
  };
}

async function aiPolishHeadlights(ctx, W, H, b64Original, opts = {}) {
  const { strength = "restore" } = opts;
  const debug = isHeadlightDebugEnabled();
  const strategyOverride = getHeadlightStrategyOverride();
  const maskMode = getHeadlightMaskMode();
  const headlightMode = getHeadlightMode();
  const polishPreset = getHeadlightPolishStrength();

  const lights = await detectHeadlights(b64Original);
  if (!lights.length) {
    console.log("[Headlights] Aucun phare détecté");
    return { ok: false, reason: "no-lights", source: "none" };
  }

  if (debug) {
    window.__headlightDebug = {
      source: null,
      strategyOverride,
      maskMode,
      headlightMode,
      lights,
      attempts: [],
    };
  }

  console.log(`[Headlights] orchestrator start (headlightMode=${headlightMode}, strategyOverride=${strategyOverride}, maskMode=${maskMode}, polish=${polishPreset.label})`);

  // ── full-photo-identical: dedicated pipeline ────────────────────────────
  if (headlightMode === "full-photo-identical") {
    return await runFullPhotoIdentical(ctx, W, H, lights, { strength, debug, maskMode, polishPreset });
  }

  // ── per-headlight-only short-circuit ────────────────────────────────────
  if (strategyOverride === "per-headlight-only") {
    console.log("[Headlights] mode=per-headlight (forced by URL)");
    const fb = await aiPolishHeadlightsPerLight(ctx, W, H, lights, { strength, debug });
    const source = fb.ok ? "per-headlight" : "none";
    if (debug) window.__headlightDebug.source = source;
    console.log(`[Headlights] OUTPUT SOURCE = ${source}`);
    return { ...fb, source };
  }

  // ── Attempt 1: full-image with the default strict prompt ──
  console.log("[Headlights] mode=full-image attempt=1");
  const a1 = await tryFullImageRestoration(ctx, W, H, lights, {
    strength, debug, strictPrompt: null, attempt: 1, maskMode,
  });
  persistDebugAttempt(debug, a1);
  if (a1.ok) {
    const c = compositeFullReplace(ctx, a1.editedImg, W, H);
    if (debug) {
      window.__headlightDebug.source = "full-image:1";
      window.__headlightDebug.attempts[0].fusedCanvas = c?.fusedCanvas;
    }
    console.log("[Headlights] ✓ full-image attempt 1 accepted by validator");
    console.log("[Headlights] OUTPUT SOURCE = full-image:1 (no post-process — AI handled full image)");
    const finalSource = "full-image:1";
    if (debug) window.__headlightDebug.finalSource = finalSource;
    console.log(`[Headlights] FINAL SOURCE = ${finalSource}`);
    return {
      ok: true,
      mode: "full-image",
      source: "full-image:1",
      finalSource,
      attempt: 1,
      maskMode,
      provider: a1.aiResponse?.provider,
      model: a1.aiResponse?.model,
      validation: a1.validation,
    };
  }
  console.warn("[Headlights] ✗ full-image attempt 1 rejected:", a1.reason, a1.validation?.reasons || a1.error || "");

  // ── Attempt 2: full-image with STRICT_RETRY_PROMPT (only on validation failure) ──
  let a2 = null;
  if (a1.reason === 'validation') {
    console.log("[Headlights] mode=full-image attempt=2 (stricter prompt)");
    const STRICTER_PROMPT_FROM_USER = [
      "Restore ONLY the polycarbonate lens covers of the front headlights:",
      "remove the yellow oxidation, make them clearer, cleaner and more transparent.",
      "Do NOT change anything else: the car body, paint color, bumper, grille, hood,",
      "wheels, license plate, windows, mirrors, background, ground, walls, shadows,",
      "lighting, framing and camera angle MUST remain pixel-identical to the input.",
      "Do NOT redesign or reinterpret the headlight shape or internal layout.",
      "Preserve the exact original headlight model, reflectors, bulbs and lens curvature.",
      "The output must be visually indistinguishable from the input outside the headlight lenses.",
    ].join(" ");
    a2 = await tryFullImageRestoration(ctx, W, H, lights, {
      strength, debug, strictPrompt: STRICTER_PROMPT_FROM_USER, attempt: 2, maskMode,
    });
    persistDebugAttempt(debug, a2);
    if (a2.ok) {
      const c = compositeFullReplace(ctx, a2.editedImg, W, H);
      if (debug) {
        window.__headlightDebug.source = "full-image:2";
        const a2dbg = window.__headlightDebug.attempts[window.__headlightDebug.attempts.length - 1];
        if (a2dbg) { a2dbg.fusedCanvas = c?.fusedCanvas; }
      }
      console.log("[Headlights] ✓ full-image attempt 2 accepted by validator");
      console.log("[Headlights] OUTPUT SOURCE = full-image:2 (no post-process — AI handled full image)");
      const finalSource = "full-image:2";
      if (debug) window.__headlightDebug.finalSource = finalSource;
      console.log(`[Headlights] FINAL SOURCE = ${finalSource}`);
      return {
        ok: true,
        mode: "full-image",
        source: "full-image:2",
        finalSource,
        attempt: 2,
        maskMode,
        provider: a2.aiResponse?.provider,
        model: a2.aiResponse?.model,
        validation: a2.validation,
      };
    }
    console.warn("[Headlights] ✗ full-image attempt 2 rejected:", a2.reason, a2.validation?.reasons || a2.error || "");
  }

  // ── full-image-only override: composite the best full-image result anyway ──
  if (strategyOverride === "full-image-only") {
    const best = (a2 && a2.editedImg) ? a2 : (a1.editedImg ? a1 : null);
    if (best && isForceRejectedEnabled()) {
      console.warn("[Headlights] strategy=full-image-only — compositing rejected result (forceRejected=1)");
      console.warn("[Headlights] rejection reasons:", best.validation?.reasons);
      const c = compositeFullReplace(ctx, best.editedImg, W, H);
      if (debug) {
        window.__headlightDebug.source = "full-image:forced";
        const last = window.__headlightDebug.attempts[window.__headlightDebug.attempts.length - 1];
        if (last) { last.fusedCanvas = c?.fusedCanvas; last.alphaCanvas = c?.alphaCanvas; }
        window.__headlightDebug.finalSource = "full-image:forced";
      }
      console.log("[Headlights] FINAL SOURCE = full-image:forced");
      return {
        ok: true,
        mode: "full-image",
        source: "full-image:forced",
        finalSource: "full-image:forced",
        forced: true,
        attempt: best.attempt,
        provider: best.aiResponse?.provider,
        model: best.aiResponse?.model,
        validation: best.validation,
      };
    }
    // No forceRejected — fall through to safe polish below
    if (best) {
      console.warn("[Headlights] strategy=full-image-only — rejected output NOT used (no forceRejected=1)");
      console.warn("[Headlights] rejection reasons:", best.validation?.reasons);
    } else {
      console.warn("[Headlights] strategy=full-image-only but no AI image was returned");
    }
  }

  // ── Fallback: deterministic safe lens polish on original image ──
  // Both AI attempts rejected (or full-image-only without forceRejected).
  // Apply non-AI enhancement: yellow reduction + dehaze + clarity + sharpen.
  // This always produces a stable, natural, sellable result.
  console.log("[Headlights] applying safe lens polish as fallback (all AI attempts rejected)");
  applySafeLensPolish(ctx, W, H, lights, maskMode, polishPreset);
  const fallbackSource = "safe-polish";
  if (debug) {
    window.__headlightDebug.source = fallbackSource;
    window.__headlightDebug.finalSource = fallbackSource;
    window.__headlightDebug.rejectedBecause = (a2 || a1)?.validation?.reasons;
  }
  console.log(`[Headlights] FINAL SOURCE = ${fallbackSource}`);
  return {
    ok: true,
    mode: "safe-polish",
    source: fallbackSource,
    finalSource: fallbackSource,
    safePolish: true,
    maskMode,
  };
}

// ── Lustrage carrosserie ─────────────────────────────────────────────────────
// 3 passes canvas :
//   1) Saturation boost HSL (+22 %) sur pixels colorés (hors blanc/noir/gris)
//   2) Courbe S (smoothstep 18 %) → ombres plus profondes, tons clairs plus vifs
//   3) Brillance spéculaire → zones lumineuses poussées légèrement vers le blanc
//      (simule le vernis de la peinture sans artifice)
function polishBodywork(ctx, W, H) {
  // --- Courbe S : LUT 0-255 ---
  const lut = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    const sc = 3 * t * t - 2 * t * t * t; // smoothstep
    lut[i] = Math.max(0, Math.min(255, Math.round((t + (sc - t) * 0.18) * 255)));
  }

  // --- Helper hue → rgb (HSL) ---
  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 0.5)   return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };

  const id = ctx.getImageData(0, 0, W, H);
  const d = id.data;

  for (let k = 0; k < d.length; k += 4) {
    if (d[k + 3] < 10) continue; // pixel transparent

    let r = d[k] / 255, g = d[k + 1] / 255, b = d[k + 2] / 255;

    // --- 1) Saturation boost (espace HSL) ---
    const cMax = Math.max(r, g, b), cMin = Math.min(r, g, b);
    const delta = cMax - cMin;
    const l = (cMax + cMin) / 2;

    if (delta > 0.008 && l > 0.06 && l < 0.94) {
      const s = l > 0.5 ? delta / (2 - cMax - cMin) : delta / (cMax + cMin);
      if (s > 0.05) {
        const newS = Math.min(1, s * 1.22);
        const q2 = l < 0.5 ? l * (1 + newS) : l + newS - l * newS;
        const p2 = 2 * l - q2;
        let h;
        if (cMax === r)      h = ((g - b) / delta + (g < b ? 6 : 0)) / 6;
        else if (cMax === g) h = ((b - r) / delta + 2) / 6;
        else                 h = ((r - g) / delta + 4) / 6;
        r = hue2rgb(p2, q2, h + 1 / 3);
        g = hue2rgb(p2, q2, h);
        b = hue2rgb(p2, q2, h - 1 / 3);
      }
    }

    // --- 2) Courbe S (LUT) ---
    let r8 = lut[Math.round(r * 255)];
    let g8 = lut[Math.round(g * 255)];
    let b8 = lut[Math.round(b * 255)];

    // --- 3) Brillance spéculaire sur les zones lumineuses ---
    const lum8 = r8 * 0.299 + g8 * 0.587 + b8 * 0.114;
    if (lum8 > 168) {
      const strength = Math.min(0.10, (lum8 - 168) / 87 * 0.10);
      r8 = Math.min(255, r8 + (255 - r8) * strength);
      g8 = Math.min(255, g8 + (255 - g8) * strength);
      b8 = Math.min(255, b8 + (255 - b8) * strength);
    }

    d[k]     = r8;
    d[k + 1] = g8;
    d[k + 2] = b8;
  }

  ctx.putImageData(id, 0, 0);
  console.log("[Bodywork] Lustrage carrosserie terminé ✓");
}


// ── Feature flags (shadow system) ──
const USE_SOURCE_SHADOW_TRANSFER = false;

// ── Shadow generation constants (tunable) ──
const SHADOW_STRENGTH = 1.0;
const CONTACT_SHADOW_OPACITY = 0.35;
const CONTACT_SHADOW_BLUR = 10;
const UNDERBODY_SHADOW_OPACITY = 0.24;
const UNDERBODY_SHADOW_BLUR = 22;
const FRONT_SHADOW_OPACITY = 0.22;
const SHADOW_OVERLAP_RATIO = 0.025;
const SHADOW_VERTICAL_COMPRESSION = 0.35;
const SHADOW_SHEAR = 0.12;

// ── Fonds de showroom virtuels (générés par canvas, pas de dépendance externe) ──────────
function makeShowroomBackground(index, W, H) {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');

  if (index === 0) {
    // Studio béton anthracite — classique photo auto
    const bg = ctx.createRadialGradient(W * 0.5, H * 0.38, 0, W * 0.5, H * 0.5, W * 0.75);
    bg.addColorStop(0, '#3a3a3a'); bg.addColorStop(0.55, '#1e1e1e'); bg.addColorStop(1, '#090909');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    const floorY = H * 0.62;
    const floor = ctx.createLinearGradient(0, floorY, 0, H);
    floor.addColorStop(0, 'rgba(80,80,80,0.55)'); floor.addColorStop(0.5, 'rgba(40,40,40,0.25)'); floor.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = floor; ctx.fillRect(0, floorY, W, H - floorY);
    const band = ctx.createLinearGradient(0, H * 0.28, 0, H * 0.38);
    band.addColorStop(0, 'rgba(255,255,255,0)'); band.addColorStop(0.5, 'rgba(255,255,255,0.04)'); band.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = band; ctx.fillRect(0, H * 0.28, W, H * 0.10);

  } else if (index === 1) {
    // Showroom premium bleu nuit
    const bg = ctx.createLinearGradient(0, 0, W * 0.6, H);
    bg.addColorStop(0, '#0a0e1a'); bg.addColorStop(0.4, '#0d1530'); bg.addColorStop(1, '#060810');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    const halo = ctx.createRadialGradient(W * 0.5, H * 0.3, 0, W * 0.5, H * 0.3, W * 0.55);
    halo.addColorStop(0, 'rgba(30,80,180,0.22)'); halo.addColorStop(0.4, 'rgba(10,40,100,0.12)'); halo.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = halo; ctx.fillRect(0, 0, W, H);
    const floorY = H * 0.60;
    const floor = ctx.createLinearGradient(0, floorY, 0, H);
    floor.addColorStop(0, 'rgba(20,50,120,0.45)'); floor.addColorStop(0.6, 'rgba(5,15,40,0.20)'); floor.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = floor; ctx.fillRect(0, floorY, W, H - floorY);

  } else if (index === 2) {
    // Coucher de soleil — extérieur doré
    const sky = ctx.createLinearGradient(0, 0, 0, H * 0.62);
    sky.addColorStop(0, '#1a0a00'); sky.addColorStop(0.25, '#5c2200'); sky.addColorStop(0.55, '#c85a00'); sky.addColorStop(0.75, '#e8820a'); sky.addColorStop(1, '#f0aa3a');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H * 0.62);
    const ground = ctx.createLinearGradient(0, H * 0.62, 0, H);
    ground.addColorStop(0, '#2a1a08'); ground.addColorStop(0.3, '#1a1008'); ground.addColorStop(1, '#0e0a06');
    ctx.fillStyle = ground; ctx.fillRect(0, H * 0.62, W, H * 0.38);
    const sunRefl = ctx.createRadialGradient(W * 0.5, H * 0.62, 0, W * 0.5, H * 0.62, W * 0.4);
    sunRefl.addColorStop(0, 'rgba(200,100,0,0.35)'); sunRefl.addColorStop(0.5, 'rgba(120,50,0,0.15)'); sunRefl.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = sunRefl; ctx.fillRect(0, H * 0.55, W, H * 0.45);
    const sun = ctx.createRadialGradient(W * 0.5, H * 0.5, 0, W * 0.5, H * 0.5, W * 0.15);
    sun.addColorStop(0, 'rgba(255,220,100,0.55)'); sun.addColorStop(0.4, 'rgba(255,160,30,0.25)'); sun.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = sun; ctx.fillRect(0, H * 0.30, W, H * 0.40);

  } else {
    // Studio blanc lacé — photo professionnelle lumineuse
    const bg = ctx.createRadialGradient(W * 0.5, H * 0.35, 0, W * 0.5, H * 0.5, W * 0.75);
    bg.addColorStop(0, '#ffffff'); bg.addColorStop(0.55, '#ececec'); bg.addColorStop(1, '#cccccc');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    const floorY = H * 0.62;
    const floor = ctx.createLinearGradient(0, floorY, 0, H);
    floor.addColorStop(0, 'rgba(0,0,0,0.12)'); floor.addColorStop(0.6, 'rgba(0,0,0,0.05)'); floor.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = floor; ctx.fillRect(0, floorY, W, H - floorY);
  }

  return c.toDataURL('image/jpeg', 0.97);
}

// Miniatures pré-calculées une fois (évite de régénérer à chaque rendu)
// Images réelles de showroom (null = fond généré par canvas)
const SHOWROOM_IMAGES = ['/showrooms/Luxury.jpeg', '/showrooms/blanc.jpg', '/showrooms/Classique.jpeg', '/showrooms/Clean.jpeg'];
const SHOWROOM_LABELS = ['Luxury', 'Showroom Blanc', 'Classique', 'Garage'];
const SHOWROOM_THUMBS = [0, 1, 2, 3].map(i => SHOWROOM_IMAGES[i] ?? makeShowroomBackground(i, 160, 90));

// Redimensionne un dataUrl à maxPx max (côté le plus long) pour alléger l'envoi API
function shrinkDataUrl(dataUrl, maxPx = 1024, quality = 0.88) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width  = Math.round(img.width  * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    img.src = dataUrl;
  });
}

// ── Segmentation véhicule — @imgly background removal ──

async function removeBackground(dataUrl) {
  return await imglyRemoveBackground(dataUrl);
}

function morphCloseFloat(data, W, H, radius) {
  const dilated = sepMaxFilter(data, W, H, radius);
  return sepMinFilter(dilated, W, H, radius);
}

function sepMaxFilter(data, W, H, r) {
  const tmp = new Float32Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let mx = 0;
      const x0 = Math.max(0, x - r), x1 = Math.min(W - 1, x + r);
      for (let i = x0; i <= x1; i++) { const v = data[y * W + i]; if (v > mx) mx = v; }
      tmp[y * W + x] = mx;
    }
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let mx = 0;
      const y0 = Math.max(0, y - r), y1 = Math.min(H - 1, y + r);
      for (let j = y0; j <= y1; j++) { const v = tmp[j * W + x]; if (v > mx) mx = v; }
      out[y * W + x] = mx;
    }
  return out;
}

function sepMinFilter(data, W, H, r) {
  const tmp = new Float32Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let mn = 1;
      const x0 = Math.max(0, x - r), x1 = Math.min(W - 1, x + r);
      for (let i = x0; i <= x1; i++) { const v = data[y * W + i]; if (v < mn) mn = v; }
      tmp[y * W + x] = mn;
    }
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let mn = 1;
      const y0 = Math.max(0, y - r), y1 = Math.min(H - 1, y + r);
      for (let j = y0; j <= y1; j++) { const v = tmp[j * W + x]; if (v < mn) mn = v; }
      out[y * W + x] = mn;
    }
  return out;
}

function gaussianBlurMask(mask, W, H, sigma) {
  const r = Math.ceil(sigma * 3);
  const k = [];
  let s = 0;
  for (let i = -r; i <= r; i++) { const v = Math.exp(-(i * i) / (2 * sigma * sigma)); k.push(v); s += v; }
  for (let i = 0; i < k.length; i++) k[i] /= s;
  const temp = new Float32Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let val = 0;
      for (let j = -r; j <= r; j++) val += mask[y * W + Math.min(W - 1, Math.max(0, x + j))] * k[j + r];
      temp[y * W + x] = val;
    }
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let val = 0;
      for (let j = -r; j <= r; j++) val += temp[Math.min(H - 1, Math.max(0, y + j)) * W + x] * k[j + r];
      out[y * W + x] = val;
    }
  return out;
}

/**
 * Pre-load the @imgly background-removal module so its ONNX session is
 * ready before the user clicks Lancer le traitement. Safe to call multiple
 * times — only the first call actually does work.
 */
async function preloadBackgroundRemoval() {
  if (!removeBgImgly) {
    try {
      const mod = await import("@imgly/background-removal");
      removeBgImgly = mod.removeBackground;
    } catch (e) {
      console.warn('[BgRemoval] preload failed:', e?.message);
    }
  }
}

async function imglyRemoveBackground(dataUrl) {
  if (!removeBgImgly) {
    const mod = await import("@imgly/background-removal");
    removeBgImgly = mod.removeBackground;
  }
  const small = await shrinkDataUrl(dataUrl, 2000, 0.96);
  const blob = await fetch(small).then(r => r.blob());
  const result = await removeBgImgly(blob, {
    model: 'medium',
    output: { format: 'image/png', quality: 1.0 },
  });
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(result);
  });
}

// ── Shadow transfer — extract real shadow from source photo ──

async function extractSourceShadow(originalDataUrl, cutoutDataUrl) {
  const [origImg, cutImg] = await Promise.all([loadImg(originalDataUrl), loadImg(cutoutDataUrl)]);
  const W = cutImg.naturalWidth || cutImg.width;
  const H = cutImg.naturalHeight || cutImg.height;

  const origC = document.createElement('canvas');
  origC.width = W; origC.height = H;
  const oCtx = origC.getContext('2d');
  oCtx.drawImage(origImg, 0, 0, W, H);
  const origPx = oCtx.getImageData(0, 0, W, H).data;

  const maskC = document.createElement('canvas');
  maskC.width = W; maskC.height = H;
  const mCtx = maskC.getContext('2d');
  mCtx.drawImage(cutImg, 0, 0, W, H);
  const maskPx = mCtx.getImageData(0, 0, W, H).data;

  let carL = W, carR = 0, carT = H, carB = 0;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (maskPx[(y * W + x) * 4 + 3] > 128) {
        if (x < carL) carL = x; if (x > carR) carR = x;
        if (y < carT) carT = y; if (y > carB) carB = y;
      }
  const carBounds = { x: carL, y: carT, w: carR - carL, h: carB - carT };

  const roiX1 = Math.max(0, Math.floor(carL - W * 0.08));
  const roiX2 = Math.min(W, Math.ceil(carR + W * 0.08));
  const roiY1 = Math.max(0, Math.floor(carB - H * 0.18));
  const roiY2 = Math.min(H, Math.ceil(carB + H * 0.18));
  const rW = roiX2 - roiX1, rH = roiY2 - roiY1;

  if (rW < 10 || rH < 10) {
    console.log('[Shadow] ROI too small, skipping');
    return { matteDataUrl: null, meanAlpha: 0, carBounds };
  }

  const lum = new Float32Array(rW * rH);
  const isCar = new Uint8Array(rW * rH);
  for (let ry = 0; ry < rH; ry++)
    for (let rx = 0; rx < rW; rx++) {
      const gx = roiX1 + rx, gy = roiY1 + ry;
      const idx = (gy * W + gx) * 4;
      lum[ry * rW + rx] = 0.299 * origPx[idx] + 0.587 * origPx[idx + 1] + 0.114 * origPx[idx + 2];
      isCar[ry * rW + rx] = maskPx[idx + 3] > 128 ? 1 : 0;
    }

  const SHADOW_CLOSE_RADIUS  = 7;
  const SHADOW_DENSITY_SIGMA = 5.0;
  const SHADOW_EDGE_SIGMA    = 7.0;
  const SHADOW_NOISE_GATE    = 0.02;
  const SHADOW_MAX_ALPHA     = 0.65;

  const floorRef = estimateFloorBrightness2D(lum, isCar, rW, rH);

  const matte = new Float32Array(rW * rH);
  let aSum = 0, aCount = 0;
  for (let i = 0; i < rW * rH; i++) {
    if (isCar[i] || floorRef[i] < 15) { matte[i] = 0; continue; }
    const raw = (floorRef[i] - lum[i]) / floorRef[i];
    matte[i] = Math.max(0, Math.min(SHADOW_MAX_ALPHA, raw));
    if (matte[i] < SHADOW_NOISE_GATE) matte[i] = 0;
    aSum += matte[i]; aCount++;
  }

  const closed = morphCloseFloat(matte, rW, rH, SHADOW_CLOSE_RADIUS);
  const density = gaussianBlurMask(closed, rW, rH, SHADOW_DENSITY_SIGMA);
  const smoothed = gaussianBlurMask(density, rW, rH, SHADOW_EDGE_SIGMA);

  const fadeMargin = Math.min(rW, rH) * 0.15;
  for (let ry = 0; ry < rH; ry++)
    for (let rx = 0; rx < rW; rx++) {
      const d = Math.min(rx, rW - 1 - rx, ry, rH - 1 - ry);
      if (d < fadeMargin) {
        const t = d / fadeMargin;
        smoothed[ry * rW + rx] *= t * t * (3 - 2 * t);
      }
    }

  const matteCanvas = document.createElement('canvas');
  matteCanvas.width = W; matteCanvas.height = H;
  const matteCtx = matteCanvas.getContext('2d');
  const matteImgData = matteCtx.createImageData(W, H);
  for (let ry = 0; ry < rH; ry++)
    for (let rx = 0; rx < rW; rx++) {
      const a = smoothed[ry * rW + rx];
      if (a > 0.004) {
        const gx = roiX1 + rx, gy = roiY1 + ry;
        matteImgData.data[(gy * W + gx) * 4 + 3] = Math.round(a * 255);
      }
    }
  matteCtx.putImageData(matteImgData, 0, 0);

  const meanAlpha = aCount > 0 ? aSum / aCount : 0;
  console.log('[Shadow] matte v2: ROI %dx%d [x:%d-%d y:%d-%d] meanAlpha=%.4f',
    rW, rH, roiX1, roiX2, roiY1, roiY2, meanAlpha);

  return { matteDataUrl: matteCanvas.toDataURL('image/png'), meanAlpha, carBounds };
}

function estimateFloorBrightness2D(lum, isCar, W, H) {
  const BLK = 32;
  const gW = Math.ceil(W / BLK), gH = Math.ceil(H / BLK);
  const grid = new Float32Array(gW * gH);

  for (let gy = 0; gy < gH; gy++)
    for (let gx = 0; gx < gW; gx++) {
      const vals = [];
      const x1 = gx * BLK, x2 = Math.min(x1 + BLK, W);
      const y1 = gy * BLK, y2 = Math.min(y1 + BLK, H);
      for (let y = y1; y < y2; y++)
        for (let x = x1; x < x2; x++)
          if (!isCar[y * W + x]) vals.push(lum[y * W + x]);
      vals.sort((a, b) => a - b);
      grid[gy * gW + gx] = vals.length > 2 ? vals[Math.floor(vals.length * 0.85)] : -1;
    }

  for (let gy = 0; gy < gH; gy++)
    for (let gx = 0; gx < gW; gx++) {
      if (grid[gy * gW + gx] >= 0) continue;
      let s = 0, c = 0;
      for (let dy = -3; dy <= 3; dy++)
        for (let dx = -3; dx <= 3; dx++) {
          const ny = gy + dy, nx = gx + dx;
          if (ny >= 0 && ny < gH && nx >= 0 && nx < gW && grid[ny * gW + nx] >= 0) {
            s += grid[ny * gW + nx]; c++;
          }
        }
      grid[gy * gW + gx] = c > 0 ? s / c : 128;
    }

  const sg = new Float32Array(gW * gH);
  for (let gy = 0; gy < gH; gy++)
    for (let gx = 0; gx < gW; gx++) {
      let s = 0, c = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const ny = gy + dy, nx = gx + dx;
          if (ny >= 0 && ny < gH && nx >= 0 && nx < gW) { s += grid[ny * gW + nx]; c++; }
        }
      sg[gy * gW + gx] = s / c;
    }

  const result = new Float32Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const gxf = (x + 0.5) / BLK - 0.5;
      const gyf = (y + 0.5) / BLK - 0.5;
      const gx0 = Math.max(0, Math.floor(gxf));
      const gy0 = Math.max(0, Math.floor(gyf));
      const gx1 = Math.min(gW - 1, gx0 + 1);
      const gy1 = Math.min(gH - 1, gy0 + 1);
      const fx = Math.max(0, Math.min(1, gxf - gx0));
      const fy = Math.max(0, Math.min(1, gyf - gy0));
      result[y * W + x] =
        sg[gy0 * gW + gx0] * (1 - fx) * (1 - fy) +
        sg[gy0 * gW + gx1] * fx * (1 - fy) +
        sg[gy1 * gW + gx0] * (1 - fx) * fy +
        sg[gy1 * gW + gx1] * fx * fy;
    }
  return result;
}

function getShowroomDebugMode() {
  const url = window.location.search;
  if (url.includes('showroomDebug=mainVehicleBoxes')) return 'mainVehicleBoxes';
  if (url.includes('showroomDebug=mainROI')) return 'mainROI';
  if (url.includes('showroomDebug=mainMask')) return 'mainMask';
  if (url.includes('showroomDebug=mainMaskFinal')) return 'mainMask'; // alias
  if (url.includes('showroomDebug=shadowAlpha')) return 'shadowAlpha';
  if (url.includes('showroomDebug=shadowColor')) return 'shadowColor';
  if (url.includes('showroomDebug=shadowControls')) return 'shadowControls';
  if (url.includes('showroomDebug=shadow')) return 'shadow';
  if (url.includes('showroomDebug=car')) return 'car';
  if (url.includes('showroomDebug=final')) return null;
  return null;
}

// ── Shadow generation from car alpha mask ──

function smoothContourMovingAverage(contour, width, windowSize) {
  const out = new Float32Array(width);
  const half = Math.floor(windowSize / 2);
  for (let x = 0; x < width; x++) {
    if (contour[x] < 0) { out[x] = -1; continue; }
    let sum = 0, count = 0;
    for (let dx = -half; dx <= half; dx++) {
      const nx = x + dx;
      if (nx >= 0 && nx < width && contour[nx] >= 0) { sum += contour[nx]; count++; }
    }
    out[x] = count > 0 ? sum / count : -1;
  }
  return out;
}

function filterContourArtifacts(contour, width, maxGap) {
  for (let x = 0; x < width; x++) {
    if (contour[x] < 0) continue;
    let leftY = -1, rightY = -1;
    for (let lx = x - 1; lx >= Math.max(0, x - 5); lx--) {
      if (contour[lx] >= 0) { leftY = contour[lx]; break; }
    }
    for (let rx = x + 1; rx <= Math.min(width - 1, x + 5); rx++) {
      if (contour[rx] >= 0) { rightY = contour[rx]; break; }
    }
    if (leftY >= 0 && Math.abs(contour[x] - leftY) > maxGap) contour[x] = -1;
    else if (rightY >= 0 && Math.abs(contour[x] - rightY) > maxGap) contour[x] = -1;
  }
}

// ── Main vehicle isolation — connected-component filtering ──

async function isolateMainVehicle(cutoutDataURL, plateBox, mainVehicle, secondaryVehicles = []) {
  console.time('[MainVehicle] isolate');
  const img = await loadImg(cutoutDataURL);
  const W = img.naturalWidth || img.width;
  const H = img.naturalHeight || img.height;

  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const imgData = ctx.getImageData(0, 0, W, H);
  const data = imgData.data;
  const N = W * H;

  // Binary mask: 1 = opaque (alpha > 128)
  const mask = new Uint8Array(N);
  let totalOpaque = 0;
  for (let i = 0; i < N; i++) {
    if (data[i * 4 + 3] > 128) { mask[i] = 1; totalOpaque++; }
  }

  if (totalOpaque === 0) {
    console.log('[MainVehicle] no opaque pixels, skipping');
    console.timeEnd('[MainVehicle] isolate');
    return cutoutDataURL;
  }

  // Step 1: Erode mask to break thin connections between touching vehicles
  const erodeR = Math.max(5, Math.round(Math.min(W, H) * 0.008));
  const eroded = erodeMaskSeparable(mask, W, H, erodeR);

  let erodedCount = 0;
  for (let i = 0; i < N; i++) if (eroded[i]) erodedCount++;
  console.log('[MainVehicle] erode R=' + erodeR + ': ' + totalOpaque + ' -> ' + erodedCount + ' pixels');

  if (erodedCount === 0) {
    console.log('[MainVehicle] erosion removed everything, skipping isolation');
    console.timeEnd('[MainVehicle] isolate');
    return cutoutDataURL;
  }

  // Step 2: CC labeling on eroded mask
  const labels = new Int32Array(N);
  const components = [];
  let nextLabel = 1;
  const queue = [];

  for (let i = 0; i < N; i++) {
    if (eroded[i] === 0 || labels[i] !== 0) continue;
    const label = nextLabel++;
    let size = 0, sumX = 0, sumY = 0;
    let minX = W, maxX = 0, minY = H, maxY = 0;
    queue.length = 0;
    queue.push(i);
    labels[i] = label;
    while (queue.length > 0) {
      const idx = queue.pop();
      const x = idx % W, y = (idx - x) / W;
      size++; sumX += x; sumY += y;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (x > 0     && eroded[idx - 1] && !labels[idx - 1]) { labels[idx - 1] = label; queue.push(idx - 1); }
      if (x < W - 1 && eroded[idx + 1] && !labels[idx + 1]) { labels[idx + 1] = label; queue.push(idx + 1); }
      if (y > 0     && eroded[idx - W] && !labels[idx - W]) { labels[idx - W] = label; queue.push(idx - W); }
      if (y < H - 1 && eroded[idx + W] && !labels[idx + W]) { labels[idx + W] = label; queue.push(idx + W); }
    }
    components.push({ id: label, size, minX, maxX, minY, maxY, cx: sumX / size, cy: sumY / size });
  }

  console.log('[MainVehicle] eroded CC: ' + components.length + ' components');

  if (components.length <= 1 && components.length > 0) {
    console.log('[MainVehicle] single eroded component, no secondary vehicle');
    console.timeEnd('[MainVehicle] isolate');
    return cutoutDataURL;
  }

  // Step 3: Score each eroded component
  // Priority: overlap with mainVehicle bbox > plate containment > center > size
  const imgCx = W / 2, imgCy = H / 2;
  const maxDist = Math.sqrt(imgCx * imgCx + imgCy * imgCy);
  let plateCx = -1, plateCy = -1;
  if (plateBox) {
    plateCx = ((plateBox.x1 ?? plateBox.x ?? 0) + (plateBox.x2 ?? ((plateBox.x ?? 0) + (plateBox.w ?? 0)))) / 2 * W;
    plateCy = ((plateBox.y1 ?? plateBox.y ?? 0) + (plateBox.y2 ?? ((plateBox.y ?? 0) + (plateBox.h ?? 0)))) / 2 * H;
  }

  // mainVehicle bbox in pixel coords
  let mvX1 = -1, mvY1 = -1, mvX2 = -1, mvY2 = -1;
  if (mainVehicle) {
    mvX1 = mainVehicle.bbox.x1 * W;
    mvY1 = mainVehicle.bbox.y1 * H;
    mvX2 = mainVehicle.bbox.x2 * W;
    mvY2 = mainVehicle.bbox.y2 * H;
  }

  // Secondary vehicle bboxes in pixel coords
  const secBoxes = secondaryVehicles.map(sv => ({
    x1: sv.bbox.x1 * W, y1: sv.bbox.y1 * H,
    x2: sv.bbox.x2 * W, y2: sv.bbox.y2 * H,
  }));

  let bestScore = -1, bestId = -1;
  for (const comp of components) {
    const sizeScore = comp.size / erodedCount;
    const dist = Math.sqrt((comp.cx - imgCx) ** 2 + (comp.cy - imgCy) ** 2);
    const centerScore = 1 - dist / maxDist;

    // Plate containment
    let plateScore = 0;
    if (plateCx >= 0 && plateCx >= comp.minX && plateCx <= comp.maxX && plateCy >= comp.minY && plateCy <= comp.maxY) {
      plateScore = 1;
    }

    // Overlap with mainVehicle bbox
    let vehicleOverlap = 0;
    if (mvX1 >= 0) {
      const ox1 = Math.max(comp.minX, mvX1), oy1 = Math.max(comp.minY, mvY1);
      const ox2 = Math.min(comp.maxX, mvX2), oy2 = Math.min(comp.maxY, mvY2);
      if (ox2 > ox1 && oy2 > oy1) {
        const interArea = (ox2 - ox1) * (oy2 - oy1);
        const compArea = (comp.maxX - comp.minX) * (comp.maxY - comp.minY);
        vehicleOverlap = compArea > 0 ? interArea / compArea : 0;
      }
    }

    // Penalty: overlap with secondary vehicle bboxes
    let secPenalty = 0;
    for (const sb of secBoxes) {
      const ox1 = Math.max(comp.minX, sb.x1), oy1 = Math.max(comp.minY, sb.y1);
      const ox2 = Math.min(comp.maxX, sb.x2), oy2 = Math.min(comp.maxY, sb.y2);
      if (ox2 > ox1 && oy2 > oy1) {
        const interArea = (ox2 - ox1) * (oy2 - oy1);
        const compArea = (comp.maxX - comp.minX) * (comp.maxY - comp.minY);
        const overlap = compArea > 0 ? interArea / compArea : 0;
        secPenalty = Math.max(secPenalty, overlap); // worst overlap
      }
    }

    const score = vehicleOverlap * 0.35 + plateScore * 0.25 + sizeScore * 0.15 +
                  centerScore * 0.10 - secPenalty * 0.40;

    console.log('[MainVehicle] comp #' + comp.id +
      ': size=' + comp.size + ' (' + (sizeScore * 100).toFixed(1) + '%)' +
      ', center=(' + Math.round(comp.cx) + ',' + Math.round(comp.cy) + ')' +
      ', bbox=[' + comp.minX + ',' + comp.minY + ']->[' + comp.maxX + ',' + comp.maxY + ']' +
      ', plateContains=' + (plateScore > 0) + ', vehOverlap=' + vehicleOverlap.toFixed(2) +
      ', secPenalty=' + secPenalty.toFixed(2) + ', score=' + score.toFixed(3));

    if (score > bestScore) { bestScore = score; bestId = comp.id; }
  }

  // Step 4: Dilate the winning component back by erodeR to recover edges
  const mainMask = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (labels[i] === bestId) mainMask[i] = 1;
  const dilated = dilateMaskSeparable(mainMask, W, H, erodeR);

  // Step 5: AND dilated selection with original mask — zero out everything else
  let removed = 0;
  for (let i = 0; i < N; i++) {
    if (mask[i] && !dilated[i]) {
      data[i * 4 + 3] = 0;
      removed++;
    }
  }

  ctx.putImageData(imgData, 0, 0);
  const result = c.toDataURL('image/png');

  console.log('[MainVehicle] kept comp #' + bestId + ', removed ' + removed + ' pixels (' +
    (removed / totalOpaque * 100).toFixed(1) + '% of original mask)');
  console.timeEnd('[MainVehicle] isolate');
  return result;
}

function erodeMaskSeparable(mask, W, H, r) {
  // Horizontal min pass
  const tmp = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    const row = y * W;
    for (let x = 0; x < W; x++) {
      let allSet = true;
      const x0 = Math.max(0, x - r), x1 = Math.min(W - 1, x + r);
      for (let i = x0; i <= x1; i++) { if (!mask[row + i]) { allSet = false; break; } }
      tmp[row + x] = allSet ? 1 : 0;
    }
  }
  // Vertical min pass
  const out = new Uint8Array(W * H);
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) {
      let allSet = true;
      const y0 = Math.max(0, y - r), y1 = Math.min(H - 1, y + r);
      for (let j = y0; j <= y1; j++) { if (!tmp[j * W + x]) { allSet = false; break; } }
      out[y * W + x] = allSet ? 1 : 0;
    }
  }
  return out;
}

function dilateMaskSeparable(mask, W, H, r) {
  // Horizontal max pass
  const tmp = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    const row = y * W;
    for (let x = 0; x < W; x++) {
      let anySet = false;
      const x0 = Math.max(0, x - r), x1 = Math.min(W - 1, x + r);
      for (let i = x0; i <= x1; i++) { if (mask[row + i]) { anySet = true; break; } }
      tmp[row + x] = anySet ? 1 : 0;
    }
  }
  // Vertical max pass
  const out = new Uint8Array(W * H);
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) {
      let anySet = false;
      const y0 = Math.max(0, y - r), y1 = Math.min(H - 1, y + r);
      for (let j = y0; j <= y1; j++) { if (tmp[j * W + x]) { anySet = true; break; } }
      out[y * W + x] = anySet ? 1 : 0;
    }
  }
  return out;
}

// ── Chamfer distance transform: distance of each FG pixel to nearest BG pixel ──
function chamferDistTransform(mask, W, H) {
  const N = W * H;
  const dist = new Float32Array(N);
  const INF = (W + H) * 2;
  for (let i = 0; i < N; i++) dist[i] = mask[i] ? INF : 0;

  // Forward pass (top-left → bottom-right)
  for (let y = 0; y < H; y++) {
    const row = y * W;
    for (let x = 0; x < W; x++) {
      const i = row + x;
      if (dist[i] === 0) continue;
      let d = dist[i];
      if (x > 0) d = Math.min(d, dist[i - 1] + 1);
      if (y > 0) {
        d = Math.min(d, dist[i - W] + 1);
        if (x > 0) d = Math.min(d, dist[i - W - 1] + 1.41);
        if (x < W - 1) d = Math.min(d, dist[i - W + 1] + 1.41);
      }
      dist[i] = d;
    }
  }
  // Backward pass (bottom-right → top-left)
  for (let y = H - 1; y >= 0; y--) {
    const row = y * W;
    for (let x = W - 1; x >= 0; x--) {
      const i = row + x;
      if (dist[i] === 0) continue;
      let d = dist[i];
      if (x < W - 1) d = Math.min(d, dist[i + 1] + 1);
      if (y < H - 1) {
        d = Math.min(d, dist[i + W] + 1);
        if (x < W - 1) d = Math.min(d, dist[i + W + 1] + 1.41);
        if (x > 0) d = Math.min(d, dist[i + W - 1] + 1.41);
      }
      dist[i] = d;
    }
  }
  return dist;
}

// ── Separate attached secondary vehicle from fused mask ──
// Uses distance transform + seeded region growing, with progressive erosion fallback
async function separateAttachedSecondary(cutoutDataURL, mainVehicle, plateBox, secondaryVehicles = []) {
  if (!mainVehicle) return cutoutDataURL;
  console.time('[SepAttached]');

  const img = await loadImg(cutoutDataURL);
  const W = img.naturalWidth || img.width;
  const H = img.naturalHeight || img.height;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const imgData = ctx.getImageData(0, 0, W, H);
  const data = imgData.data;
  const N = W * H;

  // Binary mask
  const mask = new Uint8Array(N);
  let totalFG = 0;
  for (let i = 0; i < N; i++) {
    if (data[i * 4 + 3] > 128) { mask[i] = 1; totalFG++; }
  }
  if (totalFG === 0) { console.timeEnd('[SepAttached]'); return cutoutDataURL; }

  // MainVehicle bbox in pixels
  const mb = mainVehicle.bbox;
  const mvPx1 = Math.round(mb.x1 * W), mvPy1 = Math.round(mb.y1 * H);
  const mvPx2 = Math.round(mb.x2 * W), mvPy2 = Math.round(mb.y2 * H);
  const mvW = mvPx2 - mvPx1, mvH = mvPy2 - mvPy1;

  // 1. Distance transform
  console.time('[SepAttached] distTransform');
  const dist = chamferDistTransform(mask, W, H);
  console.timeEnd('[SepAttached] distTransform');
  let maxDist = 0;
  for (let i = 0; i < N; i++) if (dist[i] > maxDist) maxDist = dist[i];

  // Adaptive seed threshold: deep enough to be interior, not so deep we lose small vehicles
  const seedThreshold = Math.max(6, maxDist * 0.07);

  // 2. Seed assignment
  // Expanded mainVehicleBox (small margin for seed containment)
  const expM = Math.round(Math.min(mvW, mvH) * 0.05);
  const exPx1 = mvPx1 - expM, exPy1 = mvPy1 - expM;
  const exPx2 = mvPx2 + expM, exPy2 = mvPy2 + expM;

  // labels: 0=unassigned, 1=main, 2=secondary
  const labels = new Int8Array(N);
  let mainSeedCount = 0, secSeedCount = 0;

  // Plate center in pixels
  let platePx = -1, platePy = -1;
  if (plateBox) {
    platePx = Math.round(((plateBox.x1 ?? 0) + (plateBox.x2 ?? 0)) / 2 * W);
    platePy = Math.round(((plateBox.y1 ?? 0) + (plateBox.y2 ?? 0)) / 2 * H);
  }

  // Main seeds: deep interior pixels inside expanded mainVehicleBox
  for (let i = 0; i < N; i++) {
    if (!mask[i] || dist[i] < seedThreshold) continue;
    const x = i % W, y = (i - x) / W;
    if (x >= exPx1 && x <= exPx2 && y >= exPy1 && y <= exPy2) {
      labels[i] = 1;
      mainSeedCount++;
    }
  }

  // Secondary seeds from detected secondary vehicle bboxes
  for (const sv of secondaryVehicles) {
    const sb = sv.bbox;
    const sx1 = Math.round(sb.x1 * W), sy1 = Math.round(sb.y1 * H);
    const sx2 = Math.round(sb.x2 * W), sy2 = Math.round(sb.y2 * H);
    for (let y = Math.max(0, sy1); y <= Math.min(H - 1, sy2); y++) {
      for (let x = Math.max(0, sx1); x <= Math.min(W - 1, sx2); x++) {
        const i = y * W + x;
        if (mask[i] && labels[i] === 0 && dist[i] >= seedThreshold * 0.5) {
          labels[i] = 2;
          secSeedCount++;
        }
      }
    }
  }

  // Auto-detect secondary lobes: foreground far outside mainVehicleBox
  const farM = Math.round(Math.min(mvW, mvH) * 0.12);
  const farPx1 = mvPx1 - farM, farPy1 = mvPy1 - farM;
  const farPx2 = mvPx2 + farM, farPy2 = mvPy2 + farM;
  for (let i = 0; i < N; i++) {
    if (!mask[i] || labels[i] !== 0 || dist[i] < seedThreshold * 0.3) continue;
    const x = i % W, y = (i - x) / W;
    if (x < farPx1 || x > farPx2 || y < farPy1 || y > farPy2) {
      labels[i] = 2;
      secSeedCount++;
    }
  }

  console.log('[SepAttached] seeds: main=' + mainSeedCount + ' secondary=' + secSeedCount +
    ' threshold=' + seedThreshold.toFixed(1) + ' maxDist=' + maxDist.toFixed(1));

  if (mainSeedCount === 0 || secSeedCount === 0) {
    // === Fallback: progressive erosion ===
    console.log('[SepAttached] insufficient seeds, trying progressive erosion fallback');
    let separated = false;
    const baseR = Math.max(5, Math.round(Math.min(W, H) * 0.008));
    for (let mult = 2; mult <= 6; mult++) {
      const R = baseR * mult;
      const eroded = erodeMaskSeparable(mask, W, H, R);
      // CC label eroded mask
      const elabels = new Int32Array(N);
      const ecomps = [];
      let nextL = 1;
      const q = [];
      for (let i = 0; i < N; i++) {
        if (!eroded[i] || elabels[i] !== 0) continue;
        const lbl = nextL++;
        let sz = 0, sX = 0, sY = 0, mnX = W, mxX = 0, mnY = H, mxY = 0;
        q.length = 0; q.push(i); elabels[i] = lbl;
        while (q.length > 0) {
          const idx = q.pop();
          const px = idx % W, py = (idx - px) / W;
          sz++; sX += px; sY += py;
          if (px < mnX) mnX = px; if (px > mxX) mxX = px;
          if (py < mnY) mnY = py; if (py > mxY) mxY = py;
          if (px > 0 && eroded[idx-1] && !elabels[idx-1]) { elabels[idx-1]=lbl; q.push(idx-1); }
          if (px < W-1 && eroded[idx+1] && !elabels[idx+1]) { elabels[idx+1]=lbl; q.push(idx+1); }
          if (py > 0 && eroded[idx-W] && !elabels[idx-W]) { elabels[idx-W]=lbl; q.push(idx-W); }
          if (py < H-1 && eroded[idx+W] && !elabels[idx+W]) { elabels[idx+W]=lbl; q.push(idx+W); }
        }
        ecomps.push({ id: lbl, size: sz, cx: sX/sz, cy: sY/sz, minX: mnX, maxX: mxX, minY: mnY, maxY: mxY });
      }
      if (ecomps.length < 2) continue;
      console.log('[SepAttached] fallback R=' + R + ': ' + ecomps.length + ' components');

      // Score each component: overlap with mainVehicleBox + plate containment
      let bestId = -1, bestScore = -1;
      for (const ec of ecomps) {
        const ox1 = Math.max(ec.minX, mvPx1), oy1 = Math.max(ec.minY, mvPy1);
        const ox2 = Math.min(ec.maxX, mvPx2), oy2 = Math.min(ec.maxY, mvPy2);
        let overlap = 0;
        if (ox2 > ox1 && oy2 > oy1) {
          const compA = (ec.maxX - ec.minX) * (ec.maxY - ec.minY);
          overlap = compA > 0 ? (ox2-ox1)*(oy2-oy1)/compA : 0;
        }
        let plateSc = 0;
        if (platePx >= 0 && platePx >= ec.minX && platePx <= ec.maxX && platePy >= ec.minY && platePy <= ec.maxY) plateSc = 1;
        const sc = overlap * 0.5 + plateSc * 0.3 + (ec.size / totalFG) * 0.2;
        if (sc > bestScore) { bestScore = sc; bestId = ec.id; }
      }

      // Dilate winning component back, AND with original mask
      const winMask = new Uint8Array(N);
      for (let i = 0; i < N; i++) if (elabels[i] === bestId) winMask[i] = 1;
      const dilated = dilateMaskSeparable(winMask, W, H, R);
      let removed = 0;
      for (let i = 0; i < N; i++) {
        if (mask[i] && !dilated[i]) { data[i * 4 + 3] = 0; removed++; }
      }
      console.log('[SepAttached] fallback kept comp #' + bestId + ', removed ' + removed +
        ' (' + (removed / totalFG * 100).toFixed(1) + '%)');
      if (removed > 0) { separated = true; break; }
    }
    if (!separated) console.log('[SepAttached] fallback: no separation achieved');
    ctx.putImageData(imgData, 0, 0);
    console.timeEnd('[SepAttached]');
    return separated ? c.toDataURL('image/png') : cutoutDataURL;
  }

  // 3. Region growing from seeds (bucket sort by distance, process high→low)
  console.time('[SepAttached] regionGrow');
  const maxDistInt = Math.ceil(maxDist);
  const buckets = new Array(maxDistInt + 1);
  for (let d = 0; d <= maxDistInt; d++) buckets[d] = [];

  // Add seeded pixels to their distance bucket
  for (let i = 0; i < N; i++) {
    if (labels[i] !== 0) {
      buckets[Math.min(maxDistInt, Math.floor(dist[i]))].push(i);
    }
  }

  // Process from high distance (deep interior) to low (edges/bridges)
  const dx8 = [-1, 0, 1, -1, 1, -1, 0, 1];
  const dy8 = [-1, -1, -1, 0, 0, 1, 1, 1];
  for (let d = maxDistInt; d >= 0; d--) {
    const bucket = buckets[d];
    for (let bi = 0; bi < bucket.length; bi++) {
      const idx = bucket[bi];
      const x = idx % W, y = (idx - x) / W;
      const myLabel = labels[idx];
      for (let n = 0; n < 8; n++) {
        const nx = x + dx8[n], ny = y + dy8[n];
        if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
        const ni = ny * W + nx;
        if (!mask[ni] || labels[ni] !== 0) continue;
        labels[ni] = myLabel;
        buckets[Math.min(maxDistInt, Math.floor(dist[ni]))].push(ni);
      }
    }
  }
  console.timeEnd('[SepAttached] regionGrow');

  // 4. Remove pixels assigned to secondary region
  let removedSec = 0, unassigned = 0;
  for (let i = 0; i < N; i++) {
    if (!mask[i]) continue;
    if (labels[i] === 2) { data[i * 4 + 3] = 0; removedSec++; }
    else if (labels[i] === 0) unassigned++;
  }

  ctx.putImageData(imgData, 0, 0);
  console.log('[SepAttached] removed=' + removedSec + ' (' + (removedSec / totalFG * 100).toFixed(1) +
    '%), kept=' + (totalFG - removedSec) + ', unassigned=' + unassigned);
  console.timeEnd('[SepAttached]');

  if (removedSec === 0) return cutoutDataURL;
  return c.toDataURL('image/png');
}

async function generateShadowFromCarAlpha(cutoutDataURL, carBounds, plateBox, shadowParams = {}) {
  console.time('[Shadow] generateFromAlpha');
  const img = await loadImg(cutoutDataURL);
  const fullW = img.naturalWidth || img.width;
  const fullH = img.naturalHeight || img.height;

  const workScale = Math.min(1, 900 / fullW);
  const wW = Math.round(fullW * workScale);
  const wH = Math.round(fullH * workScale);

  const workCanvas = document.createElement('canvas');
  workCanvas.width = wW; workCanvas.height = wH;
  const wCtx = workCanvas.getContext('2d');
  wCtx.drawImage(img, 0, 0, wW, wH);
  const imgData = wCtx.getImageData(0, 0, wW, wH);
  const alpha = new Float32Array(wW * wH);
  let alphaOpaqueCount = 0;
  for (let i = 0; i < wW * wH; i++) {
    alpha[i] = imgData.data[i * 4 + 3] / 255;
    if (alpha[i] > 0.08) alphaOpaqueCount++;
  }

  const cb = {
    x: Math.round(carBounds.x * workScale),
    y: Math.round(carBounds.y * workScale),
    w: Math.round(carBounds.w * workScale),
    h: Math.round(carBounds.h * workScale),
  };
  const carL = cb.x, carR = cb.x + cb.w, carT = cb.y, carB = cb.y + cb.h;
  const carH = cb.h;

  // Plate exclusion zone in working coords
  let plateExcluded = false;
  let plateLw = -1, plateRw = -1, plateBw = -1;
  if (plateBox) {
    plateLw = Math.round((plateBox.x1 ?? plateBox.x ?? 0) * fullW * workScale);
    plateRw = Math.round((plateBox.x2 ?? ((plateBox.x ?? 0) + (plateBox.w ?? 0))) * fullW * workScale);
    plateBw = Math.round((plateBox.y2 ?? ((plateBox.y ?? 0) + (plateBox.h ?? 0))) * fullH * workScale);
    plateExcluded = plateLw >= 0 && plateRw > plateLw;
  }

  console.log('[Shadow] cutout %dx%d, work %dx%d, scale=' + workScale.toFixed(3) + ', opaquePixels=' + alphaOpaqueCount +
    ', carBounds=[' + cb.x + ',' + cb.y + ' ' + cb.w + 'x' + cb.h + '], carH=' + carH +
    (plateExcluded ? ', plateExcluded=[' + plateLw + '-' + plateRw + ']' : ', noPlate'));

  const opMul = shadowParams.opacity ?? SHADOW_STRENGTH;
  const extraBlur = shadowParams.blur ?? 0;
  const yOff = Math.round((shadowParams.yOffset ?? 0) * workScale);
  const spread = shadowParams.spread ?? 1.0;

  // Extract bottom contour — for each column, find the LOWEST opaque pixel
  // Exclude columns in plate bbox to avoid plate cache artifacts
  const bottomContour = new Float32Array(wW).fill(-1);
  for (let x = carL; x <= Math.min(carR, wW - 1); x++) {
    // Skip plate columns — will be interpolated from neighbors
    if (plateExcluded && x >= plateLw && x <= plateRw) continue;
    for (let y = wH - 1; y >= 0; y--) {
      if (alpha[y * wW + x] > 0.08) { bottomContour[x] = y; break; }
    }
  }

  // Interpolate contour through plate-excluded zone
  if (plateExcluded && plateLw > carL && plateRw < carR) {
    const leftY = bottomContour[Math.max(carL, plateLw - 1)];
    const rightY = bottomContour[Math.min(carR, plateRw + 1)];
    if (leftY >= 0 && rightY >= 0) {
      for (let x = plateLw; x <= plateRw; x++) {
        const t = (x - plateLw) / (plateRw - plateLw);
        bottomContour[x] = leftY + (rightY - leftY) * t;
      }
    } else if (leftY >= 0) {
      for (let x = plateLw; x <= plateRw; x++) bottomContour[x] = leftY;
    } else if (rightY >= 0) {
      for (let x = plateLw; x <= plateRw; x++) bottomContour[x] = rightY;
    }
  }

  const smoothWindow = Math.max(3, Math.round(15 * workScale));
  const smoothed = smoothContourMovingAverage(bottomContour, wW, smoothWindow);
  filterContourArtifacts(smoothed, wW, Math.round(20 * workScale));

  let contourCount = 0;
  for (let x = 0; x < wW; x++) if (smoothed[x] >= 0) contourCount++;
  console.log('[Shadow] bottomContour: ' + contourCount + ' valid columns out of ' + (carR - carL) + ' (carL=' + carL + ' carR=' + carR + ')');

  // Layer 1: Contact shadow — tight band under car bottom
  const contactLayer = new Float32Array(wW * wH);
  const overlapPx = Math.max(2, Math.round(SHADOW_OVERLAP_RATIO * carH));
  const bandHeight = Math.max(4, Math.round(0.04 * carH * spread));
  const contactIntensity = CONTACT_SHADOW_OPACITY * opMul;

  for (let x = carL; x <= Math.min(carR, wW - 1); x++) {
    const cy = smoothed[x];
    if (cy < 0) continue;
    const yStart = Math.round(cy - overlapPx) + yOff;
    const yEnd = Math.round(cy + bandHeight) + yOff;
    for (let y = Math.max(0, yStart); y <= Math.min(wH - 1, yEnd); y++) {
      const totalH = yEnd - yStart;
      if (totalH <= 0) continue;
      const dist = (y - yStart) / totalH;
      const falloff = dist < 0.4 ? 1.0 : 1.0 - (dist - 0.4) / 0.6;
      contactLayer[y * wW + x] = contactIntensity * Math.max(0, falloff);
    }
  }

  // Blur sigma in working-scale pixels (do NOT multiply by workScale again)
  const contactSigma = Math.max(2, CONTACT_SHADOW_BLUR * workScale + extraBlur * workScale);
  const contactBlurred = gaussianBlurMask(contactLayer, wW, wH, contactSigma);

  // Layer 2: Underbody shadow — projected bottom portion of car
  const underbodyLayer = new Float32Array(wW * wH);
  const srcTop = Math.max(0, Math.round(carB - 0.3 * carH));
  const compression = SHADOW_VERTICAL_COMPRESSION * spread;
  const underbodyIntensity = UNDERBODY_SHADOW_OPACITY * opMul;

  for (let x = carL; x <= Math.min(carR, wW - 1); x++) {
    const anchorY = smoothed[x];
    if (anchorY < 0) continue;
    for (let sy = srcTop; sy <= Math.min(carB, wH - 1); sy++) {
      if (alpha[sy * wW + x] < 0.1) continue;
      const projY = Math.round(anchorY + (sy - srcTop) * compression) + yOff;
      const shearX = Math.round(x + (projY - anchorY) * SHADOW_SHEAR);
      if (projY >= 0 && projY < wH && shearX >= 0 && shearX < wW) {
        const srcAlpha = alpha[sy * wW + x];
        const val = underbodyIntensity * srcAlpha;
        const idx = projY * wW + shearX;
        if (val > underbodyLayer[idx]) underbodyLayer[idx] = val;
      }
    }
  }

  // Layer 3: Front bumper shadow reinforcement
  // Plate bbox is used ONLY to detect which side is "front" — NOT as a shape.
  // Reinforce shadow across the front ~30% of the car width, merged into underbody.
  if (plateBox) {
    const plateCenterX = Math.round(((plateBox.x1 ?? plateBox.x ?? 0) + (plateBox.x2 ?? ((plateBox.x ?? 0) + (plateBox.w ?? 0)))) / 2 * fullW * workScale);
    const isFrontLeft = plateCenterX < (carL + carR) / 2;
    // Front zone: 30% of car width on the front side
    const frontWidth = Math.round(cb.w * 0.30);
    const frontL = isFrontLeft ? carL : Math.max(carL, carR - frontWidth);
    const frontR = isFrontLeft ? Math.min(carR, carL + frontWidth) : carR;
    const frontIntensity = FRONT_SHADOW_OPACITY * opMul;
    const frontBand = Math.max(4, Math.round(bandHeight * 1.5));
    for (let x = frontL; x <= Math.min(wW - 1, frontR); x++) {
      const cy = smoothed[x];
      if (cy < 0) continue;
      // Fade intensity from front edge to back
      const edgeDist = isFrontLeft
        ? 1.0 - (x - frontL) / (frontR - frontL)
        : (x - frontL) / (frontR - frontL);
      const xFade = 0.3 + 0.7 * edgeDist;
      const boostStart = Math.round(cy) + yOff;
      const boostEnd = Math.round(cy + frontBand) + yOff;
      for (let y = Math.max(0, boostStart); y <= Math.min(wH - 1, boostEnd); y++) {
        const totalH = boostEnd - boostStart;
        if (totalH <= 0) continue;
        const dist = (y - boostStart) / totalH;
        const falloff = 1.0 - dist * dist;
        const idx = y * wW + x;
        underbodyLayer[idx] = Math.min(0.95, underbodyLayer[idx] + frontIntensity * xFade * falloff);
      }
    }
    console.log('[Shadow] frontAnchor: side=' + (isFrontLeft ? 'left' : 'right') + ', range=[' + frontL + '-' + frontR + '], plateExcludedFromShadow=true');
  }

  const underbodySigma = Math.max(2, UNDERBODY_SHADOW_BLUR * workScale + extraBlur * workScale);
  const underbodyBlurred = gaussianBlurMask(underbodyLayer, wW, wH, underbodySigma);

  // Compose: max of both layers
  const combined = new Float32Array(wW * wH);
  let shadowNonZeroCount = 0, shadowMaxAlpha = 0;
  let shadowMinX = wW, shadowMaxX = 0, shadowMinY = wH, shadowMaxY = 0;
  for (let i = 0; i < wW * wH; i++) {
    combined[i] = Math.max(contactBlurred[i], underbodyBlurred[i]);
    if (combined[i] > 0.003) {
      shadowNonZeroCount++;
      if (combined[i] > shadowMaxAlpha) shadowMaxAlpha = combined[i];
      const px = i % wW, py = Math.floor(i / wW);
      if (px < shadowMinX) shadowMinX = px;
      if (px > shadowMaxX) shadowMaxX = px;
      if (py < shadowMinY) shadowMinY = py;
      if (py > shadowMaxY) shadowMaxY = py;
    }
  }

  console.log('[Shadow] result: nonZeroPixels=' + shadowNonZeroCount +
    ', maxAlpha=' + shadowMaxAlpha.toFixed(4) +
    ', bounds=[' + shadowMinX + ',' + shadowMinY + ']->[' + shadowMaxX + ',' + shadowMaxY + ']' +
    ', contactSigma=' + contactSigma.toFixed(1) +
    ', underbodySigma=' + underbodySigma.toFixed(1) +
    ', bandH=' + bandHeight + ', compression=' + compression.toFixed(3));

  if (shadowNonZeroCount === 0) {
    console.warn('[Shadow] WARNING: shadow is empty! No visible pixels generated.');
  }

  // Paint to working canvas (alpha only, RGB=0)
  const shadowCanvas = document.createElement('canvas');
  shadowCanvas.width = wW; shadowCanvas.height = wH;
  const sCtx = shadowCanvas.getContext('2d');
  const shadowImgData = sCtx.createImageData(wW, wH);
  for (let i = 0; i < wW * wH; i++) {
    if (combined[i] > 0.003) {
      shadowImgData.data[i * 4 + 3] = Math.round(Math.min(1, combined[i]) * 255);
    }
  }
  sCtx.putImageData(shadowImgData, 0, 0);

  // Upscale to cutout dimensions
  const outCanvas = document.createElement('canvas');
  outCanvas.width = fullW; outCanvas.height = fullH;
  const oCtx = outCanvas.getContext('2d');
  oCtx.imageSmoothingEnabled = true;
  oCtx.imageSmoothingQuality = 'high';
  oCtx.drawImage(shadowCanvas, 0, 0, fullW, fullH);

  const dataUrl = outCanvas.toDataURL('image/png');
  console.log('[Shadow] output PNG size=' + dataUrl.length + ' bytes');
  console.timeEnd('[Shadow] generateFromAlpha');
  return dataUrl;
}

async function compositeCarOnBg(cutoutDataUrl, bgDataUrl, W, H, logoImg = null, corners = null, bgColor = '#ffffff', offsetX = 0, offsetY = 0, zoom = 1.0, returnFull = false, wallLogoOpts = null, shadowMatteUrl = null, blend = 0, carBoundsHint = null) {
  const [bgImg, carImg, wallImg, shadowImg] = await Promise.all([
    loadImg(bgDataUrl),
    loadImg(cutoutDataUrl),
    wallLogoOpts?.src ? loadImg(wallLogoOpts.src) : null,
    shadowMatteUrl ? loadImg(shadowMatteUrl) : null,
  ]);
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bgImg, 0, 0, W, H);
  // Logo mural dessiné sur le mur (AVANT la voiture)
  if (wallImg && wallLogoOpts) {
    const wScale = wallLogoOpts.scale || 0.18;
    const ww = W * wScale;
    const wh = ww * (wallImg.naturalHeight / wallImg.naturalWidth);
    const wx = (wallLogoOpts.x ?? 0.5) * W - ww / 2;
    const wy = (wallLogoOpts.y ?? 0.25) * H - wh / 2;
    ctx.save();
    ctx.globalAlpha = wallLogoOpts.opacity ?? 0.85;
    ctx.drawImage(wallImg, wx, wy, ww, wh);
    ctx.restore();
  }
  const scale = Math.min((W * 0.92) / carImg.width, (H * 0.78) / carImg.height) * zoom;
  const cw = carImg.width * scale;
  const ch = carImg.height * scale;

  // Bbox réel du véhicule dans le cutout (pixels non-transparents).
  // → permet de centrer sur le centre VISUEL du véhicule plutôt que sur le
  //   centre du cutout (qui peut avoir des marges asymétriques), et de placer
  //   les pneus contre le sol même si le cutout a une bande transparente en bas.
  //
  // Si l'appelant nous fournit un `carBoundsHint` (en pixels du cutout) on
  // l'utilise — économie d'un scan plein-résolution. Sinon on scanne ici.
  let actualBottomFrac = 1.0;
  let actualLeftFrac   = 0.0;
  let actualRightFrac  = 1.0;
  if (carBoundsHint && Number.isFinite(carBoundsHint.x) && Number.isFinite(carBoundsHint.w) && carBoundsHint.w > 0 && carBoundsHint.h > 0) {
    actualLeftFrac   = carBoundsHint.x / carImg.width;
    actualRightFrac  = (carBoundsHint.x + carBoundsHint.w) / carImg.width;
    actualBottomFrac = (carBoundsHint.y + carBoundsHint.h) / carImg.height;
  } else {
    try {
      const scanC = document.createElement('canvas');
      scanC.width = carImg.width; scanC.height = carImg.height;
      const scanCtx = scanC.getContext('2d');
      scanCtx.drawImage(carImg, 0, 0);
      const imgData = scanCtx.getImageData(0, 0, carImg.width, carImg.height);
      const data = imgData.data;
      let minX = carImg.width, maxX = -1, maxY = -1;
      for (let y = 0; y < carImg.height; y++) {
        for (let x = 0; x < carImg.width; x++) {
          if (data[(y * carImg.width + x) * 4 + 3] > 20) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
          }
        }
      }
      if (maxX >= 0) {
        actualLeftFrac   = minX / carImg.width;
        actualRightFrac  = (maxX + 1) / carImg.width;
        actualBottomFrac = (maxY + 1) / carImg.height;
      }
    } catch (_) { /* garder les valeurs par défaut */ }
  }

  // Centre visuel horizontal de la voiture (relatif au cutout, 0..1).
  const carCenterFrac = (actualLeftFrac + actualRightFrac) / 2;
  // carX décale le cutout pour que le centre visuel du véhicule tombe sur W/2,
  // puis l'utilisateur peut ajuster avec offsetX (flèches).
  const carX = W / 2 - carCenterFrac * cw + offsetX;
  // Le bas du véhicule reste ancré à 82 % de la hauteur du décor (= sol).
  const carY = H * 0.82 - actualBottomFrac * ch + offsetY;

  const debugMode = getShowroomDebugMode();

  // ── Debug: mainMask — show isolated car mask on white ──
  if (debugMode === 'mainMask') {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, W, H);
    ctx.drawImage(carImg, carX, carY, cw, ch);
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.font = '24px monospace';
    ctx.fillText('mainMask — final mask (CC + separation + gate)', 20, 40);
    const dataURL = c.toDataURL('image/jpeg', 0.98);
    if (returnFull) return { dataURL, baseURL: dataURL, transform: { carX, carY, cw, ch, W, H } };
    return dataURL;
  }

  // ── Debug: shadow matte on white (black visible) ──
  if (debugMode === 'shadow' || debugMode === 'shadowAlpha') {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, W, H);
    if (shadowImg) {
      ctx.globalAlpha = 1.0;
      ctx.drawImage(shadowImg, carX, carY, cw, ch);
    } else {
      ctx.fillStyle = '#f00';
      ctx.font = '32px monospace';
      ctx.fillText('NO SHADOW IMAGE LOADED', 100, 100);
    }
    const dataURL = c.toDataURL('image/jpeg', 0.98);
    if (returnFull) return { dataURL, baseURL: dataURL, transform: { carX, carY, cw, ch, W, H } };
    return dataURL;
  }

  // ── Debug: shadow as magenta at 100% opacity ──
  if (debugMode === 'shadowColor') {
    ctx.drawImage(bgImg, 0, 0, W, H);
    if (shadowImg) {
      // Draw shadow matte as magenta: create temp canvas, composite
      const tmpC = document.createElement('canvas');
      tmpC.width = W; tmpC.height = H;
      const tmpCtx = tmpC.getContext('2d');
      tmpCtx.drawImage(shadowImg, carX, carY, cw, ch);
      const tmpData = tmpCtx.getImageData(0, 0, W, H);
      for (let i = 0; i < W * H; i++) {
        const a = tmpData.data[i * 4 + 3];
        if (a > 0) {
          tmpData.data[i * 4] = 255;     // R
          tmpData.data[i * 4 + 1] = 0;   // G
          tmpData.data[i * 4 + 2] = 255; // B
          tmpData.data[i * 4 + 3] = 255; // full alpha
        }
      }
      tmpCtx.putImageData(tmpData, 0, 0);
      ctx.drawImage(tmpC, 0, 0);
    } else {
      ctx.fillStyle = '#f00';
      ctx.font = '32px monospace';
      ctx.fillText('NO SHADOW IMAGE', 100, 100);
    }
    ctx.drawImage(carImg, carX, carY, cw, ch);
    const dataURL = c.toDataURL('image/jpeg', 0.98);
    if (returnFull) return { dataURL, baseURL: dataURL, transform: { carX, carY, cw, ch, W, H } };
    return dataURL;
  }

  // ── Debug: car only (no shadow) ──
  if (debugMode === 'car') {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, W, H);
    ctx.drawImage(carImg, carX, carY, cw, ch);
    const dataURL = c.toDataURL('image/jpeg', 0.98);
    if (returnFull) return { dataURL, baseURL: dataURL, transform: { carX, carY, cw, ch, W, H } };
    return dataURL;
  }

  // ── Shadow layer (drawn BEFORE car) ──
  // No matte → no shadow. When the user unchecks "Ombres au sol" the matte is
  // null on purpose, so we must draw nothing (no fallback contact strip, which
  // would otherwise leave a stray dark line on the ground under the car).
  if (shadowImg) {
    ctx.save();
    ctx.globalAlpha = 1.0;
    ctx.drawImage(shadowImg, carX, carY, cw, ch);
    ctx.restore();
    console.log('[Shadow] drawn at carPos=[' + Math.round(carX) + ',' + Math.round(carY) + '] size=[' + Math.round(cw) + 'x' + Math.round(ch) + ']');
  }

  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  if (blend > 0) {
    const t = Math.max(0, Math.min(100, blend)) / 100;
    const bVal = (1 - 0.08 * t).toFixed(3); // brightness 1.0 → 0.92
    const cVal = (1 - 0.12 * t).toFixed(3); // contrast   1.0 → 0.88
    const sVal = (1 - 0.12 * t).toFixed(3); // saturation 1.0 → 0.88
    ctx.filter = `brightness(${bVal}) contrast(${cVal}) saturate(${sVal})`;
  }
  ctx.drawImage(carImg, carX, carY, cw, ch);
  ctx.restore();
  // Snapshot avant plaque (pour Ajuster en mode showroom)
  const baseURL = returnFull ? c.toDataURL('image/jpeg', 0.97) : null;
  // Cache plaque redessiné en qualité native (corners normalisés 0-1 → pixels composite)
  if (logoImg && corners) {
    const mp = p => ({ x: carX + p.x * cw, y: carY + p.y * ch });
    const ptl = mp(corners.tl), ptr = mp(corners.tr);
    const pbr = mp(corners.br), pbl = mp(corners.bl);
    drawPlateOverlay(ctx, logoImg, ptl, ptr, pbr, pbl, bgColor, 'bbox_stable');
  }
  const dataURL = c.toDataURL('image/jpeg', 0.98);
  if (returnFull) return { dataURL, baseURL, transform: { carX, carY, cw, ch, W, H } };
  return dataURL;
}

// Coins précis via GPT-4o sur le CROP de la plaque (plaque = 100% de l'image envoyée)
// Retourne { near_side, angle_deg, corners } ou null
async function detectGptData(b64) {
  try {
    const r = await fetch("/api/corners", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ b64 }),
    });
    const data = await r.json();
    if (typeof data.near_side === 'string' && typeof data.angle_deg === 'number') {
      return {
        near_side: data.near_side,
        angle_deg: data.angle_deg,
        corners: data.corners ?? null,
      };
    }
    return null;
  } catch(e) {
    return null;
  }
}

async function detectPlateYOLO(imageFile) {
  const backendUrl = import.meta.env.VITE_YOLO_BACKEND_URL;
  if (!backendUrl) { console.warn('VITE_YOLO_BACKEND_URL non défini'); return null; }
  try {
    const formData = new FormData();
    formData.append('file', imageFile);
    const r = await fetch(`${backendUrl}/detect-plate`, {
      method: 'POST',
      body: formData,
      // pas de Content-Type : le navigateur pose multipart/form-data + boundary
    });
    if (!r.ok) { console.warn('YOLO backend HTTP', r.status); return null; }
    const d = await r.json();
    if (!d.found) { console.log('YOLO: aucune plaque détectée'); return null; }
    const b = d.bbox;
    console.log(`YOLO bbox: (${b.x1.toFixed(3)},${b.y1.toFixed(3)})-(${b.x2.toFixed(3)},${b.y2.toFixed(3)}) conf=${d.conf} source=${d.source ?? '?'}`);
    if (d.corners) console.log('Corners:', d.corners.map(p => `(${p.x.toFixed(3)},${p.y.toFixed(3)})`).join(' '));
    if (d.debug?.candidates?.length) {
      console.log(`YOLO debug: ${d.debug.total_candidates} candidats, méthode finale = ${d.debug.method}`);
      d.debug.candidates.forEach((c, i) => {
        const star = c.is_final ? '★' : ' ';
        console.log(`  ${star} #${i+1} score=${c.score} method=${c.method} ar=${c.sub_scores.ar ?? '?'} contain=${c.sub_scores.contain ?? '?'}`);
      });
    }
    return d;
  } catch(e) {
    console.error('YOLO error:', e.message);
    return null;
  }
}

// ── Vehicle detection + main vehicle selection ──

async function detectVehicles(imageFile) {
  const backendUrl = import.meta.env.VITE_YOLO_BACKEND_URL;
  if (!backendUrl) return null;
  try {
    const formData = new FormData();
    formData.append('file', imageFile);
    const r = await fetch(`${backendUrl}/detect-vehicles`, {
      method: 'POST',
      body: formData,
    });
    if (!r.ok) { console.warn('[Vehicles] backend HTTP', r.status); return null; }
    const d = await r.json();
    console.log('[Vehicles] detected ' + d.count + ' vehicles');
    d.vehicles.forEach((v, i) => {
      console.log('[Vehicles] #' + (i + 1) + ': ' + v.class + ' conf=' + v.conf +
        ' bbox=(' + v.bbox.x1.toFixed(3) + ',' + v.bbox.y1.toFixed(3) + ')-(' +
        v.bbox.x2.toFixed(3) + ',' + v.bbox.y2.toFixed(3) + ') area=' + v.area.toFixed(4));
    });
    return d;
  } catch (e) {
    console.warn('[Vehicles] detection failed:', e.message);
    return null;
  }
}

// Backend instance segmentation: returns mask of main vehicle only
async function segmentMainVehicle(imageFile, plateBox, mainVehicleBox) {
  const backendUrl = import.meta.env.VITE_YOLO_BACKEND_URL;
  if (!backendUrl) return null;
  try {
    console.time('[Segment] backend');
    const formData = new FormData();
    formData.append('file', imageFile);
    if (plateBox) formData.append('plate_box', JSON.stringify(plateBox));
    if (mainVehicleBox) formData.append('main_vehicle_box', JSON.stringify(mainVehicleBox));
    const r = await fetch(`${backendUrl}/segment-main-vehicle`, {
      method: 'POST',
      body: formData,
    });
    console.timeEnd('[Segment] backend');
    if (!r.ok) { console.warn('[Segment] backend HTTP', r.status); return null; }
    const d = await r.json();
    if (!d.success) {
      console.warn('[Segment] backend returned error:', d.error);
      return null;
    }
    console.log('[Segment] success: ' + d.instance_class + ' conf=' + d.confidence +
      ' instances=' + d.instances_found + ' selected=#' + d.selected_index);
    if (d.scores) d.scores.forEach((s, i) => {
      console.log('[Segment] score #' + i + ': ' + s.class + ' plate=' + s.plate +
        ' iou=' + s.iou + ' area=' + s.area + ' → ' + s.score);
    });
    return {
      maskDataURL: 'data:image/png;base64,' + d.mask_base64,
      confidence: d.confidence,
      instanceClass: d.instance_class,
    };
  } catch (e) {
    console.warn('[Segment] failed:', e.message);
    return null;
  }
}

// Apply a grayscale mask PNG to the original image as alpha channel
async function applyMaskToCutout(originalDataURL, maskDataURL) {
  const [origImg, maskImg] = await Promise.all([loadImg(originalDataURL), loadImg(maskDataURL)]);
  const W = origImg.naturalWidth || origImg.width;
  const H = origImg.naturalHeight || origImg.height;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.drawImage(origImg, 0, 0);
  const imgData = ctx.getImageData(0, 0, W, H);
  // Draw mask at original image dimensions
  const mc = document.createElement('canvas');
  mc.width = W; mc.height = H;
  const mctx = mc.getContext('2d');
  mctx.drawImage(maskImg, 0, 0, W, H);
  const maskData = mctx.getImageData(0, 0, W, H).data;
  // Use first channel of mask (grayscale) as alpha
  for (let i = 0; i < W * H; i++) {
    imgData.data[i * 4 + 3] = maskData[i * 4]; // R channel → alpha
  }
  ctx.putImageData(imgData, 0, 0);
  return c.toDataURL('image/png');
}

function selectMainVehicle(vehicles, plateBox, imgW, imgH) {
  if (!vehicles || vehicles.length === 0) return null;
  if (vehicles.length === 1) {
    console.log('[Vehicles] single vehicle, auto-selected: ' + vehicles[0].class);
    return vehicles[0];
  }

  let plateCx = -1, plateCy = -1;
  if (plateBox) {
    plateCx = ((plateBox.x1 ?? 0) + (plateBox.x2 ?? 0)) / 2;
    plateCy = ((plateBox.y1 ?? 0) + (plateBox.y2 ?? 0)) / 2;
  }

  // Tier 1: candidates whose bbox contains the plate center
  const withPlate = [];
  const withoutPlate = [];
  for (const v of vehicles) {
    if (plateCx >= 0 && plateCx >= v.bbox.x1 && plateCx <= v.bbox.x2 &&
        plateCy >= v.bbox.y1 && plateCy <= v.bbox.y2) {
      withPlate.push(v);
    } else {
      withoutPlate.push(v);
    }
  }

  console.log('[Vehicles] plate-containing: ' + withPlate.length + ', others: ' + withoutPlate.length);

  // If exactly one contains the plate, it wins
  if (withPlate.length === 1) {
    console.log('[Vehicles] selected (sole plate match): ' + withPlate[0].class +
      ' conf=' + withPlate[0].conf.toFixed(2) + ' area=' + withPlate[0].area.toFixed(4));
    return withPlate[0];
  }

  // Tier 2: multiple contain plate — pick the tightest reasonable bbox (penalize oversized)
  const candidates = withPlate.length > 0 ? withPlate : vehicles;
  const maxDist = Math.SQRT2 * 0.5;

  let bestScore = -1, bestVehicle = null;
  for (const v of candidates) {
    const vCx = (v.bbox.x1 + v.bbox.x2) / 2;
    const vCy = (v.bbox.y1 + v.bbox.y2) / 2;

    // Center proximity
    const dist = Math.sqrt((vCx - 0.5) ** 2 + (vCy - 0.5) ** 2);
    const centerProx = 1 - dist / maxDist;

    // Plate proximity (for candidates without plate containment)
    let plateProx = 0;
    if (plateCx >= 0) {
      const pDist = Math.sqrt((vCx - plateCx) ** 2 + (vCy - plateCy) ** 2);
      plateProx = 1 - Math.min(pDist / maxDist, 1);
    }

    // Area penalty: penalize very large (>40% of image) and very small (<2%) detections
    // Sweet spot around 5-30% of image area for a single car
    let areaPenalty = 0;
    if (v.area > 0.40) areaPenalty = (v.area - 0.40) * 2.0; // strong penalty for oversized
    if (v.area < 0.02) areaPenalty = 0.3; // slight penalty for tiny

    const confScore = v.conf;
    const containsPlate = withPlate.includes(v) ? 1 : 0;

    // Score: plate containment decisive, then confidence, center, penalize oversized
    const score = 0.40 * containsPlate + 0.25 * confScore + 0.20 * centerProx +
                  0.15 * plateProx - areaPenalty;

    console.log('[Vehicles] score ' + v.class + ': plate=' + containsPlate +
      ' conf=' + confScore.toFixed(2) + ' center=' + centerProx.toFixed(2) +
      ' plateProx=' + plateProx.toFixed(2) + ' area=' + v.area.toFixed(4) +
      ' areaPen=' + areaPenalty.toFixed(2) + ' → ' + score.toFixed(3));

    if (score > bestScore) { bestScore = score; bestVehicle = v; }
  }

  console.log('[Vehicles] selected: ' + bestVehicle.class + ' bbox=(' +
    bestVehicle.bbox.x1.toFixed(3) + ',' + bestVehicle.bbox.y1.toFixed(3) + ')-(' +
    bestVehicle.bbox.x2.toFixed(3) + ',' + bestVehicle.bbox.y2.toFixed(3) + ') score=' + bestScore.toFixed(3));
  return bestVehicle;
}

// Compute secondary vehicles: all detected vehicles that don't overlap heavily with mainVehicle
function getSecondaryVehicles(allVehicles, mainVehicle) {
  if (!mainVehicle || !allVehicles || allVehicles.length <= 1) return [];
  return allVehicles.filter(v => {
    if (v === mainVehicle) return false;
    // Skip detections that heavily overlap with mainVehicle (duplicate/overlapping YOLO boxes)
    const mb = mainVehicle.bbox, vb = v.bbox;
    const ox1 = Math.max(mb.x1, vb.x1), oy1 = Math.max(mb.y1, vb.y1);
    const ox2 = Math.min(mb.x2, vb.x2), oy2 = Math.min(mb.y2, vb.y2);
    if (ox2 > ox1 && oy2 > oy1) {
      const inter = (ox2 - ox1) * (oy2 - oy1);
      const vArea = (vb.x2 - vb.x1) * (vb.y2 - vb.y1);
      if (vArea > 0 && inter / vArea > 0.50) return false; // overlapping with main = same car
    }
    return true;
  });
}

function estimateMainVehicleROI(mainVehicle, plateBox, imgW, imgH, secondaryVehicles = []) {
  // If we have a detected vehicle bbox, use it with safe margins
  // Shrink margins on sides where secondary vehicles exist to exclude them
  if (mainVehicle) {
    const b = mainVehicle.bbox;
    const bw = b.x2 - b.x1, bh = b.y2 - b.y1;
    let marginL = bw * 0.18, marginR = bw * 0.18;
    let marginT = bh * 0.15, marginB = bh * 0.12;

    for (const sv of secondaryVehicles) {
      const sb = sv.bbox;
      // Secondary is to the RIGHT of main vehicle
      if (sb.x1 > b.x2 - bw * 0.10) {
        const gap = sb.x1 - b.x2;
        marginR = Math.min(marginR, Math.max(bw * 0.05, gap * 0.5));
        console.log('[ROI] shrink right margin: secondary ' + sv.class + ' at x1=' +
          sb.x1.toFixed(3) + ' → marginR=' + marginR.toFixed(3));
      }
      // Secondary is to the LEFT of main vehicle
      if (sb.x2 < b.x1 + bw * 0.10) {
        const gap = b.x1 - sb.x2;
        marginL = Math.min(marginL, Math.max(bw * 0.05, gap * 0.5));
        console.log('[ROI] shrink left margin: secondary ' + sv.class + ' at x2=' +
          sb.x2.toFixed(3) + ' → marginL=' + marginL.toFixed(3));
      }
      // Secondary is ABOVE main vehicle
      if (sb.y2 < b.y1 + bh * 0.10) {
        const gap = b.y1 - sb.y2;
        marginT = Math.min(marginT, Math.max(bh * 0.05, gap * 0.5));
      }
      // Secondary is BELOW main vehicle
      if (sb.y1 > b.y2 - bh * 0.10) {
        const gap = sb.y1 - b.y2;
        marginB = Math.min(marginB, Math.max(bh * 0.05, gap * 0.5));
      }
    }

    const roi = {
      x1: Math.max(0, b.x1 - marginL),
      y1: Math.max(0, b.y1 - marginT),
      x2: Math.min(1, b.x2 + marginR),
      y2: Math.min(1, b.y2 + marginB),
    };
    console.log('[ROI] mainVehicle bbox=(' + b.x1.toFixed(3) + ',' + b.y1.toFixed(3) + ')-(' +
      b.x2.toFixed(3) + ',' + b.y2.toFixed(3) + ') → ROI=(' + roi.x1.toFixed(3) + ',' +
      roi.y1.toFixed(3) + ')-(' + roi.x2.toFixed(3) + ',' + roi.y2.toFixed(3) + ')' +
      ' secondary=' + secondaryVehicles.length);
    return roi;
  }
  // Fallback: estimate from plate position — generous to avoid cutting the car
  if (plateBox) {
    const pcx = ((plateBox.x1 ?? 0) + (plateBox.x2 ?? 0)) / 2;
    const pcy = ((plateBox.y1 ?? 0) + (plateBox.y2 ?? 0)) / 2;
    return {
      x1: Math.max(0, pcx - 0.42),
      y1: Math.max(0, pcy - 0.55),
      x2: Math.min(1, pcx + 0.42),
      y2: Math.min(1, pcy + 0.15),
    };
  }
  // No anchor: use full image
  return null;
}

// Hard gate: zero alpha outside mainVehicle bbox AND inside secondary vehicle zones
// Uses mainVehicle bbox when available, falls back to plate estimate only as last resort
async function hardGateByVehicleBox(cutoutDataURL, mainVehicle, plateBox, imgW, imgH, secondaryVehicles = []) {
  console.time('[HardGate]');

  // Determine the gate box (normalized coordinates)
  let gateX1, gateY1, gateX2, gateY2;
  let gateSource;

  if (mainVehicle) {
    // Use detected vehicle bbox with generous expansion (never cut the main car)
    const b = mainVehicle.bbox;
    const bw = b.x2 - b.x1, bh = b.y2 - b.y1;
    gateX1 = b.x1 - bw * 0.20;
    gateY1 = b.y1 - bh * 0.18;
    gateX2 = b.x2 + bw * 0.20;
    gateY2 = b.y2 + bh * 0.15;
    gateSource = 'vehicleBox';
  } else if (plateBox) {
    const pcx = ((plateBox.x1 ?? 0) + (plateBox.x2 ?? 0)) / 2;
    const pcy = ((plateBox.y1 ?? 0) + (plateBox.y2 ?? 0)) / 2;
    gateX1 = pcx - 0.45;
    gateY1 = pcy - 0.55;
    gateX2 = pcx + 0.45;
    gateY2 = pcy + 0.15;
    gateSource = 'plateFallback';
  } else {
    console.log('[HardGate] no vehicle box or plate, skipping');
    console.timeEnd('[HardGate]');
    return cutoutDataURL;
  }

  // Clamp to [0,1]
  gateX1 = Math.max(0, gateX1);
  gateY1 = Math.max(0, gateY1);
  gateX2 = Math.min(1, gateX2);
  gateY2 = Math.min(1, gateY2);

  const img = await loadImg(cutoutDataURL);
  const W = img.naturalWidth || img.width;
  const H = img.naturalHeight || img.height;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const imgData = ctx.getImageData(0, 0, W, H);
  const data = imgData.data;

  // Convert normalized gate to pixel coords
  const px1 = Math.round(gateX1 * W);
  const px2 = Math.round(gateX2 * W);
  const py1 = Math.round(gateY1 * H);
  const py2 = Math.round(gateY2 * H);

  // Main vehicle bbox in pixels (for exclusion zone overlap check)
  let mainPx1 = px1, mainPy1 = py1, mainPx2 = px2, mainPy2 = py2;
  if (mainVehicle) {
    mainPx1 = Math.round(mainVehicle.bbox.x1 * W);
    mainPy1 = Math.round(mainVehicle.bbox.y1 * H);
    mainPx2 = Math.round(mainVehicle.bbox.x2 * W);
    mainPy2 = Math.round(mainVehicle.bbox.y2 * H);
  }

  // Build secondary exclusion zones (only the parts that don't overlap with mainVehicle)
  const exclusionZones = secondaryVehicles.map(sv => {
    const sb = sv.bbox;
    return {
      x1: Math.round(sb.x1 * W), y1: Math.round(sb.y1 * H),
      x2: Math.round(sb.x2 * W), y2: Math.round(sb.y2 * H),
    };
  });

  const feather = Math.round(Math.min(W, H) * 0.012);
  let removedGate = 0, removedExcl = 0;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = (y * W + x) * 4;
      if (data[idx + 3] === 0) continue;

      // 1. Outside main gate → zero
      let dx = 0, dy = 0;
      if (x < px1) dx = px1 - x;
      else if (x > px2) dx = x - px2;
      if (y < py1) dy = py1 - y;
      else if (y > py2) dy = y - py2;

      if (dx > 0 || dy > 0) {
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > feather) {
          data[idx + 3] = 0;
          removedGate++;
        } else {
          const factor = dist / feather;
          data[idx + 3] = Math.round(data[idx + 3] * (1 - factor));
          if (data[idx + 3] < 5) { data[idx + 3] = 0; removedGate++; }
        }
        continue;
      }

      // 2. Inside an exclusion zone AND outside the main vehicle bbox → zero
      if (x < mainPx1 || x > mainPx2 || y < mainPy1 || y > mainPy2) {
        for (const ez of exclusionZones) {
          if (x >= ez.x1 && x <= ez.x2 && y >= ez.y1 && y <= ez.y2) {
            data[idx + 3] = 0;
            removedExcl++;
            break;
          }
        }
      }
    }
  }

  ctx.putImageData(imgData, 0, 0);
  console.log('[HardGate] source=' + gateSource +
    ' gate=[' + px1 + ',' + py1 + ']->[' + px2 + ',' + py2 + '] (img ' + W + 'x' + H + ')' +
    ' removedGate=' + removedGate + ' removedExcl=' + removedExcl +
    ' exclusionZones=' + exclusionZones.length);
  console.timeEnd('[HardGate]');

  if (removedGate === 0 && removedExcl === 0) return cutoutDataURL;
  return c.toDataURL('image/png');
}

async function cropToROI(dataUrl, roi) {
  if (!roi) return { croppedUrl: dataUrl, roi: { x1: 0, y1: 0, x2: 1, y2: 1 } };
  const img = await loadImg(dataUrl);
  const W = img.naturalWidth || img.width;
  const H = img.naturalHeight || img.height;
  const cx1 = Math.round(roi.x1 * W), cy1 = Math.round(roi.y1 * H);
  const cx2 = Math.round(roi.x2 * W), cy2 = Math.round(roi.y2 * H);
  const cw = cx2 - cx1, ch = cy2 - cy1;
  if (cw < 100 || ch < 100) return { croppedUrl: dataUrl, roi: { x1: 0, y1: 0, x2: 1, y2: 1 } };
  const c = document.createElement('canvas');
  c.width = cw; c.height = ch;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, cx1, cy1, cw, ch, 0, 0, cw, ch);
  console.log('[ROI] cropped to [' + cx1 + ',' + cy1 + ' ' + cw + 'x' + ch + '] from ' + W + 'x' + H);
  return { croppedUrl: c.toDataURL('image/jpeg', 0.96), roi };
}

async function uncropCutout(croppedCutoutUrl, roi, origW, origH) {
  if (roi.x1 === 0 && roi.y1 === 0 && roi.x2 === 1 && roi.y2 === 1) return croppedCutoutUrl;
  const img = await loadImg(croppedCutoutUrl);
  const c = document.createElement('canvas');
  c.width = origW; c.height = origH;
  const ctx = c.getContext('2d');
  const cx1 = Math.round(roi.x1 * origW), cy1 = Math.round(roi.y1 * origH);
  ctx.drawImage(img, cx1, cy1);
  return c.toDataURL('image/png');
}

async function processPhoto(photoFile, logoImg, adj, bgColor = "#ffffff", enhance = false, headlightPolish = false, useGptAngle = false, floorClean = false, enhancePro = false, bodyPolish = false, enhanceProIntensity = 2) {
  const { b64, imgW, imgH } = await toBase64(photoFile);

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
  // Amélioration couleurs (canvas) — intensité réglable pour enhancePro
  // Try/catch défensif : on ne laisse JAMAIS une exception sur une photo
  // empêcher silencieusement l'application de la correction colorimétrique.
  if (enhance || enhancePro) {
    try {
      autoEnhance(ctx, c.width, c.height, enhancePro ? enhanceProIntensity : 5, photoFile.name);
    } catch (e) {
      console.error('[Enhance] échec sur', photoFile.name, e);
    }
  }
  // Lustrage des optiques (canvas)
  if (headlightPolish) await aiPolishHeadlights(ctx, c.width, c.height, b64);
  // Lustrage carrosserie (canvas)
  if (bodyPolish) polishBodywork(ctx, c.width, c.height);
  // Sol : flou adaptatif pro (après couleurs) ou adoucissement simple
  if (enhancePro) applyFloorBlur(ctx, c, c.width, c.height);
  else if (floorClean) {
    // softFloor conservé pour compatibilité
    const id = ctx.getImageData(0, Math.round(c.height * 0.58), c.width, Math.round(c.height * 0.42));
    const d = id.data; const zH = Math.round(c.height * 0.42); const fT = Math.round(c.height * 0.10);
    for (let row = 0; row < zH; row++) { const t = Math.min(1, row / fT) * 0.55;
      for (let col = 0; col < c.width; col++) { const i = (row * c.width + col) * 4;
        const lum = d[i]*0.299+d[i+1]*0.587+d[i+2]*0.114;
        d[i]=Math.min(255,d[i]+(lum-d[i])*t*0.5+(255-d[i])*t*0.18);
        d[i+1]=Math.min(255,d[i+1]+(lum-d[i+1])*t*0.5+(255-d[i+1])*t*0.18);
        d[i+2]=Math.min(255,d[i+2]+(lum-d[i+2])*t*0.5+(255-d[i+2])*t*0.18); } }
    ctx.putImageData(id, 0, Math.round(c.height * 0.58));
  }
  // Save photo without plate for later re-rendering in "Ajuster" mode
  // Qualité 0.97 : moins d'artefacts JPEG envoyés à remove.bg → détourage + net
  const baseDataURL = c.toDataURL("image/jpeg", 0.97);

  let plateFound = false;
  let savedCorners = null;

  const yolo = await detectPlateYOLO(photoFile);
  if (yolo) {
    plateFound = true;
    // ── Diagnostic console : qui pilote la pose du cache plaque, et
    // ── pourquoi (utile pour calibrer le gate sur photos réelles).
    // ── On expose tous les champs de diagnostic du backend pour que la
    // ── trace soit auto-suffisante : on doit pouvoir lire UNE seule
    // ── ligne de log et savoir pourquoi le rendu est ce qu'il est.
    try {
      const gt = yolo.gate_telemetry || {};
      const top_rej = (gt.rejection_reasons || []).slice(0, 5).map(r => ({
        method: r.method, reason: r.reason, score: r.score,
        ar: r.ar, contain: r.contain, area_ratio: r.area_ratio,
        center: [r.center_dx_norm, r.center_dy_norm],
        max_corner_outside: r.max_corner_outside,
        center_score: r.center_score, size_score: r.size_score,
        is_perspective: r.is_perspective,
        tilts: [r.top_tilt_deg, r.bottom_tilt_deg, r.left_tilt_deg, r.right_tilt_deg],
        skews: [r.width_skew, r.height_skew],
        gate_failed_on: r.gate_failed_on,
      }));
      // eslint-disable-next-line no-console
      console.log('[YOLO]', photoFile.name, {
        // Décision finale
        source:                            yolo.source,
        render_source:                     yolo.render_source ?? yolo.source,
        gate_reason:                       yolo.gate_reason,
        gate_failed_on:                    yolo.gate_failed_on,
        quad_source:                       yolo.quad_source,
        promotion_reason:                  yolo.promotion_reason,
        rejection_reason:                  yolo.rejection_reason,
        // Géométries (toutes accessibles côté frontend pour cross-check)
        bbox:                              yolo.bbox,
        corners:                           yolo.corners,
        render_corners:                    yolo.render_corners ?? yolo.corners,
        bbox_stable_corners:               yolo.bbox_stable_corners ?? yolo.bbox_stable,
        opencv_corners:                    yolo.opencv_corners,
        rejected_opencv_corners:           yolo.rejected_opencv_corners ?? yolo.opencv_corners,
        best_opencv_candidate_corners:     yolo.best_opencv_candidate_corners,
        best_opencv_candidate_method:      yolo.best_opencv_candidate_method,
        best_opencv_candidate_score:       yolo.best_opencv_candidate_score,
        // Telemetry agrégée
        passes_count:                      gt.passes_count,
        persp_count:                       gt.persp_count,
        candidates_seen:                   gt.candidates_seen,
        chosen_method:                     gt.chosen_method,
        chosen_score:                      gt.chosen_score,
        near_miss:                         gt.near_miss,
        picks:                             gt.picks,
        rejection_reasons:                 top_rej,
        // Front plate refinement
        front_plate_detected:              yolo.front_plate_detected ?? false,
        front_plate_telemetry:             yolo.front_plate_telemetry ?? null,
      });
    } catch (e) { /* logging is best-effort */ }
    // ── Render geometry — priorité absolue à `yolo.corners` (le quad
    // ── que le backend a élu : keypoints, opencv_promoted ou
    // ── bbox_stable). Ce champ EST `render_corners` — drawPerspective
    // ── est piloté par lui. La bbox n'est utilisée qu'en dernier recours
    // ── pour fournir un savedCorners utilisable dans « Ajuster » manuel.
    if (yolo.corners && yolo.corners.length === 4) {
      savedCorners = { tl: yolo.corners[0], tr: yolo.corners[1], br: yolo.corners[2], bl: yolo.corners[3] };
    } else {
      const b = yolo.bbox;
      savedCorners = { tl: { x: b.x1, y: b.y1 }, tr: { x: b.x2, y: b.y1 }, br: { x: b.x2, y: b.y2 }, bl: { x: b.x1, y: b.y2 } };
    }
  }

  // Rendu auto du cache plaque : on dessine le logo en perspective si
  // la source des coins est validée par le backend :
  //   - keypoints       → modèle pose (priorité absolue)
  //   - opencv_promoted → quad OpenCV qui a passé le quality gate ET
  //                       montré une vraie perspective (3/4 visible)
  //   - bbox_stable     → quad axis-aligned dérivé de la bbox YOLO
  // Les anciennes sources (opencv_fallback / tightened_bbox) ne sont
  // plus exposées et ne sont jamais auto-rendues.
  const autoRenderableSource = yolo?.source === 'keypoints'
                            || yolo?.source === 'opencv_promoted'
                            || yolo?.source === 'front_plate_refined'
                            || yolo?.source === 'bbox_stable';

  if (autoRenderableSource && savedCorners && logoImg) {
    const toPixel = p => ({ x: p.x * c.width, y: p.y * c.height });
    const ptl = toPixel(savedCorners.tl), ptr = toPixel(savedCorners.tr);
    const pbr = toPixel(savedCorners.br), pbl = toPixel(savedCorners.bl);

    try {
      const eps = 1.5;
      const isAxisAligned =
        Math.abs(ptl.y - ptr.y) < eps &&
        Math.abs(pbl.y - pbr.y) < eps &&
        Math.abs(ptl.x - pbl.x) < eps &&
        Math.abs(ptr.x - pbr.x) < eps;
      console.log('[draw]', photoFile.name, {
        label_source:       yolo.render_source ?? yolo.source,
        gate_reason:        yolo.gate_reason,
        savedCorners_norm:  savedCorners,
        drawPerspective_px: { tl: ptl, tr: ptr, br: pbr, bl: pbl },
        is_axis_aligned:    isAxisAligned,
        is_front_plate_refined: (yolo.render_source ?? yolo.source) === 'front_plate_refined',
        front_plate_telemetry:  yolo.front_plate_telemetry ?? null,
        same_as_render:     JSON.stringify([
          savedCorners.tl, savedCorners.tr, savedCorners.br, savedCorners.bl,
        ]) === JSON.stringify(yolo.corners || []),
      });
    } catch (e) { /* best-effort */ }

    const renderSource = yolo.render_source ?? yolo.source;
    drawPlateOverlay(ctx, logoImg, ptl, ptr, pbr, pbl, bgColor, renderSource);
  }
  const yoloBbox             = yolo?.bbox    ? { ...yolo.bbox, conf: yolo.conf } : null;
  const yoloCorners          = yolo?.corners ?? null;       // = render_corners
  const yoloDebug            = yolo?.debug   ?? null;
  const yoloSource           = yolo?.source  ?? null;
  // Render-geometry telemetry — qui pilote le cache plaque, et pourquoi.
  const yoloRenderSource     = yolo?.render_source    ?? yolo?.source ?? null;
  const yoloQuadSource       = yolo?.quad_source      ?? null;  // ex. "plate_edges:v=2_s=3:eps=0.04"
  const yoloPromotionReason  = yolo?.promotion_reason ?? null;
  const yoloRejectionReason  = yolo?.rejection_reason ?? null;
  // Quad OpenCV historique (« chosen » de refine_corners) ET quad
  // bbox_stable (filet axe-aligné) — exposés pour les overlays debug
  // « rejected_opencv » (orange dashed) et « bbox_stable » (bleu dashed).
  const yoloOpencvCorners    = yolo?.opencv_corners   ?? null;
  const yoloBboxStable       = yolo?.bbox_stable      ?? null;
  // Telemetry agrégée du gate (picks, rejection_reasons[], counts).
  const yoloGateTelemetry    = yolo?.gate_telemetry   ?? null;
  const yoloFrontPlateDetected  = yolo?.front_plate_detected ?? false;
  const yoloFrontPlateTelemetry = yolo?.front_plate_telemetry ?? null;
  return { name: photoFile.name, processed: c.toDataURL("image/jpeg", 0.97), plateFound, baseDataURL, corners: savedCorners, yoloBbox, yoloCorners, yoloDebug, yoloSource, yoloRenderSource, yoloQuadSource, yoloPromotionReason, yoloRejectionReason, yoloOpencvCorners, yoloBboxStable, yoloGateTelemetry, yoloFrontPlateDetected, yoloFrontPlateTelemetry, imgW: c.width, imgH: c.height };
}

const Slider = ({ label, value, min, max, step, onChange }) => (
  <div style={{ marginBottom: 18 }}>
    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 7 }}>
      <span style={{ fontSize: 11, letterSpacing: 2, textTransform: "uppercase", color: "#ddd", fontFamily: "'JetBrains Mono',monospace" }}>{label}</span>
      <span style={{ fontSize: 12, color: "#f26522", fontFamily: "'JetBrains Mono',monospace" }}>{value.toFixed(2)}</span>
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
  const [showPassword, setShowPassword] = useState(false);
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [cgvAccepted, setCgvAccepted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const submit = async () => {
    setError(""); setSuccess(""); setLoading(true);
    try {
      if (mode === "reset") {
        const { error } = await supabase.auth.resetPasswordForEmail(email);
        if (error) throw error;
        setSuccess("Email de réinitialisation envoyé ! Vérifiez votre boîte de réception.");
      } else if (mode === "login") {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        onAuth(data.user);
      } else {
        if (!fullName.trim()) throw new Error("Veuillez entrer votre nom ou nom d'entreprise.");
        if (!phone.trim()) throw new Error("Veuillez entrer votre numéro de téléphone.");
        if (!cgvAccepted) throw new Error("Veuillez accepter les CGV et la politique de confidentialité.");
        const { data: signUpData, error } = await supabase.auth.signUp({
          email, password,
          options: { data: { full_name: fullName.trim(), phone: phone.trim() } }
        });
        if (error) throw error;
        // Stocker le téléphone dans la colonne phone de Supabase (sans vérification)
        if (signUpData?.user?.id) {
          await fetch('/api/set-user-phone', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: signUpData.user.id, phone: phone.trim() })
          }).catch(() => {}); // non-bloquant si ça échoue
        }
        setSuccess("Compte créé ! Vérifiez votre email puis connectez-vous.");
        setMode("login");
      }
    } catch (e) { setError(e.message || "Une erreur est survenue"); }
    setLoading(false);
  };

  return (
    <div style={{ minHeight: "100vh", background: "#1c1c1c", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Rajdhani',sans-serif" }}>
      <div style={{ width: 380, padding: 40, background: "#161616", border: "1px solid #252525", borderRadius: 4 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 36 }}>
          <svg width="22" height="22" viewBox="0 0 22 22">
            <polygon points="11,1 21,6 21,16 11,21 1,16 1,6" fill="#f26522" />
            <polygon points="11,5 17,8 17,14 11,17 5,14 5,8" fill="#0f0f0f" />
          </svg>
          <span style={{ fontSize: 20, fontWeight: 700, letterSpacing: 4, textTransform: "uppercase", color: "#ddd5c8" }}>AutoCache</span>
          <span style={{ fontSize: 10, color: "#f26522", letterSpacing: 2, fontFamily: "'JetBrains Mono',monospace" }}>PRO</span>
        </div>
        <div style={{ display: "flex", marginBottom: 28, borderBottom: "1px solid #1c1c1c" }}>
          {[["login", "Connexion"], ["signup", "Inscription"]].map(([m, label]) => (
            <button key={m} onClick={() => { setMode(m); setError(""); setSuccess(""); }} style={{
              flex: 1, background: "transparent", border: "none",
              borderBottom: mode === m ? "2px solid #f26522" : "2px solid transparent",
              color: mode === m ? "#ddd5c8" : "#444", padding: "10px 0",
              cursor: "pointer", fontFamily: "'Rajdhani',sans-serif",
              fontSize: 14, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase",
              transition: "all 0.15s", marginBottom: -1
            }}>{label}</button>
          ))}
        </div>
        {[
          ["Email", email, setEmail, "email", true],
          ...(mode === "signup" ? [
            ["Nom / Nom d'entreprise", fullName, setFullName, "text", true],
            ["Téléphone", phone, setPhone, "tel", true],
          ] : []),
          ...(mode !== "reset" ? [["Mot de passe", password, setPassword, "password", true]] : []),
        ].map(([label, val, set, type]) => {
          const isPassword = type === "password";
          const effectiveType = isPassword && showPassword ? "text" : type;
          return (
            <div key={label} style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 10, letterSpacing: 2, color: "#ddd", textTransform: "uppercase", fontFamily: "'JetBrains Mono',monospace", marginBottom: 6 }}>{label}</div>
              <div style={{ position: "relative" }}>
                <input type={effectiveType} value={val} onChange={e => set(e.target.value)} onKeyDown={e => e.key === "Enter" && submit()}
                  placeholder={type === "tel" ? "06 12 34 56 78" : ""}
                  autoComplete={isPassword ? (mode === "signup" ? "new-password" : "current-password") : undefined}
                  style={{ width: "100%", background: "#1a1a1a", border: "1px solid #222", color: "#ddd5c8", padding: isPassword ? "10px 44px 10px 12px" : "10px 12px", borderRadius: 3, fontFamily: "'JetBrains Mono',monospace", fontSize: 13, outline: "none", boxSizing: "border-box" }} />
                {isPassword && (
                  <button
                    type="button"
                    onClick={() => setShowPassword(p => !p)}
                    aria-label={showPassword ? "Masquer le mot de passe" : "Afficher le mot de passe"}
                    title={showPassword ? "Masquer le mot de passe" : "Afficher le mot de passe"}
                    style={{
                      position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)",
                      background: "transparent", border: "none", padding: "6px 8px",
                      cursor: "pointer", color: showPassword ? "#f26522" : "#ddd",
                      fontSize: 17, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center",
                      minHeight: "unset",
                    }}
                  >
                    {showPassword ? "🙈" : "👁"}
                  </button>
                )}
              </div>
            </div>
          );
        })}
        {mode === "signup" && (
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 18, marginTop: 4 }}>
            <div
              onClick={() => setCgvAccepted(p => !p)}
              style={{ width: 16, height: 16, borderRadius: 3, border: `2px solid ${cgvAccepted ? "#f26522" : "#444"}`, background: cgvAccepted ? "#f26522" : "transparent", flexShrink: 0, marginTop: 1, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
              {cgvAccepted && <span style={{ color: "#090909", fontSize: 12, fontWeight: 900, lineHeight: 1 }}>✓</span>}
            </div>
            <div style={{ fontSize: 11, color: "#ddd", fontFamily: "'JetBrains Mono',monospace", lineHeight: 1.6 }}>
              J'ai lu et j'accepte les{" "}
              <a href="/cgv.html" target="_blank" style={{ color: "#f26522", textDecoration: "none" }}>CGV</a>
              {" "}et la{" "}
              <a href="/politique-confidentialite.html" target="_blank" style={{ color: "#f26522", textDecoration: "none" }}>politique de confidentialité</a>
              {" "}d'AutoCache Pro.
            </div>
          </div>
        )}
        {mode === "login" && (
          <div style={{ textAlign: "right", marginBottom: 14, marginTop: -8 }}>
            <span onClick={() => { setMode("reset"); setError(""); setSuccess(""); }}
              style={{ fontSize: 11, color: "#f26522", cursor: "pointer", fontFamily: "'JetBrains Mono',monospace", letterSpacing: 1 }}>
              Mot de passe oublié ?
            </span>
          </div>
        )}
        {mode === "reset" && (
          <div style={{ fontSize: 11, color: "#ddd", marginBottom: 14, fontFamily: "'JetBrains Mono',monospace", lineHeight: 1.5 }}>
            Entrez votre email. Vous recevrez un lien pour réinitialiser votre mot de passe.
          </div>
        )}
        {error && <div style={{ fontSize: 11, color: "#e55", marginBottom: 14, fontFamily: "'JetBrains Mono',monospace" }}>⚠ {error}</div>}
        {success && <div style={{ fontSize: 11, color: "#5a5", marginBottom: 14, fontFamily: "'JetBrains Mono',monospace" }}>✓ {success}</div>}
        <button onClick={submit} disabled={loading} style={{
          width: "100%", background: "#f26522", color: "#090909", border: "none",
          padding: "13px 24px", cursor: loading ? "wait" : "pointer",
          fontFamily: "'Rajdhani',sans-serif", fontSize: 14, fontWeight: 700,
          letterSpacing: 4, textTransform: "uppercase", borderRadius: 3,
          opacity: loading ? 0.7 : 1, marginTop: 4
        }}>
          {loading ? "..." : mode === "login" ? "Se connecter" : mode === "reset" ? "Envoyer le lien" : "Créer mon compte"}
        </button>
        {mode === "reset" && (
          <div style={{ textAlign: "center", marginTop: 14 }}>
            <span onClick={() => { setMode("login"); setError(""); setSuccess(""); }}
              style={{ fontSize: 11, color: "#ddd", cursor: "pointer", fontFamily: "'JetBrains Mono',monospace", letterSpacing: 1 }}>
              ← Retour à la connexion
            </span>
          </div>
        )}
        <div style={{ marginTop: 28, paddingTop: 18, borderTop: "1px solid #1a1a1a", textAlign: "center", fontSize: 10, color: "#4a4a4a", fontFamily: "'JetBrains Mono',monospace", lineHeight: 2, letterSpacing: 1 }}>
          <a href="/cgv.html" target="_blank" style={{ color: "#4a4a4a", textDecoration: "none", marginRight: 16 }}>CGV & Mentions légales</a>
          <a href="/politique-confidentialite.html" target="_blank" style={{ color: "#4a4a4a", textDecoration: "none" }}>Politique de confidentialité</a>
        </div>
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
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [showPromoModal, setShowPromoModal] = useState(false);
  const [showUpgradeProModal, setShowUpgradeProModal] = useState(false);
  const [showPlansModal, setShowPlansModal] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showContactModal, setShowContactModal] = useState(false);
  const [showMiniGame,     setShowMiniGame]     = useState(false);
  const [showTutorial, setShowTutorial] = useState(false);
  const [showCreditPopup, setShowCreditPopup] = useState(false);
  const [subInfo, setSubInfo] = useState(null); // { periodStart, periodEnd, plan, daysLeft }
  const [subInfoLoading, setSubInfoLoading] = useState(false);
  const creditPopupRef = useRef(null);
  const [showHeadlightInfoModal, setShowHeadlightInfoModal] = useState(false);
  const [showHeadlightBatchModal, setShowHeadlightBatchModal] = useState(false);
  const [headlightInfoDismissed, setHeadlightInfoDismissed] = useState(() => localStorage.getItem('headlightInfoDismissed') === '1');
  const [hoveredPlan, setHoveredPlan] = useState(null);
  const [checkoutLoading, setCheckoutLoading] = useState(null); // "essential" | "pro" | null
  const [portalLoading, setPortalLoading] = useState(null); // null | "invoices" | "cancel" | "upgrade"
  const [portalError, setPortalError] = useState("");
  const [promoCode, setPromoCode] = useState("");
  const [promoStatus, setPromoStatus] = useState(null); // null | "loading" | "success" | "error"
  const [promoMsg, setPromoMsg] = useState("");
  const isMobile = useIsMobile();
  const TRIAL_LIMIT = 30;
  const [adj, setAdj] = useState({ brightness: 1.05, contrast: 1.1, saturation: 1.2 });
  const [adjEnabled, setAdjEnabled] = useState(false);
  const [enhance, setEnhance] = useState(false);
  const [headlightPolish, setHeadlightPolish] = useState(false);
  const [bodyPolish, setBodyPolish] = useState(false);
  const [floorClean, setFloorClean] = useState(false);
  const [enhancePro, setEnhancePro] = useState(false); // couleurs froides + sol uniforme
  const [enhanceProIntensity, setEnhanceProIntensity] = useState(2); // 0–5 : force de la réduction du jaune (2 par défaut, modifiable)
  const [tab, setTab] = useState("setup");
  const [dragOver, setDragOver] = useState(null);
  // ── Mode logo : import fichier OU génération texte+couleur ──
  const [logoMode, setLogoMode] = useState("import"); // "import" | "generate"
  const [genText,  setGenText]  = useState("");
  const [genBg,    setGenBg]    = useState("#0d2b6b");
  const [genFg,    setGenFg]    = useState("#ffffff");
  const [genFont,  setGenFont]  = useState("impact");
  const [genBorderColor, setGenBorderColor] = useState("#ffffff");
  const [genBorderWidth, setGenBorderWidth] = useState(0); // 0–10 : épaisseur du liseret
  const [logoRadius, setLogoRadius] = useState(1); // 0–10 : arrondi des coins, commun import+génération
  const [logoCropActive, setLogoCropActive] = useState(false);
  const [logoCropBox, setLogoCropBox] = useState({ x: 0, y: 0, w: 1, h: 1 });
  const [logoCropDrag, setLogoCropDrag] = useState(null);
  const [logoOriginal, setLogoOriginal] = useState(null);
  const [lightbox, setLightbox] = useState(null);
  // Sync ref of the lightbox state, so async loops can read the latest value
  // without re-entering setState.
  const lightboxRef = useRef(null);
  useEffect(() => { lightboxRef.current = lightbox; }, [lightbox]);
  const [cropMode, setCropMode] = useState(false);
  const [cropBox, setCropBox] = useState({ x: 0.1, y: 0.1, w: 0.8, h: 0.8 });
  const [cropDrag, setCropDrag] = useState(null); // { type, startMx, startMy, startBox }
  const [cropAngle, setCropAngle] = useState(180); // 0-360, 180 = photo droite (0° de rotation)
  const [adjustMode, setAdjustMode] = useState(false);
  const [showMaskEditor, setShowMaskEditor] = useState(false);
  const [adjustCorners, setAdjustCorners] = useState(null); // { tl, tr, br, bl } normalized 0-1
  const [adjustDrag, setAdjustDrag] = useState(null); // { corner, startMx, startMy, startCorners }
  const [manualPlateMode, setManualPlateMode] = useState(false); // true = pose manuelle (plaque non détectée)
  const [lbZoom, setLbZoom] = useState(1);            // zoom de la lightbox (1 = normal, max 8)
  const [lbPan,  setLbPan]  = useState({ x: 0, y: 0 }); // décalage (px) du calque zoomé
  const [lbPanDrag, setLbPanDrag] = useState(null);   // { startMx, startMy, startPan }
  const [settingsOpen, setSettingsOpen] = useState(false); // menu settings en haut à droite
  const settingsRef = useRef(null); // ref pour fermer au clic extérieur
  const logoRef        = useRef();
  const logoCropContainerRef = useRef(null);
  const photosRef      = useRef();
  const cropImgRef       = useRef(null); // ref sur l'<img> de la lightbox (hors crop)
  const cropCanvasRef    = useRef(null); // canvas live-preview en mode Rogner
  const cropBaseImgRef   = useRef(null); // photo chargée pour le canvas de rognage
  const lbContainerRef   = useRef(null); // ref sur le conteneur de la lightbox (zoom/pan)
  const pinchRef         = useRef(null); // { dist, midX, midY, startZoom, startPan }
  const adjustCanvasRef  = useRef(null); // canvas live-preview en mode Ajuster
  const adjustBaseImgRef           = useRef(null);
  const adjustLogoImgRef           = useRef(null);
  const adjustIsShowroomRef        = useRef(false);
  const adjustShowroomTransformRef = useRef(null);
  const adjustLogoBgRef  = useRef(null); // couleur de fond du trapèze
  const adjustCornersRef = useRef(null); // derniers coins (mis à jour direct, sans passer par setState)
  const adjustDragRef    = useRef(null); // sync immédiat avec setAdjustDrag (évite état périmé sur touch)

  // ── Showroom Setup (page principale) ──────────────────────────────────────
  const [showroomEnabled,      setShowroomEnabled]      = useState(false);
  const [showroomSetupBg,      setShowroomSetupBg]      = useState(0);
  const [showroomSetupCustomBg, setShowroomSetupCustomBg] = useState(null);
  const [showroomFloorShadow,  setShowroomFloorShadow]  = useState(true); // case "Ombres au sol" — décochée = pas de calcul d'ombre (plus rapide)
  const showroomSetupUploadRef = useRef(null);
  // ── Logo mural (affiché sur le mur du showroom) ──────────────────────────
  const [wallLogoMode, setWallLogoMode]     = useState("none"); // "none" | "image" | "text"
  const [wallLogo, setWallLogo]             = useState(null); // data URL du logo mural
  const [wallLogoScale, setWallLogoScale]   = useState(0.18); // taille relative (0.05–0.40)
  const [wallLogoOpacity, setWallLogoOpacity] = useState(0.85);
  const wallLogoUploadRef = useRef(null);
  const [wallLogoDrag, setWallLogoDrag]     = useState(null); // drag en cours dans la lightbox
  // ── Texte mural ──
  const [wallText, setWallText]             = useState("");
  const [wallTextColor, setWallTextColor]   = useState("#ffffff");
  const [wallTextFont, setWallTextFont]     = useState("Rajdhani");
  const [wallTextStrokeColor, setWallTextStrokeColor] = useState("#000000");
  const [wallTextStrokeWidth, setWallTextStrokeWidth] = useState(0); // 0 = désactivé
  const [wallTextUnderline, setWallTextUnderline]     = useState(false);
  // ── Showroom nudge + zoom (repositionnement / taille voiture) ────────────
  const [showroomNudge,   setShowroomNudge]   = useState({ x: 0, y: 0 });
  const [showroomZoom,    setShowroomZoom]    = useState(1.0);
  const [showroomBlend,   setShowroomBlend]   = useState(0); // 0-100, intensité de fondu voiture/décor
  const [showroomNudging, setShowroomNudging] = useState(false);
  const zoomTimerRef = useRef(null);
  const blendTimerRef = useRef(null);
  const [shadowOpacity, setShadowOpacity] = useState(SHADOW_STRENGTH);
  const [shadowBlur, setShadowBlur] = useState(0);
  const [shadowYOffset, setShadowYOffset] = useState(0);
  const [shadowSpread, setShadowSpread] = useState(1.0);
  const shadowTimerRef = useRef(null);
  const [passwordRecovery, setPasswordRecovery] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordConfirm, setNewPasswordConfirm] = useState("");
  const [recoveryMsg, setRecoveryMsg] = useState("");
  const [recoveryErr, setRecoveryErr] = useState("");
  const [recoveryLoading, setRecoveryLoading] = useState(false);
  const [showRecoveryPassword, setShowRecoveryPassword] = useState(false);

  // Restaurer logos depuis localStorage au démarrage (persistent même après déconnexion)
  useEffect(() => {
    try {
      const savedPreview = localStorage.getItem('ac_logo_preview');
      if (savedPreview) {
        const wasGenerated = localStorage.getItem('ac_logo_generated') === '1';
        const savedBg = localStorage.getItem('ac_logo_bgcolor') || '#ffffff';
        setLogo({ file: null, preview: savedPreview, generated: wasGenerated, bgColor: savedBg });
        setLogoMode('import');
      }
      const savedOriginal = localStorage.getItem('ac_logo_original');
      if (savedOriginal) setLogoOriginal(savedOriginal);
      const savedWallMode = localStorage.getItem('ac_wall_logo_mode');
      const savedWallLogo = localStorage.getItem('ac_wall_logo');
      if (savedWallMode === 'image' && savedWallLogo) {
        setWallLogoMode('image');
        setWallLogo(savedWallLogo);
      }
    } catch(e) {}
  }, []);

  // Sauvegarder logo cache plaque → localStorage
  useEffect(() => {
    if (!logo?.preview || !logo.preview.startsWith('data:')) return;
    try {
      localStorage.setItem('ac_logo_preview', logo.preview);
      localStorage.setItem('ac_logo_generated', logo.generated ? '1' : '0');
      if (logo.bgColor) localStorage.setItem('ac_logo_bgcolor', logo.bgColor);
    } catch(e) {}
  }, [logo]);

  useEffect(() => {
    try {
      if (logoOriginal) localStorage.setItem('ac_logo_original', logoOriginal);
      else localStorage.removeItem('ac_logo_original');
    } catch(e) {}
  }, [logoOriginal]);

  useEffect(() => {
    if (!logoCropDrag) return;
    const up = () => setLogoCropDrag(null);
    document.addEventListener('mouseup', up);
    document.addEventListener('touchend', up);
    return () => { document.removeEventListener('mouseup', up); document.removeEventListener('touchend', up); };
  }, [logoCropDrag]);

  // Sauvegarder logo mural → localStorage
  useEffect(() => {
    try {
      if (wallLogoMode === 'image' && wallLogo) {
        localStorage.setItem('ac_wall_logo_mode', 'image');
        localStorage.setItem('ac_wall_logo', wallLogo);
      } else if (wallLogoMode !== 'image') {
        localStorage.setItem('ac_wall_logo_mode', wallLogoMode);
      }
    } catch(e) {}
  }, [wallLogo, wallLogoMode]);

  useEffect(() => {
    // Retour depuis Stripe Checkout
    const params = new URLSearchParams(window.location.search);
    if (params.get("payment") === "success") {
      window.history.replaceState({}, "", window.location.pathname);
      // Recharger la session pour récupérer le plan mis à jour par le webhook
      setTimeout(() => supabase.auth.refreshSession(), 2000);
    }
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user || null);
      setAuthLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user || null);
      if (event === "PASSWORD_RECOVERY") {
        setPasswordRecovery(true);
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  // ── Didacticiel automatique à la première connexion ──
  useEffect(() => {
    if (!user || authLoading) return;
    if (!user.user_metadata?.tutorial_seen) {
      // Basculer sur l'onglet Configuration pour que les éléments cibles existent
      setTab("setup");
      const t = setTimeout(() => setShowTutorial(true), 600);
      return () => clearTimeout(t);
    }
  }, [user, authLoading]);

  // ── Préchauffe le module @imgly/background-removal dès que l'utilisateur
  // est authentifié, pour ne plus payer le coût d'init au premier traitement.
  useEffect(() => {
    if (!user || authLoading) return;
    const idleCb = window.requestIdleCallback ?? ((cb) => setTimeout(cb, 1500));
    const handle = idleCb(() => preloadBackgroundRemoval());
    return () => {
      if (window.cancelIdleCallback && typeof handle === 'number') window.cancelIdleCallback(handle);
    };
  }, [user, authLoading]);

  const closeTutorial = useCallback(async () => {
    setShowTutorial(false);
    if (user && !user.user_metadata?.tutorial_seen) {
      try {
        await supabase.auth.updateUser({ data: { tutorial_seen: true } });
        setUser(prev => prev ? { ...prev, user_metadata: { ...prev.user_metadata, tutorial_seen: true } } : prev);
      } catch (e) { console.warn('[Tutorial] save failed:', e.message); }
    }
  }, [user]);

  // ── Auto-déconnexion après 1 h d'inactivité ──
  useEffect(() => {
    if (!user) return;
    const IDLE_MS = 60 * 60 * 1000; // 1 heure
    let timer = setTimeout(() => {
      supabase.auth.signOut();
    }, IDLE_MS);
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(() => { supabase.auth.signOut(); }, IDLE_MS);
    };
    const events = ["mousedown", "keydown", "touchstart", "scroll"];
    events.forEach(e => window.addEventListener(e, reset, { passive: true }));
    return () => {
      clearTimeout(timer);
      events.forEach(e => window.removeEventListener(e, reset));
    };
  }, [user]);

  // Fermer le menu settings au clic extérieur
  useEffect(() => {
    if (!settingsOpen) return;
    const handler = (e) => {
      if (settingsRef.current && !settingsRef.current.contains(e.target)) setSettingsOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [settingsOpen]);

  // Regénère le cache plaque dès qu'un paramètre change (mode génération)
  useEffect(() => {
    if (logoMode !== "generate") return;
    setLogo({ file: null, preview: makeLogoDataURL(genText, genBg, genFg, logoRadius * 5, genFont, genBorderWidth > 0 ? genBorderColor : null, genBorderWidth), generated: true, bgColor: genBg });
  }, [logoMode, genText, genBg, genFg, logoRadius, genFont, genBorderColor, genBorderWidth]);

  const handleLogoFile = (f) => {
    if (!f?.type.startsWith("image/")) return;
    setLogoMode("import");
    setLogoOriginal(null);
    setLogoCropActive(false);
    setLogoCropBox({ x: 0, y: 0, w: 1, h: 1 });
    const reader = new FileReader();
    reader.onload = (e) => setLogo({ file: f, preview: e.target.result, generated: false, bgColor: '#ffffff' });
    reader.readAsDataURL(f);
  };

  const startLogoCropDrag = (e, type) => {
    e.preventDefault(); e.stopPropagation();
    const cx = e.touches ? e.touches[0].clientX : e.clientX;
    const cy = e.touches ? e.touches[0].clientY : e.clientY;
    setLogoCropDrag({ type, startMx: cx, startMy: cy, startBox: { ...logoCropBox } });
  };

  const onLogoCropMove = (e) => {
    if (!logoCropDrag || !logoCropContainerRef.current) return;
    const cx = e.touches ? e.touches[0].clientX : e.clientX;
    const cy = e.touches ? e.touches[0].clientY : e.clientY;
    const rect = logoCropContainerRef.current.getBoundingClientRect();
    const dx = (cx - logoCropDrag.startMx) / rect.width;
    const dy = (cy - logoCropDrag.startMy) / rect.height;
    let { x, y, w, h } = logoCropDrag.startBox;
    const t = logoCropDrag.type;
    if (t === 'move')              { x += dx; y += dy; }
    if (t === 'tl' || t === 'bl') { const nw = w - dx; if (nw > 0.05) { x += dx; w = nw; } }
    if (t === 'tr' || t === 'br') { w = Math.max(0.05, w + dx); }
    if (t === 'tl' || t === 'tr') { const nh = h - dy; if (nh > 0.05) { y += dy; h = nh; } }
    if (t === 'bl' || t === 'br') { h = Math.max(0.05, h + dy); }
    x = Math.max(0, Math.min(1 - w, x));
    y = Math.max(0, Math.min(1 - h, y));
    w = Math.min(1 - x, w); h = Math.min(1 - y, h);
    setLogoCropBox({ x, y, w, h });
  };

  const applyLogoCrop = () => {
    if (!logo?.preview) return;
    const srcDataURL = logoOriginal || logo.preview;
    const img = new Image();
    img.onload = () => {
      const { x, y, w, h } = logoCropBox;
      const sx = Math.round(x * img.naturalWidth);
      const sy = Math.round(y * img.naturalHeight);
      const sw = Math.max(1, Math.round(w * img.naturalWidth));
      const sh = Math.max(1, Math.round(h * img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = sw; c.height = sh;
      c.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
      if (!logoOriginal) setLogoOriginal(logo.preview);
      setLogo({ ...logo, preview: c.toDataURL('image/png') });
      setLogoCropActive(false);
      setLogoCropBox({ x: 0, y: 0, w: 1, h: 1 });
    };
    img.src = srcDataURL;
  };

  const handlePhotoFiles = files => {
    const imgs = Array.from(files).filter(f => f.type.startsWith("image/"));
    setPhotos(prev => [...prev, ...imgs.map(f => ({ file: f, preview: URL.createObjectURL(f), id: `${f.name}-${Math.random()}` }))]);
  };

  const startAfterInfo = async () => {
    if (!logo || !photos.length) return;
    const photosUsed = user?.user_metadata?.photos_used ?? 0;
    if (photosUsed >= PLAN_LIMIT) { setShowUpgradeModal(true); return; }
    const remaining = PLAN_LIMIT - photosUsed;
    if (headlightPolish) {
      if (headlightCreditsRemaining <= 0) {
        alert("Vous avez utilisé vos 10 crédits Lustrage Optique Pro ce mois-ci.");
        return;
      }
      if (photos.length > HEADLIGHT_BATCH_LIMIT) {
        setShowHeadlightBatchModal(true);
        return;
      }
    }
    const maxPhotos = headlightPolish ? Math.min(remaining, headlightCreditsRemaining) : remaining;
    const photosToProcess = photos.slice(0, maxPhotos);
    setProcessing(true);
    setProgress({ n: 0, total: photosToProcess.length });
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
      flatCtx.drawImage(rawLogo, 0, 0); // pas de fond blanc : préserve les couleurs et transparences d'origine
      logoImg = flatCanvas;
    }
    const bgColor = logo.bgColor || "#ffffff";
    // Résoudre le wall logo final (image importée OU texte généré)
    let resolvedWallLogo = null;
    if (wallLogoMode === "image" && wallLogo) {
      resolvedWallLogo = wallLogo;
    } else if (wallLogoMode === "text" && wallText.trim()) {
      resolvedWallLogo = makeWallTextDataURL(wallText, wallTextColor, wallTextFont, wallTextStrokeWidth > 0 ? wallTextStrokeColor : null, wallTextStrokeWidth, wallTextUnderline);
    }
    // Pré-calculer le ratio h/w du wall logo pour le positionnement
    let wallLogoRatio = 0.4; // fallback
    if (resolvedWallLogo) {
      try { const wli = await loadImg(resolvedWallLogo); wallLogoRatio = wli.naturalHeight / wli.naturalWidth; } catch(e) {}
    }
    const all = [];
    const showroomBgDataUrl = showroomEnabled
      ? (showroomSetupBg === 'custom' && showroomSetupCustomBg
          ? showroomSetupCustomBg
          : (SHOWROOM_IMAGES[showroomSetupBg] ?? makeShowroomBackground(showroomSetupBg, 2400, 1350)))
      : null;

    for (let i = 0; i < photosToProcess.length; i++) {
      const r = await processPhoto(photosToProcess[i].file, logoImg, adjEnabled ? adj : { brightness: 1, contrast: 1, saturation: 1 }, bgColor, enhance, headlightPolish, !!logoImg || showroomEnabled, floorClean, enhancePro, bodyPolish, enhanceProIntensity);
      const entry = { ...r, logoPreview: logo.preview, bgColor, generated: !!logo.generated };
      if (showroomEnabled && showroomBgDataUrl) {
        try {
          // Vehicle detection + instance segmentation (backend) or fallback (@imgly + heuristics)
          const vehicleResult = await detectVehicles(photosToProcess[i].file);
          const allVehicles = vehicleResult?.vehicles ?? [];
          const mainVehicle = selectMainVehicle(allVehicles, r.yoloBbox ?? null, r.imgW, r.imgH);
          const secondaryVehicles = getSecondaryVehicles(allVehicles, mainVehicle);
          console.log('[Pipeline] mainVehicle=' + (mainVehicle ? mainVehicle.class : 'none') +
            ', secondary=' + secondaryVehicles.length +
            (secondaryVehicles.length > 0 ? ' [' + secondaryVehicles.map(s => s.class).join(',') + ']' : ''));

          // @imgly background removal + heuristic isolation (primary pipeline)
          const roi = estimateMainVehicleROI(mainVehicle, r.yoloBbox ?? null, r.imgW, r.imgH, secondaryVehicles);
          const { croppedUrl, roi: appliedROI } = await cropToROI(r.baseDataURL, roi);
          const croppedCutout = await removeBackground(croppedUrl);
          const fullCutout = await uncropCutout(croppedCutout, appliedROI, r.imgW, r.imgH);
          const isolatedCutout = await isolateMainVehicle(fullCutout, r.yoloBbox ?? null, mainVehicle, secondaryVehicles);
          const separatedCutout = await separateAttachedSecondary(isolatedCutout, mainVehicle, r.yoloBbox ?? null, secondaryVehicles);
          const cutout = await hardGateByVehicleBox(separatedCutout, mainVehicle, r.yoloBbox ?? null, r.imgW, r.imgH, secondaryVehicles);

          // Scan tight bbox du véhicule UNE seule fois — réutilisé par
          // generateShadowFromCarAlpha (si shadow synthétique) ET par
          // compositeCarOnBg (via le hint), évitant un re-scan plein-résolution.
          const cutImg = await loadImg(cutout);
          const cW = cutImg.naturalWidth || cutImg.width, cH = cutImg.naturalHeight || cutImg.height;
          const scanC = document.createElement('canvas');
          scanC.width = cW; scanC.height = cH;
          const scanCtx = scanC.getContext('2d');
          scanCtx.drawImage(cutImg, 0, 0);
          const px = scanCtx.getImageData(0, 0, cW, cH).data;
          let carL = cW, carR = 0, carT = cH, carB = 0;
          for (let y = 0; y < cH; y++)
            for (let x = 0; x < cW; x++)
              if (px[(y * cW + x) * 4 + 3] > 128) {
                if (x < carL) carL = x; if (x > carR) carR = x;
                if (y < carT) carT = y; if (y > carB) carB = y;
              }
          const carBounds = { x: carL, y: carT, w: carR - carL, h: carB - carT };
          entry.carBoundsCache = carBounds;

          let shadowMatteUrl = null;
          if (showroomFloorShadow) {
            if (USE_SOURCE_SHADOW_TRANSFER) {
              const shadow = await extractSourceShadow(r.baseDataURL, cutout);
              shadowMatteUrl = shadow.matteDataUrl;
            } else {
              const plateBox = r.yoloBbox ?? null;
              shadowMatteUrl = await generateShadowFromCarAlpha(cutout, carBounds, plateBox);
            }
          } else {
            console.log('[Showroom] floor shadow skipped (case décochée)');
          }
          // Generate debug images if needed
          const showroomDebug = getShowroomDebugMode();
          let debugDataURL = null;
          if (showroomDebug === 'mainVehicleBoxes' || showroomDebug === 'mainROI') {
            const debugImg = await loadImg(r.baseDataURL);
            const dW = debugImg.naturalWidth || debugImg.width;
            const dH = debugImg.naturalHeight || debugImg.height;
            const dc = document.createElement('canvas');
            dc.width = dW; dc.height = dH;
            const dctx = dc.getContext('2d');
            dctx.drawImage(debugImg, 0, 0);

            if (showroomDebug === 'mainVehicleBoxes') {
              // Draw secondary vehicle exclusion zones (semi-transparent red overlay)
              for (const sv of secondaryVehicles) {
                dctx.fillStyle = 'rgba(255,0,0,0.18)';
                const bx = sv.bbox.x1 * dW, by = sv.bbox.y1 * dH;
                const bw = (sv.bbox.x2 - sv.bbox.x1) * dW, bh = (sv.bbox.y2 - sv.bbox.y1) * dH;
                dctx.fillRect(bx, by, bw, bh);
              }
              // Draw all detected vehicle bboxes
              for (const v of allVehicles) {
                const isSelected = mainVehicle && v === mainVehicle;
                const isSecondary = secondaryVehicles.includes(v);
                dctx.strokeStyle = isSelected ? '#00ff00' : (isSecondary ? '#ff4444' : '#ff8800');
                dctx.lineWidth = isSelected ? 4 : 2;
                if (!isSelected && !isSecondary) dctx.setLineDash([4, 4]); // duplicate overlapping box
                const bx = v.bbox.x1 * dW, by = v.bbox.y1 * dH;
                const bw = (v.bbox.x2 - v.bbox.x1) * dW, bh = (v.bbox.y2 - v.bbox.y1) * dH;
                dctx.strokeRect(bx, by, bw, bh);
                dctx.setLineDash([]);
                // Label
                dctx.fillStyle = isSelected ? '#00ff00' : (isSecondary ? '#ff4444' : '#ff8800');
                dctx.font = 'bold 20px monospace';
                const tag = isSelected ? ' MAIN' : (isSecondary ? ' EXCL' : ' DUP');
                const label = v.class + ' ' + (v.conf * 100).toFixed(0) + '%' + tag;
                dctx.fillText(label, bx + 4, by - 6);
              }
              // Draw plate box
              if (r.yoloBbox) {
                const pb = r.yoloBbox;
                dctx.strokeStyle = '#ffff00';
                dctx.lineWidth = 3;
                dctx.setLineDash([8, 4]);
                const px = (pb.x1 ?? 0) * dW, py = (pb.y1 ?? 0) * dH;
                const pw = ((pb.x2 ?? 0) - (pb.x1 ?? 0)) * dW, ph = ((pb.y2 ?? 0) - (pb.y1 ?? 0)) * dH;
                dctx.strokeRect(px, py, pw, ph);
                dctx.setLineDash([]);
                dctx.fillStyle = '#ffff00';
                dctx.font = 'bold 16px monospace';
                dctx.fillText('PLATE', px + 4, py - 4);
              }
              dctx.fillStyle = 'rgba(0,0,0,0.6)';
              dctx.fillRect(0, 0, 600, 30);
              dctx.fillStyle = '#fff';
              dctx.font = '18px monospace';
              dctx.fillText('mainVehicleBoxes — green=MAIN, red=EXCL, orange=DUP, yellow=plate', 10, 22);
            } else if (showroomDebug === 'mainROI') {
              // Draw ROI rectangle
              if (roi) {
                dctx.fillStyle = 'rgba(0,0,0,0.45)';
                // Darken areas OUTSIDE the ROI
                dctx.fillRect(0, 0, dW, roi.y1 * dH); // top
                dctx.fillRect(0, roi.y2 * dH, dW, dH - roi.y2 * dH); // bottom
                dctx.fillRect(0, roi.y1 * dH, roi.x1 * dW, (roi.y2 - roi.y1) * dH); // left
                dctx.fillRect(roi.x2 * dW, roi.y1 * dH, dW - roi.x2 * dW, (roi.y2 - roi.y1) * dH); // right
                // Draw ROI border
                dctx.strokeStyle = '#00ccff';
                dctx.lineWidth = 3;
                dctx.strokeRect(roi.x1 * dW, roi.y1 * dH, (roi.x2 - roi.x1) * dW, (roi.y2 - roi.y1) * dH);
              }
              // Draw secondary vehicle exclusion zones
              for (const sv of secondaryVehicles) {
                dctx.fillStyle = 'rgba(255,0,0,0.25)';
                const bx = sv.bbox.x1 * dW, by = sv.bbox.y1 * dH;
                const bw = (sv.bbox.x2 - sv.bbox.x1) * dW, bh = (sv.bbox.y2 - sv.bbox.y1) * dH;
                dctx.fillRect(bx, by, bw, bh);
                dctx.strokeStyle = '#ff4444';
                dctx.lineWidth = 2;
                dctx.strokeRect(bx, by, bw, bh);
                dctx.fillStyle = '#ff4444';
                dctx.font = 'bold 14px monospace';
                dctx.fillText('EXCL ' + sv.class, bx + 4, by - 4);
              }
              // Draw selected vehicle bbox
              if (mainVehicle) {
                dctx.strokeStyle = '#00ff00';
                dctx.lineWidth = 2;
                dctx.setLineDash([6, 3]);
                const bx = mainVehicle.bbox.x1 * dW, by = mainVehicle.bbox.y1 * dH;
                const bw = (mainVehicle.bbox.x2 - mainVehicle.bbox.x1) * dW;
                const bh = (mainVehicle.bbox.y2 - mainVehicle.bbox.y1) * dH;
                dctx.strokeRect(bx, by, bw, bh);
                dctx.setLineDash([]);
              }
              dctx.fillStyle = 'rgba(0,0,0,0.6)';
              dctx.fillRect(0, 0, 550, 30);
              dctx.fillStyle = '#fff';
              dctx.font = '18px monospace';
              dctx.fillText('mainROI — cyan=ROI, green=vehicle, red=exclusion, dark=outside', 10, 22);
            }
            debugDataURL = dc.toDataURL('image/jpeg', 0.95);
          }

          const wOpts = resolvedWallLogo ? { src: resolvedWallLogo, scale: wallLogoScale, opacity: wallLogoOpacity, x: 0.5, y: 0.25 } : null;
          // Default blend = 75 so the vehicle integrates with the décor as soon as
          // the photo is generated. User can still drag the slider down to 0 in the
          // lightbox to disable the effect entirely.
          const sr = await compositeCarOnBg(cutout, showroomBgDataUrl, 2400, 1350, logoImg, r.corners, bgColor, 0, 0, 1.0, true, wOpts, shadowMatteUrl, 75, carBounds);

          // For debug modes that show source-based overlays, override the showroom result
          if (debugDataURL) {
            entry.cutoutDataURL     = cutout;
            entry.shadowMatteDataURL = shadowMatteUrl;
            entry.showroomDataURL   = debugDataURL;
            entry.showroomBaseURL   = debugDataURL;
            entry.showroomTransform = sr.transform;
          } else {
            entry.cutoutDataURL     = cutout;
            entry.shadowMatteDataURL = shadowMatteUrl;
            entry.showroomDataURL   = sr.dataURL;
            entry.showroomBaseURL   = sr.baseURL;
            entry.showroomTransform = sr.transform;
          }
          entry.showroomBgUrl     = showroomBgDataUrl;
          entry.showroomBlend     = 75; // default blend so the lightbox slider opens at 75 %
          entry.wallLogoSrc       = resolvedWallLogo;
          entry.wallLogoPos       = { x: 0.5, y: 0.25 };
          entry.wallLogoScale     = wallLogoScale;
          entry.wallLogoOpacity   = wallLogoOpacity;
          entry._wallLogoRatio    = wallLogoRatio;
        } catch(e) {
          console.error('Showroom processing error:', e);
          setError('Showroom : ' + (e?.message || String(e)));
        }
      }
      all.push(entry);
      setResults([...all]);
      setProgress({ n: i + 1, total: photos.length });
    }
    // Mettre à jour le compteur de photos utilisées
    const newCount = photosUsed + photosToProcess.length;
    const updateData = { photos_used: newCount };
    if (headlightPolish) {
      updateData.headlight_photos_used = headlightPhotosUsed + photosToProcess.length;
    }
    await supabase.auth.updateUser({ data: updateData });
    setUser(prev => prev ? { ...prev, user_metadata: { ...prev.user_metadata, ...updateData } } : prev);
    setProcessing(false);
    setTab("results");
    if (newCount >= PLAN_LIMIT) setShowUpgradeModal(true);
  };

  const start = () => startAfterInfo();

  const downloadOne = r => { const a = document.createElement("a"); a.href = r.showroomDataURL || r.processed; a.download = `${r.showroomDataURL ? "showroom_" : "autocache_"}${r.name}`; a.click(); };
  const downloadAll = () => results.forEach(downloadOne);

  // Export originals where YOLO detected a plate → use to build the
  // YOLOv8-pose keypoint dataset (drop in backend/dataset/raw/ then
  // upload to Roboflow). One sequential download per file with a
  // small spacing so the browser doesn't drop any.
  const exportDatasetRaw = async () => {
    const detected = photos.filter(p =>
      results.some(r => r.name === p.file.name && r.plateFound)
    );
    if (!detected.length) {
      setError("Aucune photo avec plaque détectée à exporter pour le dataset.");
      return;
    }
    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 16);
    for (let i = 0; i < detected.length; i++) {
      const p = detected[i];
      const ext = (p.file.name.split(".").pop() || "jpg").toLowerCase();
      const base = p.file.name.replace(/\.[^.]+$/, "");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(p.file);
      a.download = `plate_${ts}_${String(i + 1).padStart(4, "0")}_${base}.${ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // Petit délai pour ne pas saturer le navigateur
      await new Promise(r => setTimeout(r, 80));
      URL.revokeObjectURL(a.href);
    }
    console.log(`Dataset export: ${detected.length} originaux téléchargés (préfixe plate_${ts}_*)`);
  };
  const pct = progress.total ? Math.round((progress.n / progress.total) * 100) : 0;
  const userPlan = user?.user_metadata?.plan ?? "trial"; // "trial" | "essential" | "pro"
  const PLAN_LIMIT = userPlan === "pro" ? 250 : userPlan === "essential" ? 200 : TRIAL_LIMIT;
  const PLAN_LABEL = userPlan === "pro" || userPlan === "essential" ? "CRÉDIT" : "ESSAI";
  const canUseShowroom  = userPlan === "pro" || userPlan === "trial";
  const canUseHeadlight   = userPlan === "pro";
  const canUseBodyPolish  = userPlan === "pro" || userPlan === "essential";
  const HEADLIGHT_LIMIT = 10;
  const HEADLIGHT_BATCH_LIMIT = 2;
  const headlightPhotosUsed = user?.user_metadata?.headlight_photos_used ?? 0;
  const headlightCreditsRemaining = Math.max(0, HEADLIGHT_LIMIT - headlightPhotosUsed);
  const canStart = logo && photos.length > 0 && !processing;

  const fetchSubInfo = useCallback(async () => {
    if (!user?.id || subInfoLoading) return;
    setSubInfoLoading(true);
    try {
      const r = await fetch('/api/customer-portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, action: 'subscription-info' }),
      });
      const d = await r.json();
      if (d.hasSubscription) {
        const endDate = new Date(d.periodEnd * 1000);
        const startDate = new Date(d.periodStart * 1000);
        const now = new Date();
        const daysLeft = Math.max(0, Math.ceil((endDate - now) / (1000 * 60 * 60 * 24)));
        setSubInfo({ periodStart: startDate, periodEnd: endDate, plan: d.plan, daysLeft });
      } else {
        setSubInfo({ hasSubscription: false });
      }
    } catch (e) {
      console.warn('[SubInfo] fetch failed:', e.message);
      setSubInfo(null);
    }
    setSubInfoLoading(false);
  }, [user?.id, subInfoLoading]);

  // Close credit popup on click outside
  useEffect(() => {
    if (!showCreditPopup) return;
    const handle = (e) => {
      if (creditPopupRef.current && !creditPopupRef.current.contains(e.target)) setShowCreditPopup(false);
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [showCreditPopup]);

  const logout = async () => {
    await supabase.auth.signOut();
    setLogo(null); setPhotos([]); setResults([]); setTab("setup");
  };

  const submitPromo = async () => {
    if (!promoCode.trim() || promoStatus === "loading") return;
    setPromoStatus("loading");
    try {
      const res = await fetch("/api/promo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: promoCode.trim() }) });
      const data = await res.json();
      if (!data.valid) { setPromoStatus("error"); setPromoMsg(data.message); return; }
      if (data.plan) {
        await supabase.auth.updateUser({ data: { plan: data.plan } });
        setUser(prev => prev ? { ...prev, user_metadata: { ...prev.user_metadata, plan: data.plan } } : prev);
        setPromoStatus("success");
        const planLabel = data.plan === "pro" ? "Pro" : data.plan === "essential" ? "Essentiel" : "Essai gratuit";
        setPromoMsg(`Plan ${planLabel} activé.`);
        return;
      }
      const currentUsed = user?.user_metadata?.photos_used ?? 0;
      const newUsed = data.reset ? 0 : Math.max(0, currentUsed - data.photos);
      await supabase.auth.updateUser({ data: { photos_used: newUsed } });
      setUser(prev => prev ? { ...prev, user_metadata: { ...prev.user_metadata, photos_used: newUsed } } : prev);
      setPromoStatus("success");
      const available = PLAN_LIMIT - newUsed;
      setPromoMsg(data.reset
        ? `Compteur réinitialisé — ${available} photo${available > 1 ? "s" : ""} disponible${available > 1 ? "s" : ""}.`
        : `+${data.photos} crédits ajoutés — ${available} photo${available > 1 ? "s" : ""} disponible${available > 1 ? "s" : ""}.`
      );
    } catch (e) {
      setPromoStatus("error"); setPromoMsg("Erreur réseau, réessayez.");
    }
  };

  const openLightbox  = (r) => {
    setLightbox(r);
    setCropMode(false); setCropBox({ x: 0.1, y: 0.1, w: 0.8, h: 0.8 }); setCropAngle(180);
    setAdjustMode(false); setAdjustCorners(r.corners || null); setAdjustDrag(null);
    setShowMaskEditor(false);
    setLbZoom(1); setLbPan({ x: 0, y: 0 }); setLbPanDrag(null);
    setShowroomNudge(r.showroomOffset ?? { x: 0, y: 0 });
    setShowroomZoom(r.showroomZoom ?? 1.0);
    setShowroomBlend(r.showroomBlend ?? 0);
    setShadowOpacity(SHADOW_STRENGTH);
    setShadowBlur(0);
    setShadowYOffset(0);
    setShadowSpread(1.0);
  };

  const NUDGE_STEP = 75; // pas de déplacement en px sur canvas 2400×1350

  // Recomposite central — utilisé par flèches, slider zoom ET slider fondu.
  // Important : les sliders peuvent émettre des changements en continu (surtout
  // sur mobile). Plutôt que de bloquer les requêtes pendant qu'une compose est
  // en cours (et laisser tomber la dernière), on garde la dernière demande
  // dans pendingRecomposeRef et on la rejoue dès que le worker actuel finit.
  const pendingRecomposeRef = useRef(null);
  const recomposingRef      = useRef(false);
  const recompositeShowroom = (nudge, zoom, blend) => {
    pendingRecomposeRef.current = { nudge, zoom, blend };
    if (recomposingRef.current) return; // un worker tourne déjà, il prendra la dernière demande
    recomposingRef.current = true;
    setShowroomNudging(true);
    (async () => {
      try {
        while (pendingRecomposeRef.current) {
          const { nudge: nd, zoom: zm, blend: bl } = pendingRecomposeRef.current;
          pendingRecomposeRef.current = null;
          const prev = lightboxRef.current;
          if (!prev?.cutoutDataURL) break;
          const logoImgEl = await loadImg(prev.logoPreview);
          const wOpts = prev.wallLogoSrc ? { src: prev.wallLogoSrc, scale: prev.wallLogoScale, opacity: prev.wallLogoOpacity, x: prev.wallLogoPos?.x ?? 0.5, y: prev.wallLogoPos?.y ?? 0.25 } : null;
          const sr = await compositeCarOnBg(
            prev.cutoutDataURL, prev.showroomBgUrl, 2400, 1350,
            logoImgEl, prev.corners, prev.bgColor,
            nd.x, nd.y, zm, true, wOpts, prev.shadowMatteDataURL, bl,
            prev.carBoundsCache
          );
          const updated = { ...prev, showroomDataURL: sr.dataURL, showroomBaseURL: sr.baseURL, showroomTransform: sr.transform, showroomOffset: nd, showroomZoom: zm, showroomBlend: bl };
          setLightbox(updated);
          setResults(rs => rs.map(r => r.name === prev.name ? updated : r));
        }
      } catch(e) { console.error('recomposite error', e); }
      finally {
        recomposingRef.current = false;
        setShowroomNudging(false);
      }
    })();
  };

  const nudgeShowroom = (dx, dy) => {
    const newNudge = { x: showroomNudge.x + dx, y: showroomNudge.y + dy };
    setShowroomNudge(newNudge);
    recompositeShowroom(newNudge, showroomZoom, showroomBlend);
  };

  const onZoomChange = (z) => {
    setShowroomZoom(z);
    clearTimeout(zoomTimerRef.current);
    zoomTimerRef.current = setTimeout(() => recompositeShowroom(showroomNudge, z, showroomBlend), 250);
  };

  const onBlendChange = (b) => {
    setShowroomBlend(b);
    clearTimeout(blendTimerRef.current);
    blendTimerRef.current = setTimeout(() => recompositeShowroom(showroomNudge, showroomZoom, b), 250);
  };

  const onShadowParamChange = (param, value) => {
    const setters = { opacity: setShadowOpacity, blur: setShadowBlur, yOffset: setShadowYOffset, spread: setShadowSpread };
    setters[param](value);
    clearTimeout(shadowTimerRef.current);
    shadowTimerRef.current = setTimeout(async () => {
      if (!lightbox?.cutoutDataURL || showroomNudging) return;
      setShowroomNudging(true);
      try {
        let carBounds = lightbox.carBoundsCache;
        if (!carBounds) {
          const cutImg = await loadImg(lightbox.cutoutDataURL);
          const cW = cutImg.naturalWidth || cutImg.width, cH = cutImg.naturalHeight || cutImg.height;
          const scanC = document.createElement('canvas');
          scanC.width = cW; scanC.height = cH;
          const scanCtx = scanC.getContext('2d');
          scanCtx.drawImage(cutImg, 0, 0);
          const px = scanCtx.getImageData(0, 0, cW, cH).data;
          let carL = cW, carR = 0, carT = cH, carB = 0;
          for (let y = 0; y < cH; y++)
            for (let x = 0; x < cW; x++)
              if (px[(y * cW + x) * 4 + 3] > 128) {
                if (x < carL) carL = x; if (x > carR) carR = x;
                if (y < carT) carT = y; if (y > carB) carB = y;
              }
          carBounds = { x: carL, y: carT, w: carR - carL, h: carB - carT };
        }
        const params = { opacity: shadowOpacity, blur: shadowBlur, yOffset: shadowYOffset, spread: shadowSpread, [param]: value };
        const plateBox = lightbox.yoloBbox ?? null;
        const newMatte = await generateShadowFromCarAlpha(lightbox.cutoutDataURL, carBounds, plateBox, params);
        const logoImgEl = await loadImg(lightbox.logoPreview);
        const wOpts = lightbox.wallLogoSrc ? { src: lightbox.wallLogoSrc, scale: lightbox.wallLogoScale, opacity: lightbox.wallLogoOpacity, x: lightbox.wallLogoPos?.x ?? 0.5, y: lightbox.wallLogoPos?.y ?? 0.25 } : null;
        const sr = await compositeCarOnBg(
          lightbox.cutoutDataURL, lightbox.showroomBgUrl, 2400, 1350,
          logoImgEl, lightbox.corners, lightbox.bgColor,
          showroomNudge.x, showroomNudge.y, showroomZoom, true, wOpts, newMatte, showroomBlend
        );
        const updated = { ...lightbox, shadowMatteDataURL: newMatte, showroomDataURL: sr.dataURL, showroomBaseURL: sr.baseURL, showroomTransform: sr.transform, carBoundsCache: carBounds };
        setLightbox(updated);
        setResults(rs => rs.map(r => r.name === lightbox.name ? updated : r));
      } catch(e) { console.error('shadow adjust error', e); }
      setShowroomNudging(false);
    }, 300);
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

  // Variante tactile : démarre un drag de rognage avec les coords du premier doigt.
  const startCropDragAt = (clientX, clientY, type) => {
    setCropDrag({ type, startMx: clientX, startMy: clientY, startBox: { ...cropBox } });
  };

  const onCropTouchMove = (e) => {
    if (!cropDrag || !cropCanvasRef.current) return;
    e.preventDefault();
    if (e.touches.length > 0) {
      onCropMouseMove({ clientX: e.touches[0].clientX, clientY: e.touches[0].clientY });
    }
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
    a.href = c.toDataURL('image/jpeg', 0.97);
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
    return c2.toDataURL('image/jpeg', 0.97);
  };

  // Sauvegarde le rognage (+ rotation) dans le résultat (pour "Tout télécharger")
  const saveCrop = async () => {
    if (!lightbox) return;
    const deg = cropAngle - 180;   // rotation réelle : 0 = photo droite
    const box = cropBox;
    const isShowroom = !!lightbox.showroomDataURL;

    if (isShowroom) {
      // Mode showroom : rogne l'image composite + la base (sans plaque) pour Ajuster
      const [croppedShowroom, croppedBase] = await Promise.all([
        rotateAndCropDataURL(lightbox.showroomDataURL, deg, box),
        rotateAndCropDataURL(lightbox.showroomBaseURL, deg, box),
      ]);
      // Recalcul du transform et des coins dans l'espace rogné (seulement sans rotation)
      let newTransform = null;
      let newCorners = lightbox.corners;
      if (deg === 0 && lightbox.showroomTransform && croppedBase) {
        const t = lightbox.showroomTransform;
        const cropX = box.x * t.W, cropY = box.y * t.H;
        const newW = Math.round(box.w * t.W), newH = Math.round(box.h * t.H);
        newTransform = { carX: t.carX - cropX, carY: t.carY - cropY, cw: t.cw, ch: t.ch, W: newW, H: newH };
        // Remap corners showroom → espace rogné
        if (lightbox.corners) {
          const sc = cornersToShowroom(lightbox.corners, t);
          const remap = p => ({
            x: Math.max(0, Math.min(1, (p.x * t.W - cropX) / newW)),
            y: Math.max(0, Math.min(1, (p.y * t.H - cropY) / newH)),
          });
          const remappedSC = { tl: remap(sc.tl), tr: remap(sc.tr), br: remap(sc.br), bl: remap(sc.bl) };
          newCorners = cornersFromShowroom(remappedSC, newTransform);
        }
      }
      const updated = { ...lightbox, showroomDataURL: croppedShowroom,
        showroomBaseURL: croppedBase, showroomTransform: newTransform,
        corners: newCorners,
        cutoutDataURL: null, shadowMatteDataURL: null, showroomBgUrl: null, cropped: true };
      setResults(prev => prev.map(r => r.name === lightbox.name ? updated : r));
      setLightbox(updated);
      setCropAngle(180);
      setCropMode(false);
      return;
    }

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
    setResults(prev => prev.map(r => r.name === lightbox.name ? updated : r));
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
    const ctx = canvas.getContext('2d'); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.clearRect(0, 0, cW, cH);
    ctx.save(); ctx.translate(cW / 2, cH / 2); ctx.rotate(rad);
    ctx.drawImage(img, -W / 2, -H / 2); ctx.restore();
  };

  // Charge la photo (ou le showroom) dès que le mode Rogner s'ouvre
  useEffect(() => {
    if (!cropMode || !lightbox) return;
    const src = lightbox.showroomDataURL || lightbox.processed;
    if (!src) return;
    let cancelled = false;
    loadImg(src).then(img => {
      if (cancelled) return;
      cropBaseImgRef.current = img;
      renderCropPreview(cropAngle);
    });
    return () => { cancelled = true; };
  }, [cropMode, lightbox?.showroomDataURL, lightbox?.processed]);

  // ── Mode Ajuster ─────────────────────────────────────────────────────────
  const startAdjustDragAt = (clientX, clientY, corner) => {
    const sc = adjustCornersRef.current || adjustCorners;
    const drag = { corner, startMx: clientX, startMy: clientY, startCorners: { tl: { ...sc.tl }, tr: { ...sc.tr }, br: { ...sc.br }, bl: { ...sc.bl } } };
    adjustDragRef.current = drag;
    setAdjustDrag(drag);
  };
  const startAdjustDrag = (e, corner) => {
    e.preventDefault(); e.stopPropagation();
    startAdjustDragAt(e.clientX, e.clientY, corner);
  };

  // Rendu direct sur le canvas (pas de setState — pas de re-render — 60 fps)
  const renderAdjustPreview = (corners) => {
    const canvas = adjustCanvasRef.current;
    const baseImg = adjustBaseImgRef.current;
    const logoImg = adjustLogoImgRef.current;
    if (!canvas || !baseImg) return;
    const ctx = canvas.getContext('2d'); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(baseImg, 0, 0);
    if (logoImg && corners) {
      const W = canvas.width, H = canvas.height;
      const toPixel = p => ({ x: p.x * W, y: p.y * H });
      const ptl = toPixel(corners.tl), ptr = toPixel(corners.tr);
      const pbr = toPixel(corners.br), pbl = toPixel(corners.bl);
      const bgColor = adjustLogoBgRef.current || '#ffffff';
      drawPlateOverlay(ctx, logoImg, ptl, ptr, pbr, pbl, bgColor, 'bbox_stable');
    }
  };

  const onAdjustMouseMove = (e) => {
    const drag = adjustDragRef.current;
    if (!drag || !adjustCanvasRef.current) return;
    const rect = adjustCanvasRef.current.getBoundingClientRect();
    const dx = (e.clientX - drag.startMx) / rect.width;
    const dy = (e.clientY - drag.startMy) / rect.height;
    const { corner, startCorners } = drag;
    const clamp = (v) => Math.max(0, Math.min(1, v));
    let newCorners;
    if (corner === 'center') {
      // Déplace les 4 coins ensemble
      newCorners = {
        tl: { x: clamp(startCorners.tl.x + dx), y: clamp(startCorners.tl.y + dy) },
        tr: { x: clamp(startCorners.tr.x + dx), y: clamp(startCorners.tr.y + dy) },
        br: { x: clamp(startCorners.br.x + dx), y: clamp(startCorners.br.y + dy) },
        bl: { x: clamp(startCorners.bl.x + dx), y: clamp(startCorners.bl.y + dy) },
      };
    } else {
      newCorners = {
        ...startCorners,
        [corner]: { x: clamp(startCorners[corner].x + dx), y: clamp(startCorners[corner].y + dy) },
      };
    }
    adjustCornersRef.current = newCorners;
    setAdjustCorners(newCorners);          // met à jour les points oranges
    renderAdjustPreview(newCorners);       // met à jour le canvas en direct
  };

  const onAdjustTouchMove = (e) => {
    if (!adjustDragRef.current || !adjustCanvasRef.current) return;
    e.preventDefault();
    if (e.touches.length > 0) {
      onAdjustMouseMove({ clientX: e.touches[0].clientX, clientY: e.touches[0].clientY });
    }
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
      if (e.preventDefault) e.preventDefault();
      setLbPanDrag({ startMx: e.clientX, startMy: e.clientY, startPan: { ...lbPan } });
    }
  };

  // ── Touch : pinch-to-zoom + pan sur l'image ───────────────────────────
  // Le pinch-zoom 2 doigts est autorisé partout (y compris mode Ajuster pour
  // affiner les coins). Le pan 1 doigt reste réservé au mode visu (les
  // poignées des coins ont leur propre gestionnaire en mode Ajuster).
  const onLbTouchStart = (e) => {
    if (cropMode) return;
    if (e.touches.length === 2) {
      e.preventDefault();
      const t0 = e.touches[0], t1 = e.touches[1];
      const dx = t0.clientX - t1.clientX, dy = t0.clientY - t1.clientY;
      pinchRef.current = {
        dist: Math.sqrt(dx * dx + dy * dy),
        midX: (t0.clientX + t1.clientX) / 2,
        midY: (t0.clientY + t1.clientY) / 2,
        startZoom: lbZoom,
        startPan: { ...lbPan },
      };
    } else if (e.touches.length === 1 && lbZoom > 1 && !adjustMode) {
      onLbPanDown({ clientX: e.touches[0].clientX, clientY: e.touches[0].clientY, preventDefault: () => e.preventDefault() });
    }
  };

  const onLbTouchMove = (e) => {
    if (cropMode) return;
    if (e.touches.length === 2 && pinchRef.current) {
      e.preventDefault();
      const t0 = e.touches[0], t1 = e.touches[1];
      const dx = t0.clientX - t1.clientX, dy = t0.clientY - t1.clientY;
      const newDist = Math.sqrt(dx * dx + dy * dy);
      const scale = newDist / pinchRef.current.dist;
      const newZoom = Math.max(1, Math.min(8, pinchRef.current.startZoom * scale));
      if (!lbContainerRef.current) return;
      const rect = lbContainerRef.current.getBoundingClientRect();
      const mx = pinchRef.current.midX - rect.left;
      const my = pinchRef.current.midY - rect.top;
      const newX = mx - (mx - pinchRef.current.startPan.x) * newZoom / pinchRef.current.startZoom;
      const newY = my - (my - pinchRef.current.startPan.y) * newZoom / pinchRef.current.startZoom;
      setLbZoom(newZoom);
      if (newZoom === 1) { setLbPan({ x: 0, y: 0 }); return; }
      setLbPan({
        x: Math.max(rect.width  * (1 - newZoom), Math.min(0, newX)),
        y: Math.max(rect.height * (1 - newZoom), Math.min(0, newY)),
      });
    } else if (e.touches.length === 1 && !adjustMode) {
      onLbPanMove({ clientX: e.touches[0].clientX, clientY: e.touches[0].clientY });
    }
  };

  const onLbTouchEnd = () => { pinchRef.current = null; setLbPanDrag(null); };

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

  // Pré-charge photo (ou fond showroom) + logo dès que le mode Ajuster s'ouvre.
  // En mode showroom : canvas = showroomBaseURL, coins convertis en espace showroom.
  useEffect(() => {
    if (!adjustMode || !lightbox?.baseDataURL) return;
    let cancelled = false;
    const isShowroom = !!(lightbox.showroomBaseURL && lightbox.showroomTransform);
    adjustIsShowroomRef.current        = isShowroom;
    adjustShowroomTransformRef.current = isShowroom ? lightbox.showroomTransform : null;
    // Conversion coins → espace showroom AVANT le chargement async (drag réactif)
    if (isShowroom && adjustCorners) {
      const sc = cornersToShowroom(adjustCorners, lightbox.showroomTransform);
      adjustCornersRef.current = sc;
      setAdjustCorners(sc);
    }
    // Source de l'image de base : showroom sans plaque > photo originale sans plaque
    const baseSrc = isShowroom ? lightbox.showroomBaseURL : lightbox.baseDataURL;
    (async () => {
      const baseImg = await loadImg(baseSrc);
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
          fctx.drawImage(rawLogo, 0, 0); // pas de fond blanc : préserve les couleurs d'origine
          logoForRender = flat;
        }
      }
      adjustBaseImgRef.current = baseImg;
      adjustLogoImgRef.current = logoForRender;
      adjustLogoBgRef.current  = lightbox.bgColor || '#ffffff';
      const canvas = adjustCanvasRef.current;
      if (canvas && !cancelled) {
        canvas.width  = isShowroom ? lightbox.showroomTransform.W : baseImg.naturalWidth;
        canvas.height = isShowroom ? lightbox.showroomTransform.H : baseImg.naturalHeight;
        renderAdjustPreview(adjustCornersRef.current);
      }
    })();
    return () => { cancelled = true; };
  }, [adjustMode, lightbox?.baseDataURL, lightbox?.showroomBaseURL]);

  if (authLoading) return (
    <div style={{ minHeight: "100vh", background: "#1c1c1c", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ color: "#f26522", fontFamily: "'JetBrains Mono',monospace", fontSize: 12, letterSpacing: 3 }}>CHARGEMENT...</div>
    </div>
  );

  if (passwordRecovery) {
    const submitNewPassword = async () => {
      setRecoveryErr(""); setRecoveryMsg(""); setRecoveryLoading(true);
      try {
        if (newPassword.length < 6) throw new Error("Le mot de passe doit contenir au moins 6 caractères.");
        if (newPassword !== newPasswordConfirm) throw new Error("Les mots de passe ne correspondent pas.");
        const { error } = await supabase.auth.updateUser({ password: newPassword });
        if (error) throw error;
        setRecoveryMsg("Mot de passe mis à jour avec succès !");
        setTimeout(() => { setPasswordRecovery(false); setNewPassword(""); setNewPasswordConfirm(""); setRecoveryMsg(""); }, 2000);
      } catch (e) { setRecoveryErr(e.message || "Une erreur est survenue"); }
      setRecoveryLoading(false);
    };
    return (
      <div style={{ minHeight: "100vh", background: "#1c1c1c", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Rajdhani',sans-serif" }}>
        <div style={{ width: 380, padding: 40, background: "#161616", border: "1px solid #252525", borderRadius: 4 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 36 }}>
            <svg width="22" height="22" viewBox="0 0 22 22">
              <polygon points="11,1 21,6 21,16 11,21 1,16 1,6" fill="#f26522" />
              <polygon points="11,5 17,8 17,14 11,17 5,14 5,8" fill="#0f0f0f" />
            </svg>
            <span style={{ fontSize: 20, fontWeight: 700, letterSpacing: 4, textTransform: "uppercase", color: "#ddd5c8" }}>AutoCache</span>
            <span style={{ fontSize: 10, color: "#f26522", letterSpacing: 2, fontFamily: "'JetBrains Mono',monospace" }}>PRO</span>
          </div>
          <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: 2, color: "#ddd5c8", textTransform: "uppercase", marginBottom: 24, textAlign: "center" }}>
            Nouveau mot de passe
          </div>
          {[["Nouveau mot de passe", newPassword, setNewPassword], ["Confirmer le mot de passe", newPasswordConfirm, setNewPasswordConfirm]].map(([label, val, set]) => (
            <div key={label} style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 10, letterSpacing: 2, color: "#ddd", textTransform: "uppercase", fontFamily: "'JetBrains Mono',monospace", marginBottom: 6 }}>{label}</div>
              <div style={{ position: "relative" }}>
                <input type={showRecoveryPassword ? "text" : "password"} value={val} onChange={e => set(e.target.value)} onKeyDown={e => e.key === "Enter" && submitNewPassword()}
                  autoComplete="new-password"
                  style={{ width: "100%", background: "#1a1a1a", border: "1px solid #222", color: "#ddd5c8", padding: "10px 44px 10px 12px", borderRadius: 3, fontFamily: "'JetBrains Mono',monospace", fontSize: 13, outline: "none", boxSizing: "border-box" }} />
                <button
                  type="button"
                  onClick={() => setShowRecoveryPassword(p => !p)}
                  aria-label={showRecoveryPassword ? "Masquer le mot de passe" : "Afficher le mot de passe"}
                  title={showRecoveryPassword ? "Masquer le mot de passe" : "Afficher le mot de passe"}
                  style={{
                    position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)",
                    background: "transparent", border: "none", padding: "6px 8px",
                    cursor: "pointer", color: showRecoveryPassword ? "#f26522" : "#ddd",
                    fontSize: 17, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center",
                    minHeight: "unset",
                  }}
                >
                  {showRecoveryPassword ? "🙈" : "👁"}
                </button>
              </div>
            </div>
          ))}
          {recoveryErr && <div style={{ fontSize: 11, color: "#e55", marginBottom: 14, fontFamily: "'JetBrains Mono',monospace" }}>⚠ {recoveryErr}</div>}
          {recoveryMsg && <div style={{ fontSize: 11, color: "#5a5", marginBottom: 14, fontFamily: "'JetBrains Mono',monospace" }}>✓ {recoveryMsg}</div>}
          <button onClick={submitNewPassword} disabled={recoveryLoading} style={{
            width: "100%", background: "#f26522", color: "#090909", border: "none",
            padding: "13px 24px", cursor: recoveryLoading ? "wait" : "pointer",
            fontFamily: "'Rajdhani',sans-serif", fontSize: 14, fontWeight: 700,
            letterSpacing: 4, textTransform: "uppercase", borderRadius: 3,
            opacity: recoveryLoading ? 0.7 : 1, marginTop: 4
          }}>
            {recoveryLoading ? "..." : "Mettre à jour"}
          </button>
        </div>
      </div>
    );
  }

  if (!user) return <AuthScreen onAuth={setUser} />;

  return (
    <div>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Rajdhani:wght@500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        html,body{overflow-x:hidden;max-width:100%;}
        input[type=range]{-webkit-appearance:none;height:2px;background:#252525;border-radius:1px;outline:none;width:100%;}
        input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:13px;height:13px;border-radius:50%;background:#f26522;cursor:pointer;}
        ::-webkit-scrollbar{width:3px;}::-webkit-scrollbar-thumb{background:#f26522;border-radius:2px;}
        @media(max-width:767px){
          input[type=range]{height:4px;}
          input[type=range]::-webkit-slider-thumb{width:20px;height:20px;}
          input[type=range]::-moz-range-thumb{width:20px;height:20px;border-radius:50%;background:#f26522;border:none;}
          button,select{min-height:40px;}
        }
        @keyframes ac-spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
        @-webkit-keyframes ac-spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
        .ac-spinner{animation:ac-spin 0.7s linear infinite;-webkit-animation:ac-spin 0.7s linear infinite;}
      `}</style>
      <div style={{ fontFamily: "'Rajdhani',sans-serif", background: "#1c1c1c", minHeight: "100vh", color: "#e0dbd4", overflowX: "hidden", maxWidth: "100vw" }}>
        <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: isMobile ? "0 12px" : "0 28px", height: 56, borderBottom: "1px solid #1e1e1e", position: "sticky", top: 0, background: "#1c1c1c", zIndex: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <svg width="22" height="22" viewBox="0 0 22 22"><polygon points="11,1 21,6 21,16 11,21 1,16 1,6" fill="#f26522" /><polygon points="11,5 17,8 17,14 11,17 5,14 5,8" fill="#090909" /></svg>
            <span style={{ fontSize: isMobile ? 16 : 20, fontWeight: 700, letterSpacing: isMobile ? 2 : 4, textTransform: "uppercase" }}>AutoCache</span>
            {!isMobile && <span style={{ fontSize: 10, color: "#f26522", letterSpacing: 2, fontFamily: "'JetBrains Mono',monospace" }}>PRO</span>}
          </div>
          <nav style={{ display: "flex", alignItems: "center", gap: isMobile ? 4 : 8 }}>
            {[["setup", isMobile ? "Config" : "Configuration"], ["results", `Résultats${results.length ? ` · ${results.length}` : ""}`]].map(([t, label]) => (
              <button key={t} onClick={() => setTab(t)} {...(t === "results" ? { "data-tutorial": "results-tab" } : {})} style={{ background: tab === t ? "#f26522" : "transparent", color: tab === t ? "#090909" : "#777", border: "none", padding: isMobile ? "7px 10px" : "7px 18px", cursor: "pointer", fontFamily: "'Rajdhani',sans-serif", fontSize: isMobile ? 12 : 13, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", minHeight: "unset" }}>{label}</button>
            ))}
            {!isMobile && <div style={{ width: 1, height: 20, background: "#252525", margin: "0 4px" }} />}
            {/* ── Compteur crédits + popup abonnement ── */}
            {(() => {
              const used = user?.user_metadata?.photos_used ?? 0;
              const left = Math.max(0, PLAN_LIMIT - used);
              const isExpired = left === 0;
              const isLow = left <= (PLAN_LIMIT <= 30 ? 5 : 20);
              return (
                <div ref={creditPopupRef} data-tutorial="credits" style={{ position: "relative" }}>
                  <div onClick={(e) => {
                    e.stopPropagation();
                    const next = !showCreditPopup;
                    setShowCreditPopup(next);
                    if (next && userPlan !== 'trial') fetchSubInfo();
                  }}
                    style={{ display: "flex", alignItems: "center", gap: 5, padding: isMobile ? "4px 6px" : "4px 10px", borderRadius: 2, border: `1px solid ${isExpired ? "#c0392b" : showCreditPopup ? "#f26522" : "#2a2a2a"}`, cursor: "pointer", background: isExpired ? "rgba(192,57,43,0.08)" : showCreditPopup ? "rgba(242,101,34,0.06)" : "transparent", transition: "all 0.15s" }}
                    title="Cliquez pour voir les détails"
                  >
                    <span style={{ fontSize: 10, fontFamily: "'JetBrains Mono',monospace", color: isExpired ? "#c0392b" : isLow ? "#f26522" : "#666", letterSpacing: 1 }}>
                      {isExpired
                        ? (isMobile ? "ÉPUISÉ" : `${PLAN_LABEL} ÉPUISÉ`)
                        : (isMobile ? `${left}/${PLAN_LIMIT}` : `${PLAN_LABEL} · ${left}/${PLAN_LIMIT}`)}
                    </span>
                  </div>
                  {showCreditPopup && (
                    <div onClick={e => e.stopPropagation()} style={{
                      position: "fixed", top: 56, right: isMobile ? 4 : 60,
                      background: "#141414", border: "1px solid #2a2a2a", borderRadius: 6,
                      minWidth: 280, maxWidth: "92vw", boxShadow: "0 12px 40px rgba(0,0,0,0.7)", zIndex: 3000,
                      fontFamily: "'Rajdhani',sans-serif", overflow: "hidden",
                    }}>
                      {/* En-tete plan + credits */}
                      <div style={{ padding: "14px 16px 12px", borderBottom: "1px solid #1c1c1c" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                          <div style={{ fontSize: 11, letterSpacing: 2, color: "#f26522", textTransform: "uppercase", fontFamily: "'JetBrains Mono',monospace" }}>
                            {userPlan === "pro" ? "Plan Pro" : userPlan === "essential" ? "Plan Essentiel" : "Essai gratuit"}
                          </div>
                          <div onClick={() => setShowCreditPopup(false)} style={{ color: "#ddd", cursor: "pointer", fontSize: 15, lineHeight: 1, padding: "2px 4px" }}>✕</div>
                        </div>
                        <div style={{ fontSize: 14, color: "#ddd", marginBottom: 8 }}>
                          {left} / {PLAN_LIMIT} photo{PLAN_LIMIT > 1 ? "s" : ""} restante{left > 1 ? "s" : ""}
                        </div>
                        <div style={{ height: 4, background: "#252525", borderRadius: 2, overflow: "hidden" }}>
                          <div style={{ height: "100%", width: `${Math.max(2, Math.round((left / PLAN_LIMIT) * 100))}%`, background: isExpired ? "#c0392b" : isLow ? "#f26522" : "#22c55e", borderRadius: 2, transition: "width 0.3s" }} />
                        </div>
                        {isExpired && (
                          <div style={{ marginTop: 10 }}>
                            <button onClick={() => { setShowCreditPopup(false); setShowUpgradeModal(true); }}
                              style={{ width: "100%", background: "#f26522", color: "#090909", border: "none", borderRadius: 4, padding: "8px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "'JetBrains Mono',monospace", letterSpacing: 1 }}>
                              RECHARGER
                            </button>
                          </div>
                        )}
                      </div>
                      {/* Infos abonnement Stripe (seulement si plan payant) */}
                      {userPlan !== 'trial' && (
                        <div style={{ padding: "12px 16px" }}>
                          {subInfoLoading ? (
                            <div style={{ fontSize: 13, color: "#ddd", textAlign: "center", padding: "4px 0" }}>Chargement...</div>
                          ) : subInfo?.periodEnd ? (
                            <div style={{ fontSize: 13, color: "#ddd" }}>
                              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                                <span style={{ color: "#ddd" }}>Debut du cycle</span>
                                <span style={{ color: "#ddd", fontFamily: "'JetBrains Mono',monospace", fontSize: 12 }}>
                                  {subInfo.periodStart.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" })}
                                </span>
                              </div>
                              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                                <span style={{ color: "#ddd" }}>Prochain paiement</span>
                                <span style={{ color: "#ddd", fontFamily: "'JetBrains Mono',monospace", fontSize: 12 }}>
                                  {subInfo.periodEnd.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" })}
                                </span>
                              </div>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                <span style={{ color: "#ddd" }}>Renouvellement</span>
                                <span style={{
                                  color: subInfo.daysLeft <= 3 ? "#f26522" : "#22c55e",
                                  fontFamily: "'JetBrains Mono',monospace", fontSize: 13, fontWeight: 700,
                                }}>
                                  {subInfo.daysLeft === 0 ? "Aujourd'hui" : `${subInfo.daysLeft} jour${subInfo.daysLeft > 1 ? "s" : ""}`}
                                </span>
                              </div>
                            </div>
                          ) : subInfo?.hasSubscription === false ? (
                            <div style={{ fontSize: 13, color: "#ddd" }}>Credits via code promo.</div>
                          ) : (
                            <div style={{ fontSize: 13, color: "#ddd" }}>Informations indisponibles.</div>
                          )}
                        </div>
                      )}
                      {/* Lien abonnement pour les utilisateurs trial */}
                      {userPlan === 'trial' && (
                        <div style={{ padding: "10px 16px", borderTop: "1px solid #1c1c1c" }}>
                          <button onClick={() => { setShowCreditPopup(false); setShowPlansModal(true); }}
                            style={{ width: "100%", background: "transparent", color: "#f26522", border: "1px solid #f26522", borderRadius: 4, padding: "7px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "'JetBrains Mono',monospace", letterSpacing: 1 }}>
                            VOIR LES PLANS
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })()}
            {/* ── Bouton Settings + Menu déroulant ── */}
            <div ref={settingsRef} style={{ position: "relative" }}>
              <button onClick={() => setSettingsOpen(o => !o)}
                style={{ background: settingsOpen ? "#1e1e1e" : "transparent", border: `1px solid ${settingsOpen ? "#f26522" : "#282828"}`, color: settingsOpen ? "#f26522" : "#777", padding: "5px 10px", cursor: "pointer", borderRadius: 2, fontFamily: "'JetBrains Mono',monospace", fontSize: 14, display: "flex", alignItems: "center", gap: 5, minHeight: "unset" }}
                title="Paramètres"
              >
                <span style={{ fontSize: 15 }}>⚙</span>
                {!isMobile && <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", fontFamily: "'Rajdhani',sans-serif" }}>Menu</span>}
              </button>
              {settingsOpen && (
                <div style={{
                  position: "fixed", top: 56, right: 0,
                  background: "#141414", border: "1px solid #2a2a2a", borderRadius: 4,
                  minWidth: 220, maxWidth: "92vw", boxShadow: "0 8px 32px rgba(0,0,0,0.6)", zIndex: 2000,
                  overflow: "hidden",
                }}>
                  {/* En-tête utilisateur */}
                  <div style={{ padding: "12px 16px", borderBottom: "1px solid #222", background: "#111" }}>
                    {user.user_metadata?.full_name && (
                      <div style={{ fontSize: 13, color: "#ddd5c8", fontFamily: "'Rajdhani',sans-serif", fontWeight: 700, letterSpacing: 1, marginBottom: 2 }}>{user.user_metadata.full_name}</div>
                    )}
                    <div style={{ fontSize: 11, color: "#ddd", fontFamily: "'JetBrains Mono',monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user.email}</div>
                  </div>
                  {/* Menu items */}
                  {[
                    { icon: "👤", label: "Mes informations", action: () => { setSettingsOpen(false); setShowProfileModal(true); } },
                    { icon: "💳", label: "Abonnement", action: () => { setSettingsOpen(false); setShowPlansModal(true); } },
                    { icon: "🎟", label: "Code Promo", action: () => { setSettingsOpen(false); setPromoCode(""); setPromoStatus(null); setPromoMsg(""); setShowPromoModal(true); } },
                    { icon: "✉", label: "Nous contacter", action: () => { setSettingsOpen(false); setShowContactModal(true); } },
                    { icon: "📖", label: "Revoir le didacticiel", action: () => { setSettingsOpen(false); setShowTutorial(true); } },
                    { icon: "🎮", label: "Mini-jeu", action: () => { setSettingsOpen(false); setShowMiniGame(true); } },
                  ].map((item, i) => (
                    <button key={i} onClick={item.action}
                      style={{
                        display: "flex", alignItems: "center", gap: 10, width: "100%",
                        padding: "10px 16px", background: "transparent", border: "none",
                        color: "#ddd", cursor: "pointer", fontFamily: "'Rajdhani',sans-serif",
                        fontSize: 13, fontWeight: 600, letterSpacing: 1, textAlign: "left",
                        borderBottom: "1px solid #1a1a1a", transition: "background 0.1s",
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = "#1a1a1a"}
                      onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                    >
                      <span style={{ fontSize: 15, width: 20, textAlign: "center" }}>{item.icon}</span>
                      {item.label}
                    </button>
                  ))}
                  {/* Séparateur + Déconnexion */}
                  <div style={{ height: 1, background: "#252525", margin: "2px 0" }} />
                  <button onClick={() => { setSettingsOpen(false); logout(); }}
                    style={{
                      display: "flex", alignItems: "center", gap: 10, width: "100%",
                      padding: "10px 16px", background: "transparent", border: "none",
                      color: "#c0392b", cursor: "pointer", fontFamily: "'Rajdhani',sans-serif",
                      fontSize: 13, fontWeight: 700, letterSpacing: 1, textAlign: "left",
                      transition: "background 0.1s",
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = "rgba(192,57,43,0.08)"}
                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                  >
                    <span style={{ fontSize: 15, width: 20, textAlign: "center" }}>🚪</span>
                    Déconnexion
                  </button>
                </div>
              )}
            </div>
          </nav>
        </header>

        {tab === "setup" && (
          <div style={{ maxWidth: 980, margin: "0 auto", padding: isMobile ? "16px 12px" : "32px 28px", display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: isMobile ? 16 : 28, alignItems: "start" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
              <section data-tutorial="logo">
                <div style={{ fontSize: 13, letterSpacing: 3, color: "#f26522", textTransform: "uppercase", marginBottom: 10, fontFamily: "'JetBrains Mono',monospace" }}>01 — Cache plaque</div>

                {/* ── Onglets Import / Générer ── */}
                <div style={{ display: "flex", marginBottom: 14, background: "#121212", border: "1px solid #252525", borderRadius: 3, overflow: "hidden" }}>
                  {[["import","Mon logo"],["generate","Générer"]].map(([m, label]) => (
                    <button key={m} onClick={() => {
                      if (m === "import") { setLogo(null); setLogoOriginal(null); setLogoCropActive(false); }
                      setLogoMode(m);
                    }} style={{ flex: 1, background: logoMode === m ? "#f26522" : "transparent", color: logoMode === m ? "#090909" : "#555", border: "none", padding: "8px 0", cursor: "pointer", fontFamily: "'Rajdhani',sans-serif", fontSize: 12, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase" }}>
                      {label}
                    </button>
                  ))}
                </div>

                {/* ── Mode : importer un fichier ── */}
                {logoMode === "import" && (<>
                  <div style={{ fontSize: 11, color: "#ddd", marginBottom: 10, fontFamily: "'JetBrains Mono',monospace" }}>
                    {logo ? "✓ Logo chargé · cliquer pour changer" : "PNG avec transparence recommandé"}
                  </div>
                  {!logoCropActive && (
                    <div onDragOver={e => { e.preventDefault(); setDragOver("logo"); }} onDragLeave={() => setDragOver(null)}
                      onDrop={e => { e.preventDefault(); setDragOver(null); handleLogoFile(e.dataTransfer.files[0]); }}
                      onClick={() => logoRef.current?.click()}
                      style={{ border: `1px solid ${dragOver === "logo" ? "#f26522" : logo ? "#2a2a2a" : "#222"}`, borderRadius: 3, padding: 24, cursor: "pointer", minHeight: 130, display: "flex", alignItems: "center", justifyContent: "center", background: "#161616" }}>
                      {logo ? (
                        <div style={{ textAlign: "center" }}>
                          <img src={logo.preview} style={{ maxHeight: 80, maxWidth: "100%", objectFit: "contain", borderRadius: logoRadius > 0 ? `${Math.round(logoRadius * 4)}px` : 0 }} />
                          <div style={{ fontSize: 11, color: "#f26522", marginTop: 10 }}>Cliquer pour changer</div>
                        </div>
                      ) : (
                        <div style={{ textAlign: "center", color: "#ddd" }}>
                          <div style={{ fontSize: 33, marginBottom: 8 }}>⬡</div>
                          <div style={{ fontSize: 13, color: "#ddd" }}>Glisser votre logo ici</div>
                        </div>
                      )}
                    </div>
                  )}
                  {logo && !logo.generated && !logoCropActive && (
                    <div style={{ marginTop: 8, textAlign: "center" }}>
                      <button onClick={() => { setLogoCropActive(true); setLogoCropBox({ x: 0.05, y: 0.05, w: 0.9, h: 0.9 }); }}
                        style={{ background: "#181818", color: "#f26522", border: "1px solid #3a1400", fontFamily: "'Rajdhani',sans-serif", fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", borderRadius: 2, padding: "6px 14px", cursor: "pointer" }}>
                        ✂ Recadrer
                      </button>
                    </div>
                  )}
                  {logo && logoCropActive && (
                    <div style={{ background: "#0a0a0a", border: "1px solid #252525", borderRadius: 3, overflow: "hidden" }}>
                      <div ref={logoCropContainerRef}
                        onMouseMove={onLogoCropMove} onTouchMove={onLogoCropMove}
                        style={{ position: "relative", userSelect: "none", touchAction: "none" }}>
                        <img src={logoOriginal || logo.preview} style={{ width: "100%", display: "block" }} draggable={false} />
                        {/* Dark overlays */}
                        <div style={{ position: "absolute", top: 0, left: 0, width: "100%", height: `${logoCropBox.y * 100}%`, background: "rgba(0,0,0,0.6)" }} />
                        <div style={{ position: "absolute", bottom: 0, left: 0, width: "100%", height: `${(1 - logoCropBox.y - logoCropBox.h) * 100}%`, background: "rgba(0,0,0,0.6)" }} />
                        <div style={{ position: "absolute", top: `${logoCropBox.y * 100}%`, left: 0, width: `${logoCropBox.x * 100}%`, height: `${logoCropBox.h * 100}%`, background: "rgba(0,0,0,0.6)" }} />
                        <div style={{ position: "absolute", top: `${logoCropBox.y * 100}%`, right: 0, width: `${(1 - logoCropBox.x - logoCropBox.w) * 100}%`, height: `${logoCropBox.h * 100}%`, background: "rgba(0,0,0,0.6)" }} />
                        {/* Crop rectangle */}
                        <div onMouseDown={e => startLogoCropDrag(e, 'move')} onTouchStart={e => startLogoCropDrag(e, 'move')}
                          style={{ position: "absolute", left: `${logoCropBox.x * 100}%`, top: `${logoCropBox.y * 100}%`, width: `${logoCropBox.w * 100}%`, height: `${logoCropBox.h * 100}%`, border: "2px solid #f26522", boxSizing: "border-box", cursor: "move" }} />
                        {/* Corner handles */}
                        {['tl','tr','bl','br'].map(corner => {
                          const isLeft = corner.includes('l'), isTop = corner.includes('t');
                          return (
                            <div key={corner}
                              onMouseDown={e => startLogoCropDrag(e, corner)} onTouchStart={e => startLogoCropDrag(e, corner)}
                              style={{ position: "absolute",
                                left: `calc(${(isLeft ? logoCropBox.x : logoCropBox.x + logoCropBox.w) * 100}% - 7px)`,
                                top: `calc(${(isTop ? logoCropBox.y : logoCropBox.y + logoCropBox.h) * 100}% - 7px)`,
                                width: 14, height: 14, background: "#f26522", borderRadius: 2,
                                cursor: corner === 'tl' || corner === 'br' ? 'nwse-resize' : 'nesw-resize',
                                zIndex: 2 }} />
                          );
                        })}
                      </div>
                      <div style={{ display: "flex", gap: 8, padding: "10px 12px", justifyContent: "center" }}>
                        <button onClick={applyLogoCrop}
                          style={{ background: "#2a6b2a", color: "#ddd5c8", border: "1px solid #3a8a3a", fontFamily: "'Rajdhani',sans-serif", fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", borderRadius: 2, padding: "6px 14px", cursor: "pointer" }}>
                          Appliquer
                        </button>
                        <button onClick={() => { setLogoCropActive(false); setLogoCropBox({ x: 0, y: 0, w: 1, h: 1 }); }}
                          style={{ background: "#181818", color: "#ddd", border: "1px solid #2a2a2a", fontFamily: "'Rajdhani',sans-serif", fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", borderRadius: 2, padding: "6px 14px", cursor: "pointer" }}>
                          Annuler
                        </button>
                      </div>
                    </div>
                  )}
                </>)}

                {/* ── Mode : générer texte + couleur ── */}
                {logoMode === "generate" && (
                  <div style={{ background: "#161616", border: "1px solid #252525", borderRadius: 3, padding: "16px 14px", display: "flex", flexDirection: "column", gap: 14 }}>

                    {/* Texte */}
                    <div>
                      <div style={{ fontSize: 10, color: "#ddd", letterSpacing: 2, fontFamily: "'JetBrains Mono',monospace", marginBottom: 6, textTransform: "uppercase" }}>Texte du cache plaque</div>
                      <input
                        type="text" value={genText} onChange={e => setGenText(e.target.value)}
                        placeholder="Nom de votre garage"
                        style={{ width: "100%", background: "#1a1a1a", border: "1px solid #2a2a2a", color: "#ddd5c8", padding: "9px 10px", fontFamily: "'Rajdhani',sans-serif", fontSize: 17, fontWeight: 600, borderRadius: 2, outline: "none" }}
                      />
                    </div>

                    {/* Police */}
                    <div>
                      <div style={{ fontSize: 10, color: "#ddd", letterSpacing: 2, fontFamily: "'JetBrains Mono',monospace", marginBottom: 8, textTransform: "uppercase" }}>Police d'écriture</div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 6 }}>
                        {LOGO_FONTS.map(f => (
                          <div key={f.key} onClick={() => setGenFont(f.key)}
                            style={{ background: genFont === f.key ? "#1a1200" : "#1a1a1a", border: `1px solid ${genFont === f.key ? "#f26522" : "#2a2a2a"}`, borderRadius: 3, padding: "8px 4px", cursor: "pointer", textAlign: "center", display: "flex", flexDirection: "column", gap: 4, alignItems: "center" }}>
                            <span style={{ fontFamily: f.family, fontWeight: f.weight, fontSize: 16, color: genFont === f.key ? "#f26522" : "#aaa", lineHeight: 1 }}>
                              {(genText.trim() || "ABC").toUpperCase().slice(0, 4)}
                            </span>
                            <span style={{ fontSize: 8, color: genFont === f.key ? "#f26522" : "#444", fontFamily: "'JetBrains Mono',monospace", letterSpacing: 1, textTransform: "uppercase" }}>{f.label}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Couleur de fond */}
                    <div>
                      <div style={{ fontSize: 10, color: "#ddd", letterSpacing: 2, fontFamily: "'JetBrains Mono',monospace", marginBottom: 7, textTransform: "uppercase" }}>Couleur de fond</div>
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
                      <div style={{ fontSize: 10, color: "#ddd", letterSpacing: 2, fontFamily: "'JetBrains Mono',monospace", marginBottom: 7, textTransform: "uppercase" }}>Couleur du texte</div>
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

                    {/* Liseret (bordure) */}
                    <div>
                      <div style={{ fontSize: 10, color: "#ddd", letterSpacing: 2, fontFamily: "'JetBrains Mono',monospace", marginBottom: 7, textTransform: "uppercase" }}>Liseret (bordure)</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                          {["#ffffff","#000000","#ffcc00","#c0c0c0","#f26522"].map(col => (
                            <div key={col} onClick={() => { setGenBorderColor(col); if (genBorderWidth === 0) setGenBorderWidth(3); }}
                              style={{ width: 22, height: 22, background: col, borderRadius: 3, cursor: "pointer", border: genBorderColor === col && genBorderWidth > 0 ? "2px solid #f26522" : "2px solid #2a2a2a", flexShrink: 0 }} />
                          ))}
                          <input type="color" value={genBorderColor} onChange={e => { setGenBorderColor(e.target.value); if (genBorderWidth === 0) setGenBorderWidth(3); }}
                            title="Couleur personnalisée"
                            style={{ width: 22, height: 22, padding: 0, border: "1px solid #2a2a2a", borderRadius: 3, cursor: "pointer", background: "none" }} />
                        </div>
                        <input
                          type="range" min="0" max="10" step="1"
                          value={genBorderWidth}
                          onChange={e => setGenBorderWidth(parseInt(e.target.value))}
                          style={{ flex: 1, accentColor: "#f26522", height: 3 }}
                        />
                        <span style={{ fontSize: 11, color: genBorderWidth > 0 ? "#f26522" : "#444", fontFamily: "'JetBrains Mono',monospace", minWidth: 20, textAlign: "right" }}>
                          {genBorderWidth === 0 ? "Off" : genBorderWidth}
                        </span>
                      </div>
                    </div>

                    {/* Aperçu live */}
                    {logo?.preview && (
                      <div>
                        <div style={{ fontSize: 10, color: "#ddd", letterSpacing: 2, fontFamily: "'JetBrains Mono',monospace", marginBottom: 6, textTransform: "uppercase" }}>Aperçu</div>
                        <img src={logo.preview} style={{ width: "100%", display: "block", border: "1px solid #2a2a2a" }} />
                      </div>
                    )}
                  </div>
                )}

                <input ref={logoRef} type="file" accept="image/*" style={{ display: "none" }} onChange={e => handleLogoFile(e.target.files[0])} />

                {/* ── Arrondi des coins (global import + génération) ── */}
                <div style={{ marginTop: 16, background: "#161616", border: "1px solid #252525", borderRadius: 3, padding: "14px 16px" }}>
                  <Slider label="Arrondi des coins" value={logoRadius} min={0} max={10} step={1} onChange={setLogoRadius} />
                </div>
              </section>

              <section data-tutorial="enhancements">
                {/* ── Cases à cocher : améliorations photo ── */}
                {[
                  {
                    active: enhancePro,
                    toggle: () => setEnhancePro(p => !p),
                    icon: "✨",
                    label: "Amélioration automatique",
                    sub: "Couleurs froides & naturelles",
                  },
                  {
                    active: headlightPolish,
                    toggle: () => {
                      if (!canUseHeadlight) { setShowPlansModal(true); return; }
                      if (headlightCreditsRemaining <= 0) return;
                      if (!headlightPolish && !headlightInfoDismissed) { setShowHeadlightInfoModal(true); }
                      setHeadlightPolish(p => !p);
                    },
                    icon: "💡",
                    label: "Lustrage Optique Pro",
                    sub: canUseHeadlight ? "Retouche IA des phares jaunis" : "Disponible avec l'abonnement Pro",
                    locked: !canUseHeadlight,
                    credit: canUseHeadlight ? `${headlightCreditsRemaining}/${HEADLIGHT_LIMIT}` : null,
                  },
                  {
                    active: bodyPolish,
                    toggle: () => { if (!canUseBodyPolish) { setShowPlansModal(true); return; } setBodyPolish(p => !p); },
                    icon: "✦",
                    label: "Lustrage carrosserie",
                    sub: canUseBodyPolish ? "Brillance, saturation & profondeur de couleur" : "Disponible dès l'abonnement Essentiel",
                    locked: !canUseBodyPolish,
                  },
                ].map(({ active, toggle, icon, label, sub, locked, credit }) => (
                  <Fragment key={label}>
                    <div
                      onClick={toggle}
                      style={{ marginBottom: 8, display: "flex", alignItems: "center", gap: 12, padding: "11px 14px", background: active && !locked ? "rgba(242,101,34,0.08)" : "#0a0a0a", border: `1px solid ${active && !locked ? "#f26522" : "#1c1c1c"}`, borderRadius: 3, cursor: "pointer", userSelect: "none", opacity: locked ? 0.55 : 1 }}
                    >
                      <div style={{ width: 16, height: 16, borderRadius: 3, border: `2px solid ${locked ? "#555" : active ? "#f26522" : "#444"}`, background: active && !locked ? "#f26522" : "transparent", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                        {locked ? <span style={{ color: "#ddd", fontSize: 11 }}>🔒</span> : active && <span style={{ color: "#090909", fontSize: 12, fontWeight: 900, lineHeight: 1 }}>✓</span>}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", color: locked ? "#888" : active ? "#f26522" : "#aaa", fontFamily: "'Rajdhani',sans-serif" }}>
                          {icon} {label}{locked && <span style={{ fontSize: 9, color: "#f26522", fontFamily: "'JetBrains Mono',monospace", letterSpacing: 1, marginLeft: 6 }}>PRO</span>}
                        </div>
                        <div style={{ fontSize: 10, color: "#ddd", fontFamily: "'JetBrains Mono',monospace", marginTop: 2 }}>{sub}</div>
                      </div>
                      {credit && <div style={{ fontSize: 11, color: "#f26522", fontFamily: "'JetBrains Mono',monospace", letterSpacing: 1, fontWeight: 700, flexShrink: 0 }}>{credit}</div>}
                    </div>
                    {label === "Amélioration automatique" && enhancePro && (
                      <div style={{ marginBottom: 8, background: "#161616", border: "1px solid #252525", borderRadius: 3, padding: "12px 14px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                          <span style={{ fontSize: 11, letterSpacing: 2, textTransform: "uppercase", color: "#ddd", fontFamily: "'JetBrains Mono',monospace" }}>
                            Régler l'intensité
                          </span>
                          <span style={{ fontSize: 12, color: enhanceProIntensity > 0 ? "#f26522" : "#444", fontFamily: "'JetBrains Mono',monospace", minWidth: 20, textAlign: "right" }}>
                            {enhanceProIntensity === 0 ? "Off" : enhanceProIntensity}
                          </span>
                        </div>
                        <input
                          type="range" min="0" max="5" step="1"
                          value={enhanceProIntensity}
                          onChange={e => setEnhanceProIntensity(parseInt(e.target.value))}
                          style={{ width: "100%", accentColor: "#f26522", cursor: "pointer", height: 3 }}
                        />
                      </div>
                    )}
                  </Fragment>
                ))}

                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                  <div style={{ fontSize: 13, letterSpacing: 3, color: adjEnabled ? "#f26522" : "#444", textTransform: "uppercase", fontFamily: "'JetBrains Mono',monospace" }}>03 — Ajustements photo</div>
                  <button onClick={() => setAdjEnabled(p => !p)} style={{ background: adjEnabled ? "#f26522" : "#1a1a1a", border: `1px solid ${adjEnabled ? "#f26522" : "#2a2a2a"}`, color: adjEnabled ? "#090909" : "#444", padding: "4px 13px", cursor: "pointer", fontFamily: "'JetBrains Mono',monospace", fontSize: 10, letterSpacing: 2, textTransform: "uppercase", borderRadius: 2 }}>
                    {adjEnabled ? "ON" : "OFF"}
                  </button>
                </div>
                <div style={{ background: "#161616", border: "1px solid #252525", borderRadius: 3, padding: "20px 18px", opacity: adjEnabled ? 1 : 0.35, pointerEvents: adjEnabled ? "auto" : "none" }}>
                  <Slider label="Luminosité" value={adj.brightness} min={0.7} max={1.5} step={0.01} onChange={v => setAdj(p => ({...p, brightness: v}))} />
                  <Slider label="Contraste" value={adj.contrast} min={0.7} max={1.6} step={0.01} onChange={v => setAdj(p => ({...p, contrast: v}))} />
                  <Slider label="Saturation" value={adj.saturation} min={0.5} max={2.0} step={0.01} onChange={v => setAdj(p => ({...p, saturation: v}))} />
                </div>
              </section>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
              <section data-tutorial="photos">
                <div style={{ fontSize: 13, letterSpacing: 3, color: "#f26522", textTransform: "uppercase", marginBottom: 12, fontFamily: "'JetBrains Mono',monospace" }}>02 — Photos de véhicules</div>
                <div onDragOver={e => { e.preventDefault(); setDragOver("photos"); }} onDragLeave={() => setDragOver(null)}
                  onDrop={e => { e.preventDefault(); setDragOver(null); handlePhotoFiles(e.dataTransfer.files); }}
                  onClick={() => photosRef.current?.click()}
                  style={{ border: `1px dashed ${dragOver === "photos" ? "#f26522" : "#222"}`, borderRadius: 3, padding: "22px 16px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", background: "#161616", marginBottom: 12 }}>
                  <div style={{ textAlign: "center", color: "#ddd" }}>
                    <div style={{ fontSize: 31, marginBottom: 8 }}>◈</div>
                    <div style={{ fontSize: 13, color: "#ddd" }}>{isMobile ? "Appuyer pour sélectionner" : "Glisser les photos ici"}</div>
                    <div style={{ fontSize: 11, marginTop: 3, color: "#aaa" }}>JPG, PNG — plusieurs fichiers acceptés</div>
                  </div>
                </div>
                <input ref={photosRef} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={e => handlePhotoFiles(e.target.files)} />
                {photos.length > 0 && (
                  <>
                    <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(4, 1fr)" : "repeat(5, 1fr)", gap: 5, maxHeight: 210, overflowY: "auto", marginBottom: 10 }}>
                      {photos.map(p => (
                        <div key={p.id} style={{ position: "relative" }}>
                          <img src={p.preview} style={{ width: "100%", aspectRatio: "4/3", objectFit: "cover", borderRadius: 2, border: "1px solid #252525", display: "block" }} />
                          <button onClick={e => { e.stopPropagation(); setPhotos(prev => prev.filter(x => x.id !== p.id)); }}
                            style={{ position: "absolute", top: 2, right: 2, width: 15, height: 15, borderRadius: "50%", background: "#f26522", border: "none", color: "#090909", fontSize: 10, cursor: "pointer", fontWeight: 700 }}>×</button>
                        </div>
                      ))}
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: 11, color: "#ddd", fontFamily: "'JetBrains Mono',monospace" }}>{photos.length} photo{photos.length > 1 ? "s" : ""}</span>
                      <button onClick={() => setPhotos([])} style={{ background: "transparent", border: "1px solid #1e1e1e", color: "#ddd", padding: "3px 10px", cursor: "pointer", fontFamily: "'Rajdhani',sans-serif", fontSize: 11, letterSpacing: 1, textTransform: "uppercase", borderRadius: 2 }}>Tout effacer</button>
                    </div>
                  </>
                )}
              </section>

              {/* ── 03 — Showroom Virtuel ── */}
              <section data-tutorial="showroom">
                <div style={{ fontSize: 13, letterSpacing: 3, color: "#f26522", textTransform: "uppercase", marginBottom: 12, fontFamily: "'JetBrains Mono',monospace" }}>03 — Showroom Virtuel</div>
                <div onClick={() => { if (!canUseShowroom) { setShowUpgradeProModal(true); return; } const next = !showroomEnabled; setShowroomEnabled(next); }}
                  style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 14px", background: showroomEnabled && canUseShowroom ? "rgba(242,101,34,0.08)" : "#0a0a0a", border: `1px solid ${showroomEnabled && canUseShowroom ? "#f26522" : "#1c1c1c"}`, borderRadius: showroomEnabled && canUseShowroom ? "3px 3px 0 0" : 3, cursor: "pointer", userSelect: "none", opacity: canUseShowroom ? 1 : 0.5 }}>
                  <div style={{ width: 16, height: 16, borderRadius: 3, border: `2px solid ${showroomEnabled && canUseShowroom ? "#f26522" : "#444"}`, background: showroomEnabled && canUseShowroom ? "#f26522" : "transparent", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {canUseShowroom ? (showroomEnabled && <span style={{ color: "#090909", fontSize: 12, fontWeight: 900, lineHeight: 1 }}>✓</span>) : <span style={{ color: "#ddd", fontSize: 11 }}>🔒</span>}
                  </div>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", color: showroomEnabled && canUseShowroom ? "#f26522" : "#aaa", fontFamily: "'Rajdhani',sans-serif" }}>
                      ⬡ Showroom Virtuel {!canUseShowroom && <span style={{ fontSize: 9, color: "#f26522", fontFamily: "'JetBrains Mono',monospace", letterSpacing: 1, marginLeft: 6 }}>ABONNEMENT PRO</span>}
                    </div>
                    <div style={{ fontSize: 10, color: "#ddd", fontFamily: "'JetBrains Mono',monospace", marginTop: 2 }}>
                      {canUseShowroom ? "Détourage IA · Fond de showroom · Inclus au traitement" : "Disponible avec l'abonnement Pro — cliquez pour en savoir plus"}
                    </div>
                  </div>
                </div>
                {showroomEnabled && (
                  <div style={{ padding: "12px 14px", background: "#121212", border: "1px solid #f26522", borderTop: "none", borderRadius: "0 0 3px 3px" }}>
                    <div style={{ display: "flex", gap: 10, alignItems: "flex-start", background: "rgba(242,101,34,0.06)", border: "1px solid rgba(242,101,34,0.2)", borderRadius: 3, padding: "9px 11px", marginBottom: 14 }}>
                      <span style={{ color: "#f26522", fontSize: 14, flexShrink: 0, lineHeight: 1.4 }}>⚠</span>
                      <p style={{ fontSize: 10, color: "#ddd", fontFamily: "'JetBrains Mono',monospace", lineHeight: 1.7, margin: 0 }}>
                        Pour un détourage optimal, utilisez une photo où le véhicule est <span style={{ color: "#ddd5c8" }}>seul dans le cadre</span>. La présence d'autres véhicules à proximité peut perturber l'analyse de l'IA et affecter la qualité du détourage.
                      </p>
                    </div>
                    <div style={{ fontSize: 10, letterSpacing: 2, color: "#ddd", textTransform: "uppercase", fontFamily: "'JetBrains Mono',monospace", marginBottom: 10 }}>Fond de scène</div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "stretch" }}>
                      {[0, 1, 2, 3].map(idx => {
                        const isActive = showroomSetupBg === idx;
                        return (
                          <div key={idx} onClick={e => { e.stopPropagation(); setShowroomSetupBg(idx); }}
                            style={{ cursor: "pointer", border: `2px solid ${isActive ? "#f26522" : "#2a2a2a"}`, borderRadius: 3, overflow: "hidden", width: 70, flexShrink: 0, transition: "border-color 0.12s" }}>
                            <img src={SHOWROOM_THUMBS[idx]} style={{ display: "block", width: "100%", height: 39, objectFit: "cover" }} />
                            <div style={{ background: isActive ? "#f26522" : "#1a1a1a", color: isActive ? "#090909" : "#555", fontSize: 8, fontFamily: "'JetBrains Mono',monospace", letterSpacing: 1, textAlign: "center", padding: "2px 0", textTransform: "uppercase" }}>
                              {SHOWROOM_LABELS[idx]}
                            </div>
                          </div>
                        );
                      })}
                      <div onClick={e => { e.stopPropagation(); showroomSetupUploadRef.current?.click(); }}
                        style={{ cursor: "pointer", border: `2px solid ${showroomSetupBg === 'custom' ? "#f26522" : "#2a2a2a"}`, borderRadius: 3, overflow: "hidden", width: 70, flexShrink: 0, display: "flex", flexDirection: "column", background: "#1e1e1e", transition: "border-color 0.12s" }}>
                        {showroomSetupCustomBg
                          ? <img src={showroomSetupCustomBg} style={{ display: "block", width: "100%", height: 39, objectFit: "cover" }} />
                          : <div style={{ height: 39, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 21, color: "#ddd" }}>+</div>
                        }
                        <div style={{ background: showroomSetupBg === 'custom' ? "#f26522" : "#1a1a1a", color: showroomSetupBg === 'custom' ? "#090909" : "#555", fontSize: 8, fontFamily: "'JetBrains Mono',monospace", letterSpacing: 1, textAlign: "center", padding: "2px 0", textTransform: "uppercase" }}>Custom</div>
                      </div>
                      <input ref={showroomSetupUploadRef} type="file" accept="image/*" style={{ display: "none" }}
                        onChange={e => {
                          const f = e.target.files?.[0]; if (!f) return;
                          const reader = new FileReader();
                          reader.onload = ev => { setShowroomSetupCustomBg(ev.target.result); setShowroomSetupBg('custom'); };
                          reader.readAsDataURL(f);
                          e.target.value = '';
                        }} />
                    </div>

                    {/* Ombres au sol — case à cocher (le calcul d'ombre est coûteux, on le rend optionnel) */}
                    <div
                      onClick={() => setShowroomFloorShadow(p => !p)}
                      style={{
                        marginTop: 14,
                        display: "flex", alignItems: "center", gap: 10,
                        padding: "9px 11px",
                        background: showroomFloorShadow ? "rgba(242,101,34,0.08)" : "#0a0a0a",
                        border: `1px solid ${showroomFloorShadow ? "#f26522" : "#252525"}`,
                        borderRadius: 3,
                        cursor: "pointer",
                        userSelect: "none",
                      }}
                    >
                      <div style={{
                        width: 14, height: 14, borderRadius: 2,
                        border: `2px solid ${showroomFloorShadow ? "#f26522" : "#555"}`,
                        background: showroomFloorShadow ? "#f26522" : "transparent",
                        flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
                      }}>
                        {showroomFloorShadow && <span style={{ color: "#090909", fontSize: 11, fontWeight: 900, lineHeight: 1 }}>✓</span>}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{
                          fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase",
                          color: showroomFloorShadow ? "#f26522" : "#aaa",
                          fontFamily: "'Rajdhani',sans-serif",
                        }}>
                          ☼ Ombres au sol
                        </div>
                        <div style={{
                          fontSize: 10, color: "#aaa",
                          fontFamily: "'JetBrains Mono',monospace",
                          marginTop: 2,
                        }}>
                          {showroomFloorShadow
                            ? "Activé · Rendu plus naturel mais traitement plus long"
                            : "Désactivé · Traitement plus rapide, voiture sans ombre"}
                        </div>
                      </div>
                    </div>

                    {/* Logo / Texte mural */}
                    <div style={{ marginTop: 14, borderTop: "1px solid #252525", paddingTop: 12 }}>
                      <div style={{ fontSize: 10, letterSpacing: 2, color: "#ddd", textTransform: "uppercase", fontFamily: "'JetBrains Mono',monospace", marginBottom: 8 }}>Enseigne murale</div>

                      {/* Tabs : Aucun / Image / Texte */}
                      <div style={{ display: "flex", gap: 4, marginBottom: 10 }}>
                        {[["none","Aucune"],["image","Importer logo"],["text","Générer texte"]].map(([k,label]) => (
                          <button key={k} onClick={() => setWallLogoMode(k)}
                            style={{ flex: 1, padding: "5px 0", fontSize: 9, fontFamily: "'JetBrains Mono',monospace", letterSpacing: 1, textTransform: "uppercase", cursor: "pointer", borderRadius: 2,
                              background: wallLogoMode === k ? "#f26522" : "#161616",
                              color: wallLogoMode === k ? "#090909" : "#777",
                              border: `1px solid ${wallLogoMode === k ? "#f26522" : "#2a2a2a"}`,
                            }}>{label}</button>
                        ))}
                      </div>

                      {/* Mode Image */}
                      {wallLogoMode === "image" && (
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <div onClick={() => wallLogoUploadRef.current?.click()}
                            style={{ width: 70, height: 39, border: `1px dashed ${wallLogo ? "#f26522" : "#2a2a2a"}`, borderRadius: 3, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", background: "#161616", overflow: "hidden", flexShrink: 0 }}>
                            {wallLogo
                              ? <img src={wallLogo} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
                              : <span style={{ fontSize: 19, color: "#ddd" }}>+</span>
                            }
                          </div>
                          <input ref={wallLogoUploadRef} type="file" accept="image/*" style={{ display: "none" }}
                            onChange={e => {
                              const f = e.target.files?.[0]; if (!f) return;
                              const reader = new FileReader();
                              reader.onload = ev => setWallLogo(ev.target.result);
                              reader.readAsDataURL(f);
                              e.target.value = '';
                            }} />
                          {wallLogo && (<>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: 9, color: "#ddd", fontFamily: "'JetBrains Mono',monospace", marginBottom: 4 }}>TAILLE</div>
                              <input type="range" min="0.05" max="0.40" step="0.01" value={wallLogoScale}
                                onChange={e => setWallLogoScale(parseFloat(e.target.value))}
                                style={{ width: "100%", accentColor: "#f26522", height: 3 }} />
                            </div>
                            <button onClick={() => setWallLogo(null)}
                              style={{ background: "transparent", border: "1px solid #2a2a2a", color: "#ddd", width: 22, height: 22, borderRadius: 3, cursor: "pointer", fontSize: 11, display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
                          </>)}
                        </div>
                      )}

                      {/* Mode Texte */}
                      {wallLogoMode === "text" && (
                        <div>
                          <input type="text" value={wallText} onChange={e => setWallText(e.target.value)}
                            placeholder="Nom de l'enseigne"
                            style={{ width: "100%", boxSizing: "border-box", padding: "8px 10px", background: "#161616", border: "1px solid #2a2a2a", borderRadius: 3, color: "#ddd5c8", fontFamily: "'Rajdhani',sans-serif", fontSize: 14, letterSpacing: 1, marginBottom: 8 }} />
                          {/* Aperçu */}
                          {wallText.trim() && (
                            <div style={{ background: "#111", border: "1px solid #222", borderRadius: 3, padding: "10px 14px", marginBottom: 8, textAlign: "center", overflow: "hidden" }}>
                              <span style={{
                                fontFamily: (WALL_FONTS.find(f => f.key === wallTextFont) ?? WALL_FONTS[0]).family,
                                fontWeight: (WALL_FONTS.find(f => f.key === wallTextFont) ?? WALL_FONTS[0]).weight,
                                fontSize: 23, color: wallTextColor, letterSpacing: 3,
                                WebkitTextStroke: wallTextStrokeWidth > 0 ? `${wallTextStrokeWidth * 0.4}px ${wallTextStrokeColor}` : undefined,
                                textDecoration: wallTextUnderline ? "underline" : "none",
                              }}>{wallText.trim()}</span>
                            </div>
                          )}
                          <div style={{ display: "flex", gap: 8, alignItems: "flex-start", marginBottom: 8 }}>
                            {/* Couleur */}
                            <div>
                              <div style={{ fontSize: 9, color: "#ddd", fontFamily: "'JetBrains Mono',monospace", marginBottom: 4 }}>COULEUR</div>
                              <input type="color" value={wallTextColor} onChange={e => setWallTextColor(e.target.value)}
                                style={{ width: 34, height: 26, border: "1px solid #2a2a2a", borderRadius: 3, background: "transparent", cursor: "pointer" }} />
                            </div>
                            {/* Taille */}
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: 9, color: "#ddd", fontFamily: "'JetBrains Mono',monospace", marginBottom: 4 }}>TAILLE</div>
                              <input type="range" min="0.05" max="0.40" step="0.01" value={wallLogoScale}
                                onChange={e => setWallLogoScale(parseFloat(e.target.value))}
                                style={{ width: "100%", accentColor: "#f26522", height: 3 }} />
                            </div>
                          </div>
                          {/* Polices */}
                          <div style={{ fontSize: 9, color: "#ddd", fontFamily: "'JetBrains Mono',monospace", marginBottom: 4 }}>POLICE</div>
                          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 8 }}>
                            {WALL_FONTS.map(f => (
                              <button key={f.key} onClick={() => setWallTextFont(f.key)}
                                style={{
                                  padding: "4px 8px", fontSize: 11, cursor: "pointer", borderRadius: 2,
                                  fontFamily: f.family, fontWeight: f.weight,
                                  background: wallTextFont === f.key ? "#f26522" : "#161616",
                                  color: wallTextFont === f.key ? "#090909" : "#999",
                                  border: `1px solid ${wallTextFont === f.key ? "#f26522" : "#2a2a2a"}`,
                                }}>{f.label}</button>
                            ))}
                          </div>
                          {/* Liseré */}
                          <div style={{ marginBottom: 8 }}>
                            <div style={{ fontSize: 9, color: "#ddd", fontFamily: "'JetBrains Mono',monospace", marginBottom: 4 }}>LISERÉ</div>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <input type="color" value={wallTextStrokeColor}
                                onChange={e => { setWallTextStrokeColor(e.target.value); if (wallTextStrokeWidth === 0) setWallTextStrokeWidth(2); }}
                                style={{ width: 26, height: 26, padding: 0, border: `1px solid ${wallTextStrokeWidth > 0 ? "#f26522" : "#2a2a2a"}`, borderRadius: 3, cursor: "pointer", background: "none" }} />
                              <input type="range" min="0" max="10" step="1" value={wallTextStrokeWidth}
                                onChange={e => setWallTextStrokeWidth(parseInt(e.target.value))}
                                style={{ flex: 1, accentColor: "#f26522", height: 3 }} />
                              <span style={{ fontSize: 11, color: wallTextStrokeWidth > 0 ? "#f26522" : "#444", fontFamily: "'JetBrains Mono',monospace", minWidth: 20, textAlign: "right" }}>
                                {wallTextStrokeWidth === 0 ? "Off" : wallTextStrokeWidth}
                              </span>
                            </div>
                          </div>
                          {/* Soulignement */}
                          <div>
                            <div style={{ fontSize: 9, color: "#ddd", fontFamily: "'JetBrains Mono',monospace", marginBottom: 4 }}>SOULIGNEMENT</div>
                            <button onClick={() => setWallTextUnderline(v => !v)}
                              style={{
                                padding: "4px 12px", fontSize: 11, cursor: "pointer", borderRadius: 2,
                                fontFamily: "'JetBrains Mono',monospace", letterSpacing: 1, textTransform: "uppercase",
                                textDecoration: "underline",
                                background: wallTextUnderline ? "#f26522" : "#161616",
                                color: wallTextUnderline ? "#090909" : "#777",
                                border: `1px solid ${wallTextUnderline ? "#f26522" : "#2a2a2a"}`,
                              }}>Souligner</button>
                          </div>
                        </div>
                      )}

                      {(wallLogoMode === "image" && wallLogo) || (wallLogoMode === "text" && wallText.trim()) ? (
                        <div style={{ fontSize: 9, color: "#ddd", fontFamily: "'JetBrains Mono',monospace", marginTop: 8 }}>
                          Positionnez l'enseigne en la glissant sur l'image dans les résultats
                        </div>
                      ) : null}
                    </div>
                  </div>
                )}
              </section>

              <section data-tutorial="process">
                <button onClick={start} disabled={!canStart} style={{ width: "100%", background: canStart ? "#f26522" : "#1a1a1a", color: canStart ? "#090909" : "#444", border: "none", padding: "15px 24px", cursor: canStart ? "pointer" : "not-allowed", fontFamily: "'Rajdhani',sans-serif", fontSize: 16, fontWeight: 700, letterSpacing: 4, textTransform: "uppercase", borderRadius: 3 }}>
                  {processing ? `Traitement... ${progress.n} / ${progress.total}` : `Lancer — ${photos.length} photo${photos.length > 1 ? "s" : ""}${showroomEnabled ? " + Showroom" : ""}`}
                </button>
                {processing && (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ height: 2, background: "#1e1e1e", borderRadius: 1, overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${pct}%`, background: "#f26522", transition: "width 0.4s ease" }} />
                    </div>
                    <div style={{ marginTop: 5, fontSize: 10, color: "#ddd", fontFamily: "'JetBrains Mono',monospace", textAlign: "right" }}>{pct}%</div>
                  </div>
                )}
                {!logo && <div style={{ marginTop: 10, fontSize: 11, color: "#ddd", fontFamily: "'JetBrains Mono',monospace" }}>⚠ Chargez votre logo pour continuer</div>}
              </section>
            </div>
          </div>
        )}

        {tab === "results" && (
          <div style={{ maxWidth: 1200, margin: "0 auto", padding: isMobile ? "16px 12px" : "32px 28px" }}>
            {results.length === 0 ? (
              <div style={{ textAlign: "center", padding: "80px 0", color: "#ddd" }}>
                <div style={{ fontSize: 49, marginBottom: 16 }}>◈</div>
                <div style={{ fontSize: 15, letterSpacing: 2, textTransform: "uppercase" }}>Aucun résultat</div>
              </div>
            ) : (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
                  <div>
                    <div style={{ fontSize: 13, letterSpacing: 3, color: "#f26522", textTransform: "uppercase", fontFamily: "'JetBrains Mono',monospace" }}>{results.length} photo{results.length > 1 ? "s" : ""} traitée{results.length > 1 ? "s" : ""}</div>
                    <div style={{ marginTop: 4, fontSize: 11, color: "#ddd", fontFamily: "'JetBrains Mono',monospace" }}>
                      {results.filter(r => r.plateFound).length} détectée{results.filter(r => r.plateFound).length > 1 ? "s" : ""} · {results.filter(r => !r.plateFound).length} non détectée{results.filter(r => !r.plateFound).length > 1 ? "s" : ""}
                    </div>
                  </div>
                  {!processing && (
                    <div style={{ display: "flex", gap: 8 }}>
                      {results.some(r => r.plateFound) && (
                        <button onClick={exportDatasetRaw}
                          title="Exporter les photos originales où une plaque a été détectée — pour construire le dataset YOLOv8-pose"
                          style={{ background: "transparent", color: "#ddd", border: "1px solid #2a2a2a", padding: "9px 16px", cursor: "pointer", fontFamily: "'Rajdhani',sans-serif", fontSize: 12, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", borderRadius: 3 }}>
                          Export dataset ({results.filter(r => r.plateFound).length})
                        </button>
                      )}
                      <button onClick={downloadAll} style={{ background: "#f26522", color: "#090909", border: "none", padding: "9px 22px", cursor: "pointer", fontFamily: "'Rajdhani',sans-serif", fontSize: 13, fontWeight: 700, letterSpacing: 3, textTransform: "uppercase", borderRadius: 3 }}>
                        Tout télécharger ({results.length})
                      </button>
                    </div>
                  )}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(${isMobile ? 150 : 260}px, 1fr))`, gap: isMobile ? 10 : 14 }}>
                  {results.map((r, i) => (
                    <div key={i} style={{ background: "#161616", border: "1px solid #252525", borderRadius: 3, overflow: "hidden" }}>
                      <div style={{ position: "relative", cursor: "zoom-in" }} onClick={() => openLightbox(r)} title="Cliquer pour agrandir">
                        <img src={r.showroomDataURL || r.processed} style={{ width: "100%", aspectRatio: "4/3", objectFit: "contain", background: "#1e1e1e", display: "block" }} />
                        {!r.showroomDataURL && window.location.search.includes('plateDebug') && r.yoloBbox && r.imgW && (
                          <svg
                            style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", pointerEvents: "none" }}
                            viewBox={`0 0 ${r.imgW} ${r.imgH}`}
                            preserveAspectRatio="xMidYMid meet"
                          >
                            {/* Bbox YOLO — vert pointillé */}
                            <rect
                              x={r.yoloBbox.x1 * r.imgW} y={r.yoloBbox.y1 * r.imgH}
                              width={(r.yoloBbox.x2 - r.yoloBbox.x1) * r.imgW}
                              height={(r.yoloBbox.y2 - r.yoloBbox.y1) * r.imgH}
                              fill="none" stroke="#22c55e" strokeWidth={Math.max(2, r.imgW * 0.002)}
                              strokeDasharray={`${r.imgW * 0.01} ${r.imgW * 0.005}`}
                            />
                            {/* bbox_stable (filet axe-aligné) — bleu pointillé,
                                debug uniquement, affiché quand la render
                                geometry est autre chose (pour comparer). */}
                            {r.yoloRenderSource !== 'bbox_stable'
                              && r.yoloBboxStable
                              && r.yoloBboxStable.length === 4 && (
                              <g opacity={0.40}>
                                <polygon
                                  points={r.yoloBboxStable.map(p => `${p.x * r.imgW},${p.y * r.imgH}`).join(' ')}
                                  fill="none" stroke="#3b82f6"
                                  strokeWidth={Math.max(1, r.imgW * 0.0015)}
                                  strokeDasharray={`${r.imgW * 0.005} ${r.imgW * 0.004}`}
                                />
                              </g>
                            )}
                            {/* Candidats alternatifs — cyan fin pointillé (debug) */}
                            {r.yoloDebug?.candidates && r.yoloDebug.candidates
                              .filter(c => !c.is_final)
                              .map((c, ci) => {
                                const ab = c.method.startsWith('hough') ? 'hough'
                                  : c.method.startsWith('approx_poly') ? 'poly'
                                  : c.method.startsWith('min_area_rect') ? 'rect'
                                  : c.method.startsWith('tightened_bbox') ? 'bbox' : c.method;
                                return (
                                  <g key={`alt-${ci}`} opacity={0.55}>
                                    <polygon
                                      points={c.corners.map(p => `${p.x * r.imgW},${p.y * r.imgH}`).join(' ')}
                                      fill="none" stroke="#06b6d4"
                                      strokeWidth={Math.max(1, r.imgW * 0.0014)}
                                      strokeDasharray={`${r.imgW * 0.004} ${r.imgW * 0.003}`}
                                    />
                                    <text
                                      x={c.corners[0].x * r.imgW + r.imgW * 0.003}
                                      y={c.corners[0].y * r.imgH - r.imgH * 0.004}
                                      fill="#06b6d4" fontSize={r.imgH * 0.018}
                                      fontFamily="monospace" fontWeight="bold">
                                      {c.score.toFixed(1)} {ab}
                                    </text>
                                  </g>
                                );
                              })}
                            {/* Quad OpenCV historique (chosen de refine_corners)
                                — debug uniquement, en orange dashed faible
                                opacité, dès qu'il diffère du quad réellement
                                rendu. Sert à voir l'écart entre l'ancien
                                « chosen » et la render geometry promue. */}
                            {(() => {
                              const oc = r.yoloOpencvCorners;
                              const fc = r.yoloCorners;
                              if (!oc || oc.length !== 4) return null;
                              const differs = !fc || fc.length !== 4
                                || oc.some((p, i) =>
                                     Math.abs(p.x - fc[i].x) > 5e-4
                                  || Math.abs(p.y - fc[i].y) > 5e-4);
                              if (!differs) return null;
                              return (
                                <g opacity={0.40}>
                                  <polygon
                                    points={oc.map(p => `${p.x * r.imgW},${p.y * r.imgH}`).join(' ')}
                                    fill="none" stroke="#f97316"
                                    strokeWidth={Math.max(1, r.imgW * 0.0015)}
                                    strokeDasharray={`${r.imgW * 0.006} ${r.imgW * 0.004}`}
                                  />
                                </g>
                              );
                            })()}
                            {/* Quadrilatère final — couleur selon render_source. */}
                            {r.yoloCorners && (() => {
                              const src = r.yoloRenderSource || r.yoloSource;
                              // keypoints = vert,
                              // opencv_promoted = lime (OpenCV validé perspective-aware),
                              // bbox_stable = bleu (filet axe-aligné),
                              // (legacy) opencv_fallback = orange,
                              // tightened_bbox = rouge.
                              const stroke = src === 'keypoints'             ? '#22c55e'
                                          : src === 'opencv_promoted'       ? '#84cc16'
                                          : src === 'front_plate_refined'   ? '#e879f9'
                                          : src === 'bbox_stable'           ? '#3b82f6'
                                          : src === 'tightened_bbox'        ? '#ef4444'
                                          : '#f97316';
                              return (
                                <>
                                  <polygon
                                    points={r.yoloCorners.map(p => `${p.x * r.imgW},${p.y * r.imgH}`).join(' ')}
                                    fill="none" stroke={stroke}
                                    strokeWidth={Math.max(2, r.imgW * 0.003)}
                                  />
                                  {r.yoloCorners.map((p, i) => (
                                    <circle key={i} cx={p.x * r.imgW} cy={p.y * r.imgH}
                                      r={Math.max(4, r.imgW * 0.006)} fill={stroke} />
                                  ))}
                                </>
                              );
                            })()}
                            {/* Badge confiance + méthode finale */}
                            <rect x={r.yoloBbox.x1 * r.imgW} y={r.yoloBbox.y1 * r.imgH - r.imgH * 0.042}
                              width={r.imgW * 0.072} height={r.imgH * 0.038} fill="#22c55e" rx={r.imgW * 0.003} />
                            <text x={r.yoloBbox.x1 * r.imgW + r.imgW * 0.005} y={r.yoloBbox.y1 * r.imgH - r.imgH * 0.01}
                              fill="#000" fontSize={r.imgH * 0.026} fontFamily="monospace" fontWeight="bold">
                              {Math.round(r.yoloBbox.conf * 100)}%
                            </text>
                            {(r.yoloRenderSource || r.yoloSource || r.yoloDebug?.method) && (() => {
                              const src = r.yoloRenderSource || r.yoloSource;
                              const method = r.yoloDebug?.method?.split(':')[0];
                              let label = src === 'keypoints'             ? 'keypoints'
                                : src === 'opencv_promoted'        ? 'opencv_promoted'
                                : src === 'front_plate_refined'    ? 'front_refined'
                                : src === 'bbox_stable'            ? 'bbox_stable'
                                : src === 'tightened_bbox'         ? 'tightened_bbox'
                                : (method === 'hough_lines' ? 'hough' : method) || src || '?';
                              if (src === 'front_plate_refined' && r.yoloFrontPlateTelemetry) {
                                const ft = r.yoloFrontPlateTelemetry;
                                label = `front_refined (AR=${ft.ar || '?'})`;
                              } else if (src === 'opencv_promoted' && r.yoloQuadSource) {
                                label = `opencv_promoted (${r.yoloQuadSource.split(':')[0]})`;
                              } else if (src === 'bbox_stable' && r.yoloRejectionReason) {
                                const reason = r.yoloRejectionReason.split(':').slice(0, 2).join(':');
                                label = `bbox_stable — ${reason}`;
                              }
                              const color = src === 'keypoints'             ? '#22c55e'
                                : src === 'opencv_promoted'        ? '#84cc16'
                                : src === 'front_plate_refined'    ? '#e879f9'
                                : src === 'bbox_stable'            ? '#3b82f6'
                                : src === 'tightened_bbox'         ? '#ef4444'
                                : '#f97316';
                              return (
                                <text x={r.yoloBbox.x1 * r.imgW + r.imgW * 0.078}
                                  y={r.yoloBbox.y1 * r.imgH - r.imgH * 0.012}
                                  fill={color} fontSize={r.imgH * 0.022}
                                  fontFamily="monospace" fontWeight="bold">
                                  {label}
                                </text>
                              );
                            })()}
                          </svg>
                        )}
                        <div style={{ position: "absolute", top: 8, left: 8, display: "flex", gap: 4 }}>
                          <span style={{ background: r.plateFound ? "rgba(22,163,74,0.9)" : "rgba(220,38,38,0.9)", color: "#fff", fontSize: 9, padding: "3px 7px", borderRadius: 2, fontFamily: "'JetBrains Mono',monospace" }}>
                            {r.plateFound ? "✓ PLAQUE CACHÉE" : "⚠ NON DÉTECTÉE"}
                          </span>
                          {r.cropped && (
                            <span style={{ background: "rgba(242,101,34,0.85)", color: "#fff", fontSize: 9, padding: "3px 7px", borderRadius: 2, fontFamily: "'JetBrains Mono',monospace" }}>✂ ROGNÉ</span>
                          )}
                        </div>
                        <div style={{ position: "absolute", bottom: 8, right: 8, background: "rgba(0,0,0,0.6)", borderRadius: 2, padding: "3px 7px", fontSize: 10, color: "#ddd", fontFamily: "'JetBrains Mono',monospace" }}>🔍 Agrandir</div>
                      </div>
                      <div style={{ padding: "9px 11px", display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid #161616", gap: 6 }}>
                        <div style={{ fontSize: 11, color: "#ddd", fontFamily: "'JetBrains Mono',monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>{r.name}</div>
                        {!r.plateFound && (
                          <button
                            onClick={e => {
                              e.stopPropagation();
                              openLightbox(r);
                              const dc = { tl: { x: 0.35, y: 0.70 }, tr: { x: 0.65, y: 0.70 }, br: { x: 0.65, y: 0.78 }, bl: { x: 0.35, y: 0.78 } };
                              adjustCornersRef.current = dc;
                              setAdjustCorners(dc);
                              setAdjustMode(true);
                              setManualPlateMode(true);
                              setCropMode(false);
                            }}
                            style={{ background: "#f26522", border: "none", color: "#090909", padding: "4px 9px", cursor: "pointer", fontFamily: "'Rajdhani',sans-serif", fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", borderRadius: 2, whiteSpace: "nowrap", flexShrink: 0 }}
                          >+ Cache plaque</button>
                        )}
                        <button onClick={() => downloadOne(r)} style={{ background: "transparent", border: "1px solid #2a2a2a", color: "#f26522", padding: "4px 11px", cursor: "pointer", fontFamily: "'Rajdhani',sans-serif", fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", borderRadius: 2, flexShrink: 0 }}>DL</button>
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
          onClick={cropMode || adjustMode || showMaskEditor ? undefined : closeLightbox}
          onMouseMove={e => { onCropMouseMove(e); onAdjustMouseMove(e); onLbPanMove(e); }}
          onTouchMove={e => {
            // 2 doigts = pinch-zoom dans tous les modes (sauf rogner où le cadre gère)
            if (e.touches.length === 2) { onLbTouchMove(e); return; }
            // 1 doigt : route vers le bon mode
            if (adjustMode) onAdjustTouchMove(e);
            else if (cropMode) onCropTouchMove(e);
            else onLbTouchMove(e);
          }}
          onTouchEnd={() => {
            adjustDragRef.current = null; setAdjustDrag(null);
            setCropDrag(null);
            setLbPanDrag(null);
            pinchRef.current = null;
          }}
          onMouseUp={() => {
            setCropDrag(null);
            // Auto-sauvegarde dès qu'un coin est relâché
            if (adjustDrag && adjustCornersRef.current) {
              const canvas = adjustCanvasRef.current;
              if (canvas) {
                const latestCorners = adjustCornersRef.current;
                if (adjustIsShowroomRef.current && adjustShowroomTransformRef.current) {
                  // Mode showroom : le canvas EST déjà fond+voiture+cache plaque à qualité native
                  const t = adjustShowroomTransformRef.current;
                  const photoCorners   = cornersFromShowroom(latestCorners, t);
                  const newShowroomURL = canvas.toDataURL('image/jpeg', 0.97);
                  const updated = { ...lightbox, corners: photoCorners, showroomDataURL: newShowroomURL };
                  setResults(prev => prev.map(r => r.name === lightbox.name ? updated : r));
                  setLightbox(updated);
                } else {
                  // Mode normal : sauvegarde la photo avec le cache plaque
                  const newDataURL = canvas.toDataURL('image/jpeg', 0.97);
                  const updated = { ...lightbox, processed: newDataURL, corners: latestCorners, ...(manualPlateMode ? { plateFound: true } : {}) };
                  setResults(prev => prev.map(r => r.name === lightbox.name ? updated : r));
                  setLightbox(updated);
                  // Régénère le showroom avec les nouveaux coins si showroom actif
                  if (lightbox.cutoutDataURL && lightbox.showroomBgUrl) {
                    const snap = { ...lightbox, corners: latestCorners };
                    const nudge = showroomNudge;
                    const zoom  = showroomZoom;
                    const wOpts2 = snap.wallLogoSrc ? { src: snap.wallLogoSrc, scale: snap.wallLogoScale, opacity: snap.wallLogoOpacity, x: snap.wallLogoPos?.x ?? 0.5, y: snap.wallLogoPos?.y ?? 0.25 } : null;
                    loadImg(snap.logoPreview).then(logoImgEl =>
                      compositeCarOnBg(snap.cutoutDataURL, snap.showroomBgUrl, 2400, 1350,
                        logoImgEl, latestCorners, snap.bgColor, nudge.x, nudge.y, zoom, true, wOpts2, snap.shadowMatteDataURL, showroomBlend)
                    ).then(sr => {
                      const withSR = { ...updated, showroomDataURL: sr.dataURL, showroomBaseURL: sr.baseURL, showroomTransform: sr.transform, showroomOffset: nudge, showroomZoom: zoom, showroomBlend };
                      setResults(prev => prev.map(r => r.name === snap.name ? withSR : r));
                      setLightbox(prev => prev?.name === snap.name ? withSR : prev);
                    }).catch(e => console.error('showroom regen (adjust):', e));
                  }
                }
              }
            }
            adjustDragRef.current = null;
            setAdjustDrag(null);
            setLbPanDrag(null);
          }}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.93)", zIndex: 1000, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: isMobile ? 8 : 16, userSelect: "none" }}
        >
          {/* ── Bouton fermer fixe (mobile) — toujours accessible même si zoomé ── */}
          {isMobile && (
            <button
              onClick={e => { e.stopPropagation(); closeLightbox(); }}
              style={{ position: "fixed", top: 10, right: 10, zIndex: 1010, width: 36, height: 36, borderRadius: "50%", background: "rgba(20,20,20,0.92)", border: "1px solid #3a3a3a", color: "#ddd", fontSize: 19, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1 }}
            >✕</button>
          )}
          {/* ── Bouton Terminé fixe en bas (mobile + adjust mode) ── */}
          {isMobile && adjustMode && (
            <button
              onClick={e => { e.stopPropagation(); setAdjustMode(false); setAdjustDrag(null); setManualPlateMode(false); }}
              style={{ position: "fixed", bottom: 18, left: "50%", transform: "translateX(-50%)", zIndex: 1010, height: 44, paddingInline: 28, borderRadius: 22, background: "#e8a020", border: "none", color: "#090909", fontSize: 15, fontWeight: 700, fontFamily: "'Rajdhani',sans-serif", letterSpacing: 1, textTransform: "uppercase", cursor: "pointer", boxShadow: "0 4px 16px rgba(0,0,0,0.7)" }}
            >✓ Terminé</button>
          )}
          {/* ── Barre du haut ── */}
          <div onClick={e => e.stopPropagation()} style={{ width: "100%", maxWidth: 1100, display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, padding: isMobile ? "0 44px 0 2px" : "0 2px", gap: 6 }}>
            {!isMobile && <div style={{ fontSize: 11, color: "#ddd", fontFamily: "'JetBrains Mono',monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "40%" }}>{lightbox.name}</div>}
            <div style={{ display: "flex", gap: isMobile ? 6 : 8, alignItems: "center", overflowX: isMobile ? "auto" : "visible", width: isMobile ? "100%" : "auto", justifyContent: isMobile ? "flex-start" : "flex-end", paddingBottom: isMobile ? 4 : 0 }}>

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
                style={{ background: cropMode ? "#f26522" : "#181818", color: cropMode ? "#090909" : "#aaa", border: `1px solid ${cropMode ? "#f26522" : "#2a2a2a"}`, padding: isMobile ? "6px 10px" : "7px 14px", cursor: "pointer", fontFamily: "'Rajdhani',sans-serif", fontSize: isMobile ? 11 : 12, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", borderRadius: 2, minHeight: "unset" }}
              >✂ {isMobile ? "" : "Rogner"}</button>

              {/* Bouton Ajuster — visible seulement si plaque détectée */}
              {lightbox.plateFound && lightbox.corners && (
                <button
                  onClick={e => { e.stopPropagation(); const nm = !adjustMode; if (nm) adjustCornersRef.current = lightbox.corners; setAdjustMode(nm); setManualPlateMode(false); setCropMode(false); setCropDrag(null); setAdjustCorners(lightbox.corners); }}
                  style={{ background: adjustMode ? "#e8a020" : "#181818", color: adjustMode ? "#090909" : "#e8a020", border: `1px solid ${adjustMode ? "#e8a020" : "#3a2800"}`, padding: isMobile ? "6px 10px" : "7px 14px", cursor: "pointer", fontFamily: "'Rajdhani',sans-serif", fontSize: isMobile ? 11 : 12, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", borderRadius: 2, minHeight: "unset" }}
                >⊹ Ajuster</button>
              )}

              {/* Bouton Ajouter cache plaque — visible seulement si plaque NON détectée */}
              {!lightbox.plateFound && !adjustMode && (
                <button
                  onClick={e => {
                    e.stopPropagation();
                    const dc = { tl: { x: 0.35, y: 0.70 }, tr: { x: 0.65, y: 0.70 }, br: { x: 0.65, y: 0.78 }, bl: { x: 0.35, y: 0.78 } };
                    adjustCornersRef.current = dc;
                    setAdjustCorners(dc);
                    setAdjustMode(true);
                    setManualPlateMode(true);
                    setCropMode(false); setCropDrag(null);
                  }}
                  style={{ background: "#181818", color: "#f26522", border: "1px solid #3a1400", padding: isMobile ? "6px 10px" : "7px 14px", cursor: "pointer", fontFamily: "'Rajdhani',sans-serif", fontSize: isMobile ? 11 : 12, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", borderRadius: 2, minHeight: "unset" }}
                >⊕ {isMobile ? "Cache plaque" : "Ajouter cache plaque"}</button>
              )}

              {/* Télécharger / Fermer ajustement */}
              {adjustMode ? (
                <button
                  onClick={e => { e.stopPropagation(); setAdjustMode(false); setAdjustDrag(null); setManualPlateMode(false); }}
                  style={{ background: "#e8a020", color: "#090909", border: "none", padding: isMobile ? "6px 12px" : "7px 18px", cursor: "pointer", fontFamily: "'Rajdhani',sans-serif", fontSize: isMobile ? 12 : 13, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", borderRadius: 2, minHeight: "unset" }}
                >✓ Terminé</button>
              ) : cropMode ? (<>
                <button
                  onClick={e => { e.stopPropagation(); saveCrop(); }}
                  style={{ background: "#2a6b2a", color: "#ddd5c8", border: "1px solid #3a8a3a", padding: isMobile ? "6px 10px" : "7px 14px", cursor: "pointer", fontFamily: "'Rajdhani',sans-serif", fontSize: isMobile ? 11 : 12, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", borderRadius: 2, minHeight: "unset" }}
                >💾 {isMobile ? "" : "Sauvegarder"}</button>
                <button
                  onClick={e => { e.stopPropagation(); downloadCropped(); }}
                  style={{ background: "#f26522", color: "#090909", border: "none", padding: isMobile ? "6px 12px" : "7px 18px", cursor: "pointer", fontFamily: "'Rajdhani',sans-serif", fontSize: isMobile ? 12 : 13, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", borderRadius: 2, minHeight: "unset" }}
                >⬇ {isMobile ? "Rogné" : "Télécharger rogné"}</button>
              </>) : (
                <button
                  onClick={e => { e.stopPropagation(); downloadOne(lightbox); }}
                  style={{ background: "#f26522", color: "#090909", border: "none", padding: isMobile ? "6px 14px" : "7px 18px", cursor: "pointer", fontFamily: "'Rajdhani',sans-serif", fontSize: isMobile ? 12 : 13, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", borderRadius: 2, minHeight: "unset" }}
                >⬇ {isMobile ? "DL" : "Télécharger"}</button>
              )}

              {!isMobile && <button onClick={closeLightbox} style={{ background: "#1e1e1e", color: "#ddd", border: "1px solid #2a2a2a", padding: "7px 14px", cursor: "pointer", fontFamily: "'JetBrains Mono',monospace", fontSize: 15, borderRadius: 2, minHeight: "unset" }}>✕</button>}
            </div>
          </div>

          {/* ── Image + overlay rognage/ajustement ── */}
          <div
            ref={lbContainerRef}
            onClick={e => e.stopPropagation()}
            onWheel={onLbWheel}
            onMouseDown={onLbPanDown}
            onTouchStart={onLbTouchStart}
            onDoubleClick={e => { e.stopPropagation(); setLbZoom(1); setLbPan({ x: 0, y: 0 }); }}
            style={{
              position: "relative", display: "inline-block", maxWidth: "100%",
              borderRadius: 3, border: "1px solid #222", overflow: "hidden", lineHeight: 0,
              touchAction: "none",
              cursor: lbZoom > 1 ? (lbPanDrag ? "grabbing" : "grab") : "default",
            }}
          >
            {/* Indicateur de zoom — cliquable sur mobile pour réinitialiser */}
            {lbZoom > 1.05 && (
              <div
                onClick={isMobile ? (e => { e.stopPropagation(); setLbZoom(1); setLbPan({ x: 0, y: 0 }); }) : undefined}
                style={{ position: "absolute", top: 8, right: isMobile ? 54 : 8, background: "rgba(0,0,0,0.82)", color: "#f26522", fontSize: 11, fontFamily: "'JetBrains Mono',monospace", padding: isMobile ? "5px 10px" : "3px 8px", borderRadius: 2, zIndex: 30, letterSpacing: 1, cursor: isMobile ? "pointer" : "default" }}
              >
                ×{lbZoom.toFixed(1)}{isMobile && " ↩"}
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
                style={{ display: "block", maxWidth: "min(1100px, 100vw - 32px)", maxHeight: "72vh", touchAction: "none" }}
              />
            ) : cropMode ? (
              <canvas
                ref={cropCanvasRef}
                style={{ display: "block", maxWidth: "min(1100px, 100vw - 32px)", maxHeight: "72vh", touchAction: "none" }}
              />
            ) : (
              <img
                ref={cropImgRef}
                src={lightbox.showroomDataURL || lightbox.processed}
                style={{ display: "block", maxWidth: "min(1100px, 100vw - 32px)", maxHeight: "79vh", objectFit: "contain", pointerEvents: "none" }}
              />
            )}

            {/* ── Debug YOLO bbox + corners overlay (only with ?plateDebug in URL) ── */}
            {!cropMode && !adjustMode && !lightbox.showroomDataURL && window.location.search.includes('plateDebug') && lightbox.yoloBbox && lightbox.imgW && (
              <svg
                style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
                viewBox={`0 0 ${lightbox.imgW} ${lightbox.imgH}`}
                preserveAspectRatio="xMidYMid meet"
              >
                {/* Bbox YOLO — vert pointillé */}
                <rect
                  x={lightbox.yoloBbox.x1 * lightbox.imgW} y={lightbox.yoloBbox.y1 * lightbox.imgH}
                  width={(lightbox.yoloBbox.x2 - lightbox.yoloBbox.x1) * lightbox.imgW}
                  height={(lightbox.yoloBbox.y2 - lightbox.yoloBbox.y1) * lightbox.imgH}
                  fill="none" stroke="#22c55e" strokeWidth={Math.max(2, lightbox.imgW * 0.002)}
                  strokeDasharray={`${lightbox.imgW * 0.01} ${lightbox.imgW * 0.005}`}
                />
                {/* bbox_stable (filet axe-aligné) — bleu pointillé, debug
                    uniquement, affiché quand la render geometry est autre
                    chose (pour comparer visuellement le quad précis vs
                    le filet axe-aligné). */}
                {lightbox.yoloRenderSource !== 'bbox_stable'
                  && lightbox.yoloBboxStable
                  && lightbox.yoloBboxStable.length === 4 && (
                  <g opacity={0.40}>
                    <polygon
                      points={lightbox.yoloBboxStable.map(p => `${p.x * lightbox.imgW},${p.y * lightbox.imgH}`).join(' ')}
                      fill="none" stroke="#3b82f6"
                      strokeWidth={Math.max(1, lightbox.imgW * 0.0015)}
                      strokeDasharray={`${lightbox.imgW * 0.005} ${lightbox.imgW * 0.004}`}
                    />
                    <text
                      x={lightbox.yoloBboxStable[0].x * lightbox.imgW + lightbox.imgW * 0.003}
                      y={lightbox.yoloBboxStable[0].y * lightbox.imgH - lightbox.imgH * 0.005}
                      fill="#3b82f6" fontSize={lightbox.imgH * 0.018}
                      fontFamily="monospace" fontWeight="bold">
                      bbox_stable
                    </text>
                  </g>
                )}
                {/* Candidats alternatifs — cyan fin pointillé (debug) */}
                {lightbox.yoloDebug?.candidates && lightbox.yoloDebug.candidates
                  .filter(c => !c.is_final)
                  .map((c, ci) => {
                    const ab = c.method.startsWith('hough') ? 'hough'
                      : c.method.startsWith('approx_poly') ? 'poly'
                      : c.method.startsWith('min_area_rect') ? 'rect'
                      : c.method.startsWith('tightened_bbox') ? 'bbox' : c.method;
                    return (
                      <g key={`alt-lb-${ci}`} opacity={0.55}>
                        <polygon
                          points={c.corners.map(p => `${p.x * lightbox.imgW},${p.y * lightbox.imgH}`).join(' ')}
                          fill="none" stroke="#06b6d4"
                          strokeWidth={Math.max(1, lightbox.imgW * 0.0014)}
                          strokeDasharray={`${lightbox.imgW * 0.004} ${lightbox.imgW * 0.003}`}
                        />
                        <text
                          x={c.corners[0].x * lightbox.imgW + lightbox.imgW * 0.003}
                          y={c.corners[0].y * lightbox.imgH - lightbox.imgH * 0.004}
                          fill="#06b6d4" fontSize={lightbox.imgH * 0.018}
                          fontFamily="monospace" fontWeight="bold">
                          {c.score.toFixed(1)} {ab}
                        </text>
                      </g>
                    );
                  })}
                {/* Quad OpenCV historique (chosen de refine_corners) —
                    debug uniquement, en orange dashed faible opacité, dès
                    qu'il diffère du quad réellement rendu. */}
                {(() => {
                  const oc = lightbox.yoloOpencvCorners;
                  const fc = lightbox.yoloCorners;
                  if (!oc || oc.length !== 4) return null;
                  const differs = !fc || fc.length !== 4
                    || oc.some((p, i) =>
                         Math.abs(p.x - fc[i].x) > 5e-4
                      || Math.abs(p.y - fc[i].y) > 5e-4);
                  if (!differs) return null;
                  // Annotation : pourquoi le chosen historique a été écarté ?
                  // - rejection_reason si on est tombé sur bbox_stable
                  // - promotion_reason si on a promu un autre candidat
                  const annot = lightbox.yoloRejectionReason
                    || lightbox.yoloPromotionReason
                    || '';
                  return (
                    <g opacity={0.40}>
                      <polygon
                        points={oc.map(p => `${p.x * lightbox.imgW},${p.y * lightbox.imgH}`).join(' ')}
                        fill="none" stroke="#f97316"
                        strokeWidth={Math.max(1, lightbox.imgW * 0.0015)}
                        strokeDasharray={`${lightbox.imgW * 0.006} ${lightbox.imgW * 0.004}`}
                      />
                      <text
                        x={oc[0].x * lightbox.imgW + lightbox.imgW * 0.003}
                        y={oc[0].y * lightbox.imgH - lightbox.imgH * 0.005}
                        fill="#f97316" fontSize={lightbox.imgH * 0.018}
                        fontFamily="monospace" fontWeight="bold">
                        rejected_opencv{annot ? ` (${annot})` : ''}
                      </text>
                    </g>
                  );
                })()}
                {/* Quadrilatère final — couleur selon render_source. */}
                {lightbox.yoloCorners && (() => {
                  const src = lightbox.yoloRenderSource || lightbox.yoloSource;
                  // keypoints = vert,
                  // opencv_promoted = lime (OpenCV validé perspective-aware),
                  // bbox_stable = bleu (filet axe-aligné),
                  // (legacy) opencv_fallback = orange,
                  // tightened_bbox = rouge.
                  const stroke = src === 'keypoints'             ? '#22c55e'
                              : src === 'opencv_promoted'       ? '#84cc16'
                              : src === 'front_plate_refined'   ? '#e879f9'
                              : src === 'bbox_stable'           ? '#3b82f6'
                              : src === 'tightened_bbox'        ? '#ef4444'
                              : '#f97316';
                  return (
                    <>
                      <polygon
                        points={lightbox.yoloCorners.map(p => `${p.x * lightbox.imgW},${p.y * lightbox.imgH}`).join(' ')}
                        fill="none" stroke={stroke}
                        strokeWidth={Math.max(2, lightbox.imgW * 0.003)}
                      />
                      {lightbox.yoloCorners.map((p, i) => (
                        <circle key={i} cx={p.x * lightbox.imgW} cy={p.y * lightbox.imgH}
                          r={Math.max(5, lightbox.imgW * 0.006)} fill={stroke} />
                      ))}
                    </>
                  );
                })()}
                {/* Badge confiance + méthode finale */}
                <rect x={lightbox.yoloBbox.x1 * lightbox.imgW} y={lightbox.yoloBbox.y1 * lightbox.imgH - lightbox.imgH * 0.042}
                  width={lightbox.imgW * 0.072} height={lightbox.imgH * 0.038} fill="#22c55e" rx={lightbox.imgW * 0.003} />
                <text x={lightbox.yoloBbox.x1 * lightbox.imgW + lightbox.imgW * 0.005} y={lightbox.yoloBbox.y1 * lightbox.imgH - lightbox.imgH * 0.01}
                  fill="#000" fontSize={lightbox.imgH * 0.026} fontFamily="monospace" fontWeight="bold">
                  {Math.round(lightbox.yoloBbox.conf * 100)}%
                </text>
                {(lightbox.yoloRenderSource || lightbox.yoloSource || lightbox.yoloDebug?.method) && (() => {
                  const src = lightbox.yoloRenderSource || lightbox.yoloSource;
                  const method = lightbox.yoloDebug?.method?.split(':')[0];
                  let label = src === 'keypoints'             ? 'keypoints'
                    : src === 'opencv_promoted'        ? 'opencv_promoted'
                    : src === 'front_plate_refined'    ? 'front_plate_refined'
                    : src === 'bbox_stable'            ? 'bbox_stable'
                    : src === 'tightened_bbox'         ? 'tightened_bbox'
                    : (method === 'hough_lines' ? 'hough' : method) || src || '?';
                  if (src === 'front_plate_refined' && lightbox.yoloFrontPlateTelemetry) {
                    const ft = lightbox.yoloFrontPlateTelemetry;
                    label = `front_plate_refined (shrinkX=${((ft.shrink_x || 0) * 100).toFixed(1)}% shrinkY=${((ft.shrink_y || 0) * 100).toFixed(1)}% AR=${ft.ar || '?'})`;
                  } else if (src === 'opencv_promoted' && lightbox.yoloQuadSource) {
                    label = `opencv_promoted (${lightbox.yoloQuadSource.split(':')[0]})`;
                  } else if (src === 'bbox_stable') {
                    const reason  = (lightbox.yoloRejectionReason || '').split(':').slice(0, 2).join(':');
                    const nm      = lightbox.yoloGateTelemetry?.near_miss;
                    const nmTag   = nm
                      ? `${(nm.method || '').split(':')[0]}:${nm.gate_failed_on || nm.reason || '?'}`
                      : null;
                    label = nmTag
                      ? `bbox_stable — ${reason} [nm:${nmTag}]`
                      : `bbox_stable — ${reason || 'no_reason'}`;
                  }
                  const color = src === 'keypoints'             ? '#22c55e'
                    : src === 'opencv_promoted'        ? '#84cc16'
                    : src === 'front_plate_refined'    ? '#e879f9'
                    : src === 'bbox_stable'            ? '#3b82f6'
                    : src === 'tightened_bbox'         ? '#ef4444'
                    : '#f97316';
                  return (
                    <text x={lightbox.yoloBbox.x1 * lightbox.imgW + lightbox.imgW * 0.078}
                      y={lightbox.yoloBbox.y1 * lightbox.imgH - lightbox.imgH * 0.012}
                      fill={color} fontSize={lightbox.imgH * 0.022}
                      fontFamily="monospace" fontWeight="bold">
                      {label}
                    </text>
                  );
                })()}
              </svg>
            )}

            {/* ── Debug front plate refinement (only with ?debugPlate=front in URL) ── */}
            {!cropMode && !adjustMode && !lightbox.showroomDataURL && window.location.search.includes('debugPlate=front') && lightbox.yoloBbox && lightbox.imgW && (
              <svg
                style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
                viewBox={`0 0 ${lightbox.imgW} ${lightbox.imgH}`}
                preserveAspectRatio="xMidYMid meet"
              >
                {/* YOLO bbox — vert pointillé */}
                <rect
                  x={lightbox.yoloBbox.x1 * lightbox.imgW} y={lightbox.yoloBbox.y1 * lightbox.imgH}
                  width={(lightbox.yoloBbox.x2 - lightbox.yoloBbox.x1) * lightbox.imgW}
                  height={(lightbox.yoloBbox.y2 - lightbox.yoloBbox.y1) * lightbox.imgH}
                  fill="none" stroke="#22c55e" strokeWidth={Math.max(2, lightbox.imgW * 0.002)}
                  strokeDasharray={`${lightbox.imgW * 0.01} ${lightbox.imgW * 0.005}`}
                />
                <text
                  x={lightbox.yoloBbox.x1 * lightbox.imgW + lightbox.imgW * 0.003}
                  y={lightbox.yoloBbox.y1 * lightbox.imgH - lightbox.imgH * 0.006}
                  fill="#22c55e" fontSize={lightbox.imgH * 0.016} fontFamily="monospace" fontWeight="bold">
                  YOLO bbox
                </text>
                {/* bbox_stable — bleu pointillé */}
                {lightbox.yoloBboxStable && lightbox.yoloBboxStable.length === 4 && (
                  <g opacity={0.5}>
                    <polygon
                      points={lightbox.yoloBboxStable.map(p => `${p.x * lightbox.imgW},${p.y * lightbox.imgH}`).join(' ')}
                      fill="none" stroke="#3b82f6"
                      strokeWidth={Math.max(1, lightbox.imgW * 0.0015)}
                      strokeDasharray={`${lightbox.imgW * 0.005} ${lightbox.imgW * 0.004}`}
                    />
                    <text
                      x={lightbox.yoloBboxStable[0].x * lightbox.imgW + lightbox.imgW * 0.003}
                      y={lightbox.yoloBboxStable[0].y * lightbox.imgH - lightbox.imgH * 0.005}
                      fill="#3b82f6" fontSize={lightbox.imgH * 0.016} fontFamily="monospace" fontWeight="bold">
                      bbox_stable
                    </text>
                  </g>
                )}
                {/* Refined quad — magenta solide */}
                {lightbox.yoloRenderSource === 'front_plate_refined' && lightbox.yoloCorners && lightbox.yoloCorners.length === 4 && (
                  <g>
                    <polygon
                      points={lightbox.yoloCorners.map(p => `${p.x * lightbox.imgW},${p.y * lightbox.imgH}`).join(' ')}
                      fill="none" stroke="#e879f9"
                      strokeWidth={Math.max(2, lightbox.imgW * 0.003)}
                    />
                    {lightbox.yoloCorners.map((p, i) => (
                      <circle key={`fp-${i}`} cx={p.x * lightbox.imgW} cy={p.y * lightbox.imgH}
                        r={Math.max(4, lightbox.imgW * 0.005)} fill="#e879f9" />
                    ))}
                    {(() => {
                      const ft = lightbox.yoloFrontPlateTelemetry;
                      if (!ft) return null;
                      const y0 = lightbox.yoloCorners[3].y * lightbox.imgH + lightbox.imgH * 0.012;
                      const x0 = lightbox.yoloCorners[3].x * lightbox.imgW;
                      return (
                        <text x={x0} y={y0}
                          fill="#e879f9" fontSize={lightbox.imgH * 0.015} fontFamily="monospace" fontWeight="bold">
                          front_plate_refined (shrinkX={((ft.shrink_x || 0) * 100).toFixed(1)}% shrinkY={((ft.shrink_y || 0) * 100).toFixed(1)}% AR={ft.ar || '?'})
                        </text>
                      );
                    })()}
                  </g>
                )}
                {/* Front plate detected but failed */}
                {lightbox.yoloFrontPlateDetected && lightbox.yoloRenderSource !== 'front_plate_refined' && (
                  <text
                    x={lightbox.yoloBbox.x1 * lightbox.imgW}
                    y={lightbox.yoloBbox.y2 * lightbox.imgH + lightbox.imgH * 0.025}
                    fill="#f97316" fontSize={lightbox.imgH * 0.015} fontFamily="monospace" fontWeight="bold">
                    front_plate detected but refinement failed: {lightbox.yoloFrontPlateTelemetry?.failed_on || '?'}
                  </text>
                )}
              </svg>
            )}

            {/* ── Overlay Wall Logo : déplacer (centre) + redimensionner (coins) ── */}
            {!cropMode && !adjustMode && lightbox.wallLogoSrc && lightbox.showroomDataURL && (() => {
              const pos = lightbox.wallLogoPos || { x: 0.5, y: 0.25 };
              const s = lightbox.wallLogoScale || 0.18;
              const ratio = lightbox._wallLogoRatio || 0.4; // h/w ratio, sera calculé au chargement
              const halfW = s / 2;
              const halfH = (s * ratio) / 2;
              const left = pos.x - halfW, top = pos.y - halfH;
              const isDragging = !!wallLogoDrag;
              return (
                <div
                  style={{ position: "absolute", inset: 0, zIndex: 5, cursor: isDragging ? "grabbing" : "default" }}
                  onMouseMove={e => {
                    if (!wallLogoDrag) return;
                    const rect = e.currentTarget.getBoundingClientRect();
                    const dx = (e.clientX - wallLogoDrag.startMx) / rect.width;
                    const dy = (e.clientY - wallLogoDrag.startMy) / rect.height;
                    if (wallLogoDrag.type === "move") {
                      const newPos = {
                        x: Math.max(0.02, Math.min(0.98, wallLogoDrag.startPos.x + dx)),
                        y: Math.max(0.02, Math.min(0.98, wallLogoDrag.startPos.y + dy)),
                      };
                      setLightbox(prev => ({ ...prev, wallLogoPos: newPos }));
                    } else {
                      // Resize depuis un coin — on ajuste le scale proportionnellement
                      const corner = wallLogoDrag.type; // "tl","tr","br","bl"
                      const startS = wallLogoDrag.startScale;
                      const signX = corner.includes("r") ? 1 : -1;
                      const signY = corner.includes("b") ? 1 : -1;
                      const delta = (dx * signX + dy * signY) / 2; // moyenne des deux axes
                      const newScale = Math.max(0.04, Math.min(0.50, startS + delta));
                      // Recalcule la position pour ancrer le coin opposé
                      const opp = corner === "tl" ? "br" : corner === "tr" ? "bl" : corner === "br" ? "tl" : "tr";
                      const startPos = wallLogoDrag.startPos;
                      const oldHW = startS / 2, oldHH = (startS * ratio) / 2;
                      const newHW = newScale / 2, newHH = (newScale * ratio) / 2;
                      // Position du coin opposé fixe
                      const oppX = startPos.x + (opp.includes("r") ? oldHW : -oldHW);
                      const oppY = startPos.y + (opp.includes("b") ? oldHH : -oldHH);
                      const newX = oppX + (opp.includes("r") ? -newHW : newHW);
                      const newY = oppY + (opp.includes("b") ? -newHH : newHH);
                      setLightbox(prev => ({ ...prev, wallLogoPos: { x: newX, y: newY }, wallLogoScale: newScale }));
                    }
                  }}
                  onMouseUp={() => {
                    if (wallLogoDrag && lightbox.cutoutDataURL && lightbox.showroomBgUrl) {
                      const prev = lightbox;
                      const nudge = showroomNudge;
                      const zm = showroomZoom;
                      const wOpts = { src: prev.wallLogoSrc, scale: prev.wallLogoScale, opacity: prev.wallLogoOpacity, x: prev.wallLogoPos?.x ?? 0.5, y: prev.wallLogoPos?.y ?? 0.25 };
                      (async () => {
                        try {
                          const logoImgEl = await loadImg(prev.logoPreview);
                          const sr = await compositeCarOnBg(
                            prev.cutoutDataURL, prev.showroomBgUrl, 2400, 1350,
                            logoImgEl, prev.corners, prev.bgColor,
                            nudge.x, nudge.y, zm, true, wOpts, prev.shadowMatteDataURL, showroomBlend
                          );
                          const upd = { ...prev, showroomDataURL: sr.dataURL, showroomBaseURL: sr.baseURL, showroomTransform: sr.transform };
                          setLightbox(upd);
                          setResults(rs => rs.map(r => r.name === prev.name ? upd : r));
                        } catch(e) { console.error('wall logo recomposite error', e); }
                      })();
                    }
                    setWallLogoDrag(null);
                  }}
                >
                  {/* Zone du logo — déplacer en cliquant au centre */}
                  <div
                    onMouseDown={e => {
                      e.preventDefault(); e.stopPropagation();
                      setWallLogoDrag({ type: "move", startMx: e.clientX, startMy: e.clientY, startPos: { ...pos } });
                    }}
                    style={{
                      position: "absolute",
                      left: `${left * 100}%`, top: `${top * 100}%`,
                      width: `${s * 100}%`, height: `${s * ratio * 100}%`,
                      border: isDragging ? "2px solid #f26522" : "1px dashed rgba(242,101,34,0.5)",
                      borderRadius: 2,
                      cursor: isDragging && wallLogoDrag?.type === "move" ? "grabbing" : "grab",
                      background: isDragging ? "rgba(242,101,34,0.06)" : "transparent",
                    }}
                  />
                  {/* 4 poignées de coin pour redimensionner */}
                  {["tl","tr","br","bl"].map(corner => {
                    const cx = corner.includes("r") ? pos.x + halfW : pos.x - halfW;
                    const cy = corner.includes("b") ? pos.y + halfH : pos.y - halfH;
                    const cursor = corner === "tl" || corner === "br" ? "nwse-resize" : "nesw-resize";
                    return (
                      <div
                        key={corner}
                        onMouseDown={e => {
                          e.preventDefault(); e.stopPropagation();
                          setWallLogoDrag({ type: corner, startMx: e.clientX, startMy: e.clientY, startPos: { ...pos }, startScale: s });
                        }}
                        style={{
                          position: "absolute",
                          left: `${cx * 100}%`, top: `${cy * 100}%`,
                          width: 10, height: 10,
                          background: "#f26522", border: "2px solid #fff",
                          borderRadius: "50%", transform: "translate(-50%,-50%)",
                          cursor, zIndex: 10,
                          boxShadow: "0 0 4px rgba(0,0,0,0.7)",
                        }}
                      />
                    );
                  })}
                </div>
              );
            })()}

            {/* ── Overlay Ajuster : 4 points oranges draggables ── */}
            {adjustMode && adjustCorners && (
              <div style={{ position: "absolute", inset: 0, cursor: adjustDrag ? "grabbing" : "crosshair", touchAction: "none" }}>
                {manualPlateMode && !adjustDrag && (
                  <div style={{ position: "absolute", bottom: 10, left: "50%", transform: "translateX(-50%)", background: "rgba(0,0,0,0.75)", color: "#f26522", fontSize: 11, fontFamily: "'JetBrains Mono',monospace", padding: "5px 12px", borderRadius: 3, letterSpacing: 1, whiteSpace: "nowrap", pointerEvents: "none" }}>
                    Glisser ✥ pour positionner · coins oranges pour ajuster · ✓ Terminé pour valider
                  </div>
                )}
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
                {[["tl","nwse-resize"],["tr","nesw-resize"],["br","nwse-resize"],["bl","nesw-resize"]].map(([corner, cur]) => {
                  const isDragging = adjustDrag?.corner === corner;
                  const sz = isMobile ? 14 : 12;
                  return <div
                    key={corner}
                    onMouseDown={e => startAdjustDrag(e, corner)}
                    onTouchStart={e => { e.preventDefault(); e.stopPropagation(); if (e.touches[0]) startAdjustDragAt(e.touches[0].clientX, e.touches[0].clientY, corner); }}
                    style={{
                      position: "absolute",
                      left: `${adjustCorners[corner].x * 100}%`,
                      top:  `${adjustCorners[corner].y * 100}%`,
                      width: sz, height: sz,
                      background: isDragging ? "transparent" : "#e8a020",
                      border: isDragging ? "2px solid rgba(255,255,255,0.25)" : "2px solid #fff",
                      borderRadius: "50%",
                      transform: "translate(-50%,-50%)",
                      cursor: cur,
                      zIndex: 10,
                      touchAction: "none",
                      boxShadow: isDragging ? "none" : "0 0 5px rgba(0,0,0,0.8)",
                      transition: "background 0.05s, border 0.05s",
                    }}
                  />;
                })}
                {/* Poignée centrale — déplace toute la plaque d'un bloc (mode pose manuelle uniquement) */}
                {manualPlateMode && (() => {
                  const cx = (adjustCorners.tl.x + adjustCorners.tr.x + adjustCorners.br.x + adjustCorners.bl.x) / 4;
                  const cy = (adjustCorners.tl.y + adjustCorners.tr.y + adjustCorners.br.y + adjustCorners.bl.y) / 4;
                  const isMoving = adjustDrag?.corner === 'center';
                  return (
                    <div
                      onMouseDown={e => startAdjustDrag(e, 'center')}
                      onTouchStart={e => { e.preventDefault(); e.stopPropagation(); if (e.touches[0]) startAdjustDragAt(e.touches[0].clientX, e.touches[0].clientY, 'center'); }}
                      title="Déplacer la plaque"
                      style={{
                        position: "absolute",
                        left: `${cx * 100}%`, top: `${cy * 100}%`,
                        width: isMobile ? 24 : 22, height: isMobile ? 24 : 22,
                        background: isMoving ? "rgba(242,101,34,0.4)" : "rgba(242,101,34,0.85)",
                        border: "2px solid #fff",
                        borderRadius: "50%",
                        transform: "translate(-50%,-50%)",
                        cursor: isMoving ? "grabbing" : "move",
                        zIndex: 11,
                        touchAction: "none",
                        boxShadow: "0 0 7px rgba(0,0,0,0.9)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: isMobile ? 14 : 12, color: "#fff", fontWeight: 700, lineHeight: 1,
                        userSelect: "none",
                      }}
                    >✥</div>
                  );
                })()}
              </div>
            )}

            {cropMode && (
              <div style={{ position: "absolute", inset: 0, cursor: cropDrag?.type === "move" ? "grabbing" : "default", touchAction: "none" }}>
                {/* Zones sombres hors sélection */}
                <div style={{ position: "absolute", inset: 0, pointerEvents: "none", background: `linear-gradient(to bottom, rgba(0,0,0,0.6) ${cropBox.y*100}%, transparent ${cropBox.y*100}%, transparent ${(cropBox.y+cropBox.h)*100}%, rgba(0,0,0,0.6) ${(cropBox.y+cropBox.h)*100}%)` }} />
                <div style={{ position: "absolute", top: `${cropBox.y*100}%`, height: `${cropBox.h*100}%`, left: 0, width: `${cropBox.x*100}%`, background: "rgba(0,0,0,0.6)", pointerEvents: "none" }} />
                <div style={{ position: "absolute", top: `${cropBox.y*100}%`, height: `${cropBox.h*100}%`, right: 0, width: `${(1-cropBox.x-cropBox.w)*100}%`, background: "rgba(0,0,0,0.6)", pointerEvents: "none" }} />

                {/* Rectangle de rognage (déplacer) */}
                <div
                  onMouseDown={e => startCropDrag(e, "move")}
                  onTouchStart={e => { e.preventDefault(); e.stopPropagation(); if (e.touches.length === 1 && e.touches[0]) startCropDragAt(e.touches[0].clientX, e.touches[0].clientY, "move"); }}
                  style={{ position: "absolute", left: `${cropBox.x*100}%`, top: `${cropBox.y*100}%`, width: `${cropBox.w*100}%`, height: `${cropBox.h*100}%`, border: "2px solid #f26522", cursor: "move", boxSizing: "border-box", touchAction: "none" }}
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
                    <div
                      key={type}
                      onMouseDown={e => startCropDrag(e, type)}
                      onTouchStart={e => { e.preventDefault(); e.stopPropagation(); if (e.touches.length === 1 && e.touches[0]) startCropDragAt(e.touches[0].clientX, e.touches[0].clientY, type); }}
                      style={{ position: "absolute", left, top, width: isMobile ? 22 : 14, height: isMobile ? 22 : 14, background: "#f26522", transform: "translate(-50%,-50%)", cursor: cur, borderRadius: 2, zIndex: 2, touchAction: "none" }} />
                  ))}
                </div>
              </div>
            )}
            </div>{/* fin calque zoomé */}
          </div>

          {/* ── Jauge d'inclinaison (mode Rogner) ── */}
          {cropMode && (
            <div onClick={e => e.stopPropagation()} style={{ width: "100%", maxWidth: "min(1100px, 100vw - 32px)", marginTop: 10, padding: "10px 16px 8px", background: "#161616", border: "1px solid #222", borderRadius: 3 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 7 }}>
                <span style={{ fontSize: 11, letterSpacing: 2, textTransform: "uppercase", color: "#ddd", fontFamily: "'JetBrains Mono',monospace" }}>Inclinaison</span>
                <span style={{ fontSize: 12, color: "#f26522", fontFamily: "'JetBrains Mono',monospace" }}>
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
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, fontSize: 10, color: "#ddd", fontFamily: "'JetBrains Mono',monospace" }}>
                <span>−180°</span><span>0°</span><span>+180°</span>
              </div>
            </div>
          )}

          {/* ── Flèches repositionnement showroom (masquées après rognage) ── */}
          {lightbox.cutoutDataURL && lightbox.showroomDataURL && !cropMode && !adjustMode && (
            <div onClick={e => e.stopPropagation()} style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 1010 }}>
              {/* Style commun flèche */}
              {[
                { dir: "up",    dx: 0,          dy: -NUDGE_STEP, label: "▲", style: { top: "8%",  left: "50%", transform: "translateX(-50%)" } },
                { dir: "down",  dx: 0,          dy:  NUDGE_STEP, label: "▼", style: { bottom: "8%", left: "50%", transform: "translateX(-50%)" } },
                { dir: "left",  dx: -NUDGE_STEP, dy: 0,          label: "◀", style: { left: "2%",  top: "50%",  transform: "translateY(-50%)" } },
                { dir: "right", dx:  NUDGE_STEP, dy: 0,          label: "▶", style: { right: "2%", top: "50%",  transform: "translateY(-50%)" } },
              ].map(({ dir, dx, dy, label, style }) => (
                <button
                  key={dir}
                  onClick={e => { e.stopPropagation(); nudgeShowroom(dx, dy); }}
                  disabled={showroomNudging}
                  style={{
                    position: "fixed",
                    ...style,
                    pointerEvents: "all",
                    width: 52, height: 52,
                    borderRadius: "50%",
                    background: showroomNudging ? "rgba(30,30,30,0.6)" : "rgba(242,101,34,0.82)",
                    border: "2px solid rgba(255,255,255,0.18)",
                    color: "#fff",
                    fontSize: 21,
                    cursor: showroomNudging ? "not-allowed" : "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    boxShadow: "0 2px 12px rgba(0,0,0,0.7)",
                    transition: "background 0.15s",
                    zIndex: 1010,
                  }}
                >{showroomNudging ? "…" : label}</button>
              ))}
            </div>
          )}

          {/* ── Slider zoom showroom (masqué après rognage) ── */}
          {lightbox.cutoutDataURL && lightbox.showroomDataURL && !cropMode && !adjustMode && (
            <div
              onClick={e => e.stopPropagation()}
              style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 52, width: "min(500px, 90vw)" }}
            >
              <span style={{ fontSize: 17, userSelect: "none" }}>🔍</span>
              <span style={{ fontSize: 11, color: "#ddd", letterSpacing: 1.5, textTransform: "uppercase", fontFamily: "'JetBrains Mono',monospace", userSelect: "none", whiteSpace: "nowrap" }}>
                Agrandir la taille
              </span>
              <input
                type="range"
                min="0.5" max="2.5" step="0.05"
                value={showroomZoom}
                onChange={e => onZoomChange(parseFloat(e.target.value))}
                style={{ flex: 1, accentColor: "#f26522", cursor: "pointer", height: 4, touchAction: "pan-x" }}
              />
              <span style={{ fontSize: 11, color: "#f26522", fontFamily: "'JetBrains Mono',monospace", minWidth: 34, textAlign: "right" }}>
                ×{showroomZoom.toFixed(2)}
              </span>
              {showroomNudging && <span style={{ fontSize: 11, color: "#ddd", fontFamily: "'JetBrains Mono',monospace" }}>…</span>}
            </div>
          )}

          {/* ── Slider fondu voiture/décor (masqué après rognage) ── */}
          {lightbox.cutoutDataURL && lightbox.showroomDataURL && !cropMode && !adjustMode && (
            <div
              onClick={e => e.stopPropagation()}
              style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8, width: "min(500px, 90vw)" }}
              title="Fond la voiture dans le décor en abaissant luminosité, contraste et saturation"
            >
              <span style={{ fontSize: 17, userSelect: "none" }}>🎨</span>
              <span style={{ fontSize: 11, color: "#ddd", letterSpacing: 1.5, textTransform: "uppercase", fontFamily: "'JetBrains Mono',monospace", userSelect: "none", whiteSpace: "nowrap" }}>
                Fondre le véhicule au décor
              </span>
              <input
                type="range"
                min="0" max="100" step="1"
                value={showroomBlend}
                onChange={e => onBlendChange(parseInt(e.target.value, 10))}
                style={{ flex: 1, accentColor: "#f26522", cursor: "pointer", height: 4, touchAction: "pan-x" }}
              />
              <span style={{ fontSize: 11, color: "#f26522", fontFamily: "'JetBrains Mono',monospace", minWidth: 34, textAlign: "right" }}>
                {showroomBlend}%
              </span>
            </div>
          )}

          {/* ── Corriger le détourage (mask editor) ── */}
          {lightbox.cutoutDataURL && lightbox.showroomDataURL && !cropMode && !adjustMode && !showMaskEditor && (
            <div onClick={e => e.stopPropagation()} style={{ marginTop: 6, display: 'flex', justifyContent: 'center' }}>
              <button
                onClick={() => setShowMaskEditor(true)}
                style={{
                  padding: '6px 16px', background: 'rgba(30,30,30,0.85)', color: '#dde0e5',
                  border: '1px solid #444', borderRadius: 6, cursor: 'pointer', fontSize: 12,
                  fontFamily: "'JetBrains Mono',monospace", letterSpacing: 0.5,
                  transition: 'all 0.15s',
                }}
                onMouseEnter={e => { e.target.style.background = '#374151'; e.target.style.color = '#fff'; }}
                onMouseLeave={e => { e.target.style.background = 'rgba(30,30,30,0.85)'; e.target.style.color = '#d1d5db'; }}
              >
                Corriger le detourage
              </button>
            </div>
          )}

          {/* ── MaskEditor overlay ── */}
          {showMaskEditor && lightbox.cutoutDataURL && (
            <MaskEditor
              cutoutDataURL={lightbox.cutoutDataURL}
              originalDataURL={lightbox.baseDataURL || lightbox.cutoutDataURL}
              onApply={async (correctedDataURL) => {
                setShowMaskEditor(false);
                try {
                  // Recompute shadow from corrected mask
                  const cutImg = await loadImg(correctedDataURL);
                  const cW = cutImg.naturalWidth || cutImg.width;
                  const cH = cutImg.naturalHeight || cutImg.height;
                  const scanC = document.createElement('canvas');
                  scanC.width = cW; scanC.height = cH;
                  scanC.getContext('2d').drawImage(cutImg, 0, 0);
                  const px = scanC.getContext('2d').getImageData(0, 0, cW, cH).data;
                  let carL = cW, carR = 0, carT = cH, carB = 0;
                  for (let y = 0; y < cH; y++)
                    for (let x = 0; x < cW; x++)
                      if (px[(y * cW + x) * 4 + 3] > 128) {
                        if (x < carL) carL = x; if (x > carR) carR = x;
                        if (y < carT) carT = y; if (y > carB) carB = y;
                      }
                  const carBounds = { x: carL, y: carT, w: carR - carL, h: carB - carT };
                  // Respect the "Ombres au sol" choice: don't resurrect a shadow
                  // the user disabled when they re-edit the mask.
                  const newShadow = showroomFloorShadow
                    ? await generateShadowFromCarAlpha(correctedDataURL, carBounds, lightbox.yoloBbox ?? null)
                    : null;
                  // Recomposite
                  const wOpts = lightbox.wallLogoSrc ? {
                    src: lightbox.wallLogoSrc,
                    scale: lightbox.wallLogoScale ?? 0.18,
                    opacity: lightbox.wallLogoOpacity ?? 0.85,
                    x: lightbox.wallLogoPos?.x ?? 0.5,
                    y: lightbox.wallLogoPos?.y ?? 0.25,
                  } : null;
                  const sr = await compositeCarOnBg(
                    correctedDataURL, lightbox.showroomBgUrl, 2400, 1350,
                    null, null, lightbox.bgColor || '#ffffff',
                    0, 0, 1.0, true, wOpts, newShadow, showroomBlend
                  );
                  // Update lightbox state
                  setLightbox(prev => ({
                    ...prev,
                    cutoutDataURL: correctedDataURL,
                    shadowMatteDataURL: newShadow,
                    showroomDataURL: sr.dataURL,
                    showroomBaseURL: sr.baseURL,
                    showroomTransform: sr.transform,
                    carBoundsCache: carBounds,
                  }));
                  // Update results array
                  setResults(prev => prev.map((r, i) => i === lightbox.index ? {
                    ...r,
                    cutoutDataURL: correctedDataURL,
                    shadowMatteDataURL: newShadow,
                    showroomDataURL: sr.dataURL,
                    showroomBaseURL: sr.baseURL,
                    showroomTransform: sr.transform,
                    carBoundsCache: carBounds,
                  } : r));
                  console.log('[MaskEditor] applied correction, regenerated shadow + composite');
                } catch (e) {
                  console.error('[MaskEditor] recomposite failed:', e);
                }
              }}
              onCancel={() => setShowMaskEditor(false)}
            />
          )}

          {/* ── Shadow adjustment sliders (debug only: ?showroomDebug=shadowControls) ── */}
          {lightbox.cutoutDataURL && lightbox.showroomDataURL && !cropMode && !adjustMode && getShowroomDebugMode() === 'shadowControls' && (
            <div
              onClick={e => e.stopPropagation()}
              style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10, width: "min(500px, 90vw)", background: "rgba(10,10,10,0.85)", border: "1px solid #222", borderRadius: 4, padding: "10px 14px" }}
            >
              <div style={{ fontSize: 9, letterSpacing: 2, color: "#ddd", textTransform: "uppercase", fontFamily: "'JetBrains Mono',monospace", marginBottom: 2 }}>Ombre</div>
              {[
                { label: "Opacité", param: "opacity", value: shadowOpacity, min: 0, max: 1, step: 0.05 },
                { label: "Flou", param: "blur", value: shadowBlur, min: 0, max: 40, step: 1 },
                { label: "Décalage Y", param: "yOffset", value: shadowYOffset, min: -20, max: 20, step: 1 },
                { label: "Étendue", param: "spread", value: shadowSpread, min: 0.5, max: 2.0, step: 0.05 },
              ].map(({ label, param, value, min, max, step }) => (
                <div key={param} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 10, color: "#ddd", fontFamily: "'JetBrains Mono',monospace", minWidth: 64 }}>{label}</span>
                  <input type="range" min={min} max={max} step={step} value={value}
                    onChange={e => onShadowParamChange(param, parseFloat(e.target.value))}
                    style={{ flex: 1, accentColor: "#f26522", height: 3, cursor: "pointer", touchAction: "pan-x" }}
                  />
                  <span style={{ fontSize: 10, color: "#f26522", fontFamily: "'JetBrains Mono',monospace", minWidth: 30, textAlign: "right" }}>
                    {param === "blur" || param === "yOffset" ? value.toFixed(0) : value.toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* ── Pied ── */}
          <div style={{ marginTop: 8, fontSize: 10, color: "#ddd", fontFamily: "'JetBrains Mono',monospace", textAlign: "center" }}>
            {adjustMode
              ? "Glisser un point orange pour repositionner le coin · Le résultat s'applique en temps réel"
              : cropMode
              ? "Inclinaison · Glisser la zone · Coins oranges pour redimensionner · 💾 Sauvegarder"
              : lightbox.showroomDataURL
              ? "Flèches pour déplacer · 🔍 pour zoomer la voiture · Sauvegarde auto · Cliquer en dehors pour fermer"
              : lbZoom > 1
              ? "Molette pour zoomer · Glisser pour se déplacer · Double-clic pour réinitialiser"
              : "Molette pour zoomer · ✂ Rogner · ⊹ Ajuster · Cliquer en dehors pour fermer"}
          </div>
        </div>
      )}

      {/* ── Modal Info Lustrage Optique Pro ── */}
      {showHeadlightInfoModal && (
        <div onClick={() => setShowHeadlightInfoModal(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.82)", zIndex: 9000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: "#141414", border: "1px solid #2a2a2a", borderRadius: 8, padding: isMobile ? "24px 16px" : "36px 40px", maxWidth: 440, width: "92%", fontFamily: "'Rajdhani',sans-serif" }}>
            <div style={{ textAlign: "center", marginBottom: 20 }}>
              <span style={{ fontSize: 33 }}>💡</span>
              <div style={{ fontSize: 19, fontWeight: 700, letterSpacing: 2, color: "#f26522", textTransform: "uppercase", marginTop: 8 }}>Lustrage Optique Pro</div>
            </div>
            <div style={{ fontSize: 13, color: "#ddd", lineHeight: 1.7, fontFamily: "'JetBrains Mono',monospace", marginBottom: 8 }}>
              Le mode <span style={{ color: "#f26522", fontWeight: 700 }}>Lustrage Optique Pro</span> utilise l'intelligence artificielle pour restaurer les optiques jaunies de vos véhicules.
            </div>
            <div style={{ fontSize: 12, color: "#ddd", lineHeight: 1.7, fontFamily: "'JetBrains Mono',monospace", marginBottom: 24 }}>
              <div style={{ marginBottom: 6 }}>⏱ Le temps de traitement est plus long qu'un traitement classique.</div>
              <div>📸 Les résultats sont nettement meilleurs sur les <span style={{ color: "#e0dbd4", fontWeight: 700 }}>photos de face</span>.</div>
            </div>
            <label
              onClick={() => {
                const next = !headlightInfoDismissed;
                setHeadlightInfoDismissed(next);
                localStorage.setItem('headlightInfoDismissed', next ? '1' : '0');
              }}
              style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", marginBottom: 24, padding: "10px 12px", background: "#0a0a0a", border: "1px solid #1c1c1c", borderRadius: 4 }}>
              <div style={{ width: 14, height: 14, borderRadius: 3, border: `2px solid ${headlightInfoDismissed ? "#f26522" : "#444"}`, background: headlightInfoDismissed ? "#f26522" : "transparent", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                {headlightInfoDismissed && <span style={{ color: "#090909", fontSize: 11, fontWeight: 900, lineHeight: 1 }}>✓</span>}
              </div>
              <span style={{ fontSize: 11, color: "#ddd", fontFamily: "'JetBrains Mono',monospace", letterSpacing: 0.5 }}>Ne plus afficher ce message</span>
            </label>
            <button
              onClick={() => setShowHeadlightInfoModal(false)}
              style={{ width: "100%", background: "#f26522", color: "#090909", border: "none", padding: "13px 0", fontFamily: "'Rajdhani',sans-serif", fontSize: 15, fontWeight: 700, letterSpacing: 3, textTransform: "uppercase", borderRadius: 3, cursor: "pointer" }}>
              OK
            </button>
          </div>
        </div>
      )}

      {/* ── Modal Limite Lustrage Optique Pro ── */}
      {showHeadlightBatchModal && (
        <div onClick={() => setShowHeadlightBatchModal(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.82)", zIndex: 9000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: "#141414", border: "1px solid #2a2a2a", borderRadius: 8, padding: isMobile ? "24px 16px" : "36px 40px", maxWidth: 440, width: "92%", fontFamily: "'Rajdhani',sans-serif" }}>
            <div style={{ textAlign: "center", marginBottom: 20 }}>
              <span style={{ fontSize: 33 }}>📸</span>
              <div style={{ fontSize: 19, fontWeight: 700, letterSpacing: 2, color: "#f26522", textTransform: "uppercase", marginTop: 8 }}>Limite de photos</div>
            </div>
            <div style={{ fontSize: 13, color: "#ddd", lineHeight: 1.8, fontFamily: "'JetBrains Mono',monospace", marginBottom: 24 }}>
              Lorsque le mode <span style={{ color: "#f26522", fontWeight: 700 }}>Lustrage Optique Pro</span> est activé, vous pouvez sélectionner <span style={{ color: "#e0dbd4", fontWeight: 700 }}>2 photos maximum</span> par traitement.
              <div style={{ marginTop: 10, color: "#ddd" }}>Veuillez réduire votre sélection à 2 photos pour continuer.</div>
            </div>
            <button
              onClick={() => setShowHeadlightBatchModal(false)}
              style={{ width: "100%", background: "#f26522", color: "#090909", border: "none", padding: "13px 0", fontFamily: "'Rajdhani',sans-serif", fontSize: 15, fontWeight: 700, letterSpacing: 3, textTransform: "uppercase", borderRadius: 3, cursor: "pointer" }}>
              Compris
            </button>
          </div>
        </div>
      )}

      {/* ── Modal Nous Contacter ── */}
      {showContactModal && (
        <div onClick={() => setShowContactModal(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.82)", zIndex: 9000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: "#111", border: "1px solid #222", borderRadius: 6, width: "92%", maxWidth: 420, fontFamily: "'Rajdhani',sans-serif" }}>
            <div style={{ padding: "20px 24px 16px", borderBottom: "1px solid #1c1c1c", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ fontSize: 12, letterSpacing: 3, color: "#f26522", textTransform: "uppercase", fontFamily: "'JetBrains Mono',monospace" }}>Nous contacter</div>
              <button onClick={() => setShowContactModal(false)} style={{ background: "none", border: "none", color: "#ddd", fontSize: 21, cursor: "pointer", lineHeight: 1 }}>✕</button>
            </div>
            <div style={{ padding: "20px 24px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
              {[
                { icon: "✉", label: "E-mail", value: "contact.asgs29200@gmail.com", href: "mailto:contact.asgs29200@gmail.com" },
                { icon: "📞", label: "Téléphone", value: "07 56 98 17 29", href: "tel:+33756981729" },
              ].map(({ icon, label, value, href }) => (
                <a key={label} href={href}
                  style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 16px", background: "#0a0a0a", border: "1px solid #1c1c1c", borderRadius: 4, textDecoration: "none", cursor: "pointer" }}>
                  <span style={{ fontSize: 21 }}>{icon}</span>
                  <div>
                    <div style={{ fontSize: 11, color: "#ddd", letterSpacing: 2, textTransform: "uppercase", fontFamily: "'JetBrains Mono',monospace", marginBottom: 3 }}>{label}</div>
                    <div style={{ fontSize: 16, color: "#ddd5c8", fontWeight: 700, letterSpacing: 0.5 }}>{value}</div>
                  </div>
                </a>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Modal Mini-jeu (hors chargement) ── */}
      {showMiniGame && (
        <div onClick={() => setShowMiniGame(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.88)", zIndex: 9000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: "#111", border: "1px solid #222", borderRadius: 6, padding: "20px 24px 24px", fontFamily: "'Rajdhani',sans-serif" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <div style={{ fontSize: 12, letterSpacing: 3, color: "#f26522", textTransform: "uppercase", fontFamily: "'JetBrains Mono',monospace" }}>
                Mini-jeu
              </div>
              <button onClick={() => setShowMiniGame(false)} style={{ background: "none", border: "none", color: "#ddd", fontSize: 21, cursor: "pointer", lineHeight: 1 }}>✕</button>
            </div>
            <LoadingGame />
          </div>
        </div>
      )}

      {/* ── Modal Mes Informations ── */}
      {showProfileModal && (() => {
        const meta = user?.user_metadata ?? {};
        const planLabel = { trial: "Essai gratuit", essential: "Essentiel", pro: "Pro" }[meta.plan ?? "trial"] ?? "Essai gratuit";
        const photosUsed = meta.photos_used ?? 0;
        const joined = user?.created_at ? new Date(user.created_at).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" }) : "—";
        const rows = [
          { label: "Nom / Entreprise",      value: meta.full_name ?? "—" },
          { label: "Adresse e-mail",         value: user?.email ?? "—" },
          { label: "Téléphone",              value: meta.phone ?? "—" },
          { label: "Adresse de facturation", value: meta.billing_address ?? "—" },
          { label: "Plan actuel",            value: planLabel },
          { label: "Photos utilisées",       value: `${photosUsed} / ${PLAN_LIMIT}` },
          { label: "Membre depuis",          value: joined },
        ];
        return (
          <div onClick={() => setShowProfileModal(false)}
            style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.82)", zIndex: 9000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
            <div onClick={e => e.stopPropagation()}
              style={{ background: "#111", border: "1px solid #222", borderRadius: 6, width: "92%", maxWidth: 480, fontFamily: "'Rajdhani',sans-serif" }}>
              {/* Header */}
              <div style={{ padding: "20px 24px 16px", borderBottom: "1px solid #1c1c1c", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                  <div style={{ fontSize: 12, letterSpacing: 3, color: "#f26522", textTransform: "uppercase", fontFamily: "'JetBrains Mono',monospace", marginBottom: 4 }}>Mes informations</div>
                  <div style={{ fontSize: 14, color: "#ddd" }}>Données personnelles associées à votre compte</div>
                </div>
                <button onClick={() => setShowProfileModal(false)} style={{ background: "none", border: "none", color: "#ddd", fontSize: 21, cursor: "pointer", lineHeight: 1 }}>✕</button>
              </div>
              {/* Rows */}
              <div style={{ padding: "8px 0 16px" }}>
                {rows.map(({ label, value }) => (
                  <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 24px", borderBottom: "1px solid #161616" }}>
                    <span style={{ fontSize: 13, color: "#ddd", letterSpacing: 1, textTransform: "uppercase", fontFamily: "'JetBrains Mono',monospace" }}>{label}</span>
                    <span style={{ fontSize: 15, color: value === "—" ? "#333" : "#ddd5c8", fontWeight: 600, maxWidth: 260, textAlign: "right", wordBreak: "break-all" }}>{value}</span>
                  </div>
                ))}
              </div>
              {/* Footer note */}
              <div style={{ padding: "12px 24px", borderTop: "1px solid #1c1c1c" }}>
                <div style={{ fontSize: 12, color: "#ddd", fontFamily: "'JetBrains Mono',monospace", lineHeight: 1.6 }}>
                  Pour modifier vos informations, contactez-nous à <span style={{ color: "#f26522" }}>contact@autocache.fr</span>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Modal Code Promo ── */}
      {showPromoModal && (
        <div onClick={() => setShowPromoModal(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 9000, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: "#141414", border: "1px solid #2a2a2a", borderRadius: 6, padding: isMobile ? "24px 20px" : "36px 40px", maxWidth: 400, width: "92%", fontFamily: "'Rajdhani',sans-serif" }}>
            <div style={{ fontSize: 21, fontWeight: 700, letterSpacing: 2, color: "#e0dbd4", marginBottom: 6, textTransform: "uppercase" }}>Code Promo</div>
            <div style={{ fontSize: 11, color: "#ddd", fontFamily: "'JetBrains Mono',monospace", marginBottom: 20 }}>Entrez votre code pour débloquer des photos supplémentaires.</div>
            <input
              value={promoCode} onChange={e => { setPromoCode(e.target.value); setPromoStatus(null); setPromoMsg(""); }}
              onKeyDown={e => e.key === "Enter" && promoCode.trim() && promoStatus !== "loading" && submitPromo()}
              placeholder="Votre code promo"
              style={{ width: "100%", boxSizing: "border-box", padding: "11px 14px", background: "#1a1a1a", border: `1px solid ${promoStatus === "error" ? "#c0392b" : promoStatus === "success" ? "#27ae60" : "#2a2a2a"}`, borderRadius: 3, color: "#ddd5c8", fontFamily: "'JetBrains Mono',monospace", fontSize: 16, letterSpacing: 3, textTransform: "uppercase", outline: "none", marginBottom: 10 }}
            />
            {promoMsg && (
              <div style={{ fontSize: 11, fontFamily: "'JetBrains Mono',monospace", color: promoStatus === "success" ? "#27ae60" : "#c0392b", marginBottom: 14, letterSpacing: 1 }}>
                {promoMsg}
              </div>
            )}
            <button
              onClick={submitPromo}
              disabled={!promoCode.trim() || promoStatus === "loading" || promoStatus === "success"}
              style={{ width: "100%", background: promoStatus === "success" ? "#27ae60" : (!promoCode.trim() || promoStatus === "loading") ? "#1a1a1a" : "#f26522", color: promoStatus === "success" ? "#fff" : (!promoCode.trim() || promoStatus === "loading") ? "#444" : "#090909", border: "none", padding: "13px 0", fontFamily: "'Rajdhani',sans-serif", fontSize: 15, fontWeight: 700, letterSpacing: 3, textTransform: "uppercase", borderRadius: 3, cursor: promoStatus === "loading" || promoStatus === "success" ? "default" : "pointer", marginBottom: 10 }}>
              {promoStatus === "loading" ? "Vérification..." : promoStatus === "success" ? "Code activé ✓" : "Activer"}
            </button>
            <button onClick={() => setShowPromoModal(false)}
              style={{ width: "100%", background: "transparent", color: "#ddd", border: "1px solid #2a2a2a", padding: "9px 0", fontFamily: "'JetBrains Mono',monospace", fontSize: 11, letterSpacing: 2, textTransform: "uppercase", borderRadius: 3, cursor: "pointer" }}>
              Fermer
            </button>
          </div>
        </div>
      )}

      {/* ── Modal Plans & Abonnements ── */}
      {showPlansModal && (
        <div onClick={() => setShowPlansModal(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.82)", zIndex: 9000, display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: "#141414", border: "1px solid #2a2a2a", borderRadius: 8, padding: isMobile ? "20px 14px" : "36px 40px", maxWidth: userPlan === "trial" ? 740 : 480, width: "92%", fontFamily: "'Rajdhani',sans-serif" }}>

            {userPlan === "trial" ? (
              /* ── Vue comparaison des plans (utilisateurs en essai) ── */
              <>
                <div style={{ textAlign: "center", marginBottom: 32 }}>
                  <div style={{ fontSize: 23, fontWeight: 700, letterSpacing: 3, color: "#e0dbd4", textTransform: "uppercase" }}>Nos Abonnements</div>
                  <div style={{ fontSize: 11, color: "#ddd", fontFamily: "'JetBrains Mono',monospace", marginTop: 6, letterSpacing: 1 }}>
                    Plan actuel : <span style={{ color: "#f26522" }}>Essai gratuit</span>
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 16, marginBottom: 28 }}>
                  {[
                    {
                      key: "essential",
                      name: "Essentiel",
                      price: "14,90 €",
                      badge: null,
                      features: [
                        { ok: true,  label: "Cache plaque personnalisé" },
                        { ok: true,  label: "Logo importé ou généré" },
                        { ok: true,  label: "Ajustements couleurs" },
                        { ok: true,  label: "Amélioration automatique" },
                        { ok: false, label: "Lustrage Optique Pro" },
                        { ok: false, label: "Showroom Virtuel (fonds IA)" },
                        { ok: false, label: "Enseigne murale" },
                      ],
                    },
                    {
                      key: "pro",
                      name: "Pro",
                      price: "24,90 €",
                      badge: "Recommandé",
                      features: [
                        { ok: true, label: "Cache plaque personnalisé" },
                        { ok: true, label: "Logo importé ou généré" },
                        { ok: true, label: "Ajustements couleurs" },
                        { ok: true, label: "Amélioration automatique" },
                        { ok: true, label: "Lustrage Optique Pro" },
                        { ok: true, label: "Showroom Virtuel (fonds IA)" },
                        { ok: true, label: "Enseigne murale" },
                      ],
                    },
                  ].map(plan => {
                    const isPro = plan.key === "pro";
                    return (
                      <div key={plan.key}
                        onMouseEnter={() => setHoveredPlan(plan.key)}
                        onMouseLeave={() => setHoveredPlan(null)}
                        style={{ background: isPro ? "rgba(242,101,34,0.05)" : "#0e0e0e", border: `1px solid ${isPro ? "#f26522" : "#2a2a2a"}`, borderRadius: 6, padding: "24px 22px", position: "relative", transform: hoveredPlan === plan.key ? "scale(1.03)" : "scale(1)", transition: "transform 0.15s ease" }}>
                        {plan.badge && (
                          <div style={{ position: "absolute", top: -10, left: "50%", transform: "translateX(-50%)", background: "#f26522", color: "#090909", fontSize: 9, fontWeight: 700, letterSpacing: 2, padding: "3px 10px", borderRadius: 10, fontFamily: "'JetBrains Mono',monospace", textTransform: "uppercase", whiteSpace: "nowrap" }}>{plan.badge}</div>
                        )}
                        <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: 2, color: isPro ? "#f26522" : "#aaa", textTransform: "uppercase", marginBottom: 4 }}>{plan.name}</div>
                        <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginBottom: 2 }}>
                          <span style={{ fontSize: 23, fontWeight: 700, color: isPro ? "#f26522" : "#ccc" }}>{plan.price}</span>
                          <span style={{ fontSize: 10, color: "#ddd", fontFamily: "'JetBrains Mono',monospace", letterSpacing: 1 }}>/mois</span>
                        </div>
                        <div style={{ marginBottom: 20, marginTop: 14 }}>
                          {plan.features.map((f, i) => (
                            <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 7 }}>
                              <span style={{ fontSize: 12, color: f.ok ? "#27ae60" : "#444", flexShrink: 0 }}>{f.ok ? "✓" : "✕"}</span>
                              <span style={{ fontSize: 11, color: f.ok ? "#bbb" : "#444", fontFamily: "'JetBrains Mono',monospace", letterSpacing: 0.5 }}>{f.label}</span>
                            </div>
                          ))}
                        </div>
                        <button
                          disabled={checkoutLoading === plan.key}
                          onClick={async () => {
                            setCheckoutLoading(plan.key);
                            try {
                              const res = await fetch("/api/create-checkout-session", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ plan: plan.key, userId: user.id, userEmail: user.email }),
                              });
                              const data = await res.json();
                              if (data.url) window.location.href = data.url;
                              else alert("Erreur lors de la création du paiement.");
                            } catch (e) {
                              alert("Erreur réseau, réessayez.");
                            } finally {
                              setCheckoutLoading(null);
                            }
                          }}
                          style={{ width: "100%", background: isPro ? "#f26522" : "transparent", color: isPro ? "#090909" : "#777", border: `1px solid ${isPro ? "#f26522" : "#333"}`, padding: "10px 0", fontFamily: "'Rajdhani',sans-serif", fontSize: 13, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", borderRadius: 3, cursor: "pointer" }}>
                          {checkoutLoading === plan.key ? "Redirection..." : `Choisir ${plan.name}`}
                        </button>
                      </div>
                    );
                  })}
                </div>

                <button onClick={() => setShowPlansModal(false)}
                  style={{ width: "100%", background: "transparent", color: "#ddd", border: "1px solid #2a2a2a", padding: "9px 0", fontFamily: "'JetBrains Mono',monospace", fontSize: 11, letterSpacing: 2, textTransform: "uppercase", borderRadius: 3, cursor: "pointer" }}>
                  Fermer
                </button>
              </>
            ) : (
              /* ── Vue gestion abonnement (utilisateurs abonnés) ── */
              <>
                {/* En-tête */}
                <div style={{ textAlign: "center", marginBottom: 32 }}>
                  <div style={{ fontSize: 23, fontWeight: 700, letterSpacing: 3, color: "#e0dbd4", textTransform: "uppercase" }}>Mon Abonnement</div>
                  <div style={{ fontSize: 11, color: "#ddd", fontFamily: "'JetBrains Mono',monospace", marginTop: 6, letterSpacing: 1 }}>
                    Plan actif : <span style={{ color: "#f26522", fontWeight: 700 }}>
                      {userPlan === "pro" ? "Pro" : "Essentiel"}
                    </span>
                  </div>
                </div>

                {/* Badge plan */}
                <div style={{ background: userPlan === "pro" ? "rgba(242,101,34,0.08)" : "#0e0e0e", border: `1px solid ${userPlan === "pro" ? "#f26522" : "#2a2a2a"}`, borderRadius: 6, padding: "20px 24px", marginBottom: 20, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div>
                    <div style={{ fontSize: 19, fontWeight: 700, letterSpacing: 2, color: userPlan === "pro" ? "#f26522" : "#ccc", textTransform: "uppercase" }}>
                      {userPlan === "pro" ? "Pro" : "Essentiel"}
                    </div>
                    <div style={{ fontSize: 10, color: "#ddd", fontFamily: "'JetBrains Mono',monospace", marginTop: 4, letterSpacing: 1 }}>
                      {userPlan === "pro" ? "Toutes les fonctionnalités incluses" : "Fonctionnalités de base"}
                    </div>
                  </div>
                  <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#27ae60", boxShadow: "0 0 6px #27ae60" }} />
                </div>

                {/* Bouton upgrade (Essentiel → Pro) */}
                {userPlan === "essential" && (
                  <button
                    disabled={portalLoading === "upgrade"}
                    onClick={async () => {
                      setPortalLoading("upgrade");
                      try {
                        const res = await fetch("/api/create-checkout-session", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ plan: "pro", userId: user.id, userEmail: user.email }),
                        });
                        const data = await res.json();
                        if (data.url) window.location.href = data.url;
                        else alert("Erreur lors de la création du paiement.");
                      } catch (e) {
                        alert("Erreur réseau, réessayez.");
                      } finally {
                        setPortalLoading(null);
                      }
                    }}
                    style={{ width: "100%", background: "#f26522", color: "#090909", border: "none", padding: "13px 0", fontFamily: "'Rajdhani',sans-serif", fontSize: 14, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", borderRadius: 3, cursor: "pointer", marginBottom: 10 }}>
                    {portalLoading === "upgrade" ? "Redirection..." : "Améliorer vers Pro"}
                  </button>
                )}

                {/* Bouton Factures */}
                {(() => {
                  const openPortal = async (action) => {
                    setPortalError("");
                    setPortalLoading(action);
                    try {
                      const res = await fetch("/api/customer-portal", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ userId: user.id }),
                      });
                      const data = await res.json();
                      if (data.url) {
                        window.location.href = data.url;
                      } else {
                        setPortalError(data.error || "Impossible d'accéder au portail.");
                      }
                    } catch (e) {
                      setPortalError("Erreur réseau, réessayez.");
                    } finally {
                      setPortalLoading(null);
                    }
                  };
                  return (
                    <>
                      <button
                        disabled={!!portalLoading}
                        onClick={() => openPortal("invoices")}
                        style={{ width: "100%", background: "transparent", color: "#ddd", border: "1px solid #333", padding: "12px 0", fontFamily: "'Rajdhani',sans-serif", fontSize: 14, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", borderRadius: 3, cursor: !!portalLoading ? "wait" : "pointer", marginBottom: 10 }}>
                        {portalLoading === "invoices" ? "Ouverture..." : "Factures & Historique"}
                      </button>

                      {portalError && (
                        <div style={{ fontSize: 11, color: "#c0392b", fontFamily: "'JetBrains Mono',monospace", marginBottom: 10, padding: "8px 12px", background: "rgba(192,57,43,0.08)", border: "1px solid rgba(192,57,43,0.2)", borderRadius: 3 }}>
                          ⚠ {portalError}
                        </div>
                      )}

                      <button onClick={() => { setShowPlansModal(false); setPortalError(""); }}
                        style={{ width: "100%", background: "transparent", color: "#ddd", border: "1px solid #1e1e1e", padding: "9px 0", fontFamily: "'JetBrains Mono',monospace", fontSize: 11, letterSpacing: 2, textTransform: "uppercase", borderRadius: 3, cursor: "pointer", marginBottom: 24 }}>
                        Fermer
                      </button>

                      <div style={{ borderTop: "1px solid #1a1a1a", paddingTop: 18, textAlign: "center" }}>
                        <button
                          disabled={!!portalLoading}
                          onClick={() => openPortal("cancel")}
                          style={{ background: "transparent", color: "#ddd", border: "none", fontFamily: "'JetBrains Mono',monospace", fontSize: 10, letterSpacing: 1, textTransform: "uppercase", cursor: !!portalLoading ? "wait" : "pointer", textDecoration: "underline" }}>
                          {portalLoading === "cancel" ? "Ouverture..." : "Résilier l'abonnement"}
                        </button>
                      </div>
                    </>
                  );
                })()}
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Modal upgrade Pro (showroom) ── */}
      {showUpgradeProModal && (
        <div onClick={() => setShowUpgradeProModal(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 9000, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: "#141414", border: "1px solid #f26522", borderRadius: 6, padding: isMobile ? "24px 16px" : "36px 40px", maxWidth: 420, width: "92%", textAlign: "center", fontFamily: "'Rajdhani',sans-serif" }}>
            <div style={{ fontSize: 33, marginBottom: 12 }}>⬡</div>
            <div style={{ fontSize: 21, fontWeight: 700, letterSpacing: 2, color: "#e0dbd4", marginBottom: 4, textTransform: "uppercase" }}>Showroom Virtuel</div>
            <div style={{ fontSize: 12, color: "#f26522", letterSpacing: 2, fontFamily: "'JetBrains Mono',monospace", marginBottom: 16, textTransform: "uppercase" }}>Abonnement Pro requis</div>
            <div style={{ fontSize: 14, color: "#ddd", lineHeight: 1.7, marginBottom: 28, fontFamily: "'JetBrains Mono',monospace" }}>
              Le mode Showroom Virtuel — détourage IA et fonds de showroom — est inclus dans l'abonnement <span style={{ color: "#f26522", fontWeight: 700 }}>Pro</span>.<br /><br />
              Contactez-nous pour mettre votre compte à niveau.
            </div>
            <button onClick={() => { setShowUpgradeProModal(false); window.open("mailto:contact@autocache.fr?subject=Abonnement Pro AutoCache", "_blank"); }}
              style={{ width: "100%", background: "#f26522", color: "#090909", border: "none", padding: "13px 0", fontFamily: "'Rajdhani',sans-serif", fontSize: 15, fontWeight: 700, letterSpacing: 3, textTransform: "uppercase", borderRadius: 3, cursor: "pointer", marginBottom: 10 }}>
              Passer à l'abonnement Pro
            </button>
            <button onClick={() => setShowUpgradeProModal(false)}
              style={{ width: "100%", background: "transparent", color: "#ddd", border: "1px solid #2a2a2a", padding: "9px 0", fontFamily: "'JetBrains Mono',monospace", fontSize: 11, letterSpacing: 2, textTransform: "uppercase", borderRadius: 3, cursor: "pointer" }}>
              Fermer
            </button>
          </div>
        </div>
      )}

      {/* ── Modal upgrade (essai épuisé) ── */}
      {showUpgradeModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.88)", zIndex: 9000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: "#141414", border: "1px solid #2a2a2a", borderRadius: 8, padding: isMobile ? "20px 14px" : "36px 40px", maxWidth: 740, width: "92%", fontFamily: "'Rajdhani',sans-serif" }}>

            {/* En-tête */}
            <div style={{ textAlign: "center", marginBottom: 28 }}>
              <div style={{ fontSize: 14, color: "#c0392b", fontFamily: "'JetBrains Mono',monospace", letterSpacing: 2, textTransform: "uppercase", marginBottom: 8 }}>Essai gratuit terminé</div>
              <div style={{ fontSize: 23, fontWeight: 700, letterSpacing: 3, color: "#e0dbd4", textTransform: "uppercase", marginBottom: 10 }}>Continuez à sublimer vos photos</div>
              <div style={{ fontSize: 12, color: "#ddd", fontFamily: "'JetBrains Mono',monospace", lineHeight: 1.7 }}>
                Vous avez utilisé vos <span style={{ color: "#f26522" }}>30 photos d'essai</span>.<br />
                Choisissez un abonnement pour continuer à traiter vos photos sans limite.
              </div>
            </div>

            {/* Cartes plans */}
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 16, marginBottom: 24 }}>
              {[
                {
                  key: "essential",
                  name: "Essentiel",
                  price: "14,90€",
                  badge: null,
                  features: [
                    { ok: true,  label: "200 photos / mois" },
                    { ok: true,  label: "Cache plaque personnalisé" },
                    { ok: true,  label: "Logo importé ou généré" },
                    { ok: true,  label: "Ajustements couleurs" },
                    { ok: false, label: "Lustrage Optique Pro" },
                    { ok: false, label: "Showroom Virtuel (fonds IA)" },
                    { ok: false, label: "Enseigne murale" },
                  ],
                },
                {
                  key: "pro",
                  name: "Pro",
                  price: "24,90€",
                  badge: "Recommandé",
                  features: [
                    { ok: true, label: "250 photos / mois" },
                    { ok: true, label: "Cache plaque personnalisé" },
                    { ok: true, label: "Logo importé ou généré" },
                    { ok: true, label: "Ajustements couleurs" },
                    { ok: true, label: "Lustrage Optique Pro" },
                    { ok: true, label: "Showroom Virtuel (fonds IA)" },
                    { ok: true, label: "Enseigne murale" },
                  ],
                },
              ].map(plan => {
                const isPro = plan.key === "pro";
                return (
                  <div key={plan.key}
                    onMouseEnter={() => setHoveredPlan(`trial-${plan.key}`)}
                    onMouseLeave={() => setHoveredPlan(null)}
                    style={{ background: isPro ? "rgba(242,101,34,0.05)" : "#0e0e0e", border: `1px solid ${isPro ? "#f26522" : "#2a2a2a"}`, borderRadius: 6, padding: "22px 20px", position: "relative", transform: hoveredPlan === `trial-${plan.key}` ? "scale(1.03)" : "scale(1)", transition: "transform 0.15s ease" }}>
                    {plan.badge && (
                      <div style={{ position: "absolute", top: -10, left: "50%", transform: "translateX(-50%)", background: "#f26522", color: "#090909", fontSize: 9, fontWeight: 700, letterSpacing: 2, padding: "3px 10px", borderRadius: 10, fontFamily: "'JetBrains Mono',monospace", textTransform: "uppercase", whiteSpace: "nowrap" }}>{plan.badge}</div>
                    )}
                    <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: 2, color: isPro ? "#f26522" : "#aaa", textTransform: "uppercase", marginBottom: 2 }}>{plan.name}</div>
                    <div style={{ fontSize: 19, fontWeight: 700, color: "#e0dbd4", marginBottom: 14, fontFamily: "'JetBrains Mono',monospace" }}>{plan.price}<span style={{ fontSize: 11, color: "#ddd", fontWeight: 400 }}> /mois</span></div>
                    <div style={{ marginBottom: 18 }}>
                      {plan.features.map((f, i) => (
                        <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                          <span style={{ fontSize: 12, color: f.ok ? "#27ae60" : "#444", flexShrink: 0 }}>{f.ok ? "✓" : "✕"}</span>
                          <span style={{ fontSize: 11, color: f.ok ? "#bbb" : "#444", fontFamily: "'JetBrains Mono',monospace" }}>{f.label}</span>
                        </div>
                      ))}
                    </div>
                    <button
                      disabled={checkoutLoading === plan.key}
                      onClick={async () => {
                        setCheckoutLoading(plan.key);
                        try {
                          const res = await fetch("/api/create-checkout-session", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ plan: plan.key, userId: user.id, userEmail: user.email }),
                          });
                          const data = await res.json();
                          if (data.url) window.location.href = data.url;
                          else alert("Erreur lors de la création du paiement.");
                        } catch { alert("Erreur réseau, réessayez."); }
                        finally { setCheckoutLoading(null); }
                      }}
                      style={{ width: "100%", background: isPro ? "#f26522" : "transparent", color: isPro ? "#090909" : "#888", border: `1px solid ${isPro ? "#f26522" : "#333"}`, padding: "10px 0", fontFamily: "'Rajdhani',sans-serif", fontSize: 13, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", borderRadius: 3, cursor: "pointer" }}>
                      {checkoutLoading === plan.key ? "Redirection..." : `Choisir ${plan.name}`}
                    </button>
                  </div>
                );
              })}
            </div>

            <button onClick={() => setShowUpgradeModal(false)}
              style={{ width: "100%", background: "transparent", color: "#ddd", border: "1px solid #222", padding: "9px 0", fontFamily: "'JetBrains Mono',monospace", fontSize: 11, letterSpacing: 2, textTransform: "uppercase", borderRadius: 3, cursor: "pointer" }}>
              Fermer
            </button>
          </div>
        </div>
      )}

      {/* ── Overlay chargement ── */}
      {processing && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(10,10,10,0.92)", zIndex: 9000, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 20, overflowY: "auto", padding: "32px 16px" }}>
          <span className="ac-spinner" style={{ width: 52, height: 52, borderTop: "5px solid #f26522", borderRight: "5px solid #f26522", borderBottom: "5px solid #f26522", borderLeft: "5px solid transparent", borderRadius: "50%", display: "inline-block" }} />
          <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12, color: "#f26522", letterSpacing: 3, textTransform: "uppercase" }}>
            Traitement {progress.n} / {progress.total}
          </div>
          <div style={{ width: 200, height: 2, background: "#1e1e1e", borderRadius: 1, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${pct}%`, background: "#f26522", transition: "width 0.4s ease" }} />
          </div>
          {/* Mini-jeu d'esquive pour patienter pendant le traitement */}
          <LoadingGame />
        </div>
      )}

      {/* ── Didacticiel interactif ── */}
      {showTutorial && (
        <Tutorial onClose={closeTutorial} isMobile={isMobile} />
      )}

      {/* ── Bouton d'aide flottant (bas-gauche) ── */}
      <HelpWidget
        isMobile={isMobile}
        hidden={showTutorial}
        onOpenTutorial={() => setShowTutorial(true)}
        onOpenContact={() => setShowContactModal(true)}
      />
    </div>
  );
}
