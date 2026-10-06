// Contacto comercial para organizadores.

// Formato de wa.me para Argentina: 54 + 9 + característica sin 0 + número sin 15.
export const ORG_WHATSAPP = "5493585076606";
export const ORG_WHATSAPP_MSG = "Hola! Organizo carreras y quiero saber más sobre LiveRun.";
export const ORG_EMAIL = "agustingirardi1@gmail.com";

// Planes: mientras esté vacío, la página invita a pedir presupuesto. Cuando
// estén los precios, se cargan acá y se muestran solos:
//   { nombre:"Hasta 300 corredores", precio:"$XXX por evento", detalle:["…","…"], destacado:false }
export const ORG_PLANES = [];

export function waLink(msg) {
  return `https://wa.me/${ORG_WHATSAPP}?text=${encodeURIComponent(msg || ORG_WHATSAPP_MSG)}`;
}

export function mailLink(asunto = "Quiero cronometrar mi carrera con LiveRun") {
  return `mailto:${ORG_EMAIL}?subject=${encodeURIComponent(asunto)}`;
}
