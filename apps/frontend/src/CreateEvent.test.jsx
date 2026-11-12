import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, createEvent } from "./api.js";
import CreateEvent from "./CreateEvent.jsx";
import { browserTimeZone } from "./dates.js";

vi.mock("./api.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, createEvent: vi.fn() };
});

vi.mock("./dates.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, browserTimeZone: vi.fn() };
});

const SESSION = { token: "org-tok", userId: "7", expiresAt: "2099-01-01T00:00:00Z" };

function createdEvent(overrides) {
  return {
    id: "12",
    kind: "event",
    title: "Board games night",
    startsAt: "2026-11-01T17:30:00Z",
    endsAt: "2026-11-01T20:00:00Z",
    timeZone: "Europe/Paris",
    status: "draft",
    ...overrides,
  };
}

function renderPage() {
  const onSessionExpired = vi.fn();
  render(<CreateEvent session={SESSION} onSessionExpired={onSessionExpired} />);
  return { onSessionExpired };
}

async function fillForm(user) {
  await user.type(screen.getByLabelText("Title"), "  Board games night ");
  await user.type(screen.getByLabelText("Description"), "Bring a game.");
  await user.type(screen.getByLabelText("Location"), "Student lounge");
  await user.type(screen.getByLabelText("Category"), "Games");
  await user.type(screen.getByLabelText("Starts"), "2026-11-01T18:30");
  await user.type(screen.getByLabelText("Ends"), "2026-11-01T21:00");
}

const saveButton = () => screen.getByRole("button", { name: "Save event" });

beforeEach(() => {
  vi.resetAllMocks();
  browserTimeZone.mockReturnValue("Europe/Paris");
  createEvent.mockResolvedValue(createdEvent());
});

describe("Create event form (FE-12)", () => {
  it("sends the event with trimmed text and UTC times, then clears the form", async () => {
    const user = userEvent.setup();
    renderPage();

    expect(screen.getByLabelText("Time zone")).toHaveValue("Europe/Paris");
    await fillForm(user);
    await user.click(saveButton());

    expect(createEvent).toHaveBeenCalledWith(
      {
        title: "Board games night",
        description: "Bring a game.",
        location: "Student lounge",
        category: "Games",
        starts_at: "2026-11-01T17:30:00.000Z",
        ends_at: "2026-11-01T20:00:00.000Z",
        time_zone: "Europe/Paris",
      },
      "org-tok"
    );
    expect(
      await screen.findByText(
        '"Board games night" (1 Nov 2026, 18:30) was saved as a draft. ' +
          "Students can't see it until it's published."
      )
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toHaveValue("");
  });

  it("reads the times in the chosen time zone", async () => {
    const user = userEvent.setup();
    renderPage();

    await fillForm(user);
    await user.selectOptions(screen.getByLabelText("Time zone"), "America/New_York");
    await user.click(saveButton());

    expect(createEvent.mock.calls[0][0]).toMatchObject({
      starts_at: "2026-11-01T23:30:00.000Z",
      ends_at: "2026-11-02T02:00:00.000Z",
      time_zone: "America/New_York",
    });
  });

  it("checks required fields and the time window before sending", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(saveButton());
    expect(screen.getByText("Title is required.")).toBeInTheDocument();
    expect(screen.getByText("Start time is required.")).toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toHaveAttribute("aria-invalid", "true");

    await fillForm(user);
    await user.clear(screen.getByLabelText("Ends"));
    await user.type(screen.getByLabelText("Ends"), "2026-11-01T18:30");
    await user.click(saveButton());

    expect(screen.getByText("End time must be after the start time.")).toBeInTheDocument();
    expect(createEvent).not.toHaveBeenCalled();
  });

  it("shows the backend's field errors next to the fields and keeps what was typed", async () => {
    const user = userEvent.setup();
    createEvent.mockRejectedValue(
      new ApiError("Category: Too long", 422, { category: "Too long" }, "string_too_long")
    );
    renderPage();

    await fillForm(user);
    await user.click(saveButton());

    expect(await screen.findByText("Too long")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Please fix the highlighted fields.");
    expect(screen.getByLabelText("Title")).toHaveValue("  Board games night ");
  });

  it("says when the account has no organizer access", async () => {
    const user = userEvent.setup();
    createEvent.mockRejectedValue(new ApiError("Insufficient role", 403));
    renderPage();

    await fillForm(user);
    await user.click(saveButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Your account doesn't have organizer access"
    );
    expect(screen.queryByRole("button", { name: "Save event" })).not.toBeInTheDocument();
  });

  it("doesn't report a lost answer as a failure", async () => {
    const user = userEvent.setup();
    createEvent.mockRejectedValue(new ApiError("Couldn't get a response.", 0));
    renderPage();

    await fillForm(user);
    await user.click(saveButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn't confirm whether the event was saved."
    );
    expect(screen.getByLabelText("Title")).toHaveValue("  Board games night ");
  });

  it("ends the session when the backend rejects the token", async () => {
    const user = userEvent.setup();
    createEvent.mockRejectedValue(new ApiError("Not authenticated", 401));
    const { onSessionExpired } = renderPage();

    await fillForm(user);
    await user.click(saveButton());

    await vi.waitFor(() => expect(onSessionExpired).toHaveBeenCalled());
  });

  it("disables the button while saving", async () => {
    const user = userEvent.setup();
    createEvent.mockReturnValue(new Promise(() => {}));
    renderPage();

    await fillForm(user);
    await user.click(saveButton());

    expect(screen.getByRole("button", { name: "Saving event…" })).toBeDisabled();
  });

  it("uses the browser's zone as the default", () => {
    browserTimeZone.mockReturnValue("Asia/Tokyo");
    renderPage();
    expect(screen.getByLabelText("Time zone")).toHaveValue("Asia/Tokyo");
  });
});
