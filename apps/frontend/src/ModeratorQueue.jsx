import { useEffect, useState } from "react";
import {
  getProofClient,
  PROOF_FEEDBACK_MAX,
  proofsUnavailableMessage,
  submissionStatusLabel,
} from "./proofs.js";

function ModeratorQueue({ session, onSessionExpired }) {
  const client = getProofClient({
    token: session.token,
    userId: session.userId,
    userName: session.userName,
  });
  const [rows, setRows] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  async function loadQueue() {
    if (!client) {
      setStatus("unavailable");
      return;
    }
    setStatus("loading");
    setError("");
    try {
      const list = await client.listPending();
      setRows(list);
      setStatus("ready");
    } catch (err) {
      if (err.status === 401) {
        onSessionExpired?.();
        return;
      }
      if (err.status === 403) {
        setError("Only moderators can review proof submissions.");
      } else {
        setError(err.message || "Couldn't load the queue.");
      }
      setStatus("error");
    }
  }

  useEffect(() => {
    loadQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, session.userId]);

  useEffect(() => {
    if (!client || !selectedId) {
      setDetail(null);
      return undefined;
    }
    let cancelled = false;
    (async () => {
      try {
        const submission = await client.getModerationSubmission(selectedId);
        if (!cancelled) {
          setDetail(submission);
          setFeedback("");
          setActionError("");
        }
      } catch (err) {
        if (cancelled) return;
        if (err.status === 401) onSessionExpired?.();
        else setActionError(err.message || "Couldn't open that submission.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, selectedId, onSessionExpired]);

  if (!client) {
    return (
      <section className="section panel">
        <h2 className="section-title">Proof review</h2>
        <p className="muted" role="status">
          {proofsUnavailableMessage()}
        </p>
      </section>
    );
  }

  async function decide(kind) {
    if (!detail || busy) return;
    if (kind === "reject" && !feedback.trim()) {
      setActionError("Add feedback before rejecting.");
      return;
    }
    if (kind === "reject" && feedback.trim().length > PROOF_FEEDBACK_MAX) {
      setActionError(`Keep feedback under ${PROOF_FEEDBACK_MAX + 1} characters.`);
      return;
    }
    setBusy(true);
    setActionError("");
    setNotice("");
    try {
      const updated =
        kind === "approve"
          ? await client.approve(detail.id)
          : await client.reject(detail.id, feedback.trim());
      setNotice(
        `Marked ${submissionStatusLabel(updated.status).toLowerCase()}. The student will see this on their quest.`
      );
      setSelectedId(null);
      setDetail(null);
      await loadQueue();
    } catch (err) {
      if (err.status === 401) {
        onSessionExpired?.();
        return;
      }
      if (err.code === "already_reviewed") {
        setActionError("Someone else already reviewed this submission.");
        await loadQueue();
        setSelectedId(null);
        setDetail(null);
      } else {
        setActionError(err.message || "Couldn't save that decision.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="moderation-layout">
      <section className="section panel" aria-labelledby="mod-queue-title">
        <div className="section-heading-row">
          <h2 className="section-title" id="mod-queue-title">
            Pending proof
          </h2>
          <button type="button" className="button button-secondary button-small" onClick={loadQueue}>
            Refresh
          </button>
        </div>
        {client.isDemo && (
          <p className="notice" role="note">
            Development sample — reviews stay in this browser tab.
          </p>
        )}
        {status === "loading" && (
          <p role="status" className="muted">
            Loading queue…
          </p>
        )}
        {status === "error" && (
          <p className="form-error form-error-left" role="alert">
            {error}
          </p>
        )}
        {status === "ready" && rows.length === 0 && (
          <p className="muted" role="status">
            No pending submissions right now.
          </p>
        )}
        {status === "ready" && rows.length > 0 && (
          <ul className="moderation-list">
            {rows.map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  className={selectedId === row.id ? "moderation-row active" : "moderation-row"}
                  onClick={() => setSelectedId(row.id)}
                >
                  <strong>{row.itemTitle || `Quest #${row.itemId}`}</strong>
                  <span className="muted">
                    {row.submitterName || "Student"} ·{" "}
                    {row.submittedAt ? new Date(row.submittedAt).toLocaleString() : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {notice && (
          <p className="notice" role="status">
            {notice}
          </p>
        )}
      </section>

      <section className="section panel" aria-labelledby="mod-detail-title">
        <h2 className="section-title" id="mod-detail-title">
          Submission detail
        </h2>
        {!detail && <p className="muted">Select a submission to review.</p>}
        {detail && (
          <div className="moderation-detail">
            <p>
              <strong>{detail.itemTitle}</strong> · {detail.submitterName}
            </p>
            {detail.requirements?.instructions && (
              <p className="muted">Requirements: {detail.requirements.instructions}</p>
            )}
            {detail.text && (
              <div className="proof-text-block">
                <h3 className="small-title">Text</h3>
                <p className="quest-text">{detail.text}</p>
              </div>
            )}
            {detail.photos?.length > 0 && (
              <div>
                <h3 className="small-title">Photos</h3>
                <ul className="proof-preview-list">
                  {detail.photos.map((photo) => (
                    <li key={photo.id}>
                      <img src={photo.url} alt={photo.name || "Submitted photo"} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {detail.video && (
              <div>
                <h3 className="small-title">Video</h3>
                <video src={detail.video.url} controls width="360" />
              </div>
            )}
            <label className="field">
              <span>Feedback (required to reject)</span>
              <textarea
                value={feedback}
                onChange={(event) => setFeedback(event.target.value)}
                rows={3}
                disabled={busy}
              />
            </label>
            {actionError && (
              <p className="form-error form-error-left" role="alert">
                {actionError}
              </p>
            )}
            <div className="button-row">
              <button type="button" className="button" disabled={busy} onClick={() => decide("approve")}>
                {busy ? "Saving…" : "Approve"}
              </button>
              <button
                type="button"
                className="button button-secondary"
                disabled={busy}
                onClick={() => decide("reject")}
              >
                Reject
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

export default ModeratorQueue;
