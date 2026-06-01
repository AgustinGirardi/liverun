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

Desde la carpeta del proyecto (`C:\Users\agust\chronotrack`):

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

## Paso 3 — Copiar la API key de publicación

1. En el dashboard de Render, abrí el servicio `chronotrack-portal`.
2. Andá a la pestaña **Environment**.
3. Buscá `CT_PUBLISH_KEY` y hacé click en el ojito 👁 para revelar el valor. Copialo.

Esa es la clave que conecta tu app de escritorio con el portal.

---

## Paso 4 — Configurar la app de escritorio

1. Abrí ChronoTrack en tu PC.
2. Barra lateral → **☁ Portal en la nube**.
3. Completá:
   - **URL del portal:** la URL de Render, ej. `https://chronotrack-portal.onrender.com`
   - **API key de publicación:** la que copiaste en el Paso 3.
4. Guardar.

Listo. Ahora, en cualquier carrera, el botón **☁ Publicar** sube los resultados
al portal y te devuelve el código para que los corredores la busquen.

---

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
