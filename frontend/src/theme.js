// ── Tokens de marca — Dirección A "Pista nocturna" ──────────────────────────────
// Fuente de verdad de color/tipografía/radios. Los CSS vars equivalentes viven en
// index.css (:root); estas constantes JS son para los estilos inline de React.
export const C = {
  bg: "#0d0f10", surface: "#141618", surface2: "#1c1f21",
  line: "#262b2e", lineStrong: "#363b3f",
  fg: "#e8eaeb", muted: "#9aa1a7", faint: "#868e94",
  accent: "#00e5a0", accent2: "#00bf85", onAccent: "#06281d",
  blue: "#4d9fff", gold: "#f5a623", danger: "#ff4d4d",
}

// Podio: plata y bronce (el oro es C.gold)
export const SILVER = "#aabbcc"

export const BRONZE = "#cd7c4a"

export const FONT_DISPLAY = 'ui-rounded, "SF Pro Rounded", "Segoe UI", system-ui, sans-serif'

export const FONT_NUM = { fontVariantNumeric: "tabular-nums", fontFeatureSettings: '"tnum" 1' }

export const RADIUS = { card: 16, hero: 20, pill: 999, sm: 8 }

// ── Estilos compartidos ───────────────────────────────────────────────────────

export const INPUT = {
  background: C.surface2, border: `1px solid ${C.lineStrong}`, borderRadius: RADIUS.sm,
  padding: "8px 12px", color: C.fg, fontSize: 13, outline: "none", width: "100%",
}

export const BTN_PRIMARY = {
  padding: "8px 18px", background: C.accent, border: "none",
  borderRadius: RADIUS.pill, cursor: "pointer", fontWeight: 800, fontSize: 12,
  color: C.onAccent, fontFamily: FONT_DISPLAY, letterSpacing: 0.2,
}

export const BTN_GHOST = {
  padding: "8px 14px", background: "transparent", border: `1px solid ${C.lineStrong}`,
  borderRadius: RADIUS.pill, cursor: "pointer", color: C.muted, fontSize: 12, fontWeight: 600,
}

export const BTN_DANGER = {
  padding: "4px 8px", background: "transparent", border: `1px solid ${C.line}`,
  borderRadius: RADIUS.sm, cursor: "pointer", color: C.danger, fontSize: 11,
}

export const CARD = {
  background: C.surface, border: `1px solid ${C.line}`, borderRadius: RADIUS.card, padding: 16,
}

// Botón con ícono + texto alineados.
export const WITH_ICON = { display: "inline-flex", alignItems: "center", gap: 6 }
