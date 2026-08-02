import { useState, useRef, useEffect, useCallback, Fragment } from "react";
import MaskEditor from "./components/MaskEditor.jsx";
import Tutorial from "./components/Tutorial.jsx";
import HelpWidget from "./components/HelpWidget.jsx";
import LoadingGame from "./components/LoadingGame.jsx";
import AuthTransition, { AUTH_MOTION_CSS, AUTH_EXIT_MS, prefersReducedMotion } from "./components/AuthTransition.jsx";
import ProcessingIndicator, { ProcessingLabel, PROCESSING_MOTION_CSS, PROCESSING_EXIT_MS } from "./components/ProcessingMotion.jsx";
import { orderQuad, quadArea, snapQuadOutward, fitQuadEdges, quadCoversBox, quadFromBox, plateQuadFromCrop, expandQuad } from "./plateGeometry.js";
import { detectPlateKeypoints, preloadPlateKeypoints } from "./plateKeypoints.js";
import { plateList, plateFields, defaultPlateQuad } from "./plateCaches.js";
import ShowroomCapture from "./components/ShowroomCapture.jsx";
import Spin360 from "./components/Spin360.jsx";
import { isSpinUsable } from "./showroomInteractif.js";
// @imgly background removal — chargé dynamiquement
let removeBgImgly = null;
import { createClient } from "@supabase/supabase-js";
import { photosForFormule, periodsElapsed, advanceAnchor, quotaLabel } from "./subscriptionQuota.js";

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.innerWidth <= 767);
  useEffect(() => {
    const h = () => setIsMobile(window.innerWidth <= 767);
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, []);
  return isMobile;
}

// ── Installation de l'app (PWA) sur l'écran d'accueil ────────────────────
function isStandaloneDisplay() {
  return typeof window !== "undefined" && (
    window.matchMedia?.("(display-mode: standalone)")?.matches ||
    window.navigator.standalone === true // Safari iOS
  );
}
function isIOSDevice() {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
}
function useInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [installed, setInstalled] = useState(() => isStandaloneDisplay());
  useEffect(() => {
    const onBeforeInstall = (e) => { e.preventDefault(); setDeferredPrompt(e); };
    const onInstalled = () => { setInstalled(true); setDeferredPrompt(null); };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);
  const promptInstall = useCallback(async () => {
    if (!deferredPrompt) return false;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    return outcome === "accepted";
  }, [deferredPrompt]);
  const isIOS = isIOSDevice();
  return { canInstall: !!deferredPrompt, isIOS, installed, promptInstall };
}

// Modal d'instructions d'installation manuelle : Safari iOS ne propose jamais
// d'invite automatique, et certains navigateurs Android non plus.
function InstallHelpModal({ onClose, ios }) {
  const steps = ios ? [
    ["📤", <>1. Appuyez sur le bouton <b>Partager</b> de Safari (en bas de l'écran).</>],
    ["➕", <>2. Choisissez <b>Sur l'écran d'accueil</b>.</>],
    ["✓",  <>3. Confirmez avec <b>Ajouter</b>.</>],
  ] : [
    ["⋮",  <>1. Ouvrez le menu du navigateur (en haut à droite).</>],
    ["➕", <>2. Choisissez <b>Installer l'application</b> ou <b>Ajouter à l'écran d'accueil</b>.</>],
    ["✓",  <>3. Confirmez avec <b>Installer</b>.</>],
  ];
  return (
    <div onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.82)", zIndex: 9500, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: "var(--c-111)", border: "1px solid var(--c-222)", borderRadius: 6, width: "92%", maxWidth: 380, fontFamily: "var(--font-apple)" }}>
        <div style={{ padding: "20px 24px 16px", borderBottom: "1px solid var(--c-1c1c1c)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontSize: 12, letterSpacing: 3, color: "#f26522", textTransform: "uppercase", fontFamily: "var(--font-apple)" }}>Installer l'application</div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--c-ddd)", fontSize: 21, cursor: "pointer", lineHeight: 1 }}>✕</button>
        </div>
        <div style={{ padding: "20px 24px 24px", display: "flex", flexDirection: "column", gap: 14, fontSize: 13, color: "var(--c-ddd5c8)", lineHeight: 1.6 }}>
          {steps.map(([icon, text], i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontSize: 20, width: 26, textAlign: "center" }}>{icon}</span>
              <span>{text}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const SUPABASE_URL = "https://vwfqwfmrllnbbxyvhjht.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ3ZnF3Zm1ybGxuYmJ4eXZoamh0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyNjUxMjgsImV4cCI6MjA4OTg0MTEyOH0.0BJUku8o25mEOmpx4rXiPkHLEI-GkxmCGBCRc00M4OA";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

// ── Appels à /api : le jeton de session accompagne chaque requête ──────────
// Toutes les fonctions serveur exigent désormais un compte connecté. L'identité
// est portée par ce jeton, signé par Supabase, et non plus par un identifiant
// écrit dans le corps de la requête — qu'un appelant pouvait choisir librement.
async function authHeaders(extra = {}) {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  };
}

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
// underline : 0 = aucun trait, 1–10 = épaisseur du filet sous le texte
function makeLogoDataURL(text, bg, fg, radius, fontKey = "impact", borderColor = null, borderWidth = 0, underline = 0) {
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
  // Avec un filet, le texte remonte un peu : c'est le bloc texte + trait qui
  // doit rester centré dans la plaque, pas le texte seul.
  const ul = Math.max(0, Math.min(10, Math.round(underline || 0)));
  const cy = ul > 0 ? H / 2 - H * 0.055 : H / 2;
  ctx.fillText(txt, W / 2, cy);

  // Filet sous le texte — un peu plus large que le texte pour l'encadrer
  // (comme sur une plaque de concession), sans jamais toucher les bords.
  if (ul > 0) {
    const lw = Math.max(2, Math.round(H * 0.004 * ul));
    const textW = ctx.measureText(txt).width;
    const lineW = Math.min(W * 0.88, Math.max(textW * 1.08, W * 0.5));
    const y = cy + sz * 0.56 + H * 0.03;
    ctx.fillStyle = fg;
    ctx.fillRect((W - lineW) / 2, Math.round(y - lw / 2), lineW, lw);
  }

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

// Compose une enseigne (logo + titre + sous-titre) sur un PNG transparent.
// Renvoie { url, ratio } (ratio = hauteur/largeur de la zone réellement occupée).
function makeSignDataURL({ logoImg = null, title = "", titleColor = "#ffffff", fontKey = "rajdhani", subtitle = "", subtitleColor = "#ffffff" }) {
  const f = WALL_FONTS.find(x => x.key === fontKey) ?? WALL_FONTS[0];
  const meas = document.createElement("canvas").getContext("2d");
  meas.textBaseline = "middle";

  const hasTitle = !!title.trim();
  const hasSub   = !!subtitle.trim();
  const titleSize = 200;
  const subSize   = 84;
  const PAD = 40;

  meas.font = `${f.weight} ${titleSize}px ${f.family}`;
  const titleW = hasTitle ? meas.measureText(title).width : 0;
  meas.font = `${f.weight} ${subSize}px ${f.family}`;
  const subW = hasSub ? meas.measureText(subtitle).width : 0;

  let logoW = 0, logoH = 0;
  if (logoImg) {
    logoH = hasTitle ? titleSize * 1.15 : 230;
    const ar = (logoImg.naturalWidth || logoImg.width) / (logoImg.naturalHeight || logoImg.height);
    logoW = logoH * ar;
  }
  const gap = (logoImg && hasTitle) ? 60 : 0;
  const rowW = logoW + gap + titleW;
  const rowH = Math.max(logoH, hasTitle ? titleSize : 0);
  const subGap = (hasSub && rowH) ? 50 : 0;
  const contentW = Math.max(rowW, subW);
  const contentH = rowH + subGap + (hasSub ? subSize : 0);
  if (contentW < 1 || contentH < 1) return { url: null, ratio: 0.4 };

  const c = document.createElement("canvas");
  c.width = Math.ceil(contentW + PAD * 2);
  c.height = Math.ceil(contentH + PAD * 2);
  const ctx = c.getContext("2d");
  ctx.textBaseline = "middle";

  const rowCY = PAD + rowH / 2;
  let x = (c.width - rowW) / 2;
  if (logoImg) { ctx.drawImage(logoImg, x, rowCY - logoH / 2, logoW, logoH); x += logoW + gap; }
  if (hasTitle) {
    ctx.font = `${f.weight} ${titleSize}px ${f.family}`;
    ctx.fillStyle = titleColor;
    ctx.textAlign = "left";
    ctx.fillText(title, x, rowCY);
  }
  if (hasSub) {
    ctx.font = `${f.weight} ${subSize}px ${f.family}`;
    ctx.fillStyle = subtitleColor;
    ctx.textAlign = "center";
    ctx.fillText(subtitle, c.width / 2, PAD + rowH + subGap + subSize / 2);
  }
  return { url: c.toDataURL("image/png"), ratio: c.height / c.width };
}

// Superpose une enseigne (PNG transparent) sur une image, centrée sur `pos`
// (coords normalisées 0..1) et large de `scale` × la largeur de l'image.
async function overlaySignOnImage(baseUrl, signUrl, pos = { x: 0.5, y: 0.16 }, scale = 0.64) {
  if (!signUrl) return baseUrl;
  const [base, sign] = await Promise.all([loadImg(baseUrl), loadImg(signUrl)]);
  const W = base.naturalWidth || base.width, H = base.naturalHeight || base.height;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d");
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
  ctx.drawImage(base, 0, 0, W, H);
  const sw = W * scale;
  const sh = sw * ((sign.naturalHeight || sign.height) / (sign.naturalWidth || sign.width));
  ctx.drawImage(sign, pos.x * W - sw / 2, pos.y * H - sh / 2, sw, sh);
  return c.toDataURL("image/jpeg", 0.95);
}

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

// Tailles d'essai successives (côté le plus long) pour ranger le logo dans le
// quota du navigateur. Un cache plaque est composité sur quelques centaines de
// pixels : même le dernier palier reste net à l'usage.
const LOGO_STORE_SIDES = [1600, 900, 500, 280];

// Réduit un data URL s'il dépasse `maxSide`, sinon le renvoie tel quel.
// Renvoie null si l'image est illisible — l'appelant renonce alors sans casser.
async function shrinkDataURL(dataURL, maxSide) {
  try {
    const img = await loadImg(dataURL);
    const longest = Math.max(img.naturalWidth, img.naturalHeight);
    if (!longest) return null;
    const scale = Math.min(1, maxSide / longest);
    if (scale === 1) return dataURL;
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.naturalWidth * scale));
    c.height = Math.max(1, Math.round(img.naturalHeight * scale));
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/png');
  } catch (e) { return null; }
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

  // Le cache est-il quasi rectangulaire ? Cette réponse fixe la résolution
  // d'arrivée de la source : le chemin rapide (étape 2) dessine directement à
  // plateW, le chemin perspective (étape 3) passe par un offscreen supersamplé
  // à plateW × SS_MAX.
  const SS_MAX = 4;
  const eps = 1.5;
  const axisAligned = Math.abs(tl.y - tr.y) < eps && Math.abs(bl.y - br.y) < eps &&
                      Math.abs(tl.x - bl.x) < eps && Math.abs(tr.x - br.x) < eps;
  const consumerW = axisAligned ? plateW : plateW * SS_MAX;

  // ── Step 1: réduction progressive de la source ──
  // drawImage réduit proprement d'un facteur 2 et se dégrade au-delà de 4.
  // On amène donc la source à 2× la résolution d'arrivée : halvings successifs
  // puis un dernier pas à la taille exacte. Sans cela, un cache généré de
  // 3120 px atterrissait en UN seul drawImage sur une plaque de ~150 px
  // (réduction ×20) — d'où le texte crénelé, très visible en zoomant.
  // La source ne descend jamais sous la résolution d'arrivée : elle serait
  // sinon ré-agrandie en aval (cache flou).
  const targetW = Math.min(iw, Math.max(2, Math.round(consumerW * 2)));
  let src = img, sw = iw, sh = ih;
  const dropSrc = () => { if (src !== img) freeCanvas(src); };
  while (sw > targetW * 2 && sw > 2) {
    const half = document.createElement('canvas');
    half.width = Math.max(1, Math.round(sw / 2));
    half.height = Math.max(1, Math.round(sh / 2));
    const hCtx = half.getContext('2d');
    hCtx.imageSmoothingEnabled = true;
    hCtx.imageSmoothingQuality = 'high';
    hCtx.drawImage(src, 0, 0, half.width, half.height);
    dropSrc();
    src = half; sw = half.width; sh = half.height;
  }
  if (sw > targetW * 1.05) {
    const fin = document.createElement('canvas');
    fin.width = targetW;
    fin.height = Math.max(1, Math.round(sh * targetW / sw));
    const fCtx = fin.getContext('2d');
    fCtx.imageSmoothingEnabled = true;
    fCtx.imageSmoothingQuality = 'high';
    fCtx.drawImage(src, 0, 0, fin.width, fin.height);
    dropSrc();
    src = fin; sw = fin.width; sh = fin.height;
  }

  // ── Step 2: axis-aligned fast path ──
  // Near-rectangular plates bypass the band decomposition entirely
  // for a single, clean drawImage call.
  if (axisAligned) {
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, tl.x, tl.y, tr.x - tl.x, bl.y - tl.y);
    ctx.restore();
    dropSrc();
    return;
  }

  // ── Step 3: supersampled perspective ──
  const ssScale = Math.max(1, Math.min(sw / plateW, SS_MAX));
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
    freeCanvas(offCanvas);
  }
  dropSrc();
}

// ?plateDebug=raw : laisse la plaque VISIBLE et n'affiche que l'overlay des
// coins détectés. Permet de voir où le modèle place réellement ses 4 points
// au lieu de le déduire d'un cache qui les recouvre.
function plateDebugRaw() {
  return typeof window !== 'undefined' && window.location.search.includes('plateDebug=raw');
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
  // Deux canvas pleine taille viennent de vivre en même temps que le canvas
  // principal : on les rend tout de suite, sans attendre le GC.
  freeCanvas(off, mask);
}

// ── Amélioration photo style "pro" ────────────────────────────────────────────
// Reproduit le traitement appliqué par les outils IA haut de gamme :
//   1. Refroidissement WB marqué (supprime la dominante jaune/chaude LED)
//   2. Courbe S (ombres plus profondes, hautes lumières préservées)
//   3. Boost de saturation (bleus plus vifs, couleurs carrosserie plus engageantes)
function autoEnhance(ctx, W, H, intensity = 5, photoName = '') {
  const k = Math.max(0, Math.min(5, Number(intensity))) / 5 * 1.2; // 0 = aucun effet, 1 = pleine intensité (×1.2 = +20 % de boost global)
  if (k === 0) {
    console.log('[Enhance]', photoName, 'skipped (intensity=0)');
    return;
  }

  const id = ctx.getImageData(0, 0, W, H);
  const d  = id.data;

  const sCurve = v => v < 0.5
    ? 0.5 * Math.pow(v * 2, 1.17)
    : 1 - 0.5 * Math.pow((1 - v) * 2, 0.87);

  // Refroidissement FIXE : dé-jaunit uniformément (rouge ↓, bleu ↑) pour une
  // luminosité plus blanche. Indépendant du contenu → deux photos de la même
  // scène reçoivent exactement la même correction (rendu cohérent).
  const rFactor = 1 + (0.90 - 1) * k;
  const gFactor = 1 + (0.97 - 1) * k;
  const bFactor = 1 + (1.11 - 1) * k;

  const rLUT = new Uint8Array(256);
  const gLUT = new Uint8Array(256);
  const bLUT = new Uint8Array(256);
  for (let v = 0; v < 256; v++) {
    const t = v / 255;
    rLUT[v] = Math.min(255, Math.max(0, Math.round(sCurve(t * rFactor) * 255)));
    gLUT[v] = Math.min(255, Math.max(0, Math.round(sCurve(t * gFactor) * 255)));
    bLUT[v] = Math.min(255, Math.max(0, Math.round(sCurve(Math.min(1, t * bFactor)) * 255)));
  }

  // Échantillonnage avant / après pour confirmer dans la console que la
  // correction colorimétrique a bien été appliquée sur CETTE photo.
  let rBefore = 0, gBefore = 0, bBefore = 0, rAfter = 0, gAfter = 0, bAfter = 0;
  const sampleStep = Math.max(4, Math.floor(d.length / 4 / 4096) * 4);
  let sampled = 0;
  for (let i = 0; i < d.length; i += sampleStep) {
    rBefore += d[i]; gBefore += d[i + 1]; bBefore += d[i + 2];
    sampled++;
  }

  const SAT = 1 + (1.17 - 1) * k;
  for (let i = 0; i < d.length; i += 4) {
    let r = rLUT[d[i]];
    let g = gLUT[d[i + 1]];
    let b = bLUT[d[i + 2]];
    const lum = r * 0.299 + g * 0.587 + b * 0.114;
    d[i]     = Math.max(0, Math.min(255, Math.round(lum + (r - lum) * SAT)));
    d[i + 1] = Math.max(0, Math.min(255, Math.round(lum + (g - lum) * SAT)));
    d[i + 2] = Math.max(0, Math.min(255, Math.round(lum + (b - lum) * SAT)));
  }
  for (let i = 0; i < d.length; i += sampleStep) {
    rAfter += d[i]; gAfter += d[i + 1]; bAfter += d[i + 2];
  }
  ctx.putImageData(id, 0, 0);

  if (sampled > 0) {
    const mean = (a, b, c) => +((a + b + c) / (3 * sampled)).toFixed(1);
    console.log('[Enhance]', photoName, {
      intensity,
      k: +k.toFixed(2),
      meanBefore: mean(rBefore, gBefore, bBefore),
      meanAfter:  mean(rAfter,  gAfter,  bAfter),
      deltaR:     +((rAfter - rBefore) / sampled).toFixed(1),
      deltaG:     +((gAfter - gBefore) / sampled).toFixed(1),
      deltaB:     +((bAfter - bBefore) / sampled).toFixed(1),
    });
  }
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


// Zoom appliqué par défaut à la voiture dans le décor showroom (la voiture
// paraissait trop petite par rapport au décor à l'échelle 1.0).
const DEFAULT_SHOWROOM_ZOOM = 1.25;

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

// Libère immédiatement le backing-store (RAM/GPU) d'un canvas temporaire au lieu
// d'attendre le ramasse-miettes. Décisif sur mobile : sans ça, les canvas du
// pipeline Showroom s'accumulent et la pression mémoire fait recharger l'onglet
// (symptôme « retour à l'accueil »). N'affecte ni la résolution ni la qualité du
// rendu final — on ne libère que des canvas intermédiaires déjà exploités.
// Appareil mobile (iOS/Android) : WebKit tue l'onglet (page blanche + retour
// accueil) quand la mémoire canvas cumulée explose. Les pipelines plafonnent
// leurs résolutions de travail sur ces appareils.
function isMobileDevice() {
  return typeof navigator !== "undefined" && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
}

function freeCanvas(...cs) {
  for (const c of cs) { if (c) { c.width = 0; c.height = 0; } }
}

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
      const out = c.toDataURL('image/jpeg', quality);
      freeCanvas(c);
      resolve(out);
    };
    img.src = dataUrl;
  });
}

// ── Segmentation véhicule — @imgly background removal ──

async function removeBackground(dataUrl) {
  return await imglyRemoveBackground(dataUrl);
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
  // Mobile : entrée réduite pour contenir le pic mémoire de l'inférence ONNX
  // (le détourage @imgly est l'étape la plus gourmande du pipeline showroom).
  const small = await shrinkDataUrl(dataUrl, isMobileDevice() ? 1400 : 2000, 0.96);
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

// ── Détourage Pro (API serveur — Photoroom / remove.bg, ombre IA incluse) ──
// Renvoie { dataUrl, provider, shadow } ou null → l'appelant retombe sur le
// pipeline local (@imgly + heuristiques). Un 501 signifie « endpoint non
// configuré » : on mémorise pour ne pas re-tenter à chaque photo du batch.
let proCutoutUnavailable = false;
async function proShowroomCutout(dataUrl) {
  if (proCutoutUnavailable) return null;
  if (window.location.search.includes('proCutout=off')) return null; // debug
  try {
    // Résolution supérieure au pipeline local (2000 px) : le détourage se
    // fait côté serveur, seule la taille du payload compte (limite 12 Mo).
    const small = await shrinkDataUrl(dataUrl, isMobileDevice() ? 2000 : 3000, 0.92);
    const b64 = small.includes(',') ? small.split(',')[1] : small;
    const r = await fetch('/api/showroom-cutout', {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify({ b64 }),
    });
    if (r.status === 501) {
      proCutoutUnavailable = true;
      console.log('[ProCutout] non configuré — pipeline local @imgly');
      return null;
    }
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      console.warn('[ProCutout] HTTP', r.status, body.slice(0, 300));
      return null;
    }
    const json = await r.json();
    if (!json?.dataUrl || json.dataUrl.length < 1000) return null;
    console.log(`[ProCutout] ok — ${json.provider}${json.shadow ? ' + ombre IA' : ''}`);
    return json;
  } catch (e) {
    console.warn('[ProCutout] échec:', e?.message);
    return null;
  }
}

function getShowroomDebugMode() {
  const url = window.location.search;
  if (url.includes('showroomDebug=mainVehicleBoxes')) return 'mainVehicleBoxes';
  if (url.includes('showroomDebug=mainROI')) return 'mainROI';
  if (url.includes('showroomDebug=mainMask')) return 'mainMask';
  if (url.includes('showroomDebug=mainMaskFinal')) return 'mainMask'; // alias
  if (url.includes('showroomDebug=car')) return 'car';
  if (url.includes('showroomDebug=final')) return null;
  return null;
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

// Moyenne RGB + luminance sur les pixels opaques d'un ImageData (alpha ≥ 16).
function _opaqueMean(data) {
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 16) continue;
    r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
  }
  if (!n) return null;
  r /= n; g /= n; b /= n;
  return { r, g, b, l: Math.max(1, 0.299 * r + 0.587 * g + 0.114 * b) };
}

async function compositeCarOnBg(cutoutDataUrl, bgDataUrl, W, H, logoImg = null, corners = null, bgColor = '#ffffff', offsetX = 0, offsetY = 0, zoom = 1.0, returnFull = false, wallLogoOpts = null, blend = 0, carBoundsHint = null, extraCorners = []) {
  const [bgImg, carImg, wallImg] = await Promise.all([
    loadImg(bgDataUrl),
    loadImg(cutoutDataUrl),
    wallLogoOpts?.src ? loadImg(wallLogoOpts.src) : null,
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
  let actualTopFrac    = 0.0;
  let actualBottomFrac = 1.0;
  let actualLeftFrac   = 0.0;
  let actualRightFrac  = 1.0;
  if (carBoundsHint && Number.isFinite(carBoundsHint.x) && Number.isFinite(carBoundsHint.w) && carBoundsHint.w > 0 && carBoundsHint.h > 0) {
    actualLeftFrac   = carBoundsHint.x / carImg.width;
    actualRightFrac  = (carBoundsHint.x + carBoundsHint.w) / carImg.width;
    actualTopFrac    = carBoundsHint.y / carImg.height;
    actualBottomFrac = (carBoundsHint.y + carBoundsHint.h) / carImg.height;
  } else {
    try {
      const scanC = document.createElement('canvas');
      scanC.width = carImg.width; scanC.height = carImg.height;
      const scanCtx = scanC.getContext('2d');
      scanCtx.drawImage(carImg, 0, 0);
      const imgData = scanCtx.getImageData(0, 0, carImg.width, carImg.height);
      const data = imgData.data;
      let minX = carImg.width, maxX = -1, minY = carImg.height, maxY = -1;
      // Seuil aligné sur le scan du pipeline (alpha > 128) : l'ombre IA du
      // détourage Pro est semi-transparente et ne doit pas entrer dans le
      // bbox, sinon la voiture bouge entre le rendu initial (hint) et les
      // recomposites sans hint (Ajuster, logo mural, correction de masque).
      for (let y = 0; y < carImg.height; y++) {
        for (let x = 0; x < carImg.width; x++) {
          if (data[(y * carImg.width + x) * 4 + 3] > 128) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
      if (maxX >= 0) {
        actualLeftFrac   = minX / carImg.width;
        actualRightFrac  = (maxX + 1) / carImg.width;
        actualTopFrac    = minY / carImg.height;
        actualBottomFrac = (maxY + 1) / carImg.height;
      }
      freeCanvas(scanC);
    } catch (_) { /* garder les valeurs par défaut */ }
  }

  // Centres visuels de la voiture (relatifs au cutout, 0..1).
  const carCenterFrac  = (actualLeftFrac + actualRightFrac) / 2;
  const carCenterFracY = (actualTopFrac + actualBottomFrac) / 2;
  // On décale le cutout pour que le centre visuel du véhicule tombe au centre
  // du décor (W/2, H/2), puis l'utilisateur peut ajuster avec offsetX/offsetY.
  const carX = W / 2 - carCenterFrac * cw + offsetX;
  const carY = H / 2 - carCenterFracY * ch + offsetY;

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

  // ── Debug: car only ──
  if (debugMode === 'car') {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, W, H);
    ctx.drawImage(carImg, carX, carY, cw, ch);
    const dataURL = c.toDataURL('image/jpeg', 0.98);
    if (returnFull) return { dataURL, baseURL: dataURL, transform: { carX, carY, cw, ch, W, H } };
    return dataURL;
  }

  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  let graded = false;
  if (blend > 0) {
    const t = Math.max(0, Math.min(100, blend)) / 100;
    // ── Fondu adaptatif : aligne l'exposition, la balance des blancs et la
    //    saturation du véhicule sur l'ambiance lumineuse réelle du décor là où
    //    il se pose. Corrige les gros écarts (voiture extérieure très lumineuse
    //    posée dans un showroom intérieur sombre) pour un rendu cohérent. ──
    let bgStats = null, carStats = null;
    try {
      const SS = 48;
      const bw = bgImg.naturalWidth || bgImg.width;
      const bh = bgImg.naturalHeight || bgImg.height;
      const sxBg = bw / W, syBg = bh / H;
      // Région du décor = boîte de la voiture élargie de 15 %, en coords natives du décor
      const ex = cw * 0.15, ey = ch * 0.15;
      let rx = (carX - ex) * sxBg, ry = (carY - ey) * syBg;
      let rw = (cw + 2 * ex) * sxBg, rh = (ch + 2 * ey) * syBg;
      rx = Math.max(0, Math.min(bw - 1, rx)); ry = Math.max(0, Math.min(bh - 1, ry));
      rw = Math.max(1, Math.min(bw - rx, rw)); rh = Math.max(1, Math.min(bh - ry, rh));
      const bgC = document.createElement('canvas'); bgC.width = SS; bgC.height = SS;
      const bgCtx = bgC.getContext('2d');
      bgCtx.drawImage(bgImg, rx, ry, rw, rh, 0, 0, SS, SS);
      bgStats = _opaqueMean(bgCtx.getImageData(0, 0, SS, SS).data);
      const carC = document.createElement('canvas'); carC.width = SS; carC.height = SS;
      const carCtx = carC.getContext('2d');
      carCtx.drawImage(carImg, 0, 0, SS, SS);
      carStats = _opaqueMean(carCtx.getImageData(0, 0, SS, SS).data);
      freeCanvas(bgC, carC);
    } catch (_) { /* fallback ci-dessous */ }

    if (bgStats && carStats) try {
      const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
      // ── Fondu v2 : intégration d'ambiance, jamais de délavage ──
      // L'ancienne version alignait la luminance MOYENNE de la voiture sur
      // celle du décor : sur un studio quasi blanc, une voiture sombre était
      // éclaircie jusqu'au plafond (+60 %) et désaturée → rendu passé/fané.
      // Une voiture rouge dans un showroom blanc reste rouge et brillante ;
      // seul l'éclairage ambiant doit se sentir. D'où : rapprochement
      // d'exposition LOGARITHMIQUE doux plafonné à ±18 %, balance des blancs
      // légère, saturation et contraste presque intacts.
      const gExp = clamp(Math.pow(bgStats.l / carStats.l, 0.25 * t), 0.85, 1.18);
      const colW = 0.35 * t;   // rapprochement de teinte (balance des blancs)
      const carCast = [carStats.r / carStats.l, carStats.g / carStats.l, carStats.b / carStats.l];
      const bgCast  = [bgStats.r  / bgStats.l,  bgStats.g  / bgStats.l,  bgStats.b  / bgStats.l];
      const gain = carCast.map((c, i) => gExp * clamp(1 + (bgCast[i] / c - 1) * colW, 0.9, 1.12));
      const sat = 1 - 0.08 * t; // très légère désaturation vers l'ambiance
      const con = 1 - 0.05 * t; // très léger adoucissement du contraste
      const cw0 = carImg.naturalWidth || carImg.width;
      const ch0 = carImg.naturalHeight || carImg.height;
      const cc = document.createElement('canvas'); cc.width = cw0; cc.height = ch0;
      const cctx = cc.getContext('2d');
      cctx.drawImage(carImg, 0, 0);
      const id = cctx.getImageData(0, 0, cw0, ch0);
      const d = id.data;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] === 0) continue;
        let r = d[i] * gain[0], g = d[i + 1] * gain[1], b = d[i + 2] * gain[2];
        r = (r - 128) * con + 128; g = (g - 128) * con + 128; b = (b - 128) * con + 128;
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        r = lum + (r - lum) * sat; g = lum + (g - lum) * sat; b = lum + (b - lum) * sat;
        d[i]     = r < 0 ? 0 : r > 255 ? 255 : r;
        d[i + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
        d[i + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
      }
      cctx.putImageData(id, 0, 0);
      ctx.drawImage(cc, carX, carY, cw, ch);
      freeCanvas(cc);
      graded = true;
    } catch (_) { graded = false; }
    if (!graded) {
      // Repli : filtre très léger si l'échantillonnage/grading du décor échoue
      const bVal = (1 - 0.03 * t).toFixed(3);
      const cVal = (1 - 0.04 * t).toFixed(3);
      const sVal = (1 - 0.06 * t).toFixed(3);
      ctx.filter = `brightness(${bVal}) contrast(${cVal}) saturate(${sVal})`;
    }
  }
  if (!graded) ctx.drawImage(carImg, carX, carY, cw, ch);
  ctx.restore();
  // Snapshot avant plaque (pour Ajuster en mode showroom)
  const baseURL = returnFull ? c.toDataURL('image/jpeg', 0.97) : null;
  // Caches plaque redessinés en qualité native (corners normalisés 0-1 →
  // pixels composite). Photo à plusieurs voitures : tous les caches sont posés.
  if (logoImg) {
    const mp = p => ({ x: carX + p.x * cw, y: carY + p.y * ch });
    for (const q of plateList({ corners, extraCorners })) {
      const ptl = mp(q.tl), ptr = mp(q.tr);
      const pbr = mp(q.br), pbl = mp(q.bl);
      drawPlateOverlay(ctx, logoImg, ptl, ptr, pbr, pbl, bgColor, 'plate');
    }
  }
  const dataURL = c.toDataURL('image/jpeg', 0.98);
  freeCanvas(c);
  if (returnFull) return { dataURL, baseURL, transform: { carX, carY, cw, ch, W, H } };
  return dataURL;
}

// Réduit l'image (≤ maxSide) et renvoie sa version base64 JPEG + ses dimensions.
// On envoie une copie réduite à la détection (rapide, sous la limite Vercel) ;
// les coins renvoyés sont normalisés (÷ dimensions envoyées) → indépendants de
// la résolution, donc directement réutilisables sur le canvas natif.
function downscaledImageBase64(file, maxSide = 1600, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const w0 = img.naturalWidth || img.width, h0 = img.naturalHeight || img.height;
      const s = Math.min(1, maxSide / Math.max(w0, h0));
      const w = Math.max(1, Math.round(w0 * s)), h = Math.max(1, Math.round(h0 * s));
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve({ base64: c.toDataURL('image/jpeg', quality), w, h });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image load failed')); };
    img.src = url;
  });
}

// Dernière erreur SERVEUR de la détection de plaque (HTTP/réseau — pas les
// « aucune plaque trouvée »). Exposée à l'UI : une clé API invalide ou des
// crédits épuisés côté Vercel doivent produire un bandeau visible, pas des
// photos silencieusement sans cache.
let plateLastApiError = null;
function resetPlateApiError() { plateLastApiError = null; }
function getPlateApiError() { return plateLastApiError; }

// Appel bas niveau à /api/plate-corners (Claude Vision).
// tier "best" = l'UNIQUE escalade (Sonnet 5 en effort haut) — demandée
// seulement quand le résultat économique échoue aux contrôles locaux.
async function fablePlateAPI(b64DataUrl, mode, tier) {
  const b64 = b64DataUrl.includes(',') ? b64DataUrl.split(',')[1] : b64DataUrl;
  const r = await fetch('/api/plate-corners', {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ b64, mode, ...(tier ? { tier } : {}) }),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    console.warn(`[plate-corners:${mode}${tier ? ':' + tier : ''}] HTTP`, r.status, body.slice(0, 500));
    plateLastApiError = `plate-corners (${mode}) HTTP ${r.status} — ${body.slice(0, 180) || 'sans détail'}`;
    return null;
  }
  const json = await r.json();
  // Trace de diagnostic : la réponse brute du modèle, telle que reçue.
  console.log(`[plate-corners:${mode}${tier ? ':' + tier : ''}] réponse:`, JSON.stringify(json));
  return json;
}

