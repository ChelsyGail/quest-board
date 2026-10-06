from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Annotated
from typing import Literal

from pydantic import BaseModel
from pydantic import ConfigDict
from pydantic import EmailStr
from pydantic import Field
from pydantic import model_validator
from pydantic import StringConstraints

UserName = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)
]
UserEmail = Annotated[EmailStr, Field(max_length=255)]
Password = Annotated[str, StringConstraints(min_length=12, max_length=128)]


class UserRole(StrEnum):
    ADMIN = "admin"  # will approve role requests
    STUDENT = "student"  # do quests
    ORGANIZER = "organizer"  # post quests
    MODERATOR = "moderator"  # validate student submissions/comments


REQUESTABLE_ROLES = frozenset({UserRole.ORGANIZER, UserRole.MODERATOR})


class UserCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: UserEmail
    name: UserName
    password: Password
    # roles: set[UserRole] = Field(
    #    default_factory=lambda: {UserRole.STUDENT}, min_length=1
    # )


class UserUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: UserEmail | None = None
    name: UserName | None = None
    password: Password | None = None
    # roles: set[UserRole] | None = Field(default=None, min_length=1)

    @model_validator(mode="after")
    def require_change(self) -> UserUpdate:
        if not self.model_fields_set:
            raise ValueError("At least one user field must be provided")
        if any(getattr(self, field) is None for field in self.model_fields_set):
            raise ValueError("User fields cannot be null")
        return self


class UserAttributes(BaseModel):
    email: EmailStr
    name: str
    roles: list[UserRole]
    created_at: datetime
    updated_at: datetime


class UserResourceData(BaseModel):
    type: Literal["users"] = "users"
    id: str
    attributes: UserAttributes
