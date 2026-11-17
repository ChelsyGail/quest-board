import logging

from api.catalogue_router import to_item_attributes
from fastapi import APIRouter
from fastapi import Depends
from fastapi import FastAPI
from fastapi import Path
from fastapi import Response
from fastapi import status
from models.participation import AttendeeAttributes
from models.participation import AttendeeResourceData
from models.participation import GroupAttributes
from models.participation import GroupCreate
from models.participation import GroupMemberAttributes
from models.participation import GroupMemberResourceData
from models.participation import GroupResourceData
from models.participation import MyItemAttributes
from models.participation import MyItemResourceData
from models.participation import ParticipationAttributes
from models.participation import ParticipationResourceData
from models.participation import ParticipationSummary
from models.responses.participation import AttendeeListResponse
from models.responses.participation import GroupErrorResponse
from models.responses.participation import GroupMemberListResponse
from models.responses.participation import GroupResponse
from models.responses.participation import MyItemListResponse
from models.responses.participation import ParticipationErrorResponse
from models.responses.participation import ParticipationResponse
from services.participation_service import AlreadyInAGroupError
from services.participation_service import AlreadyJoinedError
from services.participation_service import AttendeeRecord
from services.participation_service import DuplicateGroupNameError
from services.participation_service import GroupMemberRecord
from services.participation_service import GroupNotFoundError
from services.participation_service import GroupRecord
from services.participation_service import ItemNotAvailableError
from services.participation_service import MyItemRecord
from services.participation_service import NotAParticipantError
from services.participation_service import NotAQuestError
from services.participation_service import NotInGroupError
from services.participation_service import NotJoinedError
from services.participation_service import ParticipationLockedError
from services.participation_service import ParticipationRecord
from utilities.auth import build_current_user_dependency
from utilities.auth import CurrentUser
from utilities.json_api_errors import json_api_error_response
from utilities.services import Services

logger = logging.getLogger(__name__)

GROUP_ERROR_RESPONSES = {
    401: {"model": GroupErrorResponse},
    403: {"model": GroupErrorResponse},
    404: {"model": GroupErrorResponse},
    409: {"model": GroupErrorResponse},
    422: {"model": GroupErrorResponse},
}

JOIN_ERROR_RESPONSES = {
    401: {"model": ParticipationErrorResponse},
    404: {"model": ParticipationErrorResponse},
    409: {"model": ParticipationErrorResponse},
    422: {"model": ParticipationErrorResponse},
}