// Détection plaque — Claude Vision en DEUX PASSES, au coût minimal.
// Sur l'image entière, la plaque est trop petite (~3% de l'image) pour que le
// modèle place les coins au pixel près. On demande donc une bbox grossière
// sur l'image entière (passe "locate", Haiku), puis on recadre/zoome sur
// cette zone et on demande les 4 coins exacts sur le crop (passe "refine",
// Sonnet 5), où la plaque occupe l'essentiel de l'image. Les coins sont
// ensuite AIMANTÉS localement sur le vrai contour de la plaque (gradient de
// luminance, pur JS — voir snapQuadOutward) puis reprojetés dans le repère
// de la photo complète. Les anciennes passes de vérification LLM et
// escalades multiples sont remplacées par des contrôles géométriques
// gratuits + UNE escalade maximum par étape.
// Renvoie { found, conf, bbox:{x1,y1,x2,y2}, corners:[{x,y}×4] } en coordonnées
// normalisées 0–1 (ordre TL,TR,BR,BL), ou null si aucune plaque.
// presetBox (optionnel) : bbox normalisée fournie par un détecteur spécialisé
// (Snapshot). Elle remplace la passe locate (Haiku) — localisation garantie,
// Claude ne fait plus que le refine des 4 coins sur le crop.
async function detectPlateFable(imageFile, presetBox = null) {
  try {
    const url = URL.createObjectURL(imageFile);
    const img = await loadImg(url);
    URL.revokeObjectURL(url);
    const W = img.naturalWidth || img.width, H = img.naturalHeight || img.height;

    // Image entière downscalée à 1568 px (résolution max de la vision Haiku :
    // envoyer plus grand ne fait que gonfler l'upload).
    const fullScale = Math.min(1, 1568 / Math.max(W, H));
    const fc = document.createElement('canvas');
    fc.width = Math.max(1, Math.round(W * fullScale));
    fc.height = Math.max(1, Math.round(H * fullScale));
    fc.getContext('2d').drawImage(img, 0, 0, fc.width, fc.height);
    const fullB64 = fc.toDataURL('image/jpeg', 0.85);
    freeCanvas(fc);

    // Crop zoomé autour d'une bbox locate, avec une large marge (la bbox est
    // approximative, la plaque doit rester entière dans le crop même décalée).
    // marginMult élargit le cadrage quand le premier essai était trop serré.
    // Renvoie aussi la luminance du crop pour l'aimantation locale des bords.
    const buildCrop = (box, marginMult = 1) => {
      if (!box || ![box.x1, box.y1, box.x2, box.y2].every(v => typeof v === 'number' && v >= -0.1 && v <= 1.1)
          || box.x2 <= box.x1 || box.y2 <= box.y1) return null;
      const bw = box.x2 - box.x1, bh = box.y2 - box.y1;
      const mx = Math.max(bw * 0.7, 0.015) * marginMult, my = Math.max(bh * 1.0, 0.015) * marginMult;
      const cx1 = Math.max(0, box.x1 - mx), cy1 = Math.max(0, box.y1 - my);
      const cx2 = Math.min(1, box.x2 + mx), cy2 = Math.min(1, box.y2 + my);
      const cropW = Math.round((cx2 - cx1) * W), cropH = Math.round((cy2 - cy1) * H);
      if (cropW < 8 || cropH < 8) return null;
      // Upscale pour que le modèle voie la plaque en grand (~1100px).
      const cropScale = Math.min(4, Math.max(1, 1100 / Math.max(cropW, cropH)));
      const cc = document.createElement('canvas');
      cc.width = Math.round(cropW * cropScale);
      cc.height = Math.round(cropH * cropScale);
      const cctx = cc.getContext('2d');
      cctx.imageSmoothingEnabled = true;
      cctx.imageSmoothingQuality = 'high';
      cctx.drawImage(img, cx1 * W, cy1 * H, cropW, cropH, 0, 0, cc.width, cc.height);
      const b64 = cc.toDataURL('image/jpeg', 0.92);
      const px = cctx.getImageData(0, 0, cc.width, cc.height).data;
      const lum = new Float32Array(cc.width * cc.height);
      for (let i = 0; i < lum.length; i++) {
        lum[i] = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
      }
      // rgb conservé pour la segmentation locale de la plaque (bandes bleues).
      const crop = { b64, cx1, cy1, cx2, cy2, w: cc.width, h: cc.height, lum, rgb: px };
      freeCanvas(cc);
      return crop;
    };

    // Sanity check : le quad doit être une plaque plausible (plus large que
    // haut en pixels, aire ni nulle ni délirante).
    const plausible = (corners) => {
      const px = corners.map(p => p.x * W), py = corners.map(p => p.y * H);
      const qw = (Math.hypot(px[1]-px[0], py[1]-py[0]) + Math.hypot(px[2]-px[3], py[2]-py[3])) / 2;
      const qh = (Math.hypot(px[3]-px[0], py[3]-py[0]) + Math.hypot(px[2]-px[1], py[2]-py[1])) / 2;
      return qw >= 4 && qh >= 2 && qw / qh >= 1.2 && qw / qh <= 12;
    };

    // Refine sur un crop → aimantation locale des bords → coins reprojetés
    // dans le repère de la photo complète, ou null si absent/implausible.
    // `touchesEdge` signale qu'un coin colle au bord du crop : la plaque
    // déborde probablement du cadrage et les coins sont tronqués.
    const refineOnCrop = async (crop, tier) => {
      const ref = await fablePlateAPI(crop.b64, 'refine', tier);
      if (!ref || !ref.found) return null;
      const EDGE = 0.02;
      let touchesEdge = [ref.tl, ref.tr, ref.br, ref.bl].some(
        p => p.x <= EDGE || p.x >= 1 - EDGE || p.y <= EDGE || p.y >= 1 - EDGE
      );
      const toPx = p => ({ x: Math.min(1, Math.max(0, p.x)) * crop.w, y: Math.min(1, Math.max(0, p.y)) * crop.h });
      let quad = { tl: toPx(ref.tl), tr: toPx(ref.tr), br: toPx(ref.br), bl: toPx(ref.bl) };
      let snapMax = Math.max(3, Math.round(crop.w * 0.006));

      // ── Ancrage sur les caractères lus : RÉPARER, jamais rejeter ──
      // La boîte "chars" (bande de texte) est bien plus fiable que les coins
      // seuls : le modèle doit fixer les glyphes pour les lire. Si le quad ne
      // contient pas cette boîte (cas typique : quad décalé d'une hauteur de
      // plaque, posé sur le pare-choc), on le RECONSTRUIT par dilatation de
      // la bande de texte aux proportions d'une plaque UE — gratuit, aucune
      // requête en plus, et on garde toujours un cache plutôt que rien.
      const cb = ref.chars;
      const origQuad = quad;
      let charsPx = null;
      if (cb && [cb.x1, cb.y1, cb.x2, cb.y2].every(v => typeof v === 'number')) {
        const chars = {
          x1: Math.min(1, Math.max(0, cb.x1)) * crop.w, y1: Math.min(1, Math.max(0, cb.y1)) * crop.h,
          x2: Math.min(1, Math.max(0, cb.x2)) * crop.w, y2: Math.min(1, Math.max(0, cb.y2)) * crop.h,
        };
        const cw = chars.x2 - chars.x1, ch = chars.y2 - chars.y1;
        // L'ancre n'est utilisée que si elle ressemble à une bande de texte
        // (allongée, taille non dérisoire) — une ancre douteuse ne doit pas
        // dégrader un quad correct.
        const charsOK = cw > crop.w * 0.08 && ch > 2 && cw / ch >= 2 && cw / ch <= 14;
        if (charsOK) charsPx = chars;
        if (charsOK && !quadCoversBox(quad, chars, ch * 0.25)) {
          console.log(`[plate] quad décalé par rapport au texte lu${ref.text ? ` ("${ref.text}")` : ''} — reconstruction depuis la bande de caractères`);
          quad = quadFromBox(chars);
          snapMax = Math.max(snapMax, Math.round(crop.w * 0.02));
          const ex = crop.w * EDGE, ey = crop.h * EDGE;
          touchesEdge = [quad.tl, quad.tr, quad.br, quad.bl].some(
            p => p.x <= ex || p.x >= crop.w - ex || p.y <= ey || p.y >= crop.h - ey
          );
        }
      }

      // ── Extraction locale par SEGMENTATION (prioritaire, gratuite) ──
      // La plaque est la région claire (+ bandes bleues) du crop : on en
      // déduit les 4 coins exacts, perspective comprise — validé sur photos
      // réelles à quelques pixels près. Retrouve la plaque même si le quad
      // du modèle ou la boîte de localisation sont décalés.
      const seg = plateQuadFromCrop(crop.lum, crop.rgb, crop.w, crop.h, quad, charsPx);
      if (seg) {
        console.log('[plate] coins extraits par segmentation locale');
        // Finition : chaque bord peut encore s'étendre/s'incliner VERS
        // L'EXTÉRIEUR sur le vrai contour (jamais rétrécir), puis marge de
        // sécurité — couverture bord à bord garantie, calibrée sur photos
        // réelles.
        const out = fitQuadEdges(crop.lum, crop.w, crop.h, seg, null,
          Math.max(8, Math.round(crop.w * 0.025)), 0);
        quad = expandQuad(out, 1.02, 1.08);
      } else {
        // Repli : ajustement des bords sur le gradient. Avec l'ancre texte,
        // chaque bord peut se décaler et s'incliner ; sans ancre, poussée
        // vers l'extérieur uniquement (comportement prudent).
        quad = charsPx
          ? fitQuadEdges(crop.lum, crop.w, crop.h, quad, charsPx,
              Math.max(8, Math.round(crop.w * 0.03)), Math.max(6, Math.round(crop.w * 0.02)))
          : snapQuadOutward(crop.lum, crop.w, crop.h, quad, snapMax);
        quad = expandQuad(quad, 1.02, 1.06);
      }
      // Le quad final colle-t-il au bord du crop (plaque probablement
      // tronquée) ? Recalculé sur le résultat, tous chemins confondus.
      {
        const ex = crop.w * EDGE, ey = crop.h * EDGE;
        touchesEdge = [quad.tl, quad.tr, quad.br, quad.bl].some(
          p => p.x <= ex || p.x >= crop.w - ex || p.y <= ey || p.y >= crop.h - ey
        );
      }
      const map = p => ({
        x: crop.cx1 + Math.min(1, Math.max(0, p.x / crop.w)) * (crop.cx2 - crop.cx1),
        y: crop.cy1 + Math.min(1, Math.max(0, p.y / crop.h)) * (crop.cy2 - crop.cy1),
      });
      const corners = [map(quad.tl), map(quad.tr), map(quad.br), map(quad.bl)];
      if (plausible(corners)) return { corners, touchesEdge };
      // Quad reconstruit implausible ? Repli sur les coins bruts du modèle
      // plutôt que de finir sans cache.
      if (quad !== origQuad) {
        const co = [map(origQuad.tl), map(origQuad.tr), map(origQuad.br), map(origQuad.bl)];
        if (plausible(co)) {
          console.log('[plate] reconstruction implausible, coins bruts du modèle conservés');
          return { corners: co, touchesEdge };
        }
      }
      console.log('[plate] coins implausibles (proportions), refine rejeté');
      return null;
    };

    // Les deux quads désignent-ils la même plaque ? Garde-fou du retry
    // élargi : sur un cadrage plus large, le modèle peut accrocher un autre
    // objet ou dériver d'une hauteur de plaque — dans ce cas on garde le quad
    // initial, même tronqué, plutôt que de poser le cache au mauvais endroit.
    const sameQuad = (a, b) => {
      const ctr = q => q.reduce((s, p) => ({ x: s.x + p.x / 4, y: s.y + p.y / 4 }), { x: 0, y: 0 });
      const width = q => Math.max(
        Math.hypot(q[1].x - q[0].x, q[1].y - q[0].y),
        Math.hypot(q[2].x - q[3].x, q[2].y - q[3].y));
      const height = q => Math.max(
        Math.hypot(q[3].x - q[0].x, q[3].y - q[0].y),
        Math.hypot(q[2].x - q[1].x, q[2].y - q[1].y));
      const ca = ctr(a), cb = ctr(b);
      return Math.abs(ca.x - cb.x) <= Math.max(width(a), width(b)) * 0.5
          && Math.abs(ca.y - cb.y) <= Math.max(height(a), height(b)) * 0.8;
    };

    // Retry sur cadrage élargi quand le quad colle au bord du crop (plaque
    // probablement tronquée). N'adopte le nouveau quad que s'il est complet
    // ET cohérent avec l'initial.
    const retryWider = async (res, box, label) => {
      if (!res?.touchesEdge) return res;
      console.log(`[plate] quad ${label} au bord du crop, élargissement de la marge`);
      const widerCrop = buildCrop(box, 2.5);
      const res2 = widerCrop ? await refineOnCrop(widerCrop, 'best') : null;
      if (res2 && !res2.touchesEdge && sameQuad(res.corners, res2.corners)) return res2;
      if (res2) console.log('[plate] retry élargi incohérent ou tronqué, quad initial conservé');
      return res;
    };

    // ── Chemin nominal (2 appels) : locate Haiku → crop → refine Sonnet 5 ──
    // Un « aucune plaque » de Haiku n'est PAS fatal : la relocalisation
    // (tier best, ~0,5 ct) contre-vérifie avant d'abandonner — un faux
    // négatif du locate économique coûterait un cache manquant.
    let corners = null;
    const locEco = presetBox
      ? { found: true, box: presetBox }
      : await fablePlateAPI(fullB64, 'locate');
    const cropEco = (locEco && locEco.found) ? buildCrop(locEco.box) : null;
    if (cropEco) {
      let res = await refineOnCrop(cropEco);
      res = await retryWider(res, locEco.box, 'éco');
      corners = res?.corners ?? null;
      // Crop localisé mais refine implausible : UNE escalade (même crop,
      // Sonnet 5 effort haut).
      if (!corners) {
        console.log('[plate] refine éco rejeté, escalade effort haut (même crop)');
        res = await refineOnCrop(cropEco, 'best');
        corners = res?.corners ?? null;
      }
    }

    // ── Relocalisation (rare) : la localisation éco était probablement
    // fausse (crop sans plaque) → une passe locate/refine en tier best.
    // Inutile quand la boîte vient d'un détecteur spécialisé (presetBox) :
    // la localisation est sûre, on passe directement au cache de repli
    // posé sur cette boîte serrée.
    if (!corners && !presetBox) {
      console.log('[plate] échec chemin éco, relocalisation (tier best)');
      const locBest = await fablePlateAPI(fullB64, 'locate', 'best');
      const cropBest = (locBest && locBest.found) ? buildCrop(locBest.box) : null;
      if (cropBest) {
        let res = await refineOnCrop(cropBest, 'best');
        res = await retryWider(res, locBest.box, 'best');
        corners = res?.corners ?? null;
      }
    }

    // ── Dernier recours : les refine n'ont rien confirmé mais le locate éco
    // avait trouvé une zone. On pose le cache sur cette bbox (demandée
    // volontairement généreuse au modèle, donc couvrante) : un cache un peu
    // large et droit vaut mieux que pas de cache — ajustable à la main.
    if (!corners && cropEco) {
      const fb = locEco.box;
      const c = [
        { x: fb.x1, y: fb.y1 }, { x: fb.x2, y: fb.y1 },
        { x: fb.x2, y: fb.y2 }, { x: fb.x1, y: fb.y2 },
      ].map(p => ({ x: Math.min(1, Math.max(0, p.x)), y: Math.min(1, Math.max(0, p.y)) }));
      if (plausible(c)) {
        console.warn('[plate] refine muet partout — cache de repli posé sur la zone locate');
        corners = c;
      }
    }
    if (!corners) { console.log('[plate] aucune plaque détectée (Claude)'); return null; }

    const xs = corners.map(p => p.x), ys = corners.map(p => p.y);
    const bbox = { x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) };
    console.log(`Plaque détectée (Claude 2-passes): bbox (${bbox.x1.toFixed(3)},${bbox.y1.toFixed(3)})-(${bbox.x2.toFixed(3)},${bbox.y2.toFixed(3)})`);
    return { found: true, conf: 1, bbox, corners, source: 'fable' };
  } catch (e) {
    console.error('[plate-corners] erreur:', e.message);
    plateLastApiError = plateLastApiError ?? ('réseau/exception : ' + e.message);
    return null;
  }
}

// Aimante des coins (normalisés image entière) sur le contour réel de la
// plaque : crop local autour du quad, luminance, snapQuadOutward — purement
// local et gratuit. Garantit un cache couvrant bord à bord même si le
// détecteur a donné un polygone légèrement à l'intérieur de la plaque.
function snapCornersOnImage(img, W, H, corners) {
  try {
    const xs = corners.map(p => p.x), ys = corners.map(p => p.y);
    const bw = Math.max(...xs) - Math.min(...xs), bh = Math.max(...ys) - Math.min(...ys);
    const cx1 = Math.max(0, Math.min(...xs) - bw * 0.4), cx2 = Math.min(1, Math.max(...xs) + bw * 0.4);
    const cy1 = Math.max(0, Math.min(...ys) - bh * 0.6), cy2 = Math.min(1, Math.max(...ys) + bh * 0.6);
    const cw = Math.round((cx2 - cx1) * W), ch = Math.round((cy2 - cy1) * H);
    if (cw < 16 || ch < 8) return corners;
    const scale = Math.min(3, Math.max(1, 700 / cw));
    const c = document.createElement('canvas');
    c.width = Math.round(cw * scale); c.height = Math.round(ch * scale);
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(img, cx1 * W, cy1 * H, cw, ch, 0, 0, c.width, c.height);
    const px = ctx.getImageData(0, 0, c.width, c.height).data;
    const lum = new Float32Array(c.width * c.height);
    for (let i = 0; i < lum.length; i++) {
      lum[i] = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
    }
    const toPx = p => ({ x: (p.x - cx1) / (cx2 - cx1) * c.width, y: (p.y - cy1) / (cy2 - cy1) * c.height });
    let quad = { tl: toPx(corners[0]), tr: toPx(corners[1]), br: toPx(corners[2]), bl: toPx(corners[3]) };
    quad = snapQuadOutward(lum, c.width, c.height, quad, Math.max(3, Math.round(c.width * 0.012)));
    const back = p => ({ x: cx1 + p.x / c.width * (cx2 - cx1), y: cy1 + p.y / c.height * (cy2 - cy1) });
    const out = [back(quad.tl), back(quad.tr), back(quad.br), back(quad.bl)];
    freeCanvas(c);
    return out;
  } catch (e) {
    console.warn('[plate] snap local échoué:', e.message);
    return corners;
  }
}

// File d'attente globale pour Plate Recognizer : le plan gratuit Snapshot est
// limité à 1 requête/seconde — les photos d'un lot sont traitées en parallèle,
// donc on sérialise les appels avec un espacement minimal, sinon tout sauf la
// première photo prend un 429 et bascule sur le chemin Claude dégradé.
let prQueue = Promise.resolve();
let prLastCall = 0;
const PR_MIN_INTERVAL_MS = 1100;
function throttledPR(fn) {
  const run = prQueue.then(async () => {
    const wait = prLastCall + PR_MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await new Promise(res => setTimeout(res, wait));
    prLastCall = Date.now();
    return fn();
  });
  prQueue = run.catch(() => {});
  return run;
}

// Détection plaque via Plate Recognizer Blur — détecteur SPÉCIALISÉ, renvoie
// le polygone exact (4 coins) de chaque plaque. C'est le chemin PRINCIPAL :
// précision au pixel, ~1 s, et aucun appel Claude quand il réussit.
// Renvoie { found, conf, bbox:{x1,y1,x2,y2}, corners:[{x,y}×4] } en coordonnées
// normalisées 0–1 (ordre TL,TR,BR,BL), ou null si aucune plaque.
async function detectPlatePlateRecognizer(imageFile, regions = 'fr') {
  try {
    const { base64, w, h } = await downscaledImageBase64(imageFile, 1600, 0.85);
    const headers = await authHeaders();
    const doFetch = () => fetch('/api/detect-plates', {
      method: 'POST',
      headers,
      body: JSON.stringify({ imageBase64: base64, regions }),
    });
    let r = await throttledPR(doFetch);
    if (r.status === 429) {
      // Limite 1 req/s malgré l'espacement (latence variable) : on retente
      // une fois, la file garantit à nouveau l'écart.
      console.log('[detect-plates] 429 (limite 1 req/s), nouvelle tentative');
      r = await throttledPR(doFetch);
    }
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      console.warn('[detect-plates] HTTP', r.status, body.slice(0, 300));
      plateLastApiError = `detect-plates HTTP ${r.status} — ${body.slice(0, 180) || 'sans détail'}`;
      return null;
    }
    const { polygons, boxes } = await r.json();
    const quads = (polygons || []).filter(p => Array.isArray(p) && p.length === 4);
    if (!quads.length) {
      // Repli Snapshot : pas de polygone, mais une boîte SERRÉE et fiable
      // autour de la plaque. On la renvoie au pipeline Claude qui n'aura
      // plus qu'à affiner les 4 coins sur un crop garanti correct.
      const bs = (boxes || []);
      if (bs.length) {
        const best = bs.slice().sort((A, B) =>
          (B.xmax - B.xmin) * (B.ymax - B.ymin) - (A.xmax - A.xmin) * (A.ymax - A.ymin))[0];
        const box = { x1: best.xmin / w, y1: best.ymin / h, x2: best.xmax / w, y2: best.ymax / h };
        console.log(`[plate] boîte Snapshot (${box.x1.toFixed(3)},${box.y1.toFixed(3)})-(${box.x2.toFixed(3)},${box.y2.toFixed(3)}) — coins affinés par Claude`);
        return { boxOnly: true, box };
      }
      // Réponse SAINE de l'API mais zéro plaque : verdict fiable d'un
      // détecteur spécialisé — à distinguer d'une erreur (null).
      console.log('Aucune plaque détectée (Plate Recognizer)');
      return { noPlate: true };
    }
    // Plaque principale = polygone de plus grande aire (shoelace).
    const best = quads.slice().sort((A, B) => quadArea(B) - quadArea(A))[0];
    let corners = orderQuad(best).map(p => ({ x: p[0] / w, y: p[1] / h }));
    // Aimantation locale : pousse chaque bord jusqu'au vrai contour.
    const url = URL.createObjectURL(imageFile);
    const img = await loadImg(url);
    URL.revokeObjectURL(url);
    corners = snapCornersOnImage(img, img.naturalWidth || img.width, img.naturalHeight || img.height, corners);
    const xs = corners.map(p => p.x), ys = corners.map(p => p.y);
    const bbox = { x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) };
    console.log(`Plaque détectée (Plate Recognizer): bbox (${bbox.x1.toFixed(3)},${bbox.y1.toFixed(3)})-(${bbox.x2.toFixed(3)},${bbox.y2.toFixed(3)})`);
    return { found: true, conf: 1, bbox, corners, source: 'platerecognizer' };
  } catch (e) {
    console.error('[detect-plates] erreur:', e.message);
    return null;
  }
}

// Ordre de bataille :
//  1. Plate Recognizer Blur : polygone exact → cache posé, aucun appel Claude.
//  2. Plate Recognizer Snapshot : boîte serrée → localisation garantie, Claude
//     n'affine que les 4 coins sur le crop (1 appel Sonnet).
//  3. Claude seul (locate + refine) si Plate Recognizer est indisponible.
async function detectPlate(imageFile, regions = 'fr') {
  // ── Source principale : modèle maison keypoints (navigateur, 0 € / photo) ──
  // Entraîné sur les photos réelles de la concession, il pose les 4 coins en
  // perspective à tous les angles (y compris 3/4). S'il trouve une plaque, on
  // le croit ; sinon (modèle absent, erreur, ou rien détecté) on retombe sur
  // Plate Recognizer puis Claude, comme avant.
  const kp = await detectPlateKeypoints(imageFile);
  if (kp?.found) return kp;

  const pr = await detectPlatePlateRecognizer(imageFile, regions);
  // Verdict « aucune plaque » du détecteur spécialisé : on le CROIT.
  // Repartir sur Claude ici produirait des caches fantômes (le locate
  // hallucine volontiers une zone sur un flanc ou une calandre).
  if (pr?.noPlate) {
    console.log('[plate] aucune plaque sur la photo — aucun cache posé');
    return null;
  }
  if (pr && !pr.boxOnly) return pr;
  if (!pr) console.warn('[plate] Plate Recognizer indisponible, bascule sur Claude Vision');
  return detectPlateFable(imageFile, pr?.box ?? null);
}

// ── Vehicle detection + main vehicle selection ──
// Claude Vision (Haiku) via /api/detect-vehicles — a remplacé le backend
// YOLO Railway. En cas d'échec, le pipeline retombe sur les heuristiques
// locales (plaque + composantes connexes), comme avant.

async function detectVehicles(imageFile) {
  try {
    const { base64 } = await downscaledImageBase64(imageFile, 1280, 0.8);
    const r = await fetch('/api/detect-vehicles', {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify({ b64: base64.includes(',') ? base64.split(',')[1] : base64 }),
    });
    if (!r.ok) { console.warn('[Vehicles] HTTP', r.status); return null; }
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

async function uncropCutout(croppedCutoutUrl, roi, origW, origH, baseDataURL = null) {
  const img = await loadImg(croppedCutoutUrl);
  const fullROI = roi.x1 === 0 && roi.y1 === 0 && roi.x2 === 1 && roi.y2 === 1;
  // Déjà à la taille pleine et ROI pleine → aucune perte de résolution à
  // corriger, rien à faire (fast path).
  if (fullROI && img.naturalWidth === origW && img.naturalHeight === origH) {
    return croppedCutoutUrl;
  }
  const c = document.createElement('canvas');
  c.width = origW; c.height = origH;
  const ctx = c.getContext('2d');
  // Le détourage travaille sur une image réduite (≤2000 px local, ≤3000 px
  // API Pro). Sans étirement, le cutout occuperait une zone plus petite que
  // la ROI d'origine → décalage / "double véhicule" visible dans le
  // MaskEditor avec la photo source. On étire ici le cutout pour qu'il
  // remplisse exactement la région ROI dans le canvas origW×origH.
  const cx1 = Math.round(roi.x1 * origW), cy1 = Math.round(roi.y1 * origH);
  const cx2 = Math.round(roi.x2 * origW), cy2 = Math.round(roi.y2 * origH);
  const cw = cx2 - cx1, ch = cy2 - cy1;
  ctx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight, cx1, cy1, cw, ch);

  // ── Fondu des bords de découpe ──
  // La ROI est un rectangle : l'ombre au sol semi-transparente qui la
  // traverse était tranchée en ligne droite (visible sous la voiture).
  // On fond l'alpha des pixels SEMI-TRANSPARENTS (ombre, bords doux) sur une
  // bande le long des bords bas / gauche / droite de la ROI — les pixels
  // opaques (carrosserie) ne sont jamais touchés : le détourage et le rendu
  // de l'ombre ne changent pas, seule sa terminaison devient un dégradé.
  try {
    const SOFT = 230; // en dessous : ombre / liseré doux ; au-dessus : carrosserie
    const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
    // Un bord n'est fondu que si du contenu semi-transparent TOUCHE ce bord :
    // une ombre qui se termine naturellement dans la ROI n'est jamais
    // retouchée (vues 3/4 et latérales notamment).
    const touchesEdge = (x0, y0, w, h) => {
      if (w <= 0 || h <= 0) return false;
      const d = ctx.getImageData(x0, y0, w, h).data;
      for (let k = 3; k < d.length; k += 4) { const a = d[k]; if (a > 8 && a < SOFT) return true; }
      return false;
    };
    const featherBand = (x0, y0, w, h, factorFor) => {
      if (w <= 0 || h <= 0) return;
      const id = ctx.getImageData(x0, y0, w, h);
      const d = id.data;
      for (let yy = 0; yy < h; yy++) {
        for (let xx = 0; xx < w; xx++) {
          const k = (yy * w + xx) * 4 + 3;
          const a = d[k];
          if (a === 0 || a >= SOFT) continue;
          d[k] = Math.round(a * factorFor(x0 + xx, y0 + yy));
        }
      }
      ctx.putImageData(id, x0, y0);
    };
    // Bandes courtes + courbe douce (t^0.6) : on casse la ligne de coupe sans
    // estomper une ombre peu étendue — sur une vue de face, l'ombre est une
    // fine bande sous le pare-chocs, presque entièrement dans la marge basse
    // de la ROI ; la première version du fondu (bande 8 %, linéaire) l'y
    // effaçait quasi intégralement.
    const Fb = Math.max(16, Math.round(ch * 0.035)); // bande basse
    const Fs = Math.max(16, Math.round(cw * 0.03));  // bandes latérales
    if (touchesEdge(cx1, cy2 - 3, cw, 3))
      featherBand(cx1, Math.max(cy1, cy2 - Fb), cw, Math.min(Fb, ch), (x, y) => Math.pow(clamp01((cy2 - 1 - y) / Fb), 0.6));
    if (touchesEdge(cx1, cy1, 3, ch))
      featherBand(cx1, cy1, Math.min(Fs, cw), ch, (x, y) => Math.pow(clamp01((x - cx1) / Fs), 0.6));
    if (touchesEdge(cx2 - 3, cy1, 3, ch))
      featherBand(Math.max(cx1, cx2 - Fs), cy1, Math.min(Fs, cw), ch, (x, y) => Math.pow(clamp01((cx2 - 1 - x) / Fs), 0.6));
  } catch (_) { /* fondu cosmétique — jamais bloquant */ }

  if (!baseDataURL) return c.toDataURL('image/png');

  // ── Restauration de la netteté native ──
  // L'étirement ci-dessus rend la voiture floue : ses pixels sont ceux de
  // l'image réduite envoyée au détourage, ré-agrandis. Le détourage ne sert
  // ici que de MASQUE : on redessine par-dessus l'intérieur opaque du
  // véhicule avec les pixels pleine résolution de la photo d'origine
  // (baseDataURL). Les zones semi-transparentes — ombre au sol, bords
  // adoucis, vitres — gardent les pixels du détourage : le rendu de l'ombre
  // et la qualité du découpage ne changent pas, seul l'intérieur redevient
  // aussi net que la photo originale.
  try {
    const baseImg = await loadImg(baseDataURL);
    // Masque du cœur opaque : rampe d'alpha 200→248 pour fondre les pixels
    // natifs dans le liseré anti-aliasé du détourage sans créer de halo.
    const maskC = document.createElement('canvas');
    maskC.width = origW; maskC.height = origH;
    const maskCtx = maskC.getContext('2d');
    maskCtx.drawImage(c, 0, 0);
    const mId = maskCtx.getImageData(0, 0, origW, origH);
    const md = mId.data;
    const LO = 200, HI = 248;
    for (let i = 3; i < md.length; i += 4) {
      const a = md[i];
      md[i] = a <= LO ? 0 : a >= HI ? 255 : Math.round((a - LO) * 255 / (HI - LO));
    }
    maskCtx.putImageData(mId, 0, 0);
    const topC = document.createElement('canvas');
    topC.width = origW; topC.height = origH;
    const topCtx = topC.getContext('2d');
    topCtx.imageSmoothingEnabled = true;
    topCtx.imageSmoothingQuality = 'high';
    topCtx.drawImage(baseImg, 0, 0, origW, origH);
    topCtx.globalCompositeOperation = 'destination-in';
    topCtx.drawImage(maskC, 0, 0);
    ctx.drawImage(topC, 0, 0);
    freeCanvas(maskC, topC);
  } catch (e) {
    // En cas d'échec (mémoire mobile…), on garde le cutout étiré : moins
    // net mais toujours correct.
    console.warn('[Uncrop] restauration netteté échouée:', e?.message);
  }
  return c.toDataURL('image/png');
}

async function processPhoto(photoFile, logoImg, adj, bgColor = "#ffffff", enhance = false, useGptAngle = false, floorClean = false, enhancePro = false, bodyPolish = false, enhanceProIntensity = 2, autoPlate = true, preDetectedPlate = undefined, showroomActive = false) {
  const { b64, imgW, imgH } = await toBase64(photoFile);

  const photoURL = URL.createObjectURL(photoFile);
  const photoImg = await loadImg(photoURL);
  URL.revokeObjectURL(photoURL);

  // ── Dimensionnement du canvas piloté par la TAILLE DE LA PLAQUE ──
  // Le cache plaque est dessiné en perspective DANS la région de la plaque
  // du canvas de sortie. En pixels, cette région a la taille que lui impose
  // la résolution de la photo : deux photos de qualités différentes donnent
  // donc deux plaques de tailles différentes → qualités différentes.
  // Pour que la qualité du cache plaque soit CONSTANTE d'une photo à
  // l'autre, on détecte la plaque AVANT de créer le canvas et on agrandit
  // le canvas (jamais on ne le réduit) pour viser une largeur de plaque
  // cible fixe (TARGET_PLATE_PX), indépendamment de la résolution de la
  // photo. Un plancher général (MIN_WORK_PX) couvre le cas « pas de plaque
  // détectée », et un garde-fou mémoire (MAX_DIM) borne la taille du canvas.
  const natW = photoImg.naturalWidth  || photoImg.width;
  const natH = photoImg.naturalHeight || photoImg.height;

  // Détection plaque (coordonnées normalisées 0–1, sur le fichier original).
  // Option "cache plaque automatique" décochée : aucune détection (ni coût
  // API) — la photo sort telle quelle et le cache se pose manuellement.
  // preDetectedPlate : résultat pré-calculé par le pipelining du batch
  // (undefined = pas de préfetch, on détecte ici).
  const yolo = !autoPlate ? null
    : (preDetectedPlate !== undefined ? preDetectedPlate : await detectPlate(photoFile));

  // Largeur de la plaque en pixels natifs (coins si dispo, sinon bbox).
  let plateNativePx = 0;
  if (yolo) {
    if (yolo.corners && yolo.corners.length === 4) {
      const xs = yolo.corners.map(p => p.x), ys = yolo.corners.map(p => p.y);
      plateNativePx = Math.max(
        (Math.max(...xs) - Math.min(...xs)) * natW,
        (Math.max(...ys) - Math.min(...ys)) * natH
      );
    } else if (yolo.bbox) {
      const b = yolo.bbox;
      plateNativePx = Math.max((b.x2 - b.x1) * natW, (b.y2 - b.y1) * natH);
    }
  }

  const MIN_WORK_PX     = 1600;  // plancher image entière (fallback sans plaque)
  const TARGET_PLATE_PX = 400;   // largeur de plaque visée → qualité constante
  // Garde-fou mémoire. Sur mobile, un canvas 4400px (~52 Mo RGBA) multiplié par
  // les étapes du pipeline showroom dépasse le budget canvas de WebKit →
  // onglet tué (page qui "plante" et revient à l'accueil). Le showroom garde
  // donc son plafond de 2400px (suffisant pour l'export showroom 2400×1350).
  // SANS showroom, un seul canvas plein format vit à la fois : on peut monter
  // plus haut, et c'est décisif pour le cache plaque — à 2400px de plafond, une
  // plaque photographiée à 200px reste à 200px dans l'export et pixellise dès
  // qu'on zoome. On borne aussi l'AIRE, seule vraie mesure du coût mémoire :
  // une photo portrait très allongée coûte moins qu'un 3:2 de même hauteur.
  // Le budget mobile suit le nombre de canvas pleine taille vivants en même
  // temps : showroom (plusieurs étapes) < sol flouté pro (3 canvas) < simple
  // pose de cache (1 seul).
  const mobile = isMobileDevice();
  const MAX_DIM  = mobile ? (showroomActive ? 2400 : enhancePro ? 2900 : 3400) : 4400;
  const MAX_AREA = mobile ? (showroomActive ? 4.6e6 : enhancePro ? 5.5e6 : 7.5e6) : 20e6;
  let renderScale = Math.max(1, MIN_WORK_PX / Math.max(natW, natH));
  if (plateNativePx > 2) {
    renderScale = Math.max(renderScale, TARGET_PLATE_PX / plateNativePx);
  }
  renderScale = Math.min(
    renderScale,
    MAX_DIM / Math.max(natW, natH),
    Math.sqrt(MAX_AREA / Math.max(1, natW * natH)),
  );
  // Desktop : jamais de réduction sous la résolution native (renderScale ≥ 1).
  // Mobile : la réduction est PRÉCISÉMENT le but du plafond — une photo
  // iPhone 4032px traitée en pleine résolution fait échouer les canvas en
  // aval (toDataURL vide → image finale cassée) même sans tuer l'onglet.
  if (!isMobileDevice()) renderScale = Math.max(1, renderScale);

  const c = document.createElement("canvas");
  c.width  = Math.round(natW * renderScale);
  c.height = Math.round(natH * renderScale);
  const ctx = c.getContext("2d");
  // Lissage haute qualité pour l'agrandissement éventuel de la photo.
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.filter = `brightness(${adj.brightness}) contrast(${adj.contrast}) saturate(${adj.saturation})`;
  ctx.drawImage(photoImg, 0, 0, c.width, c.height);
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

  // `yolo` a déjà été récupéré plus haut (dimensionnement du canvas).
  if (yolo) {
    plateFound = true;
    // ── CHEMIN UNIQUE de pose du cache ──
    // Plate Recognizer fournit directement les 4 coins précis de la plaque
    // (TL,TR,BR,BL, gère l'angle). On les projette sur le canvas de pose `c`
    // (résolution native), avec un léger élargissement pour bien couvrir les
    // bords, puis on pose le cache en perspective via drawPlateOverlay.
    if (yolo.corners && logoImg) {
      try {
        let pts = yolo.corners.map(p => ({ x: p.x * c.width, y: p.y * c.height }));
        const cgx = (pts[0].x + pts[1].x + pts[2].x + pts[3].x) / 4;
        const cgy = (pts[0].y + pts[1].y + pts[2].y + pts[3].y) / 4;
        // Élargissement du quad avant pose : 6 % pour toutes les sources.
        //
        // Cette marge absorbe l'imprécision résiduelle des coins et évite
        // qu'un bord de plaque reste lisible. Elle a été mise en place quand
        // le modèle recevait une entrée letterboxée qu'il ne comprenait pas ;
        // depuis que l'entrée est étirée, les coins tombent nettement mieux
        // et elle est peut-être devenue du débord inutile sur le pare-chocs.
        // `?marge=off` la retire, pour trancher sur des photos réelles.
        const sansMarge = typeof window !== 'undefined'
          && window.location.search.includes('marge=off');
        const grow = sansMarge ? 1.0 : 1.06;
        pts = pts.map(p => ({ x: cgx + (p.x - cgx) * grow, y: cgy + (p.y - cgy) * grow }));
        const [ptl, ptr, pbr, pbl] = pts;
        const toNorm = p => ({ x: p.x / c.width, y: p.y / c.height });
        savedCorners = { tl: toNorm(ptl), tr: toNorm(ptr), br: toNorm(pbr), bl: toNorm(pbl) };
        // ?plateDebug=raw : on ne pose PAS le cache, pour voir les coins du
        // modèle (overlay SVG) par-dessus la vraie plaque et juger sur pièces.
        if (!plateDebugRaw()) drawPlateOverlay(ctx, logoImg, ptl, ptr, pbr, pbl, bgColor, 'plate');
      } catch (e) { console.warn('[plate] pose ignorée:', e.message); }
    }
  }
  // Télémétrie plaque — exposée pour l'overlay debug (?plateDebug) : bbox,
  // coins finaux et source. Plus de pipeline parallèle (render_source,
  // bbox_stable, opencv_corners…) : Plate Recognizer fournit un seul quad.
  const yoloBbox    = yolo?.bbox    ? { ...yolo.bbox, conf: yolo.conf } : null;
  const yoloCorners = yolo?.corners ?? null;
  const yoloSource  = yolo ? (yolo.source || 'platerecognizer') : null;
  // extraCorners : caches plaque supplémentaires ajoutés à la main (2e/3e
  // voiture sur la photo). Vide à la détection, rempli depuis le mode Ajuster.
  return { name: photoFile.name, processed: c.toDataURL("image/jpeg", 0.97), plateFound, autoPlateOff: !autoPlate, baseDataURL, corners: savedCorners, extraCorners: [], yoloBbox, yoloCorners, yoloSource, imgW: c.width, imgH: c.height };
}

const Slider = ({ label, value, min, max, step, onChange }) => (
  <div style={{ marginBottom: 18 }}>
    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 7 }}>
      <span style={{ fontSize: 11, letterSpacing: 2, textTransform: "uppercase", color: "var(--c-ddd)", fontFamily: "var(--font-apple)" }}>{label}</span>
      <span style={{ fontSize: 12, color: "#f26522", fontFamily: "var(--font-apple)" }}>{value.toFixed(2)}</span>
    </div>
    <input type="range" min={min} max={max} step={step} value={value}
      onChange={e => onChange(parseFloat(e.target.value))}
      style={{ width: "100%", accentColor: "#f26522", cursor: "pointer" }} />
  </div>
);

