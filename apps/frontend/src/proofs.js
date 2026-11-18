// Proof submission and moderator review client.
// Live student proof: POST /uploads then POST /participations/{id}/submissions.
// Live moderation: GET/POST /moderation/submissions… (VITE_MODERATION_API).
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

export function proofsApiEnabled() {
  return import.meta.env.VITE_PROOFS_API === "true";
}

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

async function liveDocument(path, { method = "GET", body, token } = {}) {
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
  if (response.status === 204) return { data: null, meta: null };
  if (!data || !("data" in data)) {
    throw new ApiError("The server returned an unexpected response.", response.status);
  }
  return { data: data.data, meta: data.meta || null };
}

async function liveJson(path, options) {
  const document = await liveDocument(path, options);
  return document.data;
}

export async function fetchMediaObjectUrl(mediaId, token) {
  const base = apiBase();
  if (!base) {
    throw new ApiError("The API URL is not configured.", 0, {}, "api_not_configured");
  }
  let response;
  try {
    response = await fetch(`${base}/media/${encodeURIComponent(mediaId)}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  } catch {
    throw new ApiError(
      `Couldn't get a response from the server at ${base}. Check that the backend is running.`,
      0
    );
  }
  if (!response.ok) {
    throw new ApiError(
      `Couldn't load media (status ${response.status}).`,
      response.status,
      {},
      response.status === 403 ? "media_forbidden" : "media_not_found"
    );
  }
  const blob = await response.blob();
  return URL.createObjectURL(blob);
}

