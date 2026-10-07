import { useState } from "react";
import { EMAIL_PATTERN, login } from "./api.js";

function Login({ initialEmail, onAuthenticated, onShowSignup }) {
  const [email, setEmail] = useState(initialEmail || "");
  const [password, setPassword] = useState("");
  const [emailError, setEmailError] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [formError, setFormError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    if (isSubmitting) return;

    let newEmailError = "";
    let newPasswordError = "";

    if (email.trim() === "") {
      newEmailError = "Please enter your email.";
    } else if (!EMAIL_PATTERN.test(email.trim())) {
      newEmailError = "Please enter a valid email address.";
    }

    if (password === "") {
      newPasswordError = "Please enter your password.";
    }

    setEmailError(newEmailError);
    setPasswordError(newPasswordError);
    setFormError("");
    if (newEmailError || newPasswordError) return;

    setIsSubmitting(true);
    try {
      const session = await login(email.trim(), password);
      onAuthenticated(session);
    } catch (error) {
      setFormError(
        error.status === 401 ? "Email or password is incorrect." : error.message
      );
      setIsSubmitting(false);
    }
  }

  return (
    <>
      <form onSubmit={handleSubmit} noValidate>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            type="email"
            id="email"
            placeholder="you@aup.edu"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className={emailError ? "invalid" : ""}
          />
          <p className="error">{emailError}</p>
        </div>

        <div className="field">
          <div className="label-row">
            <label htmlFor="password">Password</label>
            <span className="unavailable small" title="Password reset is not available yet.">
              Forgot password? Not available yet
            </span>
          </div>
          <input
            type="password"
            id="password"
            placeholder="••••••••"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className={passwordError ? "invalid" : ""}
          />
          <p className="error">{passwordError}</p>
        </div>

        <button type="submit" className="button" disabled={isSubmitting}>
          {isSubmitting ? "Logging in…" : "Log in"}
        </button>

        <p className="form-error" role="alert">{formError}</p>
      </form>

      <p className="signup">
        New to QuestBoard?{" "}
        <button type="button" className="link-button" onClick={onShowSignup}>
          Sign up
        </button>
      </p>
    </>
  );
}

export default Login;
