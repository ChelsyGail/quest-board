from __future__ import annotations

from typing import Any
from typing import Generic
from typing import TypeVar

from pydantic import BaseModel
from pydantic import ConfigDict
from pydantic import model_validator


class JsonApiResourceIdentifier(BaseModel):
    type: str
    id: str


class JsonApiResource(JsonApiResourceIdentifier):
    attributes: dict[str, Any] | None = None


class JsonApiErrorSource(BaseModel):
    pointer: str | None = None
    parameter: str | None = None
    header: str | None = None


class JsonApiError(BaseModel):
    id: str | None = None
    status: str | None = None
    code: str | None = None
    title: str | None = None
    detail: str | None = None
    source: JsonApiErrorSource | None = None
    meta: dict[str, Any] | None = None


class JsonApiInfo(BaseModel):
    version: str | None = None
    ext: list[str] | None = None
    profile: list[str] | None = None


ResourceT = TypeVar("ResourceT")


class JsonApiResponse(BaseModel, Generic[ResourceT]):
    model_config = ConfigDict(populate_by_name=True)

    data: ResourceT | list[ResourceT] | None = None
    errors: list[JsonApiError] | None = None
    meta: dict[str, Any] | None = None

    @model_validator(mode="after")
    def validate_document(self) -> JsonApiResponse[ResourceT]:
        if self.data is not None and self.errors is not None:
            raise ValueError("JSON:API documents cannot contain both data and errors")

        if self.data is None and self.errors is None and self.meta is None:
            raise ValueError("JSON:API documents require data, errors, or meta")

        return self
