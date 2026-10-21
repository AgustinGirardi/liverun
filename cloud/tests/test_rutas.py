"""Mapa de rutas del portal. Si se parte un módulo y se pierde (o se duplica)
un endpoint, este test lo agarra antes que un usuario."""

from cloud.main import app

RUTAS_ESPERADAS = {
    ("DELETE", "/api/auth/account"),
    ("DELETE", "/api/publish/{source_id}"),
    ("DELETE", "/api/run/activities/{activity_id}"),
    ("GET", "/api/events"),
    ("GET", "/api/me/results"),
    ("GET", "/api/races"),
    ("GET", "/api/races/{code}"),
    ("GET", "/api/run/activities"),
    ("GET", "/api/run/activities/{activity_id}"),
    ("GET", "/api/run/admin/coupons"),
    ("GET", "/api/run/admin/publish-keys"),
    ("GET", "/api/run/admin/users"),
    ("GET", "/api/run/auth/google/callback"),
    ("GET", "/api/run/auth/google/start"),
    ("GET", "/api/run/billing/info"),
    ("GET", "/api/run/billing/mode"),
    ("GET", "/api/run/friends"),
    ("GET", "/api/run/friends/search"),
    ("GET", "/api/run/profile"),
    ("GET", "/api/run/ranking"),
    ("GET", "/api/run/summary"),
    ("GET", "/api/search"),
    ("PATCH", "/api/run/profile"),
    ("POST", "/api/auth/login"),
    ("POST", "/api/auth/password"),
    ("POST", "/api/auth/password/forgot"),
    ("POST", "/api/auth/password/reset"),
    ("POST", "/api/auth/register"),
    ("POST", "/api/auth/verify"),
    ("POST", "/api/auth/verify/send"),
    ("POST", "/api/claim"),
    ("POST", "/api/events"),
    ("POST", "/api/me/autolink"),
    ("POST", "/api/me/claim"),
    ("POST", "/api/publish"),
    ("POST", "/api/run/activities"),
    ("POST", "/api/run/admin/coupons"),
    ("POST", "/api/run/admin/coupons/{coupon_id}/toggle"),
    ("POST", "/api/run/admin/publish-keys"),
    ("POST", "/api/run/admin/publish-keys/{key_id}/revoke"),
    ("POST", "/api/run/admin/publish-keys/{key_id}/rotate"),
    ("POST", "/api/run/admin/users/{user_id}/grant"),
    ("POST", "/api/run/billing/subscribe"),
    ("POST", "/api/run/billing/webhook"),
    ("POST", "/api/run/coupons/redeem"),
    ("POST", "/api/run/friends/accept"),
    ("POST", "/api/run/friends/request"),
    ("POST", "/api/run/profile/avatar"),
}


def _rutas_publicadas() -> list[tuple[str, str]]:
    esquema = app.openapi()["paths"]
    return [(metodo.upper(), path) for path, ops in esquema.items() for metodo in ops]


def test_el_portal_expone_exactamente_las_rutas_esperadas():
    publicadas = _rutas_publicadas()
    assert len(publicadas) == len(set(publicadas)), "hay una ruta registrada dos veces"
    assert set(publicadas) == RUTAS_ESPERADAS


def test_health_sigue_fuera_del_esquema_pero_responde(client):
    assert ("GET", "/api/health") not in _rutas_publicadas()
    assert client.get("/api/health").status_code == 200
