import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, createQuest, listMyItems, publishItem } from "./api.js";
import MyQuests from "./MyQuests.jsx";

vi.mock("./api.js", async (importOriginal) => {
  const actual = await importOriginal();
  const createQuest = vi.fn();
  return {
    ...actual,
    createQuest,
    listMyItems: vi.fn(),
    publishItem: vi.fn(),
    questsDemoEnabled: vi.fn(() => false),
    getQuestClient: () => ({ isDemo: false, createQuest: (fields) => createQuest(fields, "tok") }),
  };
});

const SESSION = { token: "tok", userId: "4", expiresAt: "2099-01-01T00:00:00Z" };

function item(overrides) {
  return {
    id: "11",
    kind: "quest",
    ownerId: "4",
    title: "Campus cleanup",
    description: "Pick up litter.",
    location: "Quai d'Orsay",
    startsAt: "2026-11-20T12:00:00Z",
    endsAt: "2026-11-20T14:00:00Z",
    timeZone: "Europe/Paris",
    category: "Volunteering",
    proofInstructions: "Photo.",
    pointValue: 50,
    status: "draft",
    ...overrides,
  };
}

const EVENT = item({
  id: "12",
  kind: "event",
  title: "Open mic",
  startsAt: "2026-11-21T18:00:00Z",
  endsAt: "2026-11-21T20:00:00Z",
  proofInstructions: "",
  pointValue: null,
});

function renderPage(session = SESSION) {
  const onSessionExpired = vi.fn();
  render(<MyQuests session={session} onSessionExpired={onSessionExpired} />);
  return { onSessionExpired };
}

const row = (title) => screen.getByText(title).closest("li");
const publishButton = (title = "Campus cleanup") =>
  screen.getByRole("button", { name: `Publish "${title}"` });
// The list's alert comes before the create form's alert.
const listAlert = () => screen.getAllByRole("alert")[0];

beforeEach(() => {
  vi.resetAllMocks();
  listMyItems.mockResolvedValue([item(), EVENT]);
});

