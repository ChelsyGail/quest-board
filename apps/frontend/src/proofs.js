// Proof submission and moderator review client.
// Live student proof: POST /uploads then POST /participations/{id}/submissions.
// Moderator routes are not on the server yet — demo-only or VITE_MODERATION_API.
import { ApiError } from "./api.js";
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

export const PROOF_TEXT_MAX = 5000;
export const PROOF_FEEDBACK_MAX = 2000;
export const PROOF_MAX_MEDIA = 5;
export const PROOF_MAX_PHOTOS = 5;
export const PROOF_MAX_PHOTO_BYTES = 10 * 1024 * 1024;
export const PROOF_MAX_VIDEO_BYTES = 100 * 1024 * 1024;
export const PROOF_PHOTO_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
];
export const PROOF_VIDEO_TYPES = ["video/mp4", "video/quicktime"];
export const PROOF_PREVIEWABLE_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
export const PROOF_PREVIEWABLE_VIDEO_TYPES = ["video/mp4", "video/quicktime"];

export function proofsDemoEnabled() {
  return import.meta.env.DEV === true && import.meta.env.VITE_PROOFS_DEMO === "true";
}

// Opt-in once the student proof backend is wired. Without it, and without the
// demo flag, the UI stays unavailable rather than probing missing routes.
export function proofsApiEnabled() {
  return import.meta.env.VITE_PROOFS_API === "true";
}

// Separate from student proof: moderation routes are not implemented yet.
export function moderationApiEnabled() {
  return import.meta.env.VITE_MODERATION_API === "true";
}

export function proofsMode() {
  if (proofsDemoEnabled()) return "demo";
  if (proofsApiEnabled()) return "live";
  return "unavailable";
}

function apiBase() {
  return (import.meta.env.VITE_API_BASE_URL || "").replace(/\/+$/, "");
}

