import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  getCurrentUser,
  listMyRoleRequests,
  listRoleRequests,
  login,
  roleRequestsEnabled,
} from "./api.js";
import App from "./App.jsx";

vi.mock("./api.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getCurrentUser: vi.fn(),
    listMyRoleRequests: vi.fn(),
    listRoleRequests: vi.fn(),
    login: vi.fn(),
    registerUser: vi.fn(),
    roleRequestsEnabled: vi.fn(),
    updateUser: vi.fn(),
  };
});

const SESSION_KEY = "questboard.session";
const USER = { id: "7", name: "Ada", email: "ada@aup.edu", roles: ["student"] };
const ADMIN = { id: "1", name: "Root", email: "root@aup.edu", roles: ["student", "admin"] };

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

beforeEach(() => {
  vi.resetAllMocks();
  sessionStorage.clear();
  getCurrentUser.mockResolvedValue(USER);
  roleRequestsEnabled.mockReturnValue(false);
  listMyRoleRequests.mockResolvedValue([]);
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
    expect(screen.getByLabelText("New name")).toHaveValue("");
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
    await user.click(screen.getByRole("button", { name: "Log out" }));

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
    await user.click(screen.getByRole("button", { name: "Log out" }));

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
    await user.type(screen.getByLabelText("Name"), " (unsaved)");

    // An admin approved the request in the meantime.
    getCurrentUser.mockResolvedValue({ ...USER, roles: ["student", "organizer"] });
    listMyRoleRequests.mockResolvedValue([
      { id: "3", userId: "7", role: "organizer", reason: "", status: "approved", createdAt: "", reviewedAt: "" },
    ]);
    await user.click(screen.getByRole("button", { name: "Refresh" }));

    expect(await screen.findByText("Roles: Student, Organizer")).toBeInTheDocument();
    expect(await screen.findByText("Approved")).toBeInTheDocument();
    expect(screen.getByLabelText("Role")).toHaveDisplayValue("Moderator");
    expect(screen.getByLabelText("Name")).toHaveValue("Ada (unsaved)");
    expect(sessionStorage.getItem(SESSION_KEY)).not.toBeNull();
    expect(getCurrentUser).toHaveBeenCalledTimes(2);
  });

  it("shows the admin entry after a refresh reveals the admin role", async () => {
    const user = userEvent.setup();
    roleRequestsEnabled.mockReturnValue(true);
    storeSession();
    render(<App />);
    await screen.findByText("Roles: Student");
    expect(screen.queryByRole("navigation", { name: "Pages" })).not.toBeInTheDocument();

    getCurrentUser.mockResolvedValue({ ...USER, roles: ["student", "admin"] });
    await user.click(screen.getByRole("button", { name: "Refresh" }));

    expect(await screen.findByRole("button", { name: "Role requests" })).toBeInTheDocument();
  });
});

describe("Admin navigation (no Jira key yet)", () => {
  it("shows the admin entry only to admins when role requests are enabled", async () => {
    const user = userEvent.setup();
    roleRequestsEnabled.mockReturnValue(true);
    getCurrentUser.mockResolvedValue(ADMIN);
    storeSession({ userId: "1" });
    render(<App />);

    const adminTab = await screen.findByRole("button", { name: "Role requests" });
    expect(screen.getByRole("button", { name: "Your account" })).toHaveAttribute(
      "aria-current",
      "page"
    );

    await user.click(adminTab);

    expect(screen.getByRole("heading", { name: "Role requests" })).toBeInTheDocument();
    expect(listRoleRequests).toHaveBeenCalledWith("pending", "tok");
    expect(adminTab).toHaveAttribute("aria-current", "page");
    expect(await screen.findByText("No pending requests.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Your account" }));
    expect(screen.getByLabelText("Name")).toHaveValue("Root");
  });

  it("does not show the admin entry to non-admins", async () => {
    roleRequestsEnabled.mockReturnValue(true);
    storeSession();
    render(<App />);

    await screen.findByLabelText("Name");
    expect(screen.queryByRole("button", { name: "Role requests" })).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    expect(listRoleRequests).not.toHaveBeenCalled();
  });

  it("does not show the admin entry when role requests are disabled", async () => {
    getCurrentUser.mockResolvedValue(ADMIN);
    storeSession({ userId: "1" });
    render(<App />);

    await screen.findByLabelText("Name");
    expect(screen.queryByRole("button", { name: "Role requests" })).not.toBeInTheDocument();
  });

  it("does not show the admin entry before the profile has loaded", () => {
    roleRequestsEnabled.mockReturnValue(true);
    getCurrentUser.mockReturnValue(new Promise(() => {}));
    storeSession({ userId: "1" });
    render(<App />);

    expect(screen.queryByRole("button", { name: "Role requests" })).not.toBeInTheDocument();
  });
});
