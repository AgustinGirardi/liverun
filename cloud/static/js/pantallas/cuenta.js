// Mi cuenta: datos, suscripción, contraseña y eliminar la cuenta.
import { api, sesion, perfil, olvidarPerfil, reemplazarToken, cerrarSesion } from "../nucleo/api.js";
import { esc, fmtFecha } from "../nucleo/formato.js";
import { registrar } from "../ui/acciones.js";
import { $, campoContrasena, ocupado, toast, cargando, errorHtml, abrirHoja, encabezadoHoja, cerrarHoja } from "../ui/componentes.js";
import { ic } from "../ui/iconos.js";
import { ir, redibujar } from "../ui/navegar.js";
import "../ui/acciones-cuenta.js";

// Un premium que vence en más de 20 años es el "ilimitado" que da un admin.
const ILIMITADO_MS = 20 * 365 * 86400000;

export async function mostrar(ctx) {
  ctx.app.innerHTML = `
    <h1>Mi <span class="accent">cuenta</span></h1>
    <p class="sub">${esc((sesion.usuario && sesion.usuario.email) || "")}</p>
    <div id="cuentaBody">${cargando()}</div>`;
  let p;
  try {
    p = await perfil({ fresco: true });
  } catch (e) {
    if (ctx.vigente()) $("cuentaBody").innerHTML = errorHtml(e.message);
    return;
  }
  if (!ctx.vigente()) return;

  $("cuentaBody").innerHTML = `
    ${p.email_verified === false ? `<div class="card subcard sub-warn" data-aviso>
      <div><div class="t">Tu email no está verificado</div>
        <div class="muted">Verificalo para que tus resultados se vinculen solos.</div></div>
      <button type="button" class="btn ghost sm" data-act="reenviarVerificacion">${ic("mail")}Reenviar mail</button>
    </div>` : ""}
    ${tarjetaPlan(p)}
    ${tarjetaContrasena(p)}
    <section class="card" aria-labelledby="tBorrar">
      <h2 id="tBorrar">Eliminar la cuenta</h2>
      <p class="muted" style="margin-bottom:14px">Se borran para siempre tus resultados guardados, tus salidas de la app
        y tus amigos. Los resultados oficiales que publicó el organizador no cambian.</p>
      <button type="button" class="btn danger sm" data-act="confirmarBorrado">Eliminar mi cuenta</button>
    </section>`;
}

function tarjetaPlan(p) {
  if (p.plan === "admin") {
    return `<section class="card subcard"><div><div class="t">${ic("estrella")} Cuenta de administración</div>
      <div class="muted">Acceso completo, sin vencimiento.</div></div>
      <a class="btn ghost sm" href="#/admin">${ic("ajustes")}Administración</a></section>`;
  }
  const dias = (iso) => (iso ? Math.ceil((new Date(iso) - Date.now()) / 86400000) : null);
  if (p.plan === "premium") {
    const hasta = p.premium_until ? new Date(p.premium_until) : null;
    const ilimitado = hasta && hasta - Date.now() > ILIMITADO_MS;
    return `<section class="card subcard"><div><div class="t">${ic("estrella")} Premium activo</div>
      <div class="muted">${ilimitado ? "Sin vencimiento." : hasta ? `Hasta el ${esc(fmtFecha(p.premium_until.slice(0, 10)))}.` : "Suscripción activa."}</div></div></section>`;
  }
  if (p.plan === "trial") {
    const d = dias(p.trial_ends_at);
    return `<section class="card subcard${d != null && d <= 7 ? " sub-warn" : ""}"><div><div class="t">Prueba gratis de LiveRun</div>
      <div class="muted">${d != null ? `Te ${d === 1 ? "queda 1 día" : `quedan ${d} días`} de prueba.` : "Estás en tu prueba gratis."}</div></div>
      <button type="button" class="btn grad sm" data-act="abrirPremium">${ic("estrella")}Hacerme premium</button></section>`;
  }
  return `<section class="card subcard sub-warn"><div><div class="t">Tu prueba gratis terminó</div>
    <div class="muted">Tus salidas y tus carreras siguen guardadas. Premium suma avisos de voz, tarjetas para compartir y el ranking mundial.</div></div>
    <button type="button" class="btn grad sm" data-act="abrirPremium">${ic("estrella")}Hacerme premium</button></section>`;
}

