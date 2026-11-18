import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, listMyParticipations } from "./api.js";
import JoinedQuests from "./JoinedQuests.jsx";

vi.mock("./api.js", async (importOriginal) => {
  const actual = await importOriginal();
  const listMyParticipations = vi.fn();
  return {
    ...actual,
    listMyParticipations,
    getQuestClient: (session) => ({
      isDemo: false,
      listMyParticipations: () => listMyParticipations(session.token),
    }),
  };
});

const SESSION = { token: "tok", userId: "7", expiresAt: "2099-01-01T00:00:00Z" };
// Midday UTC, so every date below is the same local day in any European or American zone.
const NOW = new Date("2026-11-05T12:00:00Z");

function item(id, title, day, fields = {}) {
  return {
    id,
    kind: "quest",
    ownerId: "4",
    title,
    description: `${title} details`,
    location: "Main courtyard",
    startsAt: `2026-11-${day}T12:00:00Z`,
    endsAt: `2026-11-${day}T14:00:00Z`,
    timeZone: "Europe/Paris",
    category: "Social",
    proofInstructions: "",
    pointValue: 10,
    status: "published",
    ...fields,
  };
}

function joinedEntry(entryItem, status = "joined") {
  return {
    item: entryItem,
    participation: { id: `p${entryItem.id}`, itemId: entryItem.id, status, joinedAt: "" },
    saved: false,
  };
}

const CLEANUP = item("1", "Campus cleanup", "10");
const OPEN_MIC = item("2", "Open mic", "12", { kind: "event" });
const PHOTO = item("3", "Photo walk", "14");
const PAST_HUNT = item("4", "Scavenger hunt", "02");
const SAVED = item("5", "Saved only quest", "11");

const ENTRIES = [
  joinedEntry(CLEANUP),
  joinedEntry(OPEN_MIC, "approved"),
  joinedEntry(PHOTO, "pending"),
  joinedEntry(PAST_HUNT, "rejected"),
  { item: SAVED, participation: null, saved: true },
];

function renderPage(session = SESSION) {
  const props = { onOpenItem: vi.fn(), onBrowse: vi.fn(), onSessionExpired: vi.fn() };
  const view = render(<JoinedQuests session={session} {...props} />);
  return { ...props, ...view };
}

