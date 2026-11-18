import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearProofClientCache,
  getProofClient,
  proofsMode,
  validateProofDraft,
  basicRequirements,
} from "./proofs.js";

function mockXhrSuccess(payload, status = 201) {
  function FakeXHR() {
    this.upload = { onprogress: null };
    this.status = status;
    this.responseText = JSON.stringify(payload);
  }
  FakeXHR.prototype.open = vi.fn();
  FakeXHR.prototype.setRequestHeader = vi.fn();
  FakeXHR.prototype.send = function send() {
    queueMicrotask(() => {
      this.upload.onprogress?.({ lengthComputable: true, loaded: 50, total: 100 });
      this.upload.onprogress?.({ lengthComputable: true, loaded: 100, total: 100 });
      this.onload();
    });
  };
  return FakeXHR;
}

describe("live proof adapter", () => {
  beforeEach(() => {
    clearProofClientCache();
    vi.stubEnv("DEV", true);
    vi.stubEnv("VITE_PROOFS_DEMO", "false");
    vi.stubEnv("VITE_PROOFS_API", "true");
    vi.stubEnv("VITE_MODERATION_API", "false");
    vi.stubEnv("VITE_API_BASE_URL", "http://api.test");
  });

  afterEach(() => {
    clearProofClientCache();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("uses live mode without enabling moderation", () => {
    expect(proofsMode()).toBe("live");
    const client = getProofClient({ token: "tok", userId: "7", userName: "Ada" });
    expect(client.isDemo).toBe(false);
  });

  it("uploads files then submits media_ids for a participation", async () => {
    const progress = [];
    vi.stubGlobal(
      "XMLHttpRequest",
      mockXhrSuccess({
        data: {
          type: "media",
          id: "42",
          attributes: {
            content_type: "image/png",
            kind: "photo",
            size_bytes: 12,
            uploaded_at: "2026-11-12T12:00:00Z",
          },
        },
      })
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, options) => {
        expect(url).toBe("http://api.test/participations/99/submissions");
        expect(options.method).toBe("POST");
        const body = JSON.parse(options.body);
        expect(body.media_ids).toEqual([42]);
        expect(body.text).toBe("Done.");
        return {
          ok: true,
          status: 201,
          json: async () => ({
            data: {
              type: "submissions",
              id: "7",
              attributes: {
                participation_id: "99",
                item_id: "5",
                user_id: "7",
                attempt_number: 1,
                text: "Done.",
                media: [
                  {
                    id: "42",
                    content_type: "image/png",
                    kind: "photo",
                    size_bytes: 12,
                  },
                ],
                status: "pending",
                submitted_at: "2026-11-12T12:00:00Z",
              },
            },
          }),
        };
      })
    );

    const client = getProofClient({ token: "tok", userId: "7", userName: "Ada" });
    const photo = new File([new Uint8Array(12)], "bag.png", { type: "image/png" });
    const submitted = await client.submitProof(
      "99",
      { text: "Done.", photos: [photo], video: null },
      (value) => progress.push(value)
    );
    expect(submitted.status).toBe("pending");
    expect(submitted.participationId).toBe("99");
    expect(submitted.photos[0].id).toBe("42");
    expect(submitted.photos[0].url).toBeNull();
    expect(progress.some((value) => value > 0)).toBe(true);
  });

  it("reads history and picks the latest attempt", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            {
              type: "submissions",
              id: "1",
              attributes: {
                participation_id: "99",
                item_id: "5",
                user_id: "7",
                attempt_number: 1,
                text: "First",
                media: [],
                status: "rejected",
                submitted_at: "2026-11-11T12:00:00Z",
              },
            },
            {
              type: "submissions",
              id: "2",
              attributes: {
                participation_id: "99",
                item_id: "5",
                user_id: "7",
                attempt_number: 2,
                text: "Second",
                media: [],
                status: "pending",
                submitted_at: "2026-11-12T12:00:00Z",
              },
            },
          ],
          meta: { count: 2 },
        }),
      }))
    );
    const client = getProofClient({ token: "tok", userId: "7", userName: "Ada" });
    const current = await client.getMySubmission("99");
    expect(current.id).toBe("2");
    expect(current.status).toBe("pending");
  });

  it("keeps basic requirements without inventing mandatory media", () => {
    const reqs = basicRequirements({
      proofInstructions: "Please include a photo of the bag.",
      pointValue: 40,
    });
    expect(reqs.requiresPhoto).toBe(false);
    expect(reqs.structuredRequirementsSupported).toBe(false);
    expect(
      validateProofDraft(reqs, {
        text: "Done",
        photos: [],
        video: null,
      })
    ).toEqual({});
  });

  it("maps structured requires_media_proof into draft validation", () => {
    const reqs = basicRequirements({
      proofInstructions: "Media required.",
      requiresTextProof: false,
      requiresMediaProof: true,
    });
    expect(reqs.requiresMedia).toBe(true);
    expect(
      validateProofDraft(reqs, { text: "", photos: [], video: null }).photos
    ).toMatch(/photo|video/i);
  });

  it("keeps successful uploads when a later upload fails so retry does not re-send them", async () => {
    let uploads = 0;
    function FakeXHR() {
      this.upload = { onprogress: null };
      this.status = 0;
      this.responseText = "";
    }
    FakeXHR.prototype.open = vi.fn();
    FakeXHR.prototype.setRequestHeader = vi.fn();
    FakeXHR.prototype.send = function send() {
      uploads += 1;
      queueMicrotask(() => {
        if (uploads === 1) {
          this.status = 201;
          this.responseText = JSON.stringify({
            data: {
              type: "media",
              id: "10",
              attributes: {
                content_type: "image/png",
                kind: "photo",
                size_bytes: 4,
                uploaded_at: "2026-11-18T12:00:00Z",
              },
            },
          });
          this.onload();
        } else {
          this.status = 0;
          this.onerror();
        }
      });
    };
    vi.stubGlobal("XMLHttpRequest", FakeXHR);
    const submitFetch = vi.fn();
    vi.stubGlobal("fetch", submitFetch);

    const client = getProofClient({ token: "tok", userId: "7", userName: "Ada" });
    const first = new File([new Uint8Array(4)], "a.png", { type: "image/png" });
    const second = new File([new Uint8Array(4)], "b.png", { type: "image/png" });
    await expect(
      client.submitProof("99", { text: "x", photos: [first, second], video: null })
    ).rejects.toMatchObject({ status: 0 });
    expect(submitFetch).not.toHaveBeenCalled();
    expect(uploads).toBe(2);

    // Retry: first file should reuse cached media id 10; only second uploads again.
    uploads = 0;
    FakeXHR.prototype.send = function send() {
      uploads += 1;
      queueMicrotask(() => {
        this.status = 201;
        this.responseText = JSON.stringify({
          data: {
            type: "media",
            id: "11",
            attributes: {
              content_type: "image/png",
              kind: "photo",
              size_bytes: 4,
              uploaded_at: "2026-11-18T12:01:00Z",
            },
          },
        });
        this.onload();
      });
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, options) => {
        const body = JSON.parse(options.body);
        expect(body.media_ids).toEqual([10, 11]);
        return {
          ok: true,
          status: 201,
          json: async () => ({
            data: {
              type: "submissions",
              id: "8",
              attributes: {
                participation_id: "99",
                item_id: "5",
                user_id: "7",
                attempt_number: 1,
                text: "x",
                media: [
                  { id: "10", content_type: "image/png", kind: "photo", size_bytes: 4 },
                  { id: "11", content_type: "image/png", kind: "photo", size_bytes: 4 },
                ],
                status: "pending",
                submitted_at: "2026-11-18T12:02:00Z",
              },
            },
          }),
        };
      })
    );
    const submitted = await client.submitProof("99", {
      text: "x",
      photos: [first, second],
      video: null,
    });
    expect(uploads).toBe(1);
    expect(submitted.photos.map((photo) => photo.id)).toEqual(["10", "11"]);
  });

  it("marks uncertain submit responses for history reconcile without clearing uploads", async () => {
    vi.stubGlobal(
      "XMLHttpRequest",
      mockXhrSuccess({
        data: {
          type: "media",
          id: "42",
          attributes: {
            content_type: "image/png",
            kind: "photo",
            size_bytes: 12,
            uploaded_at: "2026-11-12T12:00:00Z",
          },
        },
      })
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("network down");
      })
    );
    const client = getProofClient({ token: "tok", userId: "7", userName: "Ada" });
    const photo = new File([new Uint8Array(12)], "bag.png", { type: "image/png" });
    await expect(
      client.submitProof("99", { text: "Done.", photos: [photo], video: null })
    ).rejects.toMatchObject({ status: 0, reconcileHint: true });
  });

  it("marks upload-stage failures without reconcileHint so UI does not imply a submit", async () => {
    function FakeXHR() {
      this.upload = { onprogress: null };
      this.status = 0;
      this.responseText = "";
    }
    FakeXHR.prototype.open = vi.fn();
    FakeXHR.prototype.setRequestHeader = vi.fn();
    FakeXHR.prototype.send = function send() {
      queueMicrotask(() => {
        this.status = 0;
        this.onerror();
      });
    };
    vi.stubGlobal("XMLHttpRequest", FakeXHR);
    const submitFetch = vi.fn();
    vi.stubGlobal("fetch", submitFetch);
    const client = getProofClient({ token: "tok", userId: "7", userName: "Ada" });
    const photo = new File([new Uint8Array(4)], "a.png", { type: "image/png" });
    await expect(
      client.submitProof("99", { text: "x", photos: [photo], video: null })
    ).rejects.toMatchObject({ status: 0, uploadStage: true });
    expect(submitFetch).not.toHaveBeenCalled();
  });
});
