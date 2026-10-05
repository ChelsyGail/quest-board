import { useState } from "react";
import {
  EMAIL_MAX_LENGTH,
  EMAIL_PATTERN,
  NAME_MAX_LENGTH,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  login,
  registerUser,
} from "./api.js";

function validate(name, email, password, confirmPassword) {
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

  return errors;
}

function Signup({ onAuthenticated, onAccountCreated, onBackToLogin }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    if (isSubmitting) return;

    const newErrors = validate(name, email, password, confirmPassword);
    setErrors(newErrors);
    setFormError("");
    if (Object.keys(newErrors).length > 0) return;

    setIsSubmitting(true);

    let user;
    try {
      user = await registerUser(name.trim(), email.trim(), password);
    } catch (error) {
      setFormError(error.message);
      setIsSubmitting(false);
      return;
    }

    // The account exists now. Log in right away so the user lands on their account screen.
    try {
      const session = await login(user.email, password);
      onAuthenticated({ ...session, user });
    } catch {
      onAccountCreated(user.email);
    }
  }

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
