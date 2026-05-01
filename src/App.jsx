import { useState, useRef, useEffect } from "react";
// @imgly/background-removal chargé dynamiquement (uniquement si showroom activé)
let removeBgImgly = null;
import { createClient } from "@supabase/supabase-js";

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
function drawPerspective(ctx, img, tl, tr, br, bl) {
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  // Nombre de bandes adaptatif : au moins 1 bande par pixel de hauteur (min 120, max 400)
  const outH = Math.max(
    Math.abs(bl.y - tl.y), Math.abs(br.y - tr.y),
    Math.hypot(bl.x - tl.x, bl.y - tl.y), Math.hypot(br.x - tr.x, br.y - tr.y)
  );
  const STEPS = Math.max(120, Math.min(400, Math.ceil(outH)));
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  for (let i = 0; i < STEPS; i++) {
    // Chevauchement de 1.5px entre bandes pour éliminer tout gap visible
    const overlap = 1.5 / outH;
    const t1 = Math.max(0, i / STEPS - overlap), t2 = Math.min(1, (i + 1) / STEPS + overlap), tm = (i + 0.5) / STEPS;
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
function autoEnhance(ctx, W, H) {
  const id = ctx.getImageData(0, 0, W, H);
  const d  = id.data;

  // Courbe S légère : creuse les ombres, préserve les hautes lumières
  const sCurve = v => v < 0.5
    ? 0.5 * Math.pow(v * 2, 1.20)          // ombres assombries
    : 1 - 0.5 * Math.pow((1 - v) * 2, 0.85); // hautes lumières légèrement relevées

  // LUT par canal : refroidissement WB + courbe S
  // R : −12 %  (retire la dominante rouge/chaude)
  // G : −4  %  (neutre-froid)
  // B : +13 %  (bleu acier → lumière neutre 6000 K)
  const rLUT = new Uint8Array(256);
  const gLUT = new Uint8Array(256);
  const bLUT = new Uint8Array(256);
  for (let v = 0; v < 256; v++) {
    const t = v / 255;
    rLUT[v] = Math.min(255, Math.max(0, Math.round(sCurve(t * 0.88) * 255)));
    gLUT[v] = Math.min(255, Math.max(0, Math.round(sCurve(t * 0.96) * 255)));
    bLUT[v] = Math.min(255, Math.max(0, Math.round(sCurve(Math.min(1, t * 1.13)) * 255)));
  }

  // Application LUT + boost saturation (+20 %)
  const SAT = 1.20;
  for (let i = 0; i < d.length; i += 4) {
    let r = rLUT[d[i]];
    let g = gLUT[d[i + 1]];
    let b = bLUT[d[i + 2]];
    const lum = r * 0.299 + g * 0.587 + b * 0.114;
    d[i]     = Math.max(0, Math.min(255, Math.round(lum + (r - lum) * SAT)));
    d[i + 1] = Math.max(0, Math.min(255, Math.round(lum + (g - lum) * SAT)));
    d[i + 2] = Math.max(0, Math.min(255, Math.round(lum + (b - lum) * SAT)));
  }
  ctx.putImageData(id, 0, 0);
}

// ── Détection des phares via GPT-4o-mini ─────────────────────────────────────
// ── Lustrage des optiques — correction canvas ciblée ─────────────────────────
// Approche fiable : détection de la zone phare via GPT-4o-mini, puis correction
// colorimétrique canvas sur ces zones uniquement. Résultat garanti = même voiture.

async function detectHeadlights(b64) {
  try {
    const r = await fetch("/api/headlights", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ b64 }),
    });
    const data = await r.json();
    const lights = Array.isArray(data.lights) ? data.lights : [];
    console.log(`[Headlights] ${lights.length} phare(s) détecté(s)`, lights);
    return lights;
  } catch(e) {
    console.error("[Headlights] Erreur détection:", e);
    return [];
  }
}

// Correction colorimétrique d'une zone rectangulaire du canvas.
// Cible les pixels jaunes/ambrés (jaunissement UV) et les ramène vers neutre/clair.
function correctHeadlightZone(ctx, x, y, zw, zh) {
  const id = ctx.getImageData(x, y, zw, zh);
  const d = id.data;
  for (let k = 0; k < d.length; k += 4) {
    const r = d[k], g = d[k+1], b = d[k+2];
    const lum = r * 0.299 + g * 0.587 + b * 0.114;

    // Teinte ambre/jaune (jaunissement UV)
    const warmth = Math.max(0, r * 0.55 + g * 0.45 - b) / 255;
    if (warmth < 0.04) continue;

    // Saturation HSV
    const cMax = Math.max(r, g, b), cMin = Math.min(r, g, b);
    const delta = cMax - cMin;
    const sat = cMax > 0 ? delta / cMax : 0;

    // Teinte (0–360°)
    let hue = 0;
    if (delta > 4) {
      if (cMax === r)      hue = 60 * (((g - b) / delta) % 6);
      else if (cMax === g) hue = 60 * ((b - r) / delta + 2);
      else                 hue = 60 * ((r - g) / delta + 4);
      if (hue < 0) hue += 360;
    }

    // Cibler jaune/ambre : 8°–80°, saturation > 8%, lum moyenne
    if (hue < 8 || hue > 80) continue;
    if (sat < 0.08 || lum < 20 || lum > 245) continue;

    // Intensité de correction proportionnelle au jaunissement
    const blend = Math.min(0.82, warmth * 4.5 * Math.min(1.0, sat * 2.0));
    if (blend < 0.06) continue;

    // Cible : gris neutre (correction de teinte uniquement, pas de blanchiment)
    const tR = lum * 0.97;
    const tG = lum * 1.01;
    const tB = lum * 1.03;

    let nR = r + (tR - r) * blend;
    let nG = g + (tG - g) * blend;
    let nB = b + (tB - b) * blend;

    // Légère clarté uniquement sur pixels fortement jaunes (warmth élevé)
    const clarity = Math.max(0, warmth - 0.08) * blend * 1.2;
    nR += (255 - nR) * clarity;
    nG += (255 - nG) * clarity;
    nB += (255 - nB) * clarity;

    d[k]   = Math.max(0, Math.min(255, Math.round(nR)));
    d[k+1] = Math.max(0, Math.min(255, Math.round(nG)));
    d[k+2] = Math.max(0, Math.min(255, Math.round(nB)));
  }
  ctx.putImageData(id, x, y);
}

async function aiPolishHeadlights(ctx, W, H, b64Original) {
  // Passe unique globale — traite tous les phares de façon identique
  correctHeadlightZone(ctx, 0, 0, W, H);
  console.log("[Headlights] Lustrage terminé ✓");
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

// Suppression de fond — moteur IA local @imgly/background-removal
// Modèle ONNX (~40 MB) téléchargé une seule fois par le navigateur puis mis en cache.
// Traite à 2000 px → netteté réelle vs 500 px max du plan gratuit remove.bg.
// Précharge le modèle ONNX en arrière-plan (appelé dès que le mode showroom est activé)
async function preloadRemoveBg() {
  if (!removeBgImgly) {
    const mod = await import("@imgly/background-removal");
    removeBgImgly = mod.removeBackground;
  }
}

async function removeBackground(dataUrl) {
  // Import dynamique — le modèle ONNX (~40 MB) n'est téléchargé qu'au premier appel
  if (!removeBgImgly) {
    const mod = await import("@imgly/background-removal");
    removeBgImgly = mod.removeBackground;
  }
  // Réduit à 2000 px pour équilibrer qualité / temps de traitement
  const small  = await shrinkDataUrl(dataUrl, 2000, 0.96);
  const blob   = await fetch(small).then(r => r.blob());
  // Modèle "medium" : ~2× plus rapide que "large", qualité identique sur silhouettes de voitures
  const result = await removeBgImgly(blob, {
    model: 'medium',
    output: { format: 'image/png', quality: 1.0 },
  });
  // Convertit le Blob PNG résultant en data URL persistable
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(result);
  });
}

