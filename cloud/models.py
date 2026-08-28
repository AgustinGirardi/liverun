"""Modelos del portal público.

PRIVACIDAD: este servicio NUNCA almacena DNI ni fecha de nacimiento.
Solo datos públicos de resultado: nombre, dorsal, categoría, club, tiempo, posición.
"""
from datetime import datetime
from sqlalchemy import (
    Column, Integer, BigInteger, String, Float, Date, DateTime, Text,
    ForeignKey, UniqueConstraint, func,
)
from sqlalchemy.orm import relationship
from cloud.db import Base


class PortalUser(Base):
    __tablename__ = "portal_users"
    id            = Column(Integer, primary_key=True, autoincrement=True)
    email         = Column(String(255), nullable=False, unique=True, index=True)
    password_hash = Column(String(255), nullable=False)
    full_name     = Column(String(200), nullable=True)
    created_at    = Column(DateTime, server_default=func.now())
    # ── ChronoTrack Run (app móvil) ── cuenta unificada con el portal
    google_id     = Column(String(64), nullable=True, unique=True)
    username      = Column(String(30), nullable=True, unique=True, index=True)
    weekly_goal   = Column(Integer, nullable=False, default=3, server_default="3")
    avatar_url    = Column(String(400), nullable=True)
    # ── Suscripción / acceso ──
    # access = is_admin OR premium_until>now OR (created_at + prueba) > now.
    # La prueba gratis se computa desde created_at (no se almacena); premium_until
    # lo extienden los pagos (web/tienda), los cupones o un admin.
    is_admin      = Column(Integer, nullable=False, default=0, server_default="0")
    premium_until = Column(DateTime, nullable=True)
    # Descuento pendiente dejado por un cupón "discount"; lo consume el checkout.
    pending_discount_percent = Column(Integer, nullable=True)
    claims        = relationship("Claim", back_populates="user", cascade="all, delete-orphan")
    activities    = relationship("Activity", back_populates="user", cascade="all, delete-orphan")


class PublishedRace(Base):
    __tablename__ = "published_races"
    id           = Column(Integer, primary_key=True, autoincrement=True)
    source_id    = Column(String(64), nullable=False, unique=True, index=True)  # id estable del organizador
    code         = Column(String(12), nullable=False, unique=True, index=True)  # código público corto
    name         = Column(String(200), nullable=False)
    location     = Column(String(200), nullable=True)
    race_date    = Column(Date, nullable=True)
    distances    = Column(String(200), nullable=True)  # CSV de distancias, ej "5.0,10.0"
    published_at = Column(DateTime, server_default=func.now())
    results      = relationship("PublishedResult", back_populates="race", cascade="all, delete-orphan")


class PublishedResult(Base):
    __tablename__ = "published_results"
    id             = Column(Integer, primary_key=True, autoincrement=True)
    race_id        = Column(Integer, ForeignKey("published_races.id", ondelete="CASCADE"), nullable=False, index=True)
    bib_number     = Column(String(20), nullable=False)
    full_name      = Column(String(200), nullable=False)
    category       = Column(String(40), nullable=True)
    club           = Column(String(100), nullable=True)
    distance_km    = Column(Float, nullable=True)
    net_time_ns    = Column(BigInteger, nullable=True)
    finish_time_ns = Column(BigInteger, nullable=True)
    position       = Column(Integer, nullable=True)
    status         = Column(String(12), nullable=False, default="FINISHER")  # FINISHER/DNF/DNS/DQ
    email_hash     = Column(String(64), nullable=True, index=True)  # sha256 hex del email (privacy-preserving); ver design doc
    race           = relationship("PublishedRace", back_populates="results")
    claims         = relationship("Claim", back_populates="result", cascade="all, delete-orphan")
    __table_args__ = (UniqueConstraint("race_id", "bib_number", "distance_km", name="uq_race_bib_dist"),)


class Activity(Base):
    """Salida de running registrada desde la app móvil (ChronoTrack Run).

    Los cálculos (distancia, ritmo, splits) los hace el teléfono; acá solo se
    persisten. `client_uuid` lo genera la app para que la cola de sincronización
    offline no duplique salidas al reintentar."""
    __tablename__ = "run_activities"
    id                = Column(Integer, primary_key=True, autoincrement=True)
    user_id           = Column(Integer, ForeignKey("portal_users.id", ondelete="CASCADE"), nullable=False, index=True)
    client_uuid       = Column(String(64), nullable=False)
    started_at        = Column(DateTime, nullable=False, index=True)
    duration_s        = Column(Integer, nullable=False)            # neto, sin pausas
    distance_m        = Column(Float, nullable=False)
    avg_pace_s_per_km = Column(Float, nullable=True)
    splits            = Column(Text, nullable=True)                # JSON: [seg km1, seg km2, ...]
    polyline          = Column(Text, nullable=True)                # encoded polyline del recorrido
    created_at        = Column(DateTime, server_default=func.now())
    user              = relationship("PortalUser", back_populates="activities")
    __table_args__ = (UniqueConstraint("user_id", "client_uuid", name="uq_user_client_uuid"),)


class Friendship(Base):
    """Amistad entre corredores: solicitud → aceptación mutua.
    Solo amigos aceptados comparten ranking y actividades (privacidad:
    un recorrido revela dónde vive el usuario)."""
    __tablename__ = "run_friendships"
    id           = Column(Integer, primary_key=True, autoincrement=True)
    requester_id = Column(Integer, ForeignKey("portal_users.id", ondelete="CASCADE"), nullable=False, index=True)
    addressee_id = Column(Integer, ForeignKey("portal_users.id", ondelete="CASCADE"), nullable=False, index=True)
    status       = Column(String(10), nullable=False, default="pending")  # pending/accepted
    created_at   = Column(DateTime, server_default=func.now())
    accepted_at  = Column(DateTime, nullable=True)
    __table_args__ = (UniqueConstraint("requester_id", "addressee_id", name="uq_friendship_pair"),)


