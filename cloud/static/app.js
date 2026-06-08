const API = "";  // mismo origen
const $ = (id) => document.getElementById(id);
let TOKEN = localStorage.getItem("ct_token") || null;
let USER  = JSON.parse(localStorage.getItem("ct_user") || "null");
let state = { distFilter:null };

function applyTheme(t){
  document.documentElement.setAttribute("data-theme", t);
  const b = document.getElementById("themeBtn");
  if(b) b.textContent = t === "dark" ? "◑" : "◐";
}
function toggleTheme(){
  const cur = localStorage.getItem("ct_theme") === "dark" ? "dark" : "light";
  const next = cur === "dark" ? "light" : "dark";
  localStorage.setItem("ct_theme", next);
  applyTheme(next);
}
applyTheme(localStorage.getItem("ct_theme") === "dark" ? "dark" : "light");

function esc(s){ return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
function fmtNs(ns){ if(!ns) return "—"; let ms=Math.floor(ns/1e6); const h=Math.floor(ms/3600000); ms%=3600000; const m=Math.floor(ms/60000); ms%=60000; const s=Math.floor(ms/1000); const f=ms%1000; const p=(n,l=2)=>String(n).padStart(l,"0"); return `${p(h)}:${p(m)}:${p(s)}.${p(f,3)}`; }
function fmtDate(d){ if(!d) return ""; try { return new Date(d+"T12:00:00").toLocaleDateString("es-AR",{day:"numeric",month:"long",year:"numeric"}); } catch { return d; } }

function fmtErr(detail, status){
  if(Array.isArray(detail)) return detail.map(d=>d && d.msg ? d.msg : (typeof d==="string"?d:JSON.stringify(d))).join(" · ");
  if(typeof detail === "string") return detail;
  return "Error "+(status||"");
}
async function api(method, path, body, auth){
  const h = {"Content-Type":"application/json"};
  if(auth && TOKEN) h["Authorization"] = "Bearer "+TOKEN;
  let res;
  try { res = await fetch(API+path, { method, headers:h, body: body!=null?JSON.stringify(body):undefined }); }
  catch(netErr){ throw new Error("No se pudo conectar con el servidor. Revisá tu conexión e intentá de nuevo."); }
  const data = await res.json().catch(()=>null);
  if(!res.ok) throw new Error(fmtErr(data && data.detail, res.status));
  return data;
}

function setSession(d){ TOKEN=d.token; USER={email:d.email,full_name:d.full_name}; localStorage.setItem("ct_token",TOKEN); localStorage.setItem("ct_user",JSON.stringify(USER)); }
function logout(){ TOKEN=null; USER=null; localStorage.removeItem("ct_token"); localStorage.removeItem("ct_user"); go("home"); }

function renderNav(){
  const n = $("nav");
  if(USER){
    n.innerHTML = `<button onclick="go('home')">🏠 Inicio</button>
      <span class="who hide-sm">${esc((USER.full_name||USER.email).split(" ")[0])}</span>
      <button onclick="logout()">Salir</button>`;
  } else {
    n.innerHTML = `<button onclick="go('login')">Ingresar</button>
      <button class="primary" onclick="go('register')">Crear cuenta</button>`;
  }
}

// ── Router ────────────────────────────────────────────────────────────────
function go(view, arg){
  state.view = view; state.arg = arg; state.distFilter = null;
  window.scrollTo(0,0);
  renderNav();
  const hs = document.getElementById("headerSearch");
  if(hs) hs.style.display = (view === "home") ? "none" : "block";
  const hq = document.getElementById("hq");
  if(hq && view === "search") hq.value = arg || "";
  if(view==="home")     return viewHome();
  if(view==="search")   return viewSearch(arg);
  if(view==="race")     return viewRace(arg);
  if(view==="login")    return viewAuth("login");
  if(view==="register") return viewAuth("register");
  if(view==="me")       return viewHome();   // el perfil ahora vive en el inicio (dashboard)
}

// ── Home ─────────────────────────────────────────────────────────────────
function viewHome(){
  if(USER) return viewDashboard();
  $("app").innerHTML = `
    <section class="hero">
      <div class="badge">Resultados oficiales</div>
      <h1 class="hero-title">Encontrá tu tiempo,<br><span class="accent">descargá tu certificado</span>.</h1>
      <p class="hero-sub">Buscá tu nombre y accedé a tus resultados al instante. Creá tu cuenta para guardar tu historial y seguir tu progreso.</p>
      <div class="search-hero">
        <input id="q" placeholder="Buscá tu nombre o el de la carrera…" onkeydown="if(event.key==='Enter')homeSearch()">
        <button class="btn sm" onclick="homeSearch()">Buscar</button>
      </div>
      <div class="hero-cta">
        ${USER ? `<button class="btn sm" onclick="go('me')">Ver mi perfil →</button>`
               : `<button class="btn sm" onclick="go('register')">Crear cuenta</button>
                  <button class="btn ghost sm" onclick="go('login')">Ingresar</button>`}
      </div>
      <div class="hero-note">También podés escribir el <b>código de la carrera</b> en el buscador.</div>

      <div class="features">
        <div class="feature"><div class="ic">🔎</div><h3>Buscá por nombre</h3><p>Sin códigos ni dorsales: escribí tu nombre y encontrá tus carreras.</p></div>
        <div class="feature"><div class="ic">🏅</div><h3>Certificado al instante</h3><p>Descargá tu certificado de finisher en PDF con un clic.</p></div>
        <div class="feature"><div class="ic">📈</div><h3>Tu progreso</h3><p>Guardá tus resultados y mirá tus mejores marcas por distancia.</p></div>
      </div>
    </section>
    <h2 style="text-align:center;margin-top:36px">Carreras recientes</h2>
    <div class="sub" style="text-align:center">Explorá los últimos resultados publicados.</div>
    <div id="homeRaces"><div class="empty">Cargando…</div></div>`;
  loadHomeRaces();
}
async function loadHomeRaces(){
  const box = $("homeRaces"); if(!box) return;
  try {
    const races = await api("GET","/api/races");
    box.innerHTML = races.length
      ? races.slice(0, 9).map(raceCard).join("")
      : `<div class="empty"><div class="ic">🏁</div>Todavía no hay carreras publicadas.</div>`;
  } catch(e){ box.innerHTML = `<div class="err">${esc(e.message)}</div>`; }
}
function homeSearch(){ const q=$("q").value.trim(); if(q.length>=2) go("search", q); }
function headerSearch(){ const el=document.getElementById("hq"); const q=(el?el.value:"").trim(); if(q.length>=2) go("search", q); }

function raceCard(r){
  return `<div class="card click" onclick="go('race','${r.code}')">
    <div class="row" style="justify-content:space-between">
      <div style="font-weight:700;font-size:15px">${esc(r.name)}</div><span class="bib">${r.code}</span>
    </div>
    <div class="row" style="margin-top:8px">
      ${r.race_date?`<span class="dim">📅 ${esc(fmtDate(r.race_date))}</span>`:""}
      ${r.location?`<span class="dim">📍 ${esc(r.location)}</span>`:""}
      <span class="pill green">${r.finishers} finishers</span>
      ${r.distances.map(d=>`<span class="pill">${d} km</span>`).join("")}
    </div>
  </div>`;
}

// ── Dashboard (usuario logueado) ─────────────────────────────────────────────
async function viewDashboard(){
  const first = esc((USER.full_name || USER.email).split(" ")[0]);
  $("app").innerHTML = `
    <h1>Hola, ${first} 👋</h1>
    <div class="sub">Tu historial personal y todas las carreras publicadas.</div>
    <div class="search-hero" style="max-width:560px;margin-bottom:24px">
      <input id="q" placeholder="Buscá tu nombre para agregar un resultado…" onkeydown="if(event.key==='Enter')homeSearch()">
      <button class="btn sm" onclick="homeSearch()">Buscar</button>
    </div>
    <div id="dashMe"><div class="empty">Cargando tu historial…</div></div>
    <h2 style="margin-top:32px">Todas las carreras</h2>
    <div class="sub" style="margin-bottom:14px">Explorá los resultados publicados y entrá a cualquier carrera.</div>
    <div id="dashRaces"><div class="empty">Cargando…</div></div>`;

  // Mi historial + mejores marcas
  try {
    const d = await api("GET","/api/me/results", null, true);
    state.meResults = d.results;
    const pb = d.personal_bests.length
      ? `<div class="card"><h2>Mejores marcas</h2><div class="row">${d.personal_bests.map(p=>`<div class="stat" style="min-width:120px"><div class="v">${fmtNs(p.net_time_ns)}</div><div class="l">${p.distance_km} km</div></div>`).join("")}</div></div>`
      : "";
    const hist = d.results.length
      ? `<h2 style="margin-top:24px">Mis carreras</h2><div class="card" style="padding:6px"><table>
          <thead><tr><th>Carrera</th><th class="hide-sm">Dist.</th><th>Pos.</th><th style="text-align:right">Tiempo</th><th></th></tr></thead>
          <tbody>${d.results.map((r,i)=>`<tr>
            <td><a style="color:var(--acc)" onclick="event.stopPropagation();go('race','${r.race_code}')">${esc(r.race_name)}</a><div class="dim">${esc(fmtDate(r.race_date))}${r.distance_km?` · ${r.distance_km} km`:""}</div></td>
            <td class="hide-sm">${r.distance_km?r.distance_km+" km":"—"}</td>
            <td>${r.status==="FINISHER"?(r.position||"—"):`<span class="pill warn">${r.status}</span>`}</td>
            <td class="time">${fmtNs(r.net_time_ns)}</td>
            <td style="text-align:right">${r.status==="FINISHER"?`<a class="lnk" onclick="certMe(${i})">🏅 PDF</a>`:""}</td></tr>`).join("")}
          </tbody></table></div>`
      : `<div class="empty" style="padding:34px"><div class="ic">🏃</div>Todavía no guardaste resultados.<br><span class="dim">Buscá tu nombre arriba para agregar tus carreras.</span></div>`;
    $("dashMe").innerHTML = `<div class="stats">
        <div class="stat"><div class="v">${d.total_races}</div><div class="l">Carreras</div></div>
        <div class="stat"><div class="v">${d.personal_bests.length}</div><div class="l">Distancias</div></div>
        <div class="stat"><div class="v">${d.results.length}</div><div class="l">Resultados</div></div>
      </div>${pb}${hist}`;
  } catch(e){ $("dashMe").innerHTML = `<div class="err">${esc(e.message)}</div>`; }

  // Todas las carreras publicadas
  try {
    const races = await api("GET","/api/races");
    $("dashRaces").innerHTML = races.length
      ? races.map(raceCard).join("")
      : `<div class="empty"><div class="ic">🏁</div>Todavía no hay carreras publicadas.</div>`;
  } catch(e){ $("dashRaces").innerHTML = `<div class="err">${esc(e.message)}</div>`; }
}

// ── Búsqueda ───────────────────────────────────────────────────────────────
async function viewSearch(q){
  $("app").innerHTML = `<a class="back" onclick="go('home')">← Inicio</a>
    <h1>Buscar resultados</h1>
    <div class="search-hero" style="max-width:560px;margin:14px 0 22px">
      <input id="q" value="${esc(q)}" placeholder="Tu nombre o el de la carrera…" onkeydown="if(event.key==='Enter')homeSearch()">
      <button class="btn sm" onclick="homeSearch()">Buscar</button>
    </div>
    <div id="sres"><div class="empty">Buscando…</div></div>`;
  try {
    const d = await api("GET","/api/search?q="+encodeURIComponent(q));
    state.searchResults = d.results;
    let html = "";
    if(d.races.length){
      html += `<h2>Carreras</h2>` + d.races.map(r=>`
        <div class="card click" onclick="go('race','${r.code}')">
          <div class="row" style="justify-content:space-between">
            <div style="font-weight:700;font-size:15px">${esc(r.name)}</div><span class="bib">${r.code}</span>
          </div>
          <div class="row" style="margin-top:8px">
            ${r.race_date?`<span class="dim">📅 ${esc(fmtDate(r.race_date))}</span>`:""}
            ${r.location?`<span class="dim">📍 ${esc(r.location)}</span>`:""}
            ${r.distances.map(x=>`<span class="pill">${x} km</span>`).join("")}
          </div>
        </div>`).join("");
    }
    if(d.results.length){
      html += `<h2 style="margin-top:${d.races.length?'22px':'0'}">Corredores</h2>` + d.results.map((r,i)=>`
        <div class="card">
          <div class="row" style="justify-content:space-between">
            <div style="font-weight:700;font-size:15px">${esc(r.full_name)}</div>
            <span class="time">${fmtNs(r.net_time_ns||r.finish_time_ns)}</span>
          </div>
          <div class="dim" style="margin:7px 0 12px">
            ${esc(r.race_name)} · ${r.distance_km?r.distance_km+" km":"—"} · ${esc(fmtDate(r.race_date))}
            ${r.status==="FINISHER"&&r.position?` · puesto ${r.position}`:r.status!=="FINISHER"?` · ${r.status}`:""} · dorsal ${esc(r.bib_number)}
          </div>
          <div class="row">
            <button class="btn ghost sm" onclick="go('race','${r.race_code}')">Ver carrera</button>
            ${r.status==="FINISHER"?`<button class="btn ghost sm" onclick="certSearch(${i})">🏅 Certificado</button>`:""}
            <button class="btn sm" onclick="saveResult(${r.result_id}, this)">${USER?"Guardar en mi perfil":"Crear cuenta y guardar"}</button>
          </div>
        </div>`).join("");
    }
    $("sres").innerHTML = html || `<div class="empty"><div class="ic">🔎</div>No encontramos resultados para “${esc(q)}”.<br><span class="dim">Probá con tu nombre y apellido, o el nombre de la carrera.</span></div>`;
  } catch(e){ $("sres").innerHTML = `<div class="err">${esc(e.message)}</div>`; }
}
function certSearch(i){ const r=state.searchResults[i]; printCertificate(r, r.race_name, r.race_date, r.location, r.race_code); }

async function saveResult(resultId, btn){
  if(!USER){ go("register"); return; }
  const orig = btn.textContent; btn.disabled=true; btn.textContent="Guardando…";
  // Apellido del propio usuario como prueba de identidad (el server verifica
  // que el resultado coincida con tu nombre antes de guardarlo).
  const parts = (USER.full_name||"").trim().split(/\s+/);
  const lastName = parts.length>1 ? parts[parts.length-1] : "";
  try { await api("POST","/api/me/claim",{result_id:resultId, last_name:lastName}, true); btn.textContent="✓ Guardado"; btn.classList.add("done"); }
  catch(e){ btn.disabled=false; btn.textContent=orig; alert(e.message); }
}

// ── Detalle de carrera ──────────────────────────────────────────────────────
async function viewRace(code){
  $("app").innerHTML = `<a class="back" onclick="go('home')">← Inicio</a><div id="rc"><div class="empty">Cargando…</div></div>`;
  let race;
  try { race = await api("GET","/api/races/"+encodeURIComponent(code)); }
  catch(e){ $("rc").innerHTML = `<div class="err">${esc(e.message)}</div>`; return; }
  state.curRace = race;

  const finishers = race.results.filter(r=>r.status==="FINISHER");
  const dnf = race.results.filter(r=>r.status!=="FINISHER");
  const dists = race.distances.length ? race.distances : [...new Set(finishers.map(r=>r.distance_km).filter(x=>x!=null))];
  if(state.distFilter==null && dists.length) state.distFilter = dists[0];

  const renderTable = () => {
    let list = finishers;
    if(dists.length) list = finishers.filter(r=>r.distance_km===state.distFilter);
    list = [...list].sort((a,b)=>(a.net_time_ns||a.finish_time_ns||9e18)-(b.net_time_ns||b.finish_time_ns||9e18));
    const rows = list.map((r,i)=>{
      const idx = race.results.indexOf(r);
      return `<tr>
        <td class="pos ${i<3?'medal'+i:''}">${i<3?["🥇","🥈","🥉"][i]:i+1}</td>
        <td><span class="bib">${esc(r.bib_number)}</span></td>
        <td style="font-weight:600">${esc(r.full_name)}</td>
        <td class="hide-sm">${r.category?`<span class="pill ${r.category[0]==='F'?'':'green'}">${esc(r.category)}</span>`:'—'}</td>
        <td class="muted hide-sm">${esc(r.club||'—')}</td>
        <td class="time">${fmtNs(r.net_time_ns||r.finish_time_ns)}</td>
        <td style="text-align:right"><a class="lnk" onclick="certRace(${idx})">🏅 PDF</a></td>
      </tr>`;
    }).join("");
    return `<table><thead><tr><th>Pos</th><th>Dorsal</th><th>Nombre</th><th class="hide-sm">Cat.</th><th class="hide-sm">Club</th><th style="text-align:right">Tiempo</th><th></th></tr></thead>
      <tbody>${rows||`<tr><td colspan="7" class="empty">Sin finishers en esta distancia</td></tr>`}</tbody></table>`;
  };

  $("rc").innerHTML = `
    <h1>${esc(race.name)}</h1>
    <div class="sub">${[fmtDate(race.race_date), race.location].filter(Boolean).map(esc).join(" · ")} · código <b>${race.code}</b></div>
    <div class="stats">
      <div class="stat"><div class="v">${finishers.length}</div><div class="l">Finishers</div></div>
      <div class="stat"><div class="v" style="color:var(--txt)">${race.results.length}</div><div class="l">Total</div></div>
      <div class="stat"><div class="v" style="color:var(--warn)">${dnf.length}</div><div class="l">DNF/DNS/DQ</div></div>
    </div>
    ${dists.length>1?`<div class="dist-tabs" id="dtabs">${dists.map(d=>`<button class="${d===state.distFilter?'on':''}" onclick="setDist(${d})">${d} km</button>`).join("")}</div>`:""}
    <div class="card" style="padding:6px" id="tbl">${renderTable()}</div>
    ${dnf.length?`
      <h2 style="margin-top:24px;font-size:16px">No finalizaron <span class="muted" style="font-weight:400">· ${dnf.length}</span></h2>
      <div class="card" style="padding:6px"><table>
        <thead><tr><th>Dorsal</th><th>Nombre</th><th class="hide-sm">Cat.</th><th class="hide-sm">Club</th><th>Estado</th></tr></thead>
        <tbody>${dnf.map(r=>`<tr>
          <td><span class="bib">${esc(r.bib_number)}</span></td>
          <td style="font-weight:600">${esc(r.full_name)}</td>
          <td class="hide-sm">${r.category?`<span class="pill ${r.category[0]==='F'?'':'green'}">${esc(r.category)}</span>`:'—'}</td>
          <td class="muted hide-sm">${esc(r.club||'—')}</td>
          <td><span class="pill warn" title="${r.status==='DNS'?'No largó':r.status==='DNF'?'No finalizó':r.status==='DQ'?'Descalificado':''}">${esc(r.status)}</span></td>
        </tr>`).join("")}</tbody></table></div>`:""}`;
  state._renderTable = renderTable;
}
function setDist(d){ state.distFilter=d; $("tbl").innerHTML = state._renderTable(); document.querySelectorAll("#dtabs button").forEach(b=>b.classList.toggle("on", b.textContent===d+" km")); }
function certRace(idx){ const r=state.curRace.results[idx]; printCertificate(r, state.curRace.name, state.curRace.race_date, state.curRace.location, state.curRace.code); }

// ── Certificado PDF (se genera e imprime en el navegador) ─────────────────────
function printCertificate(r, raceName, raceDate, location, code){
  const time = fmtNs(r.net_time_ns||r.finish_time_ns);
  const dist = r.distance_km ? r.distance_km+" km" : "";
  const meta = [dist, fmtDate(raceDate), location].filter(Boolean).map(esc).join("&nbsp;&nbsp;·&nbsp;&nbsp;");
  const pos = r.position ? "#"+r.position : "";
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Certificado · ${esc(r.full_name)}</title>
  <style>
    @page { size:A4 landscape; margin:0; }
    html,body{ margin:0; padding:0; }
    .cert{ width:297mm; height:210mm; box-sizing:border-box; padding:13mm; font-family:Georgia,'Times New Roman',serif; color:#13202b; background:#fff; }
    .frame{ height:100%; border:3px solid #00b483; border-radius:8px; position:relative; display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; padding:16mm; }
    .frame:before{ content:""; position:absolute; inset:5mm; border:1px solid #d7e3df; border-radius:5px; pointer-events:none; }
    .brand{ position:absolute; top:9mm; left:0; right:0; text-align:center; font-family:Arial,Helvetica,sans-serif; letter-spacing:5px; font-weight:800; color:#00b483; font-size:13pt; }
    .kicker{ text-transform:uppercase; letter-spacing:7px; color:#9aa6ad; font-size:12pt; font-family:Arial,sans-serif; margin-bottom:6mm; }
    .name{ font-size:42pt; font-weight:700; margin-bottom:4mm; }
    .desc{ font-size:13pt; color:#5a6671; }
    .race{ font-size:23pt; font-weight:700; margin:3mm 0; color:#00795c; }
    .meta{ font-size:12.5pt; color:#6b7681; }
    .timebox{ margin-top:11mm; display:flex; gap:22mm; justify-content:center; }
    .tb .v{ font-size:30pt; font-weight:800; font-family:Arial,sans-serif; color:#13202b; line-height:1; }
    .tb .l{ font-size:9.5pt; text-transform:uppercase; letter-spacing:2px; color:#9aa6ad; margin-top:3mm; }
    .foot{ position:absolute; bottom:9mm; left:0; right:0; text-align:center; font-size:9pt; color:#b3bcc2; font-family:Arial,sans-serif; letter-spacing:.5px; }
  </style></head>
  <body><div class="cert"><div class="frame">
    <div class="brand">● CHRONOTRACK</div>
    <div class="kicker">Certificado de Finisher</div>
    <div class="name">${esc(r.full_name)}</div>
    <div class="desc">completó exitosamente</div>
    <div class="race">${esc(raceName)}</div>
    <div class="meta">${meta}</div>
    <div class="timebox">
      <div class="tb"><div class="v">${time}</div><div class="l">Tiempo</div></div>
      ${pos?`<div class="tb"><div class="v">${pos}</div><div class="l">Posición</div></div>`:""}
      ${r.category?`<div class="tb"><div class="v">${esc(r.category)}</div><div class="l">Categoría</div></div>`:""}
    </div>
    <div class="foot">Resultados oficiales de cronometraje&nbsp;&nbsp;·&nbsp;&nbsp;código ${esc(code||"")}</div>
  </div></div></body></html>`;
  printHtml(html);
}
function printHtml(html){
  const f = document.createElement("iframe");
  f.style.position="fixed"; f.style.right="0"; f.style.bottom="0"; f.style.width="0"; f.style.height="0"; f.style.border="0";
  document.body.appendChild(f);
  const d = f.contentWindow.document; d.open(); d.write(html); d.close();
  const fire = () => { try { f.contentWindow.focus(); f.contentWindow.print(); } catch(e){} };
  f.onload = () => { fire(); setTimeout(()=>{ try{ f.remove(); }catch(e){} }, 1500); };
  setTimeout(fire, 400);
}

// ── Auth ─────────────────────────────────────────────────────────────────────
function viewAuth(mode){
  const reg = mode==="register";
  $("app").innerHTML = `
    <div style="max-width:400px;margin:24px auto">
      <h1>${reg?"Crear cuenta":"Ingresar"}</h1>
      <div class="sub">${reg?"Guardá tus resultados y seguí tu progreso.":"Accedé a tu historial de carreras."}</div>
      <div class="card">
        <div id="amsg"></div>
        ${reg?`<div class="field"><label>Nombre completo</label><input type="text" id="fn" placeholder="Juan Pérez"></div>`:""}
        <div class="field"><label>Email</label><input type="email" id="em" placeholder="vos@email.com" onkeydown="if(event.key==='Enter')${reg?"$('pw').focus()":"doAuth('login')"}"></div>
        <div class="field"><label>Contraseña</label>
          <div class="pw-wrap">
            <input type="password" id="pw" placeholder="${reg?'mínimo 8 caracteres':'••••••'}" ${reg?'oninput="pwMeter()"':''} onkeydown="if(event.key==='Enter')doAuth('${mode}')">
            <button type="button" class="pw-eye" id="pwEye" onclick="togglePw()" title="Mostrar u ocultar la contraseña" aria-label="Mostrar u ocultar la contraseña">👁</button>
          </div>
          ${reg?`<div class="pw-meter"><div class="pw-bar"><i id="pwFill"></i></div><span class="pw-lbl" id="pwLbl"></span></div>`:""}
        </div>
        <button class="btn" id="abtn" onclick="doAuth('${mode}')">${reg?"Crear cuenta":"Ingresar"}</button>
        <div style="text-align:center;margin-top:15px" class="muted">
          ${reg?`¿Ya tenés cuenta? <a style="color:var(--acc)" onclick="go('login')">Ingresá</a>`
                :`¿Sos nuevo? <a style="color:var(--acc)" onclick="go('register')">Creá tu cuenta</a>`}
        </div>
      </div>
    </div>`;
}
function showAuthErr(msg){ $("amsg").innerHTML = `<div class="err">${esc(msg)}</div>`; }
function togglePw(){ const i=$("pw"), e=$("pwEye"); if(!i) return; const show = i.type==="password"; i.type = show ? "text" : "password"; e.textContent = show ? "🙈" : "👁"; i.focus(); }
function pwScore(pw){
  if(pw.length < 8) return 0;                 // por debajo del mínimo: siempre "muy débil"
  let s = 1;
  if(pw.length >= 12) s++;
  if(/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++;
  if(/\d/.test(pw)) s++;
  if(/[^A-Za-z0-9]/.test(pw)) s++;
  return Math.min(s, 4);                        // 0..4
}
function pwMeter(){
  const i=$("pw"), fill=$("pwFill"), lbl=$("pwLbl");
  if(!i || !fill) return;
  const pw = i.value;
  if(!pw){ fill.style.width="0"; lbl.textContent=""; return; }
  const sc = pwScore(pw);
  const widths = ["20%","40%","65%","85%","100%"];
  const colors = ["#e5484d","#e5484d","#f5a524","#3aa675","#00b483"];
  const labels = ["Muy débil","Débil","Media","Buena","Fuerte"];
  fill.style.width = widths[sc];
  fill.style.background = colors[sc];
  lbl.textContent = labels[sc];
  lbl.style.color = colors[sc];
}
async function doAuth(mode){
  const reg = mode==="register";
  const email = $("em").value.trim(), pw = $("pw").value;
  if(!email){ showAuthErr("Ingresá tu email."); return; }
  if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){ showAuthErr("El email no tiene un formato válido (ej. vos@email.com)."); return; }
  if(!pw){ showAuthErr("Ingresá tu contraseña."); return; }
  if(reg && pw.length < 8){ showAuthErr("La contraseña debe tener al menos 8 caracteres."); return; }
  const b = $("abtn"); b.disabled=true; $("amsg").innerHTML="";
  try {
    const body = reg ? { email, password:pw, full_name:$("fn").value.trim()||null } : { email, password:pw };
    const d = await api("POST", reg?"/api/auth/register":"/api/auth/login", body);
    setSession(d); go("home");
  } catch(e){ showAuthErr(e.message); b.disabled=false; }
}

// ── Mi perfil ──────────────────────────────────────────────────────────────
async function viewMe(){
  if(!USER) return go("login");
  $("app").innerHTML = `<h1>Mi perfil</h1><div class="sub">${esc(USER.full_name||USER.email)}</div>
    <div class="tabbar"><button class="on" id="tHist" onclick="meTab('hist')">Mis carreras</button><button id="tClaim" onclick="meTab('claim')">+ Agregar resultado</button></div>
    <div id="meBody"><div class="empty">Cargando…</div></div>`;
  meTab("hist");
}
async function meTab(tab){
  $("tHist").classList.toggle("on", tab==="hist");
  $("tClaim").classList.toggle("on", tab==="claim");
  if(tab==="claim") return renderFind();
  try {
    const d = await api("GET","/api/me/results",null,true);
    state.meResults = d.results;
    const pb = d.personal_bests.length ? `<div class="card"><h2>Mejores marcas</h2><div class="row">${d.personal_bests.map(p=>`<div class="stat" style="min-width:120px"><div class="v">${fmtNs(p.net_time_ns)}</div><div class="l">${p.distance_km} km</div></div>`).join("")}</div></div>` : "";
    const hist = d.results.length ? `<div class="card" style="padding:6px"><table><thead><tr><th>Carrera</th><th class="hide-sm">Dist.</th><th>Pos.</th><th style="text-align:right">Tiempo</th><th></th></tr></thead><tbody>
      ${d.results.map((r,i)=>`<tr>
        <td><a style="color:var(--acc)" onclick="go('race','${r.race_code}')">${esc(r.race_name)}</a><div class="dim">${esc(fmtDate(r.race_date))}${r.distance_km?` · ${r.distance_km} km`:""}</div></td>
        <td class="hide-sm">${r.distance_km?r.distance_km+" km":"—"}</td>
        <td>${r.status==="FINISHER"?(r.position||"—"):`<span class="pill warn">${r.status}</span>`}</td>
        <td class="time">${fmtNs(r.net_time_ns)}</td>
        <td style="text-align:right">${r.status==="FINISHER"?`<a class="lnk" onclick="certMe(${i})">🏅 PDF</a>`:""}</td></tr>`).join("")}
      </tbody></table></div>` : `<div class="empty"><div class="ic">🏃</div>Todavía no guardaste resultados.<br><a style="color:var(--acc)" onclick="meTab('claim')">Buscá y agregá tu primera carrera</a></div>`;
    $("meBody").innerHTML = `<div class="stats"><div class="stat"><div class="v">${d.total_races}</div><div class="l">Carreras</div></div><div class="stat"><div class="v">${d.personal_bests.length}</div><div class="l">Distancias</div></div><div class="stat"><div class="v">${d.results.length}</div><div class="l">Resultados</div></div></div>${pb}${hist}`;
  } catch(e){ $("meBody").innerHTML = `<div class="err">${esc(e.message)}</div>`; }
}
function certMe(i){ const r=state.meResults[i]; printCertificate(r, r.race_name, r.race_date, r.location, r.race_code); }

function renderFind(){
  $("meBody").innerHTML = `<div class="card">
    <h2>Agregá tus resultados</h2>
    <div class="muted" style="margin-bottom:14px">Buscá tu nombre y guardá tus carreras en tu perfil. Sin códigos ni dorsales.</div>
    <div class="search-hero" style="max-width:none">
      <input id="cq" placeholder="Tu nombre y apellido…" onkeydown="if(event.key==='Enter')doFind()">
      <button class="btn sm" onclick="doFind()">Buscar</button>
    </div>
    <div id="findRes" style="margin-top:16px"></div>
  </div>`;
}
async function doFind(){
  const q=$("cq").value.trim();
  if(q.length<2){ $("findRes").innerHTML=`<div class="muted">Escribí al menos 2 letras.</div>`; return; }
  $("findRes").innerHTML=`<div class="muted">Buscando…</div>`;
  try {
    const d = await api("GET","/api/search?q="+encodeURIComponent(q));
    if(!d.results.length){ $("findRes").innerHTML=`<div class="empty" style="padding:24px"><div class="ic">🔎</div>No encontramos resultados para “${esc(q)}”.</div>`; return; }
    $("findRes").innerHTML = d.results.map(r=>`
      <div class="card" style="margin-bottom:8px;box-shadow:none">
        <div class="row" style="justify-content:space-between">
          <div style="font-weight:700">${esc(r.full_name)}</div><span class="time">${fmtNs(r.net_time_ns||r.finish_time_ns)}</span>
        </div>
        <div class="dim" style="margin:6px 0 11px">${esc(r.race_name)} · ${r.distance_km?r.distance_km+" km":"—"} · ${esc(fmtDate(r.race_date))} · dorsal ${esc(r.bib_number)}</div>
        <button class="btn sm" onclick="saveResult(${r.result_id}, this)">Guardar en mi perfil</button>
      </div>`).join("");
  } catch(e){ $("findRes").innerHTML=`<div class="err">${esc(e.message)}</div>`; }
}

// init
renderNav();
go("home");
