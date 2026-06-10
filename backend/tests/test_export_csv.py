"""El CSV de resultados: las filas DNS/DNF/DQ deben respetar las columnas del encabezado."""
import csv
import io

from backend.tests.conftest import make_runner, make_race, register


def test_dnf_rows_have_same_columns_as_header(client):
    runner = make_runner(client, first="Beto", last="Lopez")
    race = make_race(client)
    reg = register(client, race["id"], runner["id"], bib="42", distance_km=10.0)
    r = client.patch(
        f"/api/v1/races/{race['id']}/registrations/{reg['id']}/status",
        json={"status": "DNS"},
    )
    assert r.status_code == 200

    text = client.get(f"/api/v1/races/{race['id']}/export/csv").text
    rows = list(csv.reader(io.StringIO(text)))

    header = rows[0]
    dnf_rows = [row for row in rows if "42" in row]
    assert len(dnf_rows) == 1
    dnf = dnf_rows[0]

    assert len(dnf) == len(header)
    # El dorsal debe caer bajo la columna "Dorsal", no bajo "Distancia"
    assert dnf[header.index("Dorsal")] == "42"
    assert "DNS" in dnf
