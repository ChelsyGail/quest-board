import { useEffect, useState } from "react";
import AdminRoleRequests from "./AdminRoleRequests.jsx";
import { getCurrentUser } from "./api.js";
import CreateEvent from "./CreateEvent.jsx";
import Login from "./Login.jsx";
import MyItems from "./MyItems.jsx";
import { pagesFor, resolvePage } from "./navigation.js";
import Profile from "./Profile.jsx";
import Signup from "./Signup.jsx";

// The session is { token, userId, expiresAt } and is never stored with a password.
// This is a stopgap until the backend supports HttpOnly cookie sessions: sessionStorage
// is readable by any script on the page, keeps the token across reloads, and forgets it
// when the tab is closed. It is not "stay logged in". The stored token is only trusted
// after the backend accepts it (GET /users/me is loaded before any signed-in page).
const SESSION_KEY = "questboard.session";

function loadSession() {
  try {
    const stored = JSON.parse(sessionStorage.getItem(SESSION_KEY));
    if (
      stored &&
      typeof stored.token === "string" &&
      typeof stored.userId === "string" &&
      !Number.isNaN(Date.parse(stored.expiresAt))
    ) {
      return { token: stored.token, userId: stored.userId, expiresAt: stored.expiresAt };
    }
  } catch {
    // Ignore unreadable data; it is removed below.
  }
  sessionStorage.removeItem(SESSION_KEY);
  return null;
}

function saveSession(session) {
  const { token, userId, expiresAt } = session;
  sessionStorage.setItem(SESSION_KEY, JSON.stringify({ token, userId, expiresAt }));
}

function App() {
  const [session, setSession] = useState(loadSession);
  const [screen, setScreen] = useState("login"); // "login" or "signup" when logged out
  const [notice, setNotice] = useState("");
  const [loginEmail, setLoginEmail] = useState("");
  // The signed-in user's profile from GET /users/me. `profileStatus` is one of:
  // "loading", "loaded", "error" (could not load; can retry), or
  // "unavailable" (this backend has no /users/me yet).
  const [profile, setProfile] = useState(null);
  const [profileStatus, setProfileStatus] = useState("loading");
  const [profileError, setProfileError] = useState("");
  const [profileAttempt, setProfileAttempt] = useState(0);
  const [page, setPage] = useState("account"); // the requested page ID when signed in

  function endSession(message) {
    sessionStorage.removeItem(SESSION_KEY);
    setSession(null);
    setProfile(null);
    setProfileStatus("loading");
    setPage("account");
    setScreen("login");
    setNotice(message);
  }

  function handleSessionRejected() {
    endSession("Your session has expired or is no longer valid. Please log in again.");
  }

  const token = session ? session.token : null;
  useEffect(() => {
    if (!token) return;
    let ignore = false;
    setProfileStatus("loading");

    getCurrentUser(token)
      .then((user) => {
        if (ignore) return;
        setProfile(user);
        setProfileStatus("loaded");
      })
      .catch((error) => {
        if (ignore) return;
        if (error.status === 401) {
          handleSessionRejected();
        } else if (error.isUnsupported) {
          setProfile(null);
          setProfileStatus("unavailable");
        } else {
          setProfileError(error.message);
          setProfileStatus("error");
        }
      });

    return () => {
      ignore = true;
    };
  }, [token, profileAttempt]);

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

  function handleAuthenticated(newSession, message = "") {
    saveSession(newSession);
    setProfile(null);
    setProfileStatus("loading");
    setPage("account");
    setSession(newSession);
    setNotice(message);
  }

  function handleAccountCreated(email, extraMessage = "") {
    setLoginEmail(email);
    setScreen("login");
    setNotice(`Your account was created. Please log in. ${extraMessage}`.trim());
  }

  function showScreen(name) {
    setScreen(name);
    setNotice("");
  }

  function showPage(name) {
    setPage(name);
    setNotice("");
  }

  // Until the profile has loaded the roles are unknown, so only pages everyone may see
  // are offered. A page the user can no longer see (e.g. after a refresh removed a role)
  // falls back to the default page.
  const pages = pagesFor(profileStatus === "loaded" ? profile.roles : []);
  const currentPage = session ? resolvePage(pages, page) : null;

  let content;
  if (session) {
    content = renderSignedIn();
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

  function renderSignedIn() {
    const expiresAt = new Date(session.expiresAt).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });

    let body;
    if (profileStatus === "loading") {
      body = (
        <p className="muted" role="status">
          Loading your profile…
        </p>
      );
    } else if (profileStatus === "error") {
      body = (
        <>
          <p className="form-error" role="alert">
            Your profile couldn't be loaded. {profileError}
          </p>
          <button
            type="button"
            className="button"
            onClick={() => setProfileAttempt((attempt) => attempt + 1)}
          >
            Try again
          </button>
        </>
      );
    } else if (currentPage.id === "my-items") {
      body = <MyItems session={session} onSessionExpired={handleSessionRejected} />;
    } else if (currentPage.id === "create-event") {
      body = <CreateEvent session={session} onSessionExpired={handleSessionRejected} />;
    } else if (currentPage.id === "admin") {
      body = (
        <AdminRoleRequests session={session} onSessionExpired={handleSessionRejected} />
      );
    } else {
      body = (
        <Profile
          session={session}
          profile={profile}
          onProfileUpdated={setProfile}
          onSessionExpired={handleSessionRejected}
        />
      );
    }

    return (
      <>
        {pages.length > 1 && (
          <nav className="tabs" aria-label="Pages">
            {pages.map((item) => (
              <button
                key={item.id}
                type="button"
                className={item === currentPage ? "tab active" : "tab"}
                aria-current={item === currentPage ? "page" : undefined}
                onClick={() => showPage(item.id)}
              >
                {item.label}
              </button>
            ))}
          </nav>
        )}

        {body}

        <div className="account-footer">
          <span className="small muted">Session ends at {expiresAt}</span>
          <button
            type="button"
            className="button button-secondary"
            onClick={() => endSession("You have been logged out.")}
          >
            Log out
          </button>
        </div>
      </>
    );
  }

  return (
    <main className="page">
      <section className={currentPage && currentPage.wide ? "card card-wide" : "card"}>
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
