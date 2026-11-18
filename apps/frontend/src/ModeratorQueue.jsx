import { useEffect, useMemo, useRef, useState } from "react";
import {
  getProofClient,
  PROOF_FEEDBACK_MAX,
  proofsMode,
  proofsUnavailableMessage,
  revokeSubmissionMediaUrls,
  submissionStatusLabel,
} from "./proofs.js";

function ModeratorQueue({ session, onSessionExpired }) {
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

  const [rows, setRows] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [page, setPage] = useState(1);
  const [pageMeta, setPageMeta] = useState({ number: 1, size: 20, totalItems: 0, totalPages: 1 });
  const loadGen = useRef(0);
  const selectedRef = useRef(null);
  const detailRef = useRef(null);

  async function loadQueue({ soft = false, pageNumber = page } = {}) {
    if (!client) {
      setStatus("unavailable");
      return;
    }
    const gen = ++loadGen.current;
    const userId = session.userId;
    if (soft && status === "ready") setRefreshing(true);
    else {
      setStatus("loading");
      setError("");
    }
    try {
      const result = await client.listPending({ page: pageNumber, pageSize: 20 });
      if (gen !== loadGen.current || userId !== session.userId) return;
      const items = Array.isArray(result) ? result : result.items || [];
      const meta = result?.page || {
        number: pageNumber,
        size: 20,
        totalItems: items.length,
        totalPages: 1,
      };
      setRows(items);
      setPageMeta(meta);
      setPage(meta.number || pageNumber);
      // Drop selection if the open row left this page.
      if (selectedRef.current && !items.some((row) => row.id === selectedRef.current)) {
        selectedRef.current = null;
        setSelectedId(null);
      }
      setStatus("ready");
      setError("");
    } catch (err) {
      if (gen !== loadGen.current || userId !== session.userId) return;
      if (err.status === 401) {
        onExpiredRef.current?.();
        return;
      }
      if (err.status === 403) {
        setError("Only moderators can review proof submissions.");
      } else {
        setError(err.message || "Couldn't load the queue.");
      }
      if (!soft) setStatus("error");
    } finally {
      if (gen === loadGen.current) setRefreshing(false);
    }
  }

  useEffect(() => {
    if (!client) {
      setStatus("unavailable");
      return undefined;
    }
    loadQueue({ soft: false, pageNumber: page });
    return () => {
      loadGen.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, session.userId, session.token, page]);

  useEffect(() => {
    if (!client || !selectedId) {
      setDetail((current) => {
        revokeSubmissionMediaUrls(current);
        detailRef.current = null;
        return null;
      });
      return undefined;
    }
    let cancelled = false;
    const requestId = selectedId;
    (async () => {
      try {
        const submission = await client.getModerationSubmission(selectedId);
        if (cancelled || selectedRef.current !== requestId) {
          revokeSubmissionMediaUrls(submission);
          return;
        }
        setDetail((current) => {
          revokeSubmissionMediaUrls(current);
          detailRef.current = submission;
          return submission;
        });
        setFeedback("");
        setActionError("");
      } catch (err) {
        if (cancelled || selectedRef.current !== requestId) return;
        if (err.status === 401) onExpiredRef.current?.();
        else setActionError(err.message || "Couldn't open that submission.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, selectedId]);

  useEffect(
    () => () => {
      revokeSubmissionMediaUrls(detailRef.current);
      detailRef.current = null;
    },
    []
  );

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
    const detailId = detail.id;
    const userId = session.userId;
    setBusy(true);
    setActionError("");
    setNotice("");
    try {
      const review =
        kind === "approve"
          ? await client.approve(detail.id)
          : await client.reject(detail.id, feedback.trim());
      if (userId !== session.userId || selectedRef.current !== detailId) return;
      const decision = review.decision || review.status;
      const pointsNote =
        review.pointsAwarded != null ? ` Points awarded: ${review.pointsAwarded}.` : "";
      setNotice(
        `Marked ${submissionStatusLabel(decision).toLowerCase()}.${pointsNote} The student will see this on their quest.`
      );
      selectedRef.current = null;
      setSelectedId(null);
      setDetail((current) => {
        revokeSubmissionMediaUrls(current);
        return null;
      });
      await loadQueue({ soft: true });
    } catch (err) {
      if (userId !== session.userId) return;
      if (err.status === 401) {
        onExpiredRef.current?.();
        return;
      }
      if (err.code === "self_review") {
        setActionError("You can't review your own submission.");
      } else if (
        err.code === "submission_already_reviewed" ||
        err.code === "already_reviewed"
      ) {
        setActionError("This submission was already reviewed.");
        await loadQueue({ soft: true });
        selectedRef.current = null;
        setSelectedId(null);
        setDetail((current) => {
          revokeSubmissionMediaUrls(current);
          return null;
        });
      } else {
        setActionError(err.message || "Couldn't save that decision.");
      }
    } finally {
      if (userId === session.userId) setBusy(false);
    }
  }

  function selectRow(id) {
    selectedRef.current = id;
    setSelectedId(id);
  }

  return (
    <div className="moderation-layout">
      <section className="section panel" aria-labelledby="mod-queue-title">
        <div className="section-heading-row">
          <h2 className="section-title" id="mod-queue-title">
            Pending proof
          </h2>
          <button
            type="button"
            className="button button-secondary button-small"
            onClick={() => loadQueue({ soft: true })}
            disabled={refreshing || status === "loading"}
          >
            {refreshing ? "Refreshing…" : "Refresh"}
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
          <>
            <ul className="moderation-list">
              {rows.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    className={selectedId === row.id ? "moderation-row active" : "moderation-row"}
                    onClick={() => selectRow(row.id)}
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
            {pageMeta.totalPages > 1 && (
              <nav className="pagination" aria-label="Pending proof pages">
                <button
                  type="button"
                  className="button button-secondary button-small"
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  disabled={page <= 1 || refreshing || busy}
                >
                  Previous
                </button>
                <span className="small muted">
                  Page {pageMeta.number} of {pageMeta.totalPages} · {pageMeta.totalItems} pending
                </span>
                <button
                  type="button"
                  className="button button-secondary button-small"
                  onClick={() =>
                    setPage((current) => Math.min(pageMeta.totalPages, current + 1))
                  }
                  disabled={page >= pageMeta.totalPages || refreshing || busy}
                >
                  Next
                </button>
              </nav>
            )}
          </>
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
                      {photo.url ? (
                        <img src={photo.url} alt={photo.name || "Submitted photo"} />
                      ) : (
                        <div className="proof-preview-fallback">
                          <span className="proof-filename">{photo.name}</span>
                          <span className="muted small">Preview unavailable</span>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {detail.video && (
              <div>
                <h3 className="small-title">Video</h3>
                {detail.video.url ? (
                  <video src={detail.video.url} controls width="360" />
                ) : (
                  <p className="muted small">
                    {detail.video.name} — preview unavailable
                  </p>
                )}
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
