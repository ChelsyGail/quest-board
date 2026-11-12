// Dev-only proof/moderation sample store (this tab only). See docs/proof-moderation-api-proposal.md.
// Deliberately does not import ./proofs.js (that module imports this one).
import { demoGetItemSync, demoSetParticipationStatus } from "./demoQuests.js";
import { demoAwardPoints } from "./rewardsDemo.js";

const STORAGE_KEY = "questboard.demo.proofs.v1";
const FEEDBACK_MAX = 2000;
const MAX_PHOTOS = 5;
const MAX_MEDIA = 5;
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
const PHOTO_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
];
const VIDEO_TYPES = ["video/mp4", "video/quicktime"];

function delay(result, ms = 220) {
  return new Promise((resolve) => setTimeout(() => resolve(result), ms));
}

function fail(message, status, code) {
  return Promise.reject(Object.assign(new Error(message), { status, code, fieldErrors: {} }));
}

function readStore() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // Fresh store below.
  }
  const store = { nextId: 1, submissions: [] };
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  return store;
}

function writeStore(store) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

export function resetDemoProofs() {
  sessionStorage.removeItem(STORAGE_KEY);
}

function objectUrlFor(file) {
  if (!file) return null;
  if (typeof URL !== "undefined" && file instanceof Blob) {
    return URL.createObjectURL(file);
  }
  return `demo-file://${file.name || "file"}`;
}

function serializeFiles(photos, video) {
  return {
    photos: (photos || []).map((file, index) => ({
      id: `photo-${index}-${file.name}`,
      url: objectUrlFor(file),
      name: file.name,
      size: file.size,
      type: file.type,
    })),
    video: video
      ? {
          id: `video-${video.name}`,
          url: objectUrlFor(video),
          name: video.name,
          size: video.size,
          type: video.type,
        }
      : null,
  };
}

export function demoRequirementsForItem(item) {
  // Demo keeps soft hints from instruction text for a richer mock; live mode
  // uses basicRequirements and does not invent mandatory photo/video flags.
  const instructions = (item?.proofInstructions || "").toLowerCase();
  const mentionsPhoto = /photo|image|picture|pic\b/.test(instructions);
  const mentionsVideo = /video|clip|recording/.test(instructions);
  return {
    instructions: item?.proofInstructions || "",
    requiresText: true,
    requiresPhoto: mentionsPhoto || !mentionsVideo,
    requiresVideo: mentionsVideo,
    maxMedia: MAX_MEDIA,
    maxPhotos: MAX_PHOTOS,
    maxPhotoBytes: MAX_PHOTO_BYTES,
    maxVideoBytes: MAX_VIDEO_BYTES,
    allowedPhotoTypes: PHOTO_TYPES,
    allowedVideoTypes: VIDEO_TYPES,
    pointValue: item?.pointValue ?? null,
    structuredRequirementsSupported: false,
  };
}

function validateDraft(requirements, { text, photos, video }) {
  const errors = {};
  const trimmed = (text || "").trim();
  const photoList = photos || [];
  const mediaCount = photoList.length + (video ? 1 : 0);
  if (requirements.requiresText && !trimmed) errors.text = "Add the text your quest asks for.";
  if (requirements.requiresPhoto && !photoList.length) errors.photos = "Add at least one photo.";
  if (photoList.length > requirements.maxPhotos) {
    errors.photos = `You can attach at most ${requirements.maxPhotos} photos.`;
  }
  if (mediaCount > (requirements.maxMedia || MAX_MEDIA)) {
    errors.photos = `You can attach at most ${requirements.maxMedia || MAX_MEDIA} files in total (photos and video together).`;
  }
  for (const file of photoList) {
    if (!requirements.allowedPhotoTypes.includes(file.type)) {
      errors.photos = "Use JPEG, PNG, WebP, HEIC or HEIF photos.";
      break;
    }
    if (file.size > requirements.maxPhotoBytes) {
      errors.photos = "One of the photos is too large (max 10 MB).";
      break;
    }
  }
  if (requirements.requiresVideo && !video) errors.video = "Add the video your quest asks for.";
  if (video) {
    if (!requirements.allowedVideoTypes.includes(video.type)) {
      errors.video = "Use an MP4 or QuickTime video.";
    } else if (video.size > requirements.maxVideoBytes) {
      errors.video = "That video is too large (max 100 MB).";
    }
  }
  if (!trimmed && mediaCount === 0) {
    errors.text = "Add a description, a photo or a video before submitting.";
  }
  return errors;
}

