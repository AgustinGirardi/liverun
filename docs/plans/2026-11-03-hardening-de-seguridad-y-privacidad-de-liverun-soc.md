# Hardening de seguridad y privacidad de LiveRun (SOC 2 / ISO 27001 / ISO 27701 / PCI "CISP" / OWASP / CIS / NIST)

## Contexto

LiveRun está en producción con carreras reales y maneja datos personales: nombre, dorsal, club, tiempos y hash de email de los corredores; cuentas con email y contraseña; recorridos GPS de la app móvil (revelan dónde vive la persona); y suscripciones por Mercado Pago. El escritorio guarda además DNI, fecha de nacimiento y email en su SQLite local. El repo es público.

Ya hay una base sólida (auditoría del 21/10, `cloud/tests/test_hardening.py`, CI con `pip-audit`): CSP sin `unsafe-inline`, CORS cerrado, HSTS en producción, secretos que frenan el arranque, rate limit que no confía en headers del cliente, claves de publicación por organizador con rotación/revocación, webhooks de MP firmados, borrado de cuenta, `email_hash` en vez de email. Lo que falta es **formalizarlo contra los marcos**: no hay inventario de datos, política de privacidad, consentimiento, exportación de datos, log de auditoría, política de sesiones, firma de OTA ni documentos de proceso (incidentes, accesos, backups, cambios).

El portal está en plena migración Render → Cloud Run + Neon (`DEPLOY.md`, `PENDIENTES.md` §7). El plan tiene que valer para los dos entornos y no interferir con el corte.

Resultado buscado: un gap analysis priorizado, cambios de código por fases con tests, y documentación en `docs/seguridad/`, separando qué es código de qué es tarea organizativa.

## Hallazgos del análisis (brechas principales)