// Composite : pose la voiture découpée sur le fond de showroom
// logoImg + corners + bgColor permettent de redessiner le cache plaque en qualité native
// offsetX / offsetY permettent de repositionner la voiture après génération (flèches)
async function compositeCarOnBg(cutoutDataUrl, bgDataUrl, W, H, logoImg = null, corners = null, bgColor = '#ffffff', offsetX = 0, offsetY = 0, zoom = 1.0, returnFull = false, wallLogoOpts = null) {
  const loads = [loadImg(bgDataUrl), loadImg(cutoutDataUrl)];
  if (wallLogoOpts?.src) loads.push(loadImg(wallLogoOpts.src));
  const [bgImg, carImg, wallImg] = await Promise.all(loads);
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
  const carX = (W - cw) / 2 + offsetX;
  const carY = H * 0.82 - ch + offsetY; // bas de la voiture ancré à 82 % de la hauteur

  // Trouver le bas réel de la voiture (dernier pixel non-transparent du cutout)
  // pour éviter un écart entre l'ombre et les pneus
  let actualBottomFrac = 1.0;
  try {
    const scanC = document.createElement('canvas');
    scanC.width = carImg.width; scanC.height = carImg.height;
    const scanCtx = scanC.getContext('2d');
    scanCtx.drawImage(carImg, 0, 0);
    const imgData = scanCtx.getImageData(0, 0, carImg.width, carImg.height);
    const data = imgData.data;
    let lastRow = carImg.height - 1;
    for (let y = carImg.height - 1; y >= 0; y--) {
      let hasPixel = false;
      for (let x = 0; x < carImg.width; x++) {
        if (data[(y * carImg.width + x) * 4 + 3] > 20) { hasPixel = true; break; }
      }
      if (hasPixel) { lastRow = y; break; }
    }
    actualBottomFrac = (lastRow + 1) / carImg.height;
  } catch (_) { /* fallback to 1.0 */ }

  // Ombre réaliste deux couches — proportionnelle à la voiture
  const shadowCX = carX + cw / 2;
  const shadowCY = carY + actualBottomFrac * ch;

  // Couche 1 : ombre diffuse large (lumière ambiante, bords très doux)
  const rx1 = cw * 0.50;
  const ry1 = ch * 0.058;
  const sy1 = ry1 / rx1;
  const grad1 = ctx.createRadialGradient(shadowCX, shadowCY, 0, shadowCX, shadowCY, rx1);
  grad1.addColorStop(0,    'rgba(0,0,0,0.20)');
  grad1.addColorStop(0.40, 'rgba(0,0,0,0.12)');
  grad1.addColorStop(0.72, 'rgba(0,0,0,0.04)');
  grad1.addColorStop(1,    'rgba(0,0,0,0)');
  ctx.save();
  ctx.transform(1, 0, 0, sy1, 0, shadowCY * (1 - sy1));
  ctx.fillStyle = grad1;
  ctx.beginPath();
  ctx.arc(shadowCX, shadowCY, rx1, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Couche 2 : ombre de contact étroite (zone de contact pneus/sol, plus sombre)
  const rx2 = cw * 0.38;
  const ry2 = ch * 0.020;
  const sy2 = ry2 / rx2;
  const grad2 = ctx.createRadialGradient(shadowCX, shadowCY, 0, shadowCX, shadowCY, rx2);
  grad2.addColorStop(0,    'rgba(0,0,0,0.52)');
  grad2.addColorStop(0.38, 'rgba(0,0,0,0.28)');
  grad2.addColorStop(0.70, 'rgba(0,0,0,0.07)');
  grad2.addColorStop(1,    'rgba(0,0,0,0)');
  ctx.save();
  ctx.transform(1, 0, 0, sy2, 0, shadowCY * (1 - sy2));
  ctx.fillStyle = grad2;
  ctx.beginPath();
  ctx.arc(shadowCX, shadowCY, rx2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  // Voiture (sans drop shadow générique)
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(carImg, carX, carY, cw, ch);
  ctx.restore();
  // Snapshot avant plaque (pour Ajuster en mode showroom)
  const baseURL = returnFull ? c.toDataURL('image/jpeg', 0.97) : null;
  // Cache plaque redessiné en qualité native (corners normalisés 0-1 → pixels composite)
  if (logoImg && corners) {
    const mp = p => ({ x: carX + p.x * cw, y: carY + p.y * ch });
    const ptl = mp(corners.tl), ptr = mp(corners.tr);
    const pbr = mp(corners.br), pbl = mp(corners.bl);
    // Fond opaque sous le logo pour masquer la plaque d'origine sur le cutout
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(ptl.x, ptl.y); ctx.lineTo(ptr.x, ptr.y);
    ctx.lineTo(pbr.x, pbr.y); ctx.lineTo(pbl.x, pbl.y);
    ctx.closePath(); ctx.fillStyle = bgColor; ctx.fill();
    ctx.restore();
    drawPerspective(ctx, logoImg, ptl, ptr, pbr, pbl);
    const tmp = document.createElement('canvas');
    tmp.width = c.width; tmp.height = c.height;
    const tCtx = tmp.getContext('2d');
    tCtx.filter = 'saturate(1.15) contrast(1.08)';
    tCtx.drawImage(c, 0, 0);
    tCtx.filter = 'none';
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(ptl.x, ptl.y); ctx.lineTo(ptr.x, ptr.y);
    ctx.lineTo(pbr.x, pbr.y); ctx.lineTo(pbl.x, pbl.y);
    ctx.closePath(); ctx.clip();
    ctx.drawImage(tmp, 0, 0);
    ctx.restore();
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
    console.log(`YOLO bbox: (${b.x1.toFixed(3)},${b.y1.toFixed(3)})-(${b.x2.toFixed(3)},${b.y2.toFixed(3)}) conf=${d.conf}`);
    if (d.corners) console.log('Corners raffinés:', d.corners.map(p => `(${p.x.toFixed(3)},${p.y.toFixed(3)})`).join(' '));
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

async function processPhoto(photoFile, logoImg, adj, bgColor = "#ffffff", enhance = false, headlightPolish = false, useGptAngle = false, floorClean = false, enhancePro = false, bodyPolish = false) {
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
  // Amélioration couleurs (canvas)
  if (enhance || enhancePro) autoEnhance(ctx, c.width, c.height);
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
    // Priorité aux coins OpenCV raffinés (perspective), sinon fallback bbox YOLO
    if (yolo.corners && yolo.corners.length === 4) {
      savedCorners = { tl: yolo.corners[0], tr: yolo.corners[1], br: yolo.corners[2], bl: yolo.corners[3] };
    } else {
      const b = yolo.bbox;
      savedCorners = { tl: { x: b.x1, y: b.y1 }, tr: { x: b.x2, y: b.y1 }, br: { x: b.x2, y: b.y2 }, bl: { x: b.x1, y: b.y2 } };
    }
  }

  if (false && savedCorners && logoImg) {
    const toPixel = p => ({ x: p.x * c.width, y: p.y * c.height });
    const ptl = toPixel(savedCorners.tl), ptr = toPixel(savedCorners.tr);
    const pbr = toPixel(savedCorners.br), pbl = toPixel(savedCorners.bl);

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
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
    const tmp = document.createElement('canvas');
    tmp.width = c.width; tmp.height = c.height;
    const tCtx = tmp.getContext('2d');
    tCtx.filter = 'saturate(1.15) contrast(1.08)';
    tCtx.drawImage(c, 0, 0);
    tCtx.filter = 'none';
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(ptl.x, ptl.y); ctx.lineTo(ptr.x, ptr.y);
    ctx.lineTo(pbr.x, pbr.y); ctx.lineTo(pbl.x, pbl.y);
    ctx.closePath(); ctx.clip();
    ctx.drawImage(tmp, 0, 0);
    ctx.restore();
  }
  const yoloBbox    = yolo?.bbox    ? { ...yolo.bbox, conf: yolo.conf } : null;
  const yoloCorners = yolo?.corners ?? null;
  const yoloDebug   = yolo?.debug   ?? null;
  return { name: photoFile.name, processed: c.toDataURL("image/jpeg", 0.97), plateFound, baseDataURL, corners: savedCorners, yoloBbox, yoloCorners, yoloDebug, imgW: c.width, imgH: c.height };
}

const Slider = ({ label, value, min, max, step, onChange }) => (
  <div style={{ marginBottom: 18 }}>
    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 7 }}>
      <span style={{ fontSize: 10, letterSpacing: 2, textTransform: "uppercase", color: "#999", fontFamily: "'JetBrains Mono',monospace" }}>{label}</span>
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
        {[
          ["Email", email, setEmail, "email", true],
          ...(mode === "signup" ? [
            ["Nom / Nom d'entreprise", fullName, setFullName, "text", true],
            ["Téléphone", phone, setPhone, "tel", true],
          ] : []),
          ...(mode !== "reset" ? [["Mot de passe", password, setPassword, "password", true]] : []),
        ].map(([label, val, set, type]) => (
          <div key={label} style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 9, letterSpacing: 2, color: "#888", textTransform: "uppercase", fontFamily: "'JetBrains Mono',monospace", marginBottom: 6 }}>{label}</div>
            <input type={type} value={val} onChange={e => set(e.target.value)} onKeyDown={e => e.key === "Enter" && submit()}
              placeholder={type === "tel" ? "06 12 34 56 78" : ""}
              style={{ width: "100%", background: "#1a1a1a", border: "1px solid #222", color: "#ddd5c8", padding: "10px 12px", borderRadius: 3, fontFamily: "'JetBrains Mono',monospace", fontSize: 12, outline: "none", boxSizing: "border-box" }} />
          </div>
        ))}
        {mode === "signup" && (
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 18, marginTop: 4 }}>
            <div
              onClick={() => setCgvAccepted(p => !p)}
              style={{ width: 16, height: 16, borderRadius: 3, border: `2px solid ${cgvAccepted ? "#f26522" : "#444"}`, background: cgvAccepted ? "#f26522" : "transparent", flexShrink: 0, marginTop: 1, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
              {cgvAccepted && <span style={{ color: "#090909", fontSize: 11, fontWeight: 900, lineHeight: 1 }}>✓</span>}
            </div>
            <div style={{ fontSize: 10, color: "#666", fontFamily: "'JetBrains Mono',monospace", lineHeight: 1.6 }}>
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
              style={{ fontSize: 10, color: "#f26522", cursor: "pointer", fontFamily: "'JetBrains Mono',monospace", letterSpacing: 1 }}>
              Mot de passe oublié ?
            </span>
          </div>
        )}
        {mode === "reset" && (
          <div style={{ fontSize: 10, color: "#666", marginBottom: 14, fontFamily: "'JetBrains Mono',monospace", lineHeight: 1.5 }}>
            Entrez votre email. Vous recevrez un lien pour réinitialiser votre mot de passe.
          </div>
        )}
        {error && <div style={{ fontSize: 10, color: "#e55", marginBottom: 14, fontFamily: "'JetBrains Mono',monospace" }}>⚠ {error}</div>}
        {success && <div style={{ fontSize: 10, color: "#5a5", marginBottom: 14, fontFamily: "'JetBrains Mono',monospace" }}>✓ {success}</div>}
        <button onClick={submit} disabled={loading} style={{
          width: "100%", background: "#f26522", color: "#090909", border: "none",
          padding: "13px 24px", cursor: loading ? "wait" : "pointer",
          fontFamily: "'Rajdhani',sans-serif", fontSize: 13, fontWeight: 700,
          letterSpacing: 4, textTransform: "uppercase", borderRadius: 3,
          opacity: loading ? 0.7 : 1, marginTop: 4
        }}>
          {loading ? "..." : mode === "login" ? "Se connecter" : mode === "reset" ? "Envoyer le lien" : "Créer mon compte"}
        </button>
        {mode === "reset" && (
          <div style={{ textAlign: "center", marginTop: 14 }}>
            <span onClick={() => { setMode("login"); setError(""); setSuccess(""); }}
              style={{ fontSize: 10, color: "#888", cursor: "pointer", fontFamily: "'JetBrains Mono',monospace", letterSpacing: 1 }}>
              ← Retour à la connexion
            </span>
          </div>
        )}
        <div style={{ marginTop: 28, paddingTop: 18, borderTop: "1px solid #1a1a1a", textAlign: "center", fontSize: 9, color: "#3a3a3a", fontFamily: "'JetBrains Mono',monospace", lineHeight: 2, letterSpacing: 1 }}>
          <a href="/cgv.html" target="_blank" style={{ color: "#3a3a3a", textDecoration: "none", marginRight: 16 }}>CGV & Mentions légales</a>
          <a href="/politique-confidentialite.html" target="_blank" style={{ color: "#3a3a3a", textDecoration: "none" }}>Politique de confidentialité</a>
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
  const [lightbox, setLightbox] = useState(null);
  const [cropMode, setCropMode] = useState(false);
  const [cropBox, setCropBox] = useState({ x: 0.1, y: 0.1, w: 0.8, h: 0.8 });
  const [cropDrag, setCropDrag] = useState(null); // { type, startMx, startMy, startBox }
  const [cropAngle, setCropAngle] = useState(180); // 0-360, 180 = photo droite (0° de rotation)
  const [adjustMode, setAdjustMode] = useState(false);
  const [adjustCorners, setAdjustCorners] = useState(null); // { tl, tr, br, bl } normalized 0-1
  const [adjustDrag, setAdjustDrag] = useState(null); // { corner, startMx, startMy, startCorners }
  const [manualPlateMode, setManualPlateMode] = useState(false); // true = pose manuelle (plaque non détectée)
  const [lbZoom, setLbZoom] = useState(1);            // zoom de la lightbox (1 = normal, max 8)
  const [lbPan,  setLbPan]  = useState({ x: 0, y: 0 }); // décalage (px) du calque zoomé
  const [lbPanDrag, setLbPanDrag] = useState(null);   // { startMx, startMy, startPan }
  const [settingsOpen, setSettingsOpen] = useState(false); // menu settings en haut à droite
  const settingsRef = useRef(null); // ref pour fermer au clic extérieur
  const logoRef        = useRef();
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
  const [showroomNudging, setShowroomNudging] = useState(false);
  const zoomTimerRef = useRef(null);
  const [passwordRecovery, setPasswordRecovery] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordConfirm, setNewPasswordConfirm] = useState("");
  const [recoveryMsg, setRecoveryMsg] = useState("");
  const [recoveryErr, setRecoveryErr] = useState("");
  const [recoveryLoading, setRecoveryLoading] = useState(false);

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
    const reader = new FileReader();
    reader.onload = (e) => setLogo({ file: f, preview: e.target.result, generated: false, bgColor: '#ffffff' });
    reader.readAsDataURL(f);
  };

  const handlePhotoFiles = files => {
    const imgs = Array.from(files).filter(f => f.type.startsWith("image/"));
    setPhotos(prev => [...prev, ...imgs.map(f => ({ file: f, preview: URL.createObjectURL(f), id: `${f.name}-${Math.random()}` }))]);
  };

  const start = async () => {
    if (!logo || !photos.length) return;
    const photosUsed = user?.user_metadata?.photos_used ?? 0;
    if (photosUsed >= PLAN_LIMIT) { setShowUpgradeModal(true); return; }
    const remaining = PLAN_LIMIT - photosUsed;
    const photosToProcess = photos.slice(0, remaining);
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
      const r = await processPhoto(photosToProcess[i].file, logoImg, adjEnabled ? adj : { brightness: 1, contrast: 1, saturation: 1 }, bgColor, enhance, headlightPolish, !!logoImg || showroomEnabled, floorClean, enhancePro, bodyPolish);
      const entry = { ...r, logoPreview: logo.preview, bgColor, generated: !!logo.generated };
      if (showroomEnabled && showroomBgDataUrl) {
        try {
          // On envoie la photo propre (sans cache plaque) à remove.bg → meilleur détourage
          const cutout = await removeBackground(r.baseDataURL);
          // Cache plaque redessiné nativement sur le composite (pas de double compression)
          const wOpts = resolvedWallLogo ? { src: resolvedWallLogo, scale: wallLogoScale, opacity: wallLogoOpacity, x: 0.5, y: 0.25 } : null;
          const sr = await compositeCarOnBg(cutout, showroomBgDataUrl, 2400, 1350, logoImg, r.corners, bgColor, 0, 0, 1.0, true, wOpts);
          entry.cutoutDataURL     = cutout;
          entry.showroomDataURL   = sr.dataURL;
          entry.showroomBaseURL   = sr.baseURL;
          entry.showroomTransform = sr.transform;
          entry.showroomBgUrl     = showroomBgDataUrl;
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
    await supabase.auth.updateUser({ data: { photos_used: newCount } });
    setUser(prev => prev ? { ...prev, user_metadata: { ...prev.user_metadata, photos_used: newCount } } : prev);
    setProcessing(false);
    setTab("results");
    if (newCount >= PLAN_LIMIT) setShowUpgradeModal(true);
  };

  const downloadOne = r => { const a = document.createElement("a"); a.href = r.showroomDataURL || r.processed; a.download = `${r.showroomDataURL ? "showroom_" : "autocache_"}${r.name}`; a.click(); };
  const downloadAll = () => results.forEach(downloadOne);
  const pct = progress.total ? Math.round((progress.n / progress.total) * 100) : 0;
  const userPlan = user?.user_metadata?.plan ?? "trial"; // "trial" | "essential" | "pro"
  const PLAN_LIMIT = userPlan === "pro" ? 250 : userPlan === "essential" ? 200 : TRIAL_LIMIT;
  const PLAN_LABEL = userPlan === "pro" || userPlan === "essential" ? "CRÉDIT" : "ESSAI";
  const canUseShowroom  = userPlan === "pro" || userPlan === "trial";
  const canUseHeadlight   = userPlan === "pro" || userPlan === "essential";
  const canUseBodyPolish  = userPlan === "pro" || userPlan === "essential";
  const canStart = logo && photos.length > 0 && !processing;

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
    setLbZoom(1); setLbPan({ x: 0, y: 0 }); setLbPanDrag(null);
    setShowroomNudge(r.showroomOffset ?? { x: 0, y: 0 });
    setShowroomZoom(r.showroomZoom ?? 1.0);
  };

  const NUDGE_STEP = 75; // pas de déplacement en px sur canvas 2400×1350

  // Recomposite central — utilisé par flèches ET slider zoom
  const recompositeShowroom = (nudge, zoom) => {
    setLightbox(prev => {
      if (!prev?.cutoutDataURL || showroomNudging) return prev;
      setShowroomNudging(true);
      (async () => {
        try {
          const logoImgEl = await loadImg(prev.logoPreview);
          const wOpts = prev.wallLogoSrc ? { src: prev.wallLogoSrc, scale: prev.wallLogoScale, opacity: prev.wallLogoOpacity, x: prev.wallLogoPos?.x ?? 0.5, y: prev.wallLogoPos?.y ?? 0.25 } : null;
          const sr = await compositeCarOnBg(
            prev.cutoutDataURL, prev.showroomBgUrl, 2400, 1350,
            logoImgEl, prev.corners, prev.bgColor,
            nudge.x, nudge.y, zoom, true, wOpts
          );
          const updated = { ...prev, showroomDataURL: sr.dataURL, showroomBaseURL: sr.baseURL, showroomTransform: sr.transform, showroomOffset: nudge, showroomZoom: zoom };
          setLightbox(updated);
          setResults(rs => rs.map(r => r.name === prev.name ? updated : r));
        } catch(e) { console.error('recomposite error', e); }
        setShowroomNudging(false);
      })();
      return prev;
    });
  };

  const nudgeShowroom = (dx, dy) => {
    const newNudge = { x: showroomNudge.x + dx, y: showroomNudge.y + dy };
    setShowroomNudge(newNudge);
    recompositeShowroom(newNudge, showroomZoom);
  };

  const onZoomChange = (z) => {
    setShowroomZoom(z);
    clearTimeout(zoomTimerRef.current);
    zoomTimerRef.current = setTimeout(() => recompositeShowroom(showroomNudge, z), 250);
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
        cutoutDataURL: null, showroomBgUrl: null, cropped: true };
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
      // Fond opaque sous le logo (couvre l'ancienne plaque ou la transparence du cutout)
      const bgColor = adjustLogoBgRef.current || '#ffffff';
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(ptl.x, ptl.y); ctx.lineTo(ptr.x, ptr.y);
      ctx.lineTo(pbr.x, pbr.y); ctx.lineTo(pbl.x, pbl.y);
      ctx.closePath(); ctx.fillStyle = bgColor; ctx.fill();
      ctx.restore();
      drawPerspective(ctx, logoImg, ptl, ptr, pbr, pbl);
      // Boost saturation + contraste sur la zone plaque (couleurs plus profondes)
      // Copie via canvas temporaire pour éviter de dessiner le canvas sur lui-même
      const tmp = document.createElement('canvas');
      tmp.width = canvas.width; tmp.height = canvas.height;
      const tCtx = tmp.getContext('2d');
      tCtx.filter = 'saturate(1.15) contrast(1.08)';
      tCtx.drawImage(canvas, 0, 0);
      tCtx.filter = 'none';
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(ptl.x, ptl.y); ctx.lineTo(ptr.x, ptr.y);
      ctx.lineTo(pbr.x, pbr.y); ctx.lineTo(pbl.x, pbl.y);
      ctx.closePath(); ctx.clip();
      ctx.drawImage(tmp, 0, 0);
      ctx.restore();
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

  // ── Touch : pinch-to-zoom + pan sur l'image (hors modes adjust/crop) ──────
  const onLbTouchStart = (e) => {
    if (adjustMode || cropMode) return;
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
    } else if (e.touches.length === 1 && lbZoom > 1) {
      onLbPanDown({ clientX: e.touches[0].clientX, clientY: e.touches[0].clientY, preventDefault: () => e.preventDefault() });
    }
  };

  const onLbTouchMove = (e) => {
    if (adjustMode || cropMode) return;
    e.preventDefault();
    if (e.touches.length === 2 && pinchRef.current) {
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
    } else if (e.touches.length === 1) {
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
      <div style={{ color: "#f26522", fontFamily: "'JetBrains Mono',monospace", fontSize: 11, letterSpacing: 3 }}>CHARGEMENT...</div>
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
            <span style={{ fontSize: 19, fontWeight: 700, letterSpacing: 4, textTransform: "uppercase", color: "#ddd5c8" }}>AutoCache</span>
            <span style={{ fontSize: 9, color: "#f26522", letterSpacing: 2, fontFamily: "'JetBrains Mono',monospace" }}>PRO</span>
          </div>
          <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: 2, color: "#ddd5c8", textTransform: "uppercase", marginBottom: 24, textAlign: "center" }}>
            Nouveau mot de passe
          </div>
          {[["Nouveau mot de passe", newPassword, setNewPassword], ["Confirmer le mot de passe", newPasswordConfirm, setNewPasswordConfirm]].map(([label, val, set]) => (
            <div key={label} style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 9, letterSpacing: 2, color: "#888", textTransform: "uppercase", fontFamily: "'JetBrains Mono',monospace", marginBottom: 6 }}>{label}</div>
              <input type="password" value={val} onChange={e => set(e.target.value)} onKeyDown={e => e.key === "Enter" && submitNewPassword()}
                style={{ width: "100%", background: "#1a1a1a", border: "1px solid #222", color: "#ddd5c8", padding: "10px 12px", borderRadius: 3, fontFamily: "'JetBrains Mono',monospace", fontSize: 12, outline: "none" }} />
            </div>
          ))}
          {recoveryErr && <div style={{ fontSize: 10, color: "#e55", marginBottom: 14, fontFamily: "'JetBrains Mono',monospace" }}>⚠ {recoveryErr}</div>}
          {recoveryMsg && <div style={{ fontSize: 10, color: "#5a5", marginBottom: 14, fontFamily: "'JetBrains Mono',monospace" }}>✓ {recoveryMsg}</div>}
          <button onClick={submitNewPassword} disabled={recoveryLoading} style={{
            width: "100%", background: "#f26522", color: "#090909", border: "none",
            padding: "13px 24px", cursor: recoveryLoading ? "wait" : "pointer",
            fontFamily: "'Rajdhani',sans-serif", fontSize: 13, fontWeight: 700,
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
            <span style={{ fontSize: isMobile ? 15 : 19, fontWeight: 700, letterSpacing: isMobile ? 2 : 4, textTransform: "uppercase" }}>AutoCache</span>
            {!isMobile && <span style={{ fontSize: 9, color: "#f26522", letterSpacing: 2, fontFamily: "'JetBrains Mono',monospace" }}>PRO</span>}
          </div>
          <nav style={{ display: "flex", alignItems: "center", gap: isMobile ? 4 : 8 }}>
            {[["setup", isMobile ? "Config" : "Configuration"], ["results", `Résultats${results.length ? ` · ${results.length}` : ""}`]].map(([t, label]) => (
              <button key={t} onClick={() => setTab(t)} style={{ background: tab === t ? "#f26522" : "transparent", color: tab === t ? "#090909" : "#777", border: "none", padding: isMobile ? "7px 10px" : "7px 18px", cursor: "pointer", fontFamily: "'Rajdhani',sans-serif", fontSize: isMobile ? 11 : 12, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", minHeight: "unset" }}>{label}</button>
            ))}
            {!isMobile && <div style={{ width: 1, height: 20, background: "#252525", margin: "0 4px" }} />}
            {/* ── Compteur crédits ── */}
            {(() => {
              const used = user?.user_metadata?.photos_used ?? 0;
              const left = Math.max(0, PLAN_LIMIT - used);
              const isExpired = left === 0;
              const isLow = left <= (PLAN_LIMIT <= 30 ? 5 : 20);
              return (
                <div onClick={() => isExpired && setShowUpgradeModal(true)}
                  style={{ display: "flex", alignItems: "center", gap: 5, padding: isMobile ? "4px 6px" : "4px 10px", borderRadius: 2, border: `1px solid ${isExpired ? "#c0392b" : "#2a2a2a"}`, cursor: isExpired ? "pointer" : "default", background: isExpired ? "rgba(192,57,43,0.08)" : "transparent" }}
                  title={isExpired ? "Crédits épuisés — cliquez pour mettre à niveau" : `${left} photo${left > 1 ? "s" : ""} restante${left > 1 ? "s" : ""}`}
                >
                  <span style={{ fontSize: 9, fontFamily: "'JetBrains Mono',monospace", color: isExpired ? "#c0392b" : isLow ? "#f26522" : "#666", letterSpacing: 1 }}>
                    {isExpired
                      ? (isMobile ? "ÉPUISÉ" : `${PLAN_LABEL} ÉPUISÉ`)
                      : (isMobile ? `${left}/${PLAN_LIMIT}` : `${PLAN_LABEL} · ${left}/${PLAN_LIMIT}`)}
                  </span>
                </div>
              );
            })()}
            {/* ── Bouton Settings + Menu déroulant ── */}
            <div ref={settingsRef} style={{ position: "relative" }}>
              <button onClick={() => setSettingsOpen(o => !o)}
                style={{ background: settingsOpen ? "#1e1e1e" : "transparent", border: `1px solid ${settingsOpen ? "#f26522" : "#282828"}`, color: settingsOpen ? "#f26522" : "#777", padding: "5px 10px", cursor: "pointer", borderRadius: 2, fontFamily: "'JetBrains Mono',monospace", fontSize: 13, display: "flex", alignItems: "center", gap: 5, minHeight: "unset" }}
                title="Paramètres"
              >
                <span style={{ fontSize: 14 }}>⚙</span>
                {!isMobile && <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", fontFamily: "'Rajdhani',sans-serif" }}>Menu</span>}
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
                      <div style={{ fontSize: 12, color: "#ddd5c8", fontFamily: "'Rajdhani',sans-serif", fontWeight: 700, letterSpacing: 1, marginBottom: 2 }}>{user.user_metadata.full_name}</div>
                    )}
                    <div style={{ fontSize: 10, color: "#777", fontFamily: "'JetBrains Mono',monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user.email}</div>
                  </div>
                  {/* Menu items */}
                  {[
                    { icon: "👤", label: "Mes informations", action: () => { setSettingsOpen(false); setShowProfileModal(true); } },
                    { icon: "💳", label: "Abonnement", action: () => { setSettingsOpen(false); setShowPlansModal(true); } },
                    { icon: "🎟", label: "Code Promo", action: () => { setSettingsOpen(false); setPromoCode(""); setPromoStatus(null); setPromoMsg(""); setShowPromoModal(true); } },
                    { icon: "✉", label: "Nous contacter", action: () => { setSettingsOpen(false); setShowContactModal(true); } },
                  ].map((item, i) => (
                    <button key={i} onClick={item.action}
                      style={{
                        display: "flex", alignItems: "center", gap: 10, width: "100%",
                        padding: "10px 16px", background: "transparent", border: "none",
                        color: "#bbb", cursor: "pointer", fontFamily: "'Rajdhani',sans-serif",
                        fontSize: 12, fontWeight: 600, letterSpacing: 1, textAlign: "left",
                        borderBottom: "1px solid #1a1a1a", transition: "background 0.1s",
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = "#1a1a1a"}
                      onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                    >
                      <span style={{ fontSize: 14, width: 20, textAlign: "center" }}>{item.icon}</span>
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
                      fontSize: 12, fontWeight: 700, letterSpacing: 1, textAlign: "left",
                      transition: "background 0.1s",
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = "rgba(192,57,43,0.08)"}
                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                  >
                    <span style={{ fontSize: 14, width: 20, textAlign: "center" }}>🚪</span>
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
              <section>
                <div style={{ fontSize: 12, letterSpacing: 3, color: "#f26522", textTransform: "uppercase", marginBottom: 10, fontFamily: "'JetBrains Mono',monospace" }}>01 — Cache plaque</div>

                {/* ── Onglets Import / Générer ── */}
                <div style={{ display: "flex", marginBottom: 14, background: "#121212", border: "1px solid #252525", borderRadius: 3, overflow: "hidden" }}>
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
                  <div style={{ fontSize: 10, color: "#666", marginBottom: 10, fontFamily: "'JetBrains Mono',monospace" }}>
                    {logo ? "✓ Logo chargé · cliquer pour changer" : "PNG avec transparence recommandé"}
                  </div>
                  <div onDragOver={e => { e.preventDefault(); setDragOver("logo"); }} onDragLeave={() => setDragOver(null)}
                    onDrop={e => { e.preventDefault(); setDragOver(null); handleLogoFile(e.dataTransfer.files[0]); }}
                    onClick={() => logoRef.current?.click()}
                    style={{ border: `1px solid ${dragOver === "logo" ? "#f26522" : logo ? "#2a2a2a" : "#222"}`, borderRadius: 3, padding: 24, cursor: "pointer", minHeight: 130, display: "flex", alignItems: "center", justifyContent: "center", background: "#161616" }}>
                    {logo ? (
                      <div style={{ textAlign: "center" }}>
                        <img src={logo.preview} style={{ maxHeight: 80, maxWidth: "100%", objectFit: "contain", borderRadius: logoRadius > 0 ? `${Math.round(logoRadius * 4)}px` : 0 }} />
                        <div style={{ fontSize: 10, color: "#f26522", marginTop: 10 }}>Cliquer pour changer</div>
                      </div>
                    ) : (
                      <div style={{ textAlign: "center", color: "#555" }}>
                        <div style={{ fontSize: 32, marginBottom: 8 }}>⬡</div>
                        <div style={{ fontSize: 12, color: "#666" }}>Glisser votre logo ici</div>
                      </div>
                    )}
                  </div>
                </>)}

                {/* ── Mode : générer texte + couleur ── */}
                {logoMode === "generate" && (
                  <div style={{ background: "#161616", border: "1px solid #252525", borderRadius: 3, padding: "16px 14px", display: "flex", flexDirection: "column", gap: 14 }}>

                    {/* Texte */}
                    <div>
                      <div style={{ fontSize: 9, color: "#888", letterSpacing: 2, fontFamily: "'JetBrains Mono',monospace", marginBottom: 6, textTransform: "uppercase" }}>Texte du cache plaque</div>
                      <input
                        type="text" value={genText} onChange={e => setGenText(e.target.value)}
                        placeholder="Nom de votre garage"
                        style={{ width: "100%", background: "#1a1a1a", border: "1px solid #2a2a2a", color: "#ddd5c8", padding: "9px 10px", fontFamily: "'Rajdhani',sans-serif", fontSize: 16, fontWeight: 600, borderRadius: 2, outline: "none" }}
                      />
                    </div>

                    {/* Police */}
                    <div>
                      <div style={{ fontSize: 9, color: "#888", letterSpacing: 2, fontFamily: "'JetBrains Mono',monospace", marginBottom: 8, textTransform: "uppercase" }}>Police d'écriture</div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 6 }}>
                        {LOGO_FONTS.map(f => (
                          <div key={f.key} onClick={() => setGenFont(f.key)}
                            style={{ background: genFont === f.key ? "#1a1200" : "#1a1a1a", border: `1px solid ${genFont === f.key ? "#f26522" : "#2a2a2a"}`, borderRadius: 3, padding: "8px 4px", cursor: "pointer", textAlign: "center", display: "flex", flexDirection: "column", gap: 4, alignItems: "center" }}>
                            <span style={{ fontFamily: f.family, fontWeight: f.weight, fontSize: 15, color: genFont === f.key ? "#f26522" : "#aaa", lineHeight: 1 }}>
                              {(genText.trim() || "ABC").toUpperCase().slice(0, 4)}
                            </span>
                            <span style={{ fontSize: 7, color: genFont === f.key ? "#f26522" : "#444", fontFamily: "'JetBrains Mono',monospace", letterSpacing: 1, textTransform: "uppercase" }}>{f.label}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Couleur de fond */}
                    <div>
                      <div style={{ fontSize: 9, color: "#888", letterSpacing: 2, fontFamily: "'JetBrains Mono',monospace", marginBottom: 7, textTransform: "uppercase" }}>Couleur de fond</div>
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
                      <div style={{ fontSize: 9, color: "#888", letterSpacing: 2, fontFamily: "'JetBrains Mono',monospace", marginBottom: 7, textTransform: "uppercase" }}>Couleur du texte</div>
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
                      <div style={{ fontSize: 9, color: "#888", letterSpacing: 2, fontFamily: "'JetBrains Mono',monospace", marginBottom: 7, textTransform: "uppercase" }}>Liseret (bordure)</div>
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
                        <span style={{ fontSize: 10, color: genBorderWidth > 0 ? "#f26522" : "#444", fontFamily: "'JetBrains Mono',monospace", minWidth: 20, textAlign: "right" }}>
                          {genBorderWidth === 0 ? "Off" : genBorderWidth}
                        </span>
                      </div>
                    </div>

                    {/* Aperçu live */}
                    {logo?.preview && (
                      <div>
                        <div style={{ fontSize: 9, color: "#666", letterSpacing: 2, fontFamily: "'JetBrains Mono',monospace", marginBottom: 6, textTransform: "uppercase" }}>Aperçu</div>
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

              <section>
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
                    toggle: () => { if (!canUseHeadlight) { setShowPlansModal(true); return; } setHeadlightPolish(p => !p); },
                    icon: "💡",
                    label: "Lustrage des optiques",
                    sub: canUseHeadlight ? "Correction colorimétrique du jaunissement" : "Disponible dès l'abonnement Essentiel",
                    locked: !canUseHeadlight,
                  },
                  {
                    active: bodyPolish,
                    toggle: () => { if (!canUseBodyPolish) { setShowPlansModal(true); return; } setBodyPolish(p => !p); },
                    icon: "✦",
                    label: "Lustrage carrosserie",
                    sub: canUseBodyPolish ? "Brillance, saturation & profondeur de couleur" : "Disponible dès l'abonnement Essentiel",
                    locked: !canUseBodyPolish,
                  },
                ].map(({ active, toggle, icon, label, sub, locked }) => (
                  <div key={label}
                    onClick={toggle}
                    style={{ marginBottom: 8, display: "flex", alignItems: "center", gap: 12, padding: "11px 14px", background: active && !locked ? "rgba(242,101,34,0.08)" : "#0a0a0a", border: `1px solid ${active && !locked ? "#f26522" : "#1c1c1c"}`, borderRadius: 3, cursor: "pointer", userSelect: "none", opacity: locked ? 0.55 : 1 }}
                  >
                    <div style={{ width: 16, height: 16, borderRadius: 3, border: `2px solid ${locked ? "#555" : active ? "#f26522" : "#444"}`, background: active && !locked ? "#f26522" : "transparent", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {locked ? <span style={{ color: "#555", fontSize: 10 }}>🔒</span> : active && <span style={{ color: "#090909", fontSize: 11, fontWeight: 900, lineHeight: 1 }}>✓</span>}
                    </div>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", color: locked ? "#555" : active ? "#f26522" : "#666", fontFamily: "'Rajdhani',sans-serif" }}>
                        {icon} {label}{locked && <span style={{ fontSize: 8, color: "#f26522", fontFamily: "'JetBrains Mono',monospace", letterSpacing: 1, marginLeft: 6 }}>PRO</span>}
                      </div>
                      <div style={{ fontSize: 9, color: "#666", fontFamily: "'JetBrains Mono',monospace", marginTop: 2 }}>{sub}</div>
                    </div>
                  </div>
                ))}

                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                  <div style={{ fontSize: 12, letterSpacing: 3, color: adjEnabled ? "#f26522" : "#444", textTransform: "uppercase", fontFamily: "'JetBrains Mono',monospace" }}>03 — Ajustements photo</div>
                  <button onClick={() => setAdjEnabled(p => !p)} style={{ background: adjEnabled ? "#f26522" : "#1a1a1a", border: `1px solid ${adjEnabled ? "#f26522" : "#2a2a2a"}`, color: adjEnabled ? "#090909" : "#444", padding: "4px 13px", cursor: "pointer", fontFamily: "'JetBrains Mono',monospace", fontSize: 9, letterSpacing: 2, textTransform: "uppercase", borderRadius: 2 }}>
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
              <section>
                <div style={{ fontSize: 12, letterSpacing: 3, color: "#f26522", textTransform: "uppercase", marginBottom: 12, fontFamily: "'JetBrains Mono',monospace" }}>02 — Photos de véhicules</div>
                <div onDragOver={e => { e.preventDefault(); setDragOver("photos"); }} onDragLeave={() => setDragOver(null)}
                  onDrop={e => { e.preventDefault(); setDragOver(null); handlePhotoFiles(e.dataTransfer.files); }}
                  onClick={() => photosRef.current?.click()}
                  style={{ border: `1px dashed ${dragOver === "photos" ? "#f26522" : "#222"}`, borderRadius: 3, padding: "22px 16px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", background: "#161616", marginBottom: 12 }}>
                  <div style={{ textAlign: "center", color: "#555" }}>
                    <div style={{ fontSize: 30, marginBottom: 8 }}>◈</div>
                    <div style={{ fontSize: 12, color: "#666" }}>{isMobile ? "Appuyer pour sélectionner" : "Glisser les photos ici"}</div>
                    <div style={{ fontSize: 10, marginTop: 3, color: "#2a2a2a" }}>JPG, PNG — plusieurs fichiers acceptés</div>
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
                            style={{ position: "absolute", top: 2, right: 2, width: 15, height: 15, borderRadius: "50%", background: "#f26522", border: "none", color: "#090909", fontSize: 9, cursor: "pointer", fontWeight: 700 }}>×</button>
                        </div>
                      ))}
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: 10, color: "#888", fontFamily: "'JetBrains Mono',monospace" }}>{photos.length} photo{photos.length > 1 ? "s" : ""}</span>
                      <button onClick={() => setPhotos([])} style={{ background: "transparent", border: "1px solid #1e1e1e", color: "#888", padding: "3px 10px", cursor: "pointer", fontFamily: "'Rajdhani',sans-serif", fontSize: 10, letterSpacing: 1, textTransform: "uppercase", borderRadius: 2 }}>Tout effacer</button>
                    </div>
                  </>
                )}
              </section>

              {/* ── 03 — Showroom Virtuel ── */}
              <section>
                <div style={{ fontSize: 12, letterSpacing: 3, color: "#f26522", textTransform: "uppercase", marginBottom: 12, fontFamily: "'JetBrains Mono',monospace" }}>03 — Showroom Virtuel</div>
                <div onClick={() => { if (!canUseShowroom) { setShowUpgradeProModal(true); return; } const next = !showroomEnabled; setShowroomEnabled(next); if (next) preloadRemoveBg(); }}
                  style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 14px", background: showroomEnabled && canUseShowroom ? "rgba(242,101,34,0.08)" : "#0a0a0a", border: `1px solid ${showroomEnabled && canUseShowroom ? "#f26522" : "#1c1c1c"}`, borderRadius: showroomEnabled && canUseShowroom ? "3px 3px 0 0" : 3, cursor: "pointer", userSelect: "none", opacity: canUseShowroom ? 1 : 0.5 }}>
                  <div style={{ width: 16, height: 16, borderRadius: 3, border: `2px solid ${showroomEnabled && canUseShowroom ? "#f26522" : "#444"}`, background: showroomEnabled && canUseShowroom ? "#f26522" : "transparent", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {canUseShowroom ? (showroomEnabled && <span style={{ color: "#090909", fontSize: 11, fontWeight: 900, lineHeight: 1 }}>✓</span>) : <span style={{ color: "#555", fontSize: 10 }}>🔒</span>}
                  </div>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", color: showroomEnabled && canUseShowroom ? "#f26522" : "#666", fontFamily: "'Rajdhani',sans-serif" }}>
                      ⬡ Showroom Virtuel {!canUseShowroom && <span style={{ fontSize: 8, color: "#f26522", fontFamily: "'JetBrains Mono',monospace", letterSpacing: 1, marginLeft: 6 }}>ABONNEMENT PRO</span>}
                    </div>
                    <div style={{ fontSize: 9, color: "#666", fontFamily: "'JetBrains Mono',monospace", marginTop: 2 }}>
                      {canUseShowroom ? "Détourage IA · Fond de showroom · Inclus au traitement" : "Disponible avec l'abonnement Pro — cliquez pour en savoir plus"}
                    </div>
                  </div>
                </div>
                {showroomEnabled && (
                  <div style={{ padding: "12px 14px", background: "#121212", border: "1px solid #f26522", borderTop: "none", borderRadius: "0 0 3px 3px" }}>
                    <div style={{ display: "flex", gap: 10, alignItems: "flex-start", background: "rgba(242,101,34,0.06)", border: "1px solid rgba(242,101,34,0.2)", borderRadius: 3, padding: "9px 11px", marginBottom: 14 }}>
                      <span style={{ color: "#f26522", fontSize: 13, flexShrink: 0, lineHeight: 1.4 }}>⚠</span>
                      <p style={{ fontSize: 9, color: "#aaa", fontFamily: "'JetBrains Mono',monospace", lineHeight: 1.7, margin: 0 }}>
                        Pour un détourage optimal, utilisez une photo où le véhicule est <span style={{ color: "#ddd5c8" }}>seul dans le cadre</span>. La présence d'autres véhicules à proximité peut perturber l'analyse de l'IA et affecter la qualité du détourage.
                      </p>
                    </div>
                    <div style={{ fontSize: 9, letterSpacing: 2, color: "#888", textTransform: "uppercase", fontFamily: "'JetBrains Mono',monospace", marginBottom: 10 }}>Fond de scène</div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "stretch" }}>
                      {[0, 1, 2, 3].map(idx => {
                        const isActive = showroomSetupBg === idx;
                        return (
                          <div key={idx} onClick={e => { e.stopPropagation(); setShowroomSetupBg(idx); }}
                            style={{ cursor: "pointer", border: `2px solid ${isActive ? "#f26522" : "#2a2a2a"}`, borderRadius: 3, overflow: "hidden", width: 70, flexShrink: 0, transition: "border-color 0.12s" }}>
                            <img src={SHOWROOM_THUMBS[idx]} style={{ display: "block", width: "100%", height: 39, objectFit: "cover" }} />
                            <div style={{ background: isActive ? "#f26522" : "#1a1a1a", color: isActive ? "#090909" : "#555", fontSize: 7, fontFamily: "'JetBrains Mono',monospace", letterSpacing: 1, textAlign: "center", padding: "2px 0", textTransform: "uppercase" }}>
                              {SHOWROOM_LABELS[idx]}
                            </div>
                          </div>
                        );
                      })}
                      <div onClick={e => { e.stopPropagation(); showroomSetupUploadRef.current?.click(); }}
                        style={{ cursor: "pointer", border: `2px solid ${showroomSetupBg === 'custom' ? "#f26522" : "#2a2a2a"}`, borderRadius: 3, overflow: "hidden", width: 70, flexShrink: 0, display: "flex", flexDirection: "column", background: "#1e1e1e", transition: "border-color 0.12s" }}>
                        {showroomSetupCustomBg
                          ? <img src={showroomSetupCustomBg} style={{ display: "block", width: "100%", height: 39, objectFit: "cover" }} />
                          : <div style={{ height: 39, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, color: "#555" }}>+</div>
                        }
                        <div style={{ background: showroomSetupBg === 'custom' ? "#f26522" : "#1a1a1a", color: showroomSetupBg === 'custom' ? "#090909" : "#555", fontSize: 7, fontFamily: "'JetBrains Mono',monospace", letterSpacing: 1, textAlign: "center", padding: "2px 0", textTransform: "uppercase" }}>Custom</div>
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

                    {/* Logo / Texte mural */}
                    <div style={{ marginTop: 14, borderTop: "1px solid #252525", paddingTop: 12 }}>
                      <div style={{ fontSize: 9, letterSpacing: 2, color: "#888", textTransform: "uppercase", fontFamily: "'JetBrains Mono',monospace", marginBottom: 8 }}>Enseigne murale</div>

                      {/* Tabs : Aucun / Image / Texte */}
                      <div style={{ display: "flex", gap: 4, marginBottom: 10 }}>
                        {[["none","Aucune"],["image","Importer logo"],["text","Générer texte"]].map(([k,label]) => (
                          <button key={k} onClick={() => setWallLogoMode(k)}
                            style={{ flex: 1, padding: "5px 0", fontSize: 8, fontFamily: "'JetBrains Mono',monospace", letterSpacing: 1, textTransform: "uppercase", cursor: "pointer", borderRadius: 2,
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
                              : <span style={{ fontSize: 18, color: "#444" }}>+</span>
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
                              <div style={{ fontSize: 8, color: "#666", fontFamily: "'JetBrains Mono',monospace", marginBottom: 4 }}>TAILLE</div>
                              <input type="range" min="0.05" max="0.40" step="0.01" value={wallLogoScale}
                                onChange={e => setWallLogoScale(parseFloat(e.target.value))}
                                style={{ width: "100%", accentColor: "#f26522", height: 3 }} />
                            </div>
                            <button onClick={() => setWallLogo(null)}
                              style={{ background: "transparent", border: "1px solid #2a2a2a", color: "#888", width: 22, height: 22, borderRadius: 3, cursor: "pointer", fontSize: 10, display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
                          </>)}
                        </div>
                      )}

                      {/* Mode Texte */}
                      {wallLogoMode === "text" && (
                        <div>
                          <input type="text" value={wallText} onChange={e => setWallText(e.target.value)}
                            placeholder="Nom de l'enseigne"
                            style={{ width: "100%", boxSizing: "border-box", padding: "8px 10px", background: "#161616", border: "1px solid #2a2a2a", borderRadius: 3, color: "#ddd5c8", fontFamily: "'Rajdhani',sans-serif", fontSize: 13, letterSpacing: 1, marginBottom: 8 }} />
                          {/* Aperçu */}
                          {wallText.trim() && (
                            <div style={{ background: "#111", border: "1px solid #222", borderRadius: 3, padding: "10px 14px", marginBottom: 8, textAlign: "center", overflow: "hidden" }}>
                              <span style={{
                                fontFamily: (WALL_FONTS.find(f => f.key === wallTextFont) ?? WALL_FONTS[0]).family,
                                fontWeight: (WALL_FONTS.find(f => f.key === wallTextFont) ?? WALL_FONTS[0]).weight,
                                fontSize: 22, color: wallTextColor, letterSpacing: 3,
                                WebkitTextStroke: wallTextStrokeWidth > 0 ? `${wallTextStrokeWidth * 0.4}px ${wallTextStrokeColor}` : undefined,
                                textDecoration: wallTextUnderline ? "underline" : "none",
                              }}>{wallText.trim()}</span>
                            </div>
                          )}
                          <div style={{ display: "flex", gap: 8, alignItems: "flex-start", marginBottom: 8 }}>
                            {/* Couleur */}
                            <div>
                              <div style={{ fontSize: 8, color: "#666", fontFamily: "'JetBrains Mono',monospace", marginBottom: 4 }}>COULEUR</div>
                              <input type="color" value={wallTextColor} onChange={e => setWallTextColor(e.target.value)}
                                style={{ width: 34, height: 26, border: "1px solid #2a2a2a", borderRadius: 3, background: "transparent", cursor: "pointer" }} />
                            </div>
                            {/* Taille */}
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: 8, color: "#666", fontFamily: "'JetBrains Mono',monospace", marginBottom: 4 }}>TAILLE</div>
                              <input type="range" min="0.05" max="0.40" step="0.01" value={wallLogoScale}
                                onChange={e => setWallLogoScale(parseFloat(e.target.value))}
                                style={{ width: "100%", accentColor: "#f26522", height: 3 }} />
                            </div>
                          </div>
                          {/* Polices */}
                          <div style={{ fontSize: 8, color: "#666", fontFamily: "'JetBrains Mono',monospace", marginBottom: 4 }}>POLICE</div>
                          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 8 }}>
                            {WALL_FONTS.map(f => (
                              <button key={f.key} onClick={() => setWallTextFont(f.key)}
                                style={{
                                  padding: "4px 8px", fontSize: 10, cursor: "pointer", borderRadius: 2,
                                  fontFamily: f.family, fontWeight: f.weight,
                                  background: wallTextFont === f.key ? "#f26522" : "#161616",
                                  color: wallTextFont === f.key ? "#090909" : "#999",
                                  border: `1px solid ${wallTextFont === f.key ? "#f26522" : "#2a2a2a"}`,
                                }}>{f.label}</button>
                            ))}
                          </div>
                          {/* Liseré */}
                          <div style={{ marginBottom: 8 }}>
                            <div style={{ fontSize: 8, color: "#666", fontFamily: "'JetBrains Mono',monospace", marginBottom: 4 }}>LISERÉ</div>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <input type="color" value={wallTextStrokeColor}
                                onChange={e => { setWallTextStrokeColor(e.target.value); if (wallTextStrokeWidth === 0) setWallTextStrokeWidth(2); }}
                                style={{ width: 26, height: 26, padding: 0, border: `1px solid ${wallTextStrokeWidth > 0 ? "#f26522" : "#2a2a2a"}`, borderRadius: 3, cursor: "pointer", background: "none" }} />
                              <input type="range" min="0" max="10" step="1" value={wallTextStrokeWidth}
                                onChange={e => setWallTextStrokeWidth(parseInt(e.target.value))}
                                style={{ flex: 1, accentColor: "#f26522", height: 3 }} />
                              <span style={{ fontSize: 10, color: wallTextStrokeWidth > 0 ? "#f26522" : "#444", fontFamily: "'JetBrains Mono',monospace", minWidth: 20, textAlign: "right" }}>
                                {wallTextStrokeWidth === 0 ? "Off" : wallTextStrokeWidth}
                              </span>
                            </div>
                          </div>
                          {/* Soulignement */}
                          <div>
                            <div style={{ fontSize: 8, color: "#666", fontFamily: "'JetBrains Mono',monospace", marginBottom: 4 }}>SOULIGNEMENT</div>
                            <button onClick={() => setWallTextUnderline(v => !v)}
                              style={{
                                padding: "4px 12px", fontSize: 10, cursor: "pointer", borderRadius: 2,
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
                        <div style={{ fontSize: 8, color: "#666", fontFamily: "'JetBrains Mono',monospace", marginTop: 8 }}>
                          Positionnez l'enseigne en la glissant sur l'image dans les résultats
                        </div>
                      ) : null}
                    </div>
                  </div>
                )}
              </section>

              <section>
                <button onClick={start} disabled={!canStart} style={{ width: "100%", background: canStart ? "#f26522" : "#1a1a1a", color: canStart ? "#090909" : "#444", border: "none", padding: "15px 24px", cursor: canStart ? "pointer" : "not-allowed", fontFamily: "'Rajdhani',sans-serif", fontSize: 15, fontWeight: 700, letterSpacing: 4, textTransform: "uppercase", borderRadius: 3 }}>
                  {processing ? `Traitement... ${progress.n} / ${progress.total}` : `Lancer — ${photos.length} photo${photos.length > 1 ? "s" : ""}${showroomEnabled ? " + Showroom" : ""}`}
                </button>
                {processing && (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ height: 2, background: "#1e1e1e", borderRadius: 1, overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${pct}%`, background: "#f26522", transition: "width 0.4s ease" }} />
                    </div>
                    <div style={{ marginTop: 5, fontSize: 9, color: "#888", fontFamily: "'JetBrains Mono',monospace", textAlign: "right" }}>{pct}%</div>
                  </div>
                )}
                {!logo && <div style={{ marginTop: 10, fontSize: 10, color: "#666", fontFamily: "'JetBrains Mono',monospace" }}>⚠ Chargez votre logo pour continuer</div>}
              </section>
            </div>
          </div>
        )}

        {tab === "results" && (
          <div style={{ maxWidth: 1200, margin: "0 auto", padding: isMobile ? "16px 12px" : "32px 28px" }}>
            {results.length === 0 ? (
              <div style={{ textAlign: "center", padding: "80px 0", color: "#555" }}>
                <div style={{ fontSize: 48, marginBottom: 16 }}>◈</div>
                <div style={{ fontSize: 14, letterSpacing: 2, textTransform: "uppercase" }}>Aucun résultat</div>
              </div>
            ) : (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
                  <div>
                    <div style={{ fontSize: 12, letterSpacing: 3, color: "#f26522", textTransform: "uppercase", fontFamily: "'JetBrains Mono',monospace" }}>{results.length} photo{results.length > 1 ? "s" : ""} traitée{results.length > 1 ? "s" : ""}</div>
                    <div style={{ marginTop: 4, fontSize: 10, color: "#666", fontFamily: "'JetBrains Mono',monospace" }}>
                      {results.filter(r => r.plateFound).length} détectée{results.filter(r => r.plateFound).length > 1 ? "s" : ""} · {results.filter(r => !r.plateFound).length} non détectée{results.filter(r => !r.plateFound).length > 1 ? "s" : ""}
                    </div>
                  </div>
                  {!processing && <button onClick={downloadAll} style={{ background: "#f26522", color: "#090909", border: "none", padding: "9px 22px", cursor: "pointer", fontFamily: "'Rajdhani',sans-serif", fontSize: 12, fontWeight: 700, letterSpacing: 3, textTransform: "uppercase", borderRadius: 3 }}>Tout télécharger ({results.length})</button>}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(${isMobile ? 150 : 260}px, 1fr))`, gap: isMobile ? 10 : 14 }}>
                  {results.map((r, i) => (
                    <div key={i} style={{ background: "#161616", border: "1px solid #252525", borderRadius: 3, overflow: "hidden" }}>
                      <div style={{ position: "relative", cursor: "zoom-in" }} onClick={() => openLightbox(r)} title="Cliquer pour agrandir">
                        <img src={r.showroomDataURL || r.processed} style={{ width: "100%", aspectRatio: "4/3", objectFit: "contain", background: "#1e1e1e", display: "block" }} />
                        {r.yoloBbox && r.imgW && (
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
                            {/* Quadrilatère raffiné OpenCV — orange épais */}
                            {r.yoloCorners && (
                              <polygon
                                points={r.yoloCorners.map(p => `${p.x * r.imgW},${p.y * r.imgH}`).join(' ')}
                                fill="none" stroke="#f97316" strokeWidth={Math.max(2, r.imgW * 0.003)}
                              />
                            )}
                            {/* Coins — points orange */}
                            {r.yoloCorners && r.yoloCorners.map((p, i) => (
                              <circle key={i} cx={p.x * r.imgW} cy={p.y * r.imgH}
                                r={Math.max(4, r.imgW * 0.006)} fill="#f97316" />
                            ))}
                            {/* Badge confiance + méthode finale */}
                            <rect x={r.yoloBbox.x1 * r.imgW} y={r.yoloBbox.y1 * r.imgH - r.imgH * 0.042}
                              width={r.imgW * 0.072} height={r.imgH * 0.038} fill="#22c55e" rx={r.imgW * 0.003} />
                            <text x={r.yoloBbox.x1 * r.imgW + r.imgW * 0.005} y={r.yoloBbox.y1 * r.imgH - r.imgH * 0.01}
                              fill="#000" fontSize={r.imgH * 0.026} fontFamily="monospace" fontWeight="bold">
                              {Math.round(r.yoloBbox.conf * 100)}%
                            </text>
                            {r.yoloDebug?.method && (
                              <text x={r.yoloBbox.x1 * r.imgW + r.imgW * 0.078}
                                y={r.yoloBbox.y1 * r.imgH - r.imgH * 0.012}
                                fill="#f97316" fontSize={r.imgH * 0.022}
                                fontFamily="monospace" fontWeight="bold">
                                {r.yoloDebug.method.split(':')[0]}
                              </text>
                            )}
                          </svg>
                        )}
                        <div style={{ position: "absolute", top: 8, left: 8, display: "flex", gap: 4 }}>
                          <span style={{ background: r.plateFound ? "rgba(22,163,74,0.9)" : "rgba(220,38,38,0.9)", color: "#fff", fontSize: 8, padding: "3px 7px", borderRadius: 2, fontFamily: "'JetBrains Mono',monospace" }}>
                            {r.plateFound ? "✓ PLAQUE CACHÉE" : "⚠ NON DÉTECTÉE"}
                          </span>
                          {r.cropped && (
                            <span style={{ background: "rgba(242,101,34,0.85)", color: "#fff", fontSize: 8, padding: "3px 7px", borderRadius: 2, fontFamily: "'JetBrains Mono',monospace" }}>✂ ROGNÉ</span>
                          )}
                        </div>
                        <div style={{ position: "absolute", bottom: 8, right: 8, background: "rgba(0,0,0,0.6)", borderRadius: 2, padding: "3px 7px", fontSize: 9, color: "#aaa", fontFamily: "'JetBrains Mono',monospace" }}>🔍 Agrandir</div>
                      </div>
                      <div style={{ padding: "9px 11px", display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid #161616", gap: 6 }}>
                        <div style={{ fontSize: 10, color: "#666", fontFamily: "'JetBrains Mono',monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>{r.name}</div>
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
                            style={{ background: "#f26522", border: "none", color: "#090909", padding: "4px 9px", cursor: "pointer", fontFamily: "'Rajdhani',sans-serif", fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", borderRadius: 2, whiteSpace: "nowrap", flexShrink: 0 }}
                          >+ Cache plaque</button>
                        )}
                        <button onClick={() => downloadOne(r)} style={{ background: "transparent", border: "1px solid #2a2a2a", color: "#f26522", padding: "4px 11px", cursor: "pointer", fontFamily: "'Rajdhani',sans-serif", fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", borderRadius: 2, flexShrink: 0 }}>DL</button>
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
          onTouchMove={e => { if (adjustMode) onAdjustTouchMove(e); else onLbTouchMove(e); }}
          onTouchEnd={() => { adjustDragRef.current = null; setAdjustDrag(null); setLbPanDrag(null); pinchRef.current = null; }}
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
                        logoImgEl, latestCorners, snap.bgColor, nudge.x, nudge.y, zoom, true, wOpts2)
                    ).then(sr => {
                      const withSR = { ...updated, showroomDataURL: sr.dataURL, showroomBaseURL: sr.baseURL, showroomTransform: sr.transform, showroomOffset: nudge, showroomZoom: zoom };
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
              style={{ position: "fixed", top: 10, right: 10, zIndex: 1010, width: 36, height: 36, borderRadius: "50%", background: "rgba(20,20,20,0.92)", border: "1px solid #3a3a3a", color: "#ccc", fontSize: 18, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1 }}
            >✕</button>
          )}
          {/* ── Bouton Terminé fixe en bas (mobile + adjust mode) ── */}
          {isMobile && adjustMode && (
            <button
              onClick={e => { e.stopPropagation(); setAdjustMode(false); setAdjustDrag(null); setManualPlateMode(false); }}
              style={{ position: "fixed", bottom: 18, left: "50%", transform: "translateX(-50%)", zIndex: 1010, height: 44, paddingInline: 28, borderRadius: 22, background: "#e8a020", border: "none", color: "#090909", fontSize: 14, fontWeight: 700, fontFamily: "'Rajdhani',sans-serif", letterSpacing: 1, textTransform: "uppercase", cursor: "pointer", boxShadow: "0 4px 16px rgba(0,0,0,0.7)" }}
            >✓ Terminé</button>
          )}
          {/* ── Barre du haut ── */}
          <div onClick={e => e.stopPropagation()} style={{ width: "100%", maxWidth: 1100, display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, padding: isMobile ? "0 44px 0 2px" : "0 2px", gap: 6 }}>
            {!isMobile && <div style={{ fontSize: 10, color: "#888", fontFamily: "'JetBrains Mono',monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "40%" }}>{lightbox.name}</div>}
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
                style={{ background: cropMode ? "#f26522" : "#181818", color: cropMode ? "#090909" : "#aaa", border: `1px solid ${cropMode ? "#f26522" : "#2a2a2a"}`, padding: isMobile ? "6px 10px" : "7px 14px", cursor: "pointer", fontFamily: "'Rajdhani',sans-serif", fontSize: isMobile ? 10 : 11, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", borderRadius: 2, minHeight: "unset" }}
              >✂ {isMobile ? "" : "Rogner"}</button>

              {/* Bouton Ajuster — visible seulement si plaque détectée */}
              {lightbox.plateFound && lightbox.corners && (
                <button
                  onClick={e => { e.stopPropagation(); const nm = !adjustMode; if (nm) adjustCornersRef.current = lightbox.corners; setAdjustMode(nm); setManualPlateMode(false); setCropMode(false); setCropDrag(null); setAdjustCorners(lightbox.corners); }}
                  style={{ background: adjustMode ? "#e8a020" : "#181818", color: adjustMode ? "#090909" : "#e8a020", border: `1px solid ${adjustMode ? "#e8a020" : "#3a2800"}`, padding: isMobile ? "6px 10px" : "7px 14px", cursor: "pointer", fontFamily: "'Rajdhani',sans-serif", fontSize: isMobile ? 10 : 11, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", borderRadius: 2, minHeight: "unset" }}
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
                  style={{ background: "#181818", color: "#f26522", border: "1px solid #3a1400", padding: isMobile ? "6px 10px" : "7px 14px", cursor: "pointer", fontFamily: "'Rajdhani',sans-serif", fontSize: isMobile ? 10 : 11, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", borderRadius: 2, minHeight: "unset" }}
                >⊕ {isMobile ? "Cache plaque" : "Ajouter cache plaque"}</button>
              )}

              {/* Télécharger / Fermer ajustement */}
              {adjustMode ? (
                <button
                  onClick={e => { e.stopPropagation(); setAdjustMode(false); setAdjustDrag(null); setManualPlateMode(false); }}
                  style={{ background: "#e8a020", color: "#090909", border: "none", padding: isMobile ? "6px 12px" : "7px 18px", cursor: "pointer", fontFamily: "'Rajdhani',sans-serif", fontSize: isMobile ? 11 : 12, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", borderRadius: 2, minHeight: "unset" }}
                >✓ Terminé</button>
              ) : cropMode ? (<>
                <button
                  onClick={e => { e.stopPropagation(); saveCrop(); }}
                  style={{ background: "#2a6b2a", color: "#ddd5c8", border: "1px solid #3a8a3a", padding: isMobile ? "6px 10px" : "7px 14px", cursor: "pointer", fontFamily: "'Rajdhani',sans-serif", fontSize: isMobile ? 10 : 11, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", borderRadius: 2, minHeight: "unset" }}
                >💾 {isMobile ? "" : "Sauvegarder"}</button>
                <button
                  onClick={e => { e.stopPropagation(); downloadCropped(); }}
                  style={{ background: "#f26522", color: "#090909", border: "none", padding: isMobile ? "6px 12px" : "7px 18px", cursor: "pointer", fontFamily: "'Rajdhani',sans-serif", fontSize: isMobile ? 11 : 12, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", borderRadius: 2, minHeight: "unset" }}
                >⬇ {isMobile ? "Rogné" : "Télécharger rogné"}</button>
              </>) : (
                <button
                  onClick={e => { e.stopPropagation(); downloadOne(lightbox); }}
                  style={{ background: "#f26522", color: "#090909", border: "none", padding: isMobile ? "6px 14px" : "7px 18px", cursor: "pointer", fontFamily: "'Rajdhani',sans-serif", fontSize: isMobile ? 11 : 12, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", borderRadius: 2, minHeight: "unset" }}
                >⬇ {isMobile ? "DL" : "Télécharger"}</button>
              )}

              {!isMobile && <button onClick={closeLightbox} style={{ background: "#1e1e1e", color: "#aaa", border: "1px solid #2a2a2a", padding: "7px 14px", cursor: "pointer", fontFamily: "'JetBrains Mono',monospace", fontSize: 14, borderRadius: 2, minHeight: "unset" }}>✕</button>}
            </div>
          </div>

          {/* ── Image + overlay rognage/ajustement ── */}
          <div
            ref={lbContainerRef}
            onClick={e => e.stopPropagation()}
            onWheel={onLbWheel}
            onMouseDown={onLbPanDown}
            onTouchStart={e => { if (adjustMode) { /* corner handles handle their own touch */ } else onLbTouchStart(e); }}
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
                style={{ position: "absolute", top: 8, right: isMobile ? 54 : 8, background: "rgba(0,0,0,0.82)", color: "#f26522", fontSize: 10, fontFamily: "'JetBrains Mono',monospace", padding: isMobile ? "5px 10px" : "3px 8px", borderRadius: 2, zIndex: 30, letterSpacing: 1, cursor: isMobile ? "pointer" : "default" }}
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
                src={lightbox.showroomDataURL || lightbox.processed}
                style={{ display: "block", maxWidth: "min(1100px, 100vw - 32px)", maxHeight: "79vh", objectFit: "contain", pointerEvents: "none" }}
              />
            )}

            {/* ── Debug YOLO bbox + corners overlay ── */}
            {!cropMode && !adjustMode && lightbox.yoloBbox && lightbox.imgW && (
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
                {/* Quadrilatère raffiné — orange épais */}
                {lightbox.yoloCorners && (
                  <polygon
                    points={lightbox.yoloCorners.map(p => `${p.x * lightbox.imgW},${p.y * lightbox.imgH}`).join(' ')}
                    fill="none" stroke="#f97316" strokeWidth={Math.max(2, lightbox.imgW * 0.003)}
                  />
                )}
                {/* Coins — points orange */}
                {lightbox.yoloCorners && lightbox.yoloCorners.map((p, i) => (
                  <circle key={i} cx={p.x * lightbox.imgW} cy={p.y * lightbox.imgH}
                    r={Math.max(5, lightbox.imgW * 0.006)} fill="#f97316" />
                ))}
                {/* Badge confiance + méthode finale */}
                <rect x={lightbox.yoloBbox.x1 * lightbox.imgW} y={lightbox.yoloBbox.y1 * lightbox.imgH - lightbox.imgH * 0.042}
                  width={lightbox.imgW * 0.072} height={lightbox.imgH * 0.038} fill="#22c55e" rx={lightbox.imgW * 0.003} />
                <text x={lightbox.yoloBbox.x1 * lightbox.imgW + lightbox.imgW * 0.005} y={lightbox.yoloBbox.y1 * lightbox.imgH - lightbox.imgH * 0.01}
                  fill="#000" fontSize={lightbox.imgH * 0.026} fontFamily="monospace" fontWeight="bold">
                  {Math.round(lightbox.yoloBbox.conf * 100)}%
                </text>
                {lightbox.yoloDebug?.method && (
                  <text x={lightbox.yoloBbox.x1 * lightbox.imgW + lightbox.imgW * 0.078}
                    y={lightbox.yoloBbox.y1 * lightbox.imgH - lightbox.imgH * 0.012}
                    fill="#f97316" fontSize={lightbox.imgH * 0.022}
                    fontFamily="monospace" fontWeight="bold">
                    {lightbox.yoloDebug.method.split(':')[0]}
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
                            nudge.x, nudge.y, zm, true, wOpts
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
              <div style={{ position: "absolute", inset: 0, cursor: adjustDrag ? "grabbing" : "crosshair" }}>
                {manualPlateMode && !adjustDrag && (
                  <div style={{ position: "absolute", bottom: 10, left: "50%", transform: "translateX(-50%)", background: "rgba(0,0,0,0.75)", color: "#f26522", fontSize: 10, fontFamily: "'JetBrains Mono',monospace", padding: "5px 12px", borderRadius: 3, letterSpacing: 1, whiteSpace: "nowrap", pointerEvents: "none" }}>
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
                        fontSize: isMobile ? 13 : 11, color: "#fff", fontWeight: 700, lineHeight: 1,
                        userSelect: "none",
                      }}
                    >✥</div>
                  );
                })()}
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
            <div onClick={e => e.stopPropagation()} style={{ width: "100%", maxWidth: "min(1100px, 100vw - 32px)", marginTop: 10, padding: "10px 16px 8px", background: "#161616", border: "1px solid #222", borderRadius: 3 }}>
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
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, fontSize: 9, color: "#555", fontFamily: "'JetBrains Mono',monospace" }}>
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
                    fontSize: 20,
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
              <span style={{ fontSize: 16, userSelect: "none" }}>🔍</span>
              <input
                type="range"
                min="0.5" max="2.5" step="0.05"
                value={showroomZoom}
                onChange={e => onZoomChange(parseFloat(e.target.value))}
                disabled={showroomNudging}
                style={{ flex: 1, accentColor: "#f26522", cursor: showroomNudging ? "not-allowed" : "pointer", height: 4 }}
              />
              <span style={{ fontSize: 10, color: "#f26522", fontFamily: "'JetBrains Mono',monospace", minWidth: 34, textAlign: "right" }}>
                ×{showroomZoom.toFixed(2)}
              </span>
              {showroomNudging && <span style={{ fontSize: 10, color: "#666", fontFamily: "'JetBrains Mono',monospace" }}>…</span>}
            </div>
          )}

          {/* ── Pied ── */}
          <div style={{ marginTop: 8, fontSize: 9, color: "#666", fontFamily: "'JetBrains Mono',monospace", textAlign: "center" }}>
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

      {/* ── Modal Nous Contacter ── */}
      {showContactModal && (
        <div onClick={() => setShowContactModal(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.82)", zIndex: 9000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: "#111", border: "1px solid #222", borderRadius: 6, width: "92%", maxWidth: 420, fontFamily: "'Rajdhani',sans-serif" }}>
            <div style={{ padding: "20px 24px 16px", borderBottom: "1px solid #1c1c1c", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ fontSize: 11, letterSpacing: 3, color: "#f26522", textTransform: "uppercase", fontFamily: "'JetBrains Mono',monospace" }}>Nous contacter</div>
              <button onClick={() => setShowContactModal(false)} style={{ background: "none", border: "none", color: "#555", fontSize: 20, cursor: "pointer", lineHeight: 1 }}>✕</button>
            </div>
            <div style={{ padding: "20px 24px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
              {[
                { icon: "✉", label: "E-mail", value: "contact.asgs29200@gmail.com", href: "mailto:contact.asgs29200@gmail.com" },
                { icon: "📞", label: "Téléphone", value: "07 56 98 17 29", href: "tel:+33756981729" },
              ].map(({ icon, label, value, href }) => (
                <a key={label} href={href}
                  style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 16px", background: "#0a0a0a", border: "1px solid #1c1c1c", borderRadius: 4, textDecoration: "none", cursor: "pointer" }}>
                  <span style={{ fontSize: 20 }}>{icon}</span>
                  <div>
                    <div style={{ fontSize: 10, color: "#555", letterSpacing: 2, textTransform: "uppercase", fontFamily: "'JetBrains Mono',monospace", marginBottom: 3 }}>{label}</div>
                    <div style={{ fontSize: 15, color: "#ddd5c8", fontWeight: 700, letterSpacing: 0.5 }}>{value}</div>
                  </div>
                </a>
              ))}
            </div>
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
                  <div style={{ fontSize: 11, letterSpacing: 3, color: "#f26522", textTransform: "uppercase", fontFamily: "'JetBrains Mono',monospace", marginBottom: 4 }}>Mes informations</div>
                  <div style={{ fontSize: 13, color: "#555" }}>Données personnelles associées à votre compte</div>
                </div>
                <button onClick={() => setShowProfileModal(false)} style={{ background: "none", border: "none", color: "#555", fontSize: 20, cursor: "pointer", lineHeight: 1 }}>✕</button>
              </div>
              {/* Rows */}
              <div style={{ padding: "8px 0 16px" }}>
                {rows.map(({ label, value }) => (
                  <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 24px", borderBottom: "1px solid #161616" }}>
                    <span style={{ fontSize: 12, color: "#666", letterSpacing: 1, textTransform: "uppercase", fontFamily: "'JetBrains Mono',monospace" }}>{label}</span>
                    <span style={{ fontSize: 14, color: value === "—" ? "#333" : "#ddd5c8", fontWeight: 600, maxWidth: 260, textAlign: "right", wordBreak: "break-all" }}>{value}</span>
                  </div>
                ))}
              </div>
              {/* Footer note */}
              <div style={{ padding: "12px 24px", borderTop: "1px solid #1c1c1c" }}>
                <div style={{ fontSize: 11, color: "#444", fontFamily: "'JetBrains Mono',monospace", lineHeight: 1.6 }}>
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
            <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: 2, color: "#e0dbd4", marginBottom: 6, textTransform: "uppercase" }}>Code Promo</div>
            <div style={{ fontSize: 10, color: "#666", fontFamily: "'JetBrains Mono',monospace", marginBottom: 20 }}>Entrez votre code pour débloquer des photos supplémentaires.</div>
            <input
              value={promoCode} onChange={e => { setPromoCode(e.target.value); setPromoStatus(null); setPromoMsg(""); }}
              onKeyDown={e => e.key === "Enter" && promoCode.trim() && promoStatus !== "loading" && submitPromo()}
              placeholder="Votre code promo"
              style={{ width: "100%", boxSizing: "border-box", padding: "11px 14px", background: "#1a1a1a", border: `1px solid ${promoStatus === "error" ? "#c0392b" : promoStatus === "success" ? "#27ae60" : "#2a2a2a"}`, borderRadius: 3, color: "#ddd5c8", fontFamily: "'JetBrains Mono',monospace", fontSize: 15, letterSpacing: 3, textTransform: "uppercase", outline: "none", marginBottom: 10 }}
            />
            {promoMsg && (
              <div style={{ fontSize: 10, fontFamily: "'JetBrains Mono',monospace", color: promoStatus === "success" ? "#27ae60" : "#c0392b", marginBottom: 14, letterSpacing: 1 }}>
                {promoMsg}
              </div>
            )}
            <button
              onClick={submitPromo}
              disabled={!promoCode.trim() || promoStatus === "loading" || promoStatus === "success"}
              style={{ width: "100%", background: promoStatus === "success" ? "#27ae60" : (!promoCode.trim() || promoStatus === "loading") ? "#1a1a1a" : "#f26522", color: promoStatus === "success" ? "#fff" : (!promoCode.trim() || promoStatus === "loading") ? "#444" : "#090909", border: "none", padding: "13px 0", fontFamily: "'Rajdhani',sans-serif", fontSize: 14, fontWeight: 700, letterSpacing: 3, textTransform: "uppercase", borderRadius: 3, cursor: promoStatus === "loading" || promoStatus === "success" ? "default" : "pointer", marginBottom: 10 }}>
              {promoStatus === "loading" ? "Vérification..." : promoStatus === "success" ? "Code activé ✓" : "Activer"}
            </button>
            <button onClick={() => setShowPromoModal(false)}
              style={{ width: "100%", background: "transparent", color: "#555", border: "1px solid #2a2a2a", padding: "9px 0", fontFamily: "'JetBrains Mono',monospace", fontSize: 10, letterSpacing: 2, textTransform: "uppercase", borderRadius: 3, cursor: "pointer" }}>
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
                  <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: 3, color: "#e0dbd4", textTransform: "uppercase" }}>Nos Abonnements</div>
                  <div style={{ fontSize: 10, color: "#666", fontFamily: "'JetBrains Mono',monospace", marginTop: 6, letterSpacing: 1 }}>
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
                        { ok: true,  label: "Lustrage des optiques" },
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
                        { ok: true, label: "Lustrage des optiques" },
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
                          <div style={{ position: "absolute", top: -10, left: "50%", transform: "translateX(-50%)", background: "#f26522", color: "#090909", fontSize: 8, fontWeight: 700, letterSpacing: 2, padding: "3px 10px", borderRadius: 10, fontFamily: "'JetBrains Mono',monospace", textTransform: "uppercase", whiteSpace: "nowrap" }}>{plan.badge}</div>
                        )}
                        <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: 2, color: isPro ? "#f26522" : "#aaa", textTransform: "uppercase", marginBottom: 4 }}>{plan.name}</div>
                        <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginBottom: 2 }}>
                          <span style={{ fontSize: 22, fontWeight: 700, color: isPro ? "#f26522" : "#ccc" }}>{plan.price}</span>
                          <span style={{ fontSize: 9, color: "#555", fontFamily: "'JetBrains Mono',monospace", letterSpacing: 1 }}>/mois</span>
                        </div>
                        <div style={{ marginBottom: 20, marginTop: 14 }}>
                          {plan.features.map((f, i) => (
                            <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 7 }}>
                              <span style={{ fontSize: 11, color: f.ok ? "#27ae60" : "#444", flexShrink: 0 }}>{f.ok ? "✓" : "✕"}</span>
                              <span style={{ fontSize: 10, color: f.ok ? "#bbb" : "#444", fontFamily: "'JetBrains Mono',monospace", letterSpacing: 0.5 }}>{f.label}</span>
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
                          style={{ width: "100%", background: isPro ? "#f26522" : "transparent", color: isPro ? "#090909" : "#777", border: `1px solid ${isPro ? "#f26522" : "#333"}`, padding: "10px 0", fontFamily: "'Rajdhani',sans-serif", fontSize: 12, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", borderRadius: 3, cursor: "pointer" }}>
                          {checkoutLoading === plan.key ? "Redirection..." : `Choisir ${plan.name}`}
                        </button>
                      </div>
                    );
                  })}
                </div>

                <button onClick={() => setShowPlansModal(false)}
                  style={{ width: "100%", background: "transparent", color: "#555", border: "1px solid #2a2a2a", padding: "9px 0", fontFamily: "'JetBrains Mono',monospace", fontSize: 10, letterSpacing: 2, textTransform: "uppercase", borderRadius: 3, cursor: "pointer" }}>
                  Fermer
                </button>
              </>
            ) : (
              /* ── Vue gestion abonnement (utilisateurs abonnés) ── */
              <>
                {/* En-tête */}
                <div style={{ textAlign: "center", marginBottom: 32 }}>
                  <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: 3, color: "#e0dbd4", textTransform: "uppercase" }}>Mon Abonnement</div>
                  <div style={{ fontSize: 10, color: "#666", fontFamily: "'JetBrains Mono',monospace", marginTop: 6, letterSpacing: 1 }}>
                    Plan actif : <span style={{ color: "#f26522", fontWeight: 700 }}>
                      {userPlan === "pro" ? "Pro" : "Essentiel"}
                    </span>
                  </div>
                </div>

                {/* Badge plan */}
                <div style={{ background: userPlan === "pro" ? "rgba(242,101,34,0.08)" : "#0e0e0e", border: `1px solid ${userPlan === "pro" ? "#f26522" : "#2a2a2a"}`, borderRadius: 6, padding: "20px 24px", marginBottom: 20, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div>
                    <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: 2, color: userPlan === "pro" ? "#f26522" : "#ccc", textTransform: "uppercase" }}>
                      {userPlan === "pro" ? "Pro" : "Essentiel"}
                    </div>
                    <div style={{ fontSize: 9, color: "#555", fontFamily: "'JetBrains Mono',monospace", marginTop: 4, letterSpacing: 1 }}>
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
                    style={{ width: "100%", background: "#f26522", color: "#090909", border: "none", padding: "13px 0", fontFamily: "'Rajdhani',sans-serif", fontSize: 13, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", borderRadius: 3, cursor: "pointer", marginBottom: 10 }}>
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
                        style={{ width: "100%", background: "transparent", color: "#ccc", border: "1px solid #333", padding: "12px 0", fontFamily: "'Rajdhani',sans-serif", fontSize: 13, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", borderRadius: 3, cursor: !!portalLoading ? "wait" : "pointer", marginBottom: 10 }}>
                        {portalLoading === "invoices" ? "Ouverture..." : "Factures & Historique"}
                      </button>

                      {portalError && (
                        <div style={{ fontSize: 10, color: "#c0392b", fontFamily: "'JetBrains Mono',monospace", marginBottom: 10, padding: "8px 12px", background: "rgba(192,57,43,0.08)", border: "1px solid rgba(192,57,43,0.2)", borderRadius: 3 }}>
                          ⚠ {portalError}
                        </div>
                      )}

                      <button onClick={() => { setShowPlansModal(false); setPortalError(""); }}
                        style={{ width: "100%", background: "transparent", color: "#555", border: "1px solid #1e1e1e", padding: "9px 0", fontFamily: "'JetBrains Mono',monospace", fontSize: 10, letterSpacing: 2, textTransform: "uppercase", borderRadius: 3, cursor: "pointer", marginBottom: 24 }}>
                        Fermer
                      </button>

                      <div style={{ borderTop: "1px solid #1a1a1a", paddingTop: 18, textAlign: "center" }}>
                        <button
                          disabled={!!portalLoading}
                          onClick={() => openPortal("cancel")}
                          style={{ background: "transparent", color: "#444", border: "none", fontFamily: "'JetBrains Mono',monospace", fontSize: 9, letterSpacing: 1, textTransform: "uppercase", cursor: !!portalLoading ? "wait" : "pointer", textDecoration: "underline" }}>
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
            <div style={{ fontSize: 32, marginBottom: 12 }}>⬡</div>
            <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: 2, color: "#e0dbd4", marginBottom: 4, textTransform: "uppercase" }}>Showroom Virtuel</div>
            <div style={{ fontSize: 11, color: "#f26522", letterSpacing: 2, fontFamily: "'JetBrains Mono',monospace", marginBottom: 16, textTransform: "uppercase" }}>Abonnement Pro requis</div>
            <div style={{ fontSize: 13, color: "#888", lineHeight: 1.7, marginBottom: 28, fontFamily: "'JetBrains Mono',monospace" }}>
              Le mode Showroom Virtuel — détourage IA et fonds de showroom — est inclus dans l'abonnement <span style={{ color: "#f26522", fontWeight: 700 }}>Pro</span>.<br /><br />
              Contactez-nous pour mettre votre compte à niveau.
            </div>
            <button onClick={() => { setShowUpgradeProModal(false); window.open("mailto:contact@autocache.fr?subject=Abonnement Pro AutoCache", "_blank"); }}
              style={{ width: "100%", background: "#f26522", color: "#090909", border: "none", padding: "13px 0", fontFamily: "'Rajdhani',sans-serif", fontSize: 14, fontWeight: 700, letterSpacing: 3, textTransform: "uppercase", borderRadius: 3, cursor: "pointer", marginBottom: 10 }}>
              Passer à l'abonnement Pro
            </button>
            <button onClick={() => setShowUpgradeProModal(false)}
              style={{ width: "100%", background: "transparent", color: "#555", border: "1px solid #2a2a2a", padding: "9px 0", fontFamily: "'JetBrains Mono',monospace", fontSize: 10, letterSpacing: 2, textTransform: "uppercase", borderRadius: 3, cursor: "pointer" }}>
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
              <div style={{ fontSize: 13, color: "#c0392b", fontFamily: "'JetBrains Mono',monospace", letterSpacing: 2, textTransform: "uppercase", marginBottom: 8 }}>Essai gratuit terminé</div>
              <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: 3, color: "#e0dbd4", textTransform: "uppercase", marginBottom: 10 }}>Continuez à sublimer vos photos</div>
              <div style={{ fontSize: 11, color: "#666", fontFamily: "'JetBrains Mono',monospace", lineHeight: 1.7 }}>
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
                    { ok: true,  label: "Lustrage des optiques" },
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
                    { ok: true, label: "Lustrage des optiques" },
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
                      <div style={{ position: "absolute", top: -10, left: "50%", transform: "translateX(-50%)", background: "#f26522", color: "#090909", fontSize: 8, fontWeight: 700, letterSpacing: 2, padding: "3px 10px", borderRadius: 10, fontFamily: "'JetBrains Mono',monospace", textTransform: "uppercase", whiteSpace: "nowrap" }}>{plan.badge}</div>
                    )}
                    <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: 2, color: isPro ? "#f26522" : "#aaa", textTransform: "uppercase", marginBottom: 2 }}>{plan.name}</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: "#e0dbd4", marginBottom: 14, fontFamily: "'JetBrains Mono',monospace" }}>{plan.price}<span style={{ fontSize: 10, color: "#555", fontWeight: 400 }}> /mois</span></div>
                    <div style={{ marginBottom: 18 }}>
                      {plan.features.map((f, i) => (
                        <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                          <span style={{ fontSize: 11, color: f.ok ? "#27ae60" : "#444", flexShrink: 0 }}>{f.ok ? "✓" : "✕"}</span>
                          <span style={{ fontSize: 10, color: f.ok ? "#bbb" : "#444", fontFamily: "'JetBrains Mono',monospace" }}>{f.label}</span>
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
                      style={{ width: "100%", background: isPro ? "#f26522" : "transparent", color: isPro ? "#090909" : "#888", border: `1px solid ${isPro ? "#f26522" : "#333"}`, padding: "10px 0", fontFamily: "'Rajdhani',sans-serif", fontSize: 12, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", borderRadius: 3, cursor: "pointer" }}>
                      {checkoutLoading === plan.key ? "Redirection..." : `Choisir ${plan.name}`}
                    </button>
                  </div>
                );
              })}
            </div>

            <button onClick={() => setShowUpgradeModal(false)}
              style={{ width: "100%", background: "transparent", color: "#444", border: "1px solid #222", padding: "9px 0", fontFamily: "'JetBrains Mono',monospace", fontSize: 10, letterSpacing: 2, textTransform: "uppercase", borderRadius: 3, cursor: "pointer" }}>
              Fermer
            </button>
          </div>
        </div>
      )}

      {/* ── Overlay chargement ── */}
      {processing && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(10,10,10,0.88)", zIndex: 9000, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 20 }}>
          <span className="ac-spinner" style={{ width: 52, height: 52, borderTop: "5px solid #f26522", borderRight: "5px solid #f26522", borderBottom: "5px solid #f26522", borderLeft: "5px solid transparent", borderRadius: "50%", display: "inline-block" }} />
          <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: "#f26522", letterSpacing: 3, textTransform: "uppercase" }}>
            Traitement {progress.n} / {progress.total}
          </div>
          <div style={{ width: 200, height: 2, background: "#1e1e1e", borderRadius: 1, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${pct}%`, background: "#f26522", transition: "width 0.4s ease" }} />
          </div>
        </div>
      )}
    </div>
  );
}
