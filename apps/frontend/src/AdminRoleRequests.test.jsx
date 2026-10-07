import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, listRoleRequests, reviewRoleRequest } from "./api.js";
import AdminRoleRequests from "./AdminRoleRequests.jsx";

vi.mock("./api.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, listRoleRequests: vi.fn(), reviewRoleRequest: vi.fn() };
});

const SESSION = { token: "admin-tok", userId: "1", expiresAt: "2099-01-01T00:00:00Z" };

function roleRequest(overrides) {
  return {
    id: "5",
    userId: "9",
    role: "organizer",
    reason: "I run the chess club",
    status: "pending",
    createdAt: "2026-10-07T15:09:59",
    reviewedAt: "",
    ...overrides,
  };
}

function renderAdmin() {
  const onSessionExpired = vi.fn();
  render(<AdminRoleRequests session={SESSION} onSessionExpired={onSessionExpired} />);
  return { onSessionExpired };
}

const itemFor = (text) => screen.getByText(text).closest("li");

beforeEach(() => {
  vi.resetAllMocks();
  listRoleRequests.mockResolvedValue([
    roleRequest(),
    roleRequest({ id: "6", userId: "10", role: "moderator", reason: "" }),
  ]);
});

describe("Admin role requests (no Jira key yet)", () => {
  it("lists pending requests with requester, role, reason and status", async () => {
    renderAdmin();

    expect(screen.getByText("Loading role requests…")).toBeInTheDocument();
    const first = await screen.findByText("Organizer for user #9");
    expect(listRoleRequests).toHaveBeenCalledWith("pending", "admin-tok");
    expect(first.closest("li")).toHaveTextContent("I run the chess club");
    expect(first.closest("li")).toHaveTextContent("Pending approval");
    expect(first.closest("li")).toHaveTextContent("Request #5 · Requested 2026-10-07");
    expect(itemFor("Moderator for user #10")).toHaveTextContent("No reason given.");
  });

  it("filters by status using the backend's status filter", async () => {
    const user = userEvent.setup();
    renderAdmin();
    await screen.findByText("Organizer for user #9");

    listRoleRequests.mockResolvedValue([
      roleRequest({ id: "3", status: "approved", reviewedAt: "2026-10-08T10:00:00" }),
    ]);
    await user.selectOptions(screen.getByLabelText("Show"), "approved");

    expect(listRoleRequests).toHaveBeenLastCalledWith("approved", "admin-tok");
    const item = (await screen.findByText("Organizer for user #9")).closest("li");
    expect(item).toHaveTextContent("Approved");
    expect(item).toHaveTextContent("Reviewed 2026-10-08");
    expect(within(item).queryByRole("button")).not.toBeInTheDocument();
  });

  it("does not show the previous filter's requests while the new filter loads", async () => {
    const user = userEvent.setup();
    renderAdmin();
    await screen.findByText("Organizer for user #9");

    listRoleRequests.mockReturnValue(new Promise(() => {}));
    await user.selectOptions(screen.getByLabelText("Show"), "rejected");

    expect(screen.getByText("Loading role requests…")).toBeInTheDocument();
    expect(screen.queryByText("Organizer for user #9")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
  });

  it("approves a request, removes it from the pending list and confirms", async () => {
    const user = userEvent.setup();
    reviewRoleRequest.mockResolvedValue(roleRequest({ status: "approved" }));
    renderAdmin();

    const item = (await screen.findByText("Organizer for user #9")).closest("li");
    await user.click(within(item).getByRole("button", { name: "Approve" }));

    expect(reviewRoleRequest).toHaveBeenCalledWith("5", "approve", "admin-tok");
    expect(
      await screen.findByText(
        "Approved request #5 (Organizer for user #9). The user now has this role."
      )
    ).toBeInTheDocument();
    expect(screen.queryByText("Organizer for user #9")).not.toBeInTheDocument();
    expect(screen.getByText("Moderator for user #10")).toBeInTheDocument();
  });

  it("rejects a request without sending a reason", async () => {
    const user = userEvent.setup();
    reviewRoleRequest.mockResolvedValue(roleRequest({ id: "6", status: "rejected" }));
    renderAdmin();

    const item = (await screen.findByText("Moderator for user #10")).closest("li");
    await user.click(within(item).getByRole("button", { name: "Reject" }));

    expect(reviewRoleRequest).toHaveBeenCalledWith("6", "reject", "admin-tok");
    expect(
      await screen.findByText("Rejected request #6 (Moderator for user #10).")
    ).toBeInTheDocument();
    expect(screen.queryByText("Moderator for user #10")).not.toBeInTheDocument();
  });

  it("prevents duplicate actions while a review is in flight", async () => {
    const user = userEvent.setup();
    let finish;
    reviewRoleRequest.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    renderAdmin();

    const item = (await screen.findByText("Organizer for user #9")).closest("li");
    await user.click(within(item).getByRole("button", { name: "Approve" }));

    expect(within(item).getByRole("button", { name: "Approving…" })).toBeDisabled();
    expect(within(item).getByRole("button", { name: "Reject" })).toBeDisabled();
    const other = itemFor("Moderator for user #10");
    expect(within(other).getByRole("button", { name: "Approve" })).toBeDisabled();
    await user.click(within(item).getByRole("button", { name: "Reject" }));
    expect(reviewRoleRequest).toHaveBeenCalledTimes(1);

    finish(roleRequest({ status: "approved" }));
    expect(await screen.findByText(/^Approved request #5/)).toBeInTheDocument();
  });

  it("does not offer review buttons for the admin's own request", async () => {
    listRoleRequests.mockResolvedValue([roleRequest({ id: "8", userId: "1" })]);
    renderAdmin();

    const item = (await screen.findByText(/Organizer for user #1/)).closest("li");
    expect(item).toHaveTextContent("(you)");
    expect(item).toHaveTextContent("Another admin must review your own request.");
    expect(within(item).queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows a conflict when someone else already reviewed it and refreshes the list", async () => {
    const user = userEvent.setup();
    reviewRoleRequest.mockRejectedValue(
      new ApiError(
        "This request has already been approved or rejected.",
        409,
        {},
        "role_request_already_reviewed"
      )
    );
    renderAdmin();

    const item = (await screen.findByText("Organizer for user #9")).closest("li");
    listRoleRequests.mockResolvedValue([roleRequest({ id: "6", userId: "10", role: "moderator" })]);
    await user.click(within(item).getByRole("button", { name: "Approve" }));

    expect(
      await screen.findByText(
        "This request has already been approved or rejected. The list has been refreshed."
      )
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByText("Organizer for user #9")).not.toBeInTheDocument()
    );
    expect(listRoleRequests).toHaveBeenCalledTimes(2);
  });

  it("shows the backend's self-review refusal without hiding the page", async () => {
    const user = userEvent.setup();
    reviewRoleRequest.mockRejectedValue(
      new ApiError("Another admin must review your role request.", 403, {}, "self_review_forbidden")
    );
    renderAdmin();

    const item = (await screen.findByText("Organizer for user #9")).closest("li");
    await user.click(within(item).getByRole("button", { name: "Approve" }));

    expect(
      await screen.findByText("Another admin must review your role request.")
    ).toBeInTheDocument();
    expect(screen.getByText("Organizer for user #9")).toBeInTheDocument();
  });

  it("shows a forbidden message when the backend refuses the list", async () => {
    listRoleRequests.mockRejectedValue(new ApiError("Insufficient role", 403, {}, "request_rejected"));
    renderAdmin();

    expect(await screen.findByText(/doesn't have admin access/)).toBeInTheDocument();
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
  });

  it("shows a forbidden message when the backend refuses a review", async () => {
    const user = userEvent.setup();
    reviewRoleRequest.mockRejectedValue(new ApiError("Insufficient role", 403, {}, "request_rejected"));
    renderAdmin();

    const item = (await screen.findByText("Organizer for user #9")).closest("li");
    await user.click(within(item).getByRole("button", { name: "Approve" }));

    expect(await screen.findByText(/doesn't have admin access/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
  });

  it("ends the session on 401", async () => {
    listRoleRequests.mockRejectedValue(new ApiError("Not authenticated", 401));
    const { onSessionExpired } = renderAdmin();

    await waitFor(() => expect(onSessionExpired).toHaveBeenCalledTimes(1));
  });

  it("ends the session when a review gets 401", async () => {
    const user = userEvent.setup();
    reviewRoleRequest.mockRejectedValue(new ApiError("Not authenticated", 401));
    const { onSessionExpired } = renderAdmin();

    const item = (await screen.findByText("Organizer for user #9")).closest("li");
    await user.click(within(item).getByRole("button", { name: "Reject" }));

    await waitFor(() => expect(onSessionExpired).toHaveBeenCalledTimes(1));
  });

  it("doesn't claim nothing changed when the connection fails, and reloads the list", async () => {
    const user = userEvent.setup();
    reviewRoleRequest.mockRejectedValue(new ApiError("Couldn't get a response.", 0));
    renderAdmin();

    const item = (await screen.findByText("Organizer for user #9")).closest("li");
    // The approval did go through: the reloaded list no longer has the request.
    listRoleRequests.mockResolvedValue([
      roleRequest({ id: "6", userId: "10", role: "moderator", reason: "" }),
    ]);
    await user.click(within(item).getByRole("button", { name: "Approve" }));

    expect(
      await screen.findByText(
        "We couldn't confirm whether request #5 (Organizer for user #9) was approved. " +
          "Couldn't get a response. The list has been reloaded; check it before trying again."
      )
    ).toBeInTheDocument();
    expect(screen.queryByText(/Nothing was changed/)).not.toBeInTheDocument();
    expect(await screen.findByText("Moderator for user #10")).toBeInTheDocument();
    expect(screen.queryByText("Organizer for user #9")).not.toBeInTheDocument();
    expect(listRoleRequests).toHaveBeenCalledTimes(2);
  });

  it("says a rejection couldn't be confirmed after a gateway timeout", async () => {
    const user = userEvent.setup();
    reviewRoleRequest.mockRejectedValue(new ApiError("Gateway timeout.", 504));
    renderAdmin();

    const item = (await screen.findByText("Organizer for user #9")).closest("li");
    await user.click(within(item).getByRole("button", { name: "Reject" }));

    expect(
      await screen.findByText(/^We couldn't confirm whether request #5 .* was rejected\./)
    ).toBeInTheDocument();
    expect(listRoleRequests).toHaveBeenCalledTimes(2);
  });

  it("can retry after the list fails to load", async () => {
    const user = userEvent.setup();
    listRoleRequests
      .mockRejectedValueOnce(new ApiError("Could not reach the server.", 0))
      .mockResolvedValueOnce([]);
    renderAdmin();

    expect(await screen.findByText(/Role requests couldn't be loaded/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("No pending requests.")).toBeInTheDocument();
  });
});