| # | Control (marco) | Estado actual | Cambio propuesto | Riesgo |
|---|---|---|---|---|
| 1 | Autenticación y sesiones (NIST 800-63B, ASVS V2/V3, ISO A.8.5, SOC2 CC6.1) | `cloud/security.py`: token HMAC propio de 30 días, sin revocación individual ni logout en servidor (solo `tokens_valid_from` global); acepta el formato viejo de 3 partes sin `iat`; PBKDF2-SHA256 con 200 000 iteraciones (OWASP pide ≥600 000); contraseña mínima 8 sin chequeo de contraseñas filtradas; el rate limit de login es solo por IP (15/min), sin bloqueo por cuenta | Subir iteraciones con rehash transparente al loguear; token de 30 → 7–14 días con renovación; retirar el formato de 3 partes; límite de login por cuenta (`rate_limit_key`) con backoff; blocklist de contraseñas comunes; endpoint de logout que mueva `tokens_valid_from` | Alto |
| 2 | Control de acceso por rol (OWASP API1/API5, ISO A.5.15) | Roles: corredor, admin (`require_admin`, `CT_ADMIN_EMAILS`), organizador por API key con dueño de carrera (`_check_race_owner`). Bien. Falta una matriz documentada y tests que recorran todos los endpoints | Test que enumera `app.routes` y exige que cada ruta no pública declare dependencia de auth; matriz rol × endpoint en docs | Medio |
| 3 | Validación de entrada (OWASP API3, ASVS V5) | Pydantic con `max_length` en publicación; `_safe_url` en `registration_url`. Revisar límites de tamaño del body (lista de resultados, `polyline`, `splits`, avatar) | Tope de tamaño de request y de cantidad de resultados/puntos GPS; validar tipo y tamaño real del avatar | Medio |
| 4 | Headers y CORS (OWASP A05, CIS) | CSP, nosniff, X-Frame, Referrer-Policy y HSTS ya están. CORS con `allow_methods=["*"]` y `allow_headers=["*"]`; `PUBLIC_URL` con default a onrender; HSTS sin `preload` | Acotar métodos y headers de CORS; agregar `Permissions-Policy`, `Cross-Origin-Opener-Policy`, `Cross-Origin-Resource-Policy`; que el default de `PUBLIC_URL` falle en producción si no se define | Bajo |
| 5 | Secretos y configuración (ISO A.8.24, SOC2 CC6.1) | Sin secretos en el repo; `.env.example` sin valores; `CT_SMTP_*` y `CT_PUBLIC_URL` por entorno. En el escritorio, la clave de publicación queda **en texto plano** en `chronotrack_cloud.json` junto a la base | Cifrar la clave en el escritorio con DPAPI de Windows (o Credential Manager vía `keyring`); permisos del archivo; `detect-secrets`/gitleaks en CI; documentar rotación de `CT_CLOUD_SECRET` (rotarlo invalida sesiones) | Alto |
| 6 | Cifrado en tránsito y reposo (ISO A.8.24, PCI 3/4, 27701) | TLS lo da la plataforma. SQLite de Render y Neon cifran el disco a nivel proveedor; el escritorio guarda DNI/nacimiento/email **sin cifrar** en `chronotrack.db`; la cola de actividades del móvil (con `polyline`) está en AsyncStorage sin cifrar | Escritorio: cifrado de campos sensibles o de la base (SQLCipher / cifrar el backup); mínimo: backup cifrado y aviso de BitLocker. Móvil: mover la cola con GPS a un almacenamiento cifrado o cifrarla con una clave en SecureStore. Exigir `sslmode=require` a Neon y `https` al configurar la URL del portal en el escritorio | Alto |
| 7 | Logging y auditoría (SOC2 CC7.2, ISO A.8.15, NIST AU) | Casi no hay: `print()` en `delete_account`; sin registro de logins fallidos, cambios de contraseña, rotación de claves, acciones de admin, ni borrados | Módulo `cloud/audit.py` con logging JSON estructurado a stdout (Cloud Logging / Render) y tabla `audit_events` (quién, qué, cuándo, IP truncada, resultado). **Nunca** email, nombre ni token: se registra `user_id` y hash. Filtro de redacción de PII | Alto |
| 8 | Rate limiting (OWASP API4) | En memoria, con aviso si hay más de un worker. Cloud Run está en `max-instances=1` | Mantener en memoria mientras sea 1 instancia; dejar implementado el backend Redis detrás de `_BACKENDS` solo si se escala (decisión abierta); sumar límites faltantes en endpoints públicos de búsqueda | Medio |
| 9 | Dependencias (OWASP A06, CIS 7) | Python con locks y `pip-audit` en CI. `mobile` con 71 vulnerabilidades (migración Expo 54→58 pendiente); sin Dependabot; GitHub Actions por tag, no por SHA | `.github/dependabot.yml` (pip, npm ×3, actions); `npm audit --audit-level=high` en CI para `frontend/`; pinear actions por SHA; seguir con el plan de Expo 58 | Medio |
| 10 | Deploy (CIS, SOC2 A1) | Render: `/api/health`, disco de 1 GB sin backup automatizado (snapshot manual). Cloud Run: usuario no root, Workload Identity. `autoDeploy` sin esperar la CI | Documentar y automatizar backup (Neon PITR / snapshot de Render); `autoDeployTrigger: checksPass` si existe; imagen con `HEALTHCHECK` y base pinneada por digest; escaneo de imagen (Trivy) en CI; cuenta de servicio de mínimo privilegio | Medio |
| 11 | Integridad de tiempos y certificados (SOC2 PI1, ISO A.8.3) | Republicar reemplaza todos los resultados sin historial: un cambio de tiempo no deja rastro. El certificado (`ui/certificado.js`) es HTML imprimible sin código de verificación: se puede adulterar | Tabla `result_revisions` (versión, hash del lote, quién publicó) y evento de auditoría por publicación; hash HMAC por resultado; **certificado con código de verificación y URL `/verificar/<código>`** que muestre el dato oficial; el escritorio manda un hash del lote que el portal valida | Alto |
| 12 | Móvil (MASVS, Mobile Top 10) | Token en `expo-secure-store` (bien). OTA de EAS **sin code signing**; `allowBackup` sin revisar; sin certificate pinning | Firmar las OTA (`expo-updates` code signing, `eas update --private-key-path`) y fijar el certificado en `app.json`; `allowBackup: false`; revisar permisos; pinning solo si se decide | Medio |
| 13 | Privacidad 27701 / Ley 25.326 | Sin política de privacidad, sin consentimiento registrado, sin exportación de datos (hay borrado), sin plazos de retención, sin inventario | Ver fase 3 | Alto |
| 14 | Pagos / "CISP" | El cobro es por Mercado Pago (`preapproval` alojado): el portal no ve ni guarda datos de tarjeta | Si se confirma PCI DSS: alcance mínimo (tipo SAQ A), documentar que no se toca PAN, redirigir siempre al checkout de MP, verificar firma del webhook (ya está) | Bajo |

