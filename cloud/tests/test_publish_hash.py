import hashlib
from cloud.db import SessionLocal
from cloud.models import PublishedResult


def _h(email):
    return hashlib.sha256(("chronotrack-v1:" + email.strip().lower()).encode()).hexdigest()


def test_publish_stores_email_hash(client):
    from cloud.tests.conftest import publish_race
    h = _h("Juan@Mail.com")
    publish_race(client, results=[{
        "bib_number": "1", "full_name": "Juan Perez",
        "distance_km": 10.0, "net_time_ns": 1_800_000_000_000,
        "position": 1, "status": "FINISHER", "email_hash": h,
    }])
    db = SessionLocal()
    try:
        res = db.query(PublishedResult).one()
        assert res.email_hash == h
    finally:
        db.close()


def test_publish_without_hash_is_null(client):
    from cloud.tests.conftest import publish_race
    publish_race(client, results=[{
        "bib_number": "2", "full_name": "Ana Gomez",
        "distance_km": 10.0, "net_time_ns": 1_900_000_000_000,
        "position": 2, "status": "FINISHER",
    }])
    db = SessionLocal()
    try:
        res = db.query(PublishedResult).filter_by(bib_number="2").one()
        assert res.email_hash is None
    finally:
        db.close()
