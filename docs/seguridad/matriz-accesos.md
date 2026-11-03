# Matriz de accesos: rol × endpoint

Generada a partir de las rutas de `cloud.main.app` (2026-11-03) y de la lista blanca de
`cloud/tests/test_rutas_autorizadas.py`, que falla si aparece una ruta sin credenciales que no esté declarada pública.

Roles:
- **Público**: sin credenciales (algunos se protegen por firma o token del mail).
- **Cuenta**: `Authorization: Bearer <token>` de un corredor (`current_user`).
- **Admin**: cuenta con `is_admin` (`require_admin`; sale de `CT_ADMIN_EMAILS` con email verificado o Google).
- **Organizador**: header `X-API-Key` con una clave de publicación vigente; solo toca las carreras de su clave.

| Endpoint | Método | Público | Cuenta | Admin | Organizador |
|---|---|:-:|:-:|:-:|:-:|
| `/api/health` | GET | ✔ | | | |
| `/api/races`, `/api/races/{code}`, `/api/search`, `/api/events` | GET | ✔ | | | |
| `/api/run/ranking`, `/api/run/billing/mode` | GET | ✔ | | | |
| `/api/auth/register`, `/login`, `/password/forgot`, `/password/reset`, `/verify` | POST | ✔ (límite por IP; login con bloqueo por cuenta; reset y verify con token firmado) | | | |
| `/api/run/auth/google/start`, `/callback` | GET | ✔ (state firmado + cookie) | | | |
| `/api/run/billing/webhook` | POST | ✔ (firma de Mercado Pago) | | | |
| `/api/auth/logout`, `/password`, `/verify/send` | POST | | ✔ | | |
| `/api/auth/account` | DELETE | | ✔ | | |
| `/api/claim`, `/api/me/claim`, `/api/me/autolink` | POST | | ✔ | | |
| `/api/me/results` | GET | | ✔ | | |
| `/api/run/activities` | GET, POST | | ✔ | | |
| `/api/run/activities/{activity_id}` | GET, DELETE | | ✔ (solo las propias) | | |
| `/api/run/profile`, `/api/run/profile/avatar` | GET, PATCH, POST | | ✔ | | |
| `/api/run/summary` | GET | | ✔ | | |
| `/api/run/friends`, `/friends/search`, `/friends/request`, `/friends/accept` | GET, POST | | ✔ | | |
| `/api/run/billing/info`, `/billing/subscribe` | GET, POST | | ✔ | | |
| `/api/run/coupons/redeem` | POST | | ✔ (tope por usuario) | | |
| `/api/run/admin/users` | GET | | | ✔ | |
| `/api/run/admin/users/{user_id}/grant` | POST | | | ✔ | |
| `/api/run/admin/coupons` | GET, POST | | | ✔ | |
| `/api/run/admin/coupons/{coupon_id}/toggle` | POST | | | ✔ | |
| `/api/run/admin/publish-keys` | GET, POST | | | ✔ | |
| `/api/run/admin/publish-keys/{key_id}/rotate`, `/revoke` | POST | | | ✔ | |
| `/api/publish` | POST | | | | ✔ |
| `/api/publish/{source_id}` | DELETE | | | | ✔ (solo carreras de su clave) |
| `/api/events` | POST | | | | ✔ |

## Eventos de auditoría por endpoint sensible

| Endpoint | Evento |
|---|---|
| `POST /api/auth/register` | `register` |
| `POST /api/auth/login` | `login_ok`, `login_fail`, `login_locked` |
| `POST /api/auth/logout` | `logout` |
| `POST /api/auth/password` | `password_change` |
| `POST /api/auth/password/reset` | `password_reset` |
| `POST /api/auth/verify` | `email_verified` |
| `DELETE /api/auth/account` | `account_deleted` |
| `GET /api/run/auth/google/callback` | `google_login`, `google_link` |
| `POST /api/run/admin/publish-keys` y `/rotate`, `/revoke` | `publish_key_created`, `publish_key_rotated`, `publish_key_revoked` |
| `POST /api/run/admin/users/{id}/grant` | `admin_grant` |
| `POST /api/run/admin/coupons` y `/toggle` | `coupon_created`, `coupon_toggled` |

Publicar y borrar carreras se audita en la Fase 2 (`result_revisions`).