## Cambios (qué archivos y por qué)

### Fase 0 — Línea base y documentación de alcance (sin cambios de comportamiento)
- `docs/seguridad/README.md` (índice) y `docs/seguridad/gap-analysis.md`: la tabla de arriba, con el mapeo explícito a SOC 2 (CC/A/C/PI/P), ISO 27001 Anexo A, ISO 27701, PCI DSS, OWASP Top 10 / API Top 10 / MASVS, CIS Controls v8 y NIST CSF 2.0 / 800-53 / 800-63B.
- `docs/seguridad/inventario-datos.md`: qué dato, dónde vive (escritorio / portal / móvil / MP), base legal, retención, quién accede.
- `docs/seguridad/matriz-accesos.md`: rol × endpoint.
- `docs/seguridad/organizativo.md`: lo que no se resuelve con código (ver abajo).
- `.github/dependabot.yml`, gitleaks en `ci.yml`, `npm audit` del escritorio en CI, actions por SHA.

### Fase 1 — Portal: autenticación, auditoría y headers (`cloud/`)
- `cloud/security.py`: iteraciones de PBKDF2 configurables con rehash al login; TTL de token acortado; se elimina el formato de 3 partes (con migración: las sesiones viejas simplemente piden login); logout.
- `cloud/auth.py`: límite de login por cuenta con backoff; blocklist de contraseñas; evento de auditoría en login ok/fallido, cambio/reset de contraseña, borrado y verificación.
- `cloud/audit.py` (nuevo) + modelo `AuditEvent` en `cloud/models.py` + migración en `cloud/migraciones.py` (debe correr también en Postgres, ver `test_migraciones.py`). Logging JSON con redacción de PII; reemplaza el `print()` de `delete_account`.
- `cloud/main.py`: headers nuevos, CORS acotado, límite de tamaño de body; `cloud/deps.py`: fallo de arranque si falta `CT_PUBLIC_URL` en producción.
- `cloud/organizadores.py`, `cloud/run.py` (admin): auditar emisión, rotación y revocación de claves y toda acción de admin.
- `cloud/run.py`, `cloud/publish.py`: topes de tamaño en actividades, `polyline` y resultados.

### Fase 2 — Integridad de tiempos y certificados
- `cloud/models.py` + migración: `result_revisions`; columna de código de verificación por resultado.
- `cloud/publish.py`: registra revisión y hash del lote en cada publicación/republicación; `cloud/search.py`: endpoint público `GET /api/verificar/{código}`.
- `cloud/static/js/ui/certificado.js` y `pantallas/`: código y QR en el certificado, pantalla de verificación.
- `backend/api/routes.py`: el escritorio calcula el hash del lote al publicar (el contrato se fija con un test, como ya se hizo con `email_hash`).

