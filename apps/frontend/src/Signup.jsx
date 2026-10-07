import { useState } from "react";
import {
  EMAIL_MAX_LENGTH,
  EMAIL_PATTERN,
  NAME_MAX_LENGTH,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  REASON_MAX_LENGTH,
  REQUESTABLE_ROLES,
  createRoleRequest,
  formErrorsFrom,
  listMyRoleRequests,
  login,
  registerUser,
  roleRequestsEnabled,
} from "./api.js";
import { roleLabel } from "./format.js";

function validate(name, email, password, confirmPassword, reason) {
  const errors = {};

  if (name.trim() === "") {
    errors.name = "Please enter your name.";
  } else if (name.trim().length > NAME_MAX_LENGTH) {
    errors.name = `Name must be at most ${NAME_MAX_LENGTH} characters.`;
  }

  if (email.trim() === "") {
    errors.email = "Please enter your email.";
  } else if (!EMAIL_PATTERN.test(email.trim()) || email.trim().length > EMAIL_MAX_LENGTH) {
    errors.email = "Please enter a valid email address.";
  }

  // Passwords are never trimmed: spaces are valid password characters.
  if (password.length < PASSWORD_MIN_LENGTH) {
    errors.password = `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  } else if (password.length > PASSWORD_MAX_LENGTH) {
    errors.password = `Password must be at most ${PASSWORD_MAX_LENGTH} characters.`;
  }

  if (confirmPassword === "") {
    errors.confirmPassword = "Please confirm your password.";
  } else if (confirmPassword !== password) {
    errors.confirmPassword = "Passwords do not match.";
  }

  if (reason.length > REASON_MAX_LENGTH) {
    errors.reason = `Reason must be at most ${REASON_MAX_LENGTH} characters.`;
  }

  return errors;
}

// Sends one approval request per selected role and describes what actually happened.
// When a request's result is unknown, the user's requests are reloaded to find out.
async function sendRoleRequests(roles, reason, token) {
  const results = [];
  for (const role of roles) {
    try {
      await createRoleRequest(role, reason, token);
      results.push({ role, outcome: "sent" });
    } catch (error) {
      const why = error.isUnsupported
        ? "the server doesn't accept access requests yet."
        : error.message;
      results.push({ role, outcome: error.resultUnknown ? "unknown" : "failed", why });
    }
  }

  if (results.some((result) => result.outcome === "unknown")) {
    try {
      const saved = await listMyRoleRequests(token);
      for (const result of results.filter((item) => item.outcome === "unknown")) {
        const received = saved.some(
          (request) => request.role === result.role && request.status === "pending"
        );
        Object.assign(
          result,
          received ? { outcome: "sent" } : { outcome: "failed", why: "the server didn't receive it." }
        );
      }
    } catch {
      // The results stay unknown.
    }
  }

  const messages = results.map(({ role, outcome, why }) => {
    if (outcome === "sent") {
      return `Your ${roleLabel(role)} access request was sent and is waiting for approval.`;
    }
    if (outcome === "unknown") {
      return `We couldn't confirm whether your ${roleLabel(role)} access request was sent: ${why}`;
    }
    return `Your ${roleLabel(role)} access request was not sent: ${why}`;
  });
  if (results.some((result) => result.outcome === "unknown")) {
    messages.push("Your account page shows which requests arrived.");
  } else if (results.some((result) => result.outcome === "failed")) {
    messages.push("You can request access again from your account page.");
  }
  return messages.join(" ");
}

