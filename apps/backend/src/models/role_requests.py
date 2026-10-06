from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Annotated
from typing import Literal

from models.users import REQUESTABLE_ROLES
from models.users import UserRole
from pydantic import BaseModel
from pydantic import ConfigDict
from pydantic import field_validator
from pydantic import StringConstraints

RequestReason = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)
]


class RoleRequestStatus(StrEnum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"


class RoleRequestCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role: UserRole
    reason: RequestReason | None = None

    @field_validator("role")
    @classmethod
    def require_requestable_role(cls, role: UserRole) -> UserRole:
        if role not in REQUESTABLE_ROLES:
            allowed = ", ".join(sorted(r.value for r in REQUESTABLE_ROLES))
            raise ValueError(f"Only these roles can be requested: {allowed}")
        return role


class RoleRequestAttributes(BaseModel):
    user_id: str
    role: UserRole
    reason: str | None
    status: RoleRequestStatus
    reviewed_by: str | None
    reviewed_at: datetime | None
    created_at: datetime
    updated_at: datetime


class RoleRequestResourceData(BaseModel):
    type: Literal["role-requests"] = "role-requests"
    id: str
    attributes: RoleRequestAttributes
