import { useState, useRef, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://vwfqwfmrllnbbxyvhjht.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ3ZnF3Zm1ybGxuYmJ4eXZoamh0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyNjUxMjgsImV4cCI6MjA4OTg0MTEyOH0.0BJUku8o25mEOmpx4rXiPkHLEI-GkxmCGBCRc00M4OA";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

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

// After Plate Recognizer gives us the bounding box, crop tightly around
// the plate and ask Claude for the exact 4 perspective corners.
async function getExactCorners(canvas, box) {
  const bw = box.tr.x - box.tl.x;
  const bh = box.bl.y - box.tl.y;
  // Larger left padding: Plate Recognizer often misses the EU blue strip on left
  const x0 = Math.max(0, box.tl.x - bw * 1.2);
  const y0 = Math.max(0, box.tl.y - bh * 0.8);
  const x1 = Math.min(1, box.tr.x + bw * 0.5);
  const y1 = Math.min(1, box.bl.y + bh * 0.8);

  const cropW = (x1 - x0) * canvas.width;
  const cropH = (y1 - y0) * canvas.height;
  const scale = Math.min(1, 900 / Math.max(cropW, cropH));
  const crop = document.createElement("canvas");
  crop.width = Math.round(cropW * scale);
  crop.height = Math.round(cropH * scale);
  crop.getContext("2d").drawImage(canvas, x0 * canvas.width, y0 * canvas.height, cropW, cropH, 0, 0, crop.width, crop.height);
  const b64 = crop.toDataURL("image/jpeg", 0.93).split(",")[1];

  try {
    console.log("getExactCorners: calling Claude with crop", crop.width, "x", crop.height);
    const r = await fetch("/api/detect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-opus-4-6",
        max_tokens: 300,
        messages: [{ role: "user", content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 } },
          { type: "text", text: `This image shows a vehicle license plate. Return the exact 4 corner coordinates of the COMPLETE plate rectangle, including the blue EU identification strip on the left edge if present. The plate may appear as a trapezoid if the car is at an angle — account for any 3D perspective.
Return ONLY this JSON (no markdown, no explanation):
{"tl":{"x":F,"y":F},"tr":{"x":F,"y":F},"br":{"x":F,"y":F},"bl":{"x":F,"y":F}}
x = column / image width, y = row / image height (0.0 to 1.0). tl=top-left, tr=top-right, br=bottom-right, bl=bottom-left. Cover the full plate from leftmost to rightmost edge.` }
        ]}]
      })
    });
    const d = await r.json();
    console.log("getExactCorners: Claude raw response:", JSON.stringify(d));
    if (!d.content?.[0]?.text) { console.warn("getExactCorners: no text in response"); return null; }
    const txt = d.content[0].text;
    console.log("getExactCorners: Claude text:", txt);
    const raw = extractJSON(txt);
    if (!raw) { console.warn("getExactCorners: no JSON found in:", txt); return null; }
    const corners = JSON.parse(raw);
    console.log("getExactCorners: parsed corners:", corners);
    const pts = [corners.tl, corners.tr, corners.br, corners.bl];
    if (pts.some(p => !p || typeof p.x !== "number" || typeof p.y !== "number")) {
      console.warn("getExactCorners: invalid corners:", corners);
      return null;
    }
    // Map from crop space back to full image normalized space
    const mapped = {
      tl: { x: x0 + corners.tl.x * (x1 - x0), y: y0 + corners.tl.y * (y1 - y0) },
      tr: { x: x0 + corners.tr.x * (x1 - x0), y: y0 + corners.tr.y * (y1 - y0) },
      br: { x: x0 + corners.br.x * (x1 - x0), y: y0 + corners.br.y * (y1 - y0) },
      bl: { x: x0 + corners.bl.x * (x1 - x0), y: y0 + corners.bl.y * (y1 - y0) },
    };
    console.log("getExactCorners: mapped corners:", mapped);
    return mapped;
  } catch(e) {
    console.error("getExactCorners error:", e);
    return null;
  }
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

async function detectPlate(b64, imgW, imgH) {
  try {
    const r = await fetch("/api/platerecognizer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ b64, imgW, imgH }),
    });
    const data = await r.json();
    console.log("Plate detection:", data);
    return data;
  } catch(e) {
    console.error("detectPlate error:", e);
    return { found: false };
  }
}

