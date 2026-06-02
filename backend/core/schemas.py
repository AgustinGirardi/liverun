from pydantic import BaseModel, Field
from typing import Optional
from datetime import date, datetime
from enum import Enum


# ── Enums ─────────────────────────────────────────────────────────────────────

class RaceStatusSchema(str, Enum):
    PLANNED  = "PLANNED"
    ACTIVE   = "ACTIVE"
    FINISHED = "FINISHED"

class CaptureStatusSchema(str, Enum):
    PENDING   = "PENDING"
    ASSIGNED  = "ASSIGNED"
    DISCARDED = "DISCARDED"

class RegistrationStatusSchema(str, Enum):
    OK  = "OK"
    DNS = "DNS"
    DNF = "DNF"
    DQ  = "DQ"


# ── Runners ───────────────────────────────────────────────────────────────────

class RunnerCreate(BaseModel):
    first_name: str  = Field(..., min_length=1, max_length=100)
    last_name:  str  = Field(..., min_length=1, max_length=100)
    email:      Optional[str]  = None
    dni:        Optional[str]  = None
    birth_date: Optional[date] = None
    gender:     Optional[str]  = None
    category:   Optional[str]  = None
    club:       Optional[str]  = None

class RunnerUpdate(BaseModel):
    first_name: Optional[str]  = None
    last_name:  Optional[str]  = None
    email:      Optional[str]  = None
    dni:        Optional[str]  = None
    birth_date: Optional[date] = None
    gender:     Optional[str]  = None
    category:   Optional[str]  = None
    club:       Optional[str]  = None

class RunnerOut(BaseModel):
    id:         int
    first_name: str
    last_name:  str
    full_name:  str
    email:      Optional[str]  = None
    dni:        Optional[str]  = None
    birth_date: Optional[date] = None
    gender:     Optional[str]  = None
    category:   Optional[str]  = None
    club:       Optional[str]  = None
    created_at: datetime
    model_config = {"from_attributes": True}


# ── Races ─────────────────────────────────────────────────────────────────────

class RaceCreate(BaseModel):
    name:      str            = Field(..., min_length=1, max_length=200)
    location:  Optional[str]  = None
    race_date: Optional[date] = None

class RaceUpdate(BaseModel):
    name:        Optional[str]   = None
    location:    Optional[str]   = None
    race_date:   Optional[date]  = None
    distance_km: Optional[float] = None
    status:      Optional[RaceStatusSchema] = None

class RaceOut(BaseModel):
    id:            int
    name:          str
    location:      Optional[str]   = None
    race_date:     Optional[date]  = None
    distance_km:   Optional[float] = None
    status:        str
    race_start_ns: Optional[int]   = None
    created_at:    datetime
    model_config = {"from_attributes": True}


# ── Registrations ─────────────────────────────────────────────────────────────

class RegistrationCreate(BaseModel):
    runner_id:   int
    race_id:     int
    bib_number:  str = Field(..., min_length=1, max_length=20)
    distance_km: Optional[float] = None

class RegistrationStatusUpdate(BaseModel):
    status: RegistrationStatusSchema

class RegistrationOut(BaseModel):
    id:            int
    runner_id:     int
    race_id:       int
    bib_number:    str
    distance_km:   Optional[float] = None
    status:        str = "OK"
    runner:        RunnerOut
    registered_at: datetime
    model_config = {"from_attributes": True}

class BulkDeleteRequest(BaseModel):
    ids: list[int] = Field(..., min_length=1)


# ── Timing ────────────────────────────────────────────────────────────────────

class CaptureOut(BaseModel):
    id:             int
    race_id:        int
    captured_ns:    int
    sequence_order: int
    capture_device: Optional[str] = None
    status:         str
    created_at:     datetime
    model_config = {"from_attributes": True}

class AssignBibRequest(BaseModel):
    bib_number: str = Field(..., min_length=1, max_length=20)

class AssignBibResponse(BaseModel):
    split_id:        int
    capture_id:      int
    capture_ns:      int
    bib_number:      str
    runner:          RunnerOut
    checkpoint_name: Optional[str] = None
    net_time_ns:     Optional[int] = None
    position:        Optional[int] = None
    model_config = {"from_attributes": True}

class BibLookupResponse(BaseModel):
    found:            bool
    bib_number:       str
    runner:           Optional[RunnerOut] = None
    already_finished: bool = False


# ── WebSocket ─────────────────────────────────────────────────────────────────

class WSEventType(str, Enum):
    CAPTURE        = "CAPTURE"
    ASSIGNED       = "ASSIGNED"
    UNASSIGNED     = "UNASSIGNED"
    DISCARDED      = "DISCARDED"
    RESULTS_UPDATE = "RESULTS_UPDATE"
    ERROR          = "ERROR"

class WSEvent(BaseModel):
    event: WSEventType
    data:  dict


# ── Results ───────────────────────────────────────────────────────────────────

class ResultRow(BaseModel):
    position:       int
    bib_number:     str
    runner:         RunnerOut
    finish_time_ns: int
    net_time_ns:    Optional[int]   = None
    category:       Optional[str]   = None
    club:           Optional[str]   = None
    distance_km:    Optional[float] = None
    model_config = {"from_attributes": True}

class DNFRow(BaseModel):
    bib_number:  str
    runner:      RunnerOut
    status:      str
    category:    Optional[str]   = None
    club:        Optional[str]   = None
    distance_km: Optional[float] = None

class RaceResults(BaseModel):
    race:             RaceOut
    total_finishers:  int
    total_registered: int
    results:          list[ResultRow]
    dnf_list:         list[DNFRow] = []
    distances:        list[float]  = []


# ── Import ────────────────────────────────────────────────────────────────────

class ImportResult(BaseModel):
    created: int
    skipped: int
    errors:  list[str]
