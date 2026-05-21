import { useState, useEffect, useRef } from "react";

/* ── FAQ content — edit freely ───────────────────────────────────────── */
const FAQ_ITEMS = [
  {
    q: "Comment fonctionne le cache plaque automatique ?",
    a: "L'IA détecte les plaques d'immatriculation sur chaque photo importée puis applique automatiquement votre cache plaque par-dessus, en respectant la perspective et l'inclinaison. Si le placement n'est pas parfait, vous pouvez utiliser le bouton AJUSTER dans la lightbox pour repositionner manuellement chacun des 4 coins.",
  },
  {
    q: "Quels formats de photos puis-je importer ?",
    a: "Les formats JPG, JPEG et PNG sont acceptés. Toutes les résolutions standards (smartphone, reflex) fonctionnent. Pour de meilleurs résultats, privilégiez des photos nettes en plein jour, avec la plaque bien visible.",
  },
  {
    q: "Combien de photos puis-je traiter avec mon abonnement ?",
    a: "Cela dépend de votre plan. Vous voyez votre compteur de crédits en haut à droite de l'application. Cliquez dessus pour accéder au détail de votre abonnement et à la date de renouvellement. Vous pouvez changer de plan à tout moment depuis Paramètres → Abonnement.",
  },
  {
    q: "Mes photos sont-elles stockées ou partagées ?",
    a: "Vos photos sont traitées de façon temporaire pour générer les visuels, puis automatiquement supprimées de nos serveurs. Aucune photo n'est conservée au-delà du traitement, et aucune donnée n'est partagée avec des tiers.",
  },
  {
    q: "Comment fonctionne le mode Showroom ?",
    a: "Activez l'option « Showroom Virtuel » dans la colonne de droite avant de lancer le traitement. L'IA détoure automatiquement le véhicule et le place sur un fond professionnel (Garage, Luxury, Classique…). Dans la lightbox, utilisez les flèches pour repositionner la voiture, le slider « Agrandir la taille » pour zoomer et « Fondre le véhicule au décor » pour harmoniser l'éclairage.",
  },
  {
    q: "Comment télécharger plusieurs photos en une seule fois ?",
    a: "Une fois le traitement terminé, ouvrez l'onglet Résultats. Vous y trouverez un bouton « Tout télécharger » qui regroupe l'ensemble des visuels dans une archive ZIP unique, prête à être partagée à votre client.",
  },
];

