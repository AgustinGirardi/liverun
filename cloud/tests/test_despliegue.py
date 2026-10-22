"""El contenedor y el deploy a Cloud Run (Dockerfile, .dockerignore, ci.yml).

No construyen la imagen: comprueban que los archivos de despliegue sigan de acuerdo
con el código, que es lo que se rompe en silencio (un secreto que el portal lee y el
deploy no entrega, una base que se cuela en la imagen)."""

import re
from pathlib import Path

import yaml

RAIZ = Path(__file__).parents[2]
DOCKERFILE = (RAIZ / "Dockerfile").read_text(encoding="utf-8")
DOCKERIGNORE = (RAIZ / ".dockerignore").read_text(encoding="utf-8")
CI = yaml.safe_load((RAIZ / ".github" / "workflows" / "ci.yml").read_text(encoding="utf-8"))
DEPLOY = CI["jobs"]["deploy-portal"]


def _paso(nombre_parcial: str) -> dict:
    return next(p for p in DEPLOY["steps"] if nombre_parcial in p.get("name", ""))


def _secretos_del_deploy() -> dict[str, str]:
    comando = _paso("Desplegar")["run"].replace("\\\n", " ")
    lista = re.search(r'--set-secrets "([^"]+)"', comando).group(1)
    return dict(par.split("=", 1) for par in lista.split(","))


# ── Dockerfile ────────────────────────────────────────────────────────────────


def test_la_imagen_instala_desde_el_lock_y_corre_el_portal():
    assert "pip install -r cloud/requirements.lock" in DOCKERFILE
    assert "uvicorn cloud.main:app" in DOCKERFILE
    assert "${PORT}" in DOCKERFILE  # Cloud Run decide el puerto


def test_la_imagen_arranca_en_modo_produccion_y_sin_root():
    assert "CT_PRODUCCION=1" in DOCKERFILE
    assert re.search(r"^USER (?!root)\S+", DOCKERFILE, re.MULTILINE)


def test_la_imagen_corre_un_solo_worker():
    assert "--workers" not in DOCKERFILE  # el rate limit está en memoria


def test_el_avatar_dir_de_la_imagen_es_el_punto_de_montaje_del_deploy():
    montaje = re.search(r'--add-volume-mount "[^"]*mount-path=([^"]+)"', _paso("Desplegar")["run"]).group(1)
    assert f"CT_AVATAR_DIR={montaje}" in DOCKERFILE


# ── .dockerignore ─────────────────────────────────────────────────────────────


def test_dockerignore_deja_entrar_solo_el_portal():
    lineas = DOCKERIGNORE.splitlines()
    assert "*" in lineas  # todo afuera por defecto…
    assert lineas.index("*") < lineas.index("!cloud/")  # …y después se habilita lo del portal
    assert "!cloud/" in DOCKERIGNORE and "!cloud/requirements.lock" in DOCKERIGNORE


def test_dockerignore_deja_afuera_bases_secretos_y_tests():
    for patron in ("**/*.db", "**/.env", "cloud/tests", "cloud/avatars"):
        assert patron in DOCKERIGNORE


# ── ci.yml ────────────────────────────────────────────────────────────────────


def test_el_deploy_espera_a_los_tests_con_sqlite_y_con_postgres():
    assert set(DEPLOY["needs"]) == {"python", "python-postgres"}


def test_el_deploy_solo_corre_en_push_a_main_y_con_el_proyecto_configurado():
    condicion = DEPLOY["if"]
    assert "refs/heads/main" in condicion and "push" in condicion
    assert "vars.GCP_PROJECT_ID" in condicion  # sin bootstrap de GCP, el job se saltea


def test_el_deploy_no_usa_claves_json_sino_workload_identity():
    assert DEPLOY["permissions"]["id-token"] == "write"
    texto = str(DEPLOY)
    assert "workload_identity_provider" in texto
    assert "credentials_json" not in texto


def test_el_deploy_fija_una_sola_instancia_por_el_rate_limit_en_memoria():
    comando = _paso("Desplegar")["run"]
    assert "--max-instances 1" in comando
    assert "--min-instances 0" in comando


def test_el_job_de_postgres_corre_la_suite_contra_un_servicio_postgres():
    job = CI["jobs"]["python-postgres"]
    assert job["env"]["CT_TEST_DB"].startswith("postgresql+psycopg://")
    assert "postgres" in job["services"]


def test_el_deploy_entrega_todos_los_secretos_que_el_portal_necesita():
    entregados = set(_secretos_del_deploy())
    indispensables = {
        "CT_CLOUD_DB",
        "CT_CLOUD_SECRET",
        "CT_PUBLISH_KEY",
        "CT_MP_ACCESS_TOKEN",
        "CT_MP_WEBHOOK_SECRET",
        "CT_GOOGLE_CLIENT_ID",
        "CT_GOOGLE_CLIENT_SECRET",
        "CT_SMTP_HOST",
        "CT_SMTP_PORT",
        "CT_SMTP_USER",
        "CT_SMTP_PASSWORD",
        "CT_SMTP_FROM",
    }
    assert indispensables <= entregados


def test_cada_variable_ct_del_deploy_la_lee_el_codigo_del_portal():
    codigo = "\n".join(p.read_text(encoding="utf-8") for p in (RAIZ / "cloud").glob("*.py"))
    comando = _paso("Desplegar")["run"]
    entregadas = set(_secretos_del_deploy()) | set(re.findall(r"(CT_[A-Z_]+)=\$\{\{", comando))
    assert {v for v in entregadas if f'"{v}"' not in codigo} == set()


def test_las_variables_de_ci_que_exige_el_deploy_estan_documentadas():
    deploy_md = (RAIZ / "DEPLOY.md").read_text(encoding="utf-8")
    usadas = set(re.findall(r"vars\.([A-Z_]+)", str(DEPLOY)))
    assert {v for v in usadas if v not in deploy_md} == set()
