import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, createQuest } from "./api.js";
import QuestForm from "./QuestForm.jsx";
import { wallTimeToIso } from "./questTime.js";

const clientState = { isDemo: false };

vi.mock("./api.js", async (importOriginal) => {
  const actual = await importOriginal();
  const createQuest = vi.fn();
  return {
    ...actual,
    createQuest,
    questsDemoEnabled: vi.fn(() => false),
    getQuestClient: () => ({
      get isDemo() {
        return clientState.isDemo;
      },
      createQuest: (fields) => createQuest(fields, "tok"),
    }),
  };
});

const SESSION = { token: "tok", userId: "4", expiresAt: "2099-01-01T00:00:00Z" };
const START = "2026-10-20T14:00";
const END = "2026-10-20T16:30";
const PAYLOAD = {
  title: "Campus cleanup",
  description: "Pick up litter around the library.",
  location: "Quai d'Orsay",
  starts_at: wallTimeToIso(START, "Europe/Paris").iso,
  ends_at: wallTimeToIso(END, "Europe/Paris").iso,
  time_zone: "Europe/Paris",
  category: "Volunteering",
  proof_instructions: "A photo of your full bag.",
  point_value: 50,
};

function quest(overrides) {
  return {
    id: "11",
    title: "Campus cleanup",
    description: "Pick up litter around the library.",
    location: "Quai d'Orsay",
    startsAt: PAYLOAD.starts_at,
    endsAt: PAYLOAD.ends_at,
    timeZone: "Europe/Paris",
    category: "Volunteering",
    proofInstructions: "A photo of your full bag.",
    kind: "quest",
    pointValue: 50,
    status: "draft",
    ownerId: "4",
    ...overrides,
  };
}

function renderForm({ session = SESSION } = {}) {
  const props = {
    onCreated: vi.fn(),
    onResultUnknown: vi.fn(),
    onSessionExpired: vi.fn(),
  };
  render(<QuestForm session={session} {...props} />);
  return props;
}

const field = (label) => screen.getByLabelText(label);
const submit = (user) => user.click(screen.getByRole("button", { name: "Save as draft" }));

async function fillForm(user, overrides = {}) {
  const { Starts = START, Ends = END, ...textOverrides } = overrides;
  const values = {
    Title: "  Campus cleanup  ",
    Description: "Pick up litter around the library.",
    Location: "Quai d'Orsay",
    Category: "Volunteering",
    "Proof instructions": "A photo of your full bag.",
    Points: "50",
    ...textOverrides,
  };
  for (const [label, value] of Object.entries(values)) {
    if (value) await user.type(field(label), value);
  }
  for (const [label, value] of [
    ["Starts", Starts],
    ["Ends", Ends],
  ]) {
    if (value) {
      await user.click(field(label));
      await user.paste(value);
    }
  }
}

beforeEach(() => {
  vi.resetAllMocks();
  clientState.isDemo = false;
});

