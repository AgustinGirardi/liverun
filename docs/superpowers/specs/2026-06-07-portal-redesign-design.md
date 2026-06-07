# Rediseño del Portal Cloud de ChronoTrack — Documento de Diseño

**Fecha:** 2026-06-07
**Estado:** Diseño aprobado (Parte 1 y Parte 2). Pendiente de plan de implementación.
**Autor:** Agustín Girardi (con Claude)

---

## 1. Contexto y problema

El portal cloud (`cloud/`) sirve una SPA estática (`cloud/static/index.html`) que permite
al público buscar carreras y resultados, y a los corredores reclamar (claim) sus resultados
para verlos en un perfil personal.

El usuario reporta que la web actual **"es incómoda para buscar las carreras y para el
usuario"**. Dos problemas concretos:

1. **Navegación/búsqueda incómoda:** no hay una forma rápida y siempre-accesible de buscar
   carreras o corredores; la distribución de la información cuesta.
2. **Vinculación manual tediosa:** para ver sus resultados, el corredor debe reclamar a mano
   cada resultado (código de carrera + dorsal + apellido). Es fricción innecesaria cuando el
   organizador ya cargó su email en el escritorio.

### Restricción transversal de privacidad (Ley 25.326)

El portal cloud **NUNCA** almacena DNI, fecha de nacimiento ni email en texto plano de los
corredores. Solo viajan y se guardan datos públicos de resultado: nombre, dorsal, categoría,
club, distancia, tiempos, posición y estado. Cualquier feature nueva debe respetar esto.

---

## 2. Objetivos

- **G1.** Rediseñar la navegación y la búsqueda para que encontrar una carrera o un corredor
  sea inmediato (barra de búsqueda unificada, siempre visible).
- **G2.** Rediseñar la distribución y la estética (tema claro por defecto + toggle oscuro,
  paleta nueva, jerarquía visual clara).
- **G3.** Auto-vincular los resultados de un corredor a su perfil web a partir del email que
  el organizador cargó en el escritorio, **sin** que el portal almacene el email en claro.
- **G4.** Mantener el modelo de despliegue actual: SPA estática sin paso de build, FastAPI
  sync en el cloud, auto-deploy en Render al pushear `cloud/**`.

### No-objetivos

- No se cambia el modelo de autenticación (sigue HMAC + PBKDF2).
- No se introduce un framework frontend ni build step (sigue siendo estático).
- No se agregan datos personales nuevos al snapshot publicado (más allá del hash, ver §4).
- No se implementa deep-linking por URL en esta iteración (la SPA navega por estado interno).

---

## 3. Parte 1 — Rediseño visual y de navegación

### 3.1 Decisiones aprobadas

- **Home híbrido:** una sola página de inicio que da igual peso a "buscar tu resultado" y
  "explorar carreras" (el usuario eligió *"las dos por igual"*).
