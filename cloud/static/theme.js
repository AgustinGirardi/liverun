// Aplica el tema guardado antes de pintar (evita el destello del tema equivocado).
// Va en un archivo aparte y no inline: la CSP no permite scripts en línea.
try {
  document.documentElement.setAttribute("data-theme", localStorage.getItem("ct_theme") === "light" ? "light" : "dark");
} catch (e) {
  document.documentElement.setAttribute("data-theme", "dark");
}
