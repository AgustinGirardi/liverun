# Desplegar el portal ChronoTrack en Render

Esta guía publica el **portal público** (la web donde los corredores ven y reclaman
sus resultados) en internet, con una URL fija y datos que no se borran.

La app de escritorio NO se sube: solo se publica `cloud/` (el portal).

---

## Resumen de lo que vas a tener al final

- Una URL pública, ej: `https://chronotrack-portal.onrender.com`
- Una **API key de publicación** (la generás en Render) para pegar en la app de escritorio
- Base de datos SQLite en un disco persistente (no se pierde al reiniciar)

> 💵 **Costo:** el disco persistente requiere el plan **Starter de Render (~US$7/mes)**.
> El plan gratuito de Render no permite discos, así que perdería los datos en cada reinicio.

---

## Paso 1 — Subir el código a un repo privado de GitHub

Desde la carpeta del proyecto:

```bash
# (Ya inicializamos git y dejamos el primer commit listo. Si no, ver "Notas" abajo.)

# 1. Creá un repo privado en GitHub (https://github.com/new), por ejemplo "chronotrack".
#    NO agregues README ni .gitignore desde GitHub (ya los tenemos).

# 2. Conectá tu repo local con el de GitHub y subí:
git remote add origin https://github.com/TU_USUARIO/chronotrack.git
git branch -M main
git push -u origin main
```

> El `.gitignore` ya evita subir bases de datos, secretos (`chronotrack_cloud.json`),
> instaladores y artefactos de build.

---

## Paso 2 — Crear el servicio en Render desde el Blueprint

1. Entrá a https://dashboard.render.com y registrate (podés usar tu cuenta de GitHub).
2. Click en **New → Blueprint**.
3. Conectá tu repo `chronotrack` (Render pedirá permiso para leer tu GitHub privado).
4. Render detecta el archivo **`render.yaml`** y muestra el servicio `chronotrack-portal`.
5. Confirmá. Render va a:
   - Instalar dependencias (`pip install -r cloud/requirements.txt`)
   - Crear el disco persistente de 1 GB en `/var/data`
   - Generar automáticamente `CT_PUBLISH_KEY` y `CT_CLOUD_SECRET`
   - Levantar el portal

El primer deploy tarda unos minutos. Cuando termine, vas a ver la URL pública arriba.

---

## Paso 3 — Obtener la API key de publicación

Cada organizador tiene su propia clave (`lr_pub_…`), emitida desde el portal por una
cuenta admin (`CT_ADMIN_EMAILS`) en **Administración → Claves**. Se muestra **una sola
vez**: copiala en el momento.

- **Crear clave:** para un organizador nuevo. Empieza sin carreras.
- **Rotar:** la clave anterior deja de funcionar y las carreras quedan con la nueva.
- **Revocar:** corta la publicación; las carreras siguen publicadas.

#### Pasar al organizador original de la `CT_PUBLISH_KEY` global a su clave personal

La `CT_PUBLISH_KEY` que genera Render (pestaña **Environment**) sigue valiendo hasta que
se la rote o revoque, así una app de escritorio ya configurada no se queda afuera. Para
que no publique cualquiera que tenga la app, **en este orden**:

1. **Registrar la global.** Desde el escritorio, publicá o republicá una carrera con la
   configuración actual. Eso crea en **Claves** la fila **"Organizador original"**; hasta
   que exista, la global sigue valiendo y no hay nada que rotar.
2. **Rotar esa fila** ("Organizador original" → **Rotar**) y copiar la clave nueva.
   Usá *Rotar* y no *Crear clave*: rotar le pasa las carreras ya publicadas a la clave
   nueva. Con una clave recién creada, esas carreras quedan a nombre de la global y al
   republicarlas el portal responde 403 ("fue publicada por otro organizador").
   Desde este momento la global ya no sirve.
3. **Cargarla en el escritorio:** ☁ **Portal en la nube** → pegar la clave → Guardar
   (ver Paso 4).
4. **Comprobar:** republicá una carrera. Tiene que publicar sin error y la fila de
   **Claves** muestra el *último uso* recién actualizado. Si el paso 3 sale mal no
   quedás afuera: **Rotar** de nuevo tantas veces como haga falta.
5. **Cinturón y tirantes (opcional):** en Render → Environment, cambiá `CT_PUBLISH_KEY`
   por otro valor. No se puede borrar: el portal se niega a arrancar sin una definida
   (`_startup` en `cloud/main.py`). Ya no la usa nadie.

