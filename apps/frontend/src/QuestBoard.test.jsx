import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, getItem, joinItem, listMyParticipations, listPublishedItems } from "./api.js";
import QuestBoard from "./QuestBoard.jsx";

vi.mock("./api.js", async (importOriginal) => {
  const actual = await importOriginal();
  const getItem = vi.fn();
  const joinItem = vi.fn();
  const listMyParticipations = vi.fn();
  const listPublishedItems = vi.fn();
  return {
    ...actual,
    getItem,
    joinItem,
    listMyParticipations,
    listPublishedItems,
    questsDemoEnabled: vi.fn(() => false),
    getQuestClient: () => ({
      isDemo: false,
      getItem: (id) => getItem(id, "tok"),
      joinItem: (id) => joinItem(id, "tok"),
      listMyParticipations: () => listMyParticipations("tok"),
      listPublishedItems: (query) => listPublishedItems(query, "tok"),
    }),
  };
});

const SESSION = { token: "tok", userId: "7", expiresAt: "2099-01-01T00:00:00Z" };

function quest(overrides) {
  return {
    id: "11",
    kind: "quest",
    ownerId: "4",
    title: "Campus cleanup",
    description: "Pick up litter around the library.",
    location: "Quai d'Orsay",
    startsAt: "2026-11-20T12:00:00Z",
    endsAt: "2026-11-20T14:00:00Z",
    timeZone: "Europe/Paris",
    category: "Volunteering",
    proofInstructions: "A photo of your full bag.",
    pointValue: 50,
    status: "published",
    ...overrides,
  };
}

const EVENT = quest({
  id: "21",
  kind: "event",
  title: "Open mic",
  description: "Music and poetry.",
  category: "Social",
  proofInstructions: "",
  pointValue: null,
});

function pageOf(items, { number = 1, totalItems = items.length, totalPages } = {}) {
  return {
    items,
    page: { number, size: 12, totalItems, totalPages: totalPages ?? Math.ceil(totalItems / 12) },
  };
}

const joined = (item) => ({
  item,
  participation: { id: `p${item.id}`, itemId: item.id, status: "joined", joinedAt: "" },
  saved: false,
});

function renderBoard({ canJoin = true, session = SESSION } = {}) {
  const onSessionExpired = vi.fn();
  render(<QuestBoard session={session} canJoin={canJoin} onSessionExpired={onSessionExpired} />);
  return { onSessionExpired };
}

const joinButton = () => screen.getByRole("button", { name: "Join quest" });
const open = async (user, title = "Campus cleanup", kind = "quest") =>
  user.click(await screen.findByRole("button", { name: `View ${kind}: ${title}` }));
const lastQuery = () => listPublishedItems.mock.calls.at(-1)[0];

beforeEach(() => {
  vi.resetAllMocks();
  listPublishedItems.mockResolvedValue(pageOf([quest()]));
  listMyParticipations.mockResolvedValue([]);
  getItem.mockImplementation(async (id) => (id === EVENT.id ? EVENT : quest({ id })));
});

