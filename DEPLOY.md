# Desplegar el portal de LiveRun en Google Cloud Run

Esta guía publica el **portal público** (la web donde los corredores ven y reclaman
sus resultados) en Cloud Run, con la base en Postgres (Neon) y los avatares en un
bucket de Cloud Storage. La app de escritorio no se sube: sigue offline con su
SQLite y solo cambia la URL a la que publica.

Hasta la baja de Render, el portal viejo sigue funcionando: está en el
[Apéndice](#apéndice--render-legado) al final, con sus pasos y su checklist.

## Cómo queda armado

| Pieza | Dónde | Por qué |
|---|---|---|
| Portal (FastAPI) | Cloud Run, región `us-east4`, `max-instances=1` | El rate limit está en memoria: con más de una instancia cada una contaría por separado |
| Base | Neon (Postgres), `us-east-1` | Cloud Run no tiene disco persistente. Neon escala a cero y deja crear *branches* para ensayar |
| Avatares | Bucket `gs://…` montado en `/data/avatars` | Hoy viven en el disco de Render junto a la base |
| Secretos | Secret Manager | Nada de secretos en el repo ni en el workflow |
| Imagen | Artifact Registry (`liverun/portal:<sha>`) | La construye y sube la CI |
| Deploy | Job `deploy-portal` de `.github/workflows/ci.yml` | Corre en push a `main`, solo si pasaron los tests con SQLite y con Postgres |

**Costo estimado:** Cloud Run ~US$0–3/mes con `min-instances=0`; Neon US$0 (free) o
~US$19 (Launch, si se necesita más historia de PITR); el bucket, centavos. Una
instancia siempre prendida (`min-instances=1`) suma ~US$10/mes: ver "Día de carrera".

**Cold start:** con `min-instances=0` la primera visita después de un rato sin tráfico
tarda unos segundos (arranque de Python + migraciones + despertar de Neon). Los
probes de arranque en `/api/health` tienen un timeout amplio por eso.

## Cómo sabe el portal que está en producción

El portal considera que está en producción si `CT_PRODUCCION=1` (lo fija el `Dockerfile`)
o, por compatibilidad, si existe `RENDER`. En producción: exige la firma de los
webhooks de Mercado Pago, la cookie de Google va `Secure`, hay HSTS, no se sirven
`/docs` ni `/openapi.json` y el arranque se niega a usar los secretos por defecto.
**No quites `CT_PRODUCCION` de la imagen:** sin ella el portal arranca en modo desarrollo.

## Variables

Secretos (Secret Manager → `--set-secrets`): `CT_CLOUD_DB`, `CT_CLOUD_SECRET`,
`CT_PUBLISH_KEY`, `CT_MP_ACCESS_TOKEN`, `CT_MP_WEBHOOK_SECRET`, `CT_GOOGLE_CLIENT_ID`,
`CT_GOOGLE_CLIENT_SECRET`, `CT_SMTP_HOST`, `CT_SMTP_PORT`, `CT_SMTP_USER`,
`CT_SMTP_PASSWORD`, `CT_SMTP_FROM`.

Variables del repo en GitHub (Settings → Secrets and variables → Actions → **Variables**;
no son secretas):

| Variable | Qué va |
|---|---|
| `GCP_PROJECT_ID` | ID del proyecto de Google Cloud. **Mientras no exista, el job de deploy se saltea** |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | `projects/<número>/locations/global/workloadIdentityPools/github/providers/github-repo` |
| `GCP_DEPLOY_SERVICE_ACCOUNT` | `liverun-deploy@<proyecto>.iam.gserviceaccount.com` |
| `GCS_AVATARS_BUCKET` | nombre del bucket de avatares |
| `CT_PUBLIC_URL` | URL pública del portal (con dominio propio, esa) |
| `CT_ADMIN_EMAILS` | emails admin, separados por coma |

`CT_AVATAR_DIR=/data/avatars` y `CT_PRODUCCION=1` vienen en el `Dockerfile`.

## Paso 1 — Preparar Google Cloud (una sola vez)

Con `gcloud` instalado y logueado. Reemplazá los valores de ejemplo.

```bash
export PROYECTO=liverun-prod   # el ID que hayas elegido
export REGION=us-east4
export BUCKET=${PROYECTO}-avatares
export REPO=AgustinGirardi/liverun

gcloud config set project $PROYECTO
gcloud services enable run.googleapis.com artifactregistry.googleapis.com \
  secretmanager.googleapis.com iamcredentials.googleapis.com storage.googleapis.com

# Imágenes y avatares
gcloud artifacts repositories create liverun --repository-format=docker --location=$REGION
gcloud storage buckets create gs://$BUCKET --location=$REGION --uniform-bucket-level-access
gcloud storage buckets update gs://$BUCKET --versioning   # respaldo ante un borrado por error

# Cuenta con la que CORRE el portal (mínimos permisos)
gcloud iam service-accounts create liverun-portal
gcloud storage buckets add-iam-policy-binding gs://$BUCKET \
  --member=serviceAccount:liverun-portal@$PROYECTO.iam.gserviceaccount.com --role=roles/storage.objectUser

# Cuenta con la que DESPLIEGA la CI
gcloud iam service-accounts create liverun-deploy
for rol in roles/run.admin roles/artifactregistry.writer; do
  gcloud projects add-iam-policy-binding $PROYECTO \
    --member=serviceAccount:liverun-deploy@$PROYECTO.iam.gserviceaccount.com --role=$rol
done
gcloud iam service-accounts add-iam-policy-binding liverun-portal@$PROYECTO.iam.gserviceaccount.com \
  --member=serviceAccount:liverun-deploy@$PROYECTO.iam.gserviceaccount.com --role=roles/iam.serviceAccountUser

# GitHub Actions entra sin claves JSON (Workload Identity Federation), solo desde este repo
gcloud iam workload-identity-pools create github --location=global
gcloud iam workload-identity-pools providers create-oidc github-repo --location=global \
  --workload-identity-pool=github --issuer-uri=https://token.actions.githubusercontent.com \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
  --attribute-condition="assertion.repository=='$REPO'"
NUMERO=$(gcloud projects describe $PROYECTO --format='value(projectNumber)')
gcloud iam service-accounts add-iam-policy-binding liverun-deploy@$PROYECTO.iam.gserviceaccount.com \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/$NUMERO/locations/global/workloadIdentityPools/github/attribute.repository/$REPO"
echo "GCP_WORKLOAD_IDENTITY_PROVIDER = projects/$NUMERO/locations/global/workloadIdentityPools/github/providers/github-repo"
```

> Los flags de `--add-volume` (volúmenes de Cloud Storage), `domain-mappings` y los
> probes se escribieron según la documentación conocida y **no se probaron contra un
> proyecto real**: si `gcloud` rechaza alguno, `gcloud run deploy --help` dice el
> nombre vigente.

## Paso 2 — Crear la base en Neon

1. En Neon, un proyecto en `AWS us-east-1` (cerca de Cloud Run `us-east4`).
2. Copiá la cadena de conexión **directa** (no la del *pooler*: psycopg 3 y PgBouncer
   en modo transacción no se llevan bien con los prepared statements). Sirve
   `postgresql://usuario:clave@host/base?sslmode=require`: el portal la pasa solo al driver
   `psycopg`.
3. Para ensayar, creá un **branch** aparte con su propia cadena. Nunca ensayes contra la
   rama principal.

## Paso 3 — Cargar los secretos

**Los valores de `CT_CLOUD_SECRET`, `CT_PUBLISH_KEY` y los de Mercado Pago, Google y SMTP
son los mismos que hoy están en Render** (Environment). Si cambian, se invalidan las
sesiones abiertas y la clave de publicación de los escritorios.

```bash
# Un secreto por variable. printf evita el salto de línea final.
printf '%s' 'postgresql://…' | gcloud secrets create ct-cloud-db --data-file=-
printf '%s' '…'              | gcloud secrets create ct-cloud-secret --data-file=-
# Idem: ct-publish-key, ct-mp-access-token, ct-mp-webhook-secret, ct-google-client-id,
# ct-google-client-secret, ct-smtp-host, ct-smtp-port, ct-smtp-user, ct-smtp-password, ct-smtp-from
gcloud secrets add-iam-policy-binding ct-cloud-db \
  --member=serviceAccount:liverun-portal@$PROYECTO.iam.gserviceaccount.com --role=roles/secretmanager.secretAccessor
# (repetir el binding por cada secreto)
```

Los nombres de los secretos son los que usa `--set-secrets` en el job `deploy-portal`.

## Paso 4 — Primer deploy

1. Cargá las variables del repo de la tabla de arriba. Con `GCP_PROJECT_ID` cargada, el
   próximo push a `main` que toque `cloud/`, el `Dockerfile` o el workflow construye la
   imagen y despliega.
2. Para probar sin esperar un push: Actions → CI → *Re-run*, o un commit vacío.
3. Al terminar, el job comprueba `{"status":"ok"}` en la URL `*.run.app`.

Probar la imagen en local (hace falta Docker):

```bash
docker build -t liverun-portal .
docker run --rm -p 8080:8080 -e CT_CLOUD_SECRET=prueba -e CT_PUBLISH_KEY=prueba \
  -e CT_CLOUD_DB=sqlite:////tmp/cloud.db -e CT_AVATAR_DIR=/tmp/avatars liverun-portal
curl -s localhost:8080/api/health    # {"status":"ok"}
```

## Paso 5 — Migrar los datos de SQLite a Postgres

`scripts/migrar_portal_a_postgres.py` copia todas las tablas, reasigna las secuencias de
los ids y compara cantidad y contenido de cada tabla entre origen y destino. Trabaja
sobre una **copia** del origen (el archivo de Render no se toca), corre en una sola
transacción (o entra todo o no entra nada) y se puede repetir con `--vaciar`.

```bash
# 1. En Render (Shell del servicio): copia consistente de la base
python -c "import sqlite3; s=sqlite3.connect('/var/data/cloud.db'); d=sqlite3.connect('/var/data/copia.db'); s.backup(d)"
# 2. Bajala a tu máquina (Render → Shell / SSH; ver la doc de Render si cambió el método)
# 3. Ensayo contra un branch de Neon (la clave va por variable, no por la línea de comandos)
export CT_DESTINO_DB='postgresql://…branch-de-ensayo…'
python scripts/migrar_portal_a_postgres.py --origen sqlite:///copia.db --vaciar
```

Sale con `0` si todo coincide, `1` si alguna tabla difiere y `2` si no pudo correr. Si
falla por un valor más largo que su `VARCHAR`, el mensaje lo dice.

Los **avatares** no están en la base: se copian aparte al bucket
(`gcloud storage cp -r avatars/* gs://$BUCKET/`). Las fotos de Google son URLs y no se mueven.

## Paso 6 — Dominio propio (requisito del corte)

Con `chronotrack-portal.onrender.com` los links compartidos mueren el día que se da de
baja Render. Seguí el [Paso 5 del apéndice](#paso-5--dominio-propio-recomendado) para
elegir y comprar el dominio, y en vez de "Custom Domains" de Render:

```bash
gcloud beta run domain-mappings create --service liverun-portal --domain liverun.com.ar --region $REGION
gcloud beta run domain-mappings describe --domain liverun.com.ar --region $REGION   # registros DNS a crear
```

El mapeo de dominios de Cloud Run está en *preview*. Si diera problemas, la salida es
Cloudflare como proxy hacia la URL `*.run.app`, o un balanceador (~US$18/mes).

Después, igual que antes: redirect URI de Google OAuth (`…/api/run/auth/google/callback`,
dejando el viejo), `CT_PUBLIC_URL` (variable del repo; cambia de una vez el CORS, el
`redirect_uri` de Google y el `back_url` de Mercado Pago) y la **URL del webhook de
Mercado Pago** en su panel. Los valores fijos de instalaciones nuevas (`DEFAULT_PORTAL`
del escritorio, `mobile/src/lib/api.ts`, `mobile/src/app/ranking.tsx` y
`mobile/vercel.json`) se actualizan en un commit aparte, al cortar.

> El escritorio publica con `urllib`, que **no sigue redirecciones de un POST**. Un redirect
> desde Render no sirve para publicar: en cada PC hay que cambiar la URL en ☁ **Portal en la
> nube** antes de que se apague Render.

## Paso 7 — Plan de corte

1. **En paralelo.** Cloud Run corre contra un branch de Neon con una copia de la base de
   Render. Se recorre el portal en la URL `*.run.app` (ver el checklist de abajo) y se miden
   los cold starts. Render sigue siendo el de producción.
2. **Un día antes:** bajar el TTL del DNS a 5 minutos. Elegir un día sin carreras y avisar.
3. **Ventana de corte:**
   1. Pausar la publicación desde el escritorio.
   2. Suspender el servicio en Render (Settings → Suspend), así no entran escrituras.
   3. Copia final de la base y de los avatares (Paso 5).
   4. Correr el script contra la rama **principal** de Neon (`--vaciar` si había ensayo) y ver `Verificado`.
   5. Copiar los avatares al bucket.
   6. Mapear el dominio y esperar el certificado; fijar `CT_PUBLIC_URL` y volver a desplegar.
4. **Después:** Google OAuth, webhook de Mercado Pago, URL en cada escritorio, checklist de abajo.
5. **Respaldo:** Render queda suspendido (recuperable) **2 a 4 semanas** con su disco intacto.
   Volver atrás = reactivar Render y apuntar el DNS de nuevo. Lo que se haya escrito en Neon
   en el medio **no** vuelve a Render: si hace falta, se exporta aparte antes de volver.
6. **Baja:** sin incidentes, bajar un último snapshot del disco, archivarlo, dar de baja el
   servicio, y borrar `render.yaml` y este apéndice. Para los links viejos `/r/CODIGO` de
   `onrender.com`, dejar el servicio chico como redirector 308 al dominio nuevo o aceptar que mueran.

## Día de carrera (`min-instances`)

```bash
# Antes: sin arranque en frío mientras la gente busca su resultado (~US$10/mes mientras esté así)
gcloud run services update liverun-portal --region $REGION --min-instances=1
# Después: volver al costo mínimo
gcloud run services update liverun-portal --region $REGION --min-instances=0
```

Ojo: el próximo deploy de la CI vuelve a fijar `--min-instances 0`.

## Backups

- **Neon:** restauración a un punto en el tiempo (PITR) con la ventana de tu plan. Antes de
  cada cambio de esquema, exportá a mano: `pg_dump -Fc "$CT_DESTINO_DB" > portal-AAAAMMDD.dump`.
- **Avatares:** el bucket tiene versionado (Paso 1).
- Todo vive en el mismo proveedor de cuentas: si perdés el acceso a Neon, perdés también su PITR.
  Por eso el `pg_dump` manual y guardarlo fuera.

## Checklist después de cada deploy

- [ ] El job `deploy-portal` terminó en verde y comprobó `{"status":"ok"}`.
- [ ] `curl -s https://<dominio>/api/health` responde `{"status":"ok"}`.
- [ ] **Producción de verdad:** `https://<dominio>/docs` da 404 y la respuesta trae `strict-transport-security`.
- [ ] Un webhook de Mercado Pago sin firma es rechazado; uno de prueba (`TEST-…`) firmado entra.
- [ ] Logs de Cloud Run: sin `CT_SMTP_HOST no está configurado`, sin el aviso de workers, un solo `Started server process`.
- [ ] Prueba de mail: Ingresar → ¿Olvidaste tu contraseña? → llega el mail.
- [ ] Login con Google; ver un avatar existente; subir uno nuevo y que persista tras un deploy.
- [ ] Buscar una carrera conocida, ver el ranking, un certificado y Administración → Claves.
- [ ] Publicar una carrera desde el escritorio con la URL nueva.
- [ ] Portal en el navegador, tema claro y oscuro, consola **sin violaciones de CSP**.
- [ ] Latencia real del arranque en frío anotada (decide si vale `min-instances=1`).

## Qué verificar en la documentación al implementar

Cosas que dependen de la plataforma y conviene confirmar al hacerlas: el método de
descarga de archivos desde la Shell de Render, la región `us-east-1` de Neon, el mapeo de
dominios en `us-east4`, los volúmenes de Cloud Storage en Cloud Run (`gen2`) y que las IPs
de los clientes lleguen bien en `X-Forwarded-For` (el rate limit usa el último salto).

---

# Apéndice — Render (legado)

Todo lo que sigue es el despliegue en Render, que sigue vivo hasta la baja del Paso 7.
Los pasos 3 (claves de publicación), 4 (app de escritorio) y 6 (mails) valen igual en Cloud
Run: solo cambia dónde se cargan las variables (Secret Manager en vez del Environment de Render).


Esta guía publica el **portal público** (la web donde los corredores ven y reclaman
sus resultados) en internet, con una URL fija y datos que no se borran.

La app de escritorio NO se sube: solo se publica `cloud/` (el portal).

---

### Resumen de lo que vas a tener al final

- Una URL pública, ej: `https://chronotrack-portal.onrender.com`
- Una **API key de publicación** (la generás en Render) para pegar en la app de escritorio
- Base de datos SQLite en un disco persistente (no se pierde al reiniciar)

> 💵 **Costo:** el disco persistente requiere el plan **Starter de Render (~US$7/mes)**.
> El plan gratuito de Render no permite discos, así que perdería los datos en cada reinicio.

---

### Paso 1 — Subir el código a un repo privado de GitHub

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

### Paso 2 — Crear el servicio en Render desde el Blueprint

1. Entrá a https://dashboard.render.com y registrate (podés usar tu cuenta de GitHub).
2. Click en **New → Blueprint**.
3. Conectá tu repo `chronotrack` (Render pedirá permiso para leer tu GitHub privado).
4. Render detecta el archivo **`render.yaml`** y muestra el servicio `chronotrack-portal`.
5. Confirmá. Render va a:
   - Instalar dependencias (`pip install -r cloud/requirements.lock`)
   - Crear el disco persistente de 1 GB en `/var/data`
   - Generar automáticamente `CT_PUBLISH_KEY` y `CT_CLOUD_SECRET`
   - Levantar el portal

El primer deploy tarda unos minutos. Cuando termine, vas a ver la URL pública arriba.

---

### Paso 3 — Obtener la API key de publicación

Cada organizador tiene su propia clave (`lr_pub_…`), emitida desde el portal por una
cuenta admin (`CT_ADMIN_EMAILS`) en **Administración → Claves**. Se muestra **una sola
vez**: copiala en el momento.

- **Crear clave:** para un organizador nuevo. Empieza sin carreras.
- **Rotar:** la clave anterior deja de funcionar y las carreras quedan con la nueva.
- **Revocar:** corta la publicación; las carreras siguen publicadas.

##### Pasar al organizador original de la `CT_PUBLISH_KEY` global a su clave personal

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

### Paso 4 — Configurar la app de escritorio

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

### Paso 5 — Dominio propio (recomendado)

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

### Paso 6 — Mails (verificar email y "olvidé mi contraseña")

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

### Checklist después de cada deploy (a mano, en el dashboard de Render)

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

### Verificar que funciona

- Abrí tu URL de Render en el navegador → deberías ver el portal.
- Publicá una carrera desde la app → debería aparecer en el listado del portal.
- Probá crear una cuenta de corredor y reclamar un resultado.

---

### Notas

#### Cambiar la región (latencia)
En `render.yaml`, el campo `region:` está en `ohio`. Para Argentina, `ohio` suele ser
la opción más rápida de las disponibles. No hay región en Sudamérica en Render.

#### Si querés empezar gratis (sin disco persistente)
Podés cambiar `plan: starter` por `plan: free` y **quitar el bloque `disk:`**, pero
entonces los datos del portal se borran en cada reinicio. Solo sirve para probar.
Para producción, dejá el plan Starter con disco.

#### Respaldo de la base del portal
La base vive en `/var/data/cloud.db` dentro del disco persistente de Render.
Render permite tomar snapshots del disco. Para un respaldo manual podés usar el
"Shell" del servicio en el dashboard y descargar el archivo.

#### Migrar a Postgres en el futuro
El código usa SQLAlchemy genérico. Para escalar, podés crear un Postgres en Render
y cambiar `CT_CLOUD_DB` por la URL de Postgres (`postgresql+psycopg://...`),
agregando `psycopg[binary]` a `cloud/requirements.txt` (y regenerando el lock). Sin reescribir lógica.

#### Git: inicializar manualmente (si hiciera falta)
```bash
git init
git add .
git commit -m "ChronoTrack: portal cloud listo para deploy"
```