async function processPhoto(photoFile, logoImg, adj) {
  const { b64, imgW, imgH } = await toBase64(photoFile);
  const plate = await detectPlate(b64, imgW, imgH);
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
  let plateFound = false;
  if (plate.found && logoImg) {
    plateFound = true;
    // Expand PR box left side to include EU blue strip (often missed by PR)
    const bw = plate.tr.x - plate.tl.x;
    const bh = plate.bl.y - plate.tl.y;
    const expanded = {
      found: true,
      tl: { x: Math.max(0, plate.tl.x - bw * 0.15), y: Math.max(0, plate.tl.y - bh * 0.05) },
      tr: { x: Math.min(1, plate.tr.x + bw * 0.03), y: Math.max(0, plate.tr.y - bh * 0.05) },
      br: { x: Math.min(1, plate.br.x + bw * 0.03), y: Math.min(1, plate.br.y + bh * 0.05) },
      bl: { x: Math.max(0, plate.bl.x - bw * 0.15), y: Math.min(1, plate.bl.y + bh * 0.05) },
    };
    // Refine bounding box into true perspective corners via Claude crop
    const refined = await getExactCorners(c, expanded);
    const corners = refined || expanded; // fallback to expanded PR rectangle if Claude fails
    console.log(refined ? "Using refined perspective corners" : "Using Plate Recognizer bounding box");
    const px = p => ({ x: p.x * c.width, y: p.y * c.height });
    const tl = px(corners.tl), tr = px(corners.tr), br = px(corners.br), bl = px(corners.bl);
    console.log(`Corners TL(${Math.round(tl.x)},${Math.round(tl.y)}) TR(${Math.round(tr.x)},${Math.round(tr.y)}) BR(${Math.round(br.x)},${Math.round(br.y)}) BL(${Math.round(bl.x)},${Math.round(bl.y)})`);
    drawPerspective(ctx, logoImg, tl, tr, br, bl);
  }
  return { name: photoFile.name, processed: c.toDataURL("image/jpeg", 0.93), plateFound };
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
  const [tab, setTab] = useState("setup");
  const [dragOver, setDragOver] = useState(null);
  const logoRef = useRef();
  const photosRef = useRef();

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

  const handleLogoFile = (f) => {
    if (!f?.type.startsWith("image/")) return;
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
    const logoImg = await loadImg(logo.preview);
    const all = [];
    for (let i = 0; i < photos.length; i++) {
      const r = await processPhoto(photos[i].file, logoImg, adjEnabled ? adj : { brightness: 1, contrast: 1, saturation: 1 });
      all.push(r);
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
                <div style={{ fontSize: 10, letterSpacing: 3, color: "#f26522", textTransform: "uppercase", marginBottom: 4, fontFamily: "'JetBrains Mono',monospace" }}>01 — Votre logo</div>
                <div style={{ fontSize: 10, color: "#444", marginBottom: 12, fontFamily: "'JetBrains Mono',monospace" }}>
                  {logo ? "✓ Logo chargé · cliquer pour changer" : "Chargez votre logo · PNG avec transparence recommandé"}
                </div>
                <div onDragOver={e => { e.preventDefault(); setDragOver("logo"); }} onDragLeave={() => setDragOver(null)}
                  onDrop={e => { e.preventDefault(); setDragOver(null); handleLogoFile(e.dataTransfer.files[0]); }}
                  onClick={() => logoRef.current?.click()}
                  style={{ border: `1px solid ${dragOver === "logo" ? "#f26522" : logo ? "#2a2a2a" : "#222"}`, borderRadius: 3, padding: 24, cursor: "pointer", minHeight: 150, display: "flex", alignItems: "center", justifyContent: "center", background: "#0f0f0f" }}>
                  {logo ? (
                    <div style={{ textAlign: "center" }}>
                      <img src={logo.preview} style={{ maxHeight: 90, maxWidth: "100%", objectFit: "contain" }} />
                      <div style={{ fontSize: 10, color: "#f26522", marginTop: 10 }}>Cliquer pour changer</div>
                    </div>
                  ) : (
                    <div style={{ textAlign: "center", color: "#333" }}>
                      <div style={{ fontSize: 36, marginBottom: 10 }}>⬡</div>
                      <div style={{ fontSize: 12, color: "#444" }}>Glisser votre logo ici</div>
                    </div>
                  )}
                </div>
                <input ref={logoRef} type="file" accept="image/*" style={{ display: "none" }} onChange={e => handleLogoFile(e.target.files[0])} />
              </section>

              <section>
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
                      <div style={{ position: "relative" }}>
                        <img src={r.processed} style={{ width: "100%", aspectRatio: "4/3", objectFit: "cover", display: "block" }} />
                        <div style={{ position: "absolute", top: 8, left: 8 }}>
                          <span style={{ background: r.plateFound ? "rgba(22,163,74,0.9)" : "rgba(220,38,38,0.9)", color: "#fff", fontSize: 8, padding: "3px 7px", borderRadius: 2, fontFamily: "'JetBrains Mono',monospace" }}>
                            {r.plateFound ? "✓ PLAQUE CACHÉE" : "⚠ NON DÉTECTÉE"}
                          </span>
                        </div>
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
    </div>
  );
}
