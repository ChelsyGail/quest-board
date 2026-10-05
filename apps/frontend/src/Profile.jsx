import { useState } from "react";
import {
  EMAIL_MAX_LENGTH,
  EMAIL_PATTERN,
  NAME_MAX_LENGTH,
  updateUser,
} from "./api.js";

// `session.user` holds the name and email the backend returned at sign-up or after a save.
// It is null after a normal login, because the backend has no endpoint to load them.
function Profile({ session, onUserUpdated, onLogout, onSessionExpired }) {
  const knownUser = session.user;
  const [name, setName] = useState(knownUser ? knownUser.name : "");
  const [email, setEmail] = useState(knownUser ? knownUser.email : "");
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    if (isSubmitting) return;

    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    const newErrors = {};
    const changes = {};

    // Only send fields the user filled in and actually changed.
    if (trimmedName !== "") {
      if (trimmedName.length > NAME_MAX_LENGTH) {
        newErrors.name = `Name must be at most ${NAME_MAX_LENGTH} characters.`;
      } else if (!knownUser || trimmedName !== knownUser.name) {
        changes.name = trimmedName;
      }
    } else if (knownUser) {
      newErrors.name = "Name cannot be empty.";
    }

    if (trimmedEmail !== "") {
      if (!EMAIL_PATTERN.test(trimmedEmail) || trimmedEmail.length > EMAIL_MAX_LENGTH) {
        newErrors.email = "Please enter a valid email address.";
      } else if (!knownUser || trimmedEmail !== knownUser.email) {
        changes.email = trimmedEmail;
      }
    } else if (knownUser) {
      newErrors.email = "Email cannot be empty.";
    }

    setErrors(newErrors);
    setFormError("");
    setSuccessMessage("");
    if (Object.keys(newErrors).length > 0) return;

    if (Object.keys(changes).length === 0) {
      setFormError(
        knownUser
          ? "You haven't changed anything yet."
          : "Enter a new name or email to update."
      );
      return;
    }

    if (Date.now() >= Date.parse(session.expiresAt)) {
      onSessionExpired();
      return;
    }

    setIsSubmitting(true);
    try {
      const updatedUser = await updateUser(session.userId, changes, session.token);
      setName(updatedUser.name);
      setEmail(updatedUser.email);
      setSuccessMessage("Changes saved.");
      onUserUpdated(updatedUser);
    } catch (error) {
      if (error.status === 401) {
        onSessionExpired();
        return;
      }
      setFormError(error.message);
    }
    setIsSubmitting(false);
  }

  const expiresAt = new Date(session.expiresAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <>
      <h2 className="screen-title">Your account</h2>

      {knownUser ? (
        <p className="account-summary">
          Signed in as <strong>{knownUser.name}</strong>
          <br />
          {knownUser.email}
        </p>
      ) : (
        <p className="notice">
          Your current name and email can't be loaded yet. You can still update them:
          fill in only the fields you want to change.
        </p>
      )}

      <form onSubmit={handleSubmit} noValidate>
        <div className="field">
          <label htmlFor="name">{knownUser ? "Name" : "New name"}</label>
          <input
            type="text"
            id="name"
            autoComplete="name"
            placeholder={knownUser ? "" : "Leave empty to keep your current name"}
            value={name}
            onChange={(event) => setName(event.target.value)}
            className={errors.name ? "invalid" : ""}
          />
          <p className="error">{errors.name}</p>
        </div>

        <div className="field">
          <label htmlFor="email">{knownUser ? "Email" : "New email"}</label>
          <input
            type="email"
            id="email"
            autoComplete="email"
            placeholder={knownUser ? "" : "Leave empty to keep your current email"}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className={errors.email ? "invalid" : ""}
          />
          <p className="error">{errors.email}</p>
        </div>

        <button type="submit" className="button" disabled={isSubmitting}>
          {isSubmitting ? "Saving…" : "Save changes"}
        </button>

        <p className="form-error" role="alert">{formError}</p>
        <p className="message" aria-live="polite">{successMessage}</p>
      </form>

      <div className="account-footer">
        <span className="small muted">Session ends at {expiresAt}</span>
        <button type="button" className="button button-secondary" onClick={onLogout}>
          Log out
        </button>
      </div>
    </>
  );
}

export default Profile;
