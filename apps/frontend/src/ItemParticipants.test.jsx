import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, listParticipants } from "./api.js";
import ItemParticipants from "./ItemParticipants.jsx";

vi.mock("./api.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, listParticipants: vi.fn() };
});

const SESSION = { token: "org-tok", userId: "7", expiresAt: "2099-01-01T00:00:00Z" };

const ITEM = {
  id: "12",
  kind: "event",
  title: "Board games night",
  startsAt: "2026-11-01T17:30:00Z",
  endsAt: "2026-11-01T20:00:00Z",
  timeZone: "Europe/Paris",
  status: "published",
};

function participant(overrides) {
  return {
    id: "1",
    userId: "20",
    name: "Grace",
    status: "joined",
    joinedAt: "2026-10-20T08:15:00Z",
    ...overrides,
  };
}

function renderList() {
  const onBack = vi.fn();
  const onSessionExpired = vi.fn();
  render(
    <ItemParticipants
      session={SESSION}
      item={ITEM}
      onBack={onBack}
      onSessionExpired={onSessionExpired}
    />
  );
  return { onBack, onSessionExpired };
}

beforeEach(() => {
  vi.resetAllMocks();
  listParticipants.mockResolvedValue([
    participant(),
    participant({ id: "2", userId: "21", name: "Linus", status: "pending", joinedAt: "" }),
  ]);
});

describe("Participant list for my item (FE-17)", () => {
  it("lists who joined, with status and join time in the item's zone", async () => {
    renderList();

    expect(screen.getByText("Loading participants…")).toBeInTheDocument();
    expect(screen.getByText(/Event "Board games night" · 1 Nov 2026, 18:30/)).toBeInTheDocument();
    const grace = (await screen.findByText("Grace")).closest("li");
    expect(listParticipants).toHaveBeenCalledWith("12", "org-tok");
    expect(grace).toHaveTextContent("Joined");
    expect(grace).toHaveTextContent("Joined 20 Oct 2026, 10:15");
    expect(screen.getByText("Linus").closest("li")).toHaveTextContent("Pending approval");
    expect(screen.getByText("2 people have joined.")).toBeInTheDocument();
  });

  it.each([
    [[], "Nobody has joined yet."],
    [[participant()], "1 person has joined."],
  ])("counts %j participants", async (list, text) => {
    listParticipants.mockResolvedValue(list);
    renderList();
    expect(await screen.findByText(text)).toBeInTheDocument();
  });

  it("refreshes the list in place", async () => {
    const user = userEvent.setup();
    renderList();
    await screen.findByText("Grace");

    let finish;
    listParticipants.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    await user.click(screen.getByRole("button", { name: "Refresh" }));

    expect(screen.getByRole("button", { name: "Refreshing…" })).toBeDisabled();
    expect(screen.getByText("Grace")).toBeInTheDocument();
    finish([participant({ id: "3", name: "Ada" })]);
    expect(await screen.findByText("Ada")).toBeInTheDocument();
    expect(screen.queryByText("Grace")).not.toBeInTheDocument();
  });

  it("keeps the list when a refresh fails", async () => {
    const user = userEvent.setup();
    renderList();
    await screen.findByText("Grace");

    listParticipants.mockRejectedValue(new ApiError("Server error", 500));
    await user.click(screen.getByRole("button", { name: "Refresh" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The list couldn't be refreshed. Server error"
    );
    expect(screen.getByText("Grace")).toBeInTheDocument();
  });

  it.each([
    [403, "Only the organizer who created this item can see who joined it."],
    [404, "This item no longer exists"],
  ])("explains a %i answer", async (status, text) => {
    listParticipants.mockRejectedValue(new ApiError("Rejected", status));
    renderList();
    expect(await screen.findByRole("alert")).toHaveTextContent(text);
  });

  it("offers a retry when the list can't be loaded", async () => {
    const user = userEvent.setup();
    listParticipants.mockRejectedValueOnce(new ApiError("Server error", 500));
    renderList();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Participants couldn't be loaded. Server error"
    );
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Grace")).toBeInTheDocument();
  });

  it("ends the session when the backend rejects the token", async () => {
    listParticipants.mockRejectedValue(new ApiError("Not authenticated", 401));
    const { onSessionExpired } = renderList();
    await vi.waitFor(() => expect(onSessionExpired).toHaveBeenCalled());
  });

  it("goes back to the item list", async () => {
    const user = userEvent.setup();
    const { onBack } = renderList();
    await user.click(screen.getByRole("button", { name: "Back to my items" }));
    expect(onBack).toHaveBeenCalled();
  });
});
