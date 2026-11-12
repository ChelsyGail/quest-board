import { useState } from "react";
import {
  EMAIL_HINT,
  EMAIL_MAX_LENGTH,
  EMAIL_PATTERN,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  formErrorsFrom,
  getCurrentUser,
  roleRequestsEnabled,
  updateUser,
} from "./api.js";
import { roleLabel } from "./format.js";
import MyRoleRequests from "./MyRoleRequests.jsx";

// `profile` comes from GET /users/me. It is null when this backend has no /users/me
// yet; then only the fields the user fills in are sent.
// The name is the user's username: it is set at signup and never sent in an update.
function Profile({ session, profile, onProfileUpdated, onSessionExpired }) {
  const isLoaded = profile !== null;
  const [email, setEmail] = useState(isLoaded ? profile.email : "");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState("");
  const [refreshMessage, setRefreshMessage] = useState("");
  // Changing this makes MyRoleRequests reload the user's requests.
  const [requestsRefreshKey, setRequestsRefreshKey] = useState(0);

  // Reloads roles and access requests, e.g. after an admin reviewed a request.
  // The email input keeps an unsaved edit; if untouched, it takes the new value.
  async function handleRefresh() {
    if (isRefreshing) return;
    if (Date.now() >= Date.parse(session.expiresAt)) {
      onSessionExpired();
      return;
    }

    setIsRefreshing(true);
    setRefreshError("");
    setRefreshMessage("");
    setRequestsRefreshKey((key) => key + 1);
    let user;
    try {
      user = await getCurrentUser(session.token);
    } catch (error) {
      if (error.status === 401) {
        onSessionExpired();
        return;
      }
      setRefreshError(`Your account couldn't be refreshed. ${error.message}`);
      setIsRefreshing(false);
      return;
    }
    setEmail((current) => (current === profile.email ? user.email : current));
    onProfileUpdated(user);
    setRefreshMessage("Your roles and details are up to date.");
    setIsRefreshing(false);
  }

  // After a save whose result is unknown, reloads the profile to see what was saved.
  async function checkWhetherSaved(changes, error) {
    const unconfirmed = `We couldn't confirm whether your changes were saved. ${error.message}`;
    if (!isLoaded) {
      setFormError(unconfirmed);
      return;
    }

    let saved;
    try {
      saved = await getCurrentUser(session.token);
    } catch (reloadError) {
      if (reloadError.status === 401) {
        onSessionExpired();
        return;
      }
      setFormError(unconfirmed);
      return;
    }

    onProfileUpdated(saved);
    const detailsSaved = !changes.email || saved.email === changes.email;
    if (detailsSaved && !changes.password) {
      setEmail(saved.email);
      setSuccessMessage("Changes saved.");
    } else if (detailsSaved) {
      // A password can't be read back, so its result stays unknown.
      setFormError(
        `We couldn't confirm whether your new password was saved. ${error.message} ` +
          (changes.email ? "Your other changes were saved. " : "") +
          "You can save it again."
      );
    } else {
      setFormError(
        `${unconfirmed} Your saved details have been reloaded above; you can save again.`
      );
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (isSubmitting) return;

    const trimmedEmail = email.trim();
    const newErrors = {};
    const changes = {};

    // Only send fields that were filled in and actually changed.
    if (trimmedEmail !== "") {
      if (!EMAIL_PATTERN.test(trimmedEmail) || trimmedEmail.length > EMAIL_MAX_LENGTH) {
        newErrors.email = "Please enter a valid email address.";
      } else if (!isLoaded || trimmedEmail !== profile.email) {
        changes.email = trimmedEmail;
      }
    } else if (isLoaded) {
      newErrors.email = "Email cannot be empty.";
    }

    // An empty new password means "keep the current one". Passwords are never trimmed.
    if (newPassword !== "") {
      if (newPassword.length < PASSWORD_MIN_LENGTH) {
        newErrors.password = `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
      } else if (newPassword.length > PASSWORD_MAX_LENGTH) {
        newErrors.password = `Password must be at most ${PASSWORD_MAX_LENGTH} characters.`;
      }
      if (confirmPassword !== newPassword) {
        newErrors.confirmPassword = "Passwords do not match.";
      }
      changes.password = newPassword;
    } else if (confirmPassword !== "") {
      newErrors.password = "Enter the new password, or clear the confirmation.";
    }

    setErrors(newErrors);
    setFormError("");
    setSuccessMessage("");
    if (Object.keys(newErrors).length > 0) return;

    if (Object.keys(changes).length === 0) {
      setFormError(
        isLoaded ? "You haven't changed anything yet." : "Enter a new email or password."
      );
      return;
    }

    if (Date.now() >= Date.parse(session.expiresAt)) {
      onSessionExpired();
      return;
    }

    setIsSubmitting(true);
    let updatedUser;
    try {
      updatedUser = await updateUser(session.userId, changes, session.token);
    } catch (error) {
      if (error.status === 401) {
        onSessionExpired();
        return;
      }
      if (error.resultUnknown) {
        await checkWhetherSaved(changes, error);
      } else {
        const mapped = formErrorsFrom(error, ["email", "password"]);
        setErrors(mapped.fieldErrors);
        setFormError(mapped.formError);
      }
      setIsSubmitting(false);
      return;
    }

    if (isLoaded) {
      onProfileUpdated(updatedUser);
      setEmail(updatedUser.email);
    } else {
      setEmail("");
    }
    setNewPassword("");
    setConfirmPassword("");
    setSuccessMessage(
      changes.password ? "Changes saved, including your new password." : "Changes saved."
    );
    setIsSubmitting(false);
  }

  return (
    <div className="page-stack">
      <header className="page-header">
        <h2 className="screen-title">Your account</h2>
      </header>

      {isLoaded ? (
        <>
          <div className="account-summary">
            <p>
              Signed in as <strong>{profile.name}</strong>
              <br />
              {profile.email}
              <br />
              <span className="muted">
                Roles:{" "}
                {profile.roles.length > 0 ? profile.roles.map(roleLabel).join(", ") : "none"}
              </span>
            </p>
            <button
              type="button"
              className="button button-secondary button-small"
              onClick={handleRefresh}
              disabled={isRefreshing}
            >
              {isRefreshing ? "Refreshing…" : "Refresh"}
            </button>
          </div>
          <p className="form-error refresh-status" role="alert">{refreshError}</p>
          <p className="message refresh-status" aria-live="polite">{refreshMessage}</p>
        </>
      ) : (
        <p className="notice">
          Your current details can't be loaded, because the server doesn't support it yet.
          You can still update them: fill in only the fields you want to change.
        </p>
      )}

      <form onSubmit={handleSubmit} noValidate className="profile-form panel">
        <div className="form-grid">
          {isLoaded && (
            <div className="field">
              <label htmlFor="name">Name</label>
              <input
                type="text"
                id="name"
                value={profile.name}
                readOnly
                aria-describedby="name-hint"
                className="read-only"
              />
              <p className="hint" id="name-hint">
                Your name is your QuestBoard username and can't be changed.
              </p>
            </div>
          )}

          <div className="field">
            <label htmlFor="email">{isLoaded ? "Email" : "New email"}</label>
            <input
              type="email"
              id="email"
              autoComplete="email"
              aria-describedby="email-hint"
              placeholder={isLoaded ? "" : "Leave empty to keep your current email"}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className={errors.email ? "invalid" : ""}
            />
            <p className="hint" id="email-hint">
              {EMAIL_HINT}
            </p>
            <p className="error">{errors.email}</p>
          </div>

          <div className="field">
            <label htmlFor="new-password">New password</label>
            <input
              type="password"
              id="new-password"
              autoComplete="new-password"
              aria-describedby="new-password-hint"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              className={errors.password ? "invalid" : ""}
            />
            <p className="hint" id="new-password-hint">
              Leave empty to keep your current password. {PASSWORD_MIN_LENGTH}–
              {PASSWORD_MAX_LENGTH} characters.
            </p>
            <p className="error">{errors.password}</p>
          </div>

          <div className="field">
            <label htmlFor="confirm-new-password">Confirm new password</label>
            <input
              type="password"
              id="confirm-new-password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              className={errors.confirmPassword ? "invalid" : ""}
            />
            <p className="error">{errors.confirmPassword}</p>
          </div>
        </div>

        <div className="form-actions">
          <button type="submit" className="button button-inline" disabled={isSubmitting}>
            {isSubmitting ? "Saving…" : "Save changes"}
          </button>
        </div>

        <p className="form-error form-error-left" role="alert">
          {formError}
        </p>
        <p className="message message-left" aria-live="polite">
          {successMessage}
        </p>
      </form>

      {isLoaded && roleRequestsEnabled() && (
        <MyRoleRequests
          session={session}
          currentRoles={profile.roles}
          refreshKey={requestsRefreshKey}
          onSessionExpired={onSessionExpired}
        />
      )}
    </div>
  );
}

export default Profile;