def setup_participation_router(app: FastAPI, services: Services):
    router = APIRouter(tags=["participation"])
    get_current_user = build_current_user_dependency(services.auth_service)

    @router.post(
        "/items/{item_id}/join",
        response_model=ParticipationResponse,
        response_model_exclude_none=True,
        status_code=status.HTTP_201_CREATED,
        responses=JOIN_ERROR_RESPONSES,
    )
    def join_item(
        item_id: int = Path(gt=0),
        current_user: CurrentUser = Depends(get_current_user),
    ):
        try:
            record = services.participation_service.join_item(
                current_user.user_id, item_id
            )
        except ItemNotAvailableError:
            return _item_not_available()
        except AlreadyJoinedError:
            return _already_joined()
        return ParticipationResponse(data=_to_resource(record))

    @router.delete(
        "/items/{item_id}/join",
        status_code=status.HTTP_204_NO_CONTENT,
        responses=JOIN_ERROR_RESPONSES,
    )
    def leave_item(
        item_id: int = Path(gt=0),
        current_user: CurrentUser = Depends(get_current_user),
    ):
        try:
            services.participation_service.leave_item(current_user.user_id, item_id)
        except NotJoinedError:
            return _not_joined()
        except ParticipationLockedError:
            return _proof_already_submitted()
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    @router.put(
        "/items/{item_id}/saved",
        status_code=status.HTTP_204_NO_CONTENT,
        responses={
            401: {"model": ParticipationErrorResponse},
            404: {"model": ParticipationErrorResponse},
            422: {"model": ParticipationErrorResponse},
        },
    )
    def save_item(
        item_id: int = Path(gt=0),
        current_user: CurrentUser = Depends(get_current_user),
    ):
        try:
            services.participation_service.save_item(current_user.user_id, item_id)
        except ItemNotAvailableError:
            return _item_not_available()
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    @router.delete(
        "/items/{item_id}/saved",
        status_code=status.HTTP_204_NO_CONTENT,
        responses={
            401: {"model": ParticipationErrorResponse},
            422: {"model": ParticipationErrorResponse},
        },
    )
    def unsave_item(
        item_id: int = Path(gt=0),
        current_user: CurrentUser = Depends(get_current_user),
    ):
        services.participation_service.unsave_item(current_user.user_id, item_id)
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    @router.get(
        "/items/{item_id}/attendees",
        response_model=AttendeeListResponse,
        response_model_exclude_none=True,
        responses={
            401: {"model": ParticipationErrorResponse},
            404: {"model": ParticipationErrorResponse},
            422: {"model": ParticipationErrorResponse},
        },
    )
    def list_attendees(
        item_id: int = Path(gt=0),
        current_user: CurrentUser = Depends(get_current_user),
    ):
        try:
            result = services.participation_service.list_attendees(item_id)
        except ItemNotAvailableError:
            return _item_not_available()
        return AttendeeListResponse(
            data=[_to_attendee(attendee) for attendee in result.attendees],
            meta={
                "visible_count": len(result.attendees),
                "hidden_count": result.hidden_count,
                "total_count": result.total_count,
            },
        )

    @router.post(
        "/items/{item_id}/groups",
        response_model=GroupResponse,
        response_model_exclude_none=True,
        status_code=status.HTTP_201_CREATED,
        responses=GROUP_ERROR_RESPONSES,
    )
    def create_group(
        item_id: int = Path(gt=0),
        *,
        group: GroupCreate,
        current_user: CurrentUser = Depends(get_current_user),
    ):
        try:
            record = services.participation_service.create_group(
                current_user.user_id, item_id, group.name
            )
        except ItemNotAvailableError:
            return _item_not_available()
        except NotAQuestError:
            return _not_a_quest()
        except NotAParticipantError:
            return _not_a_participant()
        except AlreadyInAGroupError:
            return _already_in_a_group()
        except DuplicateGroupNameError:
            return _group_name_taken()
        return GroupResponse(data=_to_group(record))

    @router.get(
        "/items/{item_id}/groups",
        response_model=GroupResponse,
        response_model_exclude_none=True,
        responses={
            401: {"model": GroupErrorResponse},
            404: {"model": GroupErrorResponse},
            422: {"model": GroupErrorResponse},
        },
    )
    def list_groups(
        item_id: int = Path(gt=0),
        current_user: CurrentUser = Depends(get_current_user),
    ):
        try:
            records = services.participation_service.list_groups(item_id)
        except ItemNotAvailableError:
            return _item_not_available()
        except NotAQuestError:
            return _not_a_quest()
        return GroupResponse(
            data=[_to_group(record) for record in records],
            meta={"count": len(records)},
        )

    @router.post(
        "/groups/{group_id}/members",
        status_code=status.HTTP_204_NO_CONTENT,
        responses=GROUP_ERROR_RESPONSES,
    )
    def join_group(
        group_id: int = Path(gt=0),
        current_user: CurrentUser = Depends(get_current_user),
    ):
        try:
            services.participation_service.join_group(current_user.user_id, group_id)
        except GroupNotFoundError:
            return _group_not_found()
        except ItemNotAvailableError:
            return _item_not_available()
        except NotAQuestError:
            return _not_a_quest()
        except NotAParticipantError:
            return _not_a_participant()
        except AlreadyInAGroupError:
            return _already_in_a_group()
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    @router.delete(
        "/groups/{group_id}/members/me",
        status_code=status.HTTP_204_NO_CONTENT,
        responses=GROUP_ERROR_RESPONSES,
    )
    def leave_group(
        group_id: int = Path(gt=0),
        current_user: CurrentUser = Depends(get_current_user),
    ):
        try:
            services.participation_service.leave_group(current_user.user_id, group_id)
        except GroupNotFoundError:
            return _group_not_found()
        except NotInGroupError:
            return _not_in_group()
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    @router.get(
        "/groups/{group_id}/members",
        response_model=GroupMemberListResponse,
        response_model_exclude_none=True,
        responses={
            401: {"model": GroupErrorResponse},
            404: {"model": GroupErrorResponse},
            422: {"model": GroupErrorResponse},
        },
    )
    def list_group_members(
        group_id: int = Path(gt=0),
        current_user: CurrentUser = Depends(get_current_user),
    ):
        try:
            records = services.participation_service.list_group_members(group_id)
        except GroupNotFoundError:
            return _group_not_found()
        return GroupMemberListResponse(
            data=[_to_group_member(record) for record in records],
            meta={"count": len(records)},
        )

    @router.get(
        "/me/participations",
        response_model=MyItemListResponse,
        response_model_exclude_none=True,
        responses={401: {"model": ParticipationErrorResponse}},
    )
    def list_my_participations(
        current_user: CurrentUser = Depends(get_current_user),
    ):
        records = services.participation_service.list_my_items(current_user.user_id)
        return MyItemListResponse(
            data=[_to_my_item(record) for record in records],
            meta={
                "count": len(records),
                "joined_count": sum(1 for r in records if r.participation is not None),
                "saved_count": sum(1 for r in records if r.saved),
            },
        )

    app.include_router(router)


