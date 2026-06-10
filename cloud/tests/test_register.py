"""Registro de cuentas del portal."""


def test_register_duplicate_email_returns_409(client):
    body = {"email": "ana@mail.com", "password": "supersecreta"}
    assert client.post("/api/auth/register", json=body).status_code == 200
    r = client.post("/api/auth/register", json=body)
    assert r.status_code == 409