### Fase 3 — Privacidad (27701 / Ley 25.326)
- `cloud/static/` + `mobile/src/app/`: **Política de privacidad** y términos como páginas; aviso y casilla de consentimiento (con versión y fecha) al registrarse; columnas `consent_version`/`consent_at` en `PortalUser`.
- `cloud/auth.py` o `cloud/privacidad.py`: `GET /api/me/export` (acceso y portabilidad: perfil, claims, actividades, pagos en JSON) y rectificación; el borrado ya existe y se amplía para cubrir `audit_events` (anonimizar) y avatares.
- Retención: tarea programada (o endpoint admin + script) que purga actividades GPS inactivas y cuentas no verificadas tras N días; plazos fijados en `inventario-datos.md`.
- Minimización: truncar el `polyline` al inicio/fin (zona de privacidad) en los recorridos compartidos con amigos — decisión abierta.
- Escritorio: aviso al organizador de que es responsable del tratamiento de sus inscriptos y exportación/borrado de un inscripto.

### Fase 4 — Escritorio y móvil
- `backend/core/cloud_config.py`: clave de publicación protegida con DPAPI/`keyring`; migración desde el JSON en claro; `https` obligatorio salvo localhost.
- `backend/core/database.py`: cifrado de backups; revisión del permiso de `chronotrack.db`.
- `mobile/app.json`, `mobile/eas.json`, `.github/workflows/eas-update.yml`: OTA firmada, `allowBackup: false`, Node 22.
- `mobile/src/lib/run-store.ts`: cola de actividades con GPS cifrada.

### Fase 5 — Operación (Render / Cloud Run)
- `render.yaml`: `autoDeployTrigger: checksPass` (si existe); `DEPLOY.md`: backup/restore probado, rotación de secretos, mínimo privilegio.
- `Dockerfile`: base pinneada por digest, `HEALTHCHECK`; `ci.yml`: Trivy sobre la imagen.
- Redis para el rate limit **solo si** se escala a más de una instancia.

### Documentación de procesos (`docs/seguridad/`)
`respuesta-a-incidentes.md` (incluye notificación a la AAIP y a los afectados), `gestion-de-accesos.md`, `backups-y-recuperacion.md` (RPO/RTO), `gestion-de-cambios.md` (PR, CI verde, rollback), `politica-de-privacidad.md` (borrador para revisión legal).

## Código vs. tareas organizativas

- **Se resuelve con código/config:** todo lo de las fases 1–5.
- **No se resuelve con código (queda como checklist en `organizativo.md`):** inscribir la base en el Registro Nacional de Bases de Datos de la AAIP (Ley 25.326); designar responsable de seguridad/privacidad; revisión legal de política y términos; contrato/DPA con Render/Google/Neon/Mercado Pago/proveedor SMTP (transferencia internacional de datos); capacitación; evaluación de proveedores; MFA en las cuentas de GitHub, Render/GCP, Expo, Mercado Pago y del dominio; prueba periódica de restauración; revisiones de acceso trimestrales; pentest externo; y, si se busca certificación formal, un auditor SOC 2 / ISO acreditado. Este plan deja el repo **listo para auditar**, no certificado.

## Tests (se escriben antes del código, rojo → verde)

Estilo de `cloud/tests/test_hardening.py` (un test por hallazgo, con `conftest.py` de `make_user`/`publish_race`); los tests del portal corren también contra Postgres (`CT_TEST_DB`).

