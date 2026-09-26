// Acciones de la cuenta que aparecen en varias pantallas (inicio, historial,
// mi cuenta): buscar resultados por email y reenviar la verificación.
import { api, olvidarMisResultados } from "../nucleo/api.js";
import { registrar } from "./acciones.js";
import { ocupado, toast } from "./componentes.js";
import { redibujar } from "./navegar.js";

registrar({
  /** Vincula al perfil lo publicado con el email de la cuenta. */
  async buscarPorEmail(btn) {
    const restaurar = ocupado(btn, "Buscando…");
    try {
      const d = await api("POST", "/api/me/autolink", null, { auth: true });
      restaurar();
      if (d.email_verified === false) {
        toast("Primero verificá tu email: te mandamos un link cuando creaste la cuenta.", "warn");
      } else if (d.linked > 0) {
        olvidarMisResultados();
        toast(`Sumamos ${d.linked} ${d.linked === 1 ? "resultado" : "resultados"} a tu perfil.`);
        redibujar();
      } else {
        toast("No encontramos resultados nuevos con tu email.", "warn");
      }
    } catch (e) {
      restaurar();
      toast(e.message, "warn");
    }
  },

  async reenviarVerificacion(btn) {
    const restaurar = ocupado(btn, "Enviando…");
    try {
      const d = await api("POST", "/api/auth/verify/send", null, { auth: true });
      if (d.email_verified) {
        toast("Tu email ya está verificado.");
        const aviso = btn.closest("[data-aviso]");
        if (aviso) aviso.remove();
        return;
      }
      toast("Te mandamos el mail. Revisá también el correo no deseado.");
      btn.textContent = "Mail enviado";
    } catch (e) {
      restaurar();
      toast(e.message, "warn");
    }
  },
});
