import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  canSubmitProof,
  getProofClient,
  proofsMode,
  proofsUnavailableMessage,
  submissionStatusLabel,
  validateProofDraft,
} from "./proofs.js";

function revokeUrls(files) {
  for (const file of files) {
    if (file.previewUrl) URL.revokeObjectURL(file.previewUrl);
  }
}

function ProofSubmit({
  session,
  item,
  participationStatus,
  onSessionExpired,
  onSubmitted,
  onProofState,
}) {
  const formId = useId();
  const photoInputId = `${formId}-photos`;
  const videoInputId = `${formId}-video`;
  const mode = proofsMode();
  const client = useMemo(
    () =>
      getProofClient({
        token: session.token,
        userId: session.userId,
        userName: session.userName,
      }),
    [session.token, session.userId, session.userName, mode]
  );
  const onExpiredRef = useRef(onSessionExpired);
  onExpiredRef.current = onSessionExpired;
  const onProofStateRef = useRef(onProofState);
  onProofStateRef.current = onProofState;

  const [requirements, setRequirements] = useState(null);
  const [existing, setExisting] = useState(null);
  const [loadStatus, setLoadStatus] = useState("loading");
  const [loadError, setLoadError] = useState("");
  const [text, setText] = useState("");
  const [photos, setPhotos] = useState([]);
  const [video, setVideo] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState("");
  const [progress, setProgress] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const loadedItemRef = useRef(null);

  useEffect(() => {
    if (!client || !item) {
      setLoadStatus("unavailable");
      loadedItemRef.current = null;
      onProofStateRef.current?.(null);
      return undefined;
    }
    let cancelled = false;
    const soft = loadedItemRef.current === item.id;
    (async () => {
      if (!soft) {
        setLoadStatus("loading");
        setLoadError("");
      }
      try {
        const [reqs, submission] = await Promise.all([
          client.requirementsForItem(item),
          client.getMySubmission(item.id),
        ]);
        if (cancelled) return;
        setRequirements(reqs);
        setExisting(submission);
        onProofStateRef.current?.(submission);
        if (submission?.status === "rejected") {
          setText(submission.text || "");
        }
        loadedItemRef.current = item.id;
        setLoadStatus("ready");
      } catch (error) {
        if (cancelled) return;
        if (error.status === 401) {
          onExpiredRef.current?.();
          return;
        }
        setLoadError(error.message || "Couldn't load proof details.");
        if (!soft) setLoadStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session.token, session.userId, item?.id, client, reloadKey]);

  useEffect(() => () => revokeUrls(photos), [photos]);

  if (!client) {
    return (
      <section className="section panel proof-panel" aria-labelledby={`${formId}-title`}>
        <h3 className="section-title" id={`${formId}-title`}>
          Proof
        </h3>
        <p className="muted" role="status">
          {proofsUnavailableMessage()}
        </p>
      </section>
    );
  }

  if (loadStatus === "loading") {
    return (
      <div className="panel-state" role="status">
        Loading proof details…
      </div>
    );
  }

  if (loadStatus === "error") {
    return (
      <div className="panel-state">
        <p className="form-error form-error-left" role="alert">
          {loadError}
        </p>
      </div>
    );
  }

  const locked =
    existing && (existing.status === "pending" || existing.status === "approved");
  const maySubmit = canSubmitProof(participationStatus) && !locked;

  function requestSubmit(event) {
    event.preventDefault();
    if (submitting || !maySubmit) return;
    const errors = validateProofDraft(requirements, {
      text,
      photos: photos.map((entry) => entry.file),
      video: video?.file || null,
    });
    setFieldErrors(errors);
    if (Object.keys(errors).length) {
      setFormError("Please fix the highlighted fields.");
      return;
    }
    setFormError("");
    setConfirmOpen(true);
  }

  async function confirmSubmit() {
    if (submitting || !maySubmit) return;
    setConfirmOpen(false);
    setSubmitting(true);
    setFormError("");
    setNotice("");
    setProgress(5);
    const userId = session.userId;
    const itemId = item.id;
    try {
      const activeClient = getProofClient({
        token: session.token,
        userId: session.userId,
        userName: session.userName,
      });
      const submission = await activeClient.submitProof(
        item.id,
        {
          text,
          photos: photos.map((entry) => entry.file),
          video: video?.file || null,
        },
        setProgress
      );
      if (userId !== session.userId || itemId !== item.id) return;
      setExisting(submission);
      onProofState?.(submission);
      setNotice("Proof submitted. Status: Pending review.");
      setReloadKey((value) => value + 1);
      onSubmitted?.(submission);
    } catch (error) {
      if (userId !== session.userId || itemId !== item.id) return;
      if (error.status === 401) {
        onExpiredRef.current?.();
        return;
      }
      if (error.resultUnknown) {
        try {
          const again = await client.getMySubmission(item.id);
          if (again) {
            setExisting(again);
            onProofState?.(again);
            setNotice(
              "Proof was recorded. Status: " + submissionStatusLabel(again.status) + "."
            );
            onSubmitted?.(again);
            return;
          }
        } catch {
          // Fall through.
        }
        setFormError(
          "We couldn't confirm whether your proof was saved. Check this page again before submitting another one."
        );
        return;
      }
      if (error.fieldErrors) setFieldErrors(error.fieldErrors);
      setFormError(error.message || "Couldn't submit proof.");
    } finally {
      if (userId === session.userId) {
        setSubmitting(false);
        setProgress(0);
      }
    }
  }

  function addPhotos(fileList) {
    const next = [...photos];
    for (const file of fileList) {
      next.push({ file, previewUrl: URL.createObjectURL(file) });
    }
    setPhotos(next.slice(0, requirements.maxPhotos || 5));
  }

  const statusLabel =
    existing?.status === "pending"
      ? "Pending review"
      : existing
        ? submissionStatusLabel(existing.status)
        : null;

  return (
    <section className="section panel proof-panel" aria-labelledby={`${formId}-title`}>
      <h3 className="section-title" id={`${formId}-title`}>
        Proof
      </h3>

      <ul className="proof-req-list" aria-label="Proof requirements">
        {requirements.requiresText && (
          <li>
            Text <span className="proof-req-flag">Required</span>
          </li>
        )}
        {requirements.requiresPhoto && (
          <li>
            Photo <span className="proof-req-flag">Required</span>
          </li>
        )}
        {requirements.requiresVideo ? (
          <li>
            Video <span className="proof-req-flag">Required</span>
          </li>
        ) : (
          <li>
            Video <span className="muted small">Optional</span>
          </li>
        )}
      </ul>

      {existing && (
        <div className={`proof-status status-${existing.status}`} role="status">
          <strong>{statusLabel}</strong>
          {existing.feedback && <p>Moderator feedback: {existing.feedback}</p>}
          {existing.status === "rejected" && (
            <p className="muted">You can update your proof and submit again.</p>
          )}
          {existing.status === "approved" && existing.awardedPoints != null && (
            <p>Awarded points: {existing.awardedPoints}</p>
          )}
        </div>
      )}

      {!maySubmit && !locked && (
        <p className="muted" role="status">
          Join this quest to unlock proof submission.
        </p>
      )}

      {locked && (
        <p className="muted" role="status">
          {existing.status === "pending"
            ? "Your proof is waiting for review."
            : "This proof was approved. You cannot submit again."}
        </p>
      )}

      {maySubmit && (
        <form className="stack-form proof-form" onSubmit={requestSubmit} noValidate>
          <p className="hint proof-switch-hint">
            Submitting switches you to the after-submission discussion. Details are confirmed
            before upload.
          </p>
          {requirements.requiresText && (
            <label className="field">
              <span>Proof text</span>
              <textarea
                value={text}
                onChange={(event) => setText(event.target.value)}
                rows={5}
                disabled={submitting || confirmOpen}
                aria-invalid={Boolean(fieldErrors.text)}
              />
              {fieldErrors.text && <span className="field-error">{fieldErrors.text}</span>}
            </label>
          )}

          {(requirements.requiresPhoto || requirements.maxPhotos > 0) && (
            <div className="field proof-upload">
              <span className="proof-upload-label" id={`${formId}-photos-label`}>
                Photos
              </span>
              <label className="proof-upload-drop" htmlFor={photoInputId}>
                <span className="proof-upload-cta">Choose photos</span>
                <span className="muted small">PNG or JPEG</span>
              </label>
              <input
                id={photoInputId}
                className="proof-upload-input"
                type="file"
                aria-labelledby={`${formId}-photos-label`}
                aria-label="Proof photos"
                accept={(requirements.allowedPhotoTypes || []).join(",")}
                multiple
                disabled={submitting || confirmOpen}
                onChange={(event) => {
                  addPhotos([...event.target.files]);
                  event.target.value = "";
                }}
              />
              {fieldErrors.photos && <span className="field-error">{fieldErrors.photos}</span>}
              <ul className="proof-preview-list">
                {photos.map((entry, index) => (
                  <li key={entry.previewUrl}>
                    <img src={entry.previewUrl} alt={`Selected photo ${index + 1}`} />
                    <div className="proof-file-meta">
                      <span className="proof-filename" title={entry.file.name}>
                        {entry.file.name}
                      </span>
                      <button
                        type="button"
                        className="button button-secondary button-small"
                        disabled={submitting || confirmOpen}
                        onClick={() => {
                          URL.revokeObjectURL(entry.previewUrl);
                          setPhotos(photos.filter((_, i) => i !== index));
                        }}
                      >
                        Remove
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="field proof-upload">
            <span className="proof-upload-label" id={`${formId}-video-label`}>
              Video {requirements.requiresVideo ? "" : "(optional)"}
            </span>
            <label className="proof-upload-drop" htmlFor={videoInputId}>
              <span className="proof-upload-cta">
                {video ? "Replace video" : "Choose video"}
              </span>
              <span className="muted small">MP4 or similar</span>
            </label>
            <input
              id={videoInputId}
              className="proof-upload-input"
              type="file"
              aria-labelledby={`${formId}-video-label`}
              aria-label="Proof video"
              accept={(requirements.allowedVideoTypes || []).join(",")}
              disabled={submitting || confirmOpen}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (video?.previewUrl) URL.revokeObjectURL(video.previewUrl);
                setVideo(file ? { file, previewUrl: URL.createObjectURL(file) } : null);
                event.target.value = "";
              }}
            />
            {fieldErrors.video && <span className="field-error">{fieldErrors.video}</span>}
            {video && (
              <div className="proof-video-preview">
                <video src={video.previewUrl} controls />
                <div className="proof-file-meta">
                  <span className="proof-filename" title={video.file.name}>
                    {video.file.name}
                  </span>
                  <button
                    type="button"
                    className="button button-secondary button-small"
                    disabled={submitting || confirmOpen}
                    onClick={() => {
                      URL.revokeObjectURL(video.previewUrl);
                      setVideo(null);
                    }}
                  >
                    Remove video
                  </button>
                </div>
              </div>
            )}
          </div>

          {progress > 0 && (
            <p role="status" aria-live="polite">
              Upload progress: {progress}%
            </p>
          )}
          {formError && (
            <p className="form-error form-error-left" role="alert">
              {formError}
            </p>
          )}
          {notice && (
            <p className="notice" role="status">
              {notice}
            </p>
          )}

          {confirmOpen ? (
            <div className="proof-confirm" role="alertdialog" aria-labelledby={`${formId}-confirm`}>
              <p id={`${formId}-confirm`}>
                Submit this proof? You will leave the active discussion and open the
                after-submission space (spoilers allowed). You stay on the quest — you are not
                leaving it. Your draft is kept if you cancel.
              </p>
              <div className="button-row">
                <button
                  type="button"
                  className="button"
                  disabled={submitting}
                  onClick={confirmSubmit}
                >
                  {submitting
                    ? "Submitting…"
                    : existing?.status === "rejected"
                      ? "Confirm resubmit"
                      : "Confirm submit"}
                </button>
                <button
                  type="button"
                  className="button button-secondary"
                  disabled={submitting}
                  onClick={() => setConfirmOpen(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button type="submit" className="button" disabled={submitting}>
              {existing?.status === "rejected" ? "Resubmit proof" : "Submit proof"}
            </button>
          )}
        </form>
      )}
    </section>
  );
}

export default ProofSubmit;
