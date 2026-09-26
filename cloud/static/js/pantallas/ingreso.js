// Ingresar, crear cuenta, "olvidé mi contraseña", contraseña nueva (link del
// mail) y verificación de email. Son <form> de verdad, con autocomplete: así el
// navegador y los gestores de contraseñas los reconocen.
import { api, sesion, pendiente, iniciarSesion, perfil, actualizarUsuario, olvidarPerfil, olvidarMisResultados } from "../nucleo/api.js";
import { esc } from "../nucleo/formato.js";
import { registrar } from "../ui/acciones.js";
import { $, campoContrasena, ocupado, toast, cargando } from "../ui/componentes.js";
import { ic } from "../ui/iconos.js";
import { ir } from "../ui/navegar.js";

const EMAIL_OK = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
let _volver = "";

export function mostrar(ctx) {
  _volver = ctx.query.get("volver") || "";
  if (ctx.clave === "ingresar" || ctx.clave === "crear-cuenta") {
    if (sesion.token) { ir("#/"); return; }
    return formularioCuenta(ctx, ctx.clave === "crear-cuenta");
  }
  if (ctx.clave === "olvide") return olvide(ctx);
  if (ctx.clave === "nueva-contrasena") return nuevaContrasena(ctx);
  if (ctx.clave === "verificar") return verificar(ctx);
}

const avisoError = (id, msg) => { $(id).innerHTML = `<div class="err">${esc(msg)}</div>`; };

async function entrar(d, mensaje) {
  iniciarSesion(d);
  try {
    const p = await perfil();
    actualizarUsuario({ is_admin: !!p.is_admin, full_name: p.full_name || d.full_name });
  } catch { /* se reintenta en cada vista */ }
  document.dispatchEvent(new CustomEvent("sesion-cambiada"));
  ir(_volver ? `#/${_volver}` : "#/");
  if (mensaje) toast(mensaje);
}

// ── Ingresar / crear cuenta ──────────────────────────────────────────────────
function formularioCuenta(ctx, registro) {
  const volverQs = _volver ? `?volver=${encodeURIComponent(_volver)}` : "";
  ctx.app.innerHTML = `
    <div class="auth-box">
      <h1>${registro ? `Crear <span class="accent">cuenta</span>` : "Ingresar"}</h1>
      <p class="sub">${registro ? "Guardá tus resultados y seguí tu progreso." : "Accedé a tu historial de carreras."}</p>
      <form class="card" data-submit="${registro ? "registrarme" : "ingresar"}" novalidate>
        <div id="amsg" role="alert"></div>
        ${registro ? `<div class="field"><label for="fn">Nombre y apellido</label>
          <input type="text" id="fn" name="fn" autocomplete="name" required>
          <p class="field-hint">Como figura en las carreras: así reconocemos tus resultados.</p></div>` : ""}
        <div class="field"><label for="em">Email</label>
          <input type="email" id="em" name="em" autocomplete="email" inputmode="email" autocapitalize="off" spellcheck="false" required></div>
        ${campoContrasena({
          id: "pw", etiqueta: "Contraseña",
          autocomplete: registro ? "new-password" : "current-password",
          placeholder: registro ? "Mínimo 8 caracteres" : "",
          medidor: registro,
          pista: registro ? "" : `<div class="forgot-row"><a class="btn-link" href="#/olvide">¿Olvidaste tu contraseña?</a></div>`,
        })}
        <button class="btn grad" type="submit">${registro ? "Crear cuenta" : "Ingresar"}</button>
        <div class="auth-divider">o</div>
        <button type="button" class="btn google" data-act="google">${ic("google")}Continuar con Google</button>
        <p class="auth-foot muted">${registro
          ? `¿Ya tenés cuenta? <a class="lnk" href="#/ingresar${volverQs}">Ingresá</a>`
          : `¿Sos nuevo? <a class="lnk" href="#/crear-cuenta${volverQs}">Creá tu cuenta</a>`}</p>
      </form>
    </div>`;
  $(registro ? "fn" : "em").focus();
}

