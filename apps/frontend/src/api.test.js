import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  createQuest,
  createRoleRequest,
  formErrorsFrom,
  getCurrentUser,
  getItem,
  isItemNotFound,
  isMissingRoute,
  joinItem,
  listMyParticipations,
  listMyRoleRequests,
  listPublishedItems,
  catalogueEnabled,
  createEvent,
  listMyItems,
  listParticipants,
  listRoleRequests,
  publishItem,
  questApiUnavailableMessage,
  questsDemoEnabled,
  questsEnabled,
  registerUser,
  reviewRoleRequest,
  roleRequestsEnabled,
  updateItem,
  updateUser,
} from "./api.js";

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  };
}

const userResource = {
  data: { type: "users", id: "7", attributes: { name: "Ada", email: "ada@aup.edu" } },
};

function stubFetch(...responses) {
  const fetchMock = vi.fn();
  for (const response of responses) {
    if (response instanceof Error) fetchMock.mockRejectedValueOnce(response);
    else fetchMock.mockResolvedValueOnce(response);
  }
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("api client", () => {
  it("registers without sending roles", async () => {
    const fetchMock = stubFetch(jsonResponse(201, userResource));

    const user = await registerUser("Ada", "ada@aup.edu", "  spaced pass  ");

    expect(user).toEqual({ id: "7", name: "Ada", email: "ada@aup.edu", roles: [] });
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("http://api.test/users");
    expect(options.method).toBe("POST");
    expect(JSON.parse(options.body)).toEqual({
      name: "Ada",
      email: "ada@aup.edu",
      password: "  spaced pass  ",
    });
  });

  it("loads the current user from GET /users/me with the bearer token", async () => {
    const fetchMock = stubFetch(jsonResponse(200, userResource));

    await getCurrentUser("tok");

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("http://api.test/users/me");
    expect(options.method).toBe("GET");
    expect(options.headers.Authorization).toBe("Bearer tok");
    expect(options.body).toBeUndefined();
  });

  it("sends only the given changes in PATCH /users/{id}", async () => {
    const fetchMock = stubFetch(jsonResponse(200, userResource));

    await updateUser("7", { password: "a new password" }, "tok");

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("http://api.test/users/7");
    expect(options.method).toBe("PATCH");
    expect(JSON.parse(options.body)).toEqual({ password: "a new password" });
  });

  it("maps JSON:API error pointers to fields", async () => {
    stubFetch(
      jsonResponse(422, {
        errors: [
          { detail: "Too short", source: { pointer: "/password" } },
          { detail: "Taken", source: { pointer: "/email" } },
        ],
      })
    );

    const error = await registerUser("Ada", "ada@aup.edu", "x").catch((e) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(422);
    expect(error.fieldErrors).toEqual({ password: "Too short", email: "Taken" });
    expect(error.message).toBe("Password: Too short Email: Taken");
  });

  it("marks network failures with status 0 and an unknown result", async () => {
    stubFetch(new TypeError("Failed to fetch"));

    const error = await updateUser("7", { name: "Ada" }, "tok").catch((e) => e);

    expect(error.isNetworkError).toBe(true);
    expect(error.resultUnknown).toBe(true);
    expect(error.message).toMatch(/^Couldn't get a response from the server/);
    expect(error.message).not.toMatch(/not saved|not sent|could not reach/i);
  });

  it("treats only lost or unreadable answers as unknown results", () => {
    expect(new ApiError("x", 0).resultUnknown).toBe(true);
    expect(new ApiError("x", 504).resultUnknown).toBe(true);
    expect(new ApiError("unreadable success", 200).resultUnknown).toBe(true);
    expect(new ApiError("x", 0, {}, "api_not_configured").resultUnknown).toBe(false);
    expect(new ApiError("x", 401).resultUnknown).toBe(false);
    expect(new ApiError("x", 409).resultUnknown).toBe(false);
    expect(new ApiError("x", 422).resultUnknown).toBe(false);
  });

  it("marks a missing route as unsupported", async () => {
    stubFetch(jsonResponse(405, { detail: "Method Not Allowed" }));

    const error = await getCurrentUser("tok").catch((e) => e);

    expect(error.isUnsupported).toBe(true);
    expect(error.isNetworkError).toBe(false);
  });

  it("creates a role request and leaves out an empty reason", async () => {
    const fetchMock = stubFetch(
      jsonResponse(201, {
        data: {
          type: "role-requests",
          id: "3",
          attributes: { role: "organizer", status: "pending" },
        },
      })
    );

    const result = await createRoleRequest("organizer", "", "tok");

    expect(result).toMatchObject({ id: "3", role: "organizer", status: "pending", reason: "" });
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("http://api.test/role-requests");
    expect(JSON.parse(options.body)).toEqual({ role: "organizer" });
    expect(options.headers.Authorization).toBe("Bearer tok");
  });

  it("reads the role-request switch from VITE_ROLE_REQUESTS_ENABLED", () => {
    vi.stubEnv("VITE_ROLE_REQUESTS_ENABLED", "true");
    expect(roleRequestsEnabled()).toBe(true);
    vi.stubEnv("VITE_ROLE_REQUESTS_ENABLED", "false");
    expect(roleRequestsEnabled()).toBe(false);
    vi.stubEnv("VITE_ROLE_REQUESTS_ENABLED", "");
    expect(roleRequestsEnabled()).toBe(false);
  });

  it("lists the signed-in user's role requests", async () => {
    const fetchMock = stubFetch(
      jsonResponse(200, {
        data: [
          {
            type: "role-requests",
            id: "2",
            attributes: {
              user_id: "7",
              role: "moderator",
              status: "rejected",
              created_at: "2026-10-07T15:09:59.602414",
              reviewed_at: "2026-10-07T16:00:00",
            },
          },
        ],
      })
    );

    const list = await listMyRoleRequests("tok");

    expect(fetchMock.mock.calls[0][0]).toBe("http://api.test/role-requests/me");
    expect(list).toEqual([
      {
        id: "2",
        userId: "7",
        role: "moderator",
        reason: "",
        status: "rejected",
        createdAt: "2026-10-07T15:09:59.602414",
        reviewedAt: "2026-10-07T16:00:00",
      },
    ]);
  });

  it("lists role requests by status for admins", async () => {
    const fetchMock = stubFetch(jsonResponse(200, { data: [] }));

    expect(await listRoleRequests("approved", "tok")).toEqual([]);

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("http://api.test/role-requests?status=approved");
    expect(options.method).toBe("GET");
    expect(options.headers.Authorization).toBe("Bearer tok");
  });

  it("approves and rejects with POST and no body", async () => {
    const reviewed = {
      data: {
        type: "role-requests",
        id: "5",
        attributes: { user_id: "9", role: "organizer", status: "approved" },
      },
    };
    const fetchMock = stubFetch(jsonResponse(200, reviewed), jsonResponse(200, reviewed));

    await reviewRoleRequest("5", "approve", "tok");
    await reviewRoleRequest("5", "reject", "tok");

    expect(fetchMock.mock.calls[0][0]).toBe("http://api.test/role-requests/5/approve");
    expect(fetchMock.mock.calls[1][0]).toBe("http://api.test/role-requests/5/reject");
    expect(fetchMock.mock.calls[0][1].method).toBe("POST");
    expect(fetchMock.mock.calls[0][1].body).toBeUndefined();
    await expect(reviewRoleRequest("5", "grant", "tok")).rejects.toThrow("Unknown decision");
  });

  it("keeps the backend error code", async () => {
    stubFetch(
      jsonResponse(403, {
        errors: [{ code: "self_review_forbidden", detail: "Another admin must review." }],
      })
    );

    const error = await reviewRoleRequest("5", "approve", "tok").catch((e) => e);

    expect(error.status).toBe(403);
    expect(error.code).toBe("self_review_forbidden");
  });

  it("reads roles from the user resource", async () => {
    stubFetch(
      jsonResponse(200, {
        data: {
          type: "users",
          id: "7",
          attributes: { name: "Ada", email: "ada@aup.edu", roles: ["student", "admin"] },
        },
      })
    );

    expect((await getCurrentUser("tok")).roles).toEqual(["student", "admin"]);
  });

  it("keeps errors for unknown fields in the form-level message", () => {
    const shown = formErrorsFrom(new ApiError("Email: Taken", 409, { email: "Taken" }), [
      "email",
    ]);
    expect(shown).toEqual({
      fieldErrors: { email: "Taken" },
      formError: "Please fix the highlighted fields.",
    });

    const extra = formErrorsFrom(new ApiError("Roles: Extra inputs", 422, { roles: "Extra" }), [
      "email",
    ]);
    expect(extra).toEqual({ fieldErrors: {}, formError: "Roles: Extra inputs" });
  });

  it("creates an event with POST /events and reads the item", async () => {
    const fetchMock = stubFetch(
      jsonResponse(201, {
        data: {
          type: "catalogue-items",
          id: "12",
          attributes: {
            kind: "event",
            owner_id: "7",
            title: "Board games night",
            description: "Bring a game.",
            location: "Student lounge",
            starts_at: "2026-11-01T17:30:00Z",
            ends_at: "2026-11-01T20:00:00Z",
            time_zone: "Europe/Paris",
            category: "Games",
            status: "draft",
            created_at: "2026-10-21T10:00:00Z",
            updated_at: "2026-10-21T10:00:00Z",
          },
        },
      })
    );
    const event = {
      title: "Board games night",
      description: "Bring a game.",
      location: "Student lounge",
      starts_at: "2026-11-01T17:30:00.000Z",
      ends_at: "2026-11-01T20:00:00.000Z",
      time_zone: "Europe/Paris",
      category: "Games",
    };

    const item = await createEvent(event, "org-tok");

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("http://api.test/events");
    expect(options.method).toBe("POST");
    expect(options.headers.Authorization).toBe("Bearer org-tok");
    expect(JSON.parse(options.body)).toEqual(event);
    expect(item).toMatchObject({
      id: "12",
      kind: "event",
      title: "Board games night",
      startsAt: "2026-11-01T17:30:00Z",
      timeZone: "Europe/Paris",
      status: "draft",
      proofInstructions: "",
      pointValue: null,
    });
  });

  it("rejects an item without its times", async () => {
    stubFetch(
      jsonResponse(201, {
        data: { type: "catalogue-items", id: "12", attributes: { kind: "event", title: "x" } },
      })
    );
    await expect(createEvent({}, "tok")).rejects.toThrow("incomplete item");
  });

  it("reads the catalogue switch from VITE_CATALOGUE_ENABLED", () => {
    vi.stubEnv("VITE_CATALOGUE_ENABLED", "true");
    expect(catalogueEnabled()).toBe(true);
    vi.stubEnv("VITE_CATALOGUE_ENABLED", "");
    expect(catalogueEnabled()).toBe(false);
  });

  it("lists the organizer's items from GET /items/me", async () => {
    const fetchMock = stubFetch(
      jsonResponse(200, {
        data: [
          {
            type: "catalogue-items",
            id: "13",
            attributes: {
              kind: "quest",
              title: "Campus photo hunt",
              starts_at: "2026-11-05T09:00:00Z",
              ends_at: "2026-11-05T17:00:00Z",
              time_zone: "Europe/Paris",
              proof_instructions: "Upload five photos.",
              point_value: 50,
              status: "published",
            },
          },
        ],
      })
    );

    const items = await listMyItems("org-tok");

    expect(fetchMock.mock.calls[0][0]).toBe("http://api.test/items/me");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: "13",
      kind: "quest",
      proofInstructions: "Upload five photos.",
      pointValue: 50,
    });
  });

  it("sends only the given changes in PATCH /items/{id}", async () => {
    const fetchMock = stubFetch(
      jsonResponse(200, {
        data: {
          type: "catalogue-items",
          id: "12",
          attributes: {
            kind: "event",
            title: "Chess night",
            starts_at: "2026-11-01T17:30:00Z",
            ends_at: "2026-11-01T20:00:00Z",
            time_zone: "Europe/Paris",
            status: "draft",
          },
        },
      })
    );

    const updated = await updateItem("12", { title: "Chess night" }, "org-tok");

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("http://api.test/items/12");
    expect(options.method).toBe("PATCH");
    expect(JSON.parse(options.body)).toEqual({ title: "Chess night" });
    expect(updated.title).toBe("Chess night");
  });

  it("lists an item's participants from GET /items/{id}/participants", async () => {
    const fetchMock = stubFetch(
      jsonResponse(200, {
        data: [
          {
            type: "participants",
            id: "1",
            attributes: {
              user_id: "20",
              name: "Grace",
              status: "joined",
              joined_at: "2026-10-20T08:15:00Z",
            },
          },
        ],
        meta: { count: 1 },
      })
    );

    const participants = await listParticipants("12", "org-tok");

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("http://api.test/items/12/participants");
    expect(options.headers.Authorization).toBe("Bearer org-tok");
    expect(participants).toEqual([
      {
        id: "1",
        userId: "20",
        name: "Grace",
        status: "joined",
        joinedAt: "2026-10-20T08:15:00Z",
      },
    ]);
  });
});

describe("quest and participation client (QB-58/60/90)", () => {
  const questAttributes = {
    kind: "quest",
    owner_id: "4",
    title: "Campus cleanup",
    description: "Pick up litter.",
    location: "Quai d'Orsay",
    starts_at: "2026-10-20T12:00:00Z",
    ends_at: "2026-10-20T14:00:00Z",
    time_zone: "Europe/Paris",
    category: "Volunteering",
    proof_instructions: "Photo of your bag.",
    point_value: 50,
    status: "draft",
  };
  const questResource = { type: "catalogue-items", id: "11", attributes: questAttributes };
  const page = (overrides) => ({
    page: { number: 1, size: 12, total_items: 1, total_pages: 1, ...overrides },
  });

  it("is on when either VITE_CATALOGUE_ENABLED or VITE_QUESTS_ENABLED is true", () => {
    vi.stubEnv("VITE_CATALOGUE_ENABLED", "");
    vi.stubEnv("VITE_QUESTS_ENABLED", "");
    expect(questsEnabled()).toBe(false);
    vi.stubEnv("VITE_QUESTS_ENABLED", "true");
    expect(questsEnabled()).toBe(true);
    vi.stubEnv("VITE_QUESTS_ENABLED", "false");
    vi.stubEnv("VITE_CATALOGUE_ENABLED", "true");
    expect(questsEnabled()).toBe(true);
  });

  it("keeps demo mode off unless DEV and VITE_QUESTS_DEMO are both on", () => {
    vi.stubEnv("VITE_QUESTS_DEMO", "true");
    // Vitest runs with DEV=true; assert the flag is still required.
    expect(questsDemoEnabled()).toBe(true);
    vi.stubEnv("VITE_QUESTS_DEMO", "false");
    expect(questsDemoEnabled()).toBe(false);
  });

  it("tells a missing route apart from a missing item", () => {
    const missingItem = new ApiError("Item not found", 404, {}, "item_not_found");
    const missingRoute = new ApiError("Not Found", 404, {}, "request_rejected");
    expect(isItemNotFound(missingItem)).toBe(true);
    expect(isMissingRoute(missingItem)).toBe(false);
    expect(isMissingRoute(missingRoute)).toBe(true);
    expect(isMissingRoute(new ApiError("Method Not Allowed", 405))).toBe(true);
    expect(questApiUnavailableMessage(missingRoute, "load quests")).toMatch(
      /doesn't have the API needed to load quests/
    );
    expect(questApiUnavailableMessage(missingItem, "join")).toBe("Item not found");
    expect(questApiUnavailableMessage(new ApiError("down", 0), "load quests")).toBe("down");
  });

  it("creates a quest with POST /quests and the QB-50 field names", async () => {
    const fetchMock = stubFetch(jsonResponse(201, { data: questResource }));
    const { status, owner_id, kind, ...fields } = questAttributes;

    const quest = await createQuest(fields, "tok");

    expect(quest).toMatchObject({
      id: "11",
      kind: "quest",
      ownerId: "4",
      pointValue: 50,
      timeZone: "Europe/Paris",
      status: "draft",
    });
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("http://api.test/quests");
    expect(options.method).toBe("POST");
    expect(options.headers.Authorization).toBe("Bearer tok");
    expect(JSON.parse(options.body)).toEqual(fields);
  });

  it("lists published items from GET /items with only the filters that are set", async () => {
    const fetchMock = stubFetch(
      jsonResponse(200, {
        data: [{ ...questResource, attributes: { ...questAttributes, status: "published" } }],
        meta: page({ number: 2, total_items: 25, total_pages: 3 }),
      })
    );

    const result = await listPublishedItems(
      {
        page: 2,
        pageSize: 12,
        q: "clean up",
        category: "Volunteering",
        windowStart: "2026-11-03T23:00:00.000Z",
        windowEnd: "2026-11-04T22:59:59.999Z",
      },
      "tok"
    );

    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.pathname).toBe("/items");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      page: "2",
      page_size: "12",
      q: "clean up",
      category: "Volunteering",
      window_start: "2026-11-03T23:00:00.000Z",
      window_end: "2026-11-04T22:59:59.999Z",
    });
    expect(result.page).toEqual({ number: 2, size: 12, totalItems: 25, totalPages: 3 });
    expect(result.items[0]).toMatchObject({ id: "11", status: "published" });

    stubFetch(jsonResponse(200, { data: [], meta: page() }));
    await listPublishedItems({ page: 1 }, "tok");
    expect(fetch.mock.calls[0][0]).toBe("http://api.test/items?page=1");
  });

  it("rejects an item list without page totals", async () => {
    stubFetch(jsonResponse(200, { data: [questResource] }));
    await expect(listPublishedItems({ page: 1 }, "tok")).rejects.toThrow("unexpected item list");
  });

  it("reads one item from GET /items/{id}", async () => {
    const fetchMock = stubFetch(jsonResponse(200, { data: questResource }));
    expect((await getItem("11", "tok")).title).toBe("Campus cleanup");
    expect(fetchMock.mock.calls[0][0]).toBe("http://api.test/items/11");
  });

  it("publishes with POST /items/{id}/publish and keeps the conflict code", async () => {
    const published = { ...questResource, attributes: { ...questAttributes, status: "published" } };
    const fetchMock = stubFetch(
      jsonResponse(200, { data: published }),
      jsonResponse(409, {
        errors: [{ status: "409", code: "item_archived", detail: "Archived items cannot be changed." }],
      })
    );

    expect((await publishItem("11", "tok")).status).toBe("published");
    expect(fetchMock.mock.calls[0][0]).toBe("http://api.test/items/11/publish");
    expect(fetchMock.mock.calls[0][1].method).toBe("POST");
    expect(fetchMock.mock.calls[0][1].body).toBeUndefined();
    await expect(publishItem("11", "tok")).rejects.toMatchObject({
      status: 409,
      code: "item_archived",
    });
  });

  it("joins with POST /items/{id}/join and reads the participation", async () => {
    const fetchMock = stubFetch(
      jsonResponse(201, {
        data: {
          type: "participations",
          id: "3",
          attributes: {
            item_id: 11,
            user_id: 7,
            status: "joined",
            joined_at: "2026-10-14T10:00:00Z",
          },
        },
      })
    );

    expect(await joinItem("11", "tok")).toEqual({
      id: "3",
      itemId: "11",
      userId: 7,
      status: "joined",
      joinedAt: "2026-10-14T10:00:00Z",
    });
    expect(fetchMock.mock.calls[0][0]).toBe("http://api.test/items/11/join");
    expect(fetchMock.mock.calls[0][1].method).toBe("POST");
  });

  it("reads the nested participation from GET /me/participations", async () => {
    const fetchMock = stubFetch(
      jsonResponse(200, {
        data: [
          {
            type: "my-items",
            id: "11",
            attributes: {
              ...questAttributes,
              status: "published",
              participation: {
                participation_id: 3,
                status: "joined",
                twist: null,
                joined_at: "2026-10-14T10:00:00Z",
              },
              saved: false,
            },
          },
          {
            type: "my-items",
            id: "12",
            attributes: { ...questAttributes, kind: "event", status: "published", saved: true },
          },
        ],
        meta: { count: 2, joined_count: 1, saved_count: 1 },
      })
    );

    const [joined, saved] = await listMyParticipations("tok");

    expect(fetchMock.mock.calls[0][0]).toBe("http://api.test/me/participations");
    expect(joined.item.id).toBe("11");
    expect(joined.participation).toEqual({
      id: "3",
      itemId: "11",
      status: "joined",
      joinedAt: "2026-10-14T10:00:00Z",
    });
    expect(joined.saved).toBe(false);
    expect(saved.participation).toBeNull();
    expect(saved.saved).toBe(true);
  });
});
