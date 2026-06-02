from sqlalchemy import (
    Column, Integer, BigInteger, String, Float, Date,
    ForeignKey, Enum, UniqueConstraint, Index,
    func, DateTime
)
from sqlalchemy.orm import relationship, DeclarativeBase
import enum

class Base(DeclarativeBase):
    pass

class RaceStatus(str, enum.Enum):
    PLANNED = "PLANNED"
    ACTIVE = "ACTIVE"
    FINISHED = "FINISHED"

class CheckpointType(str, enum.Enum):
    START = "START"
    SPLIT = "SPLIT"
    FINISH = "FINISH"

class CaptureStatus(str, enum.Enum):
    PENDING = "PENDING"
    ASSIGNED = "ASSIGNED"
    DISCARDED = "DISCARDED"

class Gender(str, enum.Enum):
    M = "M"
    F = "F"
    X = "X"

class RegistrationStatus(str, enum.Enum):
    OK  = "OK"
    DNS = "DNS"   # Did Not Start
    DNF = "DNF"   # Did Not Finish
    DQ  = "DQ"    # Disqualified

class Runner(Base):
    __tablename__ = "runners"
    id         = Column(Integer, primary_key=True, autoincrement=True)
    first_name = Column(String(100), nullable=False)
    last_name  = Column(String(100), nullable=False)
    email      = Column(String(200), nullable=True)
    dni        = Column(String(20),  nullable=True)
    birth_date = Column(Date,        nullable=True)
    gender     = Column(Enum(Gender), nullable=True)
    category   = Column(String(20),  nullable=True)
    club       = Column(String(100), nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    registrations = relationship("Registration", back_populates="runner")

class Race(Base):
    __tablename__ = "races"
    id             = Column(Integer, primary_key=True, autoincrement=True)
    name           = Column(String(200), nullable=False)
    location       = Column(String(200), nullable=True)
    race_date      = Column(Date, nullable=True)
    distance_km    = Column(Float, nullable=True)
    status         = Column(Enum(RaceStatus), default=RaceStatus.PLANNED)
    race_start_ns  = Column(BigInteger, nullable=True)
    created_at     = Column(DateTime, server_default=func.now())
    registrations  = relationship("Registration", back_populates="race")
    checkpoints    = relationship("Checkpoint", back_populates="race", order_by="Checkpoint.sequence")
    captures       = relationship("TimestampCapture", back_populates="race")

class Registration(Base):
    __tablename__ = "registrations"
    id           = Column(Integer, primary_key=True, autoincrement=True)
    runner_id    = Column(Integer, ForeignKey("runners.id", ondelete="RESTRICT"), nullable=False)
    race_id      = Column(Integer, ForeignKey("races.id", ondelete="CASCADE"), nullable=False)
    bib_number   = Column(String(20), nullable=False)
    distance_km  = Column(Float, nullable=True)
    status       = Column(Enum(RegistrationStatus), nullable=False, default=RegistrationStatus.OK, server_default="OK")
    registered_at = Column(DateTime, server_default=func.now())
    runner       = relationship("Runner", back_populates="registrations")
    race         = relationship("Race", back_populates="registrations")
    splits       = relationship("Split", back_populates="registration")
    __table_args__ = (
        UniqueConstraint("race_id", "bib_number", name="uq_race_bib"),
        Index("ix_registration_bib", "race_id", "bib_number"),
    )

class Checkpoint(Base):
    __tablename__ = "checkpoints"
    id              = Column(Integer, primary_key=True, autoincrement=True)
    race_id         = Column(Integer, ForeignKey("races.id", ondelete="CASCADE"), nullable=False)
    name            = Column(String(100), nullable=False)
    checkpoint_type = Column(Enum(CheckpointType), nullable=False)
    distance_km     = Column(Float, nullable=True)
    sequence        = Column(Integer, nullable=False)
    race            = relationship("Race", back_populates="checkpoints")
    splits          = relationship("Split", back_populates="checkpoint")

class TimestampCapture(Base):
    __tablename__ = "timestamp_captures"
    id             = Column(Integer, primary_key=True, autoincrement=True)
    race_id        = Column(Integer, ForeignKey("races.id", ondelete="CASCADE"), nullable=False)
    captured_ns    = Column(BigInteger, nullable=False)
    sequence_order = Column(Integer, nullable=False)
    capture_device = Column(String(100), nullable=True, default="operator-1")
    status         = Column(Enum(CaptureStatus), default=CaptureStatus.PENDING)
    created_at     = Column(DateTime, server_default=func.now())
    race           = relationship("Race", back_populates="captures")
    split          = relationship("Split", back_populates="timestamp_capture", uselist=False)

class Split(Base):
    __tablename__ = "splits"
    id              = Column(Integer, primary_key=True, autoincrement=True)
    timestamp_id    = Column(Integer, ForeignKey("timestamp_captures.id", ondelete="RESTRICT"), nullable=False, unique=True)
    registration_id = Column(Integer, ForeignKey("registrations.id", ondelete="RESTRICT"), nullable=False)
    checkpoint_id   = Column(Integer, ForeignKey("checkpoints.id", ondelete="RESTRICT"), nullable=True)
    assigned_by     = Column(String(100), nullable=True, default="operator-1")
    assigned_at     = Column(DateTime, server_default=func.now())
    timestamp_capture = relationship("TimestampCapture", back_populates="split")
    registration      = relationship("Registration", back_populates="splits")
    checkpoint        = relationship("Checkpoint", back_populates="splits")
