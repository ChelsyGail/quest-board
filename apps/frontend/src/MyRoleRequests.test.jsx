import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, createRoleRequest, listMyRoleRequests } from "./api.js";
import MyRoleRequests from "./MyRoleRequests.jsx";

vi.mock("./api.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, createRoleRequest: vi.fn(), listMyRoleRequests: vi.fn() };
});

const SESSION = { token: "tok", userId: "7", expiresAt: "2099-01-01T00:00:00Z" };

function roleRequest(overrides) {
  return {
    id: "1",
    userId: "7",
    role: "organizer",
    reason: "",
    status: "pending",
    createdAt: "2026-10-07T15:09:59.602414",
    reviewedAt: "",
    ...overrides,
  };
}

function renderRequests(currentRoles = ["student"]) {
  const onSessionExpired = vi.fn();
  render(
    <MyRoleRequests
      session={SESSION}
      currentRoles={currentRoles}
      onSessionExpired={onSessionExpired}
    />
  );
  return { onSessionExpired };
}

const roleSelect = () => screen.getByLabelText("Role");
const roleOptions = () =>
  within(roleSelect())
    .getAllByRole("option")
    .map((option) => option.value);

beforeEach(() => {
  // Reset, not just clear, so queued one-time responses can't leak into the next test.
  vi.resetAllMocks();
  listMyRoleRequests.mockResolvedValue([]);
});