async function liveJson(path, { method = "GET", body, token } = {}) {
  const base = apiBase();
  if (!base) {
    throw new ApiError("The API URL is not configured.", 0, {}, "api_not_configured");
  }
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers["Content-Type"] = "application/json";
  let response;
  try {
    response = await fetch(base + path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
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
  if (!data || !("data" in data)) {
    throw new ApiError("The server returned an unexpected response.", response.status);
  }
  return data.data;
}

function mapMediaItem(media) {
  const contentType = media.content_type || media.contentType || "";
  const kind = media.kind || "";
  return {
    id: String(media.id),
    url: null,
    name: media.name || `${kind || "file"} (${contentType || "unknown type"})`,
    size: media.size_bytes ?? media.size ?? 0,
    contentType,
    kind,
    previewUnavailable: true,
  };
}

function mapSubmission(resource) {
  const a = resource.attributes || {};
  const mediaList = Array.isArray(a.media) ? a.media : [];
  const photos = mediaList.filter((m) => m.kind === "photo").map(mapMediaItem);
  const videoRaw = mediaList.find((m) => m.kind === "video");
  // Legacy proposal shape (photos/video with urls) still maps for the demo.
  const legacyPhotos = (a.photos || []).map((photo) => ({
    id: String(photo.id),
    url: photo.url || null,
    name: photo.name || "photo",
    size: photo.size || 0,
    contentType: photo.type || photo.contentType || "",
    kind: "photo",
    previewUnavailable: !photo.url,
  }));
  const legacyVideo = a.video
    ? {
        id: String(a.video.id),
        url: a.video.url || null,
        name: a.video.name || "video",
        size: a.video.size || 0,
        contentType: a.video.type || a.video.contentType || "",
        kind: "video",
        previewUnavailable: !a.video.url,
      }
    : null;

  return {
    id: String(resource.id),
    participationId: a.participation_id != null ? String(a.participation_id) : "",
    itemId: String(a.item_id ?? a.itemId ?? ""),
    attemptNumber: a.attempt_number ?? a.attemptNumber ?? null,
    status: a.status,
    text: a.text || "",
    photos: mediaList.length ? photos : legacyPhotos,
    video: mediaList.length ? (videoRaw ? mapMediaItem(videoRaw) : null) : legacyVideo,
    feedback: a.feedback || "",
    submittedAt: a.submitted_at || a.submittedAt || null,
    reviewedAt: a.reviewed_at || a.reviewedAt || null,
    itemTitle: a.item_title || a.itemTitle || "",
    submitterName: a.submitter_name || a.submitterName || "",
    requirements: a.requirements || null,
    awardedPoints: a.awarded_points ?? a.awardedPoints ?? null,
  };
}

function pickCurrentSubmission(resources) {
  if (!Array.isArray(resources) || resources.length === 0) return null;
  // History is oldest-first; the last attempt is authoritative.
  return mapSubmission(resources[resources.length - 1]);
}

// Documented basic rules when the catalogue only has free-text proof_instructions.
// Structured requires_photo / requires_video fields are not on the schema yet.
export function basicRequirements(item) {
  return {
    instructions: item?.proofInstructions || "",
    requiresText: false,
    requiresPhoto: false,
    requiresVideo: false,
    maxMedia: PROOF_MAX_MEDIA,
    maxPhotos: PROOF_MAX_PHOTOS,
    maxPhotoBytes: PROOF_MAX_PHOTO_BYTES,
    maxVideoBytes: PROOF_MAX_VIDEO_BYTES,
    allowedPhotoTypes: PROOF_PHOTO_TYPES,
    allowedVideoTypes: PROOF_VIDEO_TYPES,
    pointValue: item?.pointValue ?? null,
    structuredRequirementsSupported: false,
  };
}

/** @deprecated Prefer basicRequirements; kept for older tests that still import it. */
export function inferRequirements(item) {
  return basicRequirements(item);
}

export function validateProofDraft(requirements, { text, photos, video }) {
  const errors = {};
  const trimmed = (text || "").trim();
  const photoList = photos || [];
  const mediaCount = photoList.length + (video ? 1 : 0);
  const maxMedia = requirements.maxMedia || PROOF_MAX_MEDIA;

  if (requirements.requiresText && !trimmed) {
    errors.text = "Add the text your quest asks for.";
  } else if (trimmed.length > PROOF_TEXT_MAX) {
    errors.text = `Keep the text under ${PROOF_TEXT_MAX + 1} characters.`;
  }

  if (requirements.requiresPhoto && photoList.length === 0) {
    errors.photos = "Add at least one photo.";
  }
  if (photoList.length > (requirements.maxPhotos || PROOF_MAX_PHOTOS)) {
    errors.photos = `You can attach at most ${requirements.maxPhotos || PROOF_MAX_PHOTOS} photos.`;
  }
  if (mediaCount > maxMedia) {
    errors.photos = `You can attach at most ${maxMedia} files in total (photos and video together).`;
  }
  for (const file of photoList) {
    if (!(requirements.allowedPhotoTypes || PROOF_PHOTO_TYPES).includes(file.type)) {
      errors.photos = "Use JPEG, PNG, WebP, HEIC or HEIF photos.";
      break;
    }
    if (file.size > (requirements.maxPhotoBytes || PROOF_MAX_PHOTO_BYTES)) {
      errors.photos = "One of the photos is too large (max 10 MB).";
      break;
    }
  }
  if (requirements.requiresVideo && !video) {
    errors.video = "Add the video your quest asks for.";
  }
  if (video) {
    if (!(requirements.allowedVideoTypes || PROOF_VIDEO_TYPES).includes(video.type)) {
      errors.video = "Use an MP4 or QuickTime video.";
    } else if (video.size > (requirements.maxVideoBytes || PROOF_MAX_VIDEO_BYTES)) {
      errors.video = "That video is too large (max 100 MB).";
    }
  }
  if (!trimmed && mediaCount === 0) {
    errors.text = "Add a description, a photo or a video before submitting.";
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

export function canPreviewPhoto(fileOrType) {
  const type = typeof fileOrType === "string" ? fileOrType : fileOrType?.type;
  return PROOF_PREVIEWABLE_PHOTO_TYPES.includes(type);
}

export function canPreviewVideo(fileOrType) {
  const type = typeof fileOrType === "string" ? fileOrType : fileOrType?.type;
  return PROOF_PREVIEWABLE_VIDEO_TYPES.includes(type);
}

function fileCacheKey(userId, participationId, file) {
  return `${userId}|${participationId}|${file.name}|${file.size}|${file.lastModified}|${file.type}`;
}

function uploadRawFile(file, token, onFileProgress) {
  const base = apiBase();
  if (!base) {
    return Promise.reject(
      new ApiError("The API URL is not configured.", 0, {}, "api_not_configured")
    );
  }
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${base}/uploads`);
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && typeof onFileProgress === "function") {
        onFileProgress(event.loaded / event.total);
      }
    };
    xhr.onload = () => {
      let data = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        data = null;
      }
      if (xhr.status < 200 || xhr.status >= 300) {
        const errors = data?.errors || [];
        const message =
          errors.map((error) => error.detail || error.title).filter(Boolean).join(" ") ||
          `The server returned an unexpected error (status ${xhr.status}).`;
        reject(new ApiError(message, xhr.status, {}, errors[0]?.code || ""));
        return;
      }
      if (!data?.data?.id) {
        reject(new ApiError("The server returned an unexpected response.", xhr.status));
        return;
      }
      resolve(data.data);
    };
    xhr.onerror = () => {
      reject(
        new ApiError(
          `Couldn't get a response from the server at ${base}. Check that the backend is running.`,
          0
        )
      );
    };
    xhr.send(file);
  });
}