- `cloud/tests/test_sesiones.py`: rehash de PBKDF2 al login; token viejo de 3 partes rechazado; TTL nuevo; logout invalida; bloqueo por cuenta tras N fallos y que no afecte a otras cuentas.
- `cloud/tests/test_auditoria.py`: cada evento sensible genera su fila; **ningún** log ni fila contiene email, nombre ni token (se captura con `caplog`).
- `cloud/tests/test_rutas_autorizadas.py`: recorre `app.routes` y falla si aparece una ruta no pública sin dependencia de auth (lista blanca explícita de las públicas).
- `cloud/tests/test_headers.py`: presencia de los headers nuevos, CORS acotado, falla de arranque sin `CT_PUBLIC_URL` en producción.
- `cloud/tests/test_limites.py`: 413/422 por body, resultados, `polyline` o avatar excedidos.
- `cloud/tests/test_integridad.py`: revisión creada al republicar; hash del lote inválido rechazado; `/api/verificar/{código}` devuelve el dato oficial y 404 para códigos inventados.
- `cloud/tests/test_privacidad.py`: export devuelve todo lo del usuario y nada de otros; borrado deja cero filas del usuario; consentimiento obligatorio y versionado; purga por retención.
- `backend/tests/test_clave_protegida.py`: la clave no queda en texto plano en el JSON, migración desde el formato viejo; `backend/tests/test_hash_lote_contrato.py`: escritorio y portal calculan el mismo hash.
- `mobile/src/lib/__tests__/`: cola cifrada (ida y vuelta), sin PII en claro en AsyncStorage.
- Migraciones: extender `test_migraciones.py` y `test_migrar_portal_a_postgres.py` para las tablas nuevas.
- No se borra ni saltea ningún test existente; la cobertura no baja.

## Riesgos

- **Migración a Cloud Run en curso:** las tablas nuevas deben correr en SQLite y Postgres; la fase 1–2 va **antes o después** del corte, no durante. Snapshot/backup antes de cada deploy con cambio de esquema.
- **Acortar el TTL del token y retirar el formato viejo desloguea a todos** los usuarios (web y móvil): avisarlo y hacerlo en un horario tranquilo.
- **Cifrado en el escritorio:** un error pierde acceso a la base de una carrera real. Migración reversible, backup previo y prueba manual del cronómetro (hoy no hay e2e).
- **OTA firmada:** requiere un build nuevo; hoy la OTA ni siquiera llega a los builds instalados (`PENDIENTES.md` §2). Depende de ese pendiente.
- **Certificados con código de verificación:** los ya emitidos no lo tienen; hay que decidir cómo se tratan.
- **Alcance legal:** la política de privacidad y las obligaciones de la AAIP requieren revisión de una persona abogada; el borrador no es asesoramiento legal.
- **Retención:** purgar datos es irreversible; empezar con modo "solo reportar".
- **Logging:** riesgo de filtrar PII al auditar; mitigado con redacción y test.

## Decisiones abiertas

1. **Interpretación de "CISP"**
   - A) PCI DSS con alcance mínimo (SAQ A: el pago es de Mercado Pago, no tocamos tarjetas) — *recomendada*.
   - B) Programa de datos de tarjeta de Visa (Visa CISP) completo, solo si se procesan pagos de inscripción propios.
   - C) Dejarlo fuera hasta que haya pagos de inscripción.
   - D) Era otra cosa (ej. "CISSP" u otro marco): aclarar.
2. **Alcance de cada fase / orden**
   - A) Fases 0→5 en orden, un PR por fase — *recomendada*.
   - B) Primero lo de mayor riesgo: auditoría + sesiones + clave del escritorio + integridad (1, 2, 4) y después privacidad.
   - C) Solo 0 y 1 por ahora; el resto se replanifica.
   - D) Hacer 0 y 3 (documentación y privacidad) primero por la parte legal.
3. **Momento respecto de la migración a Cloud Run**
   - A) Después del corte, sobre Cloud Run — *recomendada* (un solo entorno que probar).
   - B) Antes del corte, en Render.
   - C) Fases sin cambio de esquema antes; el resto después.
4. **Rate limit con Redis**
   - A) No: mantener en memoria con `max-instances=1` y el aviso — *recomendada*.
   - B) Implementar el backend Redis ya (Memorystore / Upstash).
   - C) Usar Cloud Armor / límite en el borde.
5. **Cifrado de datos personales del escritorio**
   - A) DPAPI/`keyring` para la clave + backups cifrados; base en claro protegida por BitLocker — *recomendada*.
   - B) SQLCipher para toda la base (más fuerte, más riesgo y dependencia nativa en PyInstaller).
   - C) Cifrado por campo (DNI, nacimiento, email).
   - D) Solo documentar la recomendación de BitLocker.
