import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, listMyItems, updateItem } from "./api.js";
import MyItems from "./MyItems.jsx";

vi.mock("./api.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, listMyItems: vi.fn(), updateItem: vi.fn() };
});

const SESSION = { token: "org-tok", userId: "7", expiresAt: "2099-01-01T00:00:00Z" };

function item(overrides) {
  return {
    id: "12",
    kind: "event",
    ownerId: "7",
    title: "Board games night",
    description: "Bring a game.",
    location: "Student lounge",
    startsAt: "2026-11-01T17:30:00Z",
    endsAt: "2026-11-01T20:00:00Z",
    timeZone: "Europe/Paris",
    category: "Games",
    proofInstructions: "",
    pointValue: null,
    status: "draft",
    ...overrides,
  };
}

const QUEST = item({
  id: "13",
  kind: "quest",
  title: "Campus photo hunt",
  startsAt: "2026-11-05T09:00:00Z",
  endsAt: "2026-11-05T17:00:00Z",
  proofInstructions: "Upload five photos.",
  pointValue: 50,
  status: "published",
});

function renderPage() {
  const onSessionExpired = vi.fn();
  render(<MyItems session={SESSION} onSessionExpired={onSessionExpired} />);
  return { onSessionExpired };
}

async function openEditor(user, title) {
  await user.click(await screen.findByRole("button", { name: `Edit "${title}"` }));
}

const save = (user) => user.click(screen.getByRole("button", { name: "Save changes" }));

beforeEach(() => {
  vi.resetAllMocks();
  listMyItems.mockResolvedValue([item(), QUEST]);
});

