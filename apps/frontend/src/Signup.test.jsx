import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  createRoleRequest,
  listMyRoleRequests,
  login,
  registerUser,
  roleRequestsEnabled,
} from "./api.js";
import Signup from "./Signup.jsx";

vi.mock("./api.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    createRoleRequest: vi.fn(),
    listMyRoleRequests: vi.fn(),
    roleRequestsEnabled: vi.fn(),
    login: vi.fn(),
    registerUser: vi.fn(),
  };
});

const PASSWORD = "  correct horse  ";
const SESSION = { token: "tok", userId: "7", expiresAt: "2099-01-01T00:00:00Z" };
const USER = { id: "7", name: "Ada", email: "ada@aup.edu" };

function renderSignup() {
  const props = {
    onAuthenticated: vi.fn(),
    onAccountCreated: vi.fn(),
    onBackToLogin: vi.fn(),
  };
  render(<Signup {...props} />);
  return props;
}

async function fillForm(user, { name = "  Ada  ", email = " ada@aup.edu ", password = PASSWORD, confirm = password } = {}) {
  if (name) await user.type(screen.getByLabelText("Name"), name);
  if (email) await user.type(screen.getByLabelText("Email"), email);
  if (password) await user.type(screen.getByLabelText("Password"), password);
  if (confirm) await user.type(screen.getByLabelText("Confirm password"), confirm);
}

const submit = (user) => user.click(screen.getByRole("button", { name: "Sign up" }));

beforeEach(() => {
  vi.resetAllMocks();
  roleRequestsEnabled.mockReturnValue(false);
});

