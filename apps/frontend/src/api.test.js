import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  createRoleRequest,
  formErrorsFrom,
  getCurrentUser,
  listMyRoleRequests,
  listRoleRequests,
  registerUser,
  reviewRoleRequest,
  roleRequestsEnabled,
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
});