describe("Discovering quests and events", () => {
  it("lists the first page of published items and marks joined ones from /me/participations", async () => {
    const chess = quest({ id: "12", title: "Chess night" });
    listPublishedItems.mockResolvedValue(pageOf([quest(), chess]));
    listMyParticipations.mockResolvedValue([joined(chess), { item: quest(), participation: null, saved: true }]);
    renderBoard();

    expect(screen.getByRole("status")).toHaveTextContent("Loading quests…");
    const list = await screen.findByRole("list", { name: "Published quests and events" });
    const items = within(list).getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Campus cleanup");
    expect(items[0]).not.toHaveTextContent("Joined");
    expect(items[1]).toHaveTextContent("Joined");
    expect(listPublishedItems).toHaveBeenCalledWith({ page: 1, pageSize: 12 }, "tok");
    expect(screen.getByText("2 quests and events on the board")).toBeInTheDocument();
  });

  it("shows events without quest-only fields", async () => {
    listPublishedItems.mockResolvedValue(pageOf([EVENT]));
    renderBoard();

    const card = (await screen.findByRole("button", { name: "View event: Open mic" })).closest("li");
    expect(card).toHaveTextContent("Event");
    expect(card).not.toHaveTextContent("pts");
  });

  it("shows an empty state", async () => {
    listPublishedItems.mockResolvedValue(pageOf([]));
    renderBoard();
    expect(
      await screen.findByText("There are no published quests or events yet.")
    ).toBeInTheDocument();
  });

  it("shows a retryable load error", async () => {
    const user = userEvent.setup();
    listPublishedItems
      .mockRejectedValueOnce(new ApiError("Couldn't get a response.", 0))
      .mockResolvedValueOnce(pageOf([quest()]));
    renderBoard();

    expect(await screen.findByText(/Couldn't get a response/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(
      await screen.findByRole("button", { name: "View quest: Campus cleanup" })
    ).toBeInTheDocument();
  });

  it("keeps the catalogue when participations can't be loaded", async () => {
    const user = userEvent.setup();
    listMyParticipations
      .mockRejectedValueOnce(new ApiError("Not Found", 404))
      .mockResolvedValueOnce([joined(quest())]);
    renderBoard();

    expect(
      await screen.findByRole("button", { name: "View quest: Campus cleanup" })
    ).toBeInTheDocument();
    expect(await screen.findByText(/couldn't load which quests and events you've joined/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Retry" }));
    const list = screen.getByRole("list", { name: "Published quests and events" });
    expect(await within(list).findByText("Joined")).toBeInTheDocument();
    expect(screen.queryByText(/couldn't load which/)).not.toBeInTheDocument();
  });

  it("explains a backend without the catalogue route, and never switches to demo data", async () => {
    listPublishedItems.mockRejectedValue(new ApiError("Not Found", 404, {}, "request_rejected"));
    renderBoard();

    expect(await screen.findByText(/doesn't have the API needed to load the quest board/)).toBeInTheDocument();
    expect(screen.queryByText(/demo/i)).not.toBeInTheDocument();
  });

  it("ends the session when loading is rejected with 401", async () => {
    listPublishedItems.mockRejectedValue(new ApiError("Not authenticated", 401));
    const { onSessionExpired } = renderBoard();
    await waitFor(() => expect(onSessionExpired).toHaveBeenCalledTimes(1));
  });
});

describe("Server-side filters and paging", () => {
  it("sends the search after a pause and starts again from page 1", async () => {
    const user = userEvent.setup();
    listPublishedItems.mockResolvedValue(pageOf([quest()], { totalItems: 30 }));
    renderBoard();

    await user.click(await screen.findByRole("button", { name: "Next" }));
    await waitFor(() => expect(lastQuery()).toEqual({ page: 2, pageSize: 12 }));
    await screen.findByText("Page 2 of 3 · 30 quests and events");

    listPublishedItems.mockResolvedValue(pageOf([quest()]));
    await user.type(screen.getByLabelText("Search"), "chess");
    await waitFor(() => expect(lastQuery()).toEqual({ page: 1, pageSize: 12, q: "chess" }));
    // One request for the finished word, not one per keystroke.
    expect(listPublishedItems.mock.calls.filter(([query]) => query.q)).toHaveLength(1);
    expect(await screen.findByText("1 quest or event matches your filters")).toBeInTheDocument();
  });

  it("filters by category on the server and resets the page", async () => {
    const user = userEvent.setup();
    listPublishedItems.mockResolvedValue(pageOf([quest()], { totalItems: 30 }));
    renderBoard();

    await user.click(await screen.findByRole("button", { name: "Next" }));
    await waitFor(() => expect(lastQuery().page).toBe(2));
    // Suggested categories are offered even when the page has none of them.
    await user.click(screen.getByRole("button", { name: "Sports" }));

    await waitFor(() =>
      expect(lastQuery()).toEqual({ page: 1, pageSize: 12, category: "Sports" })
    );
    expect(screen.getByRole("button", { name: "Sports" })).toHaveAttribute("aria-pressed", "true");
  });

  it("sends today's bounds in the viewer's own time zone", async () => {
    const user = userEvent.setup();
    renderBoard();

    await user.click(await screen.findByRole("button", { name: "Today" }));

    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    await waitFor(() =>
      expect(lastQuery()).toEqual({
        page: 1,
        pageSize: 12,
        windowStart: start.toISOString(),
        windowEnd: end.toISOString(),
      })
    );
  });

  it("doesn't send a date range that ends before it starts", async () => {
    const user = userEvent.setup();
    renderBoard();

    await user.click(await screen.findByRole("button", { name: "Date range" }));
    await user.type(screen.getByLabelText("From"), "2026-11-20");
    await user.type(screen.getByLabelText("To"), "2026-11-10");

    expect(
      await screen.findByText("The end date must be on or after the start date.")
    ).toBeInTheDocument();
    const reversed = ([query]) =>
      query.windowStart === new Date(2026, 10, 20).toISOString() && query.windowEnd;
    expect(listPublishedItems.mock.calls.some(reversed)).toBe(false);
  });

  it("never lets an older response replace a newer one", async () => {
    const user = userEvent.setup();
    let finishFirst;
    listPublishedItems
      .mockResolvedValueOnce(pageOf([quest()]))
      .mockReturnValueOnce(new Promise((resolve) => (finishFirst = resolve)))
      .mockResolvedValueOnce(pageOf([quest({ id: "30", title: "Sports quest" })]));
    renderBoard();

    await screen.findByRole("button", { name: "View quest: Campus cleanup" });
    await user.click(screen.getByRole("button", { name: "Arts" }));
    await user.click(screen.getByRole("button", { name: "Sports" }));
    expect(await screen.findByText("Sports quest")).toBeInTheDocument();

    finishFirst(pageOf([quest({ id: "40", title: "Arts quest" })]));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByText("Arts quest")).not.toBeInTheDocument();
    expect(screen.getByText("Sports quest")).toBeInTheDocument();
  });

  it("shows a no-results state for filters", async () => {
    const user = userEvent.setup();
    renderBoard();

    await screen.findByRole("button", { name: "View quest: Campus cleanup" });
    listPublishedItems.mockResolvedValue(pageOf([]));
    await user.click(screen.getByRole("button", { name: "Arts" }));

    expect(await screen.findByText(/Nothing matches these filters/)).toBeInTheDocument();
    expect(screen.getByText("0 quests and events match your filters")).toBeInTheDocument();
  });
});

describe("Item details", () => {
  it("loads the current details with GET /items/{id}", async () => {
    const user = userEvent.setup();
    getItem.mockResolvedValue(quest({ description: "Updated by the organizer." }));
    renderBoard();

    await open(user);

    expect(getItem).toHaveBeenCalledWith("11", "tok");
    expect(await screen.findByText("Updated by the organizer.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Campus cleanup" })).toBeInTheDocument();
    expect(screen.getByText("A photo of your full bag.")).toBeInTheDocument();
    expect(screen.getByText("Europe/Paris")).toBeInTheDocument();
    expect(joinButton()).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "← All quests and events" }));
    expect(screen.getByRole("list", { name: "Published quests and events" })).toBeInTheDocument();
  });

  it("shows an event without points or proof, with an RSVP button", async () => {
    const user = userEvent.setup();
    listPublishedItems.mockResolvedValue(pageOf([EVENT]));
    joinItem.mockResolvedValue({ id: "p1", itemId: "21", status: "joined" });
    renderBoard();

    await open(user, "Open mic", "event");
    await screen.findByText("Music and poetry.");
    expect(screen.queryByText("How to show you did it")).not.toBeInTheDocument();
    expect(screen.queryByText("Points")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "RSVP" }));
    expect(await screen.findByText("You're going to this event.")).toBeInTheDocument();
    expect(joinItem).toHaveBeenCalledWith("21", "tok");
  });

  it("goes back to the reloaded list when the item is no longer available", async () => {
    const user = userEvent.setup();
    getItem.mockRejectedValue(new ApiError("Gone", 404, {}, "item_not_found"));
    renderBoard();

    await open(user);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      `"Campus cleanup" is no longer available.`
    );
    expect(screen.getByRole("list", { name: "Published quests and events" })).toBeInTheDocument();
  });

  it("keeps the list's details when the refresh fails for another reason", async () => {
    const user = userEvent.setup();
    getItem.mockRejectedValue(new ApiError("Server error", 500));
    renderBoard();

    await open(user);
    expect(await screen.findByText(/These details may be out of date/)).toBeInTheDocument();
    expect(screen.getByText("Pick up litter around the library.")).toBeInTheDocument();
    expect(joinButton()).toBeEnabled();
  });
});

