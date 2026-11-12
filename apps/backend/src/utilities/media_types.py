"""Which proof files the API accepts, and how big they may be (BE-37).

The declared Content-Type has to be on the list AND the first bytes of the file
have to look like that type, so a renamed .exe does not get stored as a photo.
"""
from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

MEGABYTE = 1024 * 1024


class MediaKind(StrEnum):
    PHOTO = "photo"
    VIDEO = "video"


@dataclass(frozen=True)
class MediaType:
    content_type: str
    kind: MediaKind


ALLOWED_MEDIA_TYPES: dict[str, MediaType] = {
    media_type.content_type: media_type
    for media_type in (
        MediaType("image/jpeg", MediaKind.PHOTO),
        MediaType("image/png", MediaKind.PHOTO),
        MediaType("image/webp", MediaKind.PHOTO),
        MediaType("image/heic", MediaKind.PHOTO),
        MediaType("image/heif", MediaKind.PHOTO),
        MediaType("video/mp4", MediaKind.VIDEO),
        MediaType("video/quicktime", MediaKind.VIDEO),
    )
}

# What a phone produces for a short clip or a full-resolution photo, with room
# to spare. Change these in one place if the team settles on other limits.
MAX_BYTES: dict[MediaKind, int] = {
    MediaKind.PHOTO: 10 * MEGABYTE,
    MediaKind.VIDEO: 100 * MEGABYTE,
}
MAX_UPLOAD_BYTES = max(MAX_BYTES.values())

HEIF_BRANDS = {b"heic", b"heix", b"hevc", b"hevx", b"mif1", b"msf1", b"heim", b"heis"}
QUICKTIME_ATOMS = {b"ftyp", b"moov", b"mdat", b"wide", b"free", b"skip"}


def normalise_content_type(header: str | None) -> str:
    """'image/JPEG; charset=binary' -> 'image/jpeg'."""
    return (header or "").split(";", 1)[0].strip().lower()


def content_matches(content_type: str, data: bytes) -> bool:
    """A cheap signature check on the first bytes of the file."""
    head = data[:16]
    if content_type == "image/jpeg":
        return head.startswith(b"\xff\xd8\xff")
    if content_type == "image/png":
        return head.startswith(b"\x89PNG\r\n\x1a\n")
    if content_type == "image/webp":
        return head[0:4] == b"RIFF" and head[8:12] == b"WEBP"
    if content_type in ("image/heic", "image/heif"):
        return head[4:8] == b"ftyp" and head[8:12] in HEIF_BRANDS
    if content_type == "video/mp4":
        return head[4:8] == b"ftyp" and head[8:12] not in HEIF_BRANDS
    if content_type == "video/quicktime":
        return head[4:8] in QUICKTIME_ATOMS
    return False
