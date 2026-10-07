import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  getCurrentUser,
  listMyRoleRequests,
  roleRequestsEnabled,
  updateUser,
} from "./api.js";
import Profile from "./Profile.jsx";

vi.mock("./api.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getCurrentUser: vi.fn(),
    listMyRoleRequests: vi.fn(),
    roleRequestsEnabled: vi.fn(),
    updateUser: vi.fn(),
  };
});

const SESSION = { token: "tok", userId: "7", expiresAt: "2099-01-01T00:00:00Z" };
const PROFILE = { id: "7", name: "Ada", email: "ada@aup.edu", roles: ["student"] };
const NEW_PASSWORD = " a brand new pass ";

function renderProfile({ session = SESSION, profile = PROFILE } = {}) {
  const props = { onProfileUpdated: vi.fn(), onSessionExpired: vi.fn() };
  render(<Profile session={session} profile={profile} {...props} />);
  return props;
}

const save = (user) => user.click(screen.getByRole("button", { name: "Save changes" }));
const form = () => screen.getByRole("button", { name: "Save changes" }).closest("form");

beforeEach(() => {
  vi.resetAllMocks();
  roleRequestsEnabled.mockReturnValue(false);
});

describe("Profile details (QB-47)", () => {
  it("shows the signed-in user's name, email and roles from the profile", () => {
    renderProfile({ profile: { ...PROFILE, roles: ["student", "organizer"] } });

    expect(screen.getByLabelText("Name")).toHaveValue("Ada");
    expect(screen.getByLabelText("Email")).toHaveValue("ada@aup.edu");
    expect(screen.getByText(/Signed in as/)).toHaveTextContent("Signed in as Ada");
    expect(screen.getByText(/^Roles:/)).toHaveTextContent("Roles: Student, Organizer");
  });

  it("never shows a password and has no user ID or role inputs", () => {
    renderProfile();

    expect(screen.getByLabelText("New password")).toHaveValue("");
    expect(screen.getByLabelText("New password")).toHaveAttribute("type", "password");
    expect(screen.getByLabelText("Confirm new password")).toHaveValue("");
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/user id/i)).not.toBeInTheDocument();
    expect(screen.getAllByRole("textbox")).toHaveLength(2);
  });

  it("explains when the backend has no /users/me and sends only entered fields", async () => {
    const user = userEvent.setup();
    updateUser.mockResolvedValue({ ...PROFILE, name: "Ada L." });
    const props = renderProfile({ profile: null });

    expect(screen.getByText(/the server doesn't support it yet/)).toBeInTheDocument();
    expect(screen.queryByText(/Signed in as/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("New name")).toHaveValue("");

    await save(user);
    expect(within(form()).getByRole("alert")).toHaveTextContent(
      "Enter a new name, email, or password."
    );
    expect(updateUser).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText("New name"), "Ada L.");
    await save(user);

    await waitFor(() => expect(updateUser).toHaveBeenCalledWith("7", { name: "Ada L." }, "tok"));
    expect(await screen.findByText("Changes saved.")).toBeInTheDocument();
    expect(props.onProfileUpdated).not.toHaveBeenCalled();
  });

  it("hides access requests when role requests are not enabled", () => {
    renderProfile();
    expect(screen.queryByText("Access requests")).not.toBeInTheDocument();
    expect(listMyRoleRequests).not.toHaveBeenCalled();
  });

  it("shows access requests when role requests are enabled", async () => {
    roleRequestsEnabled.mockReturnValue(true);
    listMyRoleRequests.mockResolvedValue([]);
    renderProfile();

    expect(await screen.findByText("You haven't requested extra access yet.")).toBeInTheDocument();
    expect(listMyRoleRequests).toHaveBeenCalledWith("tok");
  });
});