6. **Sesiones del portal y la app**
   - A) Mantener el token propio, acortar TTL y sumar logout/bloqueo — *recomendada*.
   - B) Access token corto + refresh token rotativo con tabla de sesiones (revocación por dispositivo).
   - C) Pasar a JWT estándar con `PyJWT`.
   - D) Agregar MFA (TOTP) para admins y organizadores además de A.
7. **Integridad de certificados**
   - A) Código de verificación + página pública `/verificar/<código>` — *recomendada*.
   - B) Además, PDF firmado digitalmente (más costo, requiere certificado).
   - C) Solo QR a la página del resultado existente.
   - D) No tocar los certificados.
8. **Privacidad de los recorridos GPS**
   - A) Recortar inicio y fin del recorrido compartido con amigos — *recomendada*.
   - B) Recorrido completo solo para el dueño; amigos ven distancia y ritmo.
   - C) Dejarlo como está con aviso en el consentimiento.
9. **Retención**
   - A) Actividades GPS: 24 meses sin uso; cuentas sin verificar: 30 días; auditoría: 12 meses; resultados oficiales: indefinido (interés público) — *recomendada*.
   - B) Todo indefinido hasta que el usuario borre.
   - C) Plazos más cortos (12 / 7 días / 6 meses).
10. **Política de privacidad y términos**
    - A) Borrador mío + revisión de un/a abogado/a antes de publicar — *recomendada*.
    - B) Plantilla de un generador y publicarla.
    - C) Esperar a la revisión legal y bloquear la fase 3.
11. **Backups y recuperación**
    - A) Neon PITR + snapshot previo a cada deploy con esquema nuevo y prueba de restauración trimestral — *recomendada*.
    - B) Dump diario a un bucket cifrado propio además de A.
    - C) Solo el snapshot manual de hoy.
12. **Certificación formal**
    - A) Dejar el repo "listo para auditar"; sin auditor por ahora — *recomendada*.
    - B) Contratar una plataforma de compliance (Vanta/Drata) para SOC 2 Tipo I.
    - C) Apuntar a ISO 27001 con consultor.

## Verificación

Por fase, antes de dar algo por terminado:
- `python -m pytest cloud/tests backend/tests -q` (y `CT_TEST_DB=postgresql+psycopg://… pytest cloud/tests` para el esquema nuevo).
- `ruff check .` y `ruff format --check .`.
- `pip-audit` de los dos locks; `npm audit` en `frontend/` y `mobile/`; gitleaks y Trivy en CI.
- `frontend/`: `npm run lint`, `npx vitest run`, `npm run build`. `mobile/`: `npm test`, `npm run lint`, `npx tsc --noEmit`.
- Manual: `python launcher.py` y recorrer el cronómetro completo (largar, capturar, dorsal, deshacer, publicar, certificado); portal local con `uvicorn cloud.main:app --port 8002` revisando headers con `curl -I`; flujo registro → consentimiento → export → borrado; verificación de un certificado por su código; en dispositivo, OTA firmada llegando a un build nuevo.
- Revisión de código con `/security-review` sobre cada PR de fase.
- Cierre: actualizar la nota hub de LiveRun en el vault (fuera del alcance de este plan) y `PENDIENTES.md`.


## Decisiones elegidas
- ¿Cómo interpretamos "CISP"? → PCI DSS con alcance mínimo (SAQ A)
- ¿Qué alcance y orden tienen las fases? → Fases 0 a 5 en orden, un PR por fase
- ¿Cuándo se hace respecto de la migración a Cloud Run? → Después del corte, sobre Cloud Run
- ¿Cómo se protegen los datos personales del escritorio? → DPAPI/keyring para la clave + backups cifrados
- ¿Qué modelo de sesión adoptamos? → Mantener el token propio, acortar TTL y sumar logout y bloqueo por cuenta
- ¿Qué plazos de retención fijamos? → GPS 24 meses sin uso, cuentas sin verificar 30 días, auditoría 12 meses
