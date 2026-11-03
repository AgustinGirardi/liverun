# Gap analysis de seguridad y privacidad

Fuente: tabla del plan base `docs/plans/2026-11-03-hardening-de-seguridad-y-privacidad-de-liverun-soc.md`,
con el estado al 2026-11-03 y la auditoría inicial de la Fase 0. LiveRun queda **listo para auditar**, no certificado.

Marcos: SOC 2 (CC), ISO 27001:2022 (Anexo A), ISO 27701, PCI DSS SAQ A, OWASP (ASVS / API Top 10 / Top 10 / MASVS),
CIS Controls v8, NIST (800-63B, 800-53 AU).

## Estado por control

| # | Control | SOC 2 | ISO 27001 / 27701 | PCI | OWASP | CIS | NIST | Riesgo | Estado | Fase |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Autenticación y sesiones | CC6.1 | A.8.5 | 8 | ASVS V2/V3 | 5, 6 | 800-63B | Alto | **Hecho** (PBKDF2 600 000, token 14 d, logout, bloqueo por cuenta). MFA: organizativo | 1 |
| 2 | Control de acceso por rol | CC6.1, CC6.3 | A.5.15 | 7 | API1, API5 | 6 | AC | Medio | **Hecho**: `test_rutas_autorizadas.py` y [matriz](matriz-accesos.md) | 0/1 |
| 3 | Validación de entrada | CC6.6 | A.8.28 | 6 | API3, ASVS V5 | 16 | SI | Medio | **Hecho** en topes de body y resultados; falta validar el avatar por contenido | 1 |
| 4 | Headers y CORS | CC6.6 | A.8.9 | 6 | A05 | 4 | SC | Bajo | **Hecho** | 1 |
| 5 | Secretos y configuración | CC6.1 | A.8.24 | 3 | A02 | 3, 4 | SC-12 | Alto | Portal: gitleaks en CI sobre el historial (Fase 0). **Pendiente**: clave del escritorio en texto plano | 0 / 4 |
| 6 | Cifrado en tránsito y reposo | CC6.7 | A.8.24 / 27701 | 3, 4 | A02, MASVS-STORAGE | 3 | SC-8, SC-28 | Alto | TLS de plataforma. **Pendiente**: base del escritorio y cola GPS del móvil sin cifrar | 4 |
| 7 | Logging y auditoría | CC7.2 | A.8.15 | 10 | A09 | 8 | AU | Alto | **Hecho** (`audit_events` + log JSON sin PII). Purga a 12 meses: Fase 3 | 1b |
| 8 | Rate limiting | CC6.6 | A.8.20 | 6 | API4 | 13 | SC-5 | Medio | En memoria (1 instancia); aviso multiworker. Redis solo si se escala | — |
| 9 | Dependencias y cadena de suministro | CC7.1 | A.8.8, A.8.30 | 6 | A06, A08 | 7, 16 | SI-2, SR | Medio | **Hecho** en CI: Dependabot, `npm audit`, actions por SHA. `mobile`: pendiente Expo 58 | 0 |
| 10 | Deploy y continuidad | A1.2, CC8.1 | A.8.13, A.8.32 | 6 | A05 | 11 | CP | Medio | **Pendiente**: `HEALTHCHECK`, base por digest, Trivy, backup probado | 5 |
| 11 | Integridad de tiempos y certificados | PI1 | A.8.3 | — | A08 | 3 | SI-7 | Alto | **Pendiente** (`result_revisions`, certificado verificable) | 2 |
| 12 | Móvil | CC6.1 | A.8.26 | — | MASVS | 2, 16 | SA | Medio | **Pendiente**: OTA firmada, `allowBackup` | 4 |
| 13 | Privacidad (Ley 25.326) | P-series | 27701 | — | — | 3 | PT | Alto | **Pendiente**: política, consentimiento, exportación, purga. Ver [inventario](inventario-datos.md) | 3 |
| 14 | Pagos | CC6.7 | A.8.24 | SAQ A | — | 3 | SC | Bajo | Mercado Pago aloja el checkout; el portal no toca PAN. Webhook con firma | — |

Lo que no es código está en [`organizativo.md`](organizativo.md).

## Resultados de la auditoría inicial (2026-11-03)

| Chequeo | Comando | Resultado |
|---|---|---|
| Dependencias del portal | `pip-audit==2.10.1 --no-deps --disable-pip -r cloud/requirements.lock` | Sin vulnerabilidades conocidas |
| Dependencias del escritorio | ídem sobre `requirements.lock` | Sin vulnerabilidades conocidas |
| `frontend/` | `npm audit --audit-level=high` | 1 alta (`zod < 4.6.6`, transitiva de `eslint-plugin-react-hooks`, solo desarrollo). Resuelta con `npm audit fix` (cambia solo `package-lock.json`); quedan 6 moderadas, también de herramientas de desarrollo |
| `mobile/` | `npm audit` | 76 (5 bajas, 55 moderadas, 15 altas, 1 crítica), todas por Expo 54. **Informativo** en la CI hasta migrar a Expo 58 (`docs/plans/2026-10-21-migrar-expo-54-a-58.md`) |
| Secretos en el historial | `gitleaks git` v8.30.1, 176 commits | 1 hallazgo, **falso positivo**: clave de ejemplo `lr_pub_abcdefgh1234` en `backend/tests/test_cloud_config.py`. Se declara en `.gitleaks.toml`. No hay secretos reales: **no hace falta rotar nada** |

Pendiente de la auditoría: revisar a mano las 15 altas y la crítica de `mobile/` para saber cuáles llegan al binario de la app y no son solo herramientas de build.