function tarjetaContrasena(p) {
  // has_password: true (la eligió) / false (entra solo con Google) / null (no se sabe).
  if (p.has_password === false) {
    return `<section class="card" aria-labelledby="tPw">
      <h2 id="tPw">Crear una contraseña</h2>
      <p class="muted" style="margin-bottom:14px">Entrás con Google. Si querés, elegí una contraseña para entrar también con tu email.</p>
      <form data-submit="cambiarContrasena" data-crear novalidate>
        <div id="pwMsg" role="alert"></div>
        <input type="email" name="usuario" autocomplete="username" value="${esc(p.email)}" hidden>
        ${campoContrasena({ id: "pwNew", etiqueta: "Contraseña", autocomplete: "new-password", placeholder: "Mínimo 8 caracteres", medidor: true })}
        ${campoContrasena({ id: "pwRep", etiqueta: "Repetila", autocomplete: "new-password" })}
        <button class="btn grad" type="submit">Crear contraseña</button>
      </form>
    </section>`;
  }
  const google = p.has_password == null ? `<p class="notice">¿Entrás con Google y nunca elegiste una contraseña?
      <button type="button" class="btn-link" data-act="linkContrasena">Mandame un link para crearla</button></p>` : "";
  return `<section class="card" aria-labelledby="tPw">
    <h2 id="tPw">Contraseña</h2>
    <p class="muted" style="margin-bottom:14px">Al cambiarla cerramos las sesiones abiertas en otros dispositivos. Esta queda abierta.</p>
    ${google}
    <form data-submit="cambiarContrasena" novalidate>
      <div id="pwMsg" role="alert"></div>
      <input type="email" name="usuario" autocomplete="username" value="${esc(p.email)}" hidden>
      ${campoContrasena({ id: "pwCur", etiqueta: "Contraseña actual", autocomplete: "current-password" })}
      ${campoContrasena({ id: "pwNew", etiqueta: "Contraseña nueva", autocomplete: "new-password", placeholder: "Mínimo 8 caracteres", medidor: true })}
      ${campoContrasena({ id: "pwRep", etiqueta: "Repetí la nueva", autocomplete: "new-password" })}
      <button class="btn grad" type="submit">Cambiar contraseña</button>
    </form>
  </section>`;
}

// ── Hoja de premium (Mercado Pago) ───────────────────────────────────────────
const precio = (n) => `$ ${Math.round(n).toLocaleString("es-AR")}`;

async function abrirPremium() {
  abrirHoja(`${encabezadoHoja("LiveRun Premium")}<div id="premBody">${cargando("Consultando el precio…")}</div>`);
  let info;
  try {
    info = await api("GET", "/api/run/billing/info", null, { auth: true });
  } catch (e) {
    const b = $("premBody"); if (b) b.innerHTML = errorHtml(e.message, false);
    return;
  }
  const b = $("premBody");
  if (!b) return;
  if (!info.available) {
    b.innerHTML = `<p class="muted">El pago todavía no está habilitado. Te avisamos cuando lo esté.</p>`;
    return;
  }
  const conDescuento = info.discount_percent && info.price < info.base_price;
  b.innerHTML = `
    <div class="price">${precio(info.price)} <small>por mes</small></div>
    ${conDescuento ? `<div class="price-was">${precio(info.base_price)}</div>
      <p class="pill green" style="margin-top:6px">${info.discount_percent}% de descuento en el primer pago</p>` : ""}
    <ul class="sheet-list">
      <li>${ic("check")}Avisos de voz en cada kilómetro</li>
      <li>${ic("check")}Tarjetas para compartir tus salidas</li>
      <li>${ic("check")}Ranking mundial (el de amigos es gratis)</li>
    </ul>
    <details class="coupon">
      <summary>Tengo un cupón</summary>
      <form class="coupon-row" data-submit="canjearCupon" novalidate>
        <label for="cupon" class="sr-only">Código del cupón</label>
        <input id="cupon" name="cupon" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="CÓDIGO">
        <button type="submit" class="btn ghost sm">Aplicar</button>
      </form>
    </details>
    <p class="sheet-fine">Se cobra con Mercado Pago todos los meses. Lo cancelás cuando quieras desde Mercado Pago.</p>
    <button type="button" class="btn grad" data-act="pagarPremium">Pagar con Mercado Pago</button>`;
}