describe("My items and publishing (QB-60)", () => {
  it("lists the organizer's quests and events from GET /items/me with their status", async () => {
    listMyItems.mockResolvedValue([item(), EVENT, item({ id: "13", title: "Chess", status: "published" })]);
    renderPage();

    expect(await screen.findByText("Campus cleanup")).toBeInTheDocument();
    expect(listMyItems).toHaveBeenCalledWith("tok");
    expect(row("Campus cleanup")).toHaveTextContent("Draft");
    expect(row("Campus cleanup")).toHaveTextContent("Quest ·");
    expect(row("Open mic")).toHaveTextContent("Event ·");
    expect(row("Chess")).toHaveTextContent("Published");
    expect(within(row("Chess")).queryByRole("button", { name: /Publish/ })).not.toBeInTheDocument();
    // Edit and participants from the team's screens stay available.
    expect(screen.getByRole("button", { name: 'Edit "Open mic"' })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: 'Participants of "Chess"' })).toBeInTheDocument();
  });

  it("publishes a draft quest with POST /items/{id}/publish and updates its status", async () => {
    const user = userEvent.setup();
    publishItem.mockResolvedValue(item({ status: "published" }));
    renderPage();

    await screen.findByText("Campus cleanup");
    await user.click(publishButton());

    expect(publishItem).toHaveBeenCalledWith("11", "tok");
    expect(
      await screen.findByText('"Campus cleanup" is now published. Students can see it.')
    ).toBeInTheDocument();
    expect(row("Campus cleanup")).toHaveTextContent("Published");
    expect(screen.queryByRole("button", { name: 'Publish "Campus cleanup"' })).not.toBeInTheDocument();
  });

  it("publishes a draft event too", async () => {
    const user = userEvent.setup();
    publishItem.mockResolvedValue({ ...EVENT, status: "published" });
    renderPage();

    await screen.findByText("Open mic");
    await user.click(publishButton("Open mic"));

    await waitFor(() => expect(row("Open mic")).toHaveTextContent("Published"));
    expect(publishItem).toHaveBeenCalledWith("12", "tok");
  });

  it("ignores repeated clicks while publishing", async () => {
    const user = userEvent.setup();
    let finish;
    publishItem.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    renderPage();

    await screen.findByText("Campus cleanup");
    await user.click(publishButton());
    const button = screen.getByRole("button", { name: 'Publish "Campus cleanup"' });
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent("Publishing…");
    await user.click(button);

    expect(publishItem).toHaveBeenCalledTimes(1);
    finish(item({ status: "published" }));
    await waitFor(() => expect(row("Campus cleanup")).toHaveTextContent("Published"));
  });

  it("treats only item_already_published as already published, and reloads", async () => {
    const user = userEvent.setup();
    publishItem.mockRejectedValue(
      new ApiError("Already published", 409, {}, "item_already_published")
    );
    renderPage();

    await screen.findByText("Campus cleanup");
    listMyItems.mockResolvedValue([item({ status: "published" }), EVENT]);
    await user.click(publishButton());

    expect(await screen.findByText('"Campus cleanup" was already published.')).toBeInTheDocument();
    await waitFor(() => expect(row("Campus cleanup")).toHaveTextContent("Published"));
    expect(listMyItems).toHaveBeenCalledTimes(2);
  });

  it("keeps an archived-item conflict an error", async () => {
    const user = userEvent.setup();
    publishItem.mockRejectedValue(new ApiError("Archived items cannot be changed.", 409, {}, "item_archived"));
    renderPage();

    await screen.findByText("Campus cleanup");
    await user.click(publishButton());

    await waitFor(() =>
      expect(listAlert()).toHaveTextContent('"Campus cleanup" is archived, so it can\'t be published.')
    );
    expect(screen.queryByText(/was already published/)).not.toBeInTheDocument();
  });

  it("shows a permission error for another organizer's item and keeps the draft", async () => {
    const user = userEvent.setup();
    publishItem.mockRejectedValue(
      new ApiError("Only the organizer who created this item can change it.", 403, {}, "item_not_owned")
    );
    renderPage();

    await screen.findByText("Campus cleanup");
    await user.click(publishButton());

    await waitFor(() =>
      expect(listAlert()).toHaveTextContent(
        `You can't publish "Campus cleanup". Only the organizer who created this item can change it.`
      )
    );
    expect(row("Campus cleanup")).toHaveTextContent("Draft");
  });

  it("ends the session when publishing is rejected with 401", async () => {
    const user = userEvent.setup();
    publishItem.mockRejectedValue(new ApiError("Not authenticated", 401));
    const { onSessionExpired } = renderPage();

    await screen.findByText("Campus cleanup");
    await user.click(publishButton());

    await waitFor(() => expect(onSessionExpired).toHaveBeenCalledTimes(1));
  });

  describe("when the result of publishing is unknown", () => {
    const lost = () => new ApiError("Couldn't get a response.", 0);

    it("reloads the list and reports success if it went through", async () => {
      const user = userEvent.setup();
      publishItem.mockRejectedValue(lost());
      renderPage();

      await screen.findByText("Campus cleanup");
      listMyItems.mockResolvedValue([item({ status: "published" }), EVENT]);
      await user.click(publishButton());

      expect(
        await screen.findByText('"Campus cleanup" is now published. Students can see it.')
      ).toBeInTheDocument();
      expect(publishItem).toHaveBeenCalledTimes(1);
    });

    it("says it couldn't confirm when the item is still a draft", async () => {
      const user = userEvent.setup();
      publishItem.mockRejectedValue(lost());
      renderPage();

      await screen.findByText("Campus cleanup");
      await user.click(publishButton());

      await waitFor(() =>
        expect(listAlert()).toHaveTextContent(
          "The server still shows it as a draft, so you can publish it again."
        )
      );
      expect(publishButton()).toBeEnabled();
    });

    it("says it couldn't confirm when the list can't be reloaded", async () => {
      const user = userEvent.setup();
      publishItem.mockRejectedValue(lost());
      renderPage();

      await screen.findByText("Campus cleanup");
      listMyItems.mockRejectedValue(lost());
      await user.click(publishButton());

      await waitFor(() =>
        expect(listAlert()).toHaveTextContent("Reload your items to check before trying again.")
      );
    });
  });
});

describe("Create quest on the My items page (QB-58)", () => {
  async function fillTitle(user, text) {
    await user.type(screen.getByLabelText("Title"), text);
  }

  it("keeps what was typed in the form while the list reloads", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText("Campus cleanup");
    await fillTitle(user, "Half-written quest");
    await user.type(screen.getByLabelText("Description"), "Not saved yet");
    await user.click(screen.getByRole("button", { name: "Reload" }));

    await waitFor(() => expect(listMyItems).toHaveBeenCalledTimes(2));
    await screen.findByText("Campus cleanup");
    expect(screen.getByLabelText("Title")).toHaveValue("Half-written quest");
    expect(screen.getByLabelText("Description")).toHaveValue("Not saved yet");
  });

  it("adds a newly created draft to the list", async () => {
    const user = userEvent.setup();
    createQuest.mockResolvedValue(item({ id: "30", title: "Brand new quest", startsAt: "2026-11-25T12:00:00Z", endsAt: "2026-11-25T13:00:00Z" }));
    renderPage();
    await screen.findByText("Campus cleanup");

    await fillTitle(user, "Brand new quest");
    await user.type(screen.getByLabelText("Description"), "Desc");
    await user.type(screen.getByLabelText("Location"), "Here");
    await user.type(screen.getByLabelText("Category"), "Social");
    await user.type(screen.getByLabelText("Proof instructions"), "Photo");
    await user.type(screen.getByLabelText("Points"), "10");
    await user.click(screen.getByLabelText("Starts"));
    await user.paste("2026-11-25T13:00");
    await user.click(screen.getByLabelText("Ends"));
    await user.paste("2026-11-25T14:00");
    await user.click(screen.getByRole("button", { name: "Save as draft" }));

    await waitFor(() => expect(row("Brand new quest")).toHaveTextContent("Draft"));
    expect(screen.getByRole("button", { name: 'Publish "Brand new quest"' })).toBeInTheDocument();
  });
});