function moderationUnavailable() {
  return Promise.reject(
    new ApiError(
      "Moderator review isn't available on this server yet.",
      404,
      {},
      "moderation_unavailable"
    )
  );
}

function liveClient(session) {
  const token = session.token;
  const userId = String(session.userId);
  // Retained successful upload ids, scoped to account + participation + file identity.
  const uploadIds = new Map();

  return {
    isDemo: false,
    async requirementsForItem(item) {
      // No structured requirements route yet — use documented basic validation.
      return basicRequirements(item);
    },
    async getMySubmission(participationId) {
      if (!participationId) return null;
      const data = await liveJson(
        `/participations/${encodeURIComponent(participationId)}/submissions`,
        { token }
      );
      const list = Array.isArray(data) ? data : data ? [data] : [];
      return pickCurrentSubmission(list);
    },
    async listMySubmissions(participationId) {
      if (!participationId) return [];
      const data = await liveJson(
        `/participations/${encodeURIComponent(participationId)}/submissions`,
        { token }
      );
      const list = Array.isArray(data) ? data : data ? [data] : [];
      return list.map(mapSubmission);
    },
    async submitProof(participationId, { text, photos, video }, onProgress) {
      if (!participationId) {
        throw new ApiError(
          "Join this quest again so we can find your participation before submitting proof.",
          422,
          {},
          "participation_required"
        );
      }
      const files = [...(photos || [])];
      if (video) files.push(video);
      const mediaIds = [];
      const total = files.length;
      let completed = 0;

      for (const file of files) {
        const key = fileCacheKey(userId, participationId, file);
        let mediaId = uploadIds.get(key);
        if (!mediaId) {
          const resource = await uploadRawFile(file, token, (ratio) => {
            if (total === 0) return;
            const overall = ((completed + ratio) / total) * 90;
            onProgress?.(Math.max(1, Math.round(overall)));
          });
          mediaId = Number(resource.id);
          uploadIds.set(key, mediaId);
        }
        mediaIds.push(mediaId);
        completed += 1;
        if (total > 0) onProgress?.(Math.round((completed / total) * 90));
      }

      onProgress?.(total === 0 ? 50 : 95);
      try {
        const resource = await liveJson(
          `/participations/${encodeURIComponent(participationId)}/submissions`,
          {
            method: "POST",
            token,
            body: {
              text: (text || "").trim() || null,
              media_ids: mediaIds,
            },
          }
        );
        onProgress?.(100);
        // Successful attach — drop retained ids for this participation.
        for (const key of [...uploadIds.keys()]) {
          if (key.startsWith(`${userId}|${participationId}|`)) uploadIds.delete(key);
        }
        return mapSubmission(resource);
      } catch (error) {
        if (error.resultUnknown) {
          error.reconcileHint = true;
        }
        throw error;
      }
    },
    listPending: () =>
      moderationApiEnabled()
        ? liveJson("/moderation/submissions?status=pending", { token }).then((data) => {
            const list = Array.isArray(data) ? data : [data];
            return list.map(mapSubmission);
          })
        : moderationUnavailable(),
    getModerationSubmission: (id) =>
      moderationApiEnabled()
        ? liveJson(`/moderation/submissions/${id}`, { token }).then(mapSubmission)
        : moderationUnavailable(),
    approve: (id) =>
      moderationApiEnabled()
        ? liveJson(`/moderation/submissions/${id}/approve`, { method: "POST", token }).then(
            mapSubmission
          )
        : moderationUnavailable(),
    reject: (id, feedback) =>
      moderationApiEnabled()
        ? liveJson(`/moderation/submissions/${id}/reject`, {
            method: "POST",
            token,
            body: { feedback },
          }).then(mapSubmission)
        : moderationUnavailable(),
  };
}

function demoClient(session) {
  const actor = { id: session.userId, name: session.userName || "You", token: session.token };
  return {
    isDemo: true,
    requirementsForItem: (item) => demoRequirementsForItem(item),
    getMySubmission: (itemOrParticipationId) =>
      demoGetMySubmission(itemOrParticipationId, actor.id),
    listMySubmissions: async (itemOrParticipationId) => {
      const one = await demoGetMySubmission(itemOrParticipationId, actor.id);
      return one ? [one] : [];
    },
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
  const client = mode === "demo" ? demoClient(session) : liveClient(session);
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