describe("Create quest form (QB-58)", () => {
  it("shows every field the quest needs", () => {
    renderForm();
    for (const label of [
      "Title",
      "Description",
      "Location",
      "Starts",
      "Ends",
      "Category",
      "Time zone",
      "Proof instructions",
      "Points",
    ]) {
      expect(field(label)).toBeInTheDocument();
    }
    expect(field("Time zone")).toHaveValue("Europe/Paris");
  });

  it("validates required fields without a request", async () => {
    const user = userEvent.setup();
    renderForm();

    await submit(user);

    expect(screen.getByText("Please enter the title.")).toBeInTheDocument();
    expect(screen.getByText("Please enter the description.")).toBeInTheDocument();
    expect(screen.getByText("Please enter the location.")).toBeInTheDocument();
    expect(screen.getByText("Please choose when the quest starts.")).toBeInTheDocument();
    expect(screen.getByText("Please choose when the quest ends.")).toBeInTheDocument();
    expect(screen.getByText("Please enter the category.")).toBeInTheDocument();
    expect(screen.getByText("Please enter the proof instructions.")).toBeInTheDocument();
    expect(screen.getByText("Please enter a whole number of points.")).toBeInTheDocument();
    expect(createQuest).not.toHaveBeenCalled();
  });

  it("checks the time window, points range and text lengths", async () => {
    const user = userEvent.setup();
    renderForm();

    await fillForm(user, { Ends: START, Points: "10001" });
    await user.clear(field("Title"));
    await user.click(field("Title"));
    await user.paste("t".repeat(201));
    await submit(user);

    expect(screen.getByText("The end must be after the start.")).toBeInTheDocument();
    expect(screen.getByText("Points must be between 1 and 10000.")).toBeInTheDocument();
    expect(screen.getByText("Title must be at most 200 characters.")).toBeInTheDocument();
    expect(createQuest).not.toHaveBeenCalled();
  });

  it("rejects DST gaps and ambiguous times in the selected zone", async () => {
    const user = userEvent.setup();
    renderForm();

    await fillForm(user, { Starts: "2026-03-29T02:30", Ends: "2026-03-29T04:00" });
    await submit(user);
    expect(screen.getByText(/does not exist in the selected time zone/i)).toBeInTheDocument();
    expect(createQuest).not.toHaveBeenCalled();

    await user.clear(field("Starts"));
    await user.click(field("Starts"));
    await user.paste("2026-10-25T02:30");
    await user.clear(field("Ends"));
    await user.click(field("Ends"));
    await user.paste("2026-10-25T04:00");
    await submit(user);
    expect(screen.getByText(/ambiguous in the selected time zone/i)).toBeInTheDocument();
    expect(createQuest).not.toHaveBeenCalled();
  });

  it("sends the exact payload using the selected timezone, not the computer zone", async () => {
    const user = userEvent.setup();
    const created = quest();
    createQuest.mockResolvedValue(created);
    const props = renderForm();

    await fillForm(user);
    await submit(user);

    await waitFor(() => expect(createQuest).toHaveBeenCalledWith(PAYLOAD, "tok"));
    expect(PAYLOAD.starts_at).toBe("2026-10-20T12:00:00.000Z");
    expect(PAYLOAD.ends_at).toBe("2026-10-20T14:30:00.000Z");
    expect(await screen.findByText(/was saved as draft #11/)).toBeInTheDocument();
    expect(screen.getByText(/Students can't see it until you publish it/)).toBeInTheDocument();
    expect(props.onCreated).toHaveBeenCalledWith(created);
    expect(field("Title")).toHaveValue("");
  });

  it("prevents duplicate submissions while saving", async () => {
    const user = userEvent.setup();
    let finish;
    createQuest.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    renderForm();

    await fillForm(user);
    await submit(user);
    const button = screen.getByRole("button", { name: "Saving draft…" });
    expect(button).toBeDisabled();
    await user.click(button);

    expect(createQuest).toHaveBeenCalledTimes(1);
    finish(quest());
    expect(await screen.findByText(/was saved as draft #11/)).toBeInTheDocument();
  });

  it("shows backend field errors and keeps the input", async () => {
    const user = userEvent.setup();
    createQuest.mockRejectedValue(
      new ApiError("Point value: Input should be less than or equal to 500", 422, {
        point_value: "Input should be less than or equal to 500",
      })
    );
    renderForm();

    await fillForm(user);
    await submit(user);

    expect(
      await screen.findByText("Input should be less than or equal to 500")
    ).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Please fix the highlighted fields.");
    expect(field("Title")).toHaveValue("  Campus cleanup  ");
    expect(field("Points")).toHaveValue(50);
    expect(screen.getByRole("button", { name: "Save as draft" })).toBeEnabled();
  });

  it("explains a permission error and keeps the input", async () => {
    const user = userEvent.setup();
    createQuest.mockRejectedValue(new ApiError("Insufficient role", 403));
    renderForm();

    await fillForm(user);
    await submit(user);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "You don't have permission to create quests. Insufficient role"
    );
    expect(field("Location")).toHaveValue("Quai d'Orsay");
  });

  it("ends the session on 401", async () => {
    const user = userEvent.setup();
    createQuest.mockRejectedValue(new ApiError("Not authenticated", 401));
    const props = renderForm();

    await fillForm(user);
    await submit(user);

    await waitFor(() => expect(props.onSessionExpired).toHaveBeenCalledTimes(1));
  });

  it("ends the session instead of saving once the token has expired", async () => {
    const user = userEvent.setup();
    const props = renderForm({
      session: { ...SESSION, expiresAt: new Date(Date.now() + 60000).toISOString() },
    });
    await fillForm(user);

    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 120000);
    try {
      await submit(user);
    } finally {
      nowSpy.mockRestore();
    }

    expect(props.onSessionExpired).toHaveBeenCalledTimes(1);
    expect(createQuest).not.toHaveBeenCalled();
  });

  it("never resubmits when the result is unknown, and asks the page to check the list", async () => {
    const user = userEvent.setup();
    createQuest.mockRejectedValue(new ApiError("Couldn't get a response.", 0));
    const props = renderForm();

    await fillForm(user);
    await submit(user);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      `We couldn't confirm the result of saving "Campus cleanup". Couldn't get a response.`
    );
    expect(screen.getByRole("alert")).toHaveTextContent(/Check your items for this draft/);
    expect(screen.getByRole("alert")).not.toHaveTextContent(/couldn't be saved|failed/i);
    expect(field("Title")).toHaveValue("  Campus cleanup  ");
    expect(createQuest).toHaveBeenCalledTimes(1);
    expect(props.onResultUnknown).toHaveBeenCalledTimes(1);
  });

  it("marks demo saves as sample data, not a database save", async () => {
    const user = userEvent.setup();
    clientState.isDemo = true;
    createQuest.mockResolvedValue(quest({ id: "demo-9" }));
    renderForm();

    await fillForm(user);
    await submit(user);

    expect(await screen.findByText(/Demo mode — sample data only/i)).toBeInTheDocument();
    expect(screen.getByText(/was not saved to the database/i)).toBeInTheDocument();
    expect(screen.queryByText(/until you publish it/i)).not.toBeInTheDocument();
  });
});
