from models.participation import AttendeeResourceData
from models.participation import GroupMemberResourceData
from models.participation import GroupResourceData
from models.participation import ParticipationResourceData
from models.responses.json_api import JsonApiResponse


class ParticipationResponse(JsonApiResponse[ParticipationResourceData]):
    pass


class ParticipationErrorResponse(JsonApiResponse[ParticipationResourceData]):
    pass


class AttendeeListResponse(JsonApiResponse[AttendeeResourceData]):
    pass


class GroupResponse(JsonApiResponse[GroupResourceData]):
    pass


class GroupErrorResponse(JsonApiResponse[GroupResourceData]):
    pass


class GroupMemberListResponse(JsonApiResponse[GroupMemberResourceData]):
    pass