export async function demoGetMySubmission(itemId, userId) {
  const store = readStore();
  const mine = store.submissions
    .filter((entry) => entry.itemId === String(itemId) && entry.userId === String(userId))
    .sort((a, b) => Date.parse(b.submittedAt) - Date.parse(a.submittedAt));
  return delay(mine[0] ? { ...mine[0] } : null);
}

export async function demoSubmitProof(itemId, { text, photos, video }, actor, onProgress) {
  const item = demoGetItemSync(itemId);
  if (!item || item.kind !== "quest") {
    return fail("This quest is not available.", 404, "item_not_found");
  }
  const requirements = demoRequirementsForItem(item);
  const errors = validateDraft(requirements, { text, photos, video });
  if (Object.keys(errors).length) {
    const error = Object.assign(new Error("Please fix the highlighted fields."), {
      status: 422,
      code: "validation_error",
      fieldErrors: errors,
    });
    return Promise.reject(error);
  }

  const store = readStore();
  const existing = store.submissions.find(
    (entry) =>
      entry.itemId === String(itemId) &&
      entry.userId === String(actor.id) &&
      (entry.status === "pending" || entry.status === "approved")
  );
  if (existing) {
    return fail("You already have a submission for this quest.", 409, "already_submitted");
  }

  onProgress?.(35);
  await delay(null, 120);
  onProgress?.(70);

  const media = serializeFiles(photos, video);
  const submission = {
    id: String(store.nextId++),
    itemId: String(itemId),
    userId: String(actor.id),
    submitterName: actor.name || "Student",
    itemTitle: item.title,
    status: "pending",
    text: (text || "").trim(),
    photos: media.photos,
    video: media.video,
    feedback: "",
    submittedAt: new Date().toISOString(),
    reviewedAt: null,
    requirements,
    pointValue: item.pointValue ?? 0,
  };
  store.submissions.push(submission);
  writeStore(store);
  demoSetParticipationStatus(actor.id, itemId, "pending");
  onProgress?.(100);
  return delay({ ...submission });
}

export async function demoListPendingSubmissions() {
  const store = readStore();
  return delay(
    store.submissions
      .filter((entry) => entry.status === "pending")
      .sort((a, b) => Date.parse(a.submittedAt) - Date.parse(b.submittedAt))
      .map((entry) => ({ ...entry }))
  );
}

export async function demoGetModerationSubmission(id) {
  const store = readStore();
  const submission = store.submissions.find((entry) => entry.id === String(id));
  if (!submission) return fail("Submission not found.", 404, "submission_not_found");
  return delay({ ...submission });
}

export async function demoApproveSubmission(id, actor) {
  const store = readStore();
  const submission = store.submissions.find((entry) => entry.id === String(id));
  if (!submission) return fail("Submission not found.", 404, "submission_not_found");
  if (submission.userId === String(actor.id)) {
    return fail("You can't review your own submission.", 403, "cannot_review_own_submission");
  }
  if (submission.status !== "pending") {
    return fail("This submission was already reviewed.", 409, "already_reviewed");
  }
  submission.status = "approved";
  submission.reviewedAt = new Date().toISOString();
  submission.reviewerId = String(actor.id);
  submission.awardedPoints = submission.pointValue || 0;
  writeStore(store);
  demoSetParticipationStatus(submission.userId, submission.itemId, "approved");
  demoAwardPoints(submission.userId, submission.pointValue || 0, {
    reason: `Approved: ${submission.itemTitle}`,
    badgeName: "Quest cleared",
  });
  return delay({ ...submission });
}

export async function demoRejectSubmission(id, feedback, actor) {
  const note = (feedback || "").trim();
  if (!note) return fail("Add feedback so the student knows what to fix.", 422, "feedback_required");
  if (note.length > FEEDBACK_MAX) {
    return fail(`Keep feedback under ${FEEDBACK_MAX + 1} characters.`, 422, "feedback_too_long");
  }
  const store = readStore();
  const submission = store.submissions.find((entry) => entry.id === String(id));
  if (!submission) return fail("Submission not found.", 404, "submission_not_found");
  if (submission.userId === String(actor.id)) {
    return fail("You can't review your own submission.", 403, "cannot_review_own_submission");
  }
  if (submission.status !== "pending") {
    return fail("This submission was already reviewed.", 409, "already_reviewed");
  }
  submission.status = "rejected";
  submission.feedback = note;
  submission.reviewedAt = new Date().toISOString();
  submission.reviewerId = String(actor.id);
  writeStore(store);
  demoSetParticipationStatus(submission.userId, submission.itemId, "rejected");
  return delay({ ...submission });
}