describe("Role requests from the profile (no Jira key yet)", () => {
  it("lists the user's requests with their status, dates and reason", async () => {
    listMyRoleRequests.mockResolvedValue([
      roleRequest({
        id: "1",
        role: "moderator",
        status: "rejected",
        reviewedAt: "2026-10-08T09:00:00",
      }),
      roleRequest({ id: "2", role: "organizer", status: "pending", reason: "Chess club" }),
    ]);
    renderRequests();

    const items = await screen.findAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("Moderator");
    expect(items[0]).toHaveTextContent("Rejected");
    expect(items[0]).toHaveTextContent("Requested 2026-10-07 · Reviewed 2026-10-08");
    expect(items[1]).toHaveTextContent("Pending approval");
    expect(items[1]).toHaveTextContent("Chess club");
    expect(listMyRoleRequests).toHaveBeenCalledWith("tok");
  });

  it("offers only roles that are not held or already pending", async () => {
    listMyRoleRequests.mockResolvedValue([roleRequest({ role: "moderator", status: "pending" })]);
    renderRequests(["student"]);

    await screen.findByLabelText("Role");
    expect(roleOptions()).toEqual(["organizer"]);
  });

  it("lets a user request a role again after it was rejected", async () => {
    listMyRoleRequests.mockResolvedValue([roleRequest({ role: "organizer", status: "rejected" })]);
    renderRequests(["student"]);

    await screen.findByLabelText("Role");
    expect(roleOptions()).toEqual(["organizer", "moderator"]);
  });

  it("explains when there is nothing left to request", async () => {
    listMyRoleRequests.mockResolvedValue([roleRequest({ role: "moderator", status: "pending" })]);
    renderRequests(["student", "organizer"]);

    expect(
      await screen.findByText("You already have, or are waiting on, every role you can request.")
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Request access" })).not.toBeInTheDocument();
  });

  it("sends a request with a trimmed reason and adds it to the list", async () => {
    const user = userEvent.setup();
    createRoleRequest.mockResolvedValue(
      roleRequest({ id: "9", role: "moderator", reason: "I moderate the forum" })
    );
    renderRequests(["student", "organizer"]);

    await screen.findByLabelText("Role");
    await user.type(screen.getByLabelText(/Why do you need this access/), "  I moderate the forum ");
    await user.click(screen.getByRole("button", { name: "Request access" }));

    expect(createRoleRequest).toHaveBeenCalledWith("moderator", "I moderate the forum", "tok");
    expect(
      await screen.findByText(
        "Your Moderator access request was sent and is waiting for approval."
      )
    ).toBeInTheDocument();
    expect(screen.getByRole("listitem")).toHaveTextContent("Pending approval");
    expect(
      screen.getByText("You already have, or are waiting on, every role you can request.")
    ).toBeInTheDocument();
  });

  it("prevents duplicate submissions while a request is in flight", async () => {
    const user = userEvent.setup();
    let finish;
    createRoleRequest.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    renderRequests();

    await screen.findByLabelText("Role");
    await user.click(screen.getByRole("button", { name: "Request access" }));
    const button = screen.getByRole("button", { name: "Sending request…" });
    expect(button).toBeDisabled();
    await user.click(button);

    expect(createRoleRequest).toHaveBeenCalledTimes(1);
    finish(roleRequest({ id: "9" }));
    expect(await screen.findByText(/was sent and is waiting/)).toBeInTheDocument();
  });

  it("shows a backend conflict and reloads the list", async () => {
    const user = userEvent.setup();
    listMyRoleRequests
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([roleRequest({ role: "organizer", status: "pending" })]);
    createRoleRequest.mockRejectedValue(
      new ApiError(
        "Role: You already have a pending request for this role.",
        409,
        { role: "You already have a pending request for this role." },
        "role_request_pending"
      )
    );
    renderRequests();

    await screen.findByLabelText("Role");
    await user.click(screen.getByRole("button", { name: "Request access" }));

    await waitFor(() => expect(listMyRoleRequests).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Pending approval")).toBeInTheDocument();
    expect(roleOptions()).toEqual(["moderator"]);
  });

  describe("when the connection fails while sending", () => {
    const lost = () => new ApiError("Couldn't get a response.", 0);

    it("reloads the list and reports the request as sent if it arrived", async () => {
      const user = userEvent.setup();
      listMyRoleRequests
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([roleRequest({ id: "9", role: "organizer" })]);
      createRoleRequest.mockRejectedValue(lost());
      renderRequests();

      await screen.findByLabelText("Role");
      await user.click(screen.getByRole("button", { name: "Request access" }));

      expect(
        await screen.findByText(
          "Your Organizer access request was sent and is waiting for approval."
        )
      ).toBeInTheDocument();
      expect(screen.getByRole("listitem")).toHaveTextContent("Pending approval");
      expect(roleOptions()).toEqual(["moderator"]);
    });

    it("says it didn't reach the server if the reloaded list doesn't have it", async () => {
      const user = userEvent.setup();
      createRoleRequest.mockRejectedValue(lost());
      renderRequests();

      await screen.findByLabelText("Role");
      await user.type(screen.getByLabelText(/Why do you need this access/), "Chess club");
      await user.click(screen.getByRole("button", { name: "Request access" }));

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Your Organizer access request didn't reach the server. Couldn't get a response. " +
          "You can send it again."
      );
      expect(listMyRoleRequests).toHaveBeenCalledTimes(2);
      expect(screen.getByLabelText(/Why do you need this access/)).toHaveValue("Chess club");
    });

    it("says the result is unconfirmed if the list can't be reloaded either", async () => {
      const user = userEvent.setup();
      listMyRoleRequests.mockResolvedValueOnce([]).mockRejectedValueOnce(lost());
      createRoleRequest.mockRejectedValue(lost());
      renderRequests();

      await screen.findByLabelText("Role");
      await user.click(screen.getByRole("button", { name: "Request access" }));

      const alert = await screen.findByRole("alert");
      await waitFor(() =>
        expect(alert).toHaveTextContent(
          "We couldn't confirm whether your Organizer access request was sent."
        )
      );
      expect(alert).not.toHaveTextContent(/not sent|didn't reach/);
    });
  });

  describe("refreshing (refreshKey)", () => {
    function renderWithKey(refreshKey, currentRoles = ["student"]) {
      return (
        <MyRoleRequests
          session={SESSION}
          currentRoles={currentRoles}
          refreshKey={refreshKey}
          onSessionExpired={vi.fn()}
        />
      );
    }

    it("reloads in place, keeping the typed reason and updating the options", async () => {
      const user = userEvent.setup();
      const { rerender } = render(renderWithKey(0));
      await screen.findByLabelText("Role");
      await user.type(screen.getByLabelText(/Why do you need this access/), "Unsaved reason");

      listMyRoleRequests.mockResolvedValue([
        roleRequest({ role: "organizer", status: "approved", reviewedAt: "2026-10-08T09:00:00" }),
      ]);
      rerender(renderWithKey(1, ["student", "organizer"]));

      expect(await screen.findByText("Approved")).toBeInTheDocument();
      expect(roleOptions()).toEqual(["moderator"]);
      expect(screen.getByLabelText(/Why do you need this access/)).toHaveValue("Unsaved reason");
      expect(screen.queryByText("Loading your access requests…")).not.toBeInTheDocument();
    });

    it("keeps the current list when a refresh fails", async () => {
      listMyRoleRequests.mockResolvedValueOnce([roleRequest({ role: "moderator" })]);
      const { rerender } = render(renderWithKey(0));
      await screen.findByText("Pending approval");

      listMyRoleRequests.mockRejectedValueOnce(new ApiError("Couldn't get a response.", 0));
      rerender(renderWithKey(1));

      expect(
        await screen.findByText(
          "Your access requests couldn't be refreshed. Couldn't get a response."
        )
      ).toBeInTheDocument();
      expect(screen.getByText("Pending approval")).toBeInTheDocument();
    });
  });

  it("limits the reason to 500 characters without a request", async () => {
    const user = userEvent.setup();
    renderRequests();

    await screen.findByLabelText("Role");
    await user.click(screen.getByLabelText(/Why do you need this access/));
    await user.paste("x".repeat(501));
    await user.click(screen.getByRole("button", { name: "Request access" }));

    expect(screen.getByText("Reason must be at most 500 characters.")).toBeInTheDocument();
    expect(createRoleRequest).not.toHaveBeenCalled();
  });

  it("ends the session when the backend rejects the token", async () => {
    listMyRoleRequests.mockRejectedValue(new ApiError("Not authenticated", 401));
    const { onSessionExpired } = renderRequests();

    await waitFor(() => expect(onSessionExpired).toHaveBeenCalledTimes(1));
  });

  it("can retry after the list fails to load", async () => {
    const user = userEvent.setup();
    listMyRoleRequests
      .mockRejectedValueOnce(new ApiError("Could not reach the server.", 0))
      .mockResolvedValueOnce([]);
    renderRequests();

    expect(await screen.findByText(/couldn't be loaded/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("You haven't requested extra access yet.")).toBeInTheDocument();
  });
});
