import { useEffect, useState } from "react";
import { ROLE_REQUEST_STATUSES, listRoleRequests, reviewRoleRequest } from "./api.js";
import { formatDate, roleLabel, statusLabel } from "./format.js";

// Admin page for reviewing organizer/moderator requests. The backend checks the admin
// role on every request here; this page being visible grants nothing by itself.
function AdminRoleRequests({ session, onSessionExpired }) {
  const [filter, setFilter] = useState("pending");
  const [requests, setRequests] = useState([]);
  const [status, setStatus] = useState("loading"); // "loading", "loaded", "error", "forbidden"
  const [loadError, setLoadError] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [busyId, setBusyId] = useState(null);
  const [busyDecision, setBusyDecision] = useState("");
  const [actionError, setActionError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  useEffect(() => {
    let ignore = false;
    setStatus("loading");

    listRoleRequests(filter, session.token)
      .then((list) => {
        if (ignore) return;
        setRequests(list);
        setStatus("loaded");
      })
      .catch((error) => {
        if (ignore) return;
        if (error.status === 401) {
          onSessionExpired();
        } else if (error.status === 403) {
          setStatus("forbidden");
        } else {
          setLoadError(error.message);
          setStatus("error");
        }
      });

    return () => {
      ignore = true;
    };
    // onSessionExpired is left out on purpose: a new function each render must not reload.
  }, [filter, session.token, loadAttempt]);

  function changeFilter(value) {
    setFilter(value);
    // Switch to loading in the same render, so the previous filter's items (and their
    // review buttons) are never shown under the new filter.
    setStatus("loading");
    setRequests([]);
    setActionError("");
    setSuccessMessage("");
  }

  async function review(request, decision) {
    if (busyId !== null) return;

    setBusyId(request.id);
    setBusyDecision(decision);
    setActionError("");
    setSuccessMessage("");
    const label = `request #${request.id} (${roleLabel(request.role)} for user #${request.userId})`;

    try {
      await reviewRoleRequest(request.id, decision, session.token);
      // A reviewed request is no longer pending, so it leaves the pending list.
      setRequests((list) => list.filter((item) => item.id !== request.id));
      setSuccessMessage(
        decision === "approve"
          ? `Approved ${label}. The user now has this role.`
          : `Rejected ${label}.`
      );
    } catch (error) {
      if (error.status === 401) {
        onSessionExpired();
        return;
      }
      if (error.status === 403 && error.code !== "self_review_forbidden") {
        setStatus("forbidden");
      } else if (error.status === 409 || error.status === 404) {
        // Someone else already reviewed or removed it; show the current list.
        setActionError(`${error.message} The list has been refreshed.`);
        setStatus("loading");
        setLoadAttempt((attempt) => attempt + 1);
      } else if (error.resultUnknown) {
        // The decision may have been saved before the connection failed. Reloading shows
        // whether the request is still pending before anyone acts on it again.
        setActionError(
          `We couldn't confirm whether ${label} was ` +
            `${decision === "approve" ? "approved" : "rejected"}. ${error.message} ` +
            "The list has been reloaded; check it before trying again."
        );
        setStatus("loading");
        setLoadAttempt((attempt) => attempt + 1);
      } else {
        setActionError(error.message);
      }
    }
    setBusyId(null);
  }

  let content;
  if (status === "loading") {
    content = (
      <p className="muted" role="status">
        Loading role requests…
      </p>
    );
  } else if (status === "forbidden") {
    content = (
      <p className="form-error" role="alert">
        Your account doesn't have admin access, so role requests can't be shown.
      </p>
    );
  } else if (status === "error") {
    content = (
      <>
        <p className="form-error" role="alert">
          Role requests couldn't be loaded. {loadError}
        </p>
        <button
          type="button"
          className="button button-secondary"
          onClick={() => setLoadAttempt((attempt) => attempt + 1)}
        >
          Try again
        </button>
      </>
    );
  } else if (requests.length === 0) {
    content = <p className="muted">No {filter} requests.</p>;
  } else {
    content = (
      <ul className="request-list">
        {requests.map((request) => {
          const isOwn = request.userId === session.userId;
          const isBusy = busyId === request.id;
          return (
            <li key={request.id} className="request-item">
              <div className="request-heading">
                <strong>
                  {roleLabel(request.role)} for user #{request.userId}
                  {isOwn && " (you)"}
                </strong>
                <span className={`status status-${request.status}`}>
                  {statusLabel(request.status)}
                </span>
              </div>
              <p className="small muted request-meta">
                Request #{request.id} · Requested {formatDate(request.createdAt)}
                {request.reviewedAt && ` · Reviewed ${formatDate(request.reviewedAt)}`}
              </p>
              <p className="small request-reason">
                {request.reason || <span className="muted">No reason given.</span>}
              </p>

              {request.status === "pending" &&
                (isOwn ? (
                  <p className="hint">Another admin must review your own request.</p>
                ) : (
                  <div className="request-actions">
                    <button
                      type="button"
                      className="button button-small"
                      disabled={busyId !== null}
                      onClick={() => review(request, "approve")}
                    >
                      {isBusy && busyDecision === "approve" ? "Approving…" : "Approve"}
                    </button>
                    <button
                      type="button"
                      className="button button-secondary button-small"
                      disabled={busyId !== null}
                      onClick={() => review(request, "reject")}
                    >
                      {isBusy && busyDecision === "reject" ? "Rejecting…" : "Reject"}
                    </button>
                  </div>
                ))}
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <>
      <h2 className="screen-title">Role requests</h2>
      <p className="hint section-hint">
        Approving gives the user the requested role right away. Requesters are shown by user
        ID, because the API doesn't include their names.
      </p>

      <div className="field filter">
        <label htmlFor="request-filter">Show</label>
        <select
          id="request-filter"
          value={filter}
          onChange={(event) => changeFilter(event.target.value)}
          disabled={busyId !== null}
        >
          {ROLE_REQUEST_STATUSES.map((value) => (
            <option key={value} value={value}>
              {statusLabel(value)}
            </option>
          ))}
        </select>
      </div>

      <p className="form-error" role="alert">{actionError}</p>
      <p className="message" aria-live="polite">{successMessage}</p>

      {content}
    </>
  );
}

export default AdminRoleRequests;
