from __future__ import annotations

from datetime import datetime
from typing import Annotated
from typing import Literal

from pydantic import BaseModel
from pydantic import ConfigDict
from pydantic import StringConstraints

# Login accepts an email, or (when classroom demo is enabled) the aliases
# "admin" / "mod". Signup/password-change keep the stricter UserEmail/Password
# constraints elsewhere — do not reuse this for registration.
LoginIdentifier = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)
]
LoginPassword = Annotated[str, StringConstraints(min_length=1, max_length=128)]


class LoginRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: LoginIdentifier
    password: LoginPassword


class TokenAttributes(BaseModel):
    access_token: str
    token_type: Literal["bearer"] = "bearer"
    expires_at: datetime


class TokenResourceData(BaseModel):
    type: Literal["tokens"] = "tokens"
    id: str
    attributes: TokenAttributes