function AuthScreen({ onAuth, exiting }) {
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
  const isMobile = useIsMobile();
  const { canInstall, isIOS, installed, promptInstall } = useInstallPrompt();
  const [showInstallHelp, setShowInstallHelp] = useState(false);
  const showInstallCTA = isMobile && !installed;

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
        // On garde l'état « chargement » : la carte s'efface aussitôt, le
        // bouton ne doit pas reprendre son libellé au milieu de la transition.
        onAuth(data.user);
        return;
      } else {
        if (!fullName.trim()) throw new Error("Veuillez entrer votre nom ou nom d'entreprise.");
        if (!phone.trim()) throw new Error("Veuillez entrer votre numéro de téléphone.");
        if (!cgvAccepted) throw new Error("Veuillez accepter les CGV et la politique de confidentialité.");
        const { data: signUpData, error } = await supabase.auth.signUp({
          email, password,
          options: { data: { full_name: fullName.trim(), phone: phone.trim() } }
        });
        if (error) throw error;
        // Le téléphone est déjà enregistré dans les métadonnées ci-dessus. Sa
        // recopie dans la colonne `phone` de Supabase se fait à la première
        // connexion : l'inscription exige une confirmation par email, donc
        // aucune session n'existe encore ici et l'appel serveur — désormais
        // authentifié — serait refusé.
        setSuccess("Compte créé ! Vérifiez votre email puis connectez-vous.");
        setMode("login");
      }
    } catch (e) { setError(e.message || "Une erreur est survenue"); }
    setLoading(false);
  };

  return (
    <div style={{ minHeight: "100vh", background: "var(--c-1c1c1c)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--font-apple)" }}>
      <style>{AUTH_MOTION_CSS}</style>
      <div className={exiting ? "ac-auth-out" : undefined}
        style={{ width: 380, padding: 40, background: "var(--c-161616)", border: "1px solid var(--c-252525)", borderRadius: 4 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 36 }}>
          <svg width="22" height="22" viewBox="0 0 22 22">
            <polygon points="11,1 21,6 21,16 11,21 1,16 1,6" fill="#f26522" />
            <polygon points="11,5 17,8 17,14 11,17 5,14 5,8" fill="#0f0f0f" />
          </svg>
          <span style={{ fontSize: 20, fontWeight: 700, letterSpacing: 4, textTransform: "uppercase", color: "var(--c-ddd5c8)" }}>AutoCache</span>
          <span style={{ fontSize: 10, color: "#f26522", letterSpacing: 2, fontFamily: "var(--font-apple)" }}>PRO</span>
        </div>
        {showInstallCTA && (
          <button
            onClick={async () => { if (canInstall) { await promptInstall(); } else { setShowInstallHelp(true); } }}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8, width: "100%",
              background: "transparent", border: "1px solid #f26522", color: "#f26522", borderRadius: 4,
              padding: "10px 14px", marginBottom: 24, cursor: "pointer", fontFamily: "var(--font-apple)",
              fontSize: 12, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase",
            }}>
            <SettingsIcon name="install" size={15} />
            Installer l'application
          </button>
        )}
        <div style={{ display: "flex", marginBottom: 28, borderBottom: "1px solid var(--c-1c1c1c)" }}>
          {[["login", "Connexion"], ["signup", "Inscription"]].map(([m, label]) => (
            <button key={m} onClick={() => { setMode(m); setError(""); setSuccess(""); }} style={{
              flex: 1, background: "transparent", border: "none",
              borderBottom: mode === m ? "2px solid #f26522" : "2px solid transparent",
              color: mode === m ? "var(--c-ddd5c8)" : "var(--c-444)", padding: "10px 0",
              cursor: "pointer", fontFamily: "var(--font-apple)",
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
              <div style={{ fontSize: 10, letterSpacing: 2, color: "var(--c-ddd)", textTransform: "uppercase", fontFamily: "var(--font-apple)", marginBottom: 6 }}>{label}</div>
              <div style={{ position: "relative" }}>
                <input type={effectiveType} value={val} onChange={e => set(e.target.value)} onKeyDown={e => e.key === "Enter" && submit()}
                  placeholder={type === "tel" ? "06 12 34 56 78" : ""}
                  autoComplete={isPassword ? (mode === "signup" ? "new-password" : "current-password") : undefined}
                  style={{ width: "100%", background: "var(--c-1a1a1a)", border: "1px solid var(--c-222)", color: "var(--c-ddd5c8)", padding: isPassword ? "10px 44px 10px 12px" : "10px 12px", borderRadius: 3, fontFamily: "var(--font-apple)", fontSize: 13, outline: "none", boxSizing: "border-box" }} />
                {isPassword && (
                  <button
                    type="button"
                    onClick={() => setShowPassword(p => !p)}
                    aria-label={showPassword ? "Masquer le mot de passe" : "Afficher le mot de passe"}
                    title={showPassword ? "Masquer le mot de passe" : "Afficher le mot de passe"}
                    style={{
                      position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)",
                      background: "transparent", border: "none", padding: "6px 8px",
                      cursor: "pointer", color: "var(--c-ddd)",
                      lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center",
                      minHeight: "unset",
                    }}
                  >
                    <SettingsIcon name={showPassword ? "eye-off" : "eye"} size={17} />
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
              style={{ width: 16, height: 16, borderRadius: 3, border: `2px solid ${cgvAccepted ? "#f26522" : "var(--c-444)"}`, background: cgvAccepted ? "#f26522" : "transparent", flexShrink: 0, marginTop: 1, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
              {cgvAccepted && <span style={{ color: "#090909", fontSize: 12, fontWeight: 900, lineHeight: 1 }}>✓</span>}
            </div>
            <div style={{ fontSize: 11, color: "var(--c-ddd)", fontFamily: "var(--font-apple)", lineHeight: 1.6 }}>
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
              style={{ fontSize: 11, color: "#f26522", cursor: "pointer", fontFamily: "var(--font-apple)", letterSpacing: 1 }}>
              Mot de passe oublié ?
            </span>
          </div>
        )}
        {mode === "reset" && (
          <div style={{ fontSize: 11, color: "var(--c-ddd)", marginBottom: 14, fontFamily: "var(--font-apple)", lineHeight: 1.5 }}>
            Entrez votre email. Vous recevrez un lien pour réinitialiser votre mot de passe.
          </div>
        )}
        {error && <div style={{ fontSize: 11, color: "#e55", marginBottom: 14, fontFamily: "var(--font-apple)" }}>⚠ {error}</div>}
        {success && <div style={{ fontSize: 11, color: "#5a5", marginBottom: 14, fontFamily: "var(--font-apple)" }}>✓ {success}</div>}
        <button onClick={submit} disabled={loading} style={{
          width: "100%", background: "#f26522", color: "#090909", border: "none",
          padding: "13px 24px", cursor: loading ? "wait" : "pointer",
          fontFamily: "var(--font-apple)", fontSize: 14, fontWeight: 700,
          letterSpacing: 4, textTransform: "uppercase", borderRadius: 3,
          opacity: loading ? 0.7 : 1, marginTop: 4
        }}>
          {loading ? "..." : mode === "login" ? "Se connecter" : mode === "reset" ? "Envoyer le lien" : "Créer mon compte"}
        </button>
        {mode === "reset" && (
          <div style={{ textAlign: "center", marginTop: 14 }}>
            <span onClick={() => { setMode("login"); setError(""); setSuccess(""); }}
              style={{ fontSize: 11, color: "var(--c-ddd)", cursor: "pointer", fontFamily: "var(--font-apple)", letterSpacing: 1 }}>
              ← Retour à la connexion
            </span>
          </div>
        )}
        <div style={{ marginTop: 28, paddingTop: 18, borderTop: "1px solid var(--c-1a1a1a)", textAlign: "center", fontSize: 10, color: "var(--c-4a4a4a)", fontFamily: "var(--font-apple)", lineHeight: 2, letterSpacing: 1 }}>
          <a href="/cgv.html" target="_blank" style={{ color: "var(--c-4a4a4a)", textDecoration: "none", marginRight: 16 }}>CGV & Mentions légales</a>
          <a href="/politique-confidentialite.html" target="_blank" style={{ color: "var(--c-4a4a4a)", textDecoration: "none" }}>Politique de confidentialité</a>
        </div>
      </div>
      {showInstallHelp && <InstallHelpModal ios={isIOS} onClose={() => setShowInstallHelp(false)} />}
    </div>
  );
}

// Pictogrammes du menu Paramètres — style "line" sobre, couleur héritée du
// texte (currentColor) pour rester neutre plutôt que des emoji colorés.
function SettingsIcon({ name, size = 16 }) {
  const common = {
    width: size, height: size, viewBox: "0 0 24 24", fill: "none",
    stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round",
    strokeLinejoin: "round",
  };
  switch (name) {
    case "profile": // Mes informations
      return (<svg {...common}><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>);
    case "subscription": // Abonnement
      return (<svg {...common}><rect x="2" y="5" width="20" height="14" rx="2" /><line x1="2" y1="10" x2="22" y2="10" /></svg>);
    case "promo": // Code administrateur
      return (<svg {...common}><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" /><line x1="7" y1="7" x2="7.01" y2="7" /></svg>);
    case "contact": // Nous contacter
      return (<svg {...common}><rect x="2" y="4" width="20" height="16" rx="2" /><polyline points="2,6 12,13 22,6" /></svg>);
    case "tutorial": // Revoir le didacticiel
      return (<svg {...common}><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></svg>);
    case "game": // Mini-jeu
      return (<svg {...common}><rect x="2" y="6" width="20" height="12" rx="3" /><line x1="6" y1="12" x2="10" y2="12" /><line x1="8" y1="10" x2="8" y2="14" /><line x1="16" y1="11" x2="16.01" y2="11" /><line x1="18.5" y1="13" x2="18.51" y2="13" /></svg>);
    case "logout": // Déconnexion
      return (<svg {...common}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16,17 21,12 16,7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>);
    case "install": // Installer l'application
      return (<svg {...common}><rect x="5" y="2" width="14" height="20" rx="2" /><line x1="12" y1="6" x2="12" y2="14" /><polyline points="9,11 12,14 15,11" /><line x1="10" y1="18" x2="14" y2="18" /></svg>);
    case "eye": // Afficher le mot de passe
      return (<svg {...common}><path d="M1.5 12S5.7 5.5 12 5.5 22.5 12 22.5 12 18.3 18.5 12 18.5 1.5 12 1.5 12z" /><circle cx="12" cy="12" r="3.2" /></svg>);
    case "eye-off": // Masquer le mot de passe
      return (<svg {...common}><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" /><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" /><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" /><line x1="2" y1="2" x2="22" y2="22" /></svg>);
    default:
      return null;
  }
}

// ── Abonnement unique AutoCache, décliné en 3 formules de facturation ──
const SUBSCRIPTION_FORMULES = [
  { key: "weekly",  name: "Hebdomadaire", tag: "Découverte", price: "4,90 €",   period: "/semaine", note: "Renouvelé tous les 7 jours", badge: null },
  { key: "monthly", name: "Mensuel",      tag: "Conseillé",  price: "12,90 €",  period: "/mois",     note: "Renouvelé chaque mois, le même jour", badge: "Conseillé" },
  { key: "annual",  name: "Annuel",       tag: "Économies",  price: "119 €",    period: "/an",       note: "au lieu de 154,80 € en mensuel", badge: "Économies" },
];
const FORMULE_LABELS = { weekly: "Hebdomadaire", monthly: "Mensuelle", annual: "Annuelle" };

// Attente de l'activation au retour de Stripe : 12 tentatives espacées de
// 1,5 s, soit ~18 s. Large devant le cas normal (le webhook répond en moins
// d'une seconde) sans laisser l'abonné devant un écran figé si Stripe tarde.
const ACTIVATION_TRIES = 12;
const ACTIVATION_DELAY_MS = 1500;
// ── Showroom Virtuel : fonctionnalité encore en développement ───────────────
// Tant que ce drapeau est vrai, l'option est affichée en « prochainement
// disponible » : elle ne peut pas être cochée, n'est jamais appliquée au
// traitement et n'est pas présentée comme incluse dans l'abonnement.
// Repasser à false pour la remettre en service — penser aussi à la réintégrer
// dans SUBSCRIPTION_FEATURES et à remettre au présent le texte de l'étape
// « showroom » dans components/Tutorial.jsx.
const SHOWROOM_COMING_SOON = true;

// Options incluses dans l'abonnement, affichées cochées sur chaque formule.
// Le Showroom Virtuel n'y figure pas tant qu'il est en développement : on ne
// vend que ce qui est réellement disponible.
// La ligne de quota n'y figure pas : elle dépend de la formule et est ajoutée
// en tête de liste par la carte (250 / semaine en hebdomadaire, 1 000 / mois
// sur les deux autres).
const SUBSCRIPTION_FEATURES = [
  "Cache plaque personnalisé",
  "Logo importé ou généré",
  "Ajustements couleurs & amélioration auto",
  "Enseigne murale",
];
// Ligne de clôture de la liste : annonce les évolutions à venir sans promettre
// une fonctionnalité précise ni date.
const SUBSCRIPTION_FEATURES_TEASER = "Et bientôt de nouvelles fonctionnalités";

export default function AutoCache() {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  // Activation de l'abonnement au retour de Stripe Checkout
  const [activating, setActivating] = useState(false);
  const [activationFailed, setActivationFailed] = useState(false);
  // ── Transition « connexion → application » ──
  // `authExit` efface la carte de connexion, puis `entering` fait apparaître
  // l'application pendant que le logo rejoint l'en-tête.
  const [authExit, setAuthExit] = useState(false);
  const [entering, setEntering] = useState(false);
  const [logo, setLogo] = useState(null);
  const [importedLogo, setImportedLogo] = useState(null); // mémorise le dernier logo importé pour le restaurer après un aller-retour vers "Générer"
  const [photos, setPhotos] = useState([]);
  const [results, setResults] = useState([]);
  const [processing, setProcessing] = useState(false);
  // Bandeau d'erreur serveur de la détection de plaque (clé API, crédits…) :
  // visible à l'écran plutôt qu'enfoui dans la console.
  const [plateErrorBanner, setPlateErrorBanner] = useState(null);
  const [progress, setProgress] = useState({ n: 0, total: 0 });
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [showPromoModal, setShowPromoModal] = useState(false);
  const [showUpgradeProModal, setShowUpgradeProModal] = useState(false);
  const [showPlansModal, setShowPlansModal] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showContactModal, setShowContactModal] = useState(false);
  const [showEmailModal,   setShowEmailModal]   = useState(false);
  const [emailTo,          setEmailTo]          = useState("");
  const [emailSending,     setEmailSending]     = useState(false);
  const [emailStatus,      setEmailStatus]      = useState(null); // { type: "ok"|"err"|"progress", msg }
  const [showMiniGame,     setShowMiniGame]     = useState(false);
  const [showTutorial, setShowTutorial] = useState(false);
  // ── Showroom interactif ──
  const [showCapture360, setShowCapture360] = useState(false);
  // Vrai quand le lot courant vient d'une capture guidée : les résultats sont
  // alors ordonnés autour du véhicule et présentables en tour 360°.
  const [spin360Mode, setSpin360Mode] = useState(false);
  const [showSpinViewer, setShowSpinViewer] = useState(false);
  // Nombre de vues de la ligne médiane, placées en tête du lot : seules
  // celles-là forment le carrousel. Les vues basses et hautes sont traitées
  // comme des photos normales mais sortiraient de l'orbite si on les
  // incluait dans la rotation.
  const [spinRingCount, setSpinRingCount] = useState(0);
  const [showCreditPopup, setShowCreditPopup] = useState(false);
  const [subInfo, setSubInfo] = useState(null); // { periodStart, periodEnd, plan, daysLeft }
  const [subInfoLoading, setSubInfoLoading] = useState(false);
  const creditPopupRef = useRef(null);
  const [hoveredPlan, setHoveredPlan] = useState(null);
  const [checkoutLoading, setCheckoutLoading] = useState(null); // "weekly" | "monthly" | "annual" | null
  const [portalLoading, setPortalLoading] = useState(null); // null | "invoices" | "cancel" | "upgrade"
  const [portalError, setPortalError] = useState("");
  const [promoCode, setPromoCode] = useState("");
  const [promoStatus, setPromoStatus] = useState(null); // null | "loading" | "success" | "error"
  const [promoMsg, setPromoMsg] = useState("");
  const isMobile = useIsMobile();
  const { canInstall, isIOS, installed: appInstalled, promptInstall } = useInstallPrompt();
  const [showInstallHelp, setShowInstallHelp] = useState(false);
  // Sur mobile le raccourci est toujours proposé (instructions manuelles en secours) ;
  // sur desktop uniquement quand le navigateur sait déclencher l'invite native.
  const showInstallMenuItem = !appInstalled && (canInstall || isIOS || isMobile);
  const TRIAL_LIMIT = 30;
  const [adj, setAdj] = useState({ brightness: 1.05, contrast: 1.1, saturation: 1.2 });
  const [adjEnabled, setAdjEnabled] = useState(false);
  const [enhance, setEnhance] = useState(false);
  const [bodyPolish, setBodyPolish] = useState(false);
  const [floorClean, setFloorClean] = useState(false);
  const [enhancePro, setEnhancePro] = useState(false); // couleurs froides + sol uniforme
  // Pose automatique du cache plaque (détection IA). Décoché : les photos
  // sortent telles quelles et le cache se pose manuellement via le bouton
  // "+ Cache plaque" (ajustement 4 coins). Persisté par appareil.
  const [autoPlate, setAutoPlate] = useState(() => (typeof localStorage === "undefined") || localStorage.getItem("ac_auto_plate") !== "0");
  useEffect(() => { try { localStorage.setItem("ac_auto_plate", autoPlate ? "1" : "0"); } catch {} }, [autoPlate]);
  const [enhanceProIntensity, setEnhanceProIntensity] = useState(2); // 0–5 : force du dé-jaunissement (2 par défaut, modifiable)
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
  const [genUnderline, setGenUnderline] = useState(0); // 0 = pas de trait, 1–10 : épaisseur du filet sous le texte
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
  const [adjustCorners, setAdjustCorners] = useState(null); // { tl, tr, br, bl } normalized 0-1 — cache ACTIF
  const [adjustPlates, setAdjustPlates] = useState([]); // tous les caches de la photo (2 ou 3 voitures)
  const [adjustIndex, setAdjustIndex] = useState(0);    // index du cache actif dans adjustPlates
  const [adjustDrag, setAdjustDrag] = useState(null); // { corner, startMx, startMy, startCorners }
  const [manualPlateMode, setManualPlateMode] = useState(false); // true = pose manuelle (plaque non détectée)
  const [lbZoom, setLbZoom] = useState(1);            // zoom de la lightbox (1 = normal, max 8)
  const [lbPan,  setLbPanState]  = useState({ x: 0, y: 0 }); // décalage (px) du calque zoomé
  const [lbPanDrag, setLbPanDrag] = useState(null);   // { startMx, startMy, startPan }
  // Refs miroir du pan et du drag : les événements tactiles s'enchaînent plus
  // vite que les rendus React, et un pan qui repart d'une valeur périmée saute.
  const lbPanRef     = useRef({ x: 0, y: 0 });
  const lbPanDragRef = useRef(null);
  const applyLbPan = (p) => { lbPanRef.current = p; setLbPanState(p); };
  const [settingsOpen, setSettingsOpen] = useState(false); // menu settings en haut à droite
  const settingsRef = useRef(null); // ref pour fermer au clic extérieur
  // Thème de l'interface : "light" (jour, par défaut) ou "dark" (nuit)
  const [theme, setTheme] = useState(() => (typeof localStorage !== "undefined" && localStorage.getItem("ac_theme")) || "light");
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
  const adjustCornersRef = useRef(null); // derniers coins du cache ACTIF (mis à jour direct, sans passer par setState)
  const adjustPlatesRef  = useRef([]);   // tous les caches, dans l'espace du canvas d'ajustement
  const adjustIndexRef   = useRef(0);    // index du cache actif dans adjustPlatesRef
  const adjustDirtyRef   = useRef(false);// cache ajouté mais pas encore aplati dans l'image
  const adjustDragRef    = useRef(null); // sync immédiat avec setAdjustDrag (évite état périmé sur touch)
  const adjustOverlayCanvasRef = useRef(null); // calque transparent du cache plaque (redessiné à chaque frame)
  const adjustRafRef     = useRef(0);    // rAF en attente (coalesce les touchmove → 1 rendu/frame)
  const adjustPendingRef = useRef(null); // dernière position du doigt en attente de rendu
  // ── Loupe tactile (smartphone) : bulle zoomée sur le coin en cours de glissement ──
  const [loupeActive, setLoupeActive] = useState(false);
  const loupeCanvasRef = useRef(null);
  const loupeWrapRef   = useRef(null);

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
  // ── Enseigne murale (option indépendante du showroom) ────────────────────
  const [signEnabled,       setSignEnabled]       = useState(false);
  const [signTitle,         setSignTitle]         = useState("");
  const [signTitleColor,    setSignTitleColor]    = useState("#ffffff");
  const [signFont,          setSignFont]          = useState("rajdhani");
  const [signSubtitle,      setSignSubtitle]      = useState("");
  const [signSubtitleColor, setSignSubtitleColor] = useState("#ffffff");
  const [signScope,         setSignScope]         = useState("all"); // "all" | "selected"
  const [signSelectedIds,   setSignSelectedIds]   = useState(() => new Set());
  const [signLive, setSignLive] = useState(null); // { pos, scale } pendant le déplacement dans la lightbox
  const signDragRef = useRef(null);
  // ── Showroom nudge + zoom (repositionnement / taille voiture) ────────────
  const [showroomNudge,   setShowroomNudge]   = useState({ x: 0, y: 0 });
  const [showroomZoom,    setShowroomZoom]    = useState(DEFAULT_SHOWROOM_ZOOM);
  const [showroomBlend,   setShowroomBlend]   = useState(0); // 0-100, intensité de fondu voiture/décor
  const [showroomNudging, setShowroomNudging] = useState(false);
  const zoomTimerRef = useRef(null);
  const blendTimerRef = useRef(null);
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
      // Paramètres du logo généré (restaurés en premier pour que l'effet de
      // génération reconstruise le bon logo si on bascule en mode "generate").
      const savedGen = JSON.parse(localStorage.getItem('ac_logo_gen') || 'null');
      if (savedGen && typeof savedGen === 'object') {
        if (typeof savedGen.genText === 'string') setGenText(savedGen.genText);
        if (savedGen.genBg) setGenBg(savedGen.genBg);
        if (savedGen.genFg) setGenFg(savedGen.genFg);
        if (savedGen.genFont) setGenFont(savedGen.genFont);
        if (savedGen.genBorderColor) setGenBorderColor(savedGen.genBorderColor);
        if (typeof savedGen.genBorderWidth === 'number') setGenBorderWidth(savedGen.genBorderWidth);
        if (typeof savedGen.genUnderline === 'number') setGenUnderline(savedGen.genUnderline);
      }

      const savedPreview = localStorage.getItem('ac_logo_preview');
      if (savedPreview) {
        const wasGenerated = localStorage.getItem('ac_logo_generated') === '1';
        const savedBg = localStorage.getItem('ac_logo_bgcolor') || '#ffffff';
        if (wasGenerated) {
          // Logo généré : on ouvre l'onglet "Générer" ; l'effet de génération
          // reconstruit le logo à partir des paramètres restaurés ci-dessus.
          // L'onglet "Mon logo" reste réservé aux logos importés.
          setLogoMode('generate');
        } else {
          const restored = { file: null, preview: savedPreview, generated: false, bgColor: savedBg };
          setLogo(restored);
          setImportedLogo(restored);
          setLogoMode('import');
        }
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

  // Sauvegarder logo cache plaque → localStorage.
  // Un logo importé depuis un téléphone peut peser plusieurs Mo une fois en
  // base64 et dépasser le quota du navigateur. Sans repli, l'écriture échouait
  // en silence et le logo était perdu au démarrage suivant : on libère donc
  // l'original de recadrage, puis on se rabat sur une version réduite —
  // largement suffisante pour un cache plaque — plutôt que de ne rien garder.
  useEffect(() => {
    if (!logo?.preview || !logo.preview.startsWith('data:')) return;
    let cancelled = false;
    const write = (preview) => {
      localStorage.setItem('ac_logo_preview', preview);
      localStorage.setItem('ac_logo_generated', logo.generated ? '1' : '0');
      if (logo.bgColor) localStorage.setItem('ac_logo_bgcolor', logo.bgColor);
    };
    (async () => {
      try { write(logo.preview); return; } catch (e) {}
      try { localStorage.removeItem('ac_logo_original'); } catch (e) {}
      try { write(logo.preview); return; } catch (e) {}
      for (const side of LOGO_STORE_SIDES) {
        const reduced = await shrinkDataURL(logo.preview, side);
        if (cancelled) return;
        if (!reduced) break;
        try { write(reduced); return; } catch (e) {}
      }
      console.warn('[Logo] quota localStorage insuffisant : logo non conservé');
    })();
    return () => { cancelled = true; };
  }, [logo]);

  useEffect(() => {
    try {
      if (logoOriginal) localStorage.setItem('ac_logo_original', logoOriginal);
      else localStorage.removeItem('ac_logo_original');
    } catch(e) {}
  }, [logoOriginal]);

  // Persiste les paramètres du logo généré (texte, couleurs, police, liseret,
  // filet) pour pouvoir le reconstruire à l'identique au prochain démarrage.
  useEffect(() => {
    try {
      localStorage.setItem('ac_logo_gen', JSON.stringify({ genText, genBg, genFg, genFont, genBorderColor, genBorderWidth, genUnderline }));
    } catch(e) {}
  }, [genText, genBg, genFg, genFont, genBorderColor, genBorderWidth, genUnderline]);

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

  // Miroir de l'état d'authentification, lisible depuis les abonnements
  // Supabase qui capturent des valeurs figées.
  const authStateRef = useRef({ user: null, loading: true });
  useEffect(() => { authStateRef.current = { user, loading: authLoading }; }, [user, authLoading]);

  // Pose l'utilisateur renvoyé par Supabase. Quand il arrive alors que l'écran
  // de connexion est affiché, la transition animée s'intercale : la carte
  // s'efface (AUTH_EXIT_MS), puis l'application apparaît pendant que le logo
  // rejoint l'en-tête. La restauration de session au chargement et les simples
  // rafraîchissements de jeton passent directement, sans animation.
  const enterTimerRef = useRef(null);
  const pendingUserRef = useRef(null);
  const applyUser = useCallback((nextUser) => {
    const { user: current, loading } = authStateRef.current;
    if (nextUser && !current && !loading && !prefersReducedMotion()) {
      pendingUserRef.current = nextUser;
      if (enterTimerRef.current) return; // transition déjà lancée
      setAuthExit(true);
      enterTimerRef.current = setTimeout(() => {
        enterTimerRef.current = null;
        setAuthExit(false);
        setEntering(true);
        setUser(pendingUserRef.current);
      }, AUTH_EXIT_MS);
      return;
    }
    if (!nextUser) { // déconnexion : on annule une transition éventuellement en cours
      clearTimeout(enterTimerRef.current);
      enterTimerRef.current = null;
      setAuthExit(false);
      setEntering(false);
    }
    setUser(nextUser);
  }, []);
  const finishEntering = useCallback(() => setEntering(false), []);
  useEffect(() => () => clearTimeout(enterTimerRef.current), []);

  useEffect(() => {
    // Retour depuis Stripe Checkout
    const params = new URLSearchParams(window.location.search);
    if (params.get("payment") === "success") {
      window.history.replaceState({}, "", window.location.pathname);
      // ── Activation après paiement ──
      // Le webhook Stripe met le compte à jour côté serveur, mais le jeton de
      // session déjà présent dans le navigateur porte encore l'ancien plan, et
      // Supabase ne le rafraîchit de lui-même qu'à son expiration (une heure).
      // Une attente fixe serait un pari : démarrage à froid de la fonction
      // webhook, latence de livraison Stripe, écriture Supabase — le tout peut
      // dépasser quelques secondes, et l'abonné retomberait alors sur l'écran
      // d'essai après avoir payé. On interroge donc jusqu'à ce que le plan
      // bascule réellement, avec un plafond pour ne pas boucler indéfiniment.
      setActivating(true);
      (async () => {
        for (let i = 0; i < ACTIVATION_TRIES; i++) {
          const { data } = await supabase.auth.refreshSession();
          if (data?.user) {
            setUser(data.user);
            if ((data.user.user_metadata?.plan ?? "trial") !== "trial") {
              setActivating(false);
              return;
            }
          }
          await new Promise(r => setTimeout(r, ACTIVATION_DELAY_MS));
        }
        // Le paiement est encaissé — c'est la propagation qui traîne. On le dit
        // clairement plutôt que de laisser l'abonné croire qu'il a payé pour rien.
        setActivating(false);
        setActivationFailed(true);
      })();
    }
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user || null);
      setAuthLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") {
        // L'écran affiché est celui du nouveau mot de passe, pas l'application :
        // aucune transition à jouer.
        setPasswordRecovery(true);
        setUser(session?.user || null);
        return;
      }
      applyUser(session?.user || null);
    });
    return () => subscription.unsubscribe();
  }, []);

  // ── Didacticiel automatique à la première connexion ──
  useEffect(() => {
    if (!user || authLoading) return;
    if (entering) return; // on laisse la transition d'entrée se terminer
    if (!user.user_metadata?.tutorial_seen) {
      // Basculer sur l'onglet Configuration pour que les éléments cibles existent
      setTab("setup");
      const t = setTimeout(() => setShowTutorial(true), 600);
      return () => clearTimeout(t);
    }
  }, [user, authLoading, entering]);

  // ── Préchauffe le module @imgly/background-removal dès que l'utilisateur
  // est authentifié, pour ne plus payer le coût d'init au premier traitement.
  useEffect(() => {
    if (!user || authLoading) return;
    const idleCb = window.requestIdleCallback ?? ((cb) => setTimeout(cb, 1500));
    const handle = idleCb(() => { preloadBackgroundRemoval(); preloadPlateKeypoints(); });
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

  // Applique le thème (jour/nuit) sur <html> et le persiste
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try { localStorage.setItem("ac_theme", theme); } catch {}
  }, [theme]);

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
    setLogo({ file: null, preview: makeLogoDataURL(genText, genBg, genFg, logoRadius * 5, genFont, genBorderWidth > 0 ? genBorderColor : null, genBorderWidth, genUnderline), generated: true, bgColor: genBg });
  }, [logoMode, genText, genBg, genFg, logoRadius, genFont, genBorderColor, genBorderWidth, genUnderline]);

  const handleLogoFile = (f) => {
    if (!f?.type.startsWith("image/")) return;
    setLogoMode("import");
    setLogoOriginal(null);
    setLogoCropActive(false);
    setLogoCropBox({ x: 0, y: 0, w: 1, h: 1 });
    const reader = new FileReader();
    reader.onload = (e) => {
      const imported = { file: f, preview: e.target.result, generated: false, bgColor: '#ffffff' };
      setLogo(imported);
      setImportedLogo(imported);
    };
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
      const cropped = { ...logo, preview: c.toDataURL('image/png') };
      setLogo(cropped);
      setImportedLogo(cropped);
      setLogoCropActive(false);
      setLogoCropBox({ x: 0, y: 0, w: 1, h: 1 });
    };
    img.src = srcDataURL;
  };

  const handlePhotoFiles = files => {
    const imgs = Array.from(files).filter(f => f.type.startsWith("image/"));
    setPhotos(prev => [...prev, ...imgs.map(f => ({ file: f, preview: URL.createObjectURL(f), id: `${f.name}-${Math.random()}` }))]);
    // Ajouter des photos à la main casse l'ordre circulaire du tour : le lot
    // n'est plus présentable en 360°.
    setSpin360Mode(false);
  };

  // Vues issues de la capture guidée. Un tour 360° décrit UN véhicule dans un
  // ordre circulaire : la capture remplace donc le lot au lieu de s'y ajouter,
  // sinon l'ordre des vues (et le tour) n'aurait plus de sens.
  const handleCapturedViews = (files, meta = {}) => {
    const imgs = Array.from(files).filter(f => f.type.startsWith("image/"));
    if (!imgs.length) return;
    photos.forEach(p => URL.revokeObjectURL(p.preview));
    setPhotos(imgs.map((f, i) => ({ file: f, preview: URL.createObjectURL(f), id: `spin-${i}-${Math.random()}` })));
    setSpinRingCount(meta.ringCount ?? imgs.length);
    setSpin360Mode(true);
  };

  const startAfterInfo = async () => {
    if (!logo || !photos.length) return;
    const photosUsed = user?.user_metadata?.photos_used ?? 0;
    if (photosUsed >= PLAN_LIMIT) { setShowUpgradeModal(true); return; }
    const remaining = PLAN_LIMIT - photosUsed;
    const maxPhotos = remaining;
    const photosToProcess = photos.slice(0, maxPhotos);
    setProcessing(true);
    setPlateErrorBanner(null);
    resetPlateApiError();
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
    // L'enseigne murale a été déplacée dans son propre bloc (voir signImageUrl) :
    // plus de logo mural dessiné sur le décor showroom.
    const resolvedWallLogo = null;
    const wallLogoRatio = 0.4;
    // ── Enseigne murale : bannière (enseigne + sous-titre) ──
    let signImageUrl = null, signRatio = 0.4;
    if (signEnabled && (signTitle.trim() || signSubtitle.trim())) {
      const sm = makeSignDataURL({
        title: signTitle.trim(),
        titleColor: signTitleColor,
        fontKey: signFont,
        subtitle: signSubtitle.trim(),
        subtitleColor: signSubtitleColor,
      });
      signImageUrl = sm.url; signRatio = sm.ratio;
    }
    const all = [];
    const showroomBgDataUrl = showroomActive
      ? (showroomSetupBg === 'custom' && showroomSetupCustomBg
          ? showroomSetupCustomBg
          : (SHOWROOM_IMAGES[showroomSetupBg] ?? makeShowroomBackground(showroomSetupBg, 2400, 1350)))
      : null;

    // ── Pipelining : la détection de plaque (réseau, plusieurs secondes) des
    // photos suivantes tourne PENDANT le rendu canvas/showroom (local) de la
    // photo courante, au lieu d'attendre son tour. Deux détections d'avance
    // maximum : latence divisée sans pic mémoire (les appels sont réseau).
    const plateJobs = new Array(photosToProcess.length).fill(undefined);
    const startPlateJob = (idx) => {
      if (idx >= 0 && idx < photosToProcess.length && plateJobs[idx] === undefined) {
        plateJobs[idx] = autoPlate
          ? detectPlate(photosToProcess[idx].file).catch(e => { console.warn('[plate] préfetch échoué:', e?.message); return null; })
          : Promise.resolve(null);
      }
    };
    startPlateJob(0); startPlateJob(1);

    for (let i = 0; i < photosToProcess.length; i++) {
      startPlateJob(i + 1); startPlateJob(i + 2);
      const plateResult = await plateJobs[i];
      const r = await processPhoto(photosToProcess[i].file, logoImg, adjEnabled ? adj : { brightness: 1, contrast: 1, saturation: 1 }, bgColor, enhance, !!logoImg || showroomActive, floorClean, enhancePro, bodyPolish, enhanceProIntensity, autoPlate, plateResult, showroomActive);
      const entry = { ...r, logoPreview: logo.preview, bgColor, generated: !!logo.generated };
      if (showroomActive && showroomBgDataUrl) {
        try {
          // Vehicle detection + instance segmentation (backend) or fallback (@imgly + heuristics)
          const vehicleResult = await detectVehicles(photosToProcess[i].file);
          const allVehicles = vehicleResult?.vehicles ?? [];
          const mainVehicle = selectMainVehicle(allVehicles, r.yoloBbox ?? null, r.imgW, r.imgH);
          const secondaryVehicles = getSecondaryVehicles(allVehicles, mainVehicle);
          console.log('[Pipeline] mainVehicle=' + (mainVehicle ? mainVehicle.class : 'none') +
            ', secondary=' + secondaryVehicles.length +
            (secondaryVehicles.length > 0 ? ' [' + secondaryVehicles.map(s => s.class).join(',') + ']' : ''));

          // Détourage : API Pro serveur (Photoroom / remove.bg) en priorité,
          // repli local @imgly + heuristiques sinon.
          const roi = estimateMainVehicleROI(mainVehicle, r.yoloBbox ?? null, r.imgW, r.imgH, secondaryVehicles);
          const { croppedUrl, roi: appliedROI } = await cropToROI(r.baseDataURL, roi);
          const pro = await proShowroomCutout(croppedUrl);
          let cutout;
          if (pro) {
            // Le cutout Pro isole déjà le sujet principal (dans la ROI qui
            // écarte les voisins) et embarque son ombre IA dans l'alpha : les
            // nettoyages heuristiques (composantes connexes, séparation,
            // gate bbox) rogneraient l'ombre — on les court-circuite.
            cutout = await uncropCutout(pro.dataUrl, appliedROI, r.imgW, r.imgH, r.baseDataURL);
          } else {
            const croppedCutout = await removeBackground(croppedUrl);
            const fullCutout = await uncropCutout(croppedCutout, appliedROI, r.imgW, r.imgH, r.baseDataURL);
            const isolatedCutout = await isolateMainVehicle(fullCutout, r.yoloBbox ?? null, mainVehicle, secondaryVehicles);
            const separatedCutout = await separateAttachedSecondary(isolatedCutout, mainVehicle, r.yoloBbox ?? null, secondaryVehicles);
            cutout = await hardGateByVehicleBox(separatedCutout, mainVehicle, r.yoloBbox ?? null, r.imgW, r.imgH, secondaryVehicles);
          }

          // Scan tight bbox du véhicule UNE seule fois — réutilisé par
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
          freeCanvas(scanC); // bbox calculé → libère ce canvas pleine résolution

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
            freeCanvas(dc);
          }

          const wOpts = resolvedWallLogo ? { src: resolvedWallLogo, scale: wallLogoScale, opacity: wallLogoOpacity, x: 0.5, y: 0.25 } : null;
          // Default blend = 60 so the vehicle integrates with the décor as soon as
          // the photo is generated. User can still drag the slider down to 0 in the
          // lightbox to disable the effect entirely.
          const sr = await compositeCarOnBg(cutout, showroomBgDataUrl, 2400, 1350, logoImg, r.corners, bgColor, 0, 0, DEFAULT_SHOWROOM_ZOOM, true, wOpts, 60, carBounds, r.extraCorners);
          // iOS : sous pression mémoire, toDataURL() peut renvoyer une image
          // vide ("data:,") sans lever d'erreur → vignette/lightbox cassées.
          // On préfère perdre le décor (photo sans showroom) qu'afficher du vide.
          if (!sr?.dataURL || sr.dataURL.length < 1000) throw new Error('rendu showroom vide (mémoire insuffisante ?)');

          // For debug modes that show source-based overlays, override the showroom result
          if (debugDataURL) {
            entry.cutoutDataURL     = cutout;
            entry.showroomDataURL   = debugDataURL;
            entry.showroomBaseURL   = debugDataURL;
            entry.showroomTransform = sr.transform;
          } else {
            entry.cutoutDataURL     = cutout;
            entry.showroomDataURL   = sr.dataURL;
            entry.showroomBaseURL   = sr.baseURL;
            entry.showroomTransform = sr.transform;
          }
          entry.showroomBgUrl     = showroomBgDataUrl;
          entry.showroomZoom      = DEFAULT_SHOWROOM_ZOOM; // taille par défaut de la voiture dans le décor
          entry.showroomBlend     = 60; // default blend so the lightbox slider opens at 60 %
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
      // ── Applique l'enseigne sur la sortie finale (avec ou sans showroom) ──
      const applySign = signImageUrl && (signScope === "all" || signSelectedIds.has(photosToProcess[i].id));
      if (applySign) {
        const pos = { x: 0.5, y: 0.16 }, scale = 0.64;
        const base = entry.showroomDataURL || entry.processed; // image propre (sans enseigne)
        entry.signImageUrl = signImageUrl;
        entry.signRatio    = signRatio;
        entry.signPos      = pos;
        entry.signScale    = scale;
        entry.signBaseUrl  = base; // conservée pour déplacer/redimensionner l'enseigne
        try {
          const baked = await overlaySignOnImage(base, signImageUrl, pos, scale);
          if (entry.showroomDataURL) entry.showroomDataURL = baked; else entry.processed = baked;
        } catch (e) { console.error('Sign overlay error:', e); }
      }
      all.push(entry);
      setResults([...all]);
      setProgress({ n: i + 1, total: photos.length });
    }
    // Mettre à jour le compteur de photos utilisées
    const newCount = photosUsed + photosToProcess.length;
    const updateData = { photos_used: newCount };
    await supabase.auth.updateUser({ data: updateData });
    setUser(prev => prev ? { ...prev, user_metadata: { ...prev.user_metadata, ...updateData } } : prev);
    setProcessing(false);
    setTab("results");
    // Des caches manquants + une erreur serveur pendant le lot → bandeau
    // explicite (clé Anthropic invalide, crédits API épuisés, panne…).
    const apiErr = getPlateApiError();
    if (apiErr && autoPlate && all.some(r => !r.plateFound && !r.autoPlateOff)) {
      setPlateErrorBanner(apiErr);
    }
    if (newCount >= PLAN_LIMIT) setShowUpgradeModal(true);
  };

  const start = () => startAfterInfo();

  const downloadOne = async r => {
    const href = r.showroomDataURL || r.processed;
    const a = document.createElement("a"); a.href = href; a.download = `${r.showroomDataURL ? "showroom_" : "autocache_"}${r.name}`; a.click();
  };
  const downloadAll = async () => { for (const r of results) await downloadOne(r); };

  // Ouvre la modale d'envoi par email en pré-remplissant l'adresse :
  // adresse sauvegardée sur le compte, sinon l'email du compte.
  const openEmailModal = () => {
    // Pré-remplit uniquement avec l'adresse déjà saisie/sauvegardée — pas
    // l'email du compte — pour que le champ soit vide à la première utilisation.
    setEmailTo(user?.user_metadata?.export_email || "");
    setEmailStatus(null);
    setShowEmailModal(true);
  };

  // Envoie toutes les photos traitées en pièces jointes par email (via Brevo,
  // /api/send-photos). Les photos sont découpées en lots pour rester sous la
  // limite de requête de Vercel (~4,5 Mo).
  const sendPhotosByEmail = async () => {
    const to = emailTo.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      setEmailStatus({ type: "err", msg: "Adresse email invalide." });
      return;
    }
    if (!results.length) {
      setEmailStatus({ type: "err", msg: "Aucune photo à envoyer." });
      return;
    }
    setEmailSending(true);
    setEmailStatus({ type: "progress", msg: "Préparation des photos…" });
    try {
      // Construit les pièces jointes allégées pour l'email (redimensionnées +
      // légèrement compressées) : indispensable pour regrouper plusieurs
      // photos par mail et éviter d'envoyer 1 photo/mail.
      const EMAIL_MAX_PX = 2000;   // grand côté max des pièces jointes
      const EMAIL_QUALITY = 0.85;  // compression JPEG légère (qualité conservée)
      const items = [];
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        const dataURL = await shrinkDataUrl(r.showroomDataURL || r.processed, EMAIL_MAX_PX, EMAIL_QUALITY);
        const content = dataURL.includes(",") ? dataURL.split(",").pop() : dataURL;
        const base = (r.name || `photo_${i + 1}`).replace(/\.[^.]+$/, "");
        const prefix = r.showroomDataURL ? "showroom_" : "autocache_";
        items.push({ name: `${prefix}${base}.jpg`, content });
      }
      // Découpe en lots : on remplit chaque mail au maximum sous la limite de
      // requête Vercel (~4,5 Mo). Avec les photos allégées, cela regroupe
      // plusieurs photos par mail (en pratique bien plus que 3).
      const MAX_BATCH_BYTES = 4_000_000;
      const batches = [];
      let cur = [], curSize = 0;
      for (const it of items) {
        const sz = it.content.length;
        if (cur.length && curSize + sz > MAX_BATCH_BYTES) { batches.push(cur); cur = []; curSize = 0; }
        cur.push(it); curSize += sz;
      }
      if (cur.length) batches.push(cur);

      for (let b = 0; b < batches.length; b++) {
        setEmailStatus({ type: "progress", msg: `Envoi ${b + 1}/${batches.length}…` });
        const resp = await fetch("/api/send-photos", {
          method: "POST",
          headers: await authHeaders(),
          body: JSON.stringify({
            to,
            subject: "Vos photos AutoCache",
            attachments: batches[b],
            batch: { index: b + 1, total: batches.length },
          }),
        });
        if (!resp.ok) {
          const e = await resp.json().catch(() => ({}));
          throw new Error(e.error || `Erreur ${resp.status}`);
        }
      }

      // Mémorise l'adresse comme défaut du compte si elle a changé.
      if (user && to !== (user.user_metadata?.export_email || "")) {
        try {
          await supabase.auth.updateUser({ data: { export_email: to } });
          setUser(prev => prev ? { ...prev, user_metadata: { ...prev.user_metadata, export_email: to } } : prev);
        } catch {}
      }

      setEmailStatus({ type: "ok", msg: `${results.length} photo${results.length > 1 ? "s" : ""} envoyée${results.length > 1 ? "s" : ""} à ${to}.` });
    } catch (e) {
      setEmailStatus({ type: "err", msg: e.message || "Échec de l'envoi." });
    } finally {
      setEmailSending(false);
    }
  };
  const pct = progress.total ? Math.round((progress.n / progress.total) * 100) : 0;

  // Le voile de traitement reste monté le temps de son fondu de sortie, pour
  // que la fin du lot ne se termine pas par une disparition sèche.
  const [procVisible, setProcVisible] = useState(false);
  useEffect(() => {
    if (processing) { setProcVisible(true); return; }
    const t = setTimeout(() => setProcVisible(false), PROCESSING_EXIT_MS);
    return () => clearTimeout(t);
  }, [processing]);
  const userPlan = user?.user_metadata?.plan ?? "trial"; // "trial" | "premium" (ancien : "essential" | "pro")
  const isPaid = userPlan !== "trial"; // abonnement unique : toute valeur ≠ trial donne l'accès complet
  // Le quota dépend de la cadence de facturation : 250 photos par semaine en
  // hebdomadaire, 1 000 par mois sur les formules mensuelle et annuelle.
  const userFormule = user?.user_metadata?.formule;
  const PLAN_LIMIT = isPaid ? photosForFormule(userFormule) : TRIAL_LIMIT;
  const PLAN_LABEL = isPaid ? "CRÉDIT" : "ESSAI";
  // L'abonnement unique inclut toutes les fonctionnalités. L'essai conserve l'accès au Showroom (vitrine).
  // Le Showroom reste verrouillé pour tout le monde tant qu'il est en développement.
  const canUseShowroom  = !SHOWROOM_COMING_SOON && (isPaid || userPlan === "trial");
  // Seule condition qui déclenche réellement le rendu showroom du pipeline.
  const showroomActive  = showroomEnabled && canUseShowroom;
  const canUseBodyPolish  = isPaid;
  // Showroom interactif : accès sur invitation uniquement, déverrouillé par le
  // code administrateur AURELE3D (métadonnée `showroom_interactif`). Aucun lien
  // avec l'abonnement tant que la fonctionnalité est en test terrain.
  const canUseShowroomInteractif = user?.user_metadata?.showroom_interactif === true;
  const canStart = logo && photos.length > 0 && !processing;

  const fetchSubInfo = useCallback(async () => {
    if (!user?.id || subInfoLoading) return;
    setSubInfoLoading(true);
    try {
      const r = await fetch('/api/customer-portal', {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({ action: 'subscription-info' }),
      });
      const d = await r.json();
      if (d.hasSubscription) {
        const endDate = new Date(d.periodEnd * 1000);
        const startDate = new Date(d.periodStart * 1000);
        const now = new Date();
        const daysLeft = Math.max(0, Math.ceil((endDate - now) / (1000 * 60 * 60 * 24)));
        setSubInfo({
          periodStart: startDate, periodEnd: endDate, plan: d.plan, formule: d.formule, daysLeft,
          status: d.status, cancelAtPeriodEnd: !!d.cancelAtPeriodEnd,
        });
        // Le plan est porté par le jeton de session, qui n'est rafraîchi qu'au
        // bout d'une heure. Quand Stripe indique un abonnement en défaut de
        // paiement alors que la session locale se croit encore payante, on
        // force le rafraîchissement : la coupure d'accès décidée par le webhook
        // prend effet tout de suite au lieu d'attendre l'expiration du jeton.
        const stripeGrantsAccess = d.status === 'active' || d.status === 'trialing';
        if (!stripeGrantsAccess && (user.user_metadata?.plan ?? 'trial') !== 'trial') {
          const { data: refreshed } = await supabase.auth.refreshSession();
          if (refreshed?.user) setUser(refreshed.user);
        }
      } else {
        setSubInfo({ hasSubscription: false });
      }
    } catch (e) {
      console.warn('[SubInfo] fetch failed:', e.message);
      setSubInfo(null);
    }
    setSubInfoLoading(false);
  }, [user?.id, subInfoLoading]);

  // ── Recopie du téléphone dans la colonne dédiée ──
  // Renseigné aux métadonnées à l'inscription, il ne peut être recopié dans la
  // colonne `phone` qu'une fois la session ouverte, l'appel serveur exigeant
  // un compte authentifié. On ne tente la synchronisation qu'une seule fois,
  // quand la colonne est encore vide.
  useEffect(() => {
    if (!user?.id) return;
    const pending = user.user_metadata?.phone;
    if (!pending || user.phone) return;
    (async () => {
      try {
        await fetch('/api/set-user-phone', {
          method: 'POST',
          headers: await authHeaders(),
          body: JSON.stringify({ phone: pending }),
        });
      } catch { /* non bloquant : le numéro reste disponible dans les métadonnées */ }
    })();
  }, [user?.id, user?.phone]);

  // ── Renouvellement du quota ──
  // La fenêtre suit la cadence de facturation : 7 jours en hebdomadaire,
  // un mois calendaire sur les formules mensuelle et annuelle. Les règles sont
  // dans src/subscriptionQuota.js, partagées avec le webhook Stripe pour que
  // les deux chemins ne puissent pas accorder deux quotas pour une même fenêtre.
  useEffect(() => {
    if (!user?.id) return;
    const meta = user.user_metadata || {};
    if ((meta.plan ?? "trial") === "trial") return; // l'essai n'a pas de renouvellement
    const anchorStr = meta.photos_period_start;
    if (!anchorStr) {
      // Initialise la fenêtre (abonnement créé avant ce mécanisme)
      const data = { photos_period_start: new Date().toISOString() };
      supabase.auth.updateUser({ data });
      setUser(prev => prev ? { ...prev, user_metadata: { ...prev.user_metadata, ...data } } : prev);
      return;
    }
    const periods = periodsElapsed(meta.formule, anchorStr);
    if (periods >= 1) {
      const data = {
        photos_used: 0,
        photos_period_start: advanceAnchor(meta.formule, anchorStr, periods),
      };
      supabase.auth.updateUser({ data });
      setUser(prev => prev ? { ...prev, user_metadata: { ...prev.user_metadata, ...data } } : prev);
    }
  }, [user?.id]);

  // Lance le paiement Stripe pour une formule donnée (weekly | monthly | annual)
  const startCheckout = async (formule) => {
    setCheckoutLoading(formule);
    try {
      const res = await fetch("/api/create-checkout-session", {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({ formule }),
      });
      const data = await res.json();
      if (data.url) window.location.href = data.url;
      else alert("Erreur lors de la création du paiement.");
    } catch (e) {
      alert("Erreur réseau, réessayez.");
    } finally {
      setCheckoutLoading(null);
    }
  };

  // Grille des 3 formules — même format que les cartes plans (liste cochée par carte)
  const renderFormulesGrid = () => (
    <>
    <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr", gap: 14, marginBottom: 12 }}>
      {SUBSCRIPTION_FORMULES.map(f => {
        const hot = f.key === "monthly";
        return (
          <div key={f.key}
            onMouseEnter={() => setHoveredPlan(f.key)}
            onMouseLeave={() => setHoveredPlan(null)}
            style={{ display: "flex", flexDirection: "column", background: hot ? "rgba(242,101,34,0.05)" : "var(--c-0e0e0e)", border: `1px solid ${hot ? "#f26522" : "var(--c-2a2a2a)"}`, borderRadius: 6, padding: "24px 20px", position: "relative", transform: hoveredPlan === f.key ? "scale(1.03)" : "scale(1)", transition: "transform 0.15s ease" }}>
            {f.badge && (
              <div style={{ position: "absolute", top: -10, left: "50%", transform: "translateX(-50%)", background: "#f26522", color: "#090909", fontSize: 9, fontWeight: 700, letterSpacing: 2, padding: "3px 10px", borderRadius: 10, fontFamily: "var(--font-apple)", textTransform: "uppercase", whiteSpace: "nowrap" }}>{f.badge}</div>
            )}
            <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: 2, color: hot ? "#f26522" : "var(--c-aaa)", textTransform: "uppercase", marginBottom: 2 }}>{f.name}</div>
            <div style={{ fontSize: 9, color: "var(--c-777)", fontFamily: "var(--font-apple)", letterSpacing: 1, textTransform: "uppercase", marginBottom: 12 }}>{f.tag}</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginBottom: 4 }}>
              <span style={{ fontSize: 22, fontWeight: 700, color: hot ? "#f26522" : "var(--c-e0dbd4)" }}>{f.price}</span>
              <span style={{ fontSize: 10, color: "var(--c-ddd)", fontFamily: "var(--font-apple)", letterSpacing: 1 }}>{f.period}</span>
            </div>
            <div style={{ fontSize: 9.5, color: "var(--c-888)", fontFamily: "var(--font-apple)", letterSpacing: 0.5, marginBottom: 16, minHeight: 26 }}>{f.note}</div>
            <div style={{ marginBottom: 20 }}>
              {[quotaLabel(f.key), ...SUBSCRIPTION_FEATURES].map((label, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 7 }}>
                  <span style={{ fontSize: 12, color: "#27ae60", flexShrink: 0 }}>✓</span>
                  <span style={{ fontSize: 11, color: "var(--c-bbb)", fontFamily: "var(--font-apple)", letterSpacing: 0.5 }}>{label}</span>
                </div>
              ))}
              {/* Évolutions à venir — style distinct du reste de la liste pour
                  ne pas se lire comme une option déjà incluse. */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
                <span style={{ fontSize: 12, color: "#f26522", flexShrink: 0 }}>＋</span>
                <span style={{ fontSize: 11, color: "var(--c-888)", fontFamily: "var(--font-apple)", letterSpacing: 0.5, fontStyle: "italic" }}>{SUBSCRIPTION_FEATURES_TEASER}</span>
              </div>
            </div>
            <button
              disabled={checkoutLoading === f.key}
              onClick={() => startCheckout(f.key)}
              style={{ width: "100%", marginTop: "auto", background: hot ? "#f26522" : "transparent", color: hot ? "#090909" : "var(--c-888)", border: `1px solid ${hot ? "#f26522" : "var(--c-333)"}`, padding: "11px 0", fontFamily: "var(--font-apple)", fontSize: 13, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", borderRadius: 3, cursor: "pointer" }}>
              {checkoutLoading === f.key ? "Redirection..." : `Choisir ${f.name}`}
            </button>
          </div>
        );
      })}
    </div>
    {/* Levée d'objection à l'endroit où elle se pose : au moment de choisir. */}
    <div style={{ fontSize: 11, color: "var(--c-888)", fontFamily: "var(--font-apple)", letterSpacing: 0.5, lineHeight: 1.6, textAlign: "center", marginBottom: 24 }}>
      Sans engagement — résiliable à tout moment en deux clics. Votre accès reste ouvert jusqu'au terme de la période déjà réglée, sans nouveau prélèvement.
    </div>
    </>
  );

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
    // Le logo cache plaque n'est pas remis à zéro : il est conservé d'une
    // session à l'autre (cf. restauration depuis localStorage). L'effacer ici
    // le faisait disparaître de l'écran à la reconnexion, alors qu'il était
    // toujours enregistré — il ne revenait qu'après un rechargement de page.
    setPhotos([]); setResults([]); setTab("setup"); setSpin360Mode(false);
  };

  const submitPromo = async () => {
    if (!promoCode.trim() || promoStatus === "loading") return;
    setPromoStatus("loading");
    try {
      const res = await fetch("/api/promo", { method: "POST", headers: await authHeaders(), body: JSON.stringify({ code: promoCode.trim() }) });
      const data = await res.json();
      if (!data.valid) { setPromoStatus("error"); setPromoMsg(data.message); return; }
      if (data.plan) {
        await supabase.auth.updateUser({ data: { plan: data.plan } });
        setUser(prev => prev ? { ...prev, user_metadata: { ...prev.user_metadata, plan: data.plan } } : prev);
        setPromoStatus("success");
        const planLabel = data.plan === "trial" ? "Essai gratuit" : "Abonnement";
        setPromoMsg(`${planLabel} activé.`);
        return;
      }
      // Déverrouillage d'une fonctionnalité en accès restreint (ex. AURELE3D
      // → Showroom interactif). Le drapeau vit dans les métadonnées du compte,
      // il survit donc au rechargement et suit l'utilisateur d'un appareil à
      // l'autre.
      if (data.feature) {
        await supabase.auth.updateUser({ data: { [data.feature]: true } });
        setUser(prev => prev ? { ...prev, user_metadata: { ...prev.user_metadata, [data.feature]: true } } : prev);
        setPromoStatus("success");
        setPromoMsg(`${data.label || "Fonctionnalité"} déverrouillé.`);
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

  // ── Caches plaque de la photo courante (mode Ajuster) ────────────────────
  // Charge la liste des caches d'un résultat et rend le premier actif.
  const resetAdjustPlates = (r) => {
    const plates = plateList(r);
    adjustPlatesRef.current  = plates;
    adjustIndexRef.current   = 0;
    adjustCornersRef.current = plates[0] || null;
    setAdjustPlates(plates);
    setAdjustIndex(0);
    setAdjustCorners(plates[0] || null);
  };

  // Liste à jour des caches : `adjustPlatesRef` avec le cache actif remplacé
  // par les coins en cours d'édition (qui vivent dans `adjustCornersRef`).
  const currentPlates = (active) => {
    const list = (adjustPlatesRef.current || []).slice();
    const act = active || adjustCornersRef.current;
    if (act) {
      const i = adjustIndexRef.current;
      if (i >= 0 && i < list.length) list[i] = act; else list.push(act);
    }
    return list;
  };

  const openLightbox  = (r) => {
    setLightbox(r);
    setCropMode(false); setCropBox({ x: 0.1, y: 0.1, w: 0.8, h: 0.8 }); setCropAngle(180);
    setAdjustMode(false); setAdjustDrag(null);
    resetAdjustPlates(r);
    setShowMaskEditor(false);
    setLbZoom(1); applyLbPan({ x: 0, y: 0 }); clearLbPan();
    setShowroomNudge(r.showroomOffset ?? { x: 0, y: 0 });
    setShowroomZoom(r.showroomZoom ?? DEFAULT_SHOWROOM_ZOOM);
    setShowroomBlend(r.showroomBlend ?? 0);
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
            nd.x, nd.y, zm, true, wOpts, bl,
            prev.carBoundsCache, prev.extraCorners
          );
          // Ré-applique l'enseigne (le compositing repart du décor sans elle)
          let finalShowroom = sr.dataURL;
          const signExtra = {};
          if (prev.signImageUrl) {
            signExtra.signBaseUrl = sr.dataURL; // base propre pour déplacer l'enseigne
            finalShowroom = await overlaySignOnImage(sr.dataURL, prev.signImageUrl, prev.signPos, prev.signScale);
          }
          const updated = { ...prev, showroomDataURL: finalShowroom, showroomBaseURL: sr.baseURL, showroomTransform: sr.transform, showroomOffset: nd, showroomZoom: zm, showroomBlend: bl, ...signExtra };
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

  const closeLightbox = () => {
    setLightbox(null);
    setCropMode(false); setCropDrag(null);
    setAdjustMode(false); setAdjustDrag(null);
    setLbZoom(1); applyLbPan({ x: 0, y: 0 }); clearLbPan();
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
      let newPlates = plateList(lightbox);
      if (deg === 0 && lightbox.showroomTransform && croppedBase) {
        const t = lightbox.showroomTransform;
        const cropX = box.x * t.W, cropY = box.y * t.H;
        const newW = Math.round(box.w * t.W), newH = Math.round(box.h * t.H);
        newTransform = { carX: t.carX - cropX, carY: t.carY - cropY, cw: t.cw, ch: t.ch, W: newW, H: newH };
        // Remap corners showroom → espace rogné (tous les caches de la photo)
        const remap = p => ({
          x: Math.max(0, Math.min(1, (p.x * t.W - cropX) / newW)),
          y: Math.max(0, Math.min(1, (p.y * t.H - cropY) / newH)),
        });
        newPlates = newPlates.map(q => {
          const sc = cornersToShowroom(q, t);
          const remappedSC = { tl: remap(sc.tl), tr: remap(sc.tr), br: remap(sc.br), bl: remap(sc.bl) };
          return cornersFromShowroom(remappedSC, newTransform);
        });
      }
      const updated = { ...lightbox, showroomDataURL: croppedShowroom,
        showroomBaseURL: croppedBase, showroomTransform: newTransform,
        ...plateFields(newPlates),
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
    let newPlates = [];
    if (deg === 0) {
      const { x, y, w, h } = box;
      const remap = p => ({
        x: Math.max(0, Math.min(1, (p.x - x) / w)),
        y: Math.max(0, Math.min(1, (p.y - y) / h)),
      });
      newPlates = plateList(lightbox).map(q => ({
        tl: remap(q.tl), tr: remap(q.tr), br: remap(q.br), bl: remap(q.bl),
      }));
    }
    const updated = { ...lightbox, processed: croppedProcessed,
      baseDataURL: croppedBase ?? lightbox.baseDataURL, ...plateFields(newPlates), cropped: true };
    setResults(prev => prev.map(r => r.name === lightbox.name ? updated : r));
    setLightbox(updated);
    resetAdjustPlates(updated);
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
    if (isMobile && corner !== 'center') { setLoupeActive(true); updateLoupe(clientX, clientY, corner); }
  };
  const startAdjustDrag = (e, corner) => {
    e.preventDefault(); e.stopPropagation();
    startAdjustDragAt(e.clientX, e.clientY, corner);
  };

  // L'image de base ne change pas pendant un glissement : on la dessine une
  // seule fois sur le canvas du fond (coûteux car pleine résolution).
  const drawAdjustBase = () => {
    const canvas = adjustCanvasRef.current;
    const baseImg = adjustBaseImgRef.current;
    if (!canvas || !baseImg) return;
    const ctx = canvas.getContext('2d'); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(baseImg, 0, 0);
  };

  // Seuls les caches plaque bougent : on les redessine sur un calque transparent
  // (effacer + tracer les quadrilatères = bien plus léger qu'un redraw complet).
  // `corners` = coins du cache actif ; les autres caches de la photo (2e/3e
  // voiture) sont redessinés à l'identique à chaque frame.
  const renderAdjustOverlay = (corners) => {
    const canvas = adjustOverlayCanvasRef.current;
    const logoImg = adjustLogoImgRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d'); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!logoImg) return;
    const W = canvas.width, H = canvas.height;
    const toPixel = p => ({ x: p.x * W, y: p.y * H });
    const bgColor = adjustLogoBgRef.current || '#ffffff';
    for (const q of currentPlates(corners)) {
      const ptl = toPixel(q.tl), ptr = toPixel(q.tr);
      const pbr = toPixel(q.br), pbl = toPixel(q.bl);
      drawPlateOverlay(ctx, logoImg, ptl, ptr, pbr, pbl, bgColor, 'plate');
    }
  };

  // Rendu complet (fond + cache) — utilisé à l'ouverture du mode Ajuster.
  const renderAdjustPreview = (corners) => {
    drawAdjustBase();
    renderAdjustOverlay(corners);
  };

  // Coalesce les nombreux touchmove en UN seul rendu par frame d'affichage.
  const scheduleAdjustRender = (clientX, clientY) => {
    adjustPendingRef.current = { clientX, clientY };
    if (adjustRafRef.current) return;
    adjustRafRef.current = requestAnimationFrame(() => {
      adjustRafRef.current = 0;
      const corners = adjustCornersRef.current;
      renderAdjustOverlay(corners);     // calque cache plaque (léger)
      setAdjustCorners(corners);        // poignées oranges + contour SVG
      const p = adjustPendingRef.current;
      const drag = adjustDragRef.current;
      if (p && drag && loupeActive && drag.corner !== 'center') updateLoupe(p.clientX, p.clientY, drag.corner);
    });
  };

  // ── Loupe tactile : dessine une bulle zoomée centrée sur le coin glissé ──
  const LOUPE_CSS = 116;
  const updateLoupe = (clientX, clientY, corner) => {
    if (!isMobile) return;
    const src   = adjustCanvasRef.current;
    const loupe = loupeCanvasRef.current;
    const wrap  = loupeWrapRef.current;
    if (!src || !loupe || !wrap) return;
    const pt = (adjustCornersRef.current || {})[corner];
    if (!pt) return;
    const rect = src.getBoundingClientRect();
    const displayScale = rect.width / src.width; // px écran par px natif
    if (!displayScale) return;
    const ZOOM = 2.6;
    const srcSize = LOUPE_CSS / (ZOOM * displayScale); // zone source en px natifs
    const cx = pt.x * src.width;
    const cy = pt.y * src.height;
    const dpr = 2;
    const dim = LOUPE_CSS * dpr;
    if (loupe.width !== dim) { loupe.width = dim; loupe.height = dim; }
    const ctx = loupe.getContext('2d');
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, dim, dim);
    const sx = cx - srcSize / 2, sy = cy - srcSize / 2;
    ctx.drawImage(src, sx, sy, srcSize, srcSize, 0, 0, dim, dim);
    const ov = adjustOverlayCanvasRef.current; // le cache plaque vit sur le calque
    if (ov) ctx.drawImage(ov, sx, sy, srcSize, srcSize, 0, 0, dim, dim);
    // Réticule au centre = position exacte du coin
    const c = dim / 2, arm = 13;
    ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 3.5;
    ctx.beginPath(); ctx.moveTo(c - arm, c); ctx.lineTo(c + arm, c); ctx.moveTo(c, c - arm); ctx.lineTo(c, c + arm); ctx.stroke();
    ctx.strokeStyle = '#e8a020'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(c - arm, c); ctx.lineTo(c + arm, c); ctx.moveTo(c, c - arm); ctx.lineTo(c, c + arm); ctx.stroke();
    ctx.beginPath(); ctx.arc(c, c, 5 * dpr, 0, Math.PI * 2); ctx.lineWidth = 2; ctx.stroke();
    // Position de la bulle : au-dessus du doigt, sinon en dessous, clampée à l'écran
    const M = 10;
    let left = clientX - LOUPE_CSS / 2;
    let top  = clientY - LOUPE_CSS - 30;        // au-dessus du doigt
    if (top < M) top = clientY + 30;            // sinon en dessous
    left = Math.max(M, Math.min(window.innerWidth  - LOUPE_CSS - M, left));
    top  = Math.max(M, Math.min(window.innerHeight - LOUPE_CSS - M, top));
    wrap.style.left = left + 'px';
    wrap.style.top  = top + 'px';
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
    // Calcul immédiat (léger) ; rendu canvas + setState coalescés en 1/frame.
    scheduleAdjustRender(e.clientX, e.clientY);
  };

  const onAdjustTouchMove = (e) => {
    if (!adjustDragRef.current || !adjustCanvasRef.current) return;
    e.preventDefault();
    if (e.touches.length > 0) {
      onAdjustMouseMove({ clientX: e.touches[0].clientX, clientY: e.touches[0].clientY });
    }
  };

  // Sauvegarde le résultat après le relâchement d'un coin (souris OU tactile).
  // Utilise adjustDragRef/adjustCornersRef (refs) pour rester fiable sur mobile,
  // où l'événement souris synthétique d'iOS peut être supprimé par preventDefault.
  const commitAdjust = async () => {
    if (!adjustDragRef.current || !adjustCornersRef.current) return;
    await persistPlates(currentPlates());
  };

  // Aplatit fond + TOUS les caches plaque et enregistre le résultat.
  // `plates` est exprimé dans l'espace du canvas d'ajustement (photo, ou
  // showroom quand le décor est actif) ; la conversion inverse est faite ici.
  const persistPlates = async (plates) => {
    const canvas = adjustCanvasRef.current;
    if (!canvas || !adjustBaseImgRef.current) return;
    const list = (plates || []).filter(Boolean);
    adjustDirtyRef.current = false;
    // Réaligne les refs sur la liste enregistrée (l'index peut sortir du
    // tableau après la suppression d'un cache).
    adjustPlatesRef.current = list;
    if (adjustIndexRef.current >= list.length) adjustIndexRef.current = Math.max(0, list.length - 1);
    const latestCorners = list[adjustIndexRef.current] || null;
    adjustCornersRef.current = latestCorners;
    setAdjustPlates(list); setAdjustIndex(adjustIndexRef.current);
    // Garantit que le calque cache plaque correspond aux derniers coins, puis
    // aplatit fond + caches plaque en une seule image pour l'export.
    renderAdjustOverlay(latestCorners);
    const flat = document.createElement('canvas');
    flat.width = canvas.width; flat.height = canvas.height;
    const fctx = flat.getContext('2d');
    fctx.drawImage(canvas, 0, 0);
    const ov = adjustOverlayCanvasRef.current; if (ov) fctx.drawImage(ov, 0, 0);
    const flatURL = flat.toDataURL('image/jpeg', 0.97);
    freeCanvas(flat);
    const sign = lightbox.signImageUrl || null; // ré-applique l'enseigne si présente
    const sPos = lightbox.signPos, sScale = lightbox.signScale;
    if (adjustIsShowroomRef.current && adjustShowroomTransformRef.current) {
      // Mode showroom : fond+voiture+caches plaque aplatis à qualité native
      const t = adjustShowroomTransformRef.current;
      const photoPlates = list.map(q => cornersFromShowroom(q, t));
      const url = sign ? await overlaySignOnImage(flatURL, sign, sPos, sScale) : flatURL;
      const updated = { ...lightbox, ...plateFields(photoPlates), showroomDataURL: url, ...(sign ? { signBaseUrl: flatURL } : {}) };
      setResults(prev => prev.map(r => r.name === lightbox.name ? updated : r));
      setLightbox(updated);
    } else {
      // Mode normal : sauvegarde la photo avec les caches plaque
      const url = sign ? await overlaySignOnImage(flatURL, sign, sPos, sScale) : flatURL;
      const updated = { ...lightbox, processed: url, ...plateFields(list), ...(sign ? { signBaseUrl: flatURL } : {}), ...(manualPlateMode ? { plateFound: true } : {}) };
      setResults(prev => prev.map(r => r.name === lightbox.name ? updated : r));
      setLightbox(updated);
      // Régénère le showroom avec les nouveaux coins si showroom actif
      if (lightbox.cutoutDataURL && lightbox.showroomBgUrl) {
        const snap = { ...lightbox, ...plateFields(list) };
        const nudge = showroomNudge;
        const zoom  = showroomZoom;
        try {
          const logoImgEl = await loadImg(snap.logoPreview);
          const sr = await compositeCarOnBg(snap.cutoutDataURL, snap.showroomBgUrl, 2400, 1350,
            logoImgEl, snap.corners, snap.bgColor, nudge.x, nudge.y, zoom, true, null, showroomBlend,
            null, snap.extraCorners);
          const finalShowroom = sign ? await overlaySignOnImage(sr.dataURL, sign, sPos, sScale) : sr.dataURL;
          const withSR = { ...updated, showroomDataURL: finalShowroom, showroomBaseURL: sr.baseURL, showroomTransform: sr.transform, showroomOffset: nudge, showroomZoom: zoom, showroomBlend, ...(sign ? { signBaseUrl: sr.dataURL } : {}) };
          setResults(prev => prev.map(r => r.name === snap.name ? withSR : r));
          setLightbox(prev => prev?.name === snap.name ? withSR : prev);
        } catch (e) { console.error('showroom regen (adjust):', e); }
      }
    }
  };

  // ── Gestion des caches plaque multiples (photo à 2 ou 3 voitures) ────────
  // Rend actif le cache `i` de la liste courante.
  const selectPlate = (i) => {
    const list = currentPlates();
    if (i < 0 || i >= list.length) return;
    adjustPlatesRef.current  = list;
    adjustIndexRef.current   = i;
    adjustCornersRef.current = list[i];
    setAdjustPlates(list); setAdjustIndex(i); setAdjustCorners(list[i]);
    renderAdjustOverlay(list[i]);
  };

  // Ouvre le mode Ajuster sur la photo courante. `addNew` pose un cache
  // supplémentaire (2e/3e voiture) au lieu de reprendre un cache existant ;
  // le mode s'ouvre aussi sur un nouveau cache quand la photo n'en a aucun.
  const openAdjust = (r, addNew = false) => {
    const existing = plateList(r);
    const plates = (addNew || existing.length === 0)
      ? [...existing, defaultPlateQuad(existing.length)]
      : existing;
    const index = (addNew || existing.length === 0) ? plates.length - 1 : 0;
    adjustPlatesRef.current  = plates;
    adjustIndexRef.current   = index;
    adjustCornersRef.current = plates[index];
    setAdjustPlates(plates); setAdjustIndex(index); setAdjustCorners(plates[index]);
    setManualPlateMode(addNew || existing.length === 0);
    // Un cache tout juste ajouté n'est pas encore dans l'image : à aplatir à la
    // sortie du mode Ajuster même si l'utilisateur ne le déplace pas.
    adjustDirtyRef.current = plates.length !== existing.length;
    setAdjustMode(true);
    setCropMode(false); setCropDrag(null);
  };

  // Ajoute un cache supplémentaire SANS quitter le mode Ajuster, et
  // l'enregistre aussitôt : validé même si l'utilisateur ne le déplace pas.
  const addPlateInAdjust = async () => {
    const list = currentPlates();
    // Le canvas d'ajustement est en repère showroom quand le décor est actif :
    // on y ramène le quad par défaut, sinon la conversion inverse le rabattrait
    // sur le bord du véhicule détouré.
    const t = adjustShowroomTransformRef.current;
    const q = defaultPlateQuad(list.length);
    list.push(adjustIsShowroomRef.current && t ? cornersToShowroom(q, t) : q);
    adjustPlatesRef.current  = list;
    adjustIndexRef.current   = list.length - 1;
    adjustCornersRef.current = list[list.length - 1];
    setAdjustPlates(list); setAdjustIndex(list.length - 1); setAdjustCorners(list[list.length - 1]);
    setManualPlateMode(true);
    await persistPlates(list);
  };

  // Retire le cache actif (ajouté par erreur, ou voiture finalement hors cadre).
  const deleteActivePlate = async () => {
    const list = currentPlates();
    if (list.length <= 1) return;
    const i = adjustIndexRef.current;
    list.splice(i, 1);
    const next = Math.max(0, Math.min(i, list.length - 1));
    adjustPlatesRef.current  = list;
    adjustIndexRef.current   = next;
    adjustCornersRef.current = list[next];
    setAdjustPlates(list); setAdjustIndex(next); setAdjustCorners(list[next]);
    await persistPlates(list);
  };

  // Sort du mode Ajuster en enregistrant l'état courant (un cache ajouté puis
  // jamais glissé serait sinon perdu).
  const closeAdjust = async () => {
    const list = currentPlates();
    // Aplatir avant le démontage du canvas, et seulement si nécessaire : un
    // simple aller-retour dans le mode Ajuster ne doit pas relancer un rendu.
    if (adjustDirtyRef.current && list.length) await persistPlates(list);
    setAdjustMode(false); setAdjustDrag(null); setManualPlateMode(false);
  };

  // ── Déplacement / redimensionnement de l'enseigne dans la lightbox ────────
  const onSignPointerDown = (e, mode = "move") => {
    if (!lightbox?.signImageUrl) return;
    e.stopPropagation(); e.preventDefault();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) {}
    const pos = lightbox.signPos || { x: 0.5, y: 0.16 };
    const scale = lightbox.signScale ?? 0.64;
    signDragRef.current = { mode, startMx: e.clientX, startMy: e.clientY, startPos: { ...pos }, startScale: scale };
    setSignLive({ pos, scale });
  };
  const onSignPointerMove = (e) => {
    const d = signDragRef.current; if (!d) return;
    e.preventDefault();
    const rect = cropImgRef.current?.getBoundingClientRect(); if (!rect || !rect.width) return;
    if (d.mode === "resize") {
      const dx = (e.clientX - d.startMx) / rect.width;
      const ns = Math.max(0.15, Math.min(1.2, d.startScale + dx * 2));
      setSignLive({ pos: d.startPos, scale: ns });
    } else {
      const dx = (e.clientX - d.startMx) / rect.width;
      const dy = (e.clientY - d.startMy) / rect.height;
      setSignLive({ pos: { x: Math.max(0, Math.min(1, d.startPos.x + dx)), y: Math.max(0, Math.min(1, d.startPos.y + dy)) }, scale: d.startScale });
    }
  };
  const onSignPointerUp = async (e) => {
    const d = signDragRef.current; if (!d) return;
    signDragRef.current = null;
    const live = signLive || { pos: lightbox.signPos, scale: lightbox.signScale };
    setSignLive(null);
    const snap = lightbox;
    const baseClean = snap.signBaseUrl || snap.showroomDataURL || snap.processed;
    const updated = { ...snap, signPos: live.pos, signScale: live.scale };
    try {
      const baked = await overlaySignOnImage(baseClean, snap.signImageUrl, live.pos, live.scale);
      if (snap.showroomDataURL) updated.showroomDataURL = baked; else updated.processed = baked;
    } catch (err) { console.error('sign rebake', err); }
    setLightbox(prev => prev?.name === updated.name ? updated : prev);
    setResults(prev => prev.map(r => r.name === updated.name ? updated : r));
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
      setLbZoom(1); applyLbPan({ x: 0, y: 0 }); return;
    }
    const newX = mx - (mx - lbPan.x) * newZoom / lbZoom;
    const newY = my - (my - lbPan.y) * newZoom / lbZoom;
    setLbZoom(newZoom);
    applyLbPan({
      x: Math.max(rect.width  * (1 - newZoom), Math.min(0, newX)),
      y: Math.max(rect.height * (1 - newZoom), Math.min(0, newY)),
    });
  };

  // Ancre un déplacement à la position courante du doigt/curseur : le pan
  // repartira de là, sans saut, depuis le décalage actuellement appliqué.
  const anchorLbPan = (clientX, clientY) => {
    const drag = { startMx: clientX, startMy: clientY, startPan: { ...lbPanRef.current } };
    lbPanDragRef.current = drag;
    setLbPanDrag(drag);
  };

  const clearLbPan = () => { lbPanDragRef.current = null; setLbPanDrag(null); };

  const onLbPanDown = (e) => {
    // Ne pas démarrer le pan si un drag rognage/ajustement est en cours
    if (lbZoom > 1 && !cropDrag && !adjustDrag) {
      if (e.preventDefault) e.preventDefault();
      anchorLbPan(e.clientX, e.clientY);
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
      clearLbPan(); // le pinch prend la main sur un éventuel pan en cours
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

  // Fin d'un contact. Après un pinch, l'utilisateur relève souvent UN seul
  // doigt et continue à glisser avec l'autre : on ré-ancre alors le pan sur le
  // doigt restant, sinon le glissement suivant serait ignoré (aucun touchstart
  // n'est émis pour un doigt déjà posé).
  const onLbTouchEndEvt = (e) => {
    if (e?.touches?.length === 1 && !cropMode && !adjustMode) {
      pinchRef.current = null;
      if (lbZoom > 1) { anchorLbPan(e.touches[0].clientX, e.touches[0].clientY); return; }
    }
    pinchRef.current = null;
    clearLbPan();
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
      if (newZoom === 1) { applyLbPan({ x: 0, y: 0 }); return; }
      applyLbPan({
        x: Math.max(rect.width  * (1 - newZoom), Math.min(0, newX)),
        y: Math.max(rect.height * (1 - newZoom), Math.min(0, newY)),
      });
    } else if (e.touches.length === 1 && !adjustMode) {
      const t = e.touches[0];
      // Photo zoomée : le doigt la déplace. Si aucun pan n'est armé (doigt
      // resté posé à la fin d'un pinch, ou geste démarré hors de l'image), on
      // l'arme ici plutôt que d'ignorer le glissement.
      if (lbZoom > 1 && !lbPanDragRef.current && !cropDrag && !adjustDrag && !signDragRef.current) {
        anchorLbPan(t.clientX, t.clientY);
        e.preventDefault();
        return;
      }
      if (lbPanDragRef.current) e.preventDefault();
      onLbPanMove({ clientX: t.clientX, clientY: t.clientY });
    }
  };

  const onLbPanMove = (e) => {
    const drag = lbPanDragRef.current || lbPanDrag;
    if (!drag || !lbContainerRef.current) return;
    const rect = lbContainerRef.current.getBoundingClientRect();
    const dx = e.clientX - drag.startMx;
    const dy = e.clientY - drag.startMy;
    applyLbPan({
      x: Math.max(rect.width  * (1 - lbZoom), Math.min(0, drag.startPan.x + dx)),
      y: Math.max(rect.height * (1 - lbZoom), Math.min(0, drag.startPan.y + dy)),
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
    if (isShowroom && (adjustPlatesRef.current || []).length) {
      const sc = adjustPlatesRef.current.map(q => cornersToShowroom(q, lightbox.showroomTransform));
      const i  = Math.max(0, Math.min(adjustIndexRef.current, sc.length - 1));
      adjustPlatesRef.current  = sc;
      adjustIndexRef.current   = i;
      adjustCornersRef.current = sc[i];
      setAdjustPlates(sc); setAdjustIndex(i); setAdjustCorners(sc[i]);
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
      const overlay = adjustOverlayCanvasRef.current;
      if (canvas && !cancelled) {
        const cw = isShowroom ? lightbox.showroomTransform.W : baseImg.naturalWidth;
        const ch = isShowroom ? lightbox.showroomTransform.H : baseImg.naturalHeight;
        canvas.width  = cw; canvas.height = ch;
        if (overlay) { overlay.width = cw; overlay.height = ch; }
        renderAdjustPreview(adjustCornersRef.current);
      }
    })();
    return () => { cancelled = true; };
  }, [adjustMode, lightbox?.baseDataURL, lightbox?.showroomBaseURL]);

  if (authLoading) return (
    <div style={{ minHeight: "100vh", background: "var(--c-1c1c1c)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ color: "#f26522", fontFamily: "var(--font-apple)", fontSize: 12, letterSpacing: 3 }}>CHARGEMENT...</div>
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
      <div style={{ minHeight: "100vh", background: "var(--c-1c1c1c)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--font-apple)" }}>
        <div style={{ width: 380, padding: 40, background: "var(--c-161616)", border: "1px solid var(--c-252525)", borderRadius: 4 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 36 }}>
            <svg width="22" height="22" viewBox="0 0 22 22">
              <polygon points="11,1 21,6 21,16 11,21 1,16 1,6" fill="#f26522" />
              <polygon points="11,5 17,8 17,14 11,17 5,14 5,8" fill="#0f0f0f" />
            </svg>
            <span style={{ fontSize: 20, fontWeight: 700, letterSpacing: 4, textTransform: "uppercase", color: "var(--c-ddd5c8)" }}>AutoCache</span>
            <span style={{ fontSize: 10, color: "#f26522", letterSpacing: 2, fontFamily: "var(--font-apple)" }}>PRO</span>
          </div>
          <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: 2, color: "var(--c-ddd5c8)", textTransform: "uppercase", marginBottom: 24, textAlign: "center" }}>
            Nouveau mot de passe
          </div>
          {[["Nouveau mot de passe", newPassword, setNewPassword], ["Confirmer le mot de passe", newPasswordConfirm, setNewPasswordConfirm]].map(([label, val, set]) => (
            <div key={label} style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 10, letterSpacing: 2, color: "var(--c-ddd)", textTransform: "uppercase", fontFamily: "var(--font-apple)", marginBottom: 6 }}>{label}</div>
              <div style={{ position: "relative" }}>
                <input type={showRecoveryPassword ? "text" : "password"} value={val} onChange={e => set(e.target.value)} onKeyDown={e => e.key === "Enter" && submitNewPassword()}
                  autoComplete="new-password"
                  style={{ width: "100%", background: "var(--c-1a1a1a)", border: "1px solid var(--c-222)", color: "var(--c-ddd5c8)", padding: "10px 44px 10px 12px", borderRadius: 3, fontFamily: "var(--font-apple)", fontSize: 13, outline: "none", boxSizing: "border-box" }} />
                <button
                  type="button"
                  onClick={() => setShowRecoveryPassword(p => !p)}
                  aria-label={showRecoveryPassword ? "Masquer le mot de passe" : "Afficher le mot de passe"}
                  title={showRecoveryPassword ? "Masquer le mot de passe" : "Afficher le mot de passe"}
                  style={{
                    position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)",
                    background: "transparent", border: "none", padding: "6px 8px",
                    cursor: "pointer", color: "var(--c-ddd)",
                    lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center",
                    minHeight: "unset",
                  }}
                >
                  <SettingsIcon name={showRecoveryPassword ? "eye-off" : "eye"} size={17} />
                </button>
              </div>
            </div>
          ))}
          {recoveryErr && <div style={{ fontSize: 11, color: "#e55", marginBottom: 14, fontFamily: "var(--font-apple)" }}>⚠ {recoveryErr}</div>}
          {recoveryMsg && <div style={{ fontSize: 11, color: "#5a5", marginBottom: 14, fontFamily: "var(--font-apple)" }}>✓ {recoveryMsg}</div>}
          <button onClick={submitNewPassword} disabled={recoveryLoading} style={{
            width: "100%", background: "#f26522", color: "#090909", border: "none",
            padding: "13px 24px", cursor: recoveryLoading ? "wait" : "pointer",
            fontFamily: "var(--font-apple)", fontSize: 14, fontWeight: 700,
            letterSpacing: 4, textTransform: "uppercase", borderRadius: 3,
            opacity: recoveryLoading ? 0.7 : 1, marginTop: 4
          }}>
            {recoveryLoading ? "..." : "Mettre à jour"}
          </button>
        </div>
      </div>
    );
  }

  if (!user) return <AuthScreen onAuth={applyUser} exiting={authExit} />;

  return (
    <div>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Rajdhani:wght@500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');
        /* Variables de thème (jour/nuit) définies dans index.html */
        *{box-sizing:border-box;margin:0;padding:0;}
        html,body{overflow-x:hidden;max-width:100%;background:var(--c-1c1c1c);}
        input[type=range]{-webkit-appearance:none;height:2px;background:var(--c-252525);border-radius:1px;outline:none;width:100%;}
        input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:13px;height:13px;border-radius:50%;background:#f26522;cursor:pointer;}
        ::-webkit-scrollbar{width:3px;}::-webkit-scrollbar-thumb{background:#f26522;border-radius:2px;}
        /* Indicateur d'activation de l'abonnement au retour de Stripe */
        @keyframes ac-spin{ to{ transform:rotate(360deg); } }
        @media(max-width:767px){
          input[type=range]{height:4px;}
          input[type=range]::-webkit-slider-thumb{width:20px;height:20px;}
          input[type=range]::-moz-range-thumb{width:20px;height:20px;border-radius:50%;background:#f26522;border:none;}
          button,select{min-height:40px;}
        }
        ${AUTH_MOTION_CSS}
        ${PROCESSING_MOTION_CSS}
      `}</style>
      {/* L'application n'apparaît qu'en fondu à la première connexion : le
          voile de AuthTransition la découvre pendant que le logo se pose. */}
      {entering && <AuthTransition onDone={finishEntering} />}
      <div className={entering ? "ac-app-enter" : undefined}
        style={{ fontFamily: "var(--font-apple)", background: "var(--c-1c1c1c)", minHeight: "100vh", color: "var(--c-e0dbd4)", overflowX: "hidden", maxWidth: "100vw" }}>
        <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: isMobile ? 6 : 12, padding: isMobile ? "0 10px" : "0 28px", height: 56, borderBottom: "1px solid var(--c-1e1e1e)", position: "sticky", top: 0, background: "var(--c-1c1c1c)", zIndex: 10 }}>
          {/* minWidth:0 + ellipsis : le titre se tronque au besoin, le menu à droite reste toujours accessible */}
          <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 7 : 10, minWidth: 0, flexShrink: 1 }}>
            {/* data-ac-logo : cible du vol du logo pendant la transition de connexion */}
            <svg data-ac-logo width="22" height="22" viewBox="0 0 22 22" style={{ flexShrink: 0 }}><polygon points="11,1 21,6 21,16 11,21 1,16 1,6" fill="#f26522" /><polygon points="11,5 17,8 17,14 11,17 5,14 5,8" fill="#090909" /></svg>
            <span style={{ fontSize: isMobile ? 14 : 20, fontWeight: 700, letterSpacing: isMobile ? 1 : 4, textTransform: "uppercase", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>AutoCache</span>
            {!isMobile && <span style={{ fontSize: 10, color: "#f26522", letterSpacing: 2, fontFamily: "var(--font-apple)" }}>PRO</span>}
          </div>
          <nav style={{ display: "flex", alignItems: "center", gap: isMobile ? 3 : 8, flexShrink: 0 }}>
            {[["setup", isMobile ? "Config" : "Configuration"], ["results", `Résultats${results.length ? ` · ${results.length}` : ""}`]].map(([t, label]) => (
              <button key={t} onClick={() => setTab(t)} {...(t === "results" ? { "data-tutorial": "results-tab" } : {})} style={{ background: tab === t ? "#f26522" : "transparent", color: tab === t ? "#090909" : "var(--c-777)", border: "none", padding: isMobile ? "6px 7px" : "7px 18px", cursor: "pointer", fontFamily: "var(--font-apple)", fontSize: isMobile ? 11 : 13, fontWeight: 700, letterSpacing: isMobile ? 1 : 2, textTransform: "uppercase", minHeight: "unset", whiteSpace: "nowrap" }}>{label}</button>
            ))}
            {!isMobile && <div style={{ width: 1, height: 20, background: "var(--c-252525)", margin: "0 4px" }} />}
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
                    style={{ display: "flex", alignItems: "center", gap: 5, padding: isMobile ? "4px 5px" : "4px 10px", borderRadius: 2, border: `1px solid ${isExpired ? "#c0392b" : showCreditPopup ? "#f26522" : "var(--c-2a2a2a)"}`, cursor: "pointer", background: isExpired ? "rgba(192,57,43,0.08)" : showCreditPopup ? "rgba(242,101,34,0.06)" : "transparent", transition: "all 0.15s" }}
                    title="Cliquez pour voir les détails"
                  >
                    <span style={{ fontSize: 10, fontFamily: "var(--font-apple)", color: isExpired ? "#c0392b" : isLow ? "#f26522" : "var(--c-666)", letterSpacing: isMobile ? 0.5 : 1, whiteSpace: "nowrap" }}>
                      {isExpired
                        ? (isMobile ? "ÉPUISÉ" : `${PLAN_LABEL} ÉPUISÉ`)
                        : (isMobile ? `${left}/${PLAN_LIMIT}` : `${PLAN_LABEL} · ${left}/${PLAN_LIMIT}`)}
                    </span>
                  </div>
                  {showCreditPopup && (
                    <div onClick={e => e.stopPropagation()} style={{
                      position: "fixed", top: 56, right: isMobile ? 4 : 60,
                      background: "var(--c-141414)", border: "1px solid var(--c-2a2a2a)", borderRadius: 6,
                      minWidth: 280, maxWidth: "92vw", boxShadow: "0 12px 40px rgba(0,0,0,0.7)", zIndex: 3000,
                      fontFamily: "var(--font-apple)", overflow: "hidden",
                    }}>
                      {/* En-tete plan + credits */}
                      <div style={{ padding: "14px 16px 12px", borderBottom: "1px solid var(--c-1c1c1c)" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                          <div style={{ fontSize: 11, letterSpacing: 2, color: "#f26522", textTransform: "uppercase", fontFamily: "var(--font-apple)" }}>
                            {(() => {
                              if (!isPaid) return "Essai gratuit";
                              const fk = subInfo?.formule ?? user?.user_metadata?.formule;
                              return `Abonnement${fk && FORMULE_LABELS[fk] ? " · " + FORMULE_LABELS[fk] : ""}`;
                            })()}
                          </div>
                          <div onClick={() => setShowCreditPopup(false)} style={{ color: "var(--c-ddd)", cursor: "pointer", fontSize: 15, lineHeight: 1, padding: "2px 4px" }}>✕</div>
                        </div>
                        <div style={{ fontSize: 14, color: "var(--c-ddd)", marginBottom: 8 }}>
                          {left} / {PLAN_LIMIT} photo{PLAN_LIMIT > 1 ? "s" : ""} restante{left > 1 ? "s" : ""}
                        </div>
                        <div style={{ height: 4, background: "var(--c-252525)", borderRadius: 2, overflow: "hidden" }}>
                          <div style={{ height: "100%", width: `${Math.max(2, Math.round((left / PLAN_LIMIT) * 100))}%`, background: isExpired ? "#c0392b" : isLow ? "#f26522" : "#22c55e", borderRadius: 2, transition: "width 0.3s" }} />
                        </div>
                        {isExpired && (
                          <div style={{ marginTop: 10 }}>
                            <button onClick={() => { setShowCreditPopup(false); setShowUpgradeModal(true); }}
                              style={{ width: "100%", background: "#f26522", color: "#090909", border: "none", borderRadius: 4, padding: "8px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "var(--font-apple)", letterSpacing: 1 }}>
                              RECHARGER
                            </button>
                          </div>
                        )}
                      </div>
                      {/* Infos abonnement Stripe (seulement si plan payant) */}
                      {userPlan !== 'trial' && (
                        <div style={{ padding: "12px 16px" }}>
                          {subInfoLoading ? (
                            <div style={{ fontSize: 13, color: "var(--c-ddd)", textAlign: "center", padding: "4px 0" }}>Chargement...</div>
                          ) : subInfo?.periodEnd ? (
                            <div style={{ fontSize: 13, color: "var(--c-ddd)" }}>
                              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                                <span style={{ color: "var(--c-ddd)" }}>Debut du cycle</span>
                                <span style={{ color: "var(--c-ddd)", fontFamily: "var(--font-apple)", fontSize: 12 }}>
                                  {subInfo.periodStart.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" })}
                                </span>
                              </div>
                              {/* Résilié : plus de prélèvement à venir, on annonce
                                  une fin d'accès et non une prochaine échéance. */}
                              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                                <span style={{ color: "var(--c-ddd)" }}>
                                  {subInfo.cancelAtPeriodEnd ? "Fin de l'accès" : "Prochain paiement"}
                                </span>
                                <span style={{ color: "var(--c-ddd)", fontFamily: "var(--font-apple)", fontSize: 12 }}>
                                  {subInfo.periodEnd.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" })}
                                </span>
                              </div>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                <span style={{ color: "var(--c-ddd)" }}>
                                  {subInfo.cancelAtPeriodEnd ? "Temps restant" : "Renouvellement"}
                                </span>
                                <span style={{
                                  color: subInfo.cancelAtPeriodEnd || subInfo.daysLeft <= 3 ? "#f26522" : "#22c55e",
                                  fontFamily: "var(--font-apple)", fontSize: 13, fontWeight: 700,
                                }}>
                                  {subInfo.daysLeft === 0 ? "Aujourd'hui" : `${subInfo.daysLeft} jour${subInfo.daysLeft > 1 ? "s" : ""}`}
                                </span>
                              </div>

                              {subInfo.cancelAtPeriodEnd && (
                                <div style={{ marginTop: 10, padding: "8px 10px", background: "rgba(242,101,34,0.08)", border: "1px solid rgba(242,101,34,0.25)", borderRadius: 3, fontSize: 11, lineHeight: 1.5, color: "var(--c-ddd)", fontFamily: "var(--font-apple)" }}>
                                  Abonnement résilié. Aucun nouveau prélèvement ne sera effectué ; votre accès reste ouvert jusqu'à cette date.
                                </div>
                              )}

                              {(subInfo.status === "past_due" || subInfo.status === "unpaid") && (
                                <div style={{ marginTop: 10, padding: "8px 10px", background: "rgba(192,57,43,0.08)", border: "1px solid rgba(192,57,43,0.25)", borderRadius: 3, fontSize: 11, lineHeight: 1.5, color: "#e07a6a", fontFamily: "var(--font-apple)" }}>
                                  Le dernier prélèvement a échoué. L'abonnement ne sera pas renouvelé et l'accès reste suspendu tant que le paiement n'est pas régularisé — mettez votre carte à jour depuis votre espace de facturation.
                                </div>
                              )}
                            </div>
                          ) : subInfo?.hasSubscription === false ? (
                            <div style={{ fontSize: 13, color: "var(--c-ddd)" }}>Credits via code administrateur.</div>
                          ) : (
                            <div style={{ fontSize: 13, color: "var(--c-ddd)" }}>Informations indisponibles.</div>
                          )}
                        </div>
                      )}
                      {/* Lien abonnement pour les utilisateurs trial */}
                      {userPlan === 'trial' && (
                        <div style={{ padding: "10px 16px", borderTop: "1px solid var(--c-1c1c1c)" }}>
                          <button onClick={() => { setShowCreditPopup(false); setShowPlansModal(true); }}
                            style={{ width: "100%", background: "transparent", color: "#f26522", border: "1px solid #f26522", borderRadius: 4, padding: "7px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "var(--font-apple)", letterSpacing: 1 }}>
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
                style={{ background: settingsOpen ? "var(--c-1e1e1e)" : "transparent", border: `1px solid ${settingsOpen ? "#f26522" : "var(--c-282828)"}`, color: settingsOpen ? "#f26522" : "var(--c-777)", padding: isMobile ? "5px 7px" : "5px 10px", cursor: "pointer", borderRadius: 2, fontFamily: "var(--font-apple)", fontSize: 14, display: "flex", alignItems: "center", gap: 5, minHeight: "unset", flexShrink: 0 }}
                title="Paramètres"
              >
                <span style={{ fontSize: 15 }}>⚙</span>
                {!isMobile && <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", fontFamily: "var(--font-apple)" }}>Menu</span>}
              </button>
              {settingsOpen && (
                <div style={{
                  position: "fixed", top: 56, right: 0,
                  background: "var(--c-141414)", border: "1px solid var(--c-2a2a2a)", borderRadius: 4,
                  minWidth: 220, maxWidth: "92vw", boxShadow: "0 8px 32px rgba(0,0,0,0.6)", zIndex: 2000,
                  overflow: "hidden",
                }}>
                  {/* En-tête utilisateur */}
                  <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--c-222)", background: "var(--c-111)" }}>
                    {user.user_metadata?.full_name && (
                      <div style={{ fontSize: 13, color: "var(--c-ddd5c8)", fontFamily: "var(--font-apple)", fontWeight: 700, letterSpacing: 1, marginBottom: 2 }}>{user.user_metadata.full_name}</div>
                    )}
                    <div style={{ fontSize: 11, color: "var(--c-ddd)", fontFamily: "var(--font-apple)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user.email}</div>
                  </div>
                  {/* Apparence : bascule Jour / Nuit */}
                  <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--c-222)" }}>
                    <div style={{ fontSize: 10, letterSpacing: 2, color: "var(--c-888)", textTransform: "uppercase", fontFamily: "var(--font-apple)", marginBottom: 8 }}>Apparence</div>
                    <div style={{ display: "flex", background: "var(--c-121212)", border: "1px solid var(--c-2a2a2a)", borderRadius: 4, overflow: "hidden" }}>
                      {[["light", "☀", "Jour"], ["dark", "☾", "Nuit"]].map(([mode, icon, label]) => (
                        <button key={mode} onClick={() => setTheme(mode)}
                          style={{
                            flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                            background: theme === mode ? "#f26522" : "transparent",
                            color: theme === mode ? "#090909" : "var(--c-aaa)",
                            border: "none", padding: "7px 0", cursor: "pointer",
                            fontFamily: "var(--font-apple)", fontSize: 12, fontWeight: 700,
                            letterSpacing: 1, textTransform: "uppercase", minHeight: "unset",
                          }}>
                          <span style={{ fontSize: 14, lineHeight: 1 }}>{icon}</span>{label}
                        </button>
                      ))}
                    </div>
                  </div>
                  {/* Menu items */}
                  {[
                    { icon: "profile", label: "Mes informations", action: () => { setSettingsOpen(false); setShowProfileModal(true); } },
                    { icon: "subscription", label: "Abonnement", action: () => { setSettingsOpen(false); setShowPlansModal(true); } },
                    { icon: "promo", label: "Code Administrateur", action: () => { setSettingsOpen(false); setPromoCode(""); setPromoStatus(null); setPromoMsg(""); setShowPromoModal(true); } },
                    { icon: "contact", label: "Nous contacter", action: () => { setSettingsOpen(false); setShowContactModal(true); } },
                    { icon: "tutorial", label: "Revoir le didacticiel", action: () => { setSettingsOpen(false); setShowTutorial(true); } },
                    { icon: "game", label: "Mini-jeu", action: () => { setSettingsOpen(false); setShowMiniGame(true); } },
                    ...(showInstallMenuItem ? [{
                      icon: "install", label: "Installer l'application",
                      action: async () => { setSettingsOpen(false); if (canInstall) { await promptInstall(); } else { setShowInstallHelp(true); } },
                    }] : []),
                  ].map((item, i) => (
                    <button key={i} onClick={item.action}
                      style={{
                        display: "flex", alignItems: "center", gap: 10, width: "100%",
                        padding: "10px 16px", background: "transparent", border: "none",
                        color: "var(--c-ddd)", cursor: "pointer", fontFamily: "var(--font-apple)",
                        fontSize: 13, fontWeight: 600, letterSpacing: 1, textAlign: "left",
                        borderBottom: "1px solid var(--c-1a1a1a)", transition: "background 0.1s",
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = "var(--c-1a1a1a)"}
                      onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                    >
                      <span style={{ width: 20, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--c-9a9a9a)" }}><SettingsIcon name={item.icon} /></span>
                      {item.label}
                    </button>
                  ))}
                  {/* Séparateur + Déconnexion */}
                  <div style={{ height: 1, background: "var(--c-252525)", margin: "2px 0" }} />
                  <button onClick={() => { setSettingsOpen(false); logout(); }}
                    style={{
                      display: "flex", alignItems: "center", gap: 10, width: "100%",
                      padding: "10px 16px", background: "transparent", border: "none",
                      color: "#c0392b", cursor: "pointer", fontFamily: "var(--font-apple)",
                      fontSize: 13, fontWeight: 700, letterSpacing: 1, textAlign: "left",
                      transition: "background 0.1s",
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = "rgba(192,57,43,0.08)"}
                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                  >
                    <span style={{ width: 20, display: "flex", alignItems: "center", justifyContent: "center" }}><SettingsIcon name="logout" /></span>
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
                <div style={{ fontSize: 13, letterSpacing: 3, color: "#f26522", textTransform: "uppercase", marginBottom: 10, fontFamily: "var(--font-apple)" }}>01 — Cache plaque</div>

                {/* ── Onglets Import / Générer ── */}
                <div style={{ display: "flex", marginBottom: 14, background: "var(--c-121212)", border: "1px solid var(--c-252525)", borderRadius: 3, overflow: "hidden" }}>
                  {[["import","Mon logo"],["generate","Générer"]].map(([m, label]) => (
                    <button key={m} onClick={() => {
                      if (m === "import") { setLogo(importedLogo); setLogoOriginal(null); setLogoCropActive(false); }
                      setLogoMode(m);
                    }} style={{ flex: 1, background: logoMode === m ? "#f26522" : "transparent", color: logoMode === m ? "#090909" : "var(--c-555)", border: "none", padding: "8px 0", cursor: "pointer", fontFamily: "var(--font-apple)", fontSize: 12, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase" }}>
                      {label}
                    </button>
                  ))}
                </div>

                {/* ── Mode : importer un fichier ── */}
                {logoMode === "import" && (<>
                  <div style={{ fontSize: 11, color: "var(--c-ddd)", marginBottom: 10, fontFamily: "var(--font-apple)" }}>
                    {logo ? "✓ Logo chargé · cliquer pour changer" : "PNG avec transparence recommandé"}
                  </div>
                  {!logoCropActive && (
                    <div onDragOver={e => { e.preventDefault(); setDragOver("logo"); }} onDragLeave={() => setDragOver(null)}
                      onDrop={e => { e.preventDefault(); setDragOver(null); handleLogoFile(e.dataTransfer.files[0]); }}
                      onClick={() => logoRef.current?.click()}
                      style={{ border: `1px solid ${dragOver === "logo" ? "#f26522" : logo ? "var(--c-2a2a2a)" : "var(--c-222)"}`, borderRadius: 3, padding: 24, cursor: "pointer", minHeight: 130, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--c-161616)" }}>
                      {logo ? (
                        <div style={{ textAlign: "center" }}>
                          <img src={logo.preview} style={{ maxHeight: 80, maxWidth: "100%", objectFit: "contain", borderRadius: logoRadius > 0 ? `${Math.round(logoRadius * 4)}px` : 0 }} />
                          <div style={{ fontSize: 11, color: "#f26522", marginTop: 10 }}>Cliquer pour changer</div>
                        </div>
                      ) : (
                        <div style={{ textAlign: "center", color: "var(--c-ddd)" }}>
                          <div style={{ fontSize: 33, marginBottom: 8 }}>⬡</div>
                          <div style={{ fontSize: 13, color: "var(--c-ddd)" }}>Glisser votre logo ici</div>
                        </div>
                      )}
                    </div>
                  )}
                  {logo && !logo.generated && !logoCropActive && (
                    <div style={{ marginTop: 8, textAlign: "center" }}>
                      <button onClick={() => { setLogoCropActive(true); setLogoCropBox({ x: 0.05, y: 0.05, w: 0.9, h: 0.9 }); }}
                        style={{ background: "var(--c-181818)", color: "#f26522", border: "1px solid var(--c-3a1400)", fontFamily: "var(--font-apple)", fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", borderRadius: 2, padding: "6px 14px", cursor: "pointer" }}>
                        ✂ Recadrer
                      </button>
                    </div>
                  )}
                  {logo && logoCropActive && (
                    <div style={{ background: "var(--c-0a0a0a)", border: "1px solid var(--c-252525)", borderRadius: 3, overflow: "hidden" }}>
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
                          style={{ background: "#2a6b2a", color: "var(--c-ddd5c8)", border: "1px solid #3a8a3a", fontFamily: "var(--font-apple)", fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", borderRadius: 2, padding: "6px 14px", cursor: "pointer" }}>
                          Appliquer
                        </button>
                        <button onClick={() => { setLogoCropActive(false); setLogoCropBox({ x: 0, y: 0, w: 1, h: 1 }); }}
                          style={{ background: "var(--c-181818)", color: "var(--c-ddd)", border: "1px solid var(--c-2a2a2a)", fontFamily: "var(--font-apple)", fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", borderRadius: 2, padding: "6px 14px", cursor: "pointer" }}>
                          Annuler
                        </button>
                      </div>
                    </div>
                  )}
                </>)}

                {/* ── Mode : générer texte + couleur ── */}
                {logoMode === "generate" && (
                  <div style={{ background: "var(--c-161616)", border: "1px solid var(--c-252525)", borderRadius: 3, padding: "16px 14px", display: "flex", flexDirection: "column", gap: 14 }}>

                    {/* Texte */}
                    <div>
                      <div style={{ fontSize: 10, color: "var(--c-ddd)", letterSpacing: 2, fontFamily: "var(--font-apple)", marginBottom: 6, textTransform: "uppercase" }}>Texte du cache plaque</div>
                      <input
                        type="text" value={genText} onChange={e => setGenText(e.target.value)}
                        placeholder="Nom de votre garage"
                        style={{ width: "100%", background: "var(--c-1a1a1a)", border: "1px solid var(--c-2a2a2a)", color: "var(--c-ddd5c8)", padding: "9px 10px", fontFamily: "var(--font-apple)", fontSize: 17, fontWeight: 600, borderRadius: 2, outline: "none" }}
                      />
                    </div>

                    {/* Police */}
                    <div>
                      <div style={{ fontSize: 10, color: "var(--c-ddd)", letterSpacing: 2, fontFamily: "var(--font-apple)", marginBottom: 8, textTransform: "uppercase" }}>Police d'écriture</div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 6 }}>
                        {LOGO_FONTS.map(f => (
                          <div key={f.key} onClick={() => setGenFont(f.key)}
                            style={{ background: genFont === f.key ? "#1a1200" : "var(--c-1a1a1a)", border: `1px solid ${genFont === f.key ? "#f26522" : "var(--c-2a2a2a)"}`, borderRadius: 3, padding: "8px 4px", cursor: "pointer", textAlign: "center", display: "flex", flexDirection: "column", gap: 4, alignItems: "center" }}>
                            <span style={{ fontFamily: f.family, fontWeight: f.weight, fontSize: 16, color: genFont === f.key ? "#f26522" : "var(--c-aaa)", lineHeight: 1 }}>
                              {(genText.trim() || "ABC").toUpperCase().slice(0, 4)}
                            </span>
                            <span style={{ fontSize: 8, color: genFont === f.key ? "#f26522" : "var(--c-444)", fontFamily: "var(--font-apple)", letterSpacing: 1, textTransform: "uppercase" }}>{f.label}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Couleur de fond */}
                    <div>
                      <div style={{ fontSize: 10, color: "var(--c-ddd)", letterSpacing: 2, fontFamily: "var(--font-apple)", marginBottom: 7, textTransform: "uppercase" }}>Couleur de fond</div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                        {["#0d2b6b","#003399","#cc1414","#0d5c1e","var(--c-111)","#6b0d1a","#7c4700","#f26522"].map(col => (
                          <div key={col} onClick={() => setGenBg(col)}
                            style={{ width: 26, height: 26, background: col, borderRadius: 3, cursor: "pointer", border: genBg === col ? "2px solid #f26522" : "2px solid transparent", flexShrink: 0 }} />
                        ))}
                        <input type="color" value={genBg} onChange={e => setGenBg(e.target.value)}
                          title="Couleur personnalisée"
                          style={{ width: 26, height: 26, padding: 0, border: "1px solid var(--c-2a2a2a)", borderRadius: 3, cursor: "pointer", background: "none" }} />
                      </div>
                    </div>

                    {/* Couleur du texte */}
                    <div>
                      <div style={{ fontSize: 10, color: "var(--c-ddd)", letterSpacing: 2, fontFamily: "var(--font-apple)", marginBottom: 7, textTransform: "uppercase" }}>Couleur du texte</div>
                      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        {["#ffffff","#ffcc00","#000000","#ff6600"].map(col => (
                          <div key={col} onClick={() => setGenFg(col)}
                            style={{ width: 26, height: 26, background: col, borderRadius: 3, cursor: "pointer", border: genFg === col ? "2px solid #f26522" : "2px solid var(--c-2a2a2a)", flexShrink: 0 }} />
                        ))}
                        <input type="color" value={genFg} onChange={e => setGenFg(e.target.value)}
                          title="Couleur personnalisée"
                          style={{ width: 26, height: 26, padding: 0, border: "1px solid var(--c-2a2a2a)", borderRadius: 3, cursor: "pointer", background: "none" }} />
                      </div>
                    </div>

                    {/* Liseret (bordure) */}
                    <div>
                      <div style={{ fontSize: 10, color: "var(--c-ddd)", letterSpacing: 2, fontFamily: "var(--font-apple)", marginBottom: 7, textTransform: "uppercase" }}>Liseret (bordure)</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                          {["#ffffff","#000000","#ffcc00","#c0c0c0","#f26522"].map(col => (
                            <div key={col} onClick={() => { setGenBorderColor(col); if (genBorderWidth === 0) setGenBorderWidth(3); }}
                              style={{ width: 22, height: 22, background: col, borderRadius: 3, cursor: "pointer", border: genBorderColor === col && genBorderWidth > 0 ? "2px solid #f26522" : "2px solid var(--c-2a2a2a)", flexShrink: 0 }} />
                          ))}
                          <input type="color" value={genBorderColor} onChange={e => { setGenBorderColor(e.target.value); if (genBorderWidth === 0) setGenBorderWidth(3); }}
                            title="Couleur personnalisée"
                            style={{ width: 22, height: 22, padding: 0, border: "1px solid var(--c-2a2a2a)", borderRadius: 3, cursor: "pointer", background: "none" }} />
                        </div>
                        <input
                          type="range" min="0" max="10" step="1"
                          value={genBorderWidth}
                          onChange={e => setGenBorderWidth(parseInt(e.target.value))}
                          style={{ flex: 1, accentColor: "#f26522", height: 3 }}
                        />
                        <span style={{ fontSize: 11, color: genBorderWidth > 0 ? "#f26522" : "var(--c-444)", fontFamily: "var(--font-apple)", minWidth: 20, textAlign: "right" }}>
                          {genBorderWidth === 0 ? "Off" : genBorderWidth}
                        </span>
                      </div>
                    </div>

                    {/* Trait sous le texte (filet de concession) */}
                    <div>
                      <div style={{ fontSize: 10, color: "var(--c-ddd)", letterSpacing: 2, fontFamily: "var(--font-apple)", marginBottom: 7, textTransform: "uppercase" }}>Trait sous le texte</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div
                          onClick={() => setGenUnderline(genUnderline > 0 ? 0 : 2)}
                          title={genUnderline > 0 ? "Retirer le trait" : "Ajouter un trait discret sous le texte"}
                          style={{ width: 46, height: 26, background: "var(--c-1a1a1a)", border: `1px solid ${genUnderline > 0 ? "#f26522" : "var(--c-2a2a2a)"}`, borderRadius: 3, cursor: "pointer", flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3 }}
                        >
                          <span style={{ fontSize: 9, lineHeight: 1, color: genUnderline > 0 ? "#f26522" : "var(--c-aaa)", fontFamily: "var(--font-apple)", fontWeight: 700 }}>ABC</span>
                          <span style={{ width: 26, height: 2, background: genUnderline > 0 ? "#f26522" : "var(--c-444)" }} />
                        </div>
                        <input
                          type="range" min="0" max="10" step="1"
                          value={genUnderline}
                          onChange={e => setGenUnderline(parseInt(e.target.value))}
                          style={{ flex: 1, accentColor: "#f26522", height: 3 }}
                        />
                        <span style={{ fontSize: 11, color: genUnderline > 0 ? "#f26522" : "var(--c-444)", fontFamily: "var(--font-apple)", minWidth: 20, textAlign: "right" }}>
                          {genUnderline === 0 ? "Off" : genUnderline}
                        </span>
                      </div>
                    </div>

                    {/* Aperçu live */}
                    {logo?.preview && (
                      <div>
                        <div style={{ fontSize: 10, color: "var(--c-ddd)", letterSpacing: 2, fontFamily: "var(--font-apple)", marginBottom: 6, textTransform: "uppercase" }}>Aperçu</div>
                        <img src={logo.preview} style={{ width: "100%", display: "block", border: "1px solid var(--c-2a2a2a)" }} />
                      </div>
                    )}
                  </div>
                )}

                <input ref={logoRef} type="file" accept="image/*" style={{ display: "none" }} onChange={e => handleLogoFile(e.target.files[0])} />

                {/* ── Arrondi des coins (global import + génération) ── */}
                <div style={{ marginTop: 16, background: "var(--c-161616)", border: "1px solid var(--c-252525)", borderRadius: 3, padding: "14px 16px" }}>
                  <Slider label="Arrondi des coins" value={logoRadius} min={0} max={10} step={1} onChange={setLogoRadius} />
                </div>
              </section>

              <section data-tutorial="enhancements">
                {/* ── Cases à cocher : améliorations photo ── */}
                {[
                  {
                    active: autoPlate,
                    toggle: () => setAutoPlate(p => !p),
                    icon: "",
                    label: "Cache plaque automatique",
                    sub: autoPlate ? "Détection et pose automatiques sur chaque photo" : "Désactivé — posez le cache via « + Cache plaque » puis ajustez-le",
                  },
                  {
                    active: enhancePro,
                    toggle: () => setEnhancePro(p => !p),
                    icon: "✨",
                    label: "Amélioration automatique",
                    sub: "Couleurs froides & naturelles",
                  },
                  {
                    active: bodyPolish,
                    toggle: () => { if (!canUseBodyPolish) { setShowPlansModal(true); return; } setBodyPolish(p => !p); },
                    icon: "✦",
                    label: "Lustrage carrosserie",
                    sub: canUseBodyPolish ? "Brillance, saturation & profondeur de couleur" : "Disponible avec l'abonnement",
                    locked: !canUseBodyPolish,
                  },
                ].map(({ active, toggle, icon, label, sub, locked, credit }) => (
                  <Fragment key={label}>
                    <div
                      onClick={toggle}
                      style={{ marginBottom: 8, display: "flex", alignItems: "center", gap: 12, padding: "11px 14px", background: active && !locked ? "rgba(242,101,34,0.08)" : "var(--c-0a0a0a)", border: `1px solid ${active && !locked ? "#f26522" : "var(--c-1c1c1c)"}`, borderRadius: 3, cursor: "pointer", userSelect: "none", opacity: locked ? 0.55 : 1 }}
                    >
                      <div style={{ width: 16, height: 16, borderRadius: 3, border: `2px solid ${locked ? "var(--c-555)" : active ? "#f26522" : "var(--c-444)"}`, background: active && !locked ? "#f26522" : "transparent", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                        {locked ? <span style={{ color: "var(--c-ddd)", fontSize: 11 }}>🔒</span> : active && <span style={{ color: "#090909", fontSize: 12, fontWeight: 900, lineHeight: 1 }}>✓</span>}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", color: locked ? "var(--c-888)" : active ? "#f26522" : "var(--c-aaa)", fontFamily: "var(--font-apple)" }}>
                          {icon} {label}{locked && <span style={{ fontSize: 9, color: "#f26522", fontFamily: "var(--font-apple)", letterSpacing: 1, marginLeft: 6 }}>PRO</span>}
                        </div>
                        <div style={{ fontSize: 10, color: "var(--c-ddd)", fontFamily: "var(--font-apple)", marginTop: 2 }}>{sub}</div>
                      </div>
                      {credit && <div style={{ fontSize: 11, color: "#f26522", fontFamily: "var(--font-apple)", letterSpacing: 1, fontWeight: 700, flexShrink: 0 }}>{credit}</div>}
                    </div>
                    {label === "Amélioration automatique" && enhancePro && (
                      <div style={{ marginBottom: 8, background: "var(--c-161616)", border: "1px solid var(--c-252525)", borderRadius: 3, padding: "12px 14px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                          <span style={{ fontSize: 11, letterSpacing: 2, textTransform: "uppercase", color: "var(--c-ddd)", fontFamily: "var(--font-apple)" }}>
                            Régler l'intensité
                          </span>
                          <span style={{ fontSize: 12, color: enhanceProIntensity > 0 ? "#f26522" : "var(--c-444)", fontFamily: "var(--font-apple)", minWidth: 20, textAlign: "right" }}>
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

                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 22, marginBottom: 14 }}>
                  <div style={{ fontSize: 13, letterSpacing: 3, color: adjEnabled ? "#f26522" : "var(--c-444)", textTransform: "uppercase", fontFamily: "var(--font-apple)" }}>03 — Ajustements photo</div>
                  <button onClick={() => setAdjEnabled(p => !p)} style={{ background: adjEnabled ? "#f26522" : "var(--c-1a1a1a)", border: `1px solid ${adjEnabled ? "#f26522" : "var(--c-2a2a2a)"}`, color: adjEnabled ? "#090909" : "var(--c-444)", padding: "4px 13px", cursor: "pointer", fontFamily: "var(--font-apple)", fontSize: 10, letterSpacing: 2, textTransform: "uppercase", borderRadius: 2 }}>
                    {adjEnabled ? "ON" : "OFF"}
                  </button>
                </div>
                <div style={{ background: "var(--c-161616)", border: "1px solid var(--c-252525)", borderRadius: 3, padding: "20px 18px", opacity: adjEnabled ? 1 : 0.35, pointerEvents: adjEnabled ? "auto" : "none" }}>
                  <Slider label="Luminosité" value={adj.brightness} min={0.7} max={1.5} step={0.01} onChange={v => setAdj(p => ({...p, brightness: v}))} />
                  <Slider label="Contraste" value={adj.contrast} min={0.7} max={1.6} step={0.01} onChange={v => setAdj(p => ({...p, contrast: v}))} />
                  <Slider label="Saturation" value={adj.saturation} min={0.5} max={2.0} step={0.01} onChange={v => setAdj(p => ({...p, saturation: v}))} />
                </div>
              </section>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
              <section data-tutorial="photos">
                <div style={{ fontSize: 13, letterSpacing: 3, color: "#f26522", textTransform: "uppercase", marginBottom: 12, fontFamily: "var(--font-apple)" }}>02 — Photos de véhicules</div>
                <div onDragOver={e => { e.preventDefault(); setDragOver("photos"); }} onDragLeave={() => setDragOver(null)}
                  onDrop={e => { e.preventDefault(); setDragOver(null); handlePhotoFiles(e.dataTransfer.files); }}
                  onClick={() => photosRef.current?.click()}
                  style={{ border: `1px dashed ${dragOver === "photos" ? "#f26522" : "var(--c-222)"}`, borderRadius: 3, padding: "22px 16px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--c-161616)", marginBottom: 12 }}>
                  <div style={{ textAlign: "center", color: "var(--c-ddd)" }}>
                    <div style={{ fontSize: 31, marginBottom: 8 }}>◈</div>
                    <div style={{ fontSize: 13, color: "var(--c-ddd)" }}>{isMobile ? "Appuyer pour sélectionner" : "Glisser les photos ici"}</div>
                    <div style={{ fontSize: 11, marginTop: 3, color: "var(--c-aaa)" }}>JPG, PNG — plusieurs fichiers acceptés</div>
                  </div>
                </div>
                <input ref={photosRef} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={e => handlePhotoFiles(e.target.files)} />

                {/* ── Showroom interactif (accès code administrateur) ── */}
                {canUseShowroomInteractif && (
                  <div style={{ marginBottom: 12 }}>
                    <button onClick={() => {
                        if (photos.length && !window.confirm(`Le tour 360° remplacera les ${photos.length} photo${photos.length > 1 ? "s" : ""} déjà sélectionnée${photos.length > 1 ? "s" : ""}. Continuer ?`)) return;
                        setShowCapture360(true);
                      }}
                      style={{ width: "100%", background: "transparent", border: "1px solid #f26522", color: "#f26522", padding: "11px 0", cursor: "pointer", fontFamily: "var(--font-apple)", fontSize: 12, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", borderRadius: 3 }}>
                      ⟳ Showroom interactif — scanner le véhicule
                    </button>
                    <div style={{ fontSize: 10, color: "var(--c-aaa)", marginTop: 5, textAlign: "center", fontFamily: "var(--font-apple)" }}>
                      Scan guidé en 36 zones (tour + hauteurs) · traité comme des photos normales · tour 360° à l’arrivée
                    </div>
                  </div>
                )}

                {photos.length > 0 && (
                  <>
                    <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(4, 1fr)" : "repeat(5, 1fr)", gap: 5, maxHeight: 210, overflowY: "auto", marginBottom: 10 }}>
                      {photos.map(p => (
                        <div key={p.id} style={{ position: "relative" }}>
                          <img src={p.preview} style={{ width: "100%", aspectRatio: "4/3", objectFit: "cover", borderRadius: 2, border: "1px solid var(--c-252525)", display: "block" }} />
                          <button onClick={e => { e.stopPropagation(); setPhotos(prev => prev.filter(x => x.id !== p.id)); }}
                            style={{ position: "absolute", top: 2, right: 2, width: 15, height: 15, borderRadius: "50%", background: "#f26522", border: "none", color: "#090909", fontSize: 10, cursor: "pointer", fontWeight: 700 }}>×</button>
                        </div>
                      ))}
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: 11, color: "var(--c-ddd)", fontFamily: "var(--font-apple)" }}>{photos.length} photo{photos.length > 1 ? "s" : ""}</span>
                      <button onClick={() => { setPhotos([]); setSpin360Mode(false); }} style={{ background: "transparent", border: "1px solid var(--c-1e1e1e)", color: "var(--c-ddd)", padding: "3px 10px", cursor: "pointer", fontFamily: "var(--font-apple)", fontSize: 11, letterSpacing: 1, textTransform: "uppercase", borderRadius: 2 }}>Tout effacer</button>
                    </div>
                  </>
                )}
              </section>

              {/* ── 03 — Enseigne murale ── */}
              <section>
                <div style={{ fontSize: 13, letterSpacing: 3, color: "#f26522", textTransform: "uppercase", marginBottom: 12, fontFamily: "var(--font-apple)" }}>03 — Enseigne murale</div>
                <div onClick={() => setSignEnabled(v => !v)}
                  style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 14px", background: signEnabled ? "rgba(242,101,34,0.08)" : "var(--c-0a0a0a)", border: `1px solid ${signEnabled ? "#f26522" : "var(--c-1c1c1c)"}`, borderRadius: signEnabled ? "3px 3px 0 0" : 3, cursor: "pointer", userSelect: "none" }}>
                  <div style={{ width: 16, height: 16, borderRadius: 3, border: `2px solid ${signEnabled ? "#f26522" : "#444"}`, background: signEnabled ? "#f26522" : "transparent", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {signEnabled && <span style={{ color: "#090909", fontSize: 12, fontWeight: 900, lineHeight: 1 }}>✓</span>}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", color: signEnabled ? "#f26522" : "var(--c-aaa)", fontFamily: "var(--font-apple)" }}>Ajouter une enseigne</div>
                    <div style={{ fontSize: 10, color: "var(--c-aaa)", fontFamily: "var(--font-apple)", marginTop: 2 }}>Enseigne + sous-titre · avec ou sans showroom</div>
                  </div>
                </div>
                {signEnabled && (() => {
                  const sf = WALL_FONTS.find(x => x.key === signFont) ?? WALL_FONTS[0];
                  const hasContent = signTitle.trim() || signSubtitle.trim();
                  return (
                  <div style={{ border: "1px solid #f26522", borderTop: "none", borderRadius: "0 0 3px 3px", padding: 14, background: "var(--c-0a0a0a)" }}>
                    {/* Enseigne */}
                    <div style={{ fontSize: 9, letterSpacing: 1, color: "var(--c-ddd)", fontFamily: "var(--font-apple)", marginBottom: 6 }}>ENSEIGNE</div>
                    <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
                      <input type="text" value={signTitle} onChange={e => setSignTitle(e.target.value)} placeholder="Ex : nom de l'enseigne"
                        style={{ flex: 1, minWidth: 0, boxSizing: "border-box", padding: "8px 10px", background: "var(--c-161616)", border: "1px solid var(--c-2a2a2a)", borderRadius: 3, color: "var(--c-ddd5c8)", fontFamily: "var(--font-apple)", fontSize: 14 }} />
                      <input type="color" value={signTitleColor} onChange={e => setSignTitleColor(e.target.value)}
                        style={{ width: 34, height: 34, border: "1px solid var(--c-2a2a2a)", borderRadius: 3, background: "transparent", cursor: "pointer", flexShrink: 0 }} />
                    </div>
                    {/* Sous-titre */}
                    <div style={{ fontSize: 9, letterSpacing: 1, color: "var(--c-ddd)", fontFamily: "var(--font-apple)", marginBottom: 6 }}>SOUS-TITRE</div>
                    <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
                      <input type="text" value={signSubtitle} onChange={e => setSignSubtitle(e.target.value)} placeholder="Ex : votre slogan, numéro de téléphone…"
                        style={{ flex: 1, minWidth: 0, boxSizing: "border-box", padding: "8px 10px", background: "var(--c-161616)", border: "1px solid var(--c-2a2a2a)", borderRadius: 3, color: "var(--c-ddd5c8)", fontFamily: "var(--font-apple)", fontSize: 14 }} />
                      <input type="color" value={signSubtitleColor} onChange={e => setSignSubtitleColor(e.target.value)}
                        style={{ width: 34, height: 34, border: "1px solid var(--c-2a2a2a)", borderRadius: 3, background: "transparent", cursor: "pointer", flexShrink: 0 }} />
                    </div>
                    {/* Police */}
                    <div style={{ fontSize: 9, letterSpacing: 1, color: "var(--c-ddd)", fontFamily: "var(--font-apple)", marginBottom: 6 }}>POLICE</div>
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 14 }}>
                      {WALL_FONTS.map(f => (
                        <button key={f.key} onClick={() => setSignFont(f.key)}
                          style={{ padding: "4px 8px", fontSize: 11, cursor: "pointer", borderRadius: 2, fontFamily: f.family, fontWeight: f.weight, background: signFont === f.key ? "#f26522" : "var(--c-161616)", color: signFont === f.key ? "#090909" : "#999", border: `1px solid ${signFont === f.key ? "#f26522" : "var(--c-2a2a2a)"}` }}>{f.label}</button>
                      ))}
                    </div>
                    {/* Aperçu */}
                    {hasContent && (
                      <div style={{ background: "var(--c-111)", border: "1px solid var(--c-222)", borderRadius: 3, padding: 14, marginBottom: 14, textAlign: "center" }}>
                        {signTitle.trim() && <span style={{ fontFamily: sf.family, fontWeight: sf.weight, fontSize: 22, color: signTitleColor, letterSpacing: 1 }}>{signTitle}</span>}
                        {signSubtitle.trim() && <div style={{ fontFamily: sf.family, fontWeight: sf.weight, fontSize: 12, color: signSubtitleColor, marginTop: 5 }}>{signSubtitle}</div>}
                      </div>
                    )}
                    {/* Portée */}
                    <div style={{ fontSize: 9, letterSpacing: 1, color: "var(--c-ddd)", fontFamily: "var(--font-apple)", marginBottom: 6 }}>APPLIQUER À</div>
                    <div style={{ display: "flex", gap: 6, marginBottom: signScope === "selected" ? 10 : 0 }}>
                      {[["all", "Toutes les photos"], ["selected", "Photos sélectionnées"]].map(([k, label]) => (
                        <button key={k} onClick={() => setSignScope(k)}
                          style={{ flex: 1, padding: "7px 0", fontSize: 10, fontFamily: "var(--font-apple)", letterSpacing: 1, textTransform: "uppercase", cursor: "pointer", borderRadius: 2, background: signScope === k ? "#f26522" : "var(--c-161616)", color: signScope === k ? "#090909" : "var(--c-777)", border: `1px solid ${signScope === k ? "#f26522" : "var(--c-2a2a2a)"}` }}>{label}</button>
                      ))}
                    </div>
                    {signScope === "selected" && (
                      photos.length === 0
                        ? <div style={{ fontSize: 10, color: "var(--c-aaa)", fontFamily: "var(--font-apple)" }}>Importez des photos pour les sélectionner.</div>
                        : <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(60px, 1fr))", gap: 6 }}>
                            {photos.map(p => {
                              const sel = signSelectedIds.has(p.id);
                              return (
                                <div key={p.id} onClick={() => setSignSelectedIds(prev => { const n = new Set(prev); n.has(p.id) ? n.delete(p.id) : n.add(p.id); return n; })}
                                  style={{ position: "relative", paddingTop: "70%", borderRadius: 3, overflow: "hidden", cursor: "pointer", border: `2px solid ${sel ? "#f26522" : "transparent"}` }}>
                                  <img src={p.preview} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", opacity: sel ? 1 : 0.45 }} />
                                  {sel && <div style={{ position: "absolute", top: 3, right: 3, width: 16, height: 16, borderRadius: "50%", background: "#f26522", color: "#090909", fontSize: 11, fontWeight: 900, display: "flex", alignItems: "center", justifyContent: "center" }}>✓</div>}
                                </div>
                              );
                            })}
                          </div>
                    )}
                  </div>
                  );
                })()}
              </section>

              {/* ── 04 — Showroom Virtuel ── */}
              <section data-tutorial="showroom">
                <div style={{ fontSize: 13, letterSpacing: 3, color: "#f26522", textTransform: "uppercase", marginBottom: 12, fontFamily: "var(--font-apple)" }}>04 — Showroom Virtuel</div>
                <div onClick={() => { if (SHOWROOM_COMING_SOON) return; if (!canUseShowroom) { setShowUpgradeProModal(true); return; } const next = !showroomEnabled; setShowroomEnabled(next); }}
                  style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 14px", background: showroomActive ? "rgba(242,101,34,0.08)" : "var(--c-0a0a0a)", border: `1px solid ${showroomActive ? "#f26522" : "var(--c-1c1c1c)"}`, borderRadius: showroomActive ? "3px 3px 0 0" : 3, cursor: SHOWROOM_COMING_SOON ? "not-allowed" : "pointer", userSelect: "none", opacity: canUseShowroom ? 1 : 0.5 }}>
                  <div style={{ width: 16, height: 16, borderRadius: 3, border: `2px solid ${showroomActive ? "#f26522" : "var(--c-444)"}`, background: showroomActive ? "#f26522" : "transparent", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {canUseShowroom ? (showroomEnabled && <span style={{ color: "#090909", fontSize: 12, fontWeight: 900, lineHeight: 1 }}>✓</span>) : <span style={{ color: "var(--c-ddd)", fontSize: 11 }}>{SHOWROOM_COMING_SOON ? "⏳" : "🔒"}</span>}
                  </div>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", color: showroomActive ? "#f26522" : "var(--c-aaa)", fontFamily: "var(--font-apple)" }}>
                      ⬡ Showroom Virtuel {!canUseShowroom && <span style={{ fontSize: 9, color: "#f26522", fontFamily: "var(--font-apple)", letterSpacing: 1, marginLeft: 6 }}>{SHOWROOM_COMING_SOON ? "PROCHAINEMENT DISPONIBLE" : "ABONNEMENT PRO"}</span>}
                    </div>
                    <div style={{ fontSize: 10, color: "var(--c-ddd)", fontFamily: "var(--font-apple)", marginTop: 2 }}>
                      {SHOWROOM_COMING_SOON
                        ? "Fonctionnalité en cours de développement — bientôt disponible."
                        : canUseShowroom ? "Détourage IA · Fond de showroom · Inclus au traitement" : "Disponible avec l'abonnement Pro — cliquez pour en savoir plus"}
                    </div>
                  </div>
                </div>
                {showroomActive && (
                  <div style={{ padding: "12px 14px", background: "var(--c-121212)", border: "1px solid #f26522", borderTop: "none", borderRadius: "0 0 3px 3px" }}>
                    <div style={{ display: "flex", gap: 10, alignItems: "flex-start", background: "rgba(242,101,34,0.06)", border: "1px solid rgba(242,101,34,0.2)", borderRadius: 3, padding: "9px 11px", marginBottom: 14 }}>
                      <span style={{ color: "#f26522", fontSize: 14, flexShrink: 0, lineHeight: 1.4 }}>⚠</span>
                      <div style={{ fontSize: 10, color: "var(--c-ddd)", fontFamily: "var(--font-apple)", lineHeight: 1.7, margin: 0 }}>
                        <p style={{ margin: "0 0 6px" }}>Pour un détourage optimal :</p>
                        <ul style={{ margin: 0, paddingLeft: 15 }}>
                          <li style={{ marginBottom: 5 }}>Le véhicule est <span style={{ color: "var(--c-ddd5c8)" }}>seul dans le cadre</span>. La présence d'autres véhicules à proximité peut perturber l'analyse de l'IA et affecter la qualité du détourage.</li>
                          <li>De préférence devant un <span style={{ color: "var(--c-ddd5c8)" }}>mur neutre de couleur différente</span> de celle du véhicule.</li>
                        </ul>
                      </div>
                    </div>
                    <div style={{ fontSize: 10, letterSpacing: 2, color: "var(--c-ddd)", textTransform: "uppercase", fontFamily: "var(--font-apple)", marginBottom: 10 }}>Fond de scène</div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "stretch" }}>
                      {[0, 1, 2, 3].map(idx => {
                        const isActive = showroomSetupBg === idx;
                        return (
                          <div key={idx} onClick={e => { e.stopPropagation(); setShowroomSetupBg(idx); }}
                            style={{ cursor: "pointer", border: `2px solid ${isActive ? "#f26522" : "var(--c-2a2a2a)"}`, borderRadius: 3, overflow: "hidden", width: 70, flexShrink: 0, transition: "border-color 0.12s" }}>
                            <img src={SHOWROOM_THUMBS[idx]} style={{ display: "block", width: "100%", height: 39, objectFit: "cover" }} />
                            <div style={{ background: isActive ? "#f26522" : "var(--c-1a1a1a)", color: isActive ? "#090909" : "var(--c-555)", fontSize: 8, fontFamily: "var(--font-apple)", letterSpacing: 1, textAlign: "center", padding: "2px 0", textTransform: "uppercase" }}>
                              {SHOWROOM_LABELS[idx]}
                            </div>
                          </div>
                        );
                      })}
                      <div onClick={e => { e.stopPropagation(); showroomSetupUploadRef.current?.click(); }}
                        style={{ cursor: "pointer", border: `2px solid ${showroomSetupBg === 'custom' ? "#f26522" : "var(--c-2a2a2a)"}`, borderRadius: 3, overflow: "hidden", width: 70, flexShrink: 0, display: "flex", flexDirection: "column", background: "var(--c-1e1e1e)", transition: "border-color 0.12s" }}>
                        {showroomSetupCustomBg
                          ? <img src={showroomSetupCustomBg} style={{ display: "block", width: "100%", height: 39, objectFit: "cover" }} />
                          : <div style={{ height: 39, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 21, color: "var(--c-ddd)" }}>+</div>
                        }
                        <div style={{ background: showroomSetupBg === 'custom' ? "#f26522" : "var(--c-1a1a1a)", color: showroomSetupBg === 'custom' ? "#090909" : "var(--c-555)", fontSize: 8, fontFamily: "var(--font-apple)", letterSpacing: 1, textAlign: "center", padding: "2px 0", textTransform: "uppercase" }}>Custom</div>
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

                  </div>
                )}
              </section>

              <section data-tutorial="process">
                <button onClick={start} disabled={!canStart} style={{ width: "100%", background: canStart ? "#f26522" : "var(--c-1a1a1a)", color: canStart ? "#090909" : "var(--c-444)", border: "none", padding: "15px 24px", cursor: canStart ? "pointer" : "not-allowed", fontFamily: "var(--font-apple)", fontSize: 16, fontWeight: 700, letterSpacing: 4, textTransform: "uppercase", borderRadius: 3 }}>
                  {processing ? `Traitement... ${progress.n} / ${progress.total}` : `Lancer — ${photos.length} photo${photos.length > 1 ? "s" : ""}${showroomActive ? " + Showroom" : ""}`}
                </button>
                {processing && (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ height: 2, background: "var(--c-1e1e1e)", borderRadius: 1, overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${pct}%`, background: "#f26522", transition: "width 0.4s ease" }} />
                    </div>
                    <div style={{ marginTop: 5, fontSize: 10, color: "var(--c-ddd)", fontFamily: "var(--font-apple)", textAlign: "right" }}>{pct}%</div>
                  </div>
                )}
                {!logo && <div style={{ marginTop: 10, fontSize: 11, color: "var(--c-ddd)", fontFamily: "var(--font-apple)" }}>⚠ Chargez votre logo pour continuer</div>}
              </section>
            </div>
          </div>
        )}

        {tab === "results" && (
          <div style={{ maxWidth: 1200, margin: "0 auto", padding: isMobile ? "16px 12px" : "32px 28px" }}>
            {results.length === 0 ? (
              <div style={{ textAlign: "center", padding: "80px 0", color: "var(--c-ddd)" }}>
                <div style={{ fontSize: 49, marginBottom: 16 }}>◈</div>
                <div style={{ fontSize: 15, letterSpacing: 2, textTransform: "uppercase" }}>Aucun résultat</div>
              </div>
            ) : (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
                  <div>
                    <div style={{ fontSize: 13, letterSpacing: 3, color: "#f26522", textTransform: "uppercase", fontFamily: "var(--font-apple)" }}>{results.length} photo{results.length > 1 ? "s" : ""} traitée{results.length > 1 ? "s" : ""}</div>
                    <div style={{ marginTop: 4, fontSize: 11, color: "var(--c-ddd)", fontFamily: "var(--font-apple)" }}>
                      {results.filter(r => r.plateFound).length} détectée{results.filter(r => r.plateFound).length > 1 ? "s" : ""} · {results.filter(r => !r.plateFound).length} non détectée{results.filter(r => !r.plateFound).length > 1 ? "s" : ""}
                    </div>
                  </div>
                  {!processing && (
                    <div style={{ display: "flex", gap: 8 }}>
                      {spin360Mode && isSpinUsable(results.length) && (
                        <button onClick={() => setShowSpinViewer(true)}
                          title="Prévisualiser le tour 360° du véhicule"
                          style={{ background: "transparent", color: "#f26522", border: "1px solid #f26522", padding: "9px 16px", cursor: "pointer", fontFamily: "var(--font-apple)", fontSize: 12, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", borderRadius: 3 }}>
                          ⟳ Tour 360°
                        </button>
                      )}
                      {results.length > 0 && (
                        <button onClick={openEmailModal}
                          title="Envoyer toutes les photos traitées par email"
                          style={{ background: "transparent", color: "var(--c-ddd)", border: "1px solid var(--c-2a2a2a)", padding: "9px 16px", cursor: "pointer", fontFamily: "var(--font-apple)", fontSize: 12, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", borderRadius: 3 }}>
                          ✉ Envoyer par mail
                        </button>
                      )}
                      <button onClick={downloadAll} style={{ background: "#f26522", color: "#090909", border: "none", padding: "9px 22px", cursor: "pointer", fontFamily: "var(--font-apple)", fontSize: 13, fontWeight: 700, letterSpacing: 3, textTransform: "uppercase", borderRadius: 3 }}>
                        Tout télécharger ({results.length})
                      </button>
                    </div>
                  )}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(${isMobile ? 150 : 260}px, 1fr))`, gap: isMobile ? 10 : 14 }}>
                  {results.map((r, i) => (
                    <div key={i} style={{ background: "var(--c-161616)", border: "1px solid var(--c-252525)", borderRadius: 3, overflow: "hidden" }}>
                      <div style={{ position: "relative", cursor: "zoom-in" }} onClick={() => openLightbox(r)} title="Cliquer pour agrandir">
                        <img src={r.showroomDataURL || r.processed} style={{ width: "100%", aspectRatio: "4 / 3", objectFit: "contain", background: "var(--c-1e1e1e)", display: "block" }} />
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
                          <span style={{ background: r.plateFound ? "rgba(22,163,74,0.9)" : r.autoPlateOff ? "rgba(80,80,80,0.9)" : "rgba(220,38,38,0.9)", color: "#fff", fontSize: 9, padding: "3px 7px", borderRadius: 2, fontFamily: "var(--font-apple)" }}>
                            {r.plateFound
                              ? (plateList(r).length > 1 ? `✓ ${plateList(r).length} PLAQUES CACHÉES` : "✓ PLAQUE CACHÉE")
                              : r.autoPlateOff ? "⊕ CACHE MANUEL" : "⚠ NON DÉTECTÉE"}
                          </span>
                          {r.cropped && (
                            <span style={{ background: "rgba(242,101,34,0.85)", color: "#fff", fontSize: 9, padding: "3px 7px", borderRadius: 2, fontFamily: "var(--font-apple)" }}>✂ ROGNÉ</span>
                          )}
                        </div>
                        <div style={{ position: "absolute", bottom: 8, right: 8, background: "rgba(0,0,0,0.6)", borderRadius: 2, padding: "3px 7px", fontSize: 10, color: "var(--c-ddd)", fontFamily: "var(--font-apple)" }}>🔍 Agrandir</div>
                      </div>
                      <div style={{ padding: "9px 11px", display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid var(--c-161616)", gap: 6 }}>
                        <div style={{ fontSize: 11, color: "var(--c-ddd)", fontFamily: "var(--font-apple)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>{r.name}</div>
                        {/* Ajoute un cache plaque — aussi quand un cache est
                            déjà posé : photo à 2 ou 3 voitures. */}
                        <button
                          onClick={e => {
                            e.stopPropagation();
                            openLightbox(r);
                            openAdjust(r, true);
                          }}
                          title={r.plateFound ? "Ajouter un cache sur une autre voiture" : "Poser le cache plaque à la main"}
                          style={{ background: r.plateFound ? "transparent" : "#f26522", border: r.plateFound ? "1px solid var(--c-3a1400)" : "none", color: r.plateFound ? "#f26522" : "#090909", padding: "4px 9px", cursor: "pointer", fontFamily: "var(--font-apple)", fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", borderRadius: 2, whiteSpace: "nowrap", flexShrink: 0 }}
                        >+ Cache{r.plateFound ? "" : " plaque"}</button>
                        <button onClick={() => downloadOne(r)} style={{ background: "transparent", border: "1px solid var(--c-2a2a2a)", color: "#f26522", padding: "4px 11px", cursor: "pointer", fontFamily: "var(--font-apple)", fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", borderRadius: 2, flexShrink: 0 }}>DL</button>
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
          onTouchEnd={e => {
            if (adjustRafRef.current) { cancelAnimationFrame(adjustRafRef.current); adjustRafRef.current = 0; }
            // Sauvegarde le coin relâché (équivalent tactile de onMouseUp)
            commitAdjust();
            adjustDragRef.current = null; setAdjustDrag(null);
            setLoupeActive(false);
            setCropDrag(null);
            // Pinch → pan : ré-ancre le déplacement sur le doigt encore posé
            onLbTouchEndEvt(e);
          }}
          onMouseUp={() => {
            if (adjustRafRef.current) { cancelAnimationFrame(adjustRafRef.current); adjustRafRef.current = 0; }
            setCropDrag(null);
            // Auto-sauvegarde dès qu'un coin est relâché
            commitAdjust();
            adjustDragRef.current = null;
            setAdjustDrag(null);
            clearLbPan();
          }}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.93)", zIndex: 1000, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: isMobile ? 8 : 16, userSelect: "none", WebkitUserSelect: "none", WebkitTouchCallout: "none", WebkitTapHighlightColor: "transparent" }}
        >
          {/* ── Bouton fermer fixe (mobile) — toujours accessible même si zoomé ── */}
          {isMobile && (
            <button
              onClick={e => { e.stopPropagation(); closeLightbox(); }}
              style={{ position: "fixed", top: 10, right: 10, zIndex: 1010, width: 36, height: 36, borderRadius: "50%", background: "rgba(20,20,20,0.92)", border: "1px solid #3a3a3a", color: "var(--c-ddd)", fontSize: 19, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1 }}
            >✕</button>
          )}
          {/* ── Bouton Terminé fixe en bas (mobile + adjust mode) ── */}
          {isMobile && adjustMode && (
            <button
              onClick={e => { e.stopPropagation(); closeAdjust(); }}
              style={{ position: "fixed", bottom: 18, left: "50%", transform: "translateX(-50%)", zIndex: 1010, height: 44, paddingInline: 28, borderRadius: 22, background: "#e8a020", border: "none", color: "#090909", fontSize: 15, fontWeight: 700, fontFamily: "var(--font-apple)", letterSpacing: 1, textTransform: "uppercase", cursor: "pointer", boxShadow: "0 4px 16px rgba(0,0,0,0.7)" }}
            >✓ Terminé</button>
          )}
          {/* ── Loupe tactile : bulle zoomée sur le coin glissé (mobile, mode ajuster) ── */}
          {isMobile && adjustMode && (
            <div
              ref={loupeWrapRef}
              style={{
                position: "fixed", left: 0, top: 0, zIndex: 1015,
                width: LOUPE_CSS, height: LOUPE_CSS, borderRadius: "50%",
                overflow: "hidden", pointerEvents: "none",
                border: "3px solid #e8a020",
                boxShadow: "0 4px 18px rgba(0,0,0,0.85)",
                background: "#0a0a0a",
                opacity: loupeActive ? 1 : 0,
                transition: "opacity 0.12s ease",
              }}
            >
              <canvas ref={loupeCanvasRef} style={{ width: "100%", height: "100%", display: "block" }} />
            </div>
          )}
          {/* ── Barre du haut ── */}
          <div onClick={e => e.stopPropagation()} style={{ width: "100%", maxWidth: 1100, display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, padding: isMobile ? "0 44px 0 2px" : "0 2px", gap: 6 }}>
            {!isMobile && <div style={{ fontSize: 11, color: "var(--c-ddd)", fontFamily: "var(--font-apple)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "40%" }}>{lightbox.name}</div>}
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
                style={{ background: cropMode ? "#f26522" : "var(--c-181818)", color: cropMode ? "#090909" : "var(--c-aaa)", border: `1px solid ${cropMode ? "#f26522" : "var(--c-2a2a2a)"}`, padding: isMobile ? "6px 10px" : "7px 14px", cursor: "pointer", fontFamily: "var(--font-apple)", fontSize: isMobile ? 11 : 12, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", borderRadius: 2, minHeight: "unset" }}
              >✂ {isMobile ? "" : "Rogner"}</button>

              {/* Bouton Ajuster — visible dès qu'un cache est posé */}
              {plateList(lightbox).length > 0 && (
                <button
                  onClick={e => {
                    e.stopPropagation();
                    if (adjustMode) { closeAdjust(); return; }
                    openAdjust(lightbox, false);
                  }}
                  style={{ background: adjustMode ? "#e8a020" : "var(--c-181818)", color: adjustMode ? "#090909" : "#e8a020", border: `1px solid ${adjustMode ? "#e8a020" : "#3a2800"}`, padding: isMobile ? "6px 10px" : "7px 14px", cursor: "pointer", fontFamily: "var(--font-apple)", fontSize: isMobile ? 11 : 12, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", borderRadius: 2, minHeight: "unset" }}
                >⊹ Ajuster</button>
              )}

              {/* Bouton Ajouter cache plaque — toujours disponible : une photo
                  peut montrer 2 ou 3 voitures, chacune avec sa plaque. */}
              <button
                onClick={e => {
                  e.stopPropagation();
                  if (adjustMode) addPlateInAdjust();
                  else openAdjust(lightbox, true);
                }}
                title={plateList(lightbox).length > 0 ? "Ajouter un cache sur une autre voiture" : "Poser le cache plaque à la main"}
                style={{ background: "var(--c-181818)", color: "#f26522", border: "1px solid var(--c-3a1400)", padding: isMobile ? "6px 10px" : "7px 14px", cursor: "pointer", fontFamily: "var(--font-apple)", fontSize: isMobile ? 11 : 12, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", borderRadius: 2, minHeight: "unset" }}
              >⊕ {isMobile ? "Cache" : (plateList(lightbox).length > 0 ? "Cache supplémentaire" : "Ajouter cache plaque")}</button>

              {/* Supprimer le cache actif — seulement si la photo en porte plusieurs */}
              {adjustMode && adjustPlates.length > 1 && (
                <button
                  onClick={e => { e.stopPropagation(); deleteActivePlate(); }}
                  title="Supprimer le cache sélectionné"
                  style={{ background: "var(--c-181818)", color: "#e05252", border: "1px solid #4a1a1a", padding: isMobile ? "6px 10px" : "7px 14px", cursor: "pointer", fontFamily: "var(--font-apple)", fontSize: isMobile ? 11 : 12, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", borderRadius: 2, minHeight: "unset" }}
                >🗑 {isMobile ? "" : `Cache ${adjustIndex + 1}`}</button>
              )}

              {/* Télécharger / Fermer ajustement */}
              {adjustMode ? (
                <button
                  onClick={e => { e.stopPropagation(); closeAdjust(); }}
                  style={{ background: "#e8a020", color: "#090909", border: "none", padding: isMobile ? "6px 12px" : "7px 18px", cursor: "pointer", fontFamily: "var(--font-apple)", fontSize: isMobile ? 12 : 13, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", borderRadius: 2, minHeight: "unset" }}
                >✓ Terminé</button>
              ) : cropMode ? (<>
                <button
                  onClick={e => { e.stopPropagation(); saveCrop(); }}
                  style={{ background: "#2a6b2a", color: "var(--c-ddd5c8)", border: "1px solid #3a8a3a", padding: isMobile ? "6px 10px" : "7px 14px", cursor: "pointer", fontFamily: "var(--font-apple)", fontSize: isMobile ? 11 : 12, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", borderRadius: 2, minHeight: "unset" }}
                >💾 {isMobile ? "" : "Sauvegarder"}</button>
                <button
                  onClick={e => { e.stopPropagation(); downloadCropped(); }}
                  style={{ background: "#f26522", color: "#090909", border: "none", padding: isMobile ? "6px 12px" : "7px 18px", cursor: "pointer", fontFamily: "var(--font-apple)", fontSize: isMobile ? 12 : 13, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", borderRadius: 2, minHeight: "unset" }}
                >⬇ {isMobile ? "Rogné" : "Télécharger rogné"}</button>
              </>) : (
                <button
                  onClick={e => { e.stopPropagation(); downloadOne(lightbox); }}
                  style={{ background: "#f26522", color: "#090909", border: "none", padding: isMobile ? "6px 14px" : "7px 18px", cursor: "pointer", fontFamily: "var(--font-apple)", fontSize: isMobile ? 12 : 13, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", borderRadius: 2, minHeight: "unset" }}
                >⬇ {isMobile ? "DL" : "Télécharger"}</button>
              )}

              {!isMobile && <button onClick={closeLightbox} style={{ background: "var(--c-1e1e1e)", color: "var(--c-ddd)", border: "1px solid var(--c-2a2a2a)", padding: "7px 14px", cursor: "pointer", fontFamily: "var(--font-apple)", fontSize: 15, borderRadius: 2, minHeight: "unset" }}>✕</button>}
            </div>
          </div>

          {/* ── Image + overlay rognage/ajustement ── */}
          <div
            ref={lbContainerRef}
            onClick={e => e.stopPropagation()}
            onWheel={onLbWheel}
            onMouseDown={onLbPanDown}
            onTouchStart={onLbTouchStart}
            onDoubleClick={e => { e.stopPropagation(); setLbZoom(1); applyLbPan({ x: 0, y: 0 }); }}
            style={{
              position: "relative", display: "inline-block", maxWidth: "100%",
              borderRadius: 3, border: "1px solid var(--c-222)", overflow: "hidden", lineHeight: 0,
              touchAction: "none",
              cursor: lbZoom > 1 ? (lbPanDrag ? "grabbing" : "grab") : "default",
            }}
          >
            {/* Indicateur de zoom — cliquable sur mobile pour réinitialiser */}
            {lbZoom > 1.05 && (
              <div
                onClick={isMobile ? (e => { e.stopPropagation(); setLbZoom(1); applyLbPan({ x: 0, y: 0 }); }) : undefined}
                style={{ position: "absolute", top: 8, right: isMobile ? 54 : 8, background: "rgba(0,0,0,0.82)", color: "#f26522", fontSize: 11, fontFamily: "var(--font-apple)", padding: isMobile ? "5px 10px" : "3px 8px", borderRadius: 2, zIndex: 30, letterSpacing: 1, cursor: isMobile ? "pointer" : "default" }}
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
              <>
                <canvas
                  ref={adjustCanvasRef}
                  style={{ display: "block", maxWidth: "min(1100px, 100vw - 32px)", maxHeight: "72vh", touchAction: "none", WebkitUserSelect: "none", WebkitTouchCallout: "none", pointerEvents: "none" }}
                />
                {/* Calque transparent du cache plaque, superposé au fond */}
                <canvas
                  ref={adjustOverlayCanvasRef}
                  style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
                />
              </>
            ) : cropMode ? (
              <canvas
                ref={cropCanvasRef}
                style={{ display: "block", maxWidth: "min(1100px, 100vw - 32px)", maxHeight: "72vh", touchAction: "none" }}
              />
            ) : (
              <img
                ref={cropImgRef}
                src={(lightbox.signImageUrl && lightbox.signBaseUrl) ? lightbox.signBaseUrl : (lightbox.showroomDataURL || lightbox.processed)}
                style={{ display: "block", maxWidth: "min(1100px, 100vw - 32px)", maxHeight: "79vh", objectFit: "contain", pointerEvents: "none" }}
              />
            )}

            {/* ── Enseigne déplaçable (calque par-dessus l'image) ── */}
            {!cropMode && !adjustMode && lightbox.signImageUrl && (() => {
              const live = signLive || { pos: lightbox.signPos || { x: 0.5, y: 0.16 }, scale: lightbox.signScale ?? 0.64 };
              return (
                <div
                  onClick={e => e.stopPropagation()}
                  onPointerDown={e => onSignPointerDown(e, "move")}
                  onPointerMove={onSignPointerMove}
                  onPointerUp={onSignPointerUp}
                  style={{ position: "absolute", left: `${live.pos.x * 100}%`, top: `${live.pos.y * 100}%`, width: `${live.scale * 100}%`, transform: "translate(-50%,-50%)", cursor: signDragRef.current?.mode === "move" ? "grabbing" : "grab", touchAction: "none", pointerEvents: "all", zIndex: 6, userSelect: "none" }}
                >
                  <img src={lightbox.signImageUrl} draggable={false} style={{ width: "100%", display: "block", pointerEvents: "none", userSelect: "none" }} />
                  <div style={{ position: "absolute", inset: 0, border: "1px dashed rgba(242,101,34,0.7)", pointerEvents: "none" }} />
                  <div
                    onClick={e => e.stopPropagation()}
                    onPointerDown={e => onSignPointerDown(e, "resize")}
                    onPointerMove={onSignPointerMove}
                    onPointerUp={onSignPointerUp}
                    style={{ position: "absolute", right: -11, bottom: -11, width: 22, height: 22, borderRadius: "50%", background: "#f26522", border: "2px solid #fff", boxShadow: "0 1px 5px rgba(0,0,0,0.7)", cursor: "nwse-resize", touchAction: "none" }}
                  />
                </div>
              );
            })()}

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
                            nudge.x, nudge.y, zm, true, wOpts, showroomBlend,
                            null, prev.extraCorners
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
                {!adjustDrag && (manualPlateMode || adjustPlates.length > 1) && (
                  <div style={{ position: "absolute", bottom: 10, left: "50%", transform: "translateX(-50%)", background: "rgba(0,0,0,0.75)", color: "#f26522", fontSize: 11, fontFamily: "var(--font-apple)", padding: "5px 12px", borderRadius: 3, letterSpacing: 1, whiteSpace: "nowrap", pointerEvents: "none" }}>
                    {adjustPlates.length > 1
                      ? `Cache ${adjustIndex + 1}/${adjustPlates.length} · toucher un numéro gris pour changer de cache · ✓ Terminé pour valider`
                      : "Glisser ✥ pour positionner · coins oranges pour ajuster · ✓ Terminé pour valider"}
                  </div>
                )}
                {/* Contours des trapèzes — viewBox 0-100 = % de l'image, pas d'unité % en SVG.
                    Le cache actif est en orange, les autres (2e/3e voiture) en gris. */}
                <svg
                  viewBox="0 0 100 100"
                  preserveAspectRatio="none"
                  style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
                >
                  {adjustPlates.map((q, i) => {
                    const active = i === adjustIndex;
                    const pts = active ? adjustCorners : q;
                    return (
                      <polygon
                        key={`plate-outline-${i}`}
                        points={[
                          `${pts.tl.x * 100},${pts.tl.y * 100}`,
                          `${pts.tr.x * 100},${pts.tr.y * 100}`,
                          `${pts.br.x * 100},${pts.br.y * 100}`,
                          `${pts.bl.x * 100},${pts.bl.y * 100}`,
                        ].join(" ")}
                        fill={active ? "rgba(232,160,32,0.08)" : "rgba(255,255,255,0.05)"}
                        stroke={active ? "#e8a020" : "rgba(255,255,255,0.55)"}
                        strokeWidth="0.4"
                        strokeDasharray="2.5 1.5"
                        vectorEffect="non-scaling-stroke"
                      />
                    );
                  })}
                </svg>
                {/* Pastilles numérotées des caches inactifs — un clic les rend actifs */}
                {adjustPlates.map((q, i) => {
                  if (i === adjustIndex) return null;
                  const cx = (q.tl.x + q.tr.x + q.br.x + q.bl.x) / 4;
                  const cy = (q.tl.y + q.tr.y + q.br.y + q.bl.y) / 4;
                  const sz = isMobile ? 24 : 20;
                  return (
                    <div
                      key={`plate-badge-${i}`}
                      onMouseDown={e => { e.preventDefault(); e.stopPropagation(); selectPlate(i); }}
                      onTouchStart={e => { e.preventDefault(); e.stopPropagation(); selectPlate(i); }}
                      title={`Modifier le cache ${i + 1}`}
                      style={{
                        position: "absolute",
                        left: `${cx * 100}%`, top: `${cy * 100}%`,
                        width: sz, height: sz,
                        background: "rgba(20,20,20,0.85)",
                        border: "2px solid rgba(255,255,255,0.75)",
                        borderRadius: "50%",
                        transform: "translate(-50%,-50%)",
                        cursor: "pointer",
                        zIndex: 9,
                        touchAction: "none",
                        boxShadow: "0 0 6px rgba(0,0,0,0.8)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: isMobile ? 12 : 11, color: "#fff", fontWeight: 700, lineHeight: 1,
                        fontFamily: "var(--font-apple)", userSelect: "none",
                      }}
                    >{i + 1}</div>
                  );
                })}
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
                {/* Poignée centrale — déplace tout le cache d'un bloc (pose
                    manuelle, ou photo portant plusieurs caches) */}
                {(manualPlateMode || adjustPlates.length > 1) && (() => {
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
            <div onClick={e => e.stopPropagation()} style={{ width: "100%", maxWidth: "min(1100px, 100vw - 32px)", marginTop: 10, padding: "10px 16px 8px", background: "var(--c-161616)", border: "1px solid var(--c-222)", borderRadius: 3 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 7 }}>
                <span style={{ fontSize: 11, letterSpacing: 2, textTransform: "uppercase", color: "var(--c-ddd)", fontFamily: "var(--font-apple)" }}>Inclinaison</span>
                <span style={{ fontSize: 12, color: "#f26522", fontFamily: "var(--font-apple)" }}>
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
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, fontSize: 10, color: "var(--c-ddd)", fontFamily: "var(--font-apple)" }}>
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
                { dir: "down",  dx: 0,          dy:  NUDGE_STEP, label: "▼", style: { bottom: "18%", left: "50%", transform: "translateX(-50%)" } },
                { dir: "left",  dx: -NUDGE_STEP, dy: 0,          label: "◀", style: { left: "2%",  top: "50%",  transform: "translateY(-50%)" } },
                { dir: "right", dx:  NUDGE_STEP, dy: 0,          label: "▶", style: { right: "2%", top: "50%",  transform: "translateY(-50%)" } },
              ].map(({ dir, dx, dy, label, style }) => (
                <button
                  key={dir}
                  onClick={e => { e.stopPropagation(); nudgeShowroom(dx, dy); }}
                  style={{
                    position: "fixed",
                    ...style,
                    pointerEvents: "all",
                    width: 52, height: 52,
                    borderRadius: "50%",
                    background: "rgba(242,101,34,0.82)",
                    border: "2px solid rgba(255,255,255,0.18)",
                    color: "#fff",
                    fontSize: 21,
                    cursor: "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    boxShadow: "0 2px 12px rgba(0,0,0,0.7)",
                    zIndex: 1010,
                  }}
                >{label}</button>
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
              <span style={{ fontSize: 11, color: "#fff", letterSpacing: 1.5, textTransform: "uppercase", fontFamily: "var(--font-apple)", userSelect: "none", whiteSpace: "nowrap" }}>
                Agrandir la taille
              </span>
              <input
                type="range"
                min="0.5" max="2.5" step="0.05"
                value={showroomZoom}
                onChange={e => onZoomChange(parseFloat(e.target.value))}
                style={{ flex: 1, accentColor: "#f26522", cursor: "pointer", height: 4, touchAction: "pan-x" }}
              />
              <span style={{ fontSize: 11, color: "#f26522", fontFamily: "var(--font-apple)", minWidth: 34, textAlign: "right" }}>
                ×{showroomZoom.toFixed(2)}
              </span>
              {showroomNudging && <span style={{ fontSize: 11, color: "var(--c-ddd)", fontFamily: "var(--font-apple)" }}>…</span>}
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
              <span style={{ fontSize: 11, color: "#fff", letterSpacing: 1.5, textTransform: "uppercase", fontFamily: "var(--font-apple)", userSelect: "none", whiteSpace: "nowrap" }}>
                Fondre le véhicule au décor
              </span>
              <input
                type="range"
                min="0" max="100" step="1"
                value={showroomBlend}
                onChange={e => onBlendChange(parseInt(e.target.value, 10))}
                style={{ flex: 1, accentColor: "#f26522", cursor: "pointer", height: 4, touchAction: "pan-x" }}
              />
              <span style={{ fontSize: 11, color: "#f26522", fontFamily: "var(--font-apple)", minWidth: 34, textAlign: "right" }}>
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
                  border: '1px solid var(--c-444)', borderRadius: 6, cursor: 'pointer', fontSize: 12,
                  fontFamily: "var(--font-apple)", letterSpacing: 0.5,
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
                  // Recalcule la bbox du véhicule depuis le masque corrigé
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
                  freeCanvas(scanC);
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
                    showroomNudge.x, showroomNudge.y, showroomZoom, true, wOpts, showroomBlend
                  );
                  // Update lightbox state
                  setLightbox(prev => ({
                    ...prev,
                    cutoutDataURL: correctedDataURL,
                    showroomDataURL: sr.dataURL,
                    showroomBaseURL: sr.baseURL,
                    showroomTransform: sr.transform,
                    carBoundsCache: carBounds,
                  }));
                  // Update results array
                  setResults(prev => prev.map((r, i) => i === lightbox.index ? {
                    ...r,
                    cutoutDataURL: correctedDataURL,
                    showroomDataURL: sr.dataURL,
                    showroomBaseURL: sr.baseURL,
                    showroomTransform: sr.transform,
                    carBoundsCache: carBounds,
                  } : r));
                  console.log('[MaskEditor] applied correction, recomposited');
                } catch (e) {
                  console.error('[MaskEditor] recomposite failed:', e);
                }
              }}
              onCancel={() => setShowMaskEditor(false)}
            />
          )}

          {/* ── Pied ── */}
          <div style={{ marginTop: 8, fontSize: 10, color: "var(--c-ddd)", fontFamily: "var(--font-apple)", textAlign: "center" }}>
            {adjustMode
              ? "Glisser un point orange pour repositionner le coin · Le résultat s'applique en temps réel"
              : cropMode
              ? "Inclinaison · Glisser la zone · Coins oranges pour redimensionner · 💾 Sauvegarder"
              : lightbox.showroomDataURL
              ? "Flèches pour déplacer · 🔍 pour zoomer la voiture · Sauvegarde auto · Cliquer en dehors pour fermer"
              : lbZoom > 1
              ? (isMobile
                ? "Pincer pour zoomer · Un doigt pour se déplacer · Toucher ×N pour réinitialiser"
                : "Molette pour zoomer · Glisser pour se déplacer · Double-clic pour réinitialiser")
              : (isMobile
                ? "Pincer pour zoomer · ✂ Rogner · ⊹ Ajuster · ✕ pour fermer"
                : "Molette pour zoomer · ✂ Rogner · ⊹ Ajuster · Cliquer en dehors pour fermer")}
          </div>
        </div>
      )}

      {showInstallHelp && <InstallHelpModal ios={isIOS} onClose={() => setShowInstallHelp(false)} />}

      {/* ── Bandeau erreur serveur détection plaque ── */}
      {/* Activation en cours après paiement */}
      {activating && (
        <div style={{ position: "fixed", top: 14, left: "50%", transform: "translateX(-50%)", zIndex: 9600, maxWidth: "min(680px, 94vw)", background: "rgba(8,16,10,0.97)", border: "1px solid #27ae60", borderRadius: 6, padding: "12px 16px", display: "flex", gap: 12, alignItems: "center", boxShadow: "0 8px 30px rgba(0,0,0,0.6)" }}>
          <div style={{ width: 14, height: 14, borderRadius: "50%", border: "2px solid rgba(39,174,96,0.3)", borderTopColor: "#27ae60", animation: "ac-spin 0.8s linear infinite", flexShrink: 0 }} />
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 1.5, color: "#27ae60", textTransform: "uppercase", fontFamily: "var(--font-apple)" }}>Paiement accepté — activation en cours</div>
            <div style={{ fontSize: 11, color: "var(--c-ddd)", fontFamily: "var(--font-apple)", marginTop: 4, lineHeight: 1.5 }}>
              Votre abonnement s'ouvre dans quelques secondes. Ne fermez pas cette page.
            </div>
          </div>
        </div>
      )}

      {/* Paiement encaissé mais activation non confirmée dans le délai imparti */}
      {activationFailed && (
        <div style={{ position: "fixed", top: 14, left: "50%", transform: "translateX(-50%)", zIndex: 9600, maxWidth: "min(680px, 94vw)", background: "rgba(20,14,4,0.97)", border: "1px solid #f26522", borderRadius: 6, padding: "12px 16px", display: "flex", gap: 12, alignItems: "flex-start", boxShadow: "0 8px 30px rgba(0,0,0,0.6)" }}>
          <div style={{ fontSize: 18 }}>⏳</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 1.5, color: "#f26522", textTransform: "uppercase", fontFamily: "var(--font-apple)" }}>Paiement bien reçu — activation en attente</div>
            <div style={{ fontSize: 11, color: "var(--c-ddd)", fontFamily: "var(--font-apple)", marginTop: 4, lineHeight: 1.5 }}>
              Votre paiement est encaissé, mais l'activation n'est pas encore remontée jusqu'ici. Rechargez la page dans une minute. Si l'abonnement n'apparaît toujours pas, écrivez-nous : nous le débloquons manuellement.
            </div>
          </div>
          <button onClick={() => setActivationFailed(false)} style={{ background: "none", border: "none", color: "var(--c-ddd)", fontSize: 16, cursor: "pointer", lineHeight: 1 }}>✕</button>
        </div>
      )}

      {plateErrorBanner && (
        <div style={{ position: "fixed", top: 14, left: "50%", transform: "translateX(-50%)", zIndex: 9500, maxWidth: "min(680px, 94vw)", background: "rgba(20,8,4,0.97)", border: "1px solid #c0392b", borderRadius: 6, padding: "12px 16px", display: "flex", gap: 12, alignItems: "flex-start", boxShadow: "0 8px 30px rgba(0,0,0,0.6)" }}>
          <div style={{ fontSize: 18 }}>⚠</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 1.5, color: "#e74c3c", textTransform: "uppercase", fontFamily: "var(--font-apple)" }}>Cache plaque non posé — erreur serveur</div>
            <div style={{ fontSize: 11, color: "var(--c-ddd)", fontFamily: "var(--font-apple)", marginTop: 4, lineHeight: 1.5, wordBreak: "break-word" }}>
              {plateErrorBanner}
            </div>
            <div style={{ fontSize: 10, color: "#8a8a8a", fontFamily: "var(--font-apple)", marginTop: 4, lineHeight: 1.5 }}>
              Vérifiez la clé ANTHROPIC_API_KEY et le crédit API (console Anthropic / Vercel), puis relancez le traitement.
            </div>
          </div>
          <button onClick={() => setPlateErrorBanner(null)} style={{ background: "none", border: "none", color: "var(--c-ddd)", fontSize: 16, cursor: "pointer", lineHeight: 1 }}>✕</button>
        </div>
      )}

      {/* ── Modal Nous Contacter ── */}
      {showContactModal && (
        <div onClick={() => setShowContactModal(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.82)", zIndex: 9000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: "var(--c-111)", border: "1px solid var(--c-222)", borderRadius: 6, width: "92%", maxWidth: 420, fontFamily: "var(--font-apple)" }}>
            <div style={{ padding: "20px 24px 16px", borderBottom: "1px solid var(--c-1c1c1c)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ fontSize: 12, letterSpacing: 3, color: "#f26522", textTransform: "uppercase", fontFamily: "var(--font-apple)" }}>Nous contacter</div>
              <button onClick={() => setShowContactModal(false)} style={{ background: "none", border: "none", color: "var(--c-ddd)", fontSize: 21, cursor: "pointer", lineHeight: 1 }}>✕</button>
            </div>
            <div style={{ padding: "20px 24px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
              {[
                { icon: "✉", label: "E-mail", value: "contact.asgs29200@gmail.com", href: "mailto:contact.asgs29200@gmail.com" },
                { icon: "📞", label: "Téléphone", value: "07 56 98 17 29", href: "tel:+33756981729" },
              ].map(({ icon, label, value, href }) => (
                <a key={label} href={href}
                  style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 16px", background: "var(--c-0a0a0a)", border: "1px solid var(--c-1c1c1c)", borderRadius: 4, textDecoration: "none", cursor: "pointer" }}>
                  <span style={{ fontSize: 21 }}>{icon}</span>
                  <div>
                    <div style={{ fontSize: 11, color: "var(--c-ddd)", letterSpacing: 2, textTransform: "uppercase", fontFamily: "var(--font-apple)", marginBottom: 3 }}>{label}</div>
                    <div style={{ fontSize: 16, color: "var(--c-ddd5c8)", fontWeight: 700, letterSpacing: 0.5 }}>{value}</div>
                  </div>
                </a>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Modal Envoyer par mail ── */}
      {showEmailModal && (
        <div onClick={() => { if (!emailSending) setShowEmailModal(false); }}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.82)", zIndex: 9000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: "var(--c-111)", border: "1px solid var(--c-222)", borderRadius: 6, width: "92%", maxWidth: 440, fontFamily: "var(--font-apple)" }}>
            <div style={{ padding: "20px 24px 16px", borderBottom: "1px solid var(--c-1c1c1c)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ fontSize: 12, letterSpacing: 3, color: "#f26522", textTransform: "uppercase", fontFamily: "var(--font-apple)" }}>Envoyer par mail</div>
              <button onClick={() => { if (!emailSending) setShowEmailModal(false); }} style={{ background: "none", border: "none", color: "var(--c-ddd)", fontSize: 21, cursor: "pointer", lineHeight: 1 }}>✕</button>
            </div>
            <div style={{ padding: "20px 24px 24px", display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ fontSize: 12, color: "var(--c-ddd)", fontFamily: "var(--font-apple)", lineHeight: 1.6 }}>
                Les {results.length} photo{results.length > 1 ? "s" : ""} traitée{results.length > 1 ? "s" : ""} seront envoyées en pièces jointes à l'adresse ci-dessous.
              </div>
              <div style={{ fontSize: 11, color: "#8a8a8a", fontFamily: "var(--font-apple)", lineHeight: 1.6, background: "var(--c-0a0a0a)", border: "1px solid var(--c-1c1c1c)", borderRadius: 4, padding: "10px 12px" }}>
                ⓘ Les photos peuvent être légèrement compressées pour l'envoi par mail.<br />
                Si vous ne recevez rien, pensez à vérifier le dossier <span style={{ color: "#f26522" }}>courrier indésirable (spam)</span>.
              </div>
              <div>
                <label style={{ fontSize: 10, color: "var(--c-888)", letterSpacing: 2, textTransform: "uppercase", fontFamily: "var(--font-apple)" }}>Adresse email</label>
                <input
                  type="email"
                  value={emailTo}
                  disabled={emailSending}
                  onChange={e => setEmailTo(e.target.value)}
                  placeholder="client@exemple.com"
                  style={{ width: "100%", marginTop: 6, boxSizing: "border-box", background: "var(--c-0a0a0a)", border: "1px solid var(--c-2a2a2a)", borderRadius: 4, color: "var(--c-ddd5c8)", fontSize: 15, padding: "11px 13px", fontFamily: "var(--font-apple)", outline: "none" }}
                />
                <div style={{ fontSize: 10, color: "var(--c-666)", fontFamily: "var(--font-apple)", marginTop: 6 }}>Mémorisée comme adresse par défaut du compte.</div>
              </div>
              {emailStatus && (
                <div style={{ fontSize: 12, fontFamily: "var(--font-apple)", lineHeight: 1.5,
                  color: emailStatus.type === "ok" ? "#5fbf5f" : emailStatus.type === "err" ? "#e06b5f" : "#f26522" }}>
                  {emailStatus.type === "ok" ? "✓ " : emailStatus.type === "err" ? "✕ " : "⏳ "}{emailStatus.msg}
                </div>
              )}
              <button onClick={sendPhotosByEmail} disabled={emailSending}
                style={{ width: "100%", background: emailSending ? "#3a1a0a" : "#f26522", color: emailSending ? "var(--c-aaa)" : "#090909", border: "none", padding: "13px 0", fontFamily: "var(--font-apple)", fontSize: 14, fontWeight: 700, letterSpacing: 3, textTransform: "uppercase", borderRadius: 3, cursor: emailSending ? "default" : "pointer" }}>
                {emailSending ? "Envoi en cours…" : "Envoyer"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal Mini-jeu (hors chargement) ── */}
      {showMiniGame && (
        <div onClick={() => setShowMiniGame(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.88)", zIndex: 9000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: "var(--c-111)", border: "1px solid var(--c-222)", borderRadius: 6, padding: "20px 24px 24px", fontFamily: "var(--font-apple)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <div style={{ fontSize: 12, letterSpacing: 3, color: "#f26522", textTransform: "uppercase", fontFamily: "var(--font-apple)" }}>
                Mini-jeu
              </div>
              <button onClick={() => setShowMiniGame(false)} style={{ background: "none", border: "none", color: "var(--c-ddd)", fontSize: 21, cursor: "pointer", lineHeight: 1 }}>✕</button>
            </div>
            <LoadingGame />
          </div>
        </div>
      )}

      {/* ── Modal Mes Informations ── */}
      {showProfileModal && (() => {
        const meta = user?.user_metadata ?? {};
        const planLabel = (meta.plan ?? "trial") === "trial"
          ? "Essai gratuit"
          : `Abonnement${meta.formule ? " · " + (FORMULE_LABELS[meta.formule] ?? "") : ""}`;
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
              style={{ background: "var(--c-111)", border: "1px solid var(--c-222)", borderRadius: 6, width: "92%", maxWidth: 480, fontFamily: "var(--font-apple)" }}>
              {/* Header */}
              <div style={{ padding: "20px 24px 16px", borderBottom: "1px solid var(--c-1c1c1c)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                  <div style={{ fontSize: 12, letterSpacing: 3, color: "#f26522", textTransform: "uppercase", fontFamily: "var(--font-apple)", marginBottom: 4 }}>Mes informations</div>
                  <div style={{ fontSize: 14, color: "var(--c-ddd)" }}>Données personnelles associées à votre compte</div>
                </div>
                <button onClick={() => setShowProfileModal(false)} style={{ background: "none", border: "none", color: "var(--c-ddd)", fontSize: 21, cursor: "pointer", lineHeight: 1 }}>✕</button>
              </div>
              {/* Rows */}
              <div style={{ padding: "8px 0 16px" }}>
                {rows.map(({ label, value }) => (
                  <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 24px", borderBottom: "1px solid var(--c-161616)" }}>
                    <span style={{ fontSize: 13, color: "var(--c-ddd)", letterSpacing: 1, textTransform: "uppercase", fontFamily: "var(--font-apple)" }}>{label}</span>
                    <span style={{ fontSize: 15, color: value === "—" ? "var(--c-333)" : "var(--c-ddd5c8)", fontWeight: 600, maxWidth: 260, textAlign: "right", wordBreak: "break-all" }}>{value}</span>
                  </div>
                ))}
              </div>
              {/* Footer note */}
              <div style={{ padding: "12px 24px", borderTop: "1px solid var(--c-1c1c1c)" }}>
                <div style={{ fontSize: 12, color: "var(--c-ddd)", fontFamily: "var(--font-apple)", lineHeight: 1.6 }}>
                  Pour modifier vos informations, contactez-nous à <span style={{ color: "#f26522" }}>contact@autocache.fr</span>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Showroom interactif : capture guidée ── */}
      {showCapture360 && canUseShowroomInteractif && (
        <ShowroomCapture
          onClose={() => setShowCapture360(false)}
          onDone={(files, meta) => {
            // Les vues deviennent le lot courant : elles passeront par le
            // pipeline normal (cache plaque, fond, colorimétrie), puis les
            // vues de la ligne médiane formeront le tour 360°.
            handleCapturedViews(files, meta);
            setShowCapture360(false);
          }}
        />
      )}

      {/* ── Showroom interactif : prévisualisation du tour 360° ── */}
      {showSpinViewer && (
        <div onClick={() => setShowSpinViewer(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 9000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: "var(--c-141414)", border: "1px solid var(--c-2a2a2a)", borderRadius: 6, padding: isMobile ? "18px 14px" : "28px 30px", maxWidth: 760, width: "94%" }}>
            <Spin360
              frames={results.slice(0, spinRingCount || results.length).map(r => r.showroomDataURL || r.processed)}
              height={isMobile ? 240 : 380}
              onClose={() => setShowSpinViewer(false)}
            />
          </div>
        </div>
      )}

      {/* ── Modal Code Administrateur ── */}
      {showPromoModal && (
        <div onClick={() => setShowPromoModal(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 9000, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: "var(--c-141414)", border: "1px solid var(--c-2a2a2a)", borderRadius: 6, padding: isMobile ? "24px 20px" : "36px 40px", maxWidth: 400, width: "92%", fontFamily: "var(--font-apple)" }}>
            <div style={{ fontSize: 21, fontWeight: 700, letterSpacing: 2, color: "var(--c-e0dbd4)", marginBottom: 6, textTransform: "uppercase" }}>Code Administrateur</div>
            <div style={{ fontSize: 11, color: "var(--c-ddd)", fontFamily: "var(--font-apple)", marginBottom: 20 }}>Entrez votre code pour débloquer des photos supplémentaires.</div>
            <input
              value={promoCode} onChange={e => { setPromoCode(e.target.value); setPromoStatus(null); setPromoMsg(""); }}
              onKeyDown={e => e.key === "Enter" && promoCode.trim() && promoStatus !== "loading" && submitPromo()}
              placeholder="Votre code administrateur"
              style={{ width: "100%", boxSizing: "border-box", padding: "11px 14px", background: "var(--c-1a1a1a)", border: `1px solid ${promoStatus === "error" ? "#c0392b" : promoStatus === "success" ? "#27ae60" : "var(--c-2a2a2a)"}`, borderRadius: 3, color: "var(--c-ddd5c8)", fontFamily: "var(--font-apple)", fontSize: 16, letterSpacing: 3, textTransform: "uppercase", outline: "none", marginBottom: 10 }}
            />
            {promoMsg && (
              <div style={{ fontSize: 11, fontFamily: "var(--font-apple)", color: promoStatus === "success" ? "#27ae60" : "#c0392b", marginBottom: 14, letterSpacing: 1 }}>
                {promoMsg}
              </div>
            )}
            <button
              onClick={submitPromo}
              disabled={!promoCode.trim() || promoStatus === "loading" || promoStatus === "success"}
              style={{ width: "100%", background: promoStatus === "success" ? "#27ae60" : (!promoCode.trim() || promoStatus === "loading") ? "var(--c-1a1a1a)" : "#f26522", color: promoStatus === "success" ? "#fff" : (!promoCode.trim() || promoStatus === "loading") ? "var(--c-444)" : "#090909", border: "none", padding: "13px 0", fontFamily: "var(--font-apple)", fontSize: 15, fontWeight: 700, letterSpacing: 3, textTransform: "uppercase", borderRadius: 3, cursor: promoStatus === "loading" || promoStatus === "success" ? "default" : "pointer", marginBottom: 10 }}>
              {promoStatus === "loading" ? "Vérification..." : promoStatus === "success" ? "Code activé ✓" : "Activer"}
            </button>
            <button onClick={() => setShowPromoModal(false)}
              style={{ width: "100%", background: "transparent", color: "var(--c-ddd)", border: "1px solid var(--c-2a2a2a)", padding: "9px 0", fontFamily: "var(--font-apple)", fontSize: 11, letterSpacing: 2, textTransform: "uppercase", borderRadius: 3, cursor: "pointer" }}>
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
            style={{ background: "var(--c-141414)", border: "1px solid var(--c-2a2a2a)", borderRadius: 8, padding: isMobile ? "20px 14px" : "36px 40px", maxWidth: isPaid ? 480 : 980, width: "92%", maxHeight: "90vh", overflowY: "auto", fontFamily: "var(--font-apple)" }}>

            {!isPaid ? (
              /* ── Vue choix de formule (utilisateurs en essai) ── */
              <>
                <div style={{ textAlign: "center", marginBottom: 28 }}>
                  <div style={{ fontSize: 23, fontWeight: 700, letterSpacing: 3, color: "var(--c-e0dbd4)", textTransform: "uppercase" }}>Notre Abonnement</div>
                  <div style={{ fontSize: 11, color: "var(--c-ddd)", fontFamily: "var(--font-apple)", marginTop: 6, letterSpacing: 1 }}>
                    3 formules au choix · Plan actuel : <span style={{ color: "#f26522" }}>Essai gratuit</span>
                  </div>
                </div>

                {renderFormulesGrid()}

                <button onClick={() => setShowPlansModal(false)}
                  style={{ width: "100%", background: "transparent", color: "var(--c-ddd)", border: "1px solid var(--c-2a2a2a)", padding: "9px 0", fontFamily: "var(--font-apple)", fontSize: 11, letterSpacing: 2, textTransform: "uppercase", borderRadius: 3, cursor: "pointer" }}>
                  Fermer
                </button>
              </>
            ) : (
              /* ── Vue gestion abonnement (utilisateurs abonnés) ── */
              <>
                {/* En-tête */}
                <div style={{ textAlign: "center", marginBottom: 32 }}>
                  <div style={{ fontSize: 23, fontWeight: 700, letterSpacing: 3, color: "var(--c-e0dbd4)", textTransform: "uppercase" }}>Mon Abonnement</div>
                  <div style={{ fontSize: 11, color: "var(--c-ddd)", fontFamily: "var(--font-apple)", marginTop: 6, letterSpacing: 1 }}>
                    Formule active : <span style={{ color: "#f26522", fontWeight: 700 }}>
                      {FORMULE_LABELS[user?.user_metadata?.formule] ?? "Abonnement"}
                    </span>
                  </div>
                </div>

                {/* Badge abonnement */}
                <div style={{ background: "rgba(242,101,34,0.08)", border: "1px solid #f26522", borderRadius: 6, padding: "20px 24px", marginBottom: 20, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div>
                    <div style={{ fontSize: 19, fontWeight: 700, letterSpacing: 2, color: "#f26522", textTransform: "uppercase" }}>
                      {FORMULE_LABELS[user?.user_metadata?.formule] ?? "Abonnement"}
                    </div>
                    <div style={{ fontSize: 10, color: "var(--c-ddd)", fontFamily: "var(--font-apple)", marginTop: 4, letterSpacing: 1 }}>
                      {quotaLabel(user?.user_metadata?.formule)} · Toutes les fonctionnalités incluses
                    </div>
                  </div>
                  <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#27ae60", boxShadow: "0 0 6px #27ae60" }} />
                </div>

                <div style={{ fontSize: 10, color: "var(--c-777)", fontFamily: "var(--font-apple)", letterSpacing: 0.5, lineHeight: 1.6, marginBottom: 16 }}>
                  Pour changer de formule (hebdo / mensuel / annuel) ou mettre à jour votre paiement, ouvrez votre espace de facturation ci-dessous.
                </div>

                {/* Bouton Factures */}
                {(() => {
                  const openPortal = async (action) => {
                    setPortalError("");
                    setPortalLoading(action);
                    try {
                      const res = await fetch("/api/customer-portal", {
                        method: "POST",
                        headers: await authHeaders(),
                        // "cancel" ouvre directement le parcours de résiliation ;
                        // sans action, on ouvre l'accueil du portail.
                        body: JSON.stringify(action === "cancel" ? { action: "cancel" } : {}),
                      });
                      const data = await res.json();
                      if (data.url) {
                        window.location.href = data.url;
                      } else if (data.alreadyCancelled) {
                        setPortalError("Votre abonnement est déjà résilié : il prendra fin à l'échéance en cours et ne sera plus prélevé.");
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
                        style={{ width: "100%", background: "transparent", color: "var(--c-ddd)", border: "1px solid var(--c-333)", padding: "12px 0", fontFamily: "var(--font-apple)", fontSize: 14, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", borderRadius: 3, cursor: !!portalLoading ? "wait" : "pointer", marginBottom: 10 }}>
                        {portalLoading === "invoices" ? "Ouverture..." : "Factures & Historique"}
                      </button>

                      {/* Résiliation — masquée si elle est déjà programmée */}
                      {!subInfo?.cancelAtPeriodEnd && (
                        <button
                          disabled={!!portalLoading}
                          onClick={() => openPortal("cancel")}
                          style={{ width: "100%", background: "transparent", color: "var(--c-777)", border: "1px solid var(--c-1e1e1e)", padding: "10px 0", fontFamily: "var(--font-apple)", fontSize: 11, letterSpacing: 2, textTransform: "uppercase", borderRadius: 3, cursor: !!portalLoading ? "wait" : "pointer", marginBottom: 10 }}>
                          {portalLoading === "cancel" ? "Ouverture..." : "Résilier mon abonnement"}
                        </button>
                      )}

                      <div style={{ fontSize: 10, color: "var(--c-777)", fontFamily: "var(--font-apple)", letterSpacing: 0.5, lineHeight: 1.6, marginBottom: 10 }}>
                        Sans engagement : vous pouvez résilier à tout moment. Votre accès reste ouvert jusqu'au terme de la période déjà réglée, et aucun nouveau prélèvement n'est effectué.
                      </div>

                      {portalError && (
                        <div style={{ fontSize: 11, color: "#c0392b", fontFamily: "var(--font-apple)", marginBottom: 10, padding: "8px 12px", background: "rgba(192,57,43,0.08)", border: "1px solid rgba(192,57,43,0.2)", borderRadius: 3 }}>
                          ⚠ {portalError}
                        </div>
                      )}

                      <button onClick={() => { setShowPlansModal(false); setPortalError(""); }}
                        style={{ width: "100%", background: "transparent", color: "var(--c-ddd)", border: "1px solid var(--c-1e1e1e)", padding: "9px 0", fontFamily: "var(--font-apple)", fontSize: 11, letterSpacing: 2, textTransform: "uppercase", borderRadius: 3, cursor: "pointer", marginBottom: 24 }}>
                        Fermer
                      </button>

                      <div style={{ borderTop: "1px solid var(--c-1a1a1a)", paddingTop: 18, textAlign: "center" }}>
                        <button
                          disabled={!!portalLoading}
                          onClick={() => openPortal("cancel")}
                          style={{ background: "transparent", color: "var(--c-ddd)", border: "none", fontFamily: "var(--font-apple)", fontSize: 10, letterSpacing: 1, textTransform: "uppercase", cursor: !!portalLoading ? "wait" : "pointer", textDecoration: "underline" }}>
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
            style={{ background: "var(--c-141414)", border: "1px solid #f26522", borderRadius: 6, padding: isMobile ? "24px 16px" : "36px 40px", maxWidth: 420, width: "92%", textAlign: "center", fontFamily: "var(--font-apple)" }}>
            <div style={{ fontSize: 33, marginBottom: 12 }}>⬡</div>
            <div style={{ fontSize: 21, fontWeight: 700, letterSpacing: 2, color: "var(--c-e0dbd4)", marginBottom: 4, textTransform: "uppercase" }}>Showroom Virtuel</div>
            <div style={{ fontSize: 12, color: "#f26522", letterSpacing: 2, fontFamily: "var(--font-apple)", marginBottom: 16, textTransform: "uppercase" }}>Abonnement requis</div>
            <div style={{ fontSize: 14, color: "var(--c-ddd)", lineHeight: 1.7, marginBottom: 28, fontFamily: "var(--font-apple)" }}>
              Le mode Showroom Virtuel — détourage IA et fonds de showroom — est inclus dans <span style={{ color: "#f26522", fontWeight: 700 }}>l'abonnement</span>.<br /><br />
              Choisissez la formule qui vous convient.
            </div>
            <button onClick={() => { setShowUpgradeProModal(false); setShowPlansModal(true); }}
              style={{ width: "100%", background: "#f26522", color: "#090909", border: "none", padding: "13px 0", fontFamily: "var(--font-apple)", fontSize: 15, fontWeight: 700, letterSpacing: 3, textTransform: "uppercase", borderRadius: 3, cursor: "pointer", marginBottom: 10 }}>
              Voir les formules
            </button>
            <button onClick={() => setShowUpgradeProModal(false)}
              style={{ width: "100%", background: "transparent", color: "var(--c-ddd)", border: "1px solid var(--c-2a2a2a)", padding: "9px 0", fontFamily: "var(--font-apple)", fontSize: 11, letterSpacing: 2, textTransform: "uppercase", borderRadius: 3, cursor: "pointer" }}>
              Fermer
            </button>
          </div>
        </div>
      )}

      {/* ── Modal upgrade (essai épuisé) ── */}
      {showUpgradeModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.88)", zIndex: 9000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: "var(--c-141414)", border: "1px solid var(--c-2a2a2a)", borderRadius: 8, padding: isMobile ? "20px 14px" : "36px 40px", maxWidth: 980, width: "92%", maxHeight: "90vh", overflowY: "auto", fontFamily: "var(--font-apple)" }}>

            {/* En-tête */}
            <div style={{ textAlign: "center", marginBottom: 28 }}>
              <div style={{ fontSize: 14, color: "#c0392b", fontFamily: "var(--font-apple)", letterSpacing: 2, textTransform: "uppercase", marginBottom: 8 }}>Essai gratuit terminé</div>
              <div style={{ fontSize: 23, fontWeight: 700, letterSpacing: 3, color: "var(--c-e0dbd4)", textTransform: "uppercase", marginBottom: 10 }}>Continuez à sublimer vos photos</div>
              <div style={{ fontSize: 12, color: "var(--c-ddd)", fontFamily: "var(--font-apple)", lineHeight: 1.7 }}>
                Vous avez utilisé vos <span style={{ color: "#f26522" }}>30 photos d'essai</span>.<br />
                Choisissez votre formule pour continuer à traiter vos photos.
              </div>
            </div>

            {/* Formules */}
            {renderFormulesGrid()}

            <button onClick={() => setShowUpgradeModal(false)}
              style={{ width: "100%", background: "transparent", color: "var(--c-ddd)", border: "1px solid var(--c-222)", padding: "9px 0", fontFamily: "var(--font-apple)", fontSize: 11, letterSpacing: 2, textTransform: "uppercase", borderRadius: 3, cursor: "pointer" }}>
              Fermer
            </button>
          </div>
        </div>
      )}

      {/* ── Overlay chargement ──
          L'anneau se trace autour du logo au lancement puis se remplit au fil
          des photos : il remplace à la fois l'ancien rouet et la barre de
          progression, qui donnaient deux fois la même information. */}
      {procVisible && (
        <div className={processing ? "ac-proc-veil" : "ac-proc-veil-out"}
          style={{ position: "fixed", inset: 0, background: "rgba(10,10,10,0.92)", zIndex: 9000, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 20, overflowY: "auto", padding: "32px 16px" }}>
          {/* Le libellé dit ce qui se passe, le compteur sous l'anneau donne le
              chiffre : répéter « Traitement » aux deux endroits bégayait. */}
          <div className="ac-proc-rise-1"><ProcessingLabel running={processing} /></div>
          <ProcessingIndicator pct={pct} />
          <div className="ac-proc-rise-1" style={{ fontFamily: "var(--font-apple)", fontSize: 12, color: "#f26522", letterSpacing: 3, textTransform: "uppercase" }}>
            {progress.n} / {progress.total} photo{progress.total > 1 ? "s" : ""}
          </div>
          {/* Mini-jeu d'esquive pour patienter pendant le traitement.
              `gated` : le jeu ne s'affiche pas d'office — une phrase invite
              à appuyer sur Espace pour le lancer. */}
          <div className="ac-proc-rise-2">
            <LoadingGame gated />
          </div>
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
