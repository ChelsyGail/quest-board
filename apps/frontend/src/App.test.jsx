import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  catalogueEnabled,
  getCurrentUser,
  listMyParticipations,
  listMyItems,
  listMyRoleRequests,
  listPublishedItems,
  listRoleRequests,
  login,
  questsEnabled,
  roleRequestsEnabled,
} from "./api.js";
import App from "./App.jsx";

vi.mock("./api.js", async (importOriginal) => {
  const actual = await importOriginal();
  const listMyParticipations = vi.fn();
  const listPublishedItems = vi.fn();
  return {
    ...actual,
    catalogueEnabled: vi.fn(),
    getCurrentUser: vi.fn(),
    listMyParticipations,
    listMyItems: vi.fn(),
    listMyRoleRequests: vi.fn(),
    listPublishedItems,
    listRoleRequests: vi.fn(),
    login: vi.fn(),
    questsEnabled: vi.fn(),
    questsDemoEnabled: vi.fn(() => false),
    registerUser: vi.fn(),
    roleRequestsEnabled: vi.fn(),
    updateUser: vi.fn(),
    resetDemoQuests: vi.fn(),
    getQuestClient: () => ({
      isDemo: false,
      listMyParticipations: () => listMyParticipations("tok"),
      listPublishedItems: (query) => listPublishedItems(query, "tok"),
      getItem: vi.fn(),
      createQuest: vi.fn(),
      joinItem: vi.fn(),
    }),
  };
});

const SESSION_KEY = "questboard.session";
const USER = { id: "7", name: "Ada", email: "ada@aup.edu", roles: ["student"] };
const ADMIN = { id: "1", name: "Root", email: "root@aup.edu", roles: ["student", "admin"] };
const ORGANIZER = {
  id: "4",
  name: "Omar",
  email: "omar@aup.edu",
  roles: ["student", "organizer"],
};

function storeSession(overrides = {}) {
  const session = {
    token: "tok",
    userId: "7",
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    ...overrides,
  };
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return session;
}

async function openAccountMenu(user, label = /Account$/) {
  await user.click(screen.getByRole("button", { name: label }));
}

async function chooseAccountMenuItem(user, name) {
  await openAccountMenu(user);
  await user.click(screen.getByRole("menuitem", { name }));
}