describe("Joining and RSVP (QB-90)", () => {
  it("joins a quest and shows the joined status", async () => {
    const user = userEvent.setup();
    joinItem.mockResolvedValue({ id: "p11", itemId: "11", status: "joined" });
    renderBoard();

    await open(user);
    await user.click(joinButton());

    expect(joinItem).toHaveBeenCalledWith("11", "tok");
    expect(await screen.findByText('You joined "Campus cleanup".')).toBeInTheDocument();
    expect(screen.getByText("You've joined this quest.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Join quest" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "← All quests and events" }));
    expect(within(screen.getByRole("list", { name: "Published quests and events" })).getByText("Joined")).toBeInTheDocument();
  });

  it("restores the joined status after a refresh from /me/participations", async () => {
    const user = userEvent.setup();
    listMyParticipations.mockResolvedValue([joined(quest())]);
    renderBoard();

    await open(user);

    expect(screen.getByText("You've joined this quest.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Join quest" })).not.toBeInTheDocument();
  });

  it("ignores repeated clicks while joining", async () => {
    const user = userEvent.setup();
    let finish;
    joinItem.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    renderBoard();

    await open(user);
    await user.click(joinButton());
    const button = screen.getByRole("button", { name: "Joining…" });
    expect(button).toBeDisabled();
    await user.click(button);

    expect(joinItem).toHaveBeenCalledTimes(1);
    finish({ id: "p11", itemId: "11", status: "joined" });
    expect(await screen.findByText("You've joined this quest.")).toBeInTheDocument();
  });

  it("treats only the already_joined conflict as joined", async () => {
    const user = userEvent.setup();
    joinItem.mockRejectedValue(new ApiError("You have already joined this item.", 409, {}, "already_joined"));
    renderBoard();

    await open(user);
    await user.click(joinButton());

    expect(await screen.findByText(`You've already joined "Campus cleanup".`)).toBeInTheDocument();
    expect(screen.getByText("You've joined this quest.")).toBeInTheDocument();
  });

  it("doesn't treat another conflict as joined", async () => {
    const user = userEvent.setup();
    joinItem.mockRejectedValue(new ApiError("The quest is full.", 409, {}, "quest_full"));
    renderBoard();

    await open(user);
    await user.click(joinButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      `You couldn't join "Campus cleanup". The quest is full.`
    );
    expect(joinButton()).toBeEnabled();
  });

  it("shows a permission error", async () => {
    const user = userEvent.setup();
    joinItem.mockRejectedValue(new ApiError("Insufficient role", 403));
    renderBoard();

    await open(user);
    await user.click(joinButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      `You can't join "Campus cleanup". Insufficient role`
    );
  });

  it("goes back to the reloaded list when the item is gone", async () => {
    const user = userEvent.setup();
    joinItem.mockRejectedValue(new ApiError("Gone", 404, {}, "item_not_found"));
    renderBoard();

    await open(user);
    listPublishedItems.mockResolvedValue(pageOf([]));
    await user.click(joinButton());

    expect(await screen.findByText("There are no published quests or events yet.")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(`"Campus cleanup" is no longer available.`);
  });

  it("explains a backend without the join route", async () => {
    const user = userEvent.setup();
    joinItem.mockRejectedValue(new ApiError("Not Found", 404, {}, "request_rejected"));
    renderBoard();

    await open(user);
    await user.click(joinButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(/doesn't have the API needed to join/);
  });

  it("ends the session when joining is rejected with 401", async () => {
    const user = userEvent.setup();
    joinItem.mockRejectedValue(new ApiError("Not authenticated", 401));
    const { onSessionExpired } = renderBoard();

    await open(user);
    await user.click(joinButton());

    await waitFor(() => expect(onSessionExpired).toHaveBeenCalledTimes(1));
  });

  it("ends the session instead of joining once the token has expired", async () => {
    const user = userEvent.setup();
    const { onSessionExpired } = renderBoard({
      session: { ...SESSION, expiresAt: new Date(Date.now() + 60000).toISOString() },
    });
    await open(user);

    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 120000);
    try {
      await user.click(joinButton());
    } finally {
      nowSpy.mockRestore();
    }

    expect(onSessionExpired).toHaveBeenCalledTimes(1);
    expect(joinItem).not.toHaveBeenCalled();
  });

  it("doesn't offer joining to users without the student role", async () => {
    const user = userEvent.setup();
    renderBoard({ canJoin: false });

    await open(user);

    expect(screen.queryByRole("button", { name: "Join quest" })).not.toBeInTheDocument();
    expect(screen.getByText("Only students can join quests or RSVP to events.")).toBeInTheDocument();
  });

  describe("when the result of joining is unknown", () => {
    const lost = () => new ApiError("Couldn't get a response.", 0);

    it("reloads participations and reports the join if it went through", async () => {
      const user = userEvent.setup();
      joinItem.mockRejectedValue(lost());
      renderBoard();

      await open(user);
      listMyParticipations.mockResolvedValue([joined(quest())]);
      await user.click(joinButton());

      expect(await screen.findByText('You joined "Campus cleanup".')).toBeInTheDocument();
      expect(screen.getByText("You've joined this quest.")).toBeInTheDocument();
      expect(joinItem).toHaveBeenCalledTimes(1);
    });

    it("says it couldn't confirm when the server doesn't show the user as joined", async () => {
      const user = userEvent.setup();
      joinItem.mockRejectedValue(lost());
      renderBoard();

      await open(user);
      await user.click(joinButton());

      expect(await screen.findByRole("alert")).toHaveTextContent(
        `We couldn't confirm whether you joined "Campus cleanup". Couldn't get a response. ` +
          "The server doesn't show you as joined, so you can try again."
      );
      expect(joinItem).toHaveBeenCalledTimes(1);
      expect(joinButton()).toBeEnabled();
    });

    it("says it couldn't confirm when participations can't be reloaded", async () => {
      const user = userEvent.setup();
      joinItem.mockRejectedValue(lost());
      renderBoard();

      await open(user);
      listMyParticipations.mockRejectedValue(lost());
      await user.click(joinButton());

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Use Reload to check before trying again."
      );
      expect(screen.queryByText("You've joined this quest.")).not.toBeInTheDocument();
      expect(joinItem).toHaveBeenCalledTimes(1);
    });
  });

  it("keeps the open item open after Reload", async () => {
    const user = userEvent.setup();
    renderBoard();

    await open(user);
    listMyParticipations.mockResolvedValue([joined(quest())]);
    await user.click(screen.getByRole("button", { name: "Reload" }));

    expect(await screen.findByText("You've joined this quest.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Campus cleanup" })).toBeInTheDocument();
  });
});
