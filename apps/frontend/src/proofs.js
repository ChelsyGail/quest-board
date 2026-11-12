// Proof submission and moderator review client.
// See docs/proof-moderation-api-proposal.md. There is no backend yet: usable UI runs
// only with VITE_PROOFS_DEMO=true on the DEV server. Live mode never falls back to demo.
import { ApiError, isMissingRoute } from "./api.js";
import {
  demoApproveSubmission,
  demoGetMySubmission,
  demoGetModerationSubmission,
  demoListPendingSubmissions,
  demoRejectSubmission,
  demoRequirementsForItem,
  demoSubmitProof,
  resetDemoProofs,
} from "./proofsDemo.js";

export { resetDemoProofs };

export const PROOF_TEXT_MAX = 4000;
export const PROOF_FEEDBACK_MAX = 2000;
export const PROOF_MAX_PHOTOS = 5;
export const PROOF_MAX_PHOTO_BYTES = 5 * 1024 * 1024;
export const PROOF_MAX_VIDEO_BYTES = 40 * 1024 * 1024;
export const PROOF_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
export const PROOF_VIDEO_TYPES = ["video/mp4", "video/webm", "video/quicktime"];

export function proofsDemoEnabled() {
  return import.meta.env.DEV === true && import.meta.env.VITE_PROOFS_DEMO === "true";
}

// Opt-in once the backend exists. Without it, and without the demo flag, the UI stays
// unavailable rather than probing missing routes on every visit.
export function proofsApiEnabled() {
  return import.meta.env.VITE_PROOFS_API === "true";
}

export function proofsMode() {
  if (proofsDemoEnabled()) return "demo";
  if (proofsApiEnabled()) return "live";
  return "unavailable";
}

function apiBase() {
  return (import.meta.env.VITE_API_BASE_URL || "").replace(/\/+$/, "");
}

async function liveJson(path, { method = "GET", body, token, formData } = {}) {
  const base = apiBase();
  if (!base) {
    throw new ApiError("The API URL is not configured.", 0, {}, "api_not_configured");
  }
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body && !formData) headers["Content-Type"] = "application/json";
  let response;
  try {
    response = await fetch(base + path, {
      method,
      headers,
      body: formData || (body ? JSON.stringify(body) : undefined),
    });
  } catch {
    throw new ApiError(
      `Couldn't get a response from the server at ${base}. Check that the backend is running.`,
      0
    );
  }
  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  if (!response.ok) {
    const errors = data?.errors || [];
    const message =
      errors.map((error) => error.detail || error.title).filter(Boolean).join(" ") ||
      `The server returned an unexpected error (status ${response.status}).`;
    throw new ApiError(message, response.status, {}, errors[0]?.code || "");
  }
  if (response.status === 204) return null;
  if (!data?.data) {
    throw new ApiError("The server returned an unexpected response.", response.status);
  }
  return data.data;
}

function mapSubmission(resource) {
  const a = resource.attributes || {};
  return {
    id: String(resource.id),
    itemId: String(a.item_id ?? a.itemId ?? ""),
    status: a.status,
    text: a.text || "",
    photos: (a.photos || []).map((photo) => ({
      id: String(photo.id),
      url: photo.url,
      name: photo.name || "photo",
      size: photo.size || 0,
    })),
    video: a.video
      ? {
          id: String(a.video.id),
          url: a.video.url,
          name: a.video.name || "video",
          size: a.video.size || 0,
        }
      : null,
    feedback: a.feedback || "",
    submittedAt: a.submitted_at || a.submittedAt || null,
    reviewedAt: a.reviewed_at || a.reviewedAt || null,
    itemTitle: a.item_title || a.itemTitle || "",
    submitterName: a.submitter_name || a.submitterName || "",
    requirements: a.requirements || null,
  };
}

export function inferRequirements(item) {
  const instructions = (item?.proofInstructions || "").toLowerCase();
  const mentionsPhoto = /photo|image|picture|pic\b/.test(instructions);
  const mentionsVideo = /video|clip|recording/.test(instructions);
  return {
    instructions: item?.proofInstructions || "",
    requiresText: true,
    requiresPhoto: mentionsPhoto || !mentionsVideo,
    requiresVideo: mentionsVideo,
    maxPhotos: PROOF_MAX_PHOTOS,
    maxPhotoBytes: PROOF_MAX_PHOTO_BYTES,
    maxVideoBytes: PROOF_MAX_VIDEO_BYTES,
    allowedPhotoTypes: PROOF_PHOTO_TYPES,
    allowedVideoTypes: PROOF_VIDEO_TYPES,
    pointValue: item?.pointValue ?? null,
  };
}

