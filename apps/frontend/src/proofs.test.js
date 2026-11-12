import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  canSubmitProof,
  getProofClient,
  inferRequirements,
  proofsDemoEnabled,
  proofsMode,
  validateProofDraft,
} from "./proofs.js";
import { resetDemoProofs } from "./proofsDemo.js";
import { resetDemoQuests, demoJoinItem } from "./demoQuests.js";
import { resetDemoRewards, demoGetAchievements } from "./rewardsDemo.js";

describe("proof helpers", () => {
  it("keeps free-text instructions without inventing mandatory photo/video flags", () => {
    const photoQuest = inferRequirements({ proofInstructions: "Upload a photo of the bag." });
    expect(photoQuest.requiresPhoto).toBe(false);
    expect(photoQuest.requiresVideo).toBe(false);
    expect(photoQuest.structuredRequirementsSupported).toBe(false);
    expect(photoQuest.instructions).toMatch(/photo/i);

    const videoQuest = inferRequirements({ proofInstructions: "Send a short video clip." });
    expect(videoQuest.requiresVideo).toBe(false);
    expect(videoQuest.instructions).toMatch(/video/i);
  });

  it("validates basic text-or-media and combined file limits", () => {
    const requirements = {
      requiresText: false,
      requiresPhoto: false,
      requiresVideo: false,
      maxMedia: 5,
      maxPhotos: 5,
      maxPhotoBytes: 1000,
      maxVideoBytes: 1000,
      allowedPhotoTypes: ["image/png"],
      allowedVideoTypes: ["video/mp4"],
    };
    expect(validateProofDraft(requirements, { text: "", photos: [], video: null }).text).toMatch(
      /description|photo|video/i
    );
    const photo = new File([new Uint8Array(10)], "shot.png", { type: "image/png" });
    expect(
      Object.keys(validateProofDraft(requirements, { text: "Done", photos: [photo], video: null }))
    ).toEqual([]);
    const gif = new File([new Uint8Array(10)], "shot.gif", { type: "image/gif" });
    expect(
      validateProofDraft(requirements, { text: "Done", photos: [gif], video: null }).photos
    ).toMatch(/JPEG|PNG|WebP|HEIC/i);
  });

  it("allows submit only when joined or rejected", () => {
    expect(canSubmitProof("joined")).toBe(true);
    expect(canSubmitProof("rejected")).toBe(true);
    expect(canSubmitProof("pending")).toBe(false);
    expect(canSubmitProof("approved")).toBe(false);
  });
});

describe("proof demo adapter", () => {
  beforeEach(() => {
    sessionStorage.clear();
    resetDemoProofs();
    resetDemoRewards();
    resetDemoQuests();
    vi.stubEnv("DEV", true);
    vi.stubEnv("VITE_PROOFS_DEMO", "true");
    vi.stubEnv("VITE_PROOFS_API", "false");
  });

  it("is off unless DEV and VITE_PROOFS_DEMO are both on", () => {
    vi.stubEnv("VITE_PROOFS_DEMO", "false");
    expect(proofsDemoEnabled()).toBe(false);
    expect(proofsMode()).toBe("unavailable");
    vi.stubEnv("VITE_PROOFS_DEMO", "true");
    expect(proofsDemoEnabled()).toBe(true);
    expect(proofsMode()).toBe("demo");
  });

  it("submits proof to pending, awards points on approve, and supports reject/resubmit", async () => {
    const student = { id: "7", name: "Student", token: "tok" };
    const moderator = { id: "9", name: "Mod", token: "tok" };
    await demoJoinItem("demo-1", student.id);

    const client = getProofClient({ token: "tok", userId: student.id, userName: student.name });
    expect(client.isDemo).toBe(true);

    const item = { id: "demo-1", kind: "quest", title: "Cleanup", proofInstructions: "A photo.", pointValue: 50 };
    const photo = new File([new Uint8Array(20)], "bag.png", { type: "image/png" });
    const submitted = await client.submitProof(item.id, {
      text: "Bag is full.",
      photos: [photo],
      video: null,
    });
    expect(submitted.status).toBe("pending");

    const again = await client.submitProof(item.id, {
      text: "Again",
      photos: [photo],
      video: null,
    }).catch((error) => error);
    expect(again.code).toBe("already_submitted");

    const mod = getProofClient({ token: "tok", userId: moderator.id, userName: moderator.name });
    const approved = await mod.approve(submitted.id);
    expect(approved.status).toBe("approved");
    const achievements = await demoGetAchievements(student.id);
    expect(achievements.earnedPoints).toBe(50);
    expect(achievements.spendablePoints).toBe(50);

    // New quest path for reject/resubmit (demo-4 is published and not pre-joined).
    await demoJoinItem("demo-4", student.id);
    const second = await client.submitProof(
      "demo-4",
      { text: "First try", photos: [photo], video: null }
    );
    const rejected = await mod.reject(second.id, "Add a clearer photo.");
    expect(rejected.status).toBe("rejected");
    expect(rejected.feedback).toMatch(/clearer/);
    const resubmitted = await client.submitProof(
      "demo-4",
      { text: "Second try", photos: [photo], video: null }
    );
    expect(resubmitted.status).toBe("pending");
  });

  it("refuses self-review", async () => {
    const student = { id: "7", name: "Student", token: "tok" };
    await demoJoinItem("demo-1", student.id);
    const client = getProofClient({ token: "tok", userId: student.id, userName: student.name });
    const photo = new File([new Uint8Array(20)], "bag.png", { type: "image/png" });
    const submitted = await client.submitProof("demo-1", {
      text: "Done",
      photos: [photo],
      video: null,
    });
    await expect(client.approve(submitted.id)).rejects.toMatchObject({
      code: "cannot_review_own_submission",
    });
  });
});
