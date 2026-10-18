// Administración (solo cuentas is_admin): usuarios, premium y cupones.
import { api, sesion, perfil } from "../nucleo/api.js";
import { esc, fmtFecha } from "../nucleo/formato.js";
import { registrar } from "../ui/acciones.js";
import { $, cargando, errorHtml, vacio, toast, ocupado } from "../ui/componentes.js";
import { ic } from "../ui/iconos.js";
import { ir } from "../ui/navegar.js";

let _pestana = "usuarios";

export async function mostrar(ctx) {
  let esAdmin = !!(sesion.usuario && sesion.usuario.is_admin);
  if (!esAdmin) {
    try { esAdmin = !!(await perfil({ fresco: true })).is_admin; } catch { /* no */ }
  }
  if (!ctx.vigente()) return;
  if (!esAdmin) { ir("#/"); return; }

  ctx.app.innerHTML = `
    <h1>Administración</h1>
    <p class="sub">Usuarios, pruebas, premium y cupones.</p>
    <div class="tabbar" role="group" aria-label="Sección">
      <button type="button" data-act="pestanaAdmin" data-p="usuarios" aria-pressed="${_pestana === "usuarios"}">Usuarios</button>
      <button type="button" data-act="pestanaAdmin" data-p="cupones" aria-pressed="${_pestana === "cupones"}">Cupones</button>
    </div>
    <div id="adminBody"></div>`;
  pintarPestana();
}

function pintarPestana() {
  document.querySelectorAll("[data-act=pestanaAdmin]").forEach((b) =>
    b.setAttribute("aria-pressed", String(b.dataset.p === _pestana)));
  if (_pestana === "cupones") return cupones();
  $("adminBody").innerHTML = `
    <div id="adminStats" class="stats"></div>
    <form class="race-filter" role="search" data-submit="buscarUsuarios" style="max-width:520px">
      ${ic("buscar")}
      <label for="aq" class="sr-only">Buscar usuarios</label>
      <input id="aq" name="aq" type="search" placeholder="Email, nombre o usuario" autocomplete="off">
    </form>
    <div id="adminList">${cargando()}</div>`;
  cargarUsuarios("");
}

async function cargarUsuarios(q) {
  try {
    const d = await api("GET", "/api/run/admin/users?q=" + encodeURIComponent(q), null, { auth: true });
    $("adminStats").innerHTML = `
      <div class="stat"><div class="v">${d.total}</div><div class="l">Usuarios</div></div>
      <div class="stat"><div class="v key">${d.premium_active}</div><div class="l">Premium activos</div></div>`;
    if (!d.users.length) { $("adminList").innerHTML = vacio({ icono: "usuario", titulo: "Sin resultados." }); return; }
    $("adminList").innerHTML = `<div class="card table-card"><div class="table-wrap"><table>
      <thead><tr><th scope="col">Usuario</th><th scope="col" class="hide-sm">Plan</th><th scope="col" class="hide-sm">Premium hasta</th>
        <th scope="col" class="num-r">Dar premium</th></tr></thead>
      <tbody>${d.users.map(filaUsuario).join("")}</tbody></table></div></div>`;
  } catch (e) {
    $("adminList").innerHTML = errorHtml(e.message);
  }
}

function filaUsuario(u) {
  const plan = u.is_admin ? `<span class="pill plain">admin</span>`
    : u.plan === "premium" ? `<span class="pill green">premium</span>`
    : u.plan === "trial" ? `<span class="pill">prueba</span>`
    : `<span class="pill warn">vencido</span>`;
  const b = (body, txt, etiqueta) =>
    `<button type="button" class="btn ghost sm" data-act="darPremium" data-id="${u.id}" data-body='${esc(JSON.stringify(body))}' aria-label="${etiqueta}">${txt}</button>`;
  return `<tr>
    <td><div style="font-weight:600">${esc(u.full_name || u.username || u.email)}</div><div class="dim">${esc(u.email)}</div></td>
    <td class="hide-sm">${plan}</td>
    <td class="hide-sm">${u.premium_until ? esc(fmtFecha(u.premium_until.slice(0, 10))) : "—"}</td>
    <td class="num-r"><div class="row" style="justify-content:flex-end;gap:6px">
      ${b({ months: 1 }, "+1 mes", `Sumar 1 mes a ${esc(u.email)}`)}
      ${b({ months: 12 }, "+12", `Sumar 12 meses a ${esc(u.email)}`)}
      ${b({ unlimited: true }, "Sin límite", `Premium sin límite para ${esc(u.email)}`)}
      ${b({ revoke: true }, "Quitar", `Quitar premium a ${esc(u.email)}`)}
    </div></td></tr>`;
}

