// Mi progreso: los entrenamientos registrados con la app LiveRun.
import { api } from "../nucleo/api.js";
import { esc, fmtKm, fmtRitmo, plural } from "../nucleo/formato.js";
import { $, vacio, errorHtml, cargando } from "../ui/componentes.js";

const SEMANA_MS = 7 * 86400000;

function inicioDeSemana(fecha) {
  const x = new Date(fecha);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));   // lunes
  return x.getTime();
}

function kmPorSemana(salidas, n) {
  const actual = inicioDeSemana(new Date());
  const semanas = [];
  for (let i = n - 1; i >= 0; i--) semanas.push({ clave: actual - i * SEMANA_MS, km: 0 });
  const idx = new Map(semanas.map((s, i) => [s.clave, i]));
  for (const a of salidas) {
    const k = inicioDeSemana(a.started_at);
    if (idx.has(k)) semanas[idx.get(k)].km += a.distance_m / 1000;
  }
  return semanas.map((s, i) => ({ ...s, actual: i === n - 1 }));
}

function records(salidas) {
  let total = 0, mejor = Infinity;
  for (const a of salidas) {
    total += a.distance_m / 1000;
    if (a.avg_pace_s_per_km > 0 && a.avg_pace_s_per_km < mejor) mejor = a.avg_pace_s_per_km;
  }
  return { total, salidas: salidas.length, mejorRitmo: mejor === Infinity ? null : mejor };
}

export async function mostrar(ctx) {
  ctx.app.innerHTML = `
    <h1>Mi <span class="accent">progreso</span></h1>
    <p class="sub">Tus entrenamientos de la app LiveRun: semana, mes y ranking con tus amigos.</p>
    <div id="runBody">${cargando("Cargando tu progreso…")}</div>`;
  let resumen, salidas, ranking;
  try {
    [resumen, salidas, ranking] = await Promise.all([
      api("GET", "/api/run/summary", null, { auth: true }),
      api("GET", "/api/run/activities?limit=100", null, { auth: true }),
      api("GET", "/api/run/ranking?period=week&scope=friends", null, { auth: true }).catch(() => null),
    ]);
  } catch (e) {
    if (ctx.vigente()) $("runBody").innerHTML = errorHtml(e.message);
    return;
  }
  if (!ctx.vigente()) return;
  const box = $("runBody");

  if (!salidas.length) {
    box.innerHTML = vacio({
      icono: "pulso", titulo: "Todavía no hay salidas registradas.",
      detalle: "Las salidas que grabes con la app LiveRun aparecen acá. La app está en acceso anticipado.",
    });
    return;
  }

  const sem = resumen.week, mes = resumen.month;
  const pct = sem.goal > 0 ? Math.min(1, sem.days_run / sem.goal) : 0;
  const grados = Math.round(pct * 360);
  const semanas = kmPorSemana(salidas, 8);
  const mejorSemana = Math.max(...semanas.map((s) => s.km));
  const pico = Math.max(1, mejorSemana);   // escala de las barras
  const rec = records(salidas);
  const barras = semanas.map((s, i) => `<div class="bar-col"><div class="bar${s.actual ? " cur" : ""}"
    style="height:${Math.max(4, (s.km / pico) * 100)}%;animation-delay:${i * 60}ms" title="${fmtKm(s.km)}"></div></div>`).join("");

  let rankingHtml = "";
  if (ranking && ranking.entries && ranking.entries.length) {
    rankingHtml = `<section class="card" aria-labelledby="tRank"><h2 id="tRank">Ranking de la semana · amigos</h2>
      ${ranking.entries.slice(0, 5).map((e, i) => `<div class="rank-row${e.is_me ? " me" : ""}">
        <span class="rank-pos">${i + 1}</span>
        <span class="rank-name">${esc(e.username || e.full_name || "Corredor")}${e.is_me ? " (vos)" : ""}</span>
        <span class="rank-km">${fmtKm(e.km)}</span></div>`).join("")}</section>`;
  }

  box.innerHTML = `
    <div class="run-top">
      <div class="card run-hero">
        <div class="ring" style="background:conic-gradient(var(--acc) ${grados}deg, var(--panel2) ${grados}deg)"
          role="img" aria-label="Esta semana: ${sem.days_run} de ${sem.goal} días">
          <div class="ring-in"><div class="ring-v">${sem.days_run}/${sem.goal}</div><div class="ring-l">días</div></div>
        </div>
        <div class="run-hero-info">
          <div class="dim" style="text-transform:uppercase;letter-spacing:1px;font-weight:700">Este mes</div>
          <div class="run-big">${mes.km.toFixed(1).replace(".", ",")}<span class="run-unit"> km</span></div>
          <div class="dim">${plural(mes.activities, "salida", "salidas")} · ${plural(mes.days_run, "día", "días")}</div>
        </div>
      </div>
      <div class="stats run-stats">
        <div class="stat"><div class="v">${resumen.streak_weeks}</div><div class="l">Semanas de racha</div></div>
        <div class="stat"><div class="v">${Math.round(rec.total)}</div><div class="l">Km totales</div></div>
        <div class="stat"><div class="v">${rec.salidas}</div><div class="l">Salidas</div></div>
        <div class="stat"><div class="v">${fmtRitmo(rec.mejorRitmo, false)}</div><div class="l">Mejor ritmo /km</div></div>
      </div>
    </div>
    <section class="card" aria-labelledby="tSem"><h2 id="tSem">Km por semana</h2>
      <div class="chart" role="img" aria-label="Últimas 8 semanas: ${semanas.map((s) => fmtKm(s.km)).join(", ")}">${barras}</div>
      <p class="dim" style="margin-top:8px">Últimas 8 semanas · la mejor, ${fmtKm(mejorSemana)}</p>
    </section>
    ${rankingHtml}`;
}
