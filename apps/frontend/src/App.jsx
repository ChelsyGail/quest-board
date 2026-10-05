import { useEffect, useState } from "react";
import Login from "./Login.jsx";
import Profile from "./Profile.jsx";
import Signup from "./Signup.jsx";

// The session is { token, userId, expiresAt, user } and is never stored with a password.
// sessionStorage keeps it across reloads but forgets it when the tab is closed.
const SESSION_KEY = "questboard.session";

function loadSession() {
  try {
    const session = JSON.parse(sessionStorage.getItem(SESSION_KEY));
    if (
      session &&
      typeof session.token === "string" &&
      typeof session.userId === "string" &&
      !Number.isNaN(Date.parse(session.expiresAt))
    ) {
      return session;
    }
  } catch {
    // Ignore unreadable data; it is removed below.
  }
  sessionStorage.removeItem(SESSION_KEY);
  return null;
}

function saveSession(session) {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

function App() {
  const [session, setSession] = useState(loadSession);
  const [screen, setScreen] = useState("login"); // "login" or "signup" when logged out
  const [notice, setNotice] = useState("");
  const [loginEmail, setLoginEmail] = useState("");

  function endSession(message) {
    sessionStorage.removeItem(SESSION_KEY);
    setSession(null);
    setScreen("login");
    setNotice(message);
  }

  // Log the user out when the token's expires_at time passes.
  // Browsers slow down timers in background tabs, so also check when the window regains focus.
  useEffect(() => {
    if (!session) return;

    function checkExpiry() {
      if (Date.now() >= Date.parse(session.expiresAt)) {
        endSession("Your session has expired. Please log in again.");
      }
    }

    checkExpiry();
    const timer = setInterval(checkExpiry, 15000);
    window.addEventListener("focus", checkExpiry);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", checkExpiry);
    };
  }, [session]);

  function handleAuthenticated(newSession) {
    saveSession(newSession);
    setSession(newSession);
    setNotice("");
  }

  function handleUserUpdated(user) {
    // Ignore a save that finishes after the user logged out or the session expired.
    const current = loadSession();
    if (!current || current.token !== session?.token) return;

    const updatedSession = { ...current, user };
    saveSession(updatedSession);
    setSession(updatedSession);
  }

  function handleAccountCreated(email) {
    setLoginEmail(email);
    setScreen("login");
    setNotice("Your account was created. Please log in.");
  }

  function showScreen(name) {
    setScreen(name);
    setNotice("");
  }

  let content;
  if (session) {
    content = (
      <Profile
        session={session}
        onUserUpdated={handleUserUpdated}
        onLogout={() => endSession("You have been logged out.")}
        onSessionExpired={() => endSession("Your session has expired. Please log in again.")}
      />
    );
  } else if (screen === "signup") {
    content = (
      <Signup
        onAuthenticated={handleAuthenticated}
        onAccountCreated={handleAccountCreated}
        onBackToLogin={() => showScreen("login")}
      />
    );
  } else {
    content = (
      <Login
        initialEmail={loginEmail}
        onAuthenticated={handleAuthenticated}
        onShowSignup={() => showScreen("signup")}
      />
    );
  }

  return (
    <main className="page">
      <section className="card">
        <header className="brand">
          <h1>QuestBoard</h1>
          <p className="tagline">Find something to do. Find someone to go with.</p>
          <p className="audience">For AUP students</p>
        </header>

        {notice && <p className="notice">{notice}</p>}

        {content}
      </section>
    </main>
  );
}

export default App;