export function validateProofDraft(requirements, { text, photos, video }) {
  const errors = {};
  const trimmed = (text || "").trim();
  if (requirements.requiresText && !trimmed) {
    errors.text = "Add the text your quest asks for.";
  } else if (trimmed.length > PROOF_TEXT_MAX) {
    errors.text = `Keep the text under ${PROOF_TEXT_MAX + 1} characters.`;
  }
  const photoList = photos || [];
  if (requirements.requiresPhoto && photoList.length === 0) {
    errors.photos = "Add at least one photo.";
  }
  if (photoList.length > (requirements.maxPhotos || PROOF_MAX_PHOTOS)) {
    errors.photos = `You can attach at most ${requirements.maxPhotos || PROOF_MAX_PHOTOS} photos.`;
  }
  for (const file of photoList) {
    if (!(requirements.allowedPhotoTypes || PROOF_PHOTO_TYPES).includes(file.type)) {
      errors.photos = "Use JPEG, PNG, WebP or GIF photos.";
      break;
    }
    if (file.size > (requirements.maxPhotoBytes || PROOF_MAX_PHOTO_BYTES)) {
      errors.photos = "One of the photos is too large.";
      break;
    }
  }
  if (requirements.requiresVideo && !video) {
    errors.video = "Add the video your quest asks for.";
  }
  if (video) {
    if (!(requirements.allowedVideoTypes || PROOF_VIDEO_TYPES).includes(video.type)) {
      errors.video = "Use an MP4, WebM or QuickTime video.";
    } else if (video.size > (requirements.maxVideoBytes || PROOF_MAX_VIDEO_BYTES)) {
      errors.video = "That video is too large.";
    }
  }
  return errors;
}

export function submissionStatusLabel(status) {
  if (status === "pending") return "Pending";
  if (status === "approved") return "Approved";
  if (status === "rejected") return "Rejected";
  return status || "";
}

export function canSubmitProof(participationStatus) {
  return participationStatus === "joined" || participationStatus === "rejected";
}

function liveClient(token) {
  return {
    isDemo: false,
    async requirementsForItem(item) {
      try {
        const resource = await liveJson(`/items/${item.id}/proof-requirements`, { token });
        const a = resource.attributes || resource;
        return {
          instructions: a.instructions || item.proofInstructions || "",
          requiresText: Boolean(a.requires_text ?? a.requiresText ?? true),
          requiresPhoto: Boolean(a.requires_photo ?? a.requiresPhoto),
          requiresVideo: Boolean(a.requires_video ?? a.requiresVideo),
          maxPhotos: a.max_photos ?? a.maxPhotos ?? PROOF_MAX_PHOTOS,
          maxPhotoBytes: a.max_photo_bytes ?? a.maxPhotoBytes ?? PROOF_MAX_PHOTO_BYTES,
          maxVideoBytes: a.max_video_bytes ?? a.maxVideoBytes ?? PROOF_MAX_VIDEO_BYTES,
          allowedPhotoTypes: a.allowed_photo_types || PROOF_PHOTO_TYPES,
          allowedVideoTypes: a.allowed_video_types || PROOF_VIDEO_TYPES,
          pointValue: item.pointValue ?? null,
        };
      } catch (error) {
        if (isMissingRoute(error) || error.status === 404) return inferRequirements(item);
        throw error;
      }
    },
    async getMySubmission(itemId) {
      try {
        return mapSubmission(await liveJson(`/items/${itemId}/submissions/me`, { token }));
      } catch (error) {
        if (error.status === 404 && error.code === "submission_not_found") return null;
        throw error;
      }
    },
    async submitProof(itemId, { text, photos, video }, onProgress) {
      const formData = new FormData();
      if (text != null) formData.append("text", text);
      for (const photo of photos || []) formData.append("photos", photo);
      if (video) formData.append("video", video);
      onProgress?.(10);
      const resource = await liveJson(`/items/${itemId}/submissions`, {
        method: "POST",
        token,
        formData,
      });
      onProgress?.(100);
      return mapSubmission(resource);
    },
    async listPending() {
      const data = await liveJson("/moderation/submissions?status=pending", { token });
      const list = Array.isArray(data) ? data : [data];
      return list.map(mapSubmission);
    },
    async getModerationSubmission(id) {
      return mapSubmission(await liveJson(`/moderation/submissions/${id}`, { token }));
    },
    async approve(id) {
      return mapSubmission(
        await liveJson(`/moderation/submissions/${id}/approve`, { method: "POST", token })
      );
    },
    async reject(id, feedback) {
      return mapSubmission(
        await liveJson(`/moderation/submissions/${id}/reject`, {
          method: "POST",
          token,
          body: { feedback },
        })
      );
    },
  };
}

function demoClient(session) {
  const actor = { id: session.userId, name: session.userName || "You", token: session.token };
  return {
    isDemo: true,
    requirementsForItem: (item) => demoRequirementsForItem(item),
    getMySubmission: (itemId) => demoGetMySubmission(itemId, actor.id),
    submitProof: (itemId, fields, onProgress) =>
      demoSubmitProof(itemId, fields, actor, onProgress),
    listPending: () => demoListPendingSubmissions(),
    getModerationSubmission: (id) => demoGetModerationSubmission(id),
    approve: (id) => demoApproveSubmission(id, actor),
    reject: (id, feedback) => demoRejectSubmission(id, feedback, actor),
  };
}

// Same session + mode → same client object (avoids effect loops when deps include client).
const proofClientCache = new Map();

export function clearProofClientCache() {
  proofClientCache.clear();
}

// null when neither the demo nor a live API flag is on.
export function getProofClient(session) {
  if (!session?.userId || !session?.token) return null;
  const mode = proofsMode();
  if (mode === "unavailable") return null;
  const key = `${mode}|${session.userId}|${session.token}|${session.userName || ""}`;
  const cached = proofClientCache.get(key);
  if (cached) return cached;
  const client = mode === "demo" ? demoClient(session) : liveClient(session.token);
  proofClientCache.set(key, client);
  if (proofClientCache.size > 24) {
    const oldest = proofClientCache.keys().next().value;
    proofClientCache.delete(oldest);
  }
  return client;
}

export function proofsUnavailableMessage() {
  return "Proof submission and review aren't available on this server yet.";
}
