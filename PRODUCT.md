# LiveRun — contexto de producto

Escrito el 19 de septiembre de 2026 y rescatado el 19 de octubre de 2026 a partir del código, el README y las auditorías de diseño. **No salió de una entrevista**, así que lo que sigue es lectura de evidencia, no dictado del dueño del producto. Donde inferí, lo digo.

---

## Qué es

Sistema de cronometraje de carreras de calle, de punta a punta, más la app de running con la que los corredores entrenan el resto del año.

Nació de un problema concreto y local: en las carreras de Río Cuarto los resultados se publicaban como una foto de una planilla de Excel en Instagram, a veces al día siguiente. LiveRun los deja publicados y buscables por nombre apenas el organizador aprieta un botón.

**Está en producción, con carreras reales cronometradas.** Eso condiciona todo: no es un proyecto donde se pueda romper algo para probar.

## Las cuatro piezas

| Pieza | Dónde | Quién la usa | Escena de uso |
|---|---|---|---|
| **Escritorio** | `backend/`, `frontend/`, `launcher.py` | El cronometrador | De pie en la línea de llegada, con la carrera en curso |
| **Portal** | `cloud/`, `cloud/static/` | Corredores y organizadores | En el teléfono, minutos después de cruzar la meta |
| **Móvil** | `mobile/` | Corredores | Corriendo, o revisando el progreso después |
| **Cobro** | `cloud/billing*.py` | Organizadores | Suscripción premium vía Mercado Pago |

## Quién lo usa y en qué condiciones

Esto es lo que más condiciona las decisiones de diseño, y lo que un análisis del código solo no revela:

- **El cronometrador está de pie, en la calle, con gente cruzando la meta.** No puede equivocarse ni perder tiempo buscando el mouse. El teclado es la vía de entrada principal. La app de escritorio funciona **sin internet** a propósito: en una largada el WiFi nunca es confiable.
- **El corredor busca su tiempo en el teléfono, apenas termina.** Está cansado, con una mano, probablemente con sol directo sobre la pantalla. La búsqueda por nombre tiene que ser lo primero y lo más grande.
- **El corredor que entrena usa la app móvil de madrugada o al atardecer.** De ahí la dirección visual "Pista nocturna" del tema oscuro. *(Inferido: el tema oscuro está autorado con esa nota en `mobile/src/constants/theme.ts`; el claro se agregó después, en esta sesión.)*

## Decisiones de producto ya tomadas

- **Las dos apariencias, clara y oscura, se envían.** `userInterfaceStyle: "automatic"` — la app sigue la preferencia del sistema. Decisión confirmada por el dueño el 19/09/2026, después de evaluar la alternativa de ser sólo oscura.
- **La app móvil no dirige a pagos externos.** Las tiendas no lo permiten: la tarjeta de suscripción en el perfil sólo informa, sin botón ni link de compra.
- **El repositorio es público para que se pueda leer el código**, no como template para clonar.
- **El precio de la suscripción está anclado al dólar del día.**

## Dirección visual

Mint de marca (`#00e5a0`) sobre superficies oscuras que nunca son negro puro. En tema claro el mint no llega a contraste como texto, así que baja a un teal profundo (`#00795C`); el mint se reserva para rellenos grandes que llevan su propio texto encima. Los tres tokens están en `mobile/src/constants/theme.ts`, y `mobile/src/constants/__tests__/theme.test.ts` verifica su contraste.

La voz de display es la del brief de "Pista nocturna" (`HANDOFF.md`): `ui-rounded` con peso 800 y numerales tabulares, igual en escritorio, portal y móvil. Se evaluó Barlow Condensed para el móvil y se descartó para no romper la marca compartida.

El portal web comparte la familia de tokens con la app, para que un organizador que salta del navegador al teléfono vea el mismo producto.

## Qué no es

- No es una app de entrenamiento genérica que compite con Strava de frente. El ancla es el cronometraje de carreras reales; el entrenamiento es lo que retiene al corredor entre carreras.
- La app de escritorio **no es una página web** aunque esté hecha con React: corre dentro de pywebview sobre Edge WebView2, en una ventana de escritorio de tamaño conocido. Auditarla con la vara de una web da diagnósticos equivocados.

---

## Lagunas de este documento

Lo que sigue **no se pudo inferir del código** y haría falta preguntarle al dueño:

- Quién es el competidor real y en qué se quiere ganar.
- Cuántos organizadores y cuántos corredores hay hoy, y cuál de los dos lados es el cuello de botella del crecimiento.
- Si la app móvil apunta a publicarse en las tiendas y con qué plazo.
- Qué significa "éxito" para la próxima versión: más carreras cronometradas, más corredores reteniendo, o más suscripciones.