/* ── Help widget — fixed bottom-left help button with popover menu ──── */
export default function HelpWidget({ onOpenTutorial, onOpenContact, hidden = false, isMobile = false }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [faqOpen,  setFaqOpen]  = useState(false);
  const [expanded, setExpanded] = useState(null); // currently expanded FAQ index
  const containerRef = useRef(null);

  /* Close menu on outside-click */
  useEffect(() => {
    if (!menuOpen) return;
    const onDocClick = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) setMenuOpen(false);
    };
    window.addEventListener("mousedown", onDocClick);
    window.addEventListener("touchstart", onDocClick);
    return () => {
      window.removeEventListener("mousedown", onDocClick);
      window.removeEventListener("touchstart", onDocClick);
    };
  }, [menuOpen]);

  /* ESC closes menus */
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") { setMenuOpen(false); setFaqOpen(false); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (hidden) return null;

  const items = [
    {
      icon: "📖",
      label: "Revoir le didacticiel",
      action: () => { setMenuOpen(false); onOpenTutorial?.(); },
    },
    {
      icon: "❔",
      label: "FAQ",
      action: () => { setMenuOpen(false); setFaqOpen(true); },
    },
    {
      icon: "✉",
      label: "Nous contacter",
      action: () => { setMenuOpen(false); onOpenContact?.(); },
    },
  ];

  return (
    <>
      {/* ── Floating button + popover (bottom-left) ───────────────────── */}
      <div
        ref={containerRef}
        style={{
          position: "fixed",
          bottom: isMobile ? 16 : 22,
          right:  isMobile ? 16 : 22,
          zIndex: 1500,
          fontFamily: "'Rajdhani', sans-serif",
        }}
      >
        {/* Popover menu */}
        {menuOpen && (
          <div
            style={{
              position: "absolute",
              bottom: 52,
              right: 0,
              background: "#141414",
              border: "1px solid #2a2a2a",
              borderRadius: 4,
              minWidth: 220,
              boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
              overflow: "hidden",
            }}
          >
            {items.map((item, i) => (
              <button
                key={i}
                onClick={item.action}
                style={{
                  display: "flex", alignItems: "center", gap: 10, width: "100%",
                  padding: "11px 16px", background: "transparent", border: "none",
                  color: "#ddd", cursor: "pointer", fontFamily: "'Rajdhani',sans-serif",
                  fontSize: 13, fontWeight: 600, letterSpacing: 1, textAlign: "left",
                  borderBottom: i < items.length - 1 ? "1px solid #1a1a1a" : "none",
                  transition: "background 0.12s",
                }}
                onMouseEnter={e => e.currentTarget.style.background = "#1a1a1a"}
                onMouseLeave={e => e.currentTarget.style.background = "transparent"}
              >
                <span style={{ fontSize: 15, width: 20, textAlign: "center" }}>{item.icon}</span>
                {item.label}
              </button>
            ))}
          </div>
        )}

        {/* The orange "?" button */}
        <button
          onClick={() => setMenuOpen(o => !o)}
          aria-label="Aide"
          title="Aide"
          style={{
            width:  isMobile ? 38 : 42,
            height: isMobile ? 38 : 42,
            borderRadius: "50%",
            background: "#f26522",
            border: menuOpen ? "2px solid #fff" : "2px solid rgba(255,255,255,0.15)",
            color: "#fff",
            fontSize: isMobile ? 21 : 23,
            fontWeight: 700,
            cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: "0 4px 16px rgba(242,101,34,0.45), 0 2px 6px rgba(0,0,0,0.6)",
            fontFamily: "'Rajdhani', sans-serif",
            lineHeight: 1,
            padding: 0,
            transition: "transform 0.15s ease, box-shadow 0.15s ease",
            transform: menuOpen ? "scale(1.08)" : "scale(1)",
          }}
          onMouseEnter={e => e.currentTarget.style.transform = "scale(1.08)"}
          onMouseLeave={e => e.currentTarget.style.transform = menuOpen ? "scale(1.08)" : "scale(1)"}
        >
          ?
        </button>
      </div>

      {/* ── FAQ Modal ────────────────────────────────────────────────── */}
      {faqOpen && (
        <div
          onClick={() => setFaqOpen(false)}
          style={{
            position: "fixed", inset: 0,
            background: "rgba(0,0,0,0.82)",
            zIndex: 9000,
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: isMobile ? 12 : 20,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: "#111", border: "1px solid #222", borderRadius: 6,
              width: "100%", maxWidth: 640,
              maxHeight: "90vh",
              display: "flex", flexDirection: "column",
              fontFamily: "'Rajdhani', sans-serif",
            }}
          >
            {/* Header */}
            <div
              style={{
                padding: "20px 24px 16px",
                borderBottom: "1px solid #1c1c1c",
                display: "flex", alignItems: "center", justifyContent: "space-between",
              }}
            >
              <div>
                <div style={{ fontSize: 12, letterSpacing: 3, color: "#f26522", textTransform: "uppercase", fontFamily: "'JetBrains Mono',monospace", marginBottom: 4 }}>
                  FAQ
                </div>
                <div style={{ fontSize: 14, color: "#ddd" }}>Questions fréquentes</div>
              </div>
              <button
                onClick={() => setFaqOpen(false)}
                style={{ background: "none", border: "none", color: "#ddd", fontSize: 21, cursor: "pointer", lineHeight: 1 }}
                title="Fermer"
              >
                ✕
              </button>
            </div>

            {/* Body — accordion */}
            <div style={{ overflowY: "auto", padding: "8px 0" }}>
              {FAQ_ITEMS.map((item, i) => {
                const open = expanded === i;
                return (
                  <div key={i} style={{ borderBottom: i < FAQ_ITEMS.length - 1 ? "1px solid #161616" : "none" }}>
                    <button
                      onClick={() => setExpanded(open ? null : i)}
                      style={{
                        width: "100%",
                        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16,
                        padding: "16px 24px",
                        background: "transparent", border: "none",
                        textAlign: "left", cursor: "pointer",
                        fontFamily: "'Rajdhani', sans-serif",
                        transition: "background 0.12s",
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = "#161616"}
                      onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                    >
                      <span style={{ fontSize: 15, fontWeight: 600, color: open ? "#f26522" : "#ddd5c8", letterSpacing: 0.3 }}>
                        {item.q}
                      </span>
                      <span style={{
                        fontSize: 15, color: open ? "#f26522" : "#666",
                        flexShrink: 0,
                        transform: open ? "rotate(45deg)" : "rotate(0)",
                        transition: "transform 0.2s ease",
                        fontFamily: "'JetBrains Mono', monospace",
                      }}>
                        +
                      </span>
                    </button>
                    {open && (
                      <div style={{
                        padding: "0 24px 18px",
                        fontSize: 14,
                        color: "#ddd",
                        lineHeight: 1.7,
                      }}>
                        {item.a}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
