import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import RewardsPage, { OrganizerRewards, ProfileAchievements } from "./RewardsPage.jsx";
import {
  clearRewardsClientCache,
  getRewardsClient,
  rewardsMode,
} from "./rewards.js";
import { demoAwardPoints, resetDemoRewards } from "./rewardsDemo.js";

const SESSION = { token: "tok-a", userId: "42", userName: "Ada" };

beforeEach(() => {
  sessionStorage.clear();
  resetDemoRewards();
  clearRewardsClientCache();
  vi.stubEnv("DEV", true);
  vi.stubEnv("VITE_REWARDS_DEMO", "true");
  vi.stubEnv("VITE_REWARDS_API", "false");
});

describe("rewards client factory identity", () => {
  it("returns a stable client for the same session from the real factory", () => {
    expect(rewardsMode()).toBe("demo");
    const first = getRewardsClient(SESSION);
    const second = getRewardsClient(SESSION);
    expect(first).toBe(second);
    expect(getRewardsClient({ ...SESSION, userId: "99" })).not.toBe(first);
  });
});

describe("RewardsPage loading lifecycle", () => {
  it("settles after the initial load and does not flicker on ordinary rerenders", async () => {
    const view = render(
      <RewardsPage session={SESSION} onSessionExpired={vi.fn()} />
    );
    expect(screen.getByText(/Loading rewards/i)).toBeInTheDocument();
    expect(await screen.findByText(/earned points/i)).toBeInTheDocument();

    const listCalls = { count: 0 };
    const client = getRewardsClient(SESSION);
    const original = client.listRewards.bind(client);
    client.listRewards = async (...args) => {
      listCalls.count += 1;
      return original(...args);
    };

    // Rerender with a new onSessionExpired identity must not restart loading.
    view.rerender(<RewardsPage session={SESSION} onSessionExpired={vi.fn()} />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByText(/Loading rewards/i)).not.toBeInTheDocument();
    expect(listCalls.count).toBe(0);

    client.listRewards = original;
  });

  it("soft-refreshes without clearing content", async () => {
    const user = userEvent.setup();
    demoAwardPoints("42", 25, { badgeName: "Starter" });
    render(<RewardsPage session={SESSION} onSessionExpired={vi.fn()} />);
    const summary = await screen.findByLabelText(/Your points and badges/i);
    expect(summary).toHaveTextContent("25");
    await user.click(screen.getByRole("button", { name: /Refresh/i }));
    expect(screen.getByLabelText(/Your points and badges/i)).toHaveTextContent("25");
    await waitFor(() =>
      expect(screen.queryByText(/Refreshing balances/i)).not.toBeInTheDocument()
    );
  });

  it("loads the new account when the session user changes", async () => {
    demoAwardPoints("42", 40);
    const view = render(<RewardsPage session={SESSION} onSessionExpired={vi.fn()} />);
    expect(await screen.findByLabelText(/Your points and badges/i)).toHaveTextContent("40");

    view.rerender(
      <RewardsPage
        session={{ token: "tok-b", userId: "7", userName: "Bea" }}
        onSessionExpired={vi.fn()}
      />
    );
    expect(await screen.findByText(/Loading rewards/i)).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByLabelText(/Your points and badges/i)).toHaveTextContent("0")
    );
  });
});

describe("ProfileAchievements and OrganizerRewards", () => {
  it("loads profile achievements once with a stable factory client", async () => {
    demoAwardPoints("42", 15, { badgeName: "Starter" });
    const view = render(
      <ProfileAchievements session={SESSION} onSessionExpired={vi.fn()} />
    );
    expect(await screen.findByLabelText(/Your points and badges/i)).toHaveTextContent("15");
    view.rerender(<ProfileAchievements session={SESSION} onSessionExpired={vi.fn()} />);
    expect(screen.queryByText(/^Loading/)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Your points and badges/i)).toHaveTextContent("Starter");
  });

  it("lists organizer rewards without a loading loop", async () => {
    render(<OrganizerRewards session={SESSION} onSessionExpired={vi.fn()} />);
    expect(await screen.findByRole("button", { name: /Create reward/i })).toBeInTheDocument();
    expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument();
  });
});