- **Estética:** tema claro por defecto + toggle a oscuro (el usuario eligió *"claro + toggle
  oscuro"*), implementado con CSS custom properties y atributo `data-theme`, persistido en
  `localStorage`.
- **Búsqueda unificada:** una única barra que busca a la vez **corredores** (por nombre) y
  **carreras** (por nombre/lugar), siempre accesible desde una barra de navegación superior fija.

### 3.2 Estructura de pantallas

#### Barra superior fija (presente en todas las vistas)

```
┌──────────────────────────────────────────────────────────────────┐
│  ChronoTrack      [ 🔎 Buscar corredor o carrera...        ]   ◐  │  ← ◐ = toggle tema
│                                                        [Perfil/Entrar] │
└──────────────────────────────────────────────────────────────────┘
```

- Logo a la izquierda → vuelve al home.
- Barra de búsqueda central, **siempre visible** (resuelve G1).
- A la derecha: toggle de tema (◐) + botón Perfil (si logueado) o Entrar/Registrarse.

#### Home híbrido

```
┌──────────────────────────────────────────────────────────────────┐
│                                                                    │
│              🏁  Encontrá tu resultado                             │
│        [ 🔎 Tu nombre o el nombre de la carrera...        ]        │
│                                                                    │
│   ── o explorá las carreras ──────────────────────────────────    │
│                                                                    │
│   ┌────────────┐  ┌────────────┐  ┌────────────┐                  │
│   │ Carrera A  │  │ Carrera B  │  │ Carrera C  │   (cards         │
│   │ 📍 Lugar   │  │ 📍 Lugar   │  │ 📍 Lugar   │    recientes)    │
│   │ 📅 Fecha   │  │ 📅 Fecha   │  │ 📅 Fecha   │                  │
│   │ N resultados│ │ N resultados│ │ N resultados│                 │
│   └────────────┘  └────────────┘  └────────────┘                  │
└──────────────────────────────────────────────────────────────────┘
```

- Hero con búsqueda grande (la misma lógica que la barra superior).
- Debajo, grid de cards de carreras recientes (las últimas publicadas).

#### Resultados de búsqueda unificada

Una página dividida en dos secciones con el mismo término de búsqueda:

```
┌──────────────────────────────────────────────────────────────────┐
│  Resultados para "garcia"                                          │
│                                                                    │
│  CORREDORES (8)                                                    │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │ Juan García · Carrera A · 10K · 00:45:12 · Puesto 12     │ →  │
│  │ María García · Carrera B · 5K · 00:28:03 · Puesto 4      │ →  │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                    │
│  CARRERAS (2)                                                      │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │ Maratón García 2026 · 📍 Lugar · 📅 Fecha                │ →  │
│  └──────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────┘
```

#### Página de carrera

```
┌──────────────────────────────────────────────────────────────────┐
│  Maratón Ciudad 2026   📍 Lugar · 📅 Fecha                        │
│                                                                    │
│         🥇 Juan P.        🥈 Ana G.        🥉 Luis M.             │  ← podio top-3
│         00:31:02          00:32:15         00:33:40               │
│                                                                    │
│  [ 🔎 Filtrar por nombre/dorsal ]   [Distancia ▾]  [Categoría ▾] │  ← filtro instantáneo
│  ┌──────────────────────────────────────────────────────────┐    │
│  │ Pos  Dorsal  Nombre        Cat    Club     T.neto         │    │
│  │  1    123    Juan P.       M30    Club X   00:31:02       │    │
│  │  ...                                                       │    │
│  └──────────────────────────────────────────────────────────┘    │
│  ▸ No finalizaron (DNF/DNS/DQ)  (sección colapsable)              │
└──────────────────────────────────────────────────────────────────┘
```

- Podio top-3 destacado por distancia principal.
- Filtro instantáneo client-side (nombre/dorsal) + selects de distancia y categoría.
- Sección "No finalizaron" colapsable al final (ya existe la lógica DNF; se reestiliza).

#### Perfil / Dashboard del corredor (logueado)

```
┌──────────────────────────────────────────────────────────────────┐
│  Hola, Juan García                                                 │
│                                                                    │
│  Mis marcas personales:  5K 00:24:10 · 10K 00:51:30               │
│                                                                    │
│  Mis carreras (4)                          [🔄 Buscar por email]  │  ← botón manual (Parte 2)
│  ┌──────────────────────────────────────────────────────────┐    │
│  │ Carrera A · 10K · 00:45:12 · Puesto 12                    │ →  │
│  │ Carrera B · 5K · 00:28:03 · Puesto 4                      │ →  │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                    │
│  ¿Falta alguna? [Reclamar por código]   (claim manual fallback)   │
└──────────────────────────────────────────────────────────────────┘
```

### 3.3 Paleta (tema claro por defecto)

| Token        | Valor      | Uso                                  |
|--------------|------------|--------------------------------------|
| `--bg`       | `#F7F9FA`  | Fondo general                        |
| `--surface`  | `#FFFFFF`  | Cards, tablas                        |
| `--text`     | `#0E1A22`  | Texto principal                      |
| `--muted`    | `#5B6B75`  | Texto secundario                     |
| `--acc`      | `#00B383`  | Acento (botones, links, podio 🥇)    |
| `--warn`     | `#E5772A`  | Estados DNF/alertas                  |
| `--border`   | `#E3E9ED`  | Bordes sutiles                       |

El tema oscuro redefine estos mismos tokens bajo `[data-theme="dark"]`. Toda la UI consume
**solo** los tokens (sin colores hardcodeados), de modo que el toggle es un cambio de atributo.

### 3.4 Enfoque técnico (recomendado: opción B)

El `index.html` actual concentra HTML + CSS + JS en un solo archivo grande, lo que dificulta
el rediseño. Se propone **separar en tres archivos estáticos** servidos por el mismo
`StaticFiles` mount (sigue sin build step):

- `cloud/static/index.html` — markup + contenedores de vistas.
- `cloud/static/styles.css` — tokens de tema, layout, componentes.
- `cloud/static/app.js` — router por estado (`go(view, arg)`), fetch a la API, render.

Beneficio: separación de responsabilidades, diffs revisables, sin tooling nuevo. El `esc()`
(escapador HTML seguro ya existente) se mantiene para todo render de datos del usuario.

---

## 4. Parte 2 — Auto-vinculación por hash de email

### 4.1 Decisión aprobada

El usuario eligió **hash del email** (privacy-preserving) y **auto-vinculación + botón manual**:
auto-vincula en registro e inicio de sesión, y además ofrece un botón "Buscar mis resultados
por email" en el perfil para re-ejecutar la búsqueda cuando aparezcan carreras nuevas.

### 4.2 Modelo de hash

```
email_hash = sha256("chronotrack-v1:" + email.strip().lower()).hexdigest()
```

- El prefijo `"chronotrack-v1:"` actúa como dominio/versión del hash (permite rotar el
  esquema en el futuro sin colisionar con hashes viejos).
- Se calcula **en el escritorio** al publicar (el escritorio sí tiene el email) y también
  **en el cloud** al registrarse/loguear (el cloud hashea el email de la cuenta del usuario).
- El cloud **nunca** recibe ni guarda el email en claro del corredor; solo el hash. El email
  de la **cuenta** (`PortalUser.email`) ya se guarda hoy y no cambia.

> Nota de privacidad: un hash de email no es reversible, pero es enumerable si el atacante ya
> tiene un email candidato. Esto es aceptable porque el `email_hash` nunca se expone por la
> API pública (solo se usa server-side para el match) y porque no se asocia a DNI/fecha. El
> prefijo versionado permite migrar a un hash con secreto (HMAC con `CT_CLOUD_SECRET`) si más
> adelante se decide endurecerlo.

### 4.3 Cambios de datos

**`cloud/models.py` — `PublishedResult`:** nueva columna

```python
email_hash = Column(String(64), nullable=True, index=True)  # sha256 hex, privacy-preserving
```

- **Nullable** → migración suave: los resultados publicados antes de este cambio quedan con
  `email_hash = NULL` y siguen funcionando (se reclaman por el flujo manual).
- **Indexada** → el match `email_hash == ?` es O(log n).
- La DB se crea con `init_db()` (create_all). En SQLite, `create_all` no agrega columnas a
  tablas existentes; el plan de implementación debe incluir el **ALTER TABLE / migración** de
  `cloud.db` para añadir la columna a la tabla ya existente en Render. (Detalle a resolver en
  el plan; opciones: `ALTER TABLE ... ADD COLUMN` idempotente en el startup, o re-publicación
  que recrea filas.)

### 4.4 Cambios en el escritorio (publicación)

`backend/api/routes.py :: publish_race` arma el dict de cada resultado. Hoy NO incluye email.
Cambio: calcular el hash a partir de `row.runner.email` (disponible) y agregarlo al dict, sin
incluir el email en claro:

```python
def _email_hash(email: str | None) -> str | None:
    e = (email or "").strip().lower()
    if not e:
        return None
    return hashlib.sha256(("chronotrack-v1:" + e).encode()).hexdigest()
```

- Se agrega `"email_hash": _email_hash(row.runner.email)` tanto al loop de `data.results`
  como al de `data.dnf_list`.
- **Importante (despliegue):** este cambio es del **escritorio** → requiere `build.bat` para
  llegar a los organizadores. Las carreras publicadas con versiones viejas del `.exe` no
  enviarán hash hasta que el organizador actualice y re-publique → el claim manual cubre ese caso.

### 4.5 Cambios en el cloud (ingreso + matching)

**Schema `PublishResult` (`cloud/main.py`):** agregar campo opcional

```python
email_hash: Optional[str] = None
```

Como `publish()` hace `PublishedResult(race_id=race.id, **r.model_dump())`, el hash entra
automáticamente al persistir. Si el escritorio no lo manda (versión vieja), llega `None`.

**Helper de auto-vinculación:**

```python
def _autolink(user: PortalUser, db: Session) -> int:
    """Vincula a `user` todos los resultados cuyo email_hash coincide con su email de cuenta.
    Devuelve cuántos vínculos NUEVOS creó. No duplica (respeta uq_user_result)."""
    h = hashlib.sha256(("chronotrack-v1:" + user.email.strip().lower()).encode()).hexdigest()
    results = db.scalars(
        select(PublishedResult).where(PublishedResult.email_hash == h)
    ).all()
    created = 0
    for res in results:
        exists = db.scalar(select(Claim).where(
            Claim.user_id == user.id, Claim.result_id == res.id))
        if not exists:
            db.add(Claim(user_id=user.id, result_id=res.id))
            created += 1
    if created:
        db.commit()
    return created
```

**Puntos de invocación:**

- `register` → tras crear el `PortalUser`, llamar `_autolink(user, db)`.
- `login` → tras autenticar, llamar `_autolink(user, db)` (recoge carreras publicadas desde
  el último ingreso).
- **Nuevo endpoint** `POST /api/me/autolink` (autenticado) → llama `_autolink(user, db)` y
  devuelve `{"linked": N}`. Lo usa el botón manual "Buscar mis resultados por email" del perfil.
  Sujeto a `rate_limit` (reutiliza el bucket de `claim`, 40/min).

**Fallback manual:** el claim por código/dorsal/apellido (`/api/me/claim`) se mantiene tal
cual para resultados sin `email_hash` (publicados con escritorio viejo o sin email cargado).

### 4.6 UX del resultado

- Tras registro/login con vínculos nuevos: toast **"Vinculamos N resultados a tu perfil"**.
- Botón en el perfil **"🔄 Buscar mis resultados por email"** → llama al endpoint, refresca la
  lista y muestra el toast (o "No encontramos resultados nuevos").
- Si `N == 0` en registro/login, no se muestra toast (evita ruido).

---

## 5. Compatibilidad y migración

| Escenario | Comportamiento |
|-----------|----------------|
| Resultado publicado antes del cambio (`email_hash = NULL`) | No auto-vincula; sigue disponible por claim manual. |
| Organizador con `.exe` viejo | Publica sin hash; sus corredores usan claim manual hasta que actualice. |
| Corredor sin email cargado en el escritorio | `email_hash = NULL`; claim manual. |
| Email de cuenta ≠ email cargado por el organizador | No matchea; claim manual (caso esperado y correcto). |
| Re-publicación de una carrera | `publish()` borra y recrea resultados → recalcula hashes; los Claims por `result_id` viejo se pierden al borrarse el resultado (comportamiento actual ya existente, a validar en el plan). |

> ⚠️ **A resolver en el plan:** la re-publicación hace `db.delete(old)` de los resultados y
> recrea filas nuevas (IDs nuevos), lo que cascada-borra los `Claim` asociados. Con
> auto-vinculación esto se "auto-repara" en el próximo login/botón manual, pero hay que
> confirmar que no rompa perfiles ya vinculados de forma visible. Evaluar match por
> `email_hash` en lugar de re-crear Claims, o re-vincular tras re-publicar.

---

## 6. Resumen de archivos afectados

| Archivo | Cambio |
|---------|--------|
| `cloud/static/index.html` | Reescritura de markup; separar CSS/JS (opción B). |
| `cloud/static/styles.css` | **Nuevo**: tokens de tema, layout, componentes. |
| `cloud/static/app.js` | **Nuevo**: router por estado, fetch API, render. |
| `cloud/models.py` | Columna `PublishedResult.email_hash`. |
| `cloud/main.py` | Campo `email_hash` en `PublishResult`; helper `_autolink`; llamadas en register/login; endpoint `/api/me/autolink`; migración de columna en startup. |
| `backend/api/routes.py` | `_email_hash()` + `email_hash` en el payload de `publish_race`. |

**Despliegue:** cambios en `cloud/**` auto-deployan en Render al pushear. El cambio en
`backend/api/routes.py` requiere `build.bat` para llegar a los organizadores.

---

## 7. Riesgos y mitigaciones

- **Riesgo:** migración de columna en SQLite de producción. **Mitigación:** `ALTER TABLE ADD
  COLUMN` idempotente en startup (verificar si la columna existe antes de añadirla).
- **Riesgo:** enumeración de hashes de email. **Mitigación:** el hash nunca se expone por la
  API; prefijo versionado permite migrar a HMAC con secreto si se requiere endurecer.
- **Riesgo:** reescritura grande del frontend rompe funcionalidad existente (búsqueda, claim,
  temas). **Mitigación:** implementación incremental ("lo vamos armando"), conservando la
  lógica de API y `esc()`; el plan debe ir vista por vista.
- **Riesgo:** Claims perdidos al re-publicar. **Mitigación:** ver §5; resolver en el plan.