Para otro organizador: **Crear clave** con su nombre y pasársela por un canal privado.

---

## Paso 4 — Configurar la app de escritorio

1. Abrí ChronoTrack en tu PC.
2. Barra lateral → **☁ Portal en la nube**.
3. Completá:
   - **URL del portal:** la URL de Render, ej. `https://chronotrack-portal.onrender.com`
   - **API key de publicación:** la que copiaste en el Paso 3.
4. Guardar.

> Si el equipo tiene la variable de entorno `CT_PUBLISH_KEY`, esa **pisa** la clave que
> guardes acá. El modal lo avisa; quitá la variable para que valga la clave nueva.
> La clave se guarda en `chronotrack_cloud.json`, junto a la base de datos del escritorio.

Listo. Ahora, en cualquier carrera, el botón **☁ Publicar** sube los resultados
al portal y te devuelve el código para que los corredores la busquen.

---

## Paso 5 — Dominio propio (recomendado)

`chronotrack-portal.onrender.com` es el nombre del servicio en Render: si algún día
te mudás de proveedor, esa URL muere y con ella todos los links de resultados que
los corredores ya compartieron. Un dominio propio te independiza para siempre.

**El orden importa.** Si cambiás `CT_PUBLIC_URL` antes de que el dominio resuelva,
se rompe el login con Google.