registrar({
  abrirPremium,
  async canjearCupon(form) {
    const codigo = form.cupon.value.trim().toUpperCase();
    if (!codigo) { form.cupon.focus(); return; }
    const restaurar = ocupado(form.querySelector("[type=submit]"), "Aplicando…");
    try {
      const d = await api("POST", "/api/run/coupons/redeem", { code: codigo }, { auth: true });
      toast(d.message);
      olvidarPerfil();
      if (d.kind === "free_months") { cerrarHoja(); redibujar(); }
      else abrirPremium();   // descuento: se ve el precio nuevo
    } catch (e) {
      restaurar();
      toast(e.message, "warn");
    }
  },
  async pagarPremium(btn) {
    const restaurar = ocupado(btn, "Abriendo Mercado Pago…");
    try {
      const d = await api("POST", "/api/run/billing/subscribe", null, { auth: true });
      location.href = d.init_point;
    } catch (e) {
      restaurar();
      toast(e.message, "warn");
    }
  },

  async cambiarContrasena(form) {
    const crear = form.hasAttribute("data-crear");
    const actual = crear ? null : form.pwCur.value;
    const nueva = form.pwNew.value, rep = form.pwRep.value;
    const error = (m) => { $("pwMsg").innerHTML = `<div class="err">${esc(m)}</div>`; };
    $("pwMsg").innerHTML = "";
    if (!crear && !actual) return error("Escribí tu contraseña actual.");
    if (nueva.length < 8) return error("La contraseña nueva tiene que tener al menos 8 caracteres.");
    if (!crear && nueva === actual) return error("La contraseña nueva tiene que ser distinta de la actual.");
    if (nueva !== rep) return error("Las dos contraseñas nuevas no coinciden.");
    const restaurar = ocupado(form.querySelector("[type=submit]"), "Guardando…");
    try {
      const cuerpo = crear ? { new_password: nueva } : { current_password: actual, new_password: nueva };
      const d = await api("POST", "/api/auth/password", cuerpo, { auth: true });
      reemplazarToken(d.token);
      olvidarPerfil();
      toast(crear ? "Listo, ya podés entrar también con tu email y esta contraseña."
                  : "Contraseña cambiada. Cerramos las sesiones de otros dispositivos.");
      redibujar();
    } catch (e) {
      restaurar();
      error(e.message);
    }
  },
  async linkContrasena(btn) {
    const restaurar = ocupado(btn, "Enviando…");
    try {
      const d = await api("POST", "/api/auth/password/forgot", { email: sesion.usuario.email });
      toast(d.message || "Te mandamos el link.");
      btn.textContent = "Link enviado";
    } catch (e) {
      restaurar();
      toast(e.message, "warn");
    }
  },

  confirmarBorrado() {
    abrirHoja(`${encabezadoHoja("¿Eliminar tu cuenta?")}
      <p class="muted">Se borran para siempre tus resultados guardados, tus salidas de la app y tus amigos.
        Si tenés una suscripción, la cancelamos. <b>No se puede deshacer.</b></p>
      <div class="sheet-actions">
        <button type="button" class="btn danger" data-act="borrarCuenta">Sí, eliminar definitivamente</button>
        <button type="button" class="btn ghost" data-act="cerrarHoja" autofocus>Cancelar</button>
      </div>`);
  },
  async borrarCuenta(btn) {
    const restaurar = ocupado(btn, "Eliminando…");
    try {
      await api("DELETE", "/api/auth/account", null, { auth: true });
      cerrarHoja();
      cerrarSesion();
      document.dispatchEvent(new CustomEvent("sesion-cambiada"));
      toast("Eliminamos tu cuenta. Gracias por correr con nosotros.");
      ir("#/");
    } catch (e) {
      restaurar();
      toast(e.message, "warn");
    }
  },
});