describe("Signup validation (QB-167)", () => {
  it("makes no request for invalid input and keeps what was typed", async () => {
    const user = userEvent.setup();
    renderSignup();

    await fillForm(user, { name: "", email: "not-an-email", password: "short", confirm: "other" });
    await submit(user);

    expect(screen.getByText("Please enter your name.")).toBeInTheDocument();
    expect(screen.getByText("Please enter a valid email address.")).toBeInTheDocument();
    expect(screen.getByText("Password must be at least 12 characters.")).toBeInTheDocument();
    expect(screen.getByText("Passwords do not match.")).toBeInTheDocument();
    expect(registerUser).not.toHaveBeenCalled();
    expect(login).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Email")).toHaveValue("not-an-email");
    expect(screen.getByLabelText("Password")).toHaveValue("short");
  });

  it("rejects passwords over 128 characters without a request", async () => {
    const user = userEvent.setup();
    renderSignup();

    const longPassword = "a".repeat(129);
    await fillForm(user, { password: longPassword });
    await submit(user);

    expect(screen.getByText("Password must be at most 128 characters.")).toBeInTheDocument();
    expect(registerUser).not.toHaveBeenCalled();
  });

  it("does not trim passwords: spaces count toward the length", async () => {
    const user = userEvent.setup();
    renderSignup();

    // 11 characters including spaces: too short, even though it looks padded.
    await fillForm(user, { password: "   abcde   " });
    await submit(user);

    expect(screen.getByText("Password must be at least 12 characters.")).toBeInTheDocument();
    expect(registerUser).not.toHaveBeenCalled();
  });

  it("trims name and email, sends the password unchanged, and never sends roles", async () => {
    const user = userEvent.setup();
    registerUser.mockResolvedValue(USER);
    login.mockResolvedValue(SESSION);
    const props = renderSignup();

    await fillForm(user);
    await submit(user);

    await waitFor(() => expect(props.onAuthenticated).toHaveBeenCalledWith(SESSION, "Your account was created."));
    expect(registerUser).toHaveBeenCalledTimes(1);
    expect(registerUser.mock.calls[0]).toEqual(["Ada", "ada@aup.edu", PASSWORD]);
    expect(login).toHaveBeenCalledWith("ada@aup.edu", PASSWORD);
    expect(createRoleRequest).not.toHaveBeenCalled();
  });

  it("prevents duplicate submissions while the request is in flight", async () => {
    const user = userEvent.setup();
    let finish;
    registerUser.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    login.mockResolvedValue(SESSION);
    renderSignup();

    await fillForm(user);
    await submit(user);
    const button = screen.getByRole("button", { name: "Creating account…" });
    expect(button).toBeDisabled();
    await user.click(button);
    await user.keyboard("{Enter}");

    expect(registerUser).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Back to login" })).toBeDisabled();
    finish(USER);
    await waitFor(() => expect(login).toHaveBeenCalledTimes(1));
  });

  it("shows an email conflict next to the email field and keeps the input", async () => {
    const user = userEvent.setup();
    registerUser.mockRejectedValue(
      new ApiError("Email: A user with this email already exists.", 409, {
        email: "A user with this email already exists.",
      })
    );
    renderSignup();

    await fillForm(user);
    await submit(user);

    expect(await screen.findByText("A user with this email already exists.")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveClass("invalid");
    expect(screen.getByRole("alert")).toHaveTextContent("Please fix the highlighted fields.");
    expect(screen.getByLabelText("Email")).toHaveValue("ada@aup.edu");
    expect(screen.getByLabelText("Password")).toHaveValue(PASSWORD);
    expect(screen.getByRole("button", { name: "Sign up" })).toBeEnabled();
    expect(login).not.toHaveBeenCalled();
  });

  it("maps backend validation errors to the matching fields", async () => {
    const user = userEvent.setup();
    registerUser.mockRejectedValue(
      new ApiError("Name: Too long Password: Too weak", 422, {
        name: "Too long",
        password: "Too weak",
      })
    );
    renderSignup();

    await fillForm(user);
    await submit(user);

    expect(await screen.findByText("Too long")).toBeInTheDocument();
    expect(screen.getByText("Too weak")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toHaveClass("invalid");
  });

  describe("when the connection fails while creating the account", () => {
    const lost = () => new ApiError("Couldn't get a response.", 0);

    it("checks by logging in, and continues if the account was created", async () => {
      const user = userEvent.setup();
      registerUser.mockRejectedValue(lost());
      login.mockResolvedValue(SESSION);
      const props = renderSignup();

      await fillForm(user);
      await submit(user);

      await waitFor(() =>
        expect(props.onAuthenticated).toHaveBeenCalledWith(SESSION, "Your account was created.")
      );
      expect(login).toHaveBeenCalledTimes(1);
      expect(login).toHaveBeenCalledWith("ada@aup.edu", PASSWORD);
      expect(registerUser).toHaveBeenCalledTimes(1);
    });

    it("says it couldn't confirm, and that logging in failed too, when the login is refused", async () => {
      const user = userEvent.setup();
      registerUser.mockRejectedValue(lost());
      login.mockRejectedValue(new ApiError("Email or password is incorrect.", 401));
      const props = renderSignup();

      await fillForm(user);
      await submit(user);

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "We couldn't confirm whether your account was created. Couldn't get a response. " +
          "Logging in with these details didn't work either, so you can try again."
      );
      expect(screen.getByLabelText("Name")).toHaveValue("  Ada  ");
      expect(screen.getByRole("button", { name: "Sign up" })).toBeEnabled();
      expect(props.onAuthenticated).not.toHaveBeenCalled();
    });

    it("suggests logging in before signing up again when the check can't run", async () => {
      const user = userEvent.setup();
      registerUser.mockRejectedValue(lost());
      login.mockRejectedValue(lost());
      renderSignup();

      await fillForm(user);
      await submit(user);

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent(
        "We couldn't confirm whether your account was created. Couldn't get a response. " +
          "Try logging in with this email and password before signing up again."
      );
      expect(alert).not.toHaveTextContent(/wasn't created|not created/);
    });
  });

  it("sends the user to login if the automatic login fails", async () => {
    const user = userEvent.setup();
    registerUser.mockResolvedValue(USER);
    login.mockRejectedValue(new ApiError("Server error", 500));
    const props = renderSignup();

    await fillForm(user);
    await submit(user);

    await waitFor(() => expect(props.onAccountCreated).toHaveBeenCalledWith("ada@aup.edu", ""));
    expect(props.onAuthenticated).not.toHaveBeenCalled();
  });
});

describe("Role requests at signup (QB-48)", () => {
  it("shows role requests as unavailable when they are not enabled", async () => {
    renderSignup();

    expect(screen.getByText(/isn't available yet/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Request Organizer access/)).toBeDisabled();
    expect(screen.getByLabelText(/Request Moderator access/)).toBeDisabled();
  });

  it("sends approval requests after the account is created and logged in", async () => {
    const user = userEvent.setup();
    roleRequestsEnabled.mockReturnValue(true);
    registerUser.mockResolvedValue(USER);
    login.mockResolvedValue(SESSION);
    createRoleRequest.mockResolvedValue({ id: "1", role: "organizer", status: "pending" });
    const props = renderSignup();

    expect(screen.getByText(/must be approved by a QuestBoard admin/)).toBeInTheDocument();
    await fillForm(user);
    await user.click(screen.getByLabelText(/Request Organizer access \(requires approval\)/));
    await user.type(screen.getByLabelText(/Why do you need this access/), "  I run the chess club ");
    await submit(user);

    await waitFor(() => expect(props.onAuthenticated).toHaveBeenCalled());
    expect(registerUser.mock.calls[0]).toEqual(["Ada", "ada@aup.edu", PASSWORD]);
    expect(createRoleRequest).toHaveBeenCalledTimes(1);
    expect(createRoleRequest).toHaveBeenCalledWith("organizer", "I run the chess club", "tok");
    const [, message] = props.onAuthenticated.mock.calls[0];
    expect(message).toBe(
      "Your account was created. Your Organizer access request was sent and is waiting for approval."
    );
  });

  it("reports each request honestly when some are not saved", async () => {
    const user = userEvent.setup();
    roleRequestsEnabled.mockReturnValue(true);
    registerUser.mockResolvedValue(USER);
    login.mockResolvedValue(SESSION);
    createRoleRequest
      .mockResolvedValueOnce({ id: "1", role: "organizer", status: "pending" })
      .mockRejectedValueOnce(new ApiError("Not Found", 404));
    const props = renderSignup();

    await fillForm(user);
    await user.click(screen.getByLabelText(/Request Organizer access/));
    await user.click(screen.getByLabelText(/Request Moderator access/));
    await submit(user);

    await waitFor(() => expect(props.onAuthenticated).toHaveBeenCalled());
    expect(createRoleRequest).toHaveBeenNthCalledWith(1, "organizer", "", "tok");
    expect(createRoleRequest).toHaveBeenNthCalledWith(2, "moderator", "", "tok");
    const [, message] = props.onAuthenticated.mock.calls[0];
    expect(message).toContain("Organizer access request was sent");
    expect(message).toMatch(/^Your account was created\. /);
    expect(message).toContain(
      "Moderator access request was not sent: the server doesn't accept access requests yet."
    );
    expect(message).toContain("You can request access again from your account page.");
  });

  it("does not claim a request was saved when the backend refuses it", async () => {
    const user = userEvent.setup();
    roleRequestsEnabled.mockReturnValue(true);
    registerUser.mockResolvedValue(USER);
    login.mockResolvedValue(SESSION);
    createRoleRequest.mockRejectedValue(
      new ApiError("Role: A pending request for this role already exists.", 409, {
        role: "A pending request for this role already exists.",
      })
    );
    const props = renderSignup();

    await fillForm(user);
    await user.click(screen.getByLabelText(/Request Moderator access/));
    await submit(user);

    await waitFor(() => expect(props.onAuthenticated).toHaveBeenCalled());
    const [, message] = props.onAuthenticated.mock.calls[0];
    expect(message).toMatch(/^Your account was created\. Your Moderator access request was not sent:/);
    expect(message).not.toMatch(/waiting for approval/);
  });

  describe("when the connection fails while sending a request", () => {
    async function signUpRequestingModerator() {
      const user = userEvent.setup();
      roleRequestsEnabled.mockReturnValue(true);
      registerUser.mockResolvedValue(USER);
      login.mockResolvedValue(SESSION);
      createRoleRequest.mockRejectedValue(new ApiError("Couldn't get a response.", 0));
      const props = renderSignup();

      await fillForm(user);
      await user.click(screen.getByLabelText(/Request Moderator access/));
      await submit(user);
      await waitFor(() => expect(props.onAuthenticated).toHaveBeenCalled());
      return props.onAuthenticated.mock.calls[0][1];
    }

    it("reports it as sent when the reloaded requests include it", async () => {
      listMyRoleRequests.mockResolvedValue([{ id: "3", role: "moderator", status: "pending" }]);

      const message = await signUpRequestingModerator();

      expect(listMyRoleRequests).toHaveBeenCalledWith("tok");
      expect(message).toBe(
        "Your account was created. " +
          "Your Moderator access request was sent and is waiting for approval."
      );
    });

    it("reports it as not sent when the reloaded requests don't include it", async () => {
      listMyRoleRequests.mockResolvedValue([]);

      const message = await signUpRequestingModerator();

      expect(message).toContain(
        "Your Moderator access request was not sent: the server didn't receive it."
      );
      expect(message).toContain("You can request access again from your account page.");
    });

    it("says it couldn't confirm the request when the requests can't be reloaded", async () => {
      listMyRoleRequests.mockRejectedValue(new ApiError("Couldn't get a response.", 0));

      const message = await signUpRequestingModerator();

      expect(message).toBe(
        "Your account was created. We couldn't confirm whether your Moderator access " +
          "request was sent: Couldn't get a response. Your account page shows which " +
          "requests arrived."
      );
    });
  });

  it("says no request was sent if the automatic login fails", async () => {
    const user = userEvent.setup();
    roleRequestsEnabled.mockReturnValue(true);
    registerUser.mockResolvedValue(USER);
    login.mockRejectedValue(new ApiError("Could not reach the server.", 0));
    const props = renderSignup();

    await fillForm(user);
    await user.click(screen.getByLabelText(/Request Organizer access/));
    await submit(user);

    await waitFor(() => expect(props.onAccountCreated).toHaveBeenCalled());
    expect(props.onAccountCreated.mock.calls[0][1]).toMatch(/access request was not sent/);
    expect(createRoleRequest).not.toHaveBeenCalled();
  });

  it("limits the reason to 500 characters without making a request", async () => {
    const user = userEvent.setup();
    roleRequestsEnabled.mockReturnValue(true);
    renderSignup();

    await fillForm(user);
    await user.click(screen.getByLabelText(/Request Organizer access/));
    await user.click(screen.getByLabelText(/Why do you need this access/));
    await user.paste("x".repeat(501));
    await submit(user);

    expect(screen.getByText("Reason must be at most 500 characters.")).toBeInTheDocument();
    expect(registerUser).not.toHaveBeenCalled();
  });
});