def _item_not_available():
    return json_api_error_response(
        ParticipationErrorResponse,
        status.HTTP_404_NOT_FOUND,
        "item_not_found",
        "Item not found",
        "The item does not exist or is not available.",
        "/item_id",
    )


def _already_joined():
    return json_api_error_response(
        ParticipationErrorResponse,
        status.HTTP_409_CONFLICT,
        "already_joined",
        "Already joined",
        "You have already joined this item.",
        "/item_id",
    )


def _not_joined():
    return json_api_error_response(
        ParticipationErrorResponse,
        status.HTTP_404_NOT_FOUND,
        "not_joined",
        "Not joined",
        "You have not joined this item.",
        "/item_id",
    )


def _proof_already_submitted():
    return json_api_error_response(
        ParticipationErrorResponse,
        status.HTTP_409_CONFLICT,
        "proof_already_submitted",
        "Proof already submitted",
        "You cannot leave an item you have already submitted proof for.",
        "/item_id",
    )


def _not_a_quest():
    return json_api_error_response(
        GroupErrorResponse,
        status.HTTP_422_UNPROCESSABLE_ENTITY,
        "groups_are_quest_only",
        "Groups are for quests",
        "Only quests have groups; events have an attendee list.",
        "/item_id",
    )


def _not_a_participant():
    return json_api_error_response(
        GroupErrorResponse,
        status.HTTP_403_FORBIDDEN,
        "not_a_participant",
        "Not a participant",
        "Join the quest before creating or joining one of its groups.",
        "/item_id",
    )


def _already_in_a_group():
    return json_api_error_response(
        GroupErrorResponse,
        status.HTTP_409_CONFLICT,
        "already_in_a_group",
        "Already in a group",
        "You are already in a group for this quest. Leave it first.",
        "/item_id",
    )


def _group_name_taken():
    return json_api_error_response(
        GroupErrorResponse,
        status.HTTP_409_CONFLICT,
        "group_name_taken",
        "Group name taken",
        "Another group on this quest already has that name.",
        "/name",
    )


def _group_not_found():
    return json_api_error_response(
        GroupErrorResponse,
        status.HTTP_404_NOT_FOUND,
        "group_not_found",
        "Group not found",
        "The group does not exist.",
        "/group_id",
    )


def _not_in_group():
    return json_api_error_response(
        GroupErrorResponse,
        status.HTTP_404_NOT_FOUND,
        "not_in_group",
        "Not in this group",
        "You are not a member of this group.",
        "/group_id",
    )


def _to_group(record: GroupRecord) -> GroupResourceData:
    return GroupResourceData(
        id=str(record.group_id),
        attributes=GroupAttributes(
            item_id=str(record.item_id),
            name=record.name,
            created_by=str(record.created_by),
            member_count=record.member_count,
            created_at=record.created_at,
        ),
    )


def _to_group_member(record: GroupMemberRecord) -> GroupMemberResourceData:
    return GroupMemberResourceData(
        id=str(record.user_id),
        attributes=GroupMemberAttributes(name=record.name, joined_at=record.joined_at),
    )


def _to_my_item(record: MyItemRecord) -> MyItemResourceData:
    participation = record.participation
    return MyItemResourceData(
        id=str(record.item.item_id),
        attributes=MyItemAttributes(
            **to_item_attributes(record.item).model_dump(),
            participation=(
                ParticipationSummary(
                    participation_id=str(participation.participation_id),
                    status=participation.status,
                    joined_at=participation.joined_at,
                )
                if participation is not None
                else None
            ),
            saved=record.saved,
        ),
    )


def _to_attendee(record: AttendeeRecord) -> AttendeeResourceData:
    return AttendeeResourceData(
        id=str(record.participation_id),
        attributes=AttendeeAttributes(name=record.name),
    )


def _to_resource(record: ParticipationRecord) -> ParticipationResourceData:
    return ParticipationResourceData(
        id=str(record.participation_id),
        attributes=ParticipationAttributes(
            item_id=str(record.item_id),
            user_id=str(record.user_id),
            status=record.status,
            joined_at=record.joined_at,
        ),
    )
