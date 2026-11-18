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
    await user.click(screen.getByRole("button", { name: /^Submit proof$/i }));
    expect(screen.getByRole("alertdialog")).toHaveTextContent(/after-submission/i);
    await user.click(screen.getByRole("button", { name: /Confirm submit/i }));

    await waitFor(() => expect(onSubmitted).toHaveBeenCalled());
    expect(onSubmitted.mock.calls[0][0].status).toBe("pending");
    expect(await screen.findByText(/Pending review/i)).toBeInTheDocument();
  });

  it("keeps the draft when confirmation is cancelled", async () => {
    vi.stubEnv("VITE_PROOFS_DEMO", "true");
    await demoJoinItem("demo-1", SESSION.userId);
    const user = userEvent.setup();
    render(
      <ProofSubmit session={SESSION} item={ITEM} participationStatus="joined" />
    );
    const text = await screen.findByLabelText(/Proof text/i);
    await user.type(text, "Keep this draft.");
    const photo = new File([new Uint8Array(30)], "bag.png", { type: "image/png" });
    await user.upload(screen.getByLabelText("Proof photos"), photo);
    await user.click(screen.getByRole("button", { name: /^Submit proof$/i }));
    await user.click(screen.getByRole("button", { name: /Cancel/i }));
    expect(screen.getByLabelText(/Proof text/i)).toHaveValue("Keep this draft.");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("labels structured media as photo or video required", async () => {
    vi.stubEnv("VITE_PROOFS_DEMO", "true");
    await demoJoinItem("demo-1", SESSION.userId);
    render(
      <ProofSubmit
        session={SESSION}
        item={{
          ...ITEM,
          requiresTextProof: true,
          requiresMediaProof: true,
          proofInstructions: "Text and media.",
        }}
        participationStatus="joined"
      />
    );
    const reqs = await screen.findByLabelText(/Proof requirements/i);
    expect(reqs).toHaveTextContent(/Photo or video/i);
    expect(reqs).toHaveTextContent(/Required/i);
    expect(reqs.textContent).not.toMatch(/\bPhoto\s+Required\b/);
  });
});
