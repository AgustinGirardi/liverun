"""La configuración de la CI es parte de la seguridad: las actions van fijadas por
SHA, Dependabot las mantiene al día y la CI busca secretos y vulnerabilidades.
Se lee con regex a propósito: no depende de ninguna librería de YAML."""

import re
from pathlib import Path

RAIZ = Path(__file__).parents[2]
WORKFLOWS = sorted((RAIZ / ".github" / "workflows").glob("*.yml"))
CI = (RAIZ / ".github" / "workflows" / "ci.yml").read_text(encoding="utf-8")
DEPENDABOT = (RAIZ / ".github" / "dependabot.yml").read_text(encoding="utf-8")

USES = re.compile(r"^\s*(?:-\s+)?uses:\s*(\S+)", re.MULTILINE)


def test_hay_workflows():
    assert WORKFLOWS


def test_toda_action_esta_fijada_a_un_sha_de_40_caracteres():
    sin_fijar = []
    for wf in WORKFLOWS:
        for uso in USES.findall(wf.read_text(encoding="utf-8")):
            if not re.fullmatch(r"[\w.-]+/[\w./-]+@[0-9a-f]{40}", uso):
                sin_fijar.append(f"{wf.name}: {uso}")
    assert not sin_fijar, f"Actions sin fijar por SHA: {sin_fijar}"


def test_cada_action_fijada_dice_su_tag_en_un_comentario():
    for wf in WORKFLOWS:
        for linea in wf.read_text(encoding="utf-8").splitlines():
            if USES.match(linea):
                assert re.search(r"@[0-9a-f]{40}\s+#\s*v\d", linea), f"{wf.name}: falta el tag en {linea.strip()}"


def test_dependabot_cubre_pip_npm_y_actions():
    ecosistemas = set(re.findall(r"package-ecosystem:\s*(\S+)", DEPENDABOT))
    assert {"pip", "npm", "github-actions"} <= ecosistemas


def test_dependabot_cubre_cada_carpeta_con_dependencias():
    carpetas = set(re.findall(r"directory:\s*(\S+)", DEPENDABOT))
    assert {"/cloud", "/", "/frontend", "/mobile"} <= carpetas


def test_la_ci_busca_secretos_en_todo_el_historial():
    assert "gitleaks" in CI
    assert "fetch-depth: 0" in CI


def test_npm_audit_bloquea_en_frontend_e_informa_en_mobile():
    assert re.search(r"npm audit --audit-level=high\s*$", CI, re.MULTILINE)
    assert re.search(r"npm audit \|\| true", CI)