async function cupones() {
  $("adminBody").innerHTML = `
    <section class="card" aria-labelledby="tCup">
      <h2 id="tCup">Crear cupón</h2>
      <form class="row" style="align-items:flex-end" data-submit="crearCupon" novalidate>
        <div><label for="cpCode">Código</label><input id="cpCode" name="cpCode" type="text" placeholder="VERANO2026" autocapitalize="characters" required></div>
        <div><label for="cpKind">Tipo</label><select id="cpKind" name="cpKind" data-input="tipoCupon">
          <option value="free_months">Meses gratis</option><option value="discount">Descuento %</option></select></div>
        <div id="cpMonthsW"><label for="cpMonths">Meses</label><input id="cpMonths" name="cpMonths" type="number" min="1" value="1" style="width:90px"></div>
        <div id="cpPctW" hidden><label for="cpPct">% de descuento</label><input id="cpPct" name="cpPct" type="number" min="1" max="100" value="20" style="width:90px"></div>
        <div><label for="cpMax">Usos máximos</label><input id="cpMax" name="cpMax" type="number" min="1" placeholder="Sin límite" style="width:120px"></div>
        <button class="btn sm grad" type="submit">Crear</button>
      </form>
    </section>
    <div id="cpList">${cargando()}</div>`;
  cargarCupones();
}

async function cargarCupones() {
  try {
    const d = await api("GET", "/api/run/admin/coupons", null, { auth: true });
    if (!d.coupons.length) { $("cpList").innerHTML = vacio({ icono: "estrella", titulo: "Todavía no creaste cupones." }); return; }
    $("cpList").innerHTML = `<div class="card table-card"><div class="table-wrap"><table>
      <thead><tr><th scope="col">Código</th><th scope="col">Beneficio</th><th scope="col">Usos</th>
        <th scope="col" class="hide-sm">Estado</th><th scope="col" class="num-r"><span class="sr-only">Acción</span></th></tr></thead>
      <tbody>${d.coupons.map((c) => `<tr>
        <td><b>${esc(c.code)}</b></td>
        <td>${c.kind === "free_months" ? `${c.months} ${c.months === 1 ? "mes" : "meses"} gratis` : `${c.percent_off}% off`}</td>
        <td class="tnum">${c.redeemed_count}${c.max_redemptions ? ` de ${c.max_redemptions}` : ""}</td>
        <td class="hide-sm">${c.active ? `<span class="pill green">activo</span>` : `<span class="pill warn">inactivo</span>`}</td>
        <td class="num-r"><button type="button" class="btn ghost sm" data-act="alternarCupon" data-id="${c.id}">${c.active ? "Desactivar" : "Activar"}</button></td>
      </tr>`).join("")}</tbody></table></div></div>`;
  } catch (e) {
    $("cpList").innerHTML = errorHtml(e.message);
  }
}

registrar({
  pestanaAdmin(btn) { _pestana = btn.dataset.p; pintarPestana(); },
  buscarUsuarios(form) { cargarUsuarios(form.aq.value.trim()); },
  async darPremium(btn) {
    const restaurar = ocupado(btn);
    try {
      await api("POST", `/api/run/admin/users/${btn.dataset.id}/grant`, JSON.parse(btn.dataset.body), { auth: true });
      toast("Listo.");
      cargarUsuarios(($("aq") && $("aq").value.trim()) || "");
    } catch (e) {
      restaurar();
      toast(e.message, "warn");
    }
  },
  tipoCupon(sel) {
    const desc = sel.value === "discount";
    $("cpMonthsW").hidden = desc;
    $("cpPctW").hidden = !desc;
  },
  async crearCupon(form) {
    const kind = form.cpKind.value;
    const body = { code: form.cpCode.value.trim().toUpperCase(), kind };
    if (!body.code) { form.cpCode.focus(); return; }
    if (kind === "free_months") body.months = parseInt(form.cpMonths.value, 10) || 1;
    else body.percent_off = parseInt(form.cpPct.value, 10) || 10;
    const max = parseInt(form.cpMax.value, 10);
    if (max > 0) body.max_redemptions = max;
    const restaurar = ocupado(form.querySelector("[type=submit]"));
    try {
      await api("POST", "/api/run/admin/coupons", body, { auth: true });
      toast("Cupón creado.");
      form.cpCode.value = "";
      cargarCupones();
    } catch (e) {
      toast(e.message, "warn");
    }
    restaurar();
  },
  async alternarCupon(btn) {
    const restaurar = ocupado(btn);
    try {
      await api("POST", `/api/run/admin/coupons/${btn.dataset.id}/toggle`, null, { auth: true });
      cargarCupones();
    } catch (e) {
      restaurar();
      toast(e.message, "warn");
    }
  },
});
