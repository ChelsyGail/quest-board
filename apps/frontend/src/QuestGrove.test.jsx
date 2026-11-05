import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import QuestGrove from "./QuestGrove.jsx";

const AUTHOR = { id: "7", name: "Sam Student" };
const LAUNDRY = "Laundry rooms that actually work";

function renderGrove() {
  return render(<QuestGrove author={AUTHOR} onSessionExpired={vi.fn()} />);
}

const tree = () => screen.getByRole("group", { name: "Discussion tree" });
const leaf = (title) => within(tree()).getByRole("button", { name: new RegExp(`^${title}\\.`) });
const leaves = () =>
  within(tree())
    .getAllByRole("button")
    .filter((button) => button.classList.contains("grove-leaf"));
const sidePanel = () => screen.getByRole("complementary", { name: "Discussion" });

beforeEach(() => {
  sessionStorage.clear();
  vi.stubEnv("VITE_DISCUSSIONS_DEMO", "true");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Quest Grove", () => {
  it("opens the same thread from a leaf in the tree and from the list", async () => {
    const user = userEvent.setup();
    renderGrove();
    await screen.findByRole("group", { name: "Discussion tree" });

    await user.click(leaf(LAUNDRY));
    expect(await within(sidePanel()).findByRole("heading", { name: LAUNDRY })).toBeInTheDocument();
    const fromTree = sidePanel().textContent;
    expect(leaf(LAUNDRY)).toHaveAttribute("aria-current", "true");

    await user.click(within(sidePanel()).getByRole("button", { name: "Close" }));
    await user.click(screen.getByRole("button", { name: "List" }));
    const list = screen.getByRole("list", { name: "Quest Grove discussions" });
    await user.click(within(list).getByRole("button", { name: new RegExp(LAUNDRY) }));
    expect(await within(sidePanel()).findByRole("heading", { name: LAUNDRY })).toBeInTheDocument();
    expect(sidePanel().textContent).toBe(fromTree);
  });

  it("applies the same search and topic filters to the tree and the list", async () => {
    const user = userEvent.setup();
    renderGrove();
    await screen.findByRole("group", { name: "Discussion tree" });
    // Each branch shows at most six leaves.
    expect(leaves()).toHaveLength(6 + 5 + 6 + 4 + 3);

    await user.type(screen.getByLabelText("Search discussions"), "quiet");
    const treeTitles = leaves().map((button) => button.getAttribute("aria-label").split(".")[0]);
    expect(treeTitles.sort()).toEqual(["Best quiet spots to study near the Quai?", "Noise in the student lounge"]);
    await user.click(screen.getByRole("button", { name: "List" }));
    const list = screen.getByRole("list", { name: "Quest Grove discussions" });
    expect(within(list).getAllByRole("button")).toHaveLength(2);

    await user.clear(screen.getByLabelText("Search discussions"));
    await user.click(within(screen.getByRole("group", { name: "Topics" })).getByRole("button", { name: "Ideas" }));
    expect(within(list).getAllByRole("button")).toHaveLength(4);
    await user.click(screen.getByRole("button", { name: "Tree" }));
    expect(leaves()).toHaveLength(4);
    expect(within(tree()).getByRole("button", { name: "Ideas" })).toHaveAttribute("aria-pressed", "true");
    expect(document.querySelector(".grove-branch-ideas")).toHaveClass("is-highlighted");
  });

  it("previews a leaf on focus and opens it from the keyboard", async () => {
    const user = userEvent.setup();
    renderGrove();
    await screen.findByRole("group", { name: "Discussion tree" });

    act(() => leaf(LAUNDRY).focus());
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip).toHaveTextContent(LAUNDRY);
    expect(tooltip).toHaveTextContent("Sharing a list of laundromats");
    expect(tooltip).toHaveTextContent("1 reply");
    expect(leaf(LAUNDRY)).toHaveAccessibleDescription(/Sharing a list/);

    await user.keyboard("{Enter}");
    expect(await within(sidePanel()).findByRole("heading", { name: LAUNDRY })).toBeInTheDocument();
  });

  it("selects a topic from its branch and lists the rest with +more", async () => {
    const user = userEvent.setup();
    renderGrove();
    await screen.findByRole("group", { name: "Discussion tree" });

    await user.click(within(tree()).getByRole("button", { name: "Show all 8 Campus Life discussions in the list" }));
    const list = screen.getByRole("list", { name: "Quest Grove discussions" });
    expect(within(list).getAllByRole("button")).toHaveLength(8);
    expect(screen.getByRole("button", { name: "Campus Life" })).toHaveAttribute("aria-pressed", "true");
  });

  it("starts a discussion in the side panel under the selected topic", async () => {
    const user = userEvent.setup();
    renderGrove();
    await screen.findByRole("group", { name: "Discussion tree" });
    await user.click(within(tree()).getByRole("button", { name: "Ideas" }));
    await user.click(screen.getByRole("button", { name: "New discussion" }));
    expect(within(sidePanel()).getByLabelText("Topic")).toHaveValue("ideas");
    await user.type(within(sidePanel()).getByLabelText("Title"), "Board game night");
    await user.type(within(sidePanel()).getByLabelText("Message"), "Monthly, in the lounge.");
    await user.click(within(sidePanel()).getByRole("button", { name: "Post discussion" }));
    expect(await within(sidePanel()).findByRole("heading", { name: "Board game night" })).toBeInTheDocument();
    expect(leaf("Board game night")).toBeInTheDocument();
  });

  it("starts in the list on narrow screens", async () => {
    vi.stubGlobal("matchMedia", (query) => ({ matches: query.includes("max-width"), media: query }));
    renderGrove();
    expect(await screen.findByRole("list", { name: "Quest Grove discussions" })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Discussion tree" })).not.toBeInTheDocument();
  });

  it("is unavailable without the prototype, with no sample data", () => {
    vi.stubEnv("VITE_DISCUSSIONS_DEMO", "false");
    renderGrove();
    expect(screen.getByText(/Quest Grove discussions aren't available yet/)).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Discussion tree" })).not.toBeInTheDocument();
    expect(sessionStorage.getItem("questboard.demo.discussions.v1")).toBeNull();
  });
});
