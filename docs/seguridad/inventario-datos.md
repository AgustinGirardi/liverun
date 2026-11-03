# Inventario de datos personales

Qué datos trata LiveRun, dónde viven y por cuánto tiempo. Retenciones aprobadas en el plan base:
**GPS 24 meses**, **cuentas sin verificar 30 días**, **auditoría 12 meses**. La purga automática es de la Fase 3
(primero en modo "solo reportar"); hasta entonces estos plazos son la política, no un proceso en marcha.

Base legal (Ley 25.326 / ISO 27701): *contrato* = necesario para prestar el servicio pedido; *consentimiento* = a registrar
en la Fase 3; *interés legítimo* = seguridad y operación; *obligación* = requisito legal o de las tiendas de apps.

| Dato | Dónde vive | Base legal | Retención | Quién accede |
|---|---|---|---|---|
| Email, nombre, hash de contraseña (PBKDF2) | Portal: `portal_users` | Contrato | Mientras exista la cuenta; sin verificar, 30 días | La cuenta; admins (email y nombre en el listado de admin) |
| ID de Google, foto de perfil | Portal: `portal_users` | Contrato | Mientras exista la cuenta | La cuenta; admins |
| Actividades con recorrido GPS (`polyline`), tiempos y distancia | Portal: `run_activities`; móvil: cola local (AsyncStorage, sin cifrar) | Consentimiento (a registrar) | 24 meses | La cuenta; amigos aceptados ven el resumen |
| Amistades y entrenador/atleta | Portal: `run_friendships`, `run_coach_athletes` | Contrato | Mientras exista la cuenta | Las dos partes |
| Resultados publicados (nombre, dorsal, categoría, club, tiempo, posición) | Portal: `published_results` | Interés legítimo / contrato con el organizador (datos públicos de la carrera) | Mientras la carrera esté publicada; el organizador puede borrarla | Público |
| Hash del email del corredor (`email_hash`) | Portal: `published_results` | Interés legítimo (vincular resultados a la cuenta) | Igual que el resultado | Sistema |
| DNI, fecha de nacimiento, email de inscriptos | **Solo escritorio**: `chronotrack.db` (sin cifrar). El portal nunca los recibe | Contrato con el organizador | Lo define el organizador | El organizador (usuario local) |
| Suscripción y pagos (ids de Mercado Pago, monto, estado) | Portal: `run_billing_*`. Sin datos de tarjeta (MP los aloja) | Contrato / obligación fiscal | Según obligación fiscal | La cuenta; admins |
| Cupones canjeados | Portal: `run_coupon_redemptions` | Contrato | Mientras exista la cuenta | Admins |
| Hash de la API key de publicación | Portal: `publish_keys` | Interés legítimo | Hasta revocarla | Admins (solo prefijo) |
| Clave de publicación en claro | Escritorio: `chronotrack_cloud.json` (pendiente: DPAPI, Fase 4) | Interés legítimo | Hasta rotarla | Usuario local |
| Eventos de auditoría (acción, resultado, `user_id` sin FK, IP truncada /24 o /48, detalle corto) | Portal: `audit_events` y log JSON a stdout. **Nunca** email, nombre ni token | Interés legítimo (seguridad) | 12 meses | Operadores del portal |
| Token de sesión | Móvil: `expo-secure-store`; web: almacenamiento del navegador | Contrato | 14 días | La cuenta |

## Borrado

`DELETE /api/auth/account` borra la cuenta, actividades, vínculos, amistades, canjes y pagos, y cancela la suscripción
de Mercado Pago (mejor esfuerzo). Los resultados publicados quedan (son del organizador); solo se rompe el vínculo.
El evento `account_deleted` de auditoría se conserva (guarda solo el `user_id` numérico, sin FK).