describe("My items (FE-14)", () => {
  it("lists the organizer's items with kind, status and local start time", async () => {
    renderPage();

    expect(screen.getByText("Loading your items…")).toBeInTheDocument();
    const event = (await screen.findByText("Board games night")).closest("li");
    expect(listMyItems).toHaveBeenCalledWith("org-tok");
    expect(event).toHaveTextContent("Draft");
    expect(event).toHaveTextContent(
      "Event · 1 Nov 2026, 18:30 (Europe/Paris) · Student lounge"
    );
    const quest = screen.getByText("Campus photo hunt").closest("li");
    expect(quest).toHaveTextContent("Published");
    expect(quest).toHaveTextContent("Quest · 5 Nov 2026, 10:00");
  });

  it("says when there are no items yet", async () => {
    listMyItems.mockResolvedValue([]);
    renderPage();
    expect(
      await screen.findByText("You haven't created any events or quests yet.")
    ).toBeInTheDocument();
  });

  it("offers a retry when the list can't be loaded", async () => {
    const user = userEvent.setup();
    listMyItems.mockRejectedValueOnce(new ApiError("Server error", 500));
    renderPage();

    expect(
      await screen.findByText("Your items couldn't be loaded. Server error")
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Board games night")).toBeInTheDocument();
  });

  it("says when the account has no organizer access", async () => {
    listMyItems.mockRejectedValue(new ApiError("Insufficient role", 403));
    renderPage();
    expect(await screen.findByText(/doesn't have organizer access/)).toBeInTheDocument();
  });

  it("ends the session when the backend rejects the token", async () => {
    listMyItems.mockRejectedValue(new ApiError("Not authenticated", 401));
    const { onSessionExpired } = renderPage();
    await vi.waitFor(() => expect(onSessionExpired).toHaveBeenCalled());
  });
});

describe("Edit item screen (FE-14)", () => {
  it("fills the form with the item, times in its own zone", async () => {
    const user = userEvent.setup();
    renderPage();
    await openEditor(user, "Board games night");

    expect(
      screen.getByRole("heading", { name: 'Edit event "Board games night"' })
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toHaveValue("Board games night");
    expect(screen.getByLabelText("Starts")).toHaveValue("2026-11-01T18:30");
    expect(screen.getByLabelText("Ends")).toHaveValue("2026-11-01T21:00");
    expect(screen.getByLabelText("Time zone")).toHaveValue("Europe/Paris");
    expect(screen.queryByLabelText("Points")).not.toBeInTheDocument();
  });

  it("sends only the changed fields and shows the saved item in the list", async () => {
    const user = userEvent.setup();
    updateItem.mockResolvedValue(item({ title: "Chess night", location: "Library" }));
    renderPage();
    await openEditor(user, "Board games night");

    await user.clear(screen.getByLabelText("Title"));
    await user.type(screen.getByLabelText("Title"), " Chess night ");
    await user.clear(screen.getByLabelText("Location"));
    await user.type(screen.getByLabelText("Location"), "Library");
    await save(user);

    expect(updateItem).toHaveBeenCalledWith(
      "12",
      { title: "Chess night", location: "Library" },
      "org-tok"
    );
    expect(
      await screen.findByText('Your changes to "Chess night" were saved.')
    ).toBeInTheDocument();
    expect(screen.getByText("Chess night").closest("li")).toHaveTextContent("Library");
  });

  it("sends the times again when the time zone changes", async () => {
    const user = userEvent.setup();
    updateItem.mockResolvedValue(item({ timeZone: "UTC" }));
    renderPage();
    await openEditor(user, "Board games night");

    await user.selectOptions(screen.getByLabelText("Time zone"), "UTC");
    await save(user);

    expect(updateItem.mock.calls[0][1]).toEqual({
      starts_at: "2026-11-01T18:30:00.000Z",
      ends_at: "2026-11-01T21:00:00.000Z",
      time_zone: "UTC",
    });
  });

  it("edits a quest's proof instructions and points", async () => {
    const user = userEvent.setup();
    updateItem.mockResolvedValue({ ...QUEST, pointValue: 75 });
    renderPage();
    await openEditor(user, "Campus photo hunt");

    expect(screen.getByText(/students see your changes as soon as you save/)).toBeVisible();
    expect(screen.getByLabelText("Proof instructions")).toHaveValue("Upload five photos.");
    await user.clear(screen.getByLabelText("Points"));
    await user.type(screen.getByLabelText("Points"), "0");
    await save(user);
    expect(screen.getByText("Points must be a whole number from 1 to 10000.")).toBeInTheDocument();
    expect(updateItem).not.toHaveBeenCalled();

    await user.clear(screen.getByLabelText("Points"));
    await user.type(screen.getByLabelText("Points"), "75");
    await save(user);
    expect(updateItem).toHaveBeenCalledWith("13", { point_value: 75 }, "org-tok");
  });

  it("doesn't send a request when nothing changed", async () => {
    const user = userEvent.setup();
    renderPage();
    await openEditor(user, "Board games night");

    await save(user);

    expect(screen.getByRole("alert")).toHaveTextContent("You haven't changed anything yet.");
    expect(updateItem).not.toHaveBeenCalled();
  });

  it("shows the backend's field errors on the form", async () => {
    const user = userEvent.setup();
    updateItem.mockRejectedValue(
      new ApiError(
        "Ends at: ends_at must be after starts_at.",
        422,
        { ends_at: "ends_at must be after starts_at." },
        "invalid_time_window"
      )
    );
    renderPage();
    await openEditor(user, "Board games night");

    await user.type(screen.getByLabelText("Description"), " Snacks provided.");
    await save(user);

    expect(await screen.findByText("ends_at must be after starts_at.")).toBeInTheDocument();
    expect(screen.getByLabelText("Ends")).toHaveAttribute("aria-invalid", "true");
  });

  it.each([
    ["archived", 409, "item_archived", "can no longer be edited"],
    ["deleted", 404, "item_not_found", "can no longer be edited"],
    ["not owned", 403, "item_not_owned", "You can't edit"],
  ])("returns to a reloaded list when the item is %s", async (_, status, code, message) => {
    const user = userEvent.setup();
    updateItem.mockRejectedValue(new ApiError("Rejected.", status, {}, code));
    renderPage();
    await openEditor(user, "Board games night");

    await user.type(screen.getByLabelText("Description"), " Snacks.");
    await save(user);

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(await screen.findByText("Board games night")).toBeInTheDocument();
    expect(listMyItems).toHaveBeenCalledTimes(2);
  });

  it("doesn't report a lost answer as a failure", async () => {
    const user = userEvent.setup();
    updateItem.mockRejectedValue(new ApiError("Couldn't get a response.", 0));
    renderPage();
    await openEditor(user, "Board games night");

    await user.type(screen.getByLabelText("Description"), " Snacks.");
    await save(user);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn't confirm whether your changes"
    );
    expect(listMyItems).toHaveBeenCalledTimes(2);
  });

  it("goes back to the list without saving on Cancel", async () => {
    const user = userEvent.setup();
    renderPage();
    await openEditor(user, "Board games night");

    await user.type(screen.getByLabelText("Title"), " (changed)");
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    const list = screen.getByRole("list");
    expect(within(list).getByText("Board games night")).toBeInTheDocument();
    expect(updateItem).not.toHaveBeenCalled();
    expect(listMyItems).toHaveBeenCalledTimes(1);
  });
});