beforeEach(() => {
  vi.resetAllMocks();
  sessionStorage.clear();
  getCurrentUser.mockResolvedValue(USER);
  // In api.js the two names are one flag.
  questsEnabled.mockImplementation(() => catalogueEnabled());
  roleRequestsEnabled.mockReturnValue(false);
  listMyItems.mockResolvedValue([]);
  listMyParticipations.mockResolvedValue([]);
  catalogueEnabled.mockReturnValue(false);
  listMyRoleRequests.mockResolvedValue([]);
  listPublishedItems.mockResolvedValue({
    items: [],
    page: { number: 1, size: 12, totalItems: 0, totalPages: 0 },
  });
  listRoleRequests.mockResolvedValue([]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Loading the profile (QB-47)", () => {
  it("shows a loading state, then the profile from GET /users/me", async () => {
    let finish;
    getCurrentUser.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    storeSession();
    render(<App />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading your profile…");
    expect(getCurrentUser).toHaveBeenCalledWith("tok");

    finish(USER);
    expect(await screen.findByLabelText("Name")).toHaveValue("Ada");
  });

  it("treats a network failure as retryable, not as a logout", async () => {
    const user = userEvent.setup();
    getCurrentUser
      .mockRejectedValueOnce(new ApiError("Could not reach the server at http://api.test.", 0))
      .mockResolvedValueOnce(USER);
    storeSession();
    render(<App />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Your profile couldn't be loaded. Could not reach the server"
    );
    expect(screen.queryByRole("button", { name: "Log in" })).not.toBeInTheDocument();
    expect(sessionStorage.getItem(SESSION_KEY)).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByLabelText("Name")).toHaveValue("Ada");
    expect(getCurrentUser).toHaveBeenCalledTimes(2);
  });

  it("falls back to entered-fields editing when the backend has no /users/me", async () => {
    storeSession({ user: { name: "Stale", email: "stale@aup.edu" } });
    getCurrentUser.mockRejectedValue(new ApiError("Method Not Allowed", 405));
    render(<App />);

    expect(await screen.findByText(/the server doesn't support it yet/)).toBeInTheDocument();
    expect(screen.queryByText(/Stale/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("New email")).toHaveValue("");
  });
});

describe("Session handling (QB-45, interim sessionStorage)", () => {
  it("logs out when the backend rejects the restored token", async () => {
    storeSession();
    getCurrentUser.mockRejectedValue(new ApiError("Not authenticated", 401));
    render(<App />);

    expect(
      await screen.findByText("Your session has expired or is no longer valid. Please log in again.")
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Log in" })).toBeInTheDocument();
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull();
  });

  it("does not restore a session whose token has already expired", async () => {
    storeSession({ expiresAt: new Date(Date.now() - 1000).toISOString() });
    render(<App />);

    expect(
      await screen.findByText("Your session has expired. Please log in again.")
    ).toBeInTheDocument();
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull();
  });

  it("logs out automatically when the token expires", async () => {
    vi.useFakeTimers();
    storeSession({ expiresAt: new Date(Date.now() + 10000).toISOString() });
    render(<App />);
    await act(async () => {});
    expect(screen.getByLabelText("Name")).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(16000);
    });

    expect(screen.getByText("Your session has expired. Please log in again.")).toBeInTheDocument();
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull();
  });

  it("logs out on the client and clears the stored session", async () => {
    const user = userEvent.setup();
    storeSession();
    render(<App />);

    await screen.findByLabelText("Name");
    await chooseAccountMenuItem(user, "Log out");

    expect(screen.getByText("You have been logged out.")).toBeInTheDocument();
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull();
  });

  it("stores only the token, user ID and expiry after login, never the password", async () => {
    const user = userEvent.setup();
    const expiresAt = new Date(Date.now() + 3600000).toISOString();
    login.mockResolvedValue({ token: "tok", userId: "7", expiresAt });
    render(<App />);

    await user.type(screen.getByLabelText("Email"), "ada@aup.edu");
    await user.type(screen.getByLabelText("Password"), "correct horse battery");
    await user.click(screen.getByRole("button", { name: "Log in" }));

    expect(await screen.findByLabelText("Name")).toHaveValue("Ada");
    expect(JSON.parse(sessionStorage.getItem(SESSION_KEY))).toEqual({
      token: "tok",
      userId: "7",
      expiresAt,
    });
  });

  it("loads the new user's profile after logging out and in as someone else", async () => {
    const user = userEvent.setup();
    storeSession();
    render(<App />);
    await screen.findByLabelText("Name");
    await chooseAccountMenuItem(user, "Log out");

    login.mockResolvedValue({
      token: "tok-2",
      userId: "8",
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
    });
    getCurrentUser.mockResolvedValue({ ...USER, id: "8", name: "Grace" });
    await user.type(screen.getByLabelText("Email"), "grace@aup.edu");
    await user.type(screen.getByLabelText("Password"), "another long password");
    await user.click(screen.getByRole("button", { name: "Log in" }));

    expect(await screen.findByLabelText("Name")).toHaveValue("Grace");
    expect(getCurrentUser).toHaveBeenLastCalledWith("tok-2");
  });
});

describe("Refreshing the account page", () => {
  it("updates roles and request options without logging out", async () => {
    const user = userEvent.setup();
    roleRequestsEnabled.mockReturnValue(true);
    listMyRoleRequests.mockResolvedValue([
      { id: "3", userId: "7", role: "organizer", reason: "", status: "pending", createdAt: "", reviewedAt: "" },
    ]);
    storeSession();
    render(<App />);

    expect(await screen.findByText("Roles: Student")).toBeInTheDocument();
    expect(await screen.findByText("Pending approval")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Email"), ".unsaved");

    // An admin approved the request in the meantime.
    getCurrentUser.mockResolvedValue({ ...USER, roles: ["student", "organizer"] });
    listMyRoleRequests.mockResolvedValue([
      { id: "3", userId: "7", role: "organizer", reason: "", status: "approved", createdAt: "", reviewedAt: "" },
    ]);
    await user.click(screen.getByRole("button", { name: "Refresh" }));

    expect(await screen.findByText("Roles: Student, Organizer")).toBeInTheDocument();
    expect(await screen.findByText("Approved")).toBeInTheDocument();
    expect(screen.getByLabelText("Role")).toHaveDisplayValue("Moderator");
    expect(screen.getByLabelText("Email")).toHaveValue("ada@aup.edu.unsaved");
    expect(sessionStorage.getItem(SESSION_KEY)).not.toBeNull();
    expect(getCurrentUser).toHaveBeenCalledTimes(2);
  });

  it("shows the admin entry after a refresh reveals the admin role", async () => {
    const user = userEvent.setup();
    roleRequestsEnabled.mockReturnValue(true);
    storeSession();
    render(<App />);
    await screen.findByText("Roles: Student");
    await openAccountMenu(user);
    expect(screen.queryByRole("menuitem", { name: "Role requests" })).not.toBeInTheDocument();
    await user.keyboard("{Escape}");

    getCurrentUser.mockResolvedValue({ ...USER, roles: ["student", "admin"] });
    await user.click(screen.getByRole("button", { name: "Refresh" }));
    await screen.findByText(/Roles:\s*Student,\s*Admin/i);

    await openAccountMenu(user);
    expect(await screen.findByRole("menuitem", { name: "Role requests" })).toBeInTheDocument();
  });
});

describe("Admin navigation (no Jira key yet)", () => {
  it("shows the admin entry only to admins when role requests are enabled", async () => {
    const user = userEvent.setup();
    roleRequestsEnabled.mockReturnValue(true);
    getCurrentUser.mockResolvedValue(ADMIN);
    storeSession({ userId: "1" });
    render(<App />);

    await screen.findByLabelText("Name");
    await chooseAccountMenuItem(user, "Role requests");

    expect(screen.getByRole("heading", { name: "Role requests" })).toBeInTheDocument();
    expect(listRoleRequests).toHaveBeenCalledWith("pending", "tok");
    expect(await screen.findByText("No pending requests.")).toBeInTheDocument();

    await chooseAccountMenuItem(user, "Account settings");
    expect(screen.getByLabelText("Name")).toHaveValue("Root");
  });

  it("does not show the admin entry to non-admins", async () => {
    const user = userEvent.setup();
    roleRequestsEnabled.mockReturnValue(true);
    storeSession();
    render(<App />);

    await screen.findByLabelText("Name");
    await openAccountMenu(user);
    expect(screen.queryByRole("menuitem", { name: "Role requests" })).not.toBeInTheDocument();
    expect(listRoleRequests).not.toHaveBeenCalled();
  });

  it("does not show the admin entry when role requests are disabled", async () => {
    const user = userEvent.setup();
    getCurrentUser.mockResolvedValue(ADMIN);
    storeSession({ userId: "1" });
    render(<App />);

    await screen.findByLabelText("Name");
    await openAccountMenu(user);
    expect(screen.queryByRole("menuitem", { name: "Role requests" })).not.toBeInTheDocument();
  });

  it("does not show the admin entry before the profile has loaded", async () => {
    const user = userEvent.setup();
    roleRequestsEnabled.mockReturnValue(true);
    getCurrentUser.mockReturnValue(new Promise(() => {}));
    storeSession({ userId: "1" });
    render(<App />);

    await openAccountMenu(user);
    expect(screen.getByRole("menuitem", { name: "Account settings" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Role requests" })).not.toBeInTheDocument();
  });
});

describe("Quest navigation (QB-58, QB-60, QB-90)", () => {
  it("hides quest pages when the feature is off", async () => {
    storeSession();
    render(<App />);

    await screen.findByLabelText("Name");
    expect(screen.queryByRole("button", { name: "Quests" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "My quests" })).not.toBeInTheDocument();
    expect(listPublishedItems).not.toHaveBeenCalled();
    expect(listMyItems).not.toHaveBeenCalled();
  });

  it("lands students on Quests after login when the feature is on", async () => {
    questsEnabled.mockReturnValue(true);
    listPublishedItems.mockResolvedValue({
      items: [
        {
          id: "11",
          kind: "quest",
          ownerId: "4",
          title: "Campus cleanup",
          description: "",
          location: "Quai d'Orsay",
          startsAt: "2026-10-20T12:00:00Z",
          endsAt: "2026-10-20T14:00:00Z",
          timeZone: "Europe/Paris",
          category: "Volunteering",
          proofInstructions: "",
          pointValue: 50,
          status: "published",
        },
      ],
      page: { number: 1, size: 12, totalItems: 1, totalPages: 1 },
    });
    storeSession();
    render(<App />);

    expect(await screen.findByRole("button", { name: "Quests" })).toHaveAttribute(
      "aria-current",
      "page"
    );
    expect(screen.queryByRole("button", { name: "My items" })).not.toBeInTheDocument();
    // The first item on an unfiltered first page is also featured.
    expect(
      await screen.findAllByRole("button", { name: "View quest: Campus cleanup" })
    ).not.toHaveLength(0);
    expect(listPublishedItems).toHaveBeenCalledWith({ page: 1, pageSize: 12 }, "tok");
    expect(listMyParticipations).toHaveBeenCalledWith("tok");
    expect(listMyItems).not.toHaveBeenCalled();
  });

  it("keeps account settings available from the account menu", async () => {
    const user = userEvent.setup();
    questsEnabled.mockReturnValue(true);
    storeSession();
    render(<App />);

    await screen.findByRole("heading", { name: "What's your next campus adventure?" });
    await chooseAccountMenuItem(user, "Account settings");
    expect(screen.getByLabelText("Name")).toHaveValue("Ada");
  });

  it("lets an organizer open My items and Create quest", async () => {
    const user = userEvent.setup();
    questsEnabled.mockReturnValue(true);
    getCurrentUser.mockResolvedValue(ORGANIZER);
    storeSession({ userId: "4" });
    render(<App />);

    expect(await screen.findByRole("button", { name: "Create quest" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "My items" }));

    expect(await screen.findByRole("heading", { name: "Create a quest" })).toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toBeInTheDocument();
    await waitFor(() => expect(listMyItems).toHaveBeenCalledWith("tok"));
  });
});

describe("Role-aware navigation (FE-10)", () => {
  it.each([
    ["a student", ["student"]],
    ["an organizer", ["student", "organizer"]],
    ["a moderator", ["student", "moderator"]],
  ])("shows %s only their account, with no admin controls", async (_, roles) => {
    roleRequestsEnabled.mockReturnValue(true);
    getCurrentUser.mockResolvedValue({ ...USER, roles });
    storeSession();
    render(<App />);

    await screen.findByLabelText("Name");
    expect(screen.queryByRole("navigation", { name: "Pages" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Role requests" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /approve/i })).not.toBeInTheDocument();
    expect(listRoleRequests).not.toHaveBeenCalled();
  });

  it("returns an admin to their account when a refresh removes the admin role", async () => {
    const user = userEvent.setup();
    roleRequestsEnabled.mockReturnValue(true);
    getCurrentUser.mockResolvedValue(ADMIN);
    storeSession({ userId: "1" });
    render(<App />);

    await screen.findByLabelText("Name");
    await chooseAccountMenuItem(user, "Role requests");
    expect(screen.getByRole("heading", { name: "Role requests" })).toBeInTheDocument();

    // Leave the admin page to refresh, then come back after the role is gone.
    await chooseAccountMenuItem(user, "Account settings");
    getCurrentUser.mockResolvedValue({ ...ADMIN, roles: ["student"] });
    await user.click(screen.getByRole("button", { name: "Refresh" }));

    expect(await screen.findByText("Roles: Student")).toBeInTheDocument();
    await openAccountMenu(user);
    expect(screen.queryByRole("menuitem", { name: "Role requests" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveValue("Root");
  });

  it("shows the admin page in the same wide shell as every other page", async () => {
    const user = userEvent.setup();
    roleRequestsEnabled.mockReturnValue(true);
    getCurrentUser.mockResolvedValue(ADMIN);
    storeSession({ userId: "1" });
    const { container } = render(<App />);

    await screen.findByLabelText("Name");
    await chooseAccountMenuItem(user, "Role requests");
    expect(container.querySelector(".app-main")).toContainElement(
      screen.getByRole("heading", { name: "Role requests" })
    );
  });
});

describe("Organizer pages (FE-12, FE-14)", () => {
  const ORGANIZER = { ...USER, roles: ["student", "organizer"] };

  it("gives organizers a Create event tab with the event form", async () => {
    const user = userEvent.setup();
    catalogueEnabled.mockReturnValue(true);
    getCurrentUser.mockResolvedValue(ORGANIZER);
    storeSession();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Create event" }));

    expect(screen.getByRole("heading", { name: "Create an event" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save event" })).toBeInTheDocument();
  });

  it("gives organizers a My items tab", async () => {
    const user = userEvent.setup();
    catalogueEnabled.mockReturnValue(true);
    listMyItems.mockResolvedValue([]);
    getCurrentUser.mockResolvedValue(ORGANIZER);
    storeSession();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "My items" }));

    expect(await screen.findByRole("heading", { name: "My items" })).toBeInTheDocument();
    expect(listMyItems).toHaveBeenCalledWith("tok");
  });

  it.each([
    ["a student", USER, true],
    ["an organizer on a backend without the catalogue", ORGANIZER, false],
  ])("doesn't offer event creation to %s", async (_, profile, enabled) => {
    catalogueEnabled.mockReturnValue(enabled);
    getCurrentUser.mockResolvedValue(profile);
    storeSession();
    render(<App />);

    // With the catalogue on, everyone lands on the board; otherwise on their account.
    await screen.findByRole("heading", {
      name: enabled ? "What's your next campus adventure?" : "Your account",
    });
    expect(screen.queryByRole("button", { name: "Create event" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "My items" })).not.toBeInTheDocument();
  });
});
