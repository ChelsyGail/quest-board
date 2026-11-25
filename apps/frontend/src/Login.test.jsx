import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./api.js", async () => {
  const actual = await vi.importActual("./api.js");
  return {
    ...actual,
    login: vi.fn(),
  };
});

import { classroomDemoEnabled, isValidLoginIdentifier, login } from "./api.js";
import Login from "./Login.jsx";

describe("isValidLoginIdentifier", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("always accepts normal emails", () => {
    expect(isValidLoginIdentifier("maya.chen@aup.edu")).toBe(true);
  });

  it("rejects aliases when classroom demo is off", () => {
    vi.stubEnv("VITE_CLASSROOM_DEMO", "false");
    expect(classroomDemoEnabled()).toBe(false);
    expect(isValidLoginIdentifier("admin")).toBe(false);
    expect(isValidLoginIdentifier("mod")).toBe(false);
  });

  it("accepts admin/mod aliases only when classroom demo is on", () => {
    vi.stubEnv("VITE_CLASSROOM_DEMO", "true");
    expect(classroomDemoEnabled()).toBe(true);
    expect(isValidLoginIdentifier("admin")).toBe(true);
    expect(isValidLoginIdentifier("MOD")).toBe(true);
  });
});

describe("Login form", () => {
  beforeEach(() => {
    login.mockReset();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects a non-email identifier when classroom demo is disabled", async () => {
    vi.stubEnv("VITE_CLASSROOM_DEMO", "false");
    const user = userEvent.setup();
    render(<Login onAuthenticated={vi.fn()} onShowSignup={vi.fn()} />);
    await user.type(screen.getByLabelText("Email"), "admin");
    await user.type(screen.getByLabelText("Password"), "admin");
    await user.click(screen.getByRole("button", { name: "Log in" }));
    expect(screen.getByText("Please enter a valid email address.")).toBeInTheDocument();
    expect(login).not.toHaveBeenCalled();
  });

  it("allows admin alias through the form when classroom demo is enabled", async () => {
    vi.stubEnv("VITE_CLASSROOM_DEMO", "true");
    const user = userEvent.setup();
    login.mockResolvedValue({
      token: "tok",
      userId: "9",
      expiresAt: new Date().toISOString(),
    });
    const onAuthenticated = vi.fn();
    render(<Login onAuthenticated={onAuthenticated} onShowSignup={vi.fn()} />);
    await user.type(screen.getByLabelText("Email"), "admin");
    await user.type(screen.getByLabelText("Password"), "admin");
    await user.click(screen.getByRole("button", { name: "Log in" }));
    await vi.waitFor(() => expect(login).toHaveBeenCalledWith("admin", "admin"));
  });

  it("does not enforce the 12-character signup password minimum on login", async () => {
    vi.stubEnv("VITE_CLASSROOM_DEMO", "false");
    const user = userEvent.setup();
    login.mockResolvedValue({
      token: "tok",
      userId: "1",
      expiresAt: new Date().toISOString(),
    });
    render(<Login onAuthenticated={vi.fn()} onShowSignup={vi.fn()} />);
    await user.type(screen.getByLabelText("Email"), "maya.chen@aup.edu");
    await user.type(screen.getByLabelText("Password"), "short");
    await user.click(screen.getByRole("button", { name: "Log in" }));
    await vi.waitFor(() =>
      expect(login).toHaveBeenCalledWith("maya.chen@aup.edu", "short")
    );
  });
});
