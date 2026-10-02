from __future__ import annotations

from datetime import datetime
from typing import Literal

from models.users import UserEmail
from pydantic import BaseModel
from pydantic import ConfigDict


class LoginRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: UserEmail
    password: str


class TokenAttributes(BaseModel):
    access_token: str
    token_type: Literal["bearer"] = "bearer"
    expires_at: datetime


class TokenResourceData(BaseModel):
    type: Literal["tokens"] = "tokens"
    id: str
    attributes: TokenAttributes