function mapMediaItem(media) {
  const contentType = media.content_type || media.contentType || "";
  const kind = media.kind || "";
  const path = media.url || null;
  return {
    id: String(media.id),
    // API returns a path like /media/{id}; never put JWTs in URLs — use fetchMediaObjectUrl.
    apiPath: path,
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
  const legacyPhotos = (a.photos || []).map((photo) => ({
    id: String(photo.id),
    apiPath: null,
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
        apiPath: null,
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

function mapQueueEntry(resource) {
  const a = resource.attributes || {};
  return {
    id: String(resource.id),
    participationId: a.participation_id != null ? String(a.participation_id) : "",
    itemId: a.item_id != null ? String(a.item_id) : "",
    itemTitle: a.item_title || "",
    submitterName: a.student_name || "",
    userId: a.user_id != null ? String(a.user_id) : "",
    attemptNumber: a.attempt_number ?? null,
    hasText: Boolean(a.has_text),
    mediaCount: a.media_count ?? 0,
    submittedAt: a.submitted_at || null,
    status: "pending",
  };
}

function mapSubmissionDetail(resource) {
  const a = resource.attributes || {};
  const student = a.student || {};
  const quest = a.quest || {};
  const questAttrs = quest.attributes || quest;
  const base = mapSubmission({
    id: resource.id,
    attributes: {
      ...a,
      item_id: quest.id || a.item_id,
      item_title: questAttrs.title,
      submitter_name: student.name,
      user_id: student.user_id,
    },
  });
  return {
    ...base,
    student: {
      userId: student.user_id != null ? String(student.user_id) : "",
      name: student.name || "",
    },
    quest: quest.id
      ? {
          id: String(quest.id),
          title: questAttrs.title || "",
          category: questAttrs.category || "",
          pointValue: questAttrs.point_value ?? null,
        }
      : null,
  };
}

function mapReview(resource) {
  const a = resource.attributes || {};
  const decision = a.decision || "";
  return {
    id: String(resource.id),
    type: "reviews",
    submissionId: a.submission_id != null ? String(a.submission_id) : "",
    participationId: a.participation_id != null ? String(a.participation_id) : "",
    reviewerId: a.reviewer_id != null ? String(a.reviewer_id) : "",
    decision,
    // UI helpers that previously read submission.status after approve/reject.
    status: decision,
    feedback: a.feedback || "",
    reviewedAt: a.reviewed_at || null,
    pointsAwarded: a.points_awarded ?? null,
    badgesAwarded: (a.badges_awarded || []).map((badge) => ({
      badgeId: String(badge.badge_id ?? badge.id ?? ""),
      name: badge.name || "",
      description: badge.description || "",
      awardedAt: badge.awarded_at || null,
    })),
  };
}

function pickCurrentSubmission(resources) {
  if (!Array.isArray(resources) || resources.length === 0) return null;
  return mapSubmission(resources[resources.length - 1]);
}

// Prefer structured catalogue flags when present (requires_text_proof / requires_media_proof).
export function requirementsFromItem(item) {
  const hasStructured =
    item?.requiresTextProof != null || item?.requiresMediaProof != null;
  const requiresText = Boolean(item?.requiresTextProof);
  const requiresMedia = Boolean(item?.requiresMediaProof);
  return {
    instructions: item?.proofInstructions || "",
    requiresText,
    requiresMedia,
    // Media may be photo or video; do not invent a separate mandatory video flag.
    requiresPhoto: requiresMedia,
    requiresVideo: false,
    maxMedia: PROOF_MAX_MEDIA,
    maxPhotos: PROOF_MAX_PHOTOS,
    maxPhotoBytes: PROOF_MAX_PHOTO_BYTES,
    maxVideoBytes: PROOF_MAX_VIDEO_BYTES,
    allowedPhotoTypes: PROOF_PHOTO_TYPES,
    allowedVideoTypes: PROOF_VIDEO_TYPES,
    pointValue: item?.pointValue ?? null,
    structuredRequirementsSupported: hasStructured,
  };
}

export function basicRequirements(item) {
  return requirementsFromItem({
    ...item,
    requiresTextProof: item?.requiresTextProof ?? null,
    requiresMediaProof: item?.requiresMediaProof ?? null,
  });
}

/** @deprecated Prefer requirementsFromItem. */
export function inferRequirements(item) {
  return requirementsFromItem(item);
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

  if (requirements.requiresMedia && mediaCount === 0) {
    errors.photos = "Add at least one photo or video.";
  } else if (requirements.requiresPhoto && !requirements.requiresMedia && photoList.length === 0) {
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

async function hydrateMediaUrls(submission, token) {
  if (!submission) return submission;
  const attach = async (entry) => {
    if (!entry || entry.url || !entry.id) return entry;
    try {
      const objectUrl = await fetchMediaObjectUrl(entry.id, token);
      return { ...entry, url: objectUrl, previewUnavailable: false, objectUrlOwned: true };
    } catch {
      return { ...entry, previewUnavailable: true };
    }
  };
  const photos = await Promise.all((submission.photos || []).map(attach));
  const video = submission.video ? await attach(submission.video) : null;
  return { ...submission, photos, video };
}

export function revokeSubmissionMediaUrls(submission) {
  if (!submission) return;
  for (const photo of submission.photos || []) {
    if (photo.objectUrlOwned && photo.url) URL.revokeObjectURL(photo.url);
  }
  if (submission.video?.objectUrlOwned && submission.video.url) {
    URL.revokeObjectURL(submission.video.url);
  }
}

function liveClient(session) {
  const token = session.token;
  const userId = String(session.userId);
  const uploadIds = new Map();

  return {
    isDemo: false,
    async requirementsForItem(item) {
      return requirementsFromItem(item);
    },
    async getMySubmission(participationId) {
      if (!participationId) return null;
      const data = await liveJson(
        `/participations/${encodeURIComponent(participationId)}/submissions`,
        { token }
      );
      const list = Array.isArray(data) ? data : data ? [data] : [];
      const current = pickCurrentSubmission(list);
      return hydrateMediaUrls(current, token);
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
        for (const key of [...uploadIds.keys()]) {
          if (key.startsWith(`${userId}|${participationId}|`)) uploadIds.delete(key);
        }
        return hydrateMediaUrls(mapSubmission(resource), token);
      } catch (error) {
        if (error.resultUnknown) {
          error.reconcileHint = true;
        }
        throw error;
      }
    },
    async listPending({ page = 1, pageSize = 20 } = {}) {
      if (!moderationApiEnabled()) return moderationUnavailable();
      const document = await liveDocument(
        `/moderation/submissions?page=${page}&page_size=${pageSize}`,
        { token }
      );
      const list = Array.isArray(document.data) ? document.data : document.data ? [document.data] : [];
      return {
        items: list.map(mapQueueEntry),
        page: document.meta?.page || {
          number: page,
          size: pageSize,
          totalItems: list.length,
          totalPages: 1,
        },
      };
    },
    async getModerationSubmission(id) {
      if (!moderationApiEnabled()) return moderationUnavailable();
      const detail = mapSubmissionDetail(
        await liveJson(`/moderation/submissions/${encodeURIComponent(id)}`, { token })
      );
      return hydrateMediaUrls(detail, token);
    },
    async approve(id) {
      if (!moderationApiEnabled()) return moderationUnavailable();
      return mapReview(
        await liveJson(`/moderation/submissions/${encodeURIComponent(id)}/approve`, {
          method: "POST",
          token,
        })
      );
    },
    async reject(id, feedback) {
      if (!moderationApiEnabled()) return moderationUnavailable();
      return mapReview(
        await liveJson(`/moderation/submissions/${encodeURIComponent(id)}/reject`, {
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
    getMySubmission: (itemOrParticipationId) =>
      demoGetMySubmission(itemOrParticipationId, actor.id),
    listMySubmissions: async (itemOrParticipationId) => {
      const one = await demoGetMySubmission(itemOrParticipationId, actor.id);
      return one ? [one] : [];
    },
    submitProof: (itemId, fields, onProgress) =>
      demoSubmitProof(itemId, fields, actor, onProgress),
    listPending: async () => {
      const items = await demoListPendingSubmissions();
      return {
        items,
        page: { number: 1, size: items.length || 20, totalItems: items.length, totalPages: 1 },
      };
    },
    getModerationSubmission: (id) => demoGetModerationSubmission(id),
    approve: (id) => demoApproveSubmission(id, actor),
    reject: (id, feedback) => demoRejectSubmission(id, feedback, actor),
  };
}

const proofClientCache = new Map();

export function clearProofClientCache() {
  proofClientCache.clear();
}

export function getProofClient(session) {
  if (!session?.userId || !session?.token) return null;
  const mode = proofsMode();
  if (mode === "unavailable") return null;
  const key = `${mode}|${session.userId}|${session.token}|${session.userName || ""}|mod:${moderationApiEnabled()}`;
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