async function enviarCuenta(form, registro) {
  const email = form.em.value.trim(), pw = form.pw.value;
  const nombre = registro ? form.fn.value.trim() : null;
  $("amsg").innerHTML = "";
  if (registro && !nombre) return avisoError("amsg", "Escribí tu nombre y apellido.");
  if (!email) return avisoError("amsg", "Escribí tu email.");
  if (!EMAIL_OK.test(email)) return avisoError("amsg", "El email no tiene un formato válido (por ejemplo, vos@email.com).");
  if (!pw) return avisoError("amsg", "Escribí tu contraseña.");
  if (registro && pw.length < 8) return avisoError("amsg", "La contraseña tiene que tener al menos 8 caracteres.");
  const restaurar = ocupado(form.querySelector("[type=submit]"), registro ? "Creando…" : "Ingresando…");
  try {
    const d = registro
      ? await api("POST", "/api/auth/register", { email, password: pw, full_name: nombre })
      : await api("POST", "/api/auth/login", { email, password: pw });
    await entrar(d, registro
      ? "Listo. Te mandamos un mail para verificar tu email."
      : (d.linked > 0 ? `Sumamos ${d.linked} ${d.linked === 1 ? "resultado" : "resultados"} a tu perfil.` : ""));
  } catch (e) {
    restaurar();
    avisoError("amsg", e.message);
  }
}

// ── Olvidé mi contraseña ─────────────────────────────────────────────────────
function olvide(ctx) {
  ctx.app.innerHTML = `
    <div class="auth-box">
      <h1>Recuperar <span class="accent">contraseña</span></h1>
      <p class="sub">Te mandamos un link para elegir una nueva.</p>
      <form class="card" id="fgCard" data-submit="pedirLink" novalidate>
        <div id="fgMsg" role="alert"></div>
        <div class="field"><label for="fgEm">Email de tu cuenta</label>
          <input type="email" id="fgEm" name="fgEm" autocomplete="email" inputmode="email" autocapitalize="off"
            value="${esc(ctx.query.get("email") || "")}" required></div>
        <button class="btn grad" type="submit">Mandarme el link</button>
        <p class="auth-foot"><a class="btn-link" href="#/ingresar">Volver a ingresar</a></p>
      </form>
    </div>`;
  $("fgEm").focus();
}

// ── Contraseña nueva (link del mail) ─────────────────────────────────────────
function nuevaContrasena(ctx) {
  if (!pendiente.reset) {
    ctx.app.innerHTML = `<div class="auth-box"><h1>Contraseña nueva</h1>
      <div class="card"><p class="muted" style="margin-bottom:14px">Este link ya se usó o no es válido. Pedí uno nuevo.</p>
      <a class="btn grad" href="#/olvide">Pedir otro link</a></div></div>`;
    return;
  }
  ctx.app.innerHTML = `
    <div class="auth-box">
      <h1>Contraseña <span class="accent">nueva</span></h1>
      <p class="sub">Al cambiarla cerramos las sesiones abiertas en todos tus dispositivos.</p>
      <form class="card" data-submit="guardarNueva" novalidate>
        <div id="rsMsg" role="alert"></div>
        ${campoContrasena({ id: "rsPw", etiqueta: "Contraseña nueva", autocomplete: "new-password", placeholder: "Mínimo 8 caracteres", medidor: true })}
        ${campoContrasena({ id: "rsRep", etiqueta: "Repetila", autocomplete: "new-password" })}
        <button class="btn grad" type="submit">Guardar contraseña</button>
      </form>
    </div>`;
  $("rsPw").focus();
}

// ── Verificación de email ────────────────────────────────────────────────────
async function verificar(ctx) {
  ctx.app.innerHTML = `
    <div class="auth-box">
      <h1>Verificar <span class="accent">email</span></h1>
      <div class="card" id="vfCard">${cargando("Verificando…")}</div>
    </div>`;
  if (!pendiente.verificar) {
    $("vfCard").innerHTML = `<p class="muted">Este link ya se usó o no es válido.
      ${sesion.token ? "Podés pedir otro desde tu inicio." : "Ingresá a tu cuenta y pedí otro desde el inicio."}</p>`;
    return;
  }
  await confirmarVerificacion(null);
}