1. **Comprar el dominio.** `liverun.com.ar` está libre. Se registra en
   [nic.ar](https://nic.ar) y pide Clave Fiscal de AFIP. Si preferís evitar ese
   trámite, `liverun.app` y `liverun.run` también están libres en cualquier
   registrador internacional (~US$15/año). `liverun.com` ya está tomado.

2. **Render → el servicio → Settings → Custom Domains → Add.** Cargá
   `liverun.com.ar` y `www.liverun.com.ar`. Render te muestra los registros DNS
   exactos que hay que crear.

3. **DNS en el registrador.** NIC.ar no ofrece panel de DNS: lo práctico es poner
   los nameservers de Cloudflare (gratis) y administrar los registros ahí.
   - raíz (`liverun.com.ar`) → registro **ALIAS/ANAME** al host que indique Render
   - `www` → **CNAME** a `chronotrack-portal.onrender.com`

4. **Esperar el certificado.** Render emite el TLS con Let's Encrypt solo; el
   dashboard pasa a "Certificate issued" en minutos u horas según propague el DNS.
   No sigas hasta ver eso.

5. **Google OAuth.** Google Cloud Console → Credenciales → el cliente OAuth →
   *Authorized redirect URIs* → agregar
   `https://liverun.com.ar/api/run/auth/google/callback`. Dejá también el viejo
   mientras queden apps móviles publicadas con la URL anterior.

6. **El interruptor.** Render → Environment → agregar
   `CT_PUBLIC_URL=https://liverun.com.ar`. El servicio reinicia solo. Esa variable
   cambia de una sola vez el origen permitido por CORS, el `redirect_uri` de Google
   y la `back_url` de Mercado Pago (`cloud/main.py`, `cloud/google_auth.py`,
   `cloud/billing.py`, `cloud/run.py` ya la leen).

7. **Valores fijos que solo afectan instalaciones nuevas**, para actualizar después:
   - `backend/core/account.py` → `DEFAULT_PORTAL` (escritorio recién instalado; los
     que ya están instalados guardan su URL en la config de nube y no se tocan)
   - `mobile/src/lib/api.ts` y `mobile/src/app/ranking.tsx` (requiere republicar la app)

**Qué NO se rompe:** `chronotrack-portal.onrender.com` sigue respondiendo como
origen, así que los links `/r/CODIGO` ya compartidos siguen abriendo. Los avatares
se guardan con ruta relativa y la URL completa se arma al responder con
`CT_PUBLIC_URL` (`cloud/run.py`), así que pasan solos al dominio nuevo. Las fotos
que vienen de Google se guardan enteras y no se tocan.

---

## Paso 6 — Mails (verificar email y "olvidé mi contraseña")

El portal manda dos mails: el de verificación al crear la cuenta y el link para
elegir contraseña nueva. **Sin configurar un remitente, esos mails no salen**: el
portal arranca igual y deja un aviso en el log (`CT_SMTP_HOST no está
configurado`), pero nadie puede verificar su email ni recuperar la contraseña.

En Render → servicio → **Environment**, cargá:

| Variable | Qué va |
|---|---|
| `CT_SMTP_HOST` | servidor SMTP |
| `CT_SMTP_PORT` | `587` (STARTTLS) o `465` (SSL) |
| `CT_SMTP_USER` | usuario SMTP |
| `CT_SMTP_PASSWORD` | contraseña SMTP |
| `CT_SMTP_FROM` | remitente visible, ej. `LiveRun <no-responder@tudominio.com>` |
| `CT_PUBLIC_URL` | la URL del portal (con dominio propio, esa); los links del mail apuntan acá |

Opciones de remitente:

- **Gmail** (lo más rápido para arrancar): `smtp.gmail.com`, puerto `587`, usuario =
  tu cuenta de Gmail, contraseña = una **contraseña de aplicación** (Cuenta de
  Google → Seguridad → Verificación en 2 pasos → Contraseñas de aplicaciones; la
  contraseña normal no sirve). El remitente tiene que ser esa misma cuenta.
  Tope de ~500 mails por día.
- **Brevo** o **Resend** (mejor para dominio propio y para no caer en spam): los
  dos dan un SMTP (`smtp-relay.brevo.com:587` / `smtp.resend.com:465`, usuario
  `resend` y la API key como contraseña). Hay que verificar el dominio en su
  panel (registros DNS SPF/DKIM) para usar `no-responder@tudominio.com`.

Después de guardar, Render redeploya solo. Para probar: en el portal, **Ingresar →
¿Olvidaste tu contraseña?** con tu email; tiene que llegar el mail (mirá spam la
primera vez). Si no llega, el log del servicio dice por qué (`No se pudo mandar
el mail ...`).

Las cuentas que ya existían: las que entran con Google quedan verificadas solas;
las de email y contraseña ven un aviso en el inicio para verificar.

## Checklist después de cada deploy (a mano, en el dashboard de Render)

Lo que el repo ya garantiza: `render.yaml` apunta el health check a `/api/health`
(un `SELECT 1`, con test) y declara `CT_PUBLIC_URL` y `CT_SMTP_*`. Lo que solo se ve en
el dashboard:

- [ ] **Antes de pushear algo que crea tablas o columnas:** Disks → *Create snapshot*.
- [ ] El deploy llega a **Live** y Settings → *Health Check Path* dice `/api/health`.
- [ ] `curl -s https://chronotrack-portal.onrender.com/api/health` responde `{"status":"ok"}`.
- [ ] Environment: `CT_PUBLIC_URL` y `CT_SMTP_HOST/PORT/USER/PASSWORD/FROM` con valor
      (son `sync: false`: el Blueprint las crea vacías).
- [ ] Logs de arranque **sin** `CT_SMTP_HOST no está configurado` y **sin** el aviso de
      "workers con el rate limit en memoria"; un solo `Started server process`.
- [ ] Prueba de mail: Ingresar → ¿Olvidaste tu contraseña? → llega el mail.
- [ ] Portal en el navegador, tema claro y oscuro (inicio, buscar, calendario, progreso,
      cuenta, admin → Claves), con la consola **sin violaciones de CSP**.
- [ ] Disks: snapshots automáticos activos; anotar la fecha del último manual.

## Verificar que funciona

- Abrí tu URL de Render en el navegador → deberías ver el portal.
- Publicá una carrera desde la app → debería aparecer en el listado del portal.
- Probá crear una cuenta de corredor y reclamar un resultado.

---

## Notas

### Cambiar la región (latencia)
En `render.yaml`, el campo `region:` está en `ohio`. Para Argentina, `ohio` suele ser
la opción más rápida de las disponibles. No hay región en Sudamérica en Render.

### Si querés empezar gratis (sin disco persistente)
Podés cambiar `plan: starter` por `plan: free` y **quitar el bloque `disk:`**, pero
entonces los datos del portal se borran en cada reinicio. Solo sirve para probar.
Para producción, dejá el plan Starter con disco.

### Respaldo de la base del portal
La base vive en `/var/data/cloud.db` dentro del disco persistente de Render.
Render permite tomar snapshots del disco. Para un respaldo manual podés usar el
"Shell" del servicio en el dashboard y descargar el archivo.

### Migrar a Postgres en el futuro
El código usa SQLAlchemy genérico. Para escalar, podés crear un Postgres en Render
y cambiar `CT_CLOUD_DB` por la URL de Postgres (`postgresql+psycopg://...`),
agregando `psycopg[binary]` a `cloud/requirements.txt`. Sin reescribir lógica.

### Git: inicializar manualmente (si hiciera falta)
```bash
git init
git add .
git commit -m "ChronoTrack: portal cloud listo para deploy"
```
