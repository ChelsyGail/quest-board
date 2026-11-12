import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { demoJoinItem, resetDemoQuests } from "./demoQuests.js";
import ProofSubmit from "./ProofSubmit.jsx";
import { resetDemoProofs } from "./proofsDemo.js";
import { resetDemoRewards } from "./rewardsDemo.js";

const SESSION = { token: "tok", userId: "7", userName: "Ada" };
const ITEM = {
  id: "demo-1",
  kind: "quest",
  title: "Campus cleanup",
  proofInstructions: "A photo of your full bag.",
  pointValue: 50,
};

describe("ProofSubmit", () => {
  beforeEach(() => {
    sessionStorage.clear();
    resetDemoProofs();
    resetDemoRewards();
    resetDemoQuests();
    vi.stubEnv("DEV", true);
    vi.stubEnv("VITE_PROOFS_DEMO", "false");
    vi.stubEnv("VITE_PROOFS_API", "false");
  });

  it("says proof submission is unavailable without the demo or API flag", () => {
    render(
      <ProofSubmit session={SESSION} item={ITEM} participationStatus="joined" />
    );
    expect(screen.getByRole("status")).toHaveTextContent(/aren't available/i);
  });

  it("submits proof in demo mode and shows Pending", async () => {
    vi.stubEnv("VITE_PROOFS_DEMO", "true");
    await demoJoinItem("demo-1", SESSION.userId);
    const user = userEvent.setup();
    const onSubmitted = vi.fn();
    render(
      <ProofSubmit
        session={SESSION}
        item={ITEM}
        participationStatus="joined"
        onSubmitted={onSubmitted}
      />
    );

    const text = await screen.findByLabelText(/Proof text/i);
    await user.type(text, "Bag filled.");
    const photo = new File([new Uint8Array(30)], "bag.png", { type: "image/png" });
    await user.upload(screen.getByLabelText("Proof photos"), photo);
    await user.click(screen.getByRole("button", { name: /Submit proof/i }));

    await waitFor(() => expect(onSubmitted).toHaveBeenCalled());
    expect(onSubmitted.mock.calls[0][0].status).toBe("pending");
    expect(await screen.findByText(/Pending/i)).toBeInTheDocument();
  });
});