// Sin la sesión de esa cuenta, el servidor pide la contraseña: el link solo
// prueba el buzón, y así nadie verifica una cuenta que otro creó con su email.
async function confirmarVerificacion(password) {
  const card = $("vfCard");
  if (!card) return;
  try {
    const d = await api("POST", "/api/auth/verify", { token: pendiente.verificar, password },
                        { auth: true, expira: false });
    pendiente.verificar = null;
    // El perfil y los resultados en memoria son de antes de verificar.
    olvidarPerfil();
    olvidarMisResultados();
    const sumados = d.linked > 0 ? ` Sumamos ${d.linked} ${d.linked === 1 ? "resultado" : "resultados"} a tu perfil.` : "";
    card.innerHTML = `<div class="ok">Listo, verificamos <b>${esc(d.email)}</b>.${esc(sumados)}</div>
      <a class="btn grad" href="${sesion.token ? "#/" : "#/ingresar"}">${sesion.token ? "Ir a mi inicio" : "Ingresar"}</a>`;
  } catch (e) {
    if (e.status === 401) {
      card.innerHTML = `
        <form data-submit="verificarConClave" novalidate>
          <p class="muted" style="margin-bottom:14px">Para confirmar que la cuenta es tuya, escribí su contraseña.</p>
          ${password ? `<div class="err">${esc(e.message)}</div>` : ""}
          ${campoContrasena({ id: "vfPass", etiqueta: "Contraseña", autocomplete: "current-password" })}
          <button class="btn grad" type="submit">Confirmar</button>
          <p class="muted" style="margin-top:14px">¿No creaste esta cuenta? No confirmes nada: si alguien la creó
            con tu email, entrá con Google y la cuenta pasa a ser tuya.</p>
        </form>`;
      $("vfPass").focus();
      return;
    }
    card.innerHTML = `<div class="err">${esc(e.message)}</div>
      <p class="muted">${sesion.token ? "Pedí un link nuevo desde tu inicio." : "Ingresá a tu cuenta y pedí un link nuevo desde el inicio."}</p>`;
  }
}

registrar({
  ingresar: (form) => enviarCuenta(form, false),
  registrarme: (form) => enviarCuenta(form, true),
  google() {
    // Mismo flujo del servidor que la app. Vuelve a / con ?token=.
    location.href = "/api/run/auth/google/start?app_redirect=" + encodeURIComponent(location.origin + "/");
  },
  async pedirLink(form) {
    const email = form.fgEm.value.trim();
    if (!EMAIL_OK.test(email)) return avisoError("fgMsg", "Escribí un email válido (por ejemplo, vos@email.com).");
    const restaurar = ocupado(form.querySelector("[type=submit]"), "Enviando…");
    try {
      const d = await api("POST", "/api/auth/password/forgot", { email });
      $("fgCard").innerHTML = `<div class="ok">${esc(d.message)}</div>
        <a class="btn ghost" href="#/ingresar">Volver a ingresar</a>`;
    } catch (e) {
      restaurar();
      avisoError("fgMsg", e.message);
    }
  },
  async guardarNueva(form) {
    const nueva = form.rsPw.value, rep = form.rsRep.value;
    $("rsMsg").innerHTML = "";
    if (nueva.length < 8) return avisoError("rsMsg", "La contraseña tiene que tener al menos 8 caracteres.");
    if (nueva !== rep) return avisoError("rsMsg", "Las dos contraseñas no coinciden.");
    const restaurar = ocupado(form.querySelector("[type=submit]"), "Guardando…");
    try {
      const d = await api("POST", "/api/auth/password/reset", { token: pendiente.reset, new_password: nueva });
      pendiente.reset = null;
      await entrar(d, "Listo, cambiaste tu contraseña.");
    } catch (e) {
      restaurar();
      $("rsMsg").innerHTML = `<div class="err">${esc(e.message)} <a class="btn-link" href="#/olvide">Pedir otro link</a></div>`;
    }
  },
  verificarConClave(form) {
    const v = form.vfPass.value;
    if (!v) { form.vfPass.focus(); return; }
    ocupado(form.querySelector("[type=submit]"), "Confirmando…");
    confirmarVerificacion(v);
  },
});
