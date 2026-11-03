# Tareas organizativas (no son código)

Checklist para llegar a una auditoría. Ninguna la hace el repo. Marcar con fecha cuando se cumpla.

## Legales y de privacidad
- [ ] Registrar la base de datos en la **AAIP** (Ley 25.326).
- [ ] Revisión legal de la política de privacidad y los términos (se redactan en la Fase 3).
- [ ] **DPA / acuerdos de tratamiento** con proveedores: Google Cloud, Neon, Render (hasta la baja), Mercado Pago, proveedor SMTP, Expo/EAS, Google (login).
- [ ] Definir responsable de privacidad y canal para ejercer derechos de acceso, rectificación y supresión.
- [ ] Procedimiento de notificación de incidentes (quién avisa, a quién, en qué plazo).

## Accesos y cuentas
- [ ] **MFA** en GitHub, Google Cloud, Neon, Render, Mercado Pago, Expo y el correo del dominio.
- [ ] Lista de quién tiene acceso a qué (mínimo privilegio) y revisión cada 6 meses.
- [ ] Proteger `main` en GitHub: PR + CI verde obligatoria.
- [ ] Dónde se guardan las credenciales de emergencia (gestor de contraseñas).

## Operación
- [ ] Rotación documentada de `CT_CLOUD_SECRET` (invalida todas las sesiones) y de la clave de cada organizador.
- [ ] Backups: Neon PITR activado y restauración probada al menos una vez (Fase 5).
- [ ] Alertas: errores 5xx y logs de auditoría con picos de `login_fail` / `login_locked`.
- [ ] Revisión trimestral de `audit_events` y de los PR de Dependabot.
- [ ] Plan de continuidad: qué pasa si cae Cloud Run o Neon.

## Antes de pedir una auditoría
- [ ] Elegir el marco (SOC 2 Tipo I o ISO 27001) y un auditor.
- [ ] Capacitación básica de seguridad para quien tenga acceso a producción.
- [ ] Evidencia: capturas de MFA, de protección de rama, de backups y de la revisión de accesos.