function Signup({ onAuthenticated, onAccountCreated, onBackToLogin }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [requestedRoles, setRequestedRoles] = useState([]);
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const canRequestRoles = roleRequestsEnabled();

  function toggleRole(role) {
    setRequestedRoles((roles) =>
      roles.includes(role) ? roles.filter((r) => r !== role) : [...roles, role]
    );
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (isSubmitting) return;

    const roles = canRequestRoles ? requestedRoles : [];
    const roleReason = roles.length > 0 ? reason.trim() : "";

    const newErrors = validate(name, email, password, confirmPassword, roleReason);
    setErrors(newErrors);
    setFormError("");
    if (Object.keys(newErrors).length > 0) return;

    setIsSubmitting(true);

    let accountEmail = email.trim();
    let session = null;
    try {
      const user = await registerUser(name.trim(), accountEmail, password);
      accountEmail = user.email;
    } catch (error) {
      if (!error.resultUnknown) {
        const mapped = formErrorsFrom(error, ["name", "email", "password"]);
        setErrors(mapped.fieldErrors);
        setFormError(mapped.formError);
        setIsSubmitting(false);
        return;
      }
      // The account may have been created before the connection failed. Logging in
      // with the same details shows whether it exists.
      try {
        session = await login(accountEmail, password);
      } catch (loginError) {
        setFormError(
          loginError.status === 401
            ? `We couldn't confirm whether your account was created. ${error.message} ` +
                "Logging in with these details didn't work either, so you can try again."
            : `We couldn't confirm whether your account was created. ${error.message} ` +
                "Try logging in with this email and password before signing up again."
        );
        setIsSubmitting(false);
        return;
      }
    }

    // The account exists now. Log in right away so the user lands on their account screen.
    if (!session) {
      try {
        session = await login(accountEmail, password);
      } catch {
        onAccountCreated(
          accountEmail,
          roles.length > 0
            ? "Your access request was not sent, because you couldn't be logged in " +
                "automatically. After logging in, you can request access from your account page."
            : ""
        );
        return;
      }
    }

    // Role requests need a logged-in user, so they can only be sent after signing in.
    let message = "Your account was created.";
    if (roles.length > 0) {
      message += " " + (await sendRoleRequests(roles, roleReason, session.token));
    }
    onAuthenticated(session, message);
  }

  const roleHint = canRequestRoles
    ? "Every new account is a student account. Organizer and moderator access must be " +
      "approved by a QuestBoard admin; your request is sent after your account is created."
    : "Requesting organizer or moderator access isn't available yet. " +
      "Every new account is a student account.";

  return (
    <>
      <h2 className="screen-title">Create your account</h2>

      <form onSubmit={handleSubmit} noValidate>
        <div className="field">
          <label htmlFor="name">Name</label>
          <input
            type="text"
            id="name"
            autoComplete="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            className={errors.name ? "invalid" : ""}
          />
          <p className="error">{errors.name}</p>
        </div>

        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            type="email"
            id="email"
            placeholder="you@aup.edu"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className={errors.email ? "invalid" : ""}
          />
          <p className="error">{errors.email}</p>
        </div>

        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            type="password"
            id="password"
            autoComplete="new-password"
            aria-describedby="password-hint"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className={errors.password ? "invalid" : ""}
          />
          <p className="hint" id="password-hint">
            {PASSWORD_MIN_LENGTH}–{PASSWORD_MAX_LENGTH} characters.
          </p>
          <p className="error">{errors.password}</p>
        </div>

        <div className="field">
          <label htmlFor="confirm-password">Confirm password</label>
          <input
            type="password"
            id="confirm-password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            className={errors.confirmPassword ? "invalid" : ""}
          />
          <p className="error">{errors.confirmPassword}</p>
        </div>

        <fieldset className="role-requests" disabled={!canRequestRoles}>
          <legend>Request extra access (optional)</legend>
          <p className="hint" id="role-hint">{roleHint}</p>
          {REQUESTABLE_ROLES.map((role) => (
            <label className="checkbox" key={role}>
              <input
                type="checkbox"
                aria-describedby="role-hint"
                checked={requestedRoles.includes(role)}
                onChange={() => toggleRole(role)}
              />
              Request {roleLabel(role)} access (requires approval)
            </label>
          ))}

          {canRequestRoles && requestedRoles.length > 0 && (
            <div className="field reason">
              <label htmlFor="reason">Why do you need this access? (optional)</label>
              <textarea
                id="reason"
                rows="3"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                className={errors.reason ? "invalid" : ""}
              />
              <p className="error">{errors.reason}</p>
            </div>
          )}
        </fieldset>

        <button type="submit" className="button" disabled={isSubmitting}>
          {isSubmitting ? "Creating account…" : "Sign up"}
        </button>

        <p className="form-error" role="alert">{formError}</p>
      </form>

      <p className="signup">
        Already have an account?{" "}
        <button
          type="button"
          className="link-button"
          onClick={onBackToLogin}
          disabled={isSubmitting}
        >
          Back to login
        </button>
      </p>
    </>
  );
}

export default Signup;
