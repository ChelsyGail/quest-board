import { useState } from "react";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function App() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [emailError, setEmailError] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [message, setMessage] = useState("");

  function handleSubmit(event) {
    event.preventDefault();

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

    if (newEmailError === "" && newPasswordError === "") {
      setMessage("Login UI ready — authentication will be connected later.");
    } else {
      setMessage("");
    }
  }

  return (
    <main className="page">
      <section className="card">
        <header className="brand">
          <h1>QuestBoard</h1>
          <p className="tagline">Find something to do. Find someone to go with.</p>
          <p className="audience">For AUP students</p>
        </header>

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
              <a href="#" className="link small">Forgot password?</a>
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

          <button type="submit" className="button">Log in</button>

          <p className="message" aria-live="polite">{message}</p>
        </form>

        <p className="signup">
          New to QuestBoard? <a href="#" className="link">Sign up</a>
        </p>
      </section>
    </main>
  );
}

export default App;
