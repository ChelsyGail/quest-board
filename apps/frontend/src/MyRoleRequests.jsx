import { useEffect, useState } from "react";
import {
  REASON_MAX_LENGTH,
  REQUESTABLE_ROLES,
  createRoleRequest,
  formErrorsFrom,
  listMyRoleRequests,
} from "./api.js";
import { formatDate, roleLabel, statusLabel } from "./format.js";

// The signed-in user's organizer/moderator requests, plus a form to send a new one.
// The backend refuses a request for a role the user already has or is already
// waiting on; a rejected request can be sent again.
// Changing `refreshKey` reloads the list in place, keeping the form and what was typed.
function MyRoleRequests({ session, currentRoles, refreshKey = 0, onSessionExpired }) {
  const [requests, setRequests] = useState([]);
  const [status, setStatus] = useState("loading"); // "loading", "loaded" or "error"
  const [loadError, setLoadError] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState("");
  const [selectedRole, setSelectedRole] = useState("");
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    let ignore = false;
    // Once a list is shown, reloads keep it on screen instead of replacing it.
    const keepList = status === "loaded";
    if (keepList) {
      setIsRefreshing(true);
      setRefreshError("");
    } else {
      setStatus("loading");
    }

    listMyRoleRequests(session.token)
      .then((list) => {
        if (ignore) return;
        setRequests(list);
        setStatus("loaded");
        setIsRefreshing(false);
      })
      .catch((error) => {
        if (ignore) return;
        if (error.status === 401) {
          onSessionExpired();
          return;
        }
        if (keepList) {
          setRefreshError(`Your access requests couldn't be refreshed. ${error.message}`);
          setIsRefreshing(false);
        } else {
          setLoadError(error.message);
          setStatus("error");
        }
      });

    return () => {
      ignore = true;
    };
    // `status` and onSessionExpired are left out on purpose: only these should reload.
  }, [session.token, loadAttempt, refreshKey]);

  const pendingRoles = requests
    .filter((request) => request.status === "pending")
    .map((request) => request.role);
  const availableRoles = REQUESTABLE_ROLES.filter(
    (role) => !currentRoles.includes(role) && !pendingRoles.includes(role)
  );
  const role = availableRoles.includes(selectedRole) ? selectedRole : availableRoles[0];

  // After a request whose result is unknown, reloads the list to see whether it arrived.
  async function checkWhetherSent(requestedRole, error) {
    const label = roleLabel(requestedRole);
    let list;
    try {
      list = await listMyRoleRequests(session.token);
    } catch (reloadError) {
      if (reloadError.status === 401) {
        onSessionExpired();
        return;
      }
      setFormError(
        `We couldn't confirm whether your ${label} access request was sent. ${error.message} ` +
          "Use Refresh above to check before sending it again."
      );
      return;
    }

    setRequests(list);
    if (list.some((item) => item.role === requestedRole && item.status === "pending")) {
      setReason("");
      setSuccessMessage(`Your ${label} access request was sent and is waiting for approval.`);
    } else {
      setFormError(
        `Your ${label} access request didn't reach the server. ${error.message} ` +
          "You can send it again."
      );
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (isSubmitting || !role) return;

    const trimmedReason = reason.trim();
    setErrors({});
    setFormError("");
    setSuccessMessage("");
    if (trimmedReason.length > REASON_MAX_LENGTH) {
      setErrors({ reason: `Reason must be at most ${REASON_MAX_LENGTH} characters.` });
      return;
    }

    setIsSubmitting(true);
    try {
      const created = await createRoleRequest(role, trimmedReason, session.token);
      setRequests((list) => [...list, created]);
      setReason("");
      setSuccessMessage(
        `Your ${roleLabel(role)} access request was sent and is waiting for approval.`
      );
    } catch (error) {
      if (error.status === 401) {
        onSessionExpired();
        return;
      }
      if (error.resultUnknown) {
        await checkWhetherSent(role, error);
        setIsSubmitting(false);
        return;
      }
      const mapped = formErrorsFrom(error, ["role", "reason"]);
      setErrors(mapped.fieldErrors);
      setFormError(mapped.formError);
      // A conflict means this list is out of date (for example, a request sent from
      // another tab), so reload it.
      if (error.status === 409) {
        setLoadAttempt((attempt) => attempt + 1);
      }
    }
    setIsSubmitting(false);
  }

  let content;
  if (status === "loading") {
    content = (
      <p className="muted small" role="status">
        Loading your access requests…
      </p>
    );
  } else if (status === "error") {
    content = (
      <>
        <p className="form-error">Your access requests couldn't be loaded. {loadError}</p>
        <button
          type="button"
          className="button button-secondary"
          onClick={() => setLoadAttempt((attempt) => attempt + 1)}
        >
          Try again
        </button>
      </>
    );
  } else {
    content = (
      <>
        {isRefreshing && (
          <p className="muted small" role="status">
            Refreshing your access requests…
          </p>
        )}
        {refreshError && <p className="form-error">{refreshError}</p>}
        {requests.length === 0 ? (
          <p className="muted small">You haven't requested extra access yet.</p>
        ) : (
          <ul className="request-list">
            {requests.map((request) => (
              <li key={request.id} className="request-item">
                <div className="request-heading">
                  <strong>{roleLabel(request.role)}</strong>
                  <span className={`status status-${request.status}`}>
                    {statusLabel(request.status)}
                  </span>
                </div>
                <p className="small muted request-meta">
                  Requested {formatDate(request.createdAt)}
                  {request.reviewedAt && ` · Reviewed ${formatDate(request.reviewedAt)}`}
                </p>
                {request.reason && <p className="small request-reason">{request.reason}</p>}
              </li>
            ))}
          </ul>
        )}

        {availableRoles.length === 0 ? (
          <p className="hint">
            You already have, or are waiting on, every role you can request.
          </p>
        ) : (
          <form onSubmit={handleSubmit} noValidate className="request-form">
            <div className="field">
              <label htmlFor="request-role">Role</label>
              <select
                id="request-role"
                value={role}
                onChange={(event) => setSelectedRole(event.target.value)}
                className={errors.role ? "invalid" : ""}
              >
                {availableRoles.map((option) => (
                  <option key={option} value={option}>
                    {roleLabel(option)}
                  </option>
                ))}
              </select>
              <p className="error">{errors.role}</p>
            </div>

            <div className="field">
              <label htmlFor="request-reason">Why do you need this access? (optional)</label>
              <textarea
                id="request-reason"
                rows="3"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                className={errors.reason ? "invalid" : ""}
              />
              <p className="error">{errors.reason}</p>
            </div>

            <button type="submit" className="button" disabled={isSubmitting}>
              {isSubmitting ? "Sending request…" : "Request access"}
            </button>
            <p className="form-error" role="alert">{formError}</p>
          </form>
        )}

        <p className="message" aria-live="polite">{successMessage}</p>
      </>
    );
  }

  return (
    <section className="section" aria-labelledby="access-requests-title">
      <h3 className="section-title" id="access-requests-title">
        Access requests
      </h3>
      <p className="hint section-hint">
        Organizer and moderator access must be approved by a QuestBoard admin. You keep your
        current access until then.
      </p>
      {content}
    </section>
  );
}

export default MyRoleRequests;
