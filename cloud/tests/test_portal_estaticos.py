"""Archivos del portal: caché explícita, CSP sin scripts en línea y lo que
necesita la tabla de una carrera."""

from pathlib import Path

from cloud.tests.conftest import publish_race


def test_html_js_y_css_se_revalidan_siempre(client):
    for ruta in ("/", "/js/app.js", "/js/pantallas/inicio.js", "/styles.css"):
        r = client.get(ruta)
        assert r.status_code == 200, ruta
        assert r.headers["cache-control"] == "no-cache", ruta


def test_modulos_con_tipo_javascript(client):
    r = client.get("/js/app.js")
    assert "javascript" in r.headers["content-type"]


def test_imagenes_se_guardan_un_dia(client):
    assert client.get("/logo.svg").headers["cache-control"] == "public, max-age=86400"


def test_la_api_no_lleva_cache_del_portal(client):
    assert "cache-control" not in client.get("/api/races").headers


def test_csp_no_permite_scripts_en_linea(client):
    csp = client.get("/").headers["content-security-policy"]
    script = next(p for p in csp.split(";") if p.strip().startswith("script-src"))
    assert "'unsafe-inline'" not in script


def test_index_no_tiene_handlers_en_linea(client):
    html = client.get("/").text
    assert " onclick=" not in html and "<script>" not in html


def test_detalle_de_carrera_trae_result_id(client):
    publish_race(
        client,
        results=[
            {
                "bib_number": "7",
                "full_name": "Ana Gómez",
                "distance_km": 10.0,
                "net_time_ns": 1_800_000_000_000,
                "position": 1,
                "status": "FINISHER",
            }
        ],
    )
    code = client.get("/api/races").json()[0]["code"]
    res = client.get(f"/api/races/{code}").json()["results"][0]
    assert isinstance(res["result_id"], int)
    busq = client.get("/api/search", params={"q": "ana gomez"}).json()["results"][0]
    assert busq["result_id"] == res["result_id"]


def test_index_tiene_open_graph(client):
    html = client.get("/").text
    for propiedad in ("og:title", "og:description", "og:type", "og:site_name"):
        assert f'property="{propiedad}"' in html, propiedad


def _hex(valor):
    return [int(valor[i : i + 2], 16) for i in (1, 3, 5)]


def _luminancia(hex_color):
    def canal(c):
        v = c / 255
        return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4

    r, g, b = (canal(c) for c in _hex(hex_color))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def _contraste(a, b):
    claro, oscuro = sorted((_luminancia(a), _luminancia(b)), reverse=True)
    return (claro + 0.05) / (oscuro + 0.05)


def _tokens(css, selector):
    import re

    bloque = css.split(selector + " {", 1)[1].split("}", 1)[0]
    return dict(re.findall(r"--([\w-]+):\s*(#[0-9A-Fa-f]{6})", bloque))


def test_tokens_de_texto_pasan_aa_en_los_dos_temas(client):
    css = client.get("/styles.css").text
    for selector in (":root", '[data-theme="dark"]'):
        t = _tokens(css, selector)
        for texto in ("txt", "mut", "dim", "acc-ink"):
            for fondo in ("bg", "panel"):
                assert _contraste(t[texto], t[fondo]) >= 4.5, (selector, texto, fondo)


def test_marcas_de_datos_usan_acento_con_contraste(client):
    assert ".bar.cur { background:var(--acc-ink); }" in client.get("/styles.css").text
    historial = client.get("/js/pantallas/historial.js").text
    assert 'stroke="var(--acc)"' not in historial
    assert 'stroke="var(--acc-ink)"' in historial
    assert "conic-gradient(var(--acc-ink)" in client.get("/styles.css").text


# ── CSP de estilos: sin 'unsafe-inline' ──────────────────────────────────────
_STATIC = Path(__file__).parents[1] / "static"


def test_csp_no_permite_estilos_en_linea(client):
    csp = client.get("/").headers["content-security-policy"]
    estilos = next(p for p in csp.split(";") if p.strip().startswith("style-src"))
    assert "'unsafe-inline'" not in estilos


def test_el_portal_no_escribe_style_en_el_html():
    """Un style="" en el markup lo bloquea la CSP. Las medidas dinámicas viajan
    en data-* y las aplica `iniciarMedidas` por CSSOM (permitido)."""
    culpables = [
        str(p.relative_to(_STATIC))
        for p in _STATIC.rglob("*")
        if p.suffix in (".html", ".js") and 'style="' in p.read_text(encoding="utf-8")
    ]
    assert culpables == []


def test_las_medidas_dinamicas_tienen_su_css():
    css = (_STATIC / "styles.css").read_text(encoding="utf-8")
    for var in ("--pct", "--alto", "--i", "--grados"):
        assert f"var({var}" in css, f"styles.css no usa {var}"
    medidas = (_STATIC / "js/ui/componentes.js").read_text(encoding="utf-8")
    assert "iniciarMedidas" in medidas


def test_admin_tiene_la_pestana_de_claves_con_sus_acciones():
    admin = (_STATIC / "js/pantallas/admin.js").read_text(encoding="utf-8")
    assert 'data-p="claves"' in admin
    assert "/api/run/admin/publish-keys" in admin
    for accion in ("crearClave", "rotarClave", "revocarClave", "copiarClave"):
        assert f"{accion}(" in admin, f"falta registrar la acción {accion}"
    # La clave en claro solo se muestra al crearla o rotarla, nunca en el listado.
    assert "k.key" in admin and "k.prefix" in admin