class CoachAthlete(Base):
    """Vínculo entrenador → atleta, con el mismo consentimiento explícito que
    las amistades: el entrenador invita y el atleta acepta.

    Todavía sin endpoints ni pantalla — la tabla existe para que el panel de
    entrenadores/clubes no obligue a migrar datos cuando se construya. El plan:
    el entrenador ve el historial y la evolución de los atletas que lo
    aceptaron, reusando /api/me/results por atleta. El campo `club` que ya
    viaja en cada resultado permite además agrupar por equipo.

    PRIVACIDAD: sin `status='accepted'` no se comparte nada. Un resultado
    oficial es público, pero el historial agregado de una persona no lo es.
    """
    __tablename__ = "run_coach_athletes"
    id           = Column(Integer, primary_key=True, autoincrement=True)
    coach_id     = Column(Integer, ForeignKey("portal_users.id", ondelete="CASCADE"), nullable=False, index=True)
    athlete_id   = Column(Integer, ForeignKey("portal_users.id", ondelete="CASCADE"), nullable=False, index=True)
    status       = Column(String(10), nullable=False, default="pending")  # pending/accepted
    club         = Column(String(100), nullable=True)   # equipo con el que el entrenador lo agrupa
    created_at   = Column(DateTime, server_default=func.now())
    accepted_at  = Column(DateTime, nullable=True)
    __table_args__ = (UniqueConstraint("coach_id", "athlete_id", name="uq_coach_athlete_pair"),)


class Coupon(Base):
    """Cupón para promocionar la app. Dos tipos:
    - free_months: al canjear, suma N meses de premium al instante.
    - discount: deja un % de descuento pendiente en la cuenta para el próximo
      pago (lo consume el checkout cuando exista el cobro)."""
    __tablename__ = "run_coupons"
    id              = Column(Integer, primary_key=True, autoincrement=True)
    code            = Column(String(32), nullable=False, unique=True, index=True)
    kind            = Column(String(16), nullable=False)            # free_months | discount
    months          = Column(Integer, nullable=True)               # para free_months
    percent_off     = Column(Integer, nullable=True)               # para discount (1..100)
    max_redemptions = Column(Integer, nullable=True)               # null = ilimitado
    redeemed_count  = Column(Integer, nullable=False, default=0, server_default="0")
    expires_at      = Column(DateTime, nullable=True)
    active          = Column(Integer, nullable=False, default=1, server_default="1")
    created_at      = Column(DateTime, server_default=func.now())
    redemptions     = relationship("CouponRedemption", back_populates="coupon", cascade="all, delete-orphan")


class CouponRedemption(Base):
    """Un canje de cupón por un usuario (un usuario no puede canjear el mismo dos veces)."""
    __tablename__ = "run_coupon_redemptions"
    id          = Column(Integer, primary_key=True, autoincrement=True)
    coupon_id   = Column(Integer, ForeignKey("run_coupons.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id     = Column(Integer, ForeignKey("portal_users.id", ondelete="CASCADE"), nullable=False, index=True)
    redeemed_at = Column(DateTime, server_default=func.now())
    coupon      = relationship("Coupon", back_populates="redemptions")
    __table_args__ = (UniqueConstraint("coupon_id", "user_id", name="uq_coupon_user"),)


class BillingSubscription(Base):
    """Suscripción de Mercado Pago (preapproval) de un usuario. Mapea el id de
    MP a nuestro usuario para procesar los cobros recurrentes del webhook."""
    __tablename__ = "run_billing_subscriptions"
    id                = Column(Integer, primary_key=True, autoincrement=True)
    user_id           = Column(Integer, ForeignKey("portal_users.id", ondelete="CASCADE"), nullable=False, index=True)
    mp_preapproval_id = Column(String(64), nullable=False, unique=True, index=True)
    status            = Column(String(20), nullable=False, default="pending")  # pending/authorized/cancelled
    created_at        = Column(DateTime, server_default=func.now())


class BillingPayment(Base):
    """Cada cobro aprobado de Mercado Pago. mp_payment_id único = idempotencia:
    el webhook puede reintentar y nunca extendemos premium dos veces."""
    __tablename__ = "run_billing_payments"
    id            = Column(Integer, primary_key=True, autoincrement=True)
    user_id       = Column(Integer, ForeignKey("portal_users.id", ondelete="CASCADE"), nullable=False, index=True)
    mp_payment_id = Column(String(64), nullable=False, unique=True, index=True)
    amount        = Column(Float, nullable=True)
    status        = Column(String(20), nullable=True)
    created_at    = Column(DateTime, server_default=func.now())


class Claim(Base):
    __tablename__ = "claims"
    id         = Column(Integer, primary_key=True, autoincrement=True)
    user_id    = Column(Integer, ForeignKey("portal_users.id", ondelete="CASCADE"), nullable=False)
    result_id  = Column(Integer, ForeignKey("published_results.id", ondelete="CASCADE"), nullable=False)
    claimed_at = Column(DateTime, server_default=func.now())
    user       = relationship("PortalUser", back_populates="claims")
    result     = relationship("PublishedResult", back_populates="claims")
    __table_args__ = (UniqueConstraint("user_id", "result_id", name="uq_user_result"),)