const cardTitles = () =>
  screen.queryAllByRole("heading", { level: 3 }).filter((h) => h.className === "quest-card-title");

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  listMyParticipations.mockResolvedValue(ENTRIES);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("My quests list", () => {
  it("shows joined quests and RSVP'd events with their real status, but not saved-only items", async () => {
    renderPage();
    await screen.findByText("Campus cleanup");
    expect(cardTitles().map((h) => h.textContent)).toEqual(["Campus cleanup", "Open mic", "Photo walk"]);
    expect(screen.queryByText("Saved only quest")).not.toBeInTheDocument();

    const card = (title) => screen.getByText(title).closest("li");
    expect(card("Campus cleanup")).toHaveTextContent("Joined");
    expect(card("Open mic")).toHaveTextContent("Approved");
    expect(card("Photo walk")).toHaveTextContent("Pending");
    expect(screen.queryByText(/completed/i)).not.toBeInTheDocument();
    // Grouped under the local day each one starts.
    expect(screen.getByRole("heading", { name: /10 November 2026/ })).toBeInTheDocument();
  });

  it("filters by end time, independent of the participation status", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Campus cleanup");

    await user.click(screen.getByRole("button", { name: "Past" }));
    expect(cardTitles().map((h) => h.textContent)).toEqual(["Scavenger hunt"]);
    expect(screen.getByText("Scavenger hunt").closest("li")).toHaveTextContent("Rejected");

    await user.click(screen.getByRole("button", { name: "All" }));
    expect(cardTitles()).toHaveLength(4);
    expect(screen.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "true");
  });

  it("opens an item's details", async () => {
    const user = userEvent.setup();
    const { onOpenItem } = renderPage();
    await user.click(await screen.findByRole("button", { name: "View event: Open mic" }));
    expect(onOpenItem).toHaveBeenCalledWith(OPEN_MIC);
  });

  it("shows loading, then an error with a retry that reloads", async () => {
    const user = userEvent.setup();
    let fail;
    listMyParticipations.mockReturnValueOnce(new Promise((_, reject) => (fail = reject)));
    renderPage();
    expect(screen.getByRole("status")).toHaveTextContent("Loading your quests…");

    await act(async () => fail(new ApiError("The server is down.", 503)));
    expect(screen.getByRole("alert")).toHaveTextContent("The server is down.");

    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Campus cleanup")).toBeInTheDocument();
    expect(listMyParticipations).toHaveBeenCalledTimes(2);
  });

  it("hands an expired session back to the app", async () => {
    listMyParticipations.mockRejectedValue(new ApiError("Not authenticated", 401));
    const { onSessionExpired } = renderPage();
    await waitFor(() => expect(onSessionExpired).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("explains an empty list and links to the board", async () => {
    const user = userEvent.setup();
    listMyParticipations.mockResolvedValue([{ item: SAVED, participation: null, saved: true }]);
    const { onBrowse } = renderPage();
    expect(await screen.findByText(/haven't joined any quests/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Browse quests and events" }));
    expect(onBrowse).toHaveBeenCalled();
  });

  it("never shows the previous account's quests after a switch", async () => {
    const { rerender } = renderPage();
    await screen.findByText("Campus cleanup");

    listMyParticipations.mockReturnValueOnce(new Promise(() => {}));
    const other = { token: "tok-2", userId: "8", expiresAt: SESSION.expiresAt };
    rerender(
      <JoinedQuests session={other} onOpenItem={vi.fn()} onBrowse={vi.fn()} onSessionExpired={vi.fn()} />
    );
    expect(screen.queryByText("Campus cleanup")).not.toBeInTheDocument();
    expect(listMyParticipations).toHaveBeenLastCalledWith("tok-2");
  });
});

describe("My quests calendar", () => {
  // Some ICU versions put a comma after the weekday.
  const dayName = (name) => new RegExp(`^${name.replace(" ", ",? ")}`);
  const day = (name) => screen.getByRole("button", { name: dayName(name) });

  async function openCalendar(entries = ENTRIES) {
    const user = userEvent.setup();
    listMyParticipations.mockResolvedValue(entries);
    const props = renderPage();
    await screen.findByText("Campus cleanup");
    await user.click(screen.getByRole("button", { name: "All" }));
    await user.click(screen.getByRole("button", { name: "Calendar" }));
    return { user, ...props };
  }

  it("marks today, places items on their days and lists the selected day beside the grid", async () => {
    const { user, onOpenItem } = await openCalendar();
    expect(screen.getByRole("heading", { name: "November 2026" })).toBeInTheDocument();
    const today = day("Thursday 5 November 2026");
    expect(today).toHaveAttribute("aria-current", "date");
    expect(today).toHaveAccessibleName(/today, nothing scheduled/);
    expect(day("Tuesday 10 November 2026")).toHaveAccessibleName(/1 item$/);

    await user.click(day("Tuesday 10 November 2026"));
    expect(day("Tuesday 10 November 2026").closest("td")).toHaveAttribute("aria-selected", "true");
    const panel = screen.getByRole("region", { name: dayName("Tuesday 10 November 2026") });
    expect(within(panel).getByText("Campus cleanup")).toBeInTheDocument();
    expect(within(panel).getByText("Joined")).toBeInTheDocument();
    expect(panel).toHaveTextContent(/Time zone|Local to the item/);

    await user.click(within(panel).getByRole("button", { name: "View details: Campus cleanup" }));
    expect(onOpenItem).toHaveBeenCalledWith(CLEANUP);
  });

  it("shows a multi-day item on every day and collapses a crowded day into +N more", async () => {
    const trip = item("9", "Hiking trip", "20", { endsAt: "2026-11-22T14:00:00Z", kind: "event" });
    const busy = ["a", "b", "c", "d"].map((id) => joinedEntry(item(id, `Busy ${id}`, "21")));
    await openCalendar([...ENTRIES, joinedEntry(trip), ...busy]);

    expect(day("Friday 20 November 2026")).toHaveAccessibleName(/1 item$/);
    expect(day("Sunday 22 November 2026")).toHaveAccessibleName(/1 item$/);
    const crowded = day("Saturday 21 November 2026");
    expect(crowded).toHaveAccessibleName(/5 items$/);
    expect(crowded.querySelector(".calendar-more")).toHaveTextContent("+3 more");
    expect(within(crowded).getByText("cont.")).toBeInTheDocument();
  });

  it("moves between days and months with the keyboard", async () => {
    const { user } = await openCalendar();
    const today = day("Thursday 5 November 2026");
    expect(today).toHaveAttribute("tabindex", "0");
    today.focus();

    await user.keyboard("{ArrowRight}");
    expect(day("Friday 6 November 2026")).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(day("Friday 13 November 2026")).toHaveFocus();
    await user.keyboard("{Home}");
    expect(day("Monday 9 November 2026")).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("region", { name: dayName("Monday 9 November 2026") })).toBeInTheDocument();

    await user.keyboard("{PageDown}");
    expect(screen.getByRole("heading", { name: "December 2026" })).toBeInTheDocument();
    expect(day("Wednesday 9 December 2026")).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Today" }));
    expect(screen.getByRole("heading", { name: "November 2026" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Previous month" }));
    expect(screen.getByRole("heading", { name: "October 2026" })).toBeInTheDocument();
  });
});