describe("Saving changes (QB-47)", () => {
  it("sends only the changed fields and reports the saved profile", async () => {
    const user = userEvent.setup();
    const saved = { ...PROFILE, email: "ada@example.com" };
    updateUser.mockResolvedValue(saved);
    const props = renderProfile();

    const email = screen.getByLabelText("Email");
    await user.clear(email);
    await user.type(email, " ada@example.com ");
    await save(user);

    await waitFor(() =>
      expect(updateUser).toHaveBeenCalledWith("7", { email: "ada@example.com" }, "tok")
    );
    expect(await screen.findByText("Changes saved.")).toBeInTheDocument();
    expect(props.onProfileUpdated).toHaveBeenCalledWith(saved);
  });

  it("does not send a request when nothing changed", async () => {
    const user = userEvent.setup();
    renderProfile();

    await save(user);

    expect(within(form()).getByRole("alert")).toHaveTextContent(
      "You haven't changed anything yet."
    );
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("requires a name and email when the profile is loaded", async () => {
    const user = userEvent.setup();
    renderProfile();

    await user.clear(screen.getByLabelText("Name"));
    await user.clear(screen.getByLabelText("Email"));
    await save(user);

    expect(screen.getByText("Name cannot be empty.")).toBeInTheDocument();
    expect(screen.getByText("Email cannot be empty.")).toBeInTheDocument();
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("sends a new password unchanged and clears the password fields after saving", async () => {
    const user = userEvent.setup();
    updateUser.mockResolvedValue(PROFILE);
    renderProfile();

    await user.type(screen.getByLabelText("New password"), NEW_PASSWORD);
    await user.type(screen.getByLabelText("Confirm new password"), NEW_PASSWORD);
    await save(user);

    await waitFor(() =>
      expect(updateUser).toHaveBeenCalledWith("7", { password: NEW_PASSWORD }, "tok")
    );
    expect(
      await screen.findByText("Changes saved, including your new password.")
    ).toBeInTheDocument();
    expect(screen.getByLabelText("New password")).toHaveValue("");
    expect(screen.getByLabelText("Confirm new password")).toHaveValue("");
  });

  it("validates a new password against the 12–128 limits without a request", async () => {
    const user = userEvent.setup();
    renderProfile();

    await user.type(screen.getByLabelText("New password"), "   short   ");
    await user.type(screen.getByLabelText("Confirm new password"), "   short   ");
    await save(user);
    expect(screen.getByText("Password must be at least 12 characters.")).toBeInTheDocument();

    await user.clear(screen.getByLabelText("New password"));
    await user.click(screen.getByLabelText("New password"));
    await user.paste("p".repeat(129));
    await save(user);
    expect(screen.getByText("Password must be at most 128 characters.")).toBeInTheDocument();

    expect(updateUser).not.toHaveBeenCalled();
  });

  it("requires the confirmation to match", async () => {
    const user = userEvent.setup();
    renderProfile();

    await user.type(screen.getByLabelText("New password"), NEW_PASSWORD);
    await user.type(screen.getByLabelText("Confirm new password"), "something else!");
    await save(user);

    expect(screen.getByText("Passwords do not match.")).toBeInTheDocument();
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("asks for the new password when only the confirmation is filled in", async () => {
    const user = userEvent.setup();
    renderProfile();

    await user.type(screen.getByLabelText("Confirm new password"), NEW_PASSWORD);
    await save(user);

    expect(screen.getByText(/Enter the new password/)).toBeInTheDocument();
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("leaves the password out when the password fields are empty", async () => {
    const user = userEvent.setup();
    updateUser.mockResolvedValue({ ...PROFILE, name: "Ada L." });
    renderProfile();

    await user.type(screen.getByLabelText("Name"), " L.");
    await save(user);

    await waitFor(() => expect(updateUser).toHaveBeenCalled());
    expect(updateUser.mock.calls[0][1]).toEqual({ name: "Ada L." });
  });

  it("prevents duplicate saves while a save is in flight", async () => {
    const user = userEvent.setup();
    let finish;
    updateUser.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    renderProfile();

    await user.type(screen.getByLabelText("Name"), "!");
    await save(user);
    const button = screen.getByRole("button", { name: "Saving…" });
    expect(button).toBeDisabled();
    await user.click(button);

    expect(updateUser).toHaveBeenCalledTimes(1);
    finish({ ...PROFILE, name: "Ada!" });
    expect(await screen.findByText("Changes saved.")).toBeInTheDocument();
  });

  it("shows a backend email conflict on the email field and keeps the input", async () => {
    const user = userEvent.setup();
    updateUser.mockRejectedValue(
      new ApiError("Email: A user with this email already exists.", 409, {
        email: "A user with this email already exists.",
      })
    );
    renderProfile();

    const email = screen.getByLabelText("Email");
    await user.clear(email);
    await user.type(email, "taken@aup.edu");
    await save(user);

    expect(await screen.findByText("A user with this email already exists.")).toBeInTheDocument();
    expect(email).toHaveValue("taken@aup.edu");
    expect(screen.getByRole("button", { name: "Save changes" })).toBeEnabled();
  });

  describe("when the connection fails while saving", () => {
    const lost = () => new ApiError("Couldn't get a response.", 0);

    it("reloads the profile and reports the save if it went through", async () => {
      const user = userEvent.setup();
      updateUser.mockRejectedValue(lost());
      getCurrentUser.mockResolvedValue({ ...PROFILE, name: "Ada!" });
      const props = renderProfile();

      await user.type(screen.getByLabelText("Name"), "!");
      await save(user);

      expect(await screen.findByText("Changes saved.")).toBeInTheDocument();
      expect(getCurrentUser).toHaveBeenCalledWith("tok");
      expect(props.onProfileUpdated).toHaveBeenCalledWith({ ...PROFILE, name: "Ada!" });
      expect(within(form()).getByRole("alert")).toBeEmptyDOMElement();
    });

    it("says it couldn't confirm the save and keeps the edits when it didn't apply", async () => {
      const user = userEvent.setup();
      updateUser.mockRejectedValue(lost());
      getCurrentUser.mockResolvedValue(PROFILE);
      const props = renderProfile();

      await user.type(screen.getByLabelText("Name"), "!");
      await save(user);

      const alert = await within(form()).findByRole("alert");
      await waitFor(() =>
        expect(alert).toHaveTextContent(
          "We couldn't confirm whether your changes were saved. Couldn't get a response. " +
            "Your saved details have been reloaded above; you can save again."
        )
      );
      expect(alert).not.toHaveTextContent(/not saved/);
      expect(screen.getByLabelText("Name")).toHaveValue("Ada!");
      expect(props.onProfileUpdated).toHaveBeenCalledWith(PROFILE);
      expect(screen.getByRole("button", { name: "Save changes" })).toBeEnabled();
    });

    it("can't confirm a new password, so it keeps the password fields for another try", async () => {
      const user = userEvent.setup();
      updateUser.mockRejectedValue(lost());
      getCurrentUser.mockResolvedValue(PROFILE);
      renderProfile();

      await user.type(screen.getByLabelText("New password"), NEW_PASSWORD);
      await user.type(screen.getByLabelText("Confirm new password"), NEW_PASSWORD);
      await save(user);

      const alert = await within(form()).findByRole("alert");
      await waitFor(() =>
        expect(alert).toHaveTextContent(
          "We couldn't confirm whether your new password was saved. Couldn't get a response. " +
            "You can save it again."
        )
      );
      expect(screen.getByLabelText("New password")).toHaveValue(NEW_PASSWORD);
    });

    it("says the result is unconfirmed when the profile can't be reloaded either", async () => {
      const user = userEvent.setup();
      updateUser.mockRejectedValue(lost());
      getCurrentUser.mockRejectedValue(lost());
      const props = renderProfile();

      await user.type(screen.getByLabelText("Name"), "!");
      await save(user);

      const alert = await within(form()).findByRole("alert");
      await waitFor(() =>
        expect(alert).toHaveTextContent(
          "We couldn't confirm whether your changes were saved. Couldn't get a response."
        )
      );
      expect(props.onSessionExpired).not.toHaveBeenCalled();
      expect(props.onProfileUpdated).not.toHaveBeenCalled();
    });
  });

  it("ends the session when a save is rejected with 401", async () => {
    const user = userEvent.setup();
    updateUser.mockRejectedValue(new ApiError("Not authenticated", 401));
    const props = renderProfile();

    await user.type(screen.getByLabelText("Name"), "!");
    await save(user);

    await waitFor(() => expect(props.onSessionExpired).toHaveBeenCalledTimes(1));
  });

  it("ends the session instead of saving once the token has expired", async () => {
    const user = userEvent.setup();
    const props = renderProfile({
      session: { ...SESSION, expiresAt: new Date(Date.now() + 60000).toISOString() },
    });
    await user.type(screen.getByLabelText("Name"), "!");

    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 120000);
    try {
      await save(user);
    } finally {
      nowSpy.mockRestore();
    }

    expect(props.onSessionExpired).toHaveBeenCalledTimes(1);
    expect(updateUser).not.toHaveBeenCalled();
  });
});

describe("Refreshing roles and requests", () => {
  const refresh = (user) => user.click(screen.getByRole("button", { name: "Refresh" }));

  it("reloads the profile and keeps unsaved edits", async () => {
    const user = userEvent.setup();
    const fresh = { ...PROFILE, email: "ada@example.com", roles: ["student", "organizer"] };
    let finish;
    getCurrentUser.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const props = renderProfile();

    await user.type(screen.getByLabelText("Name"), " (edited)");
    await refresh(user);
    const button = screen.getByRole("button", { name: "Refreshing…" });
    expect(button).toBeDisabled();
    await user.click(button);
    expect(getCurrentUser).toHaveBeenCalledTimes(1);

    finish(fresh);
    expect(await screen.findByText("Your roles and details are up to date.")).toBeInTheDocument();
    expect(getCurrentUser).toHaveBeenCalledWith("tok");
    expect(props.onProfileUpdated).toHaveBeenCalledWith(fresh);
    expect(screen.getByLabelText("Name")).toHaveValue("Ada (edited)");
    // An untouched field shows the new value, so saving won't change it back.
    expect(screen.getByLabelText("Email")).toHaveValue("ada@example.com");
  });

  it("also reloads the access requests", async () => {
    const user = userEvent.setup();
    roleRequestsEnabled.mockReturnValue(true);
    listMyRoleRequests.mockResolvedValue([]);
    getCurrentUser.mockResolvedValue(PROFILE);
    renderProfile();
    await screen.findByText("You haven't requested extra access yet.");

    await refresh(user);

    await waitFor(() => expect(listMyRoleRequests).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Your roles and details are up to date.")).toBeInTheDocument();
  });

  it("shows a network error and keeps the edits", async () => {
    const user = userEvent.setup();
    getCurrentUser.mockRejectedValue(new ApiError("Couldn't get a response.", 0));
    const props = renderProfile();

    await user.type(screen.getByLabelText("Name"), "!");
    await refresh(user);

    expect(
      await screen.findByText("Your account couldn't be refreshed. Couldn't get a response.")
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveValue("Ada!");
    expect(screen.getByRole("button", { name: "Refresh" })).toBeEnabled();
    expect(props.onSessionExpired).not.toHaveBeenCalled();
  });

  it("ends the session when the backend rejects the token", async () => {
    const user = userEvent.setup();
    getCurrentUser.mockRejectedValue(new ApiError("Not authenticated", 401));
    const props = renderProfile();

    await refresh(user);

    await waitFor(() => expect(props.onSessionExpired).toHaveBeenCalledTimes(1));
  });

  it("ends the session without a request once the token has expired", async () => {
    const user = userEvent.setup();
    const props = renderProfile({
      session: { ...SESSION, expiresAt: new Date(Date.now() + 60000).toISOString() },
    });

    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 120000);
    try {
      await refresh(user);
    } finally {
      nowSpy.mockRestore();
    }

    expect(props.onSessionExpired).toHaveBeenCalledTimes(1);
    expect(getCurrentUser).not.toHaveBeenCalled();
  });

  it("isn't offered when the backend has no /users/me", () => {
    renderProfile({ profile: null });
    expect(screen.queryByRole("button", { name: "Refresh" })).not.toBeInTheDocument();
  });
});
