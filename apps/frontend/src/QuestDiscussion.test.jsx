import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { demoListThreads } from "./discussionsDemo.js";
import QuestDiscussion from "./QuestDiscussion.jsx";

vi.mock("./discussionsDemo.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, demoListThreads: vi.fn(actual.demoListThreads) };
});

const QUEST = { id: "11", kind: "quest", title: "Campus cleanup" };
const AUTHOR = { id: "7", name: "Sam Student" };
const member = { id: "p1", itemId: "11", status: "joined" };

function renderDiscussion(participation = member, participationStatus = "loaded") {
  return render(
    <QuestDiscussion
      quest={QUEST}
      participation={participation}
      participationStatus={participationStatus}
      author={AUTHOR}
      onSessionExpired={vi.fn()}
    />
  );
}

beforeEach(() => {
  sessionStorage.clear();
  vi.mocked(demoListThreads).mockClear();
  vi.stubEnv("VITE_DISCUSSIONS_DEMO", "true");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Quest discussion access", () => {
  it.each([
    [null, "loaded", /Only students who joined this quest/],
    [{ ...member, status: "pending" }, "loaded", /waiting for the organizer's approval/],
    [{ ...member, status: "rejected" }, "loaded", /didn't approve your participation/],
    [null, "error", /couldn't confirm that you've joined/],
  ])("explains why it's closed (%o, %s)", (participation, status, message) => {
    renderDiscussion(participation, status);
    expect(screen.getByRole("status")).toHaveTextContent(message);
    expect(screen.queryByRole("button", { name: "New discussion" })).not.toBeInTheDocument();
    expect(demoListThreads).not.toHaveBeenCalled();
  });

  it("opens for approved members", async () => {
    renderDiscussion({ ...member, status: "approved" });
    expect(await screen.findByRole("button", { name: /Anyone want to go together\?/ })).toBeInTheDocument();
  });
});

describe("Quest discussion prototype", () => {
  it("labels sample data and keeps posts to this tab", async () => {
    renderDiscussion();
    expect(screen.getByRole("note")).toHaveTextContent("Prototype with sample discussions");
    expect(screen.getByRole("note")).toHaveTextContent("Nobody else can see them");
    const list = await screen.findByRole("list", { name: "Discussions about Campus cleanup" });
    expect(within(list).getAllByText(/Sample/).length).toBeGreaterThan(0);
  });

  it("posts a discussion as plain text and shows it as a thread", async () => {
    const user = userEvent.setup();
    renderDiscussion();
    await screen.findByRole("list", { name: "Discussions about Campus cleanup" });

    await user.click(screen.getByRole("button", { name: "New discussion" }));
    await user.click(screen.getByRole("button", { name: "Post discussion" }));
    expect(screen.getByText(/at least 3 characters/)).toBeInTheDocument();
    expect(screen.getByText("Choose a category.")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Title"), "Bring gloves?");
    await user.selectOptions(screen.getByLabelText("Category"), "help");
    await user.type(screen.getByLabelText("Message"), "<img src=x onerror=alert(1)> anyone?");
    await user.click(screen.getByRole("button", { name: "Post discussion" }));

    expect(await screen.findByRole("heading", { name: "Bring gloves?" })).toBeInTheDocument();
    expect(screen.getByText("<img src=x onerror=alert(1)> anyone?")).toBeInTheDocument();
    expect(document.querySelector(".discussion-thread img")).toBeNull();
    expect(screen.getByText("Sam Student")).toBeInTheDocument();
    expect(screen.getAllByText("Help").length).toBeGreaterThan(0);
  });

  it("keeps drafts while moving between the list and threads", async () => {
    const user = userEvent.setup();
    renderDiscussion();
    await screen.findByRole("list", { name: "Discussions about Campus cleanup" });

    await user.click(screen.getByRole("button", { name: "New discussion" }));
    await user.type(screen.getByLabelText("Title"), "Half-written idea");
    await user.click(screen.getByRole("button", { name: "← Back to discussions" }));

    await user.click(await screen.findByRole("button", { name: /Anyone want to go together\?/ }));
    await user.type(await screen.findByLabelText("Your reply"), "Count me in");
    await user.click(screen.getByRole("button", { name: "← All discussions" }));

    await user.click(await screen.findByRole("button", { name: "New discussion" }));
    expect(screen.getByLabelText("Title")).toHaveValue("Half-written idea");
    await user.click(screen.getByRole("button", { name: "← Back to discussions" }));
    await user.click(await screen.findByRole("button", { name: /Anyone want to go together\?/ }));
    expect(await screen.findByLabelText("Your reply")).toHaveValue("Count me in");

    await user.click(screen.getByRole("button", { name: "Post reply" }));
    expect(await screen.findByText("Count me in", { selector: "p" })).toBeInTheDocument();
    expect(screen.getByLabelText("Your reply")).toHaveValue("");
  });

  it("searches and filters by category", async () => {
    const user = userEvent.setup();
    renderDiscussion();
    const list = await screen.findByRole("list", { name: "Discussions about Campus cleanup" });
    expect(within(list).getAllByRole("button")).toHaveLength(3);

    await user.click(screen.getByRole("button", { name: "Tips" }));
    expect(within(list).getAllByRole("button")).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "All" }));
    await user.type(screen.getByLabelText("Search discussions"), "bring");
    expect(within(list).getAllByRole("button")).toHaveLength(1);
    await user.type(screen.getByLabelText("Search discussions"), "zzz");
    expect(screen.getByText("No discussions match your search.")).toBeInTheDocument();
  });

  it("says it's unavailable in live mode and never loads sample data", () => {
    vi.stubEnv("VITE_DISCUSSIONS_DEMO", "false");
    renderDiscussion();
    expect(screen.getByText(/Quest discussions aren't available yet/)).toBeInTheDocument();
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
    expect(demoListThreads).not.toHaveBeenCalled();
  });

  it("stays unavailable in a production build even with the flag on", () => {
    vi.stubEnv("DEV", false);
    renderDiscussion();
    expect(screen.getByText(/aren't available yet/)).toBeInTheDocument();
    expect(demoListThreads).not.toHaveBeenCalled();
  });
});
