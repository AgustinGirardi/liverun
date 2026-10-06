// Para organizadores: la puerta comercial del sistema de cronometraje.
import { esc } from "../nucleo/formato.js";
import { ORG_PLANES, waLink, mailLink } from "../nucleo/contacto.js";
import { ic } from "../ui/iconos.js";

const BENEFICIOS = [
  ["lista", "Inscripciones y dorsales", "Cargá corredores a mano o importá tu planilla. Dorsales, distancias, categorías y clubes, todo en un lugar."],
  ["reloj", "Cronómetro de precisión", "Reloj con centésimas y captura por dorsal. Corre en tu computadora: si se cae internet, la carrera sigue."],
  ["bandera", "Resultados al instante", "Posiciones por distancia y por categoría apenas cruzan la meta, con DNF, DNS y descalificados."],
  ["nube", "Publicación con un clic", "Los resultados van a este portal con un código de carrera. Los corredores los buscan por su nombre."],
  ["medalla", "Certificados en PDF", "Cada finisher descarga su certificado con tiempo, ritmo, puesto y categoría. Sin que hagas nada."],
  ["calendario", "Calendario e inscripción", "Anunciá la carrera antes de correrla, con cupo y tu link de inscripción."],
];

const PASOS = [
  ["Cargás la carrera", "Nombre, fecha, distancias y los inscriptos. Podés importar tu planilla."],
  ["Anunciás el evento", "Aparece en el calendario del portal con tu link de inscripción."],
  ["Cronometrás", "Dale largada y capturá cada llegada por dorsal. El puesto se calcula solo."],
  ["Publicás", "Un clic y los corredores ya buscan su tiempo y bajan su certificado."],
];

const contacto = () => `<div class="org-cta-row">
  <a class="btn grad org-btn" href="${waLink()}" target="_blank" rel="noopener noreferrer">${ic("whatsapp")}Escribinos por WhatsApp</a>
  <a class="btn ghost org-btn" href="${mailLink()}">${ic("mail")}Por email</a>
</div>`;

export function mostrar(ctx) {
  const planes = ORG_PLANES.length
    ? `<div class="org-planes">${ORG_PLANES.map((p) => `
        <div class="card org-plan${p.destacado ? " destacado" : ""}">
          ${p.destacado ? `<span class="pill green">Más elegido</span>` : ""}
          <div class="org-plan-nom">${esc(p.nombre)}</div>
          <div class="org-plan-precio">${esc(p.precio)}</div>
          <ul class="org-plan-det">${(p.detalle || []).map((d) => `<li>${esc(d)}</li>`).join("")}</ul>
          <a class="btn sm grad" href="${waLink(`Hola! Me interesa el plan ${p.nombre} de LiveRun.`)}" target="_blank" rel="noopener noreferrer">Consultar</a>
        </div>`).join("")}</div>`
    : `<div class="card org-presu">
        <div>
          <h3 class="org-paso-t" style="font-size:16px">¿Cuánto sale?</h3>
          <p class="muted">El presupuesto depende de la cantidad de corredores y de las distancias de tu carrera.
            Escribinos y te lo pasamos con el detalle de lo que incluye.</p>
        </div>
        <a class="btn grad org-btn" href="${waLink("Hola! Quiero un presupuesto para cronometrar mi carrera con LiveRun.")}" target="_blank" rel="noopener noreferrer">Pedir presupuesto</a>
      </div>`;

  ctx.app.innerHTML = `
    <section class="org-hero">
      <span class="pill green">Para organizadores</span>
      <h1 class="org-title" style="margin-top:14px">Tu carrera, cronometrada y <span class="accent">publicada el mismo día</span>.</h1>
      <p class="org-lead">LiveRun es el sistema de cronometraje que usás para tomar los tiempos, y el portal donde
        tus corredores encuentran su resultado y su certificado. Sin planillas, sin esperar hasta el lunes.</p>
      ${contacto()}
    </section>

    <h2 class="org-h2">Todo lo que necesitás el día de la carrera</h2>
    <ul class="org-list">${BENEFICIOS.map(([icono, t, d]) => `
      <li>${ic(icono)}<div><h3>${esc(t)}</h3><p>${esc(d)}</p></div></li>`).join("")}</ul>

    <h2 class="org-h2">Cómo funciona</h2>
    <ol class="org-pasos">${PASOS.map(([t, d], i) => `
      <li class="org-paso"><span class="org-num" aria-hidden="true">${i + 1}</span>
        <div><div class="org-paso-t">${esc(t)}</div><div class="muted">${esc(d)}</div></div></li>`).join("")}</ol>

    <h2 class="org-h2">Y tus corredores se llevan esto</h2>
    <ul class="org-list">
      <li>${ic("buscar")}<div><h3>Encuentran su tiempo por el nombre</h3>
        <p>Sin código, sin PDF adjunto, sin buscar en una lista de 500 filas.</p></div></li>
      <li>${ic("grafico")}<div><h3>Su historial y su evolución</h3>
        <p>Cada carrera que corren con vos les queda en el perfil, con sus mejores marcas.</p></div></li>
    </ul>

    <h2 class="org-h2">Planes</h2>
    ${planes}

    <section class="card org-final" aria-labelledby="tFinal">
      <div>
        <h2 class="org-final-t" id="tFinal" style="margin:0 0 4px">¿Organizás una carrera?</h2>
        <p class="muted">Contanos cuándo es y cuántos corredores esperás. Te mostramos cómo queda.</p>
      </div>
      ${contacto()}
    </section>`;
}
