from __future__ import annotations

from datetime import datetime
from typing import Annotated
from typing import Literal

from pydantic import BaseModel
from pydantic import ConfigDict
from pydantic import StringConstraints

ThreadTitle = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=3, max_length=120)
]
ThreadBody = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=4000)
]
ReplyBody = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)
]

QUEST_CATEGORIES = frozenset({"teammates", "help", "tips", "general"})
GROVE_CATEGORIES = frozenset(
    {"campus-life", "quest-help", "team-finder", "ideas", "general"}
)


class DiscussionAuthor(BaseModel):
    id: str
    name: str


class ThreadCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: ThreadTitle
    category: str
    body: ThreadBody


class ReplyCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    body: ReplyBody


class ThreadAttributes(BaseModel):
    scope: str
    title: str
    category: str
    body: str
    author: DiscussionAuthor
    created_at: datetime
    reply_count: int


class ThreadResourceData(BaseModel):
    type: Literal["discussion-threads"] = "discussion-threads"
    id: str
    attributes: ThreadAttributes


class ReplyAttributes(BaseModel):
    thread_id: str
    body: str
    author: DiscussionAuthor
    created_at: datetime


class ReplyResourceData(BaseModel):
    type: Literal["discussion-replies"] = "discussion-replies"
    id: str
    attributes: ReplyAttributes


class ThreadDetailAttributes(ThreadAttributes):
    pass