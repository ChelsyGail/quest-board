import { useEffect, useId, useState } from "react";
import {
  canSubmitProof,
  getProofClient,
  proofsUnavailableMessage,
  submissionStatusLabel,
  validateProofDraft,
} from "./proofs.js";

function revokeUrls(files) {
  for (const file of files) {
    if (file.previewUrl) URL.revokeObjectURL(file.previewUrl);
  }
}

function ProofSubmit({ session, item, participationStatus, onSessionExpired, onSubmitted }) {
  const formId = useId();
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

  const client = getProofClient({
    token: session.token,
    userId: session.userId,
    userName: session.userName,
  });

  useEffect(() => {
    if (!client || !item) {
      setLoadStatus("unavailable");
      return undefined;
    }
    let cancelled = false;
    (async () => {
      setLoadStatus("loading");
      setLoadError("");
      try {
        const [reqs, submission] = await Promise.all([
          client.requirementsForItem(item),
          client.getMySubmission(item.id),
        ]);
        if (cancelled) return;
        setRequirements(reqs);
        setExisting(submission);
        if (submission?.status === "rejected") {
          setText(submission.text || "");
        }
        setLoadStatus("ready");
      } catch (error) {
        if (cancelled) return;
        if (error.status === 401) {
          onSessionExpired?.();
          return;
        }
        setLoadError(error.message || "Couldn't load proof details.");
        setLoadStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
    // session identity + item id + manual reload; client is derived from flags/session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.token, session.userId, item?.id, onSessionExpired, reloadKey]);

  useEffect(() => () => revokeUrls(photos), [photos]);

  if (!client) {
    return (
      <section className="section panel" aria-labelledby={`${formId}-title`}>
        <h3 className="section-title" id={`${formId}-title`}>
          Submit proof
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

  async function handleSubmit(event) {
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
    setSubmitting(true);
    setFormError("");
    setNotice("");
    setProgress(5);
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
      setExisting(submission);
      setNotice("Proof submitted. Status: Pending.");
      setReloadKey((value) => value + 1);
      onSubmitted?.(submission);
    } catch (error) {
      if (error.status === 401) {
        onSessionExpired?.();
        return;
      }
      if (error.resultUnknown) {
        try {
          const again = await client.getMySubmission(item.id);
          if (again) {
            setExisting(again);
            setNotice("Proof was recorded. Status: " + submissionStatusLabel(again.status) + ".");
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
      setSubmitting(false);
      setProgress(0);
    }
  }

  function addPhotos(fileList) {
    const next = [...photos];
    for (const file of fileList) {
      next.push({ file, previewUrl: URL.createObjectURL(file) });
    }
    setPhotos(next.slice(0, requirements.maxPhotos || 5));
  }

  return (
    <section className="section panel proof-panel" aria-labelledby={`${formId}-title`}>
      <h3 className="section-title" id={`${formId}-title`}>
        Submit proof
      </h3>
      {client.isDemo && (
        <p className="notice" role="note">
          Development sample — submissions stay in this browser tab and are not shared.
        </p>
      )}
      <p className="muted">{requirements.instructions || "Follow the quest proof instructions."}</p>
      <ul className="proof-req-list">
        {requirements.requiresText && <li>Text required</li>}
        {requirements.requiresPhoto && <li>Photo required</li>}
        {requirements.requiresVideo && <li>Video required</li>}
      </ul>

      {existing && (
        <div className={`proof-status status-${existing.status}`} role="status">
          <strong>{submissionStatusLabel(existing.status)}</strong>
          {existing.feedback && <p>Moderator feedback: {existing.feedback}</p>}
          {existing.status === "rejected" && (
            <p className="muted">You can update your proof and submit again.</p>
          )}
        </div>
      )}

      {!maySubmit && !locked && (
        <p className="muted" role="status">
          Join this quest before submitting proof.
        </p>
      )}

      {locked && (
        <p className="muted" role="status">
          {existing.status === "pending"
            ? "Your proof is waiting for review."
            : "This proof was approved."}
        </p>
      )}

      {maySubmit && (
        <form className="stack-form" onSubmit={handleSubmit} noValidate>
          {requirements.requiresText && (
            <label className="field">
              <span>Proof text</span>
              <textarea
                value={text}
                onChange={(event) => setText(event.target.value)}
                rows={4}
                disabled={submitting}
                aria-invalid={Boolean(fieldErrors.text)}
              />
              {fieldErrors.text && <span className="field-error">{fieldErrors.text}</span>}
            </label>
          )}

          {(requirements.requiresPhoto || requirements.maxPhotos > 0) && (
            <fieldset className="field">
              <legend>Photos</legend>
              <input
                type="file"
                aria-label="Proof photos"
                accept={(requirements.allowedPhotoTypes || []).join(",")}
                multiple
                disabled={submitting}
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
                    <button
                      type="button"
                      className="button button-secondary button-small"
                      disabled={submitting}
                      onClick={() => {
                        URL.revokeObjectURL(entry.previewUrl);
                        setPhotos(photos.filter((_, i) => i !== index));
                      }}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            </fieldset>
          )}

          {(requirements.requiresVideo || true) && (
            <fieldset className="field">
              <legend>Video {requirements.requiresVideo ? "(required)" : "(optional)"}</legend>
              <input
                type="file"
                aria-label="Proof video"
                accept={(requirements.allowedVideoTypes || []).join(",")}
                disabled={submitting}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (video?.previewUrl) URL.revokeObjectURL(video.previewUrl);
                  setVideo(
                    file ? { file, previewUrl: URL.createObjectURL(file) } : null
                  );
                  event.target.value = "";
                }}
              />
              {fieldErrors.video && <span className="field-error">{fieldErrors.video}</span>}
              {video && (
                <div className="proof-video-preview">
                  <video src={video.previewUrl} controls width="320" />
                  <button
                    type="button"
                    className="button button-secondary button-small"
                    disabled={submitting}
                    onClick={() => {
                      URL.revokeObjectURL(video.previewUrl);
                      setVideo(null);
                    }}
                  >
                    Remove video
                  </button>
                </div>
              )}
            </fieldset>
          )}

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
          <button type="submit" className="button" disabled={submitting}>
            {submitting ? "Submitting…" : existing?.status === "rejected" ? "Resubmit proof" : "Submit proof"}
          </button>
        </form>
      )}
    </section>
  );
}

export default ProofSubmit;
