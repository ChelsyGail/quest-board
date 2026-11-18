import { useEffect, useId, useRef, useState } from "react";
import AdminRoleRequests from "./AdminRoleRequests.jsx";
import CreateEvent from "./CreateEvent.jsx";
import {
  getCurrentUser,
  questsDemoEnabled,
  questsEnabled,
  resetDemoQuests,
  roleRequestsEnabled,
} from "./api.js";
import { resetDemoDiscussions } from "./discussionsDemo.js";
import JoinedQuests from "./JoinedQuests.jsx";
import Login from "./Login.jsx";
import ModeratorQueue from "./ModeratorQueue.jsx";
import MyQuests from "./MyQuests.jsx";
import Profile from "./Profile.jsx";
import { resetDemoProofs } from "./proofs.js";
import QuestBoard from "./QuestBoard.jsx";
import QuestGrove from "./QuestGrove.jsx";
import RewardsPage, { OrganizerRewards } from "./RewardsPage.jsx";
import { resetDemoRewards } from "./rewards.js";
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

function defaultSignedInPage() {
  return questsEnabled() ? "quests" : "account";
}

function AccountMenu({ profile, showAdmin, onAccount, onAdmin, onLogout }) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const rootRef = useRef(null);
  const label = profile?.name || "Account";
  const initials = (profile?.name || "QB")
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event) {
      if (rootRef.current && !rootRef.current.contains(event.target)) {
        setOpen(false);
      }
    }

    function onKeyDown(event) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function choose(action) {
    setOpen(false);
    action();
  }

  return (
    <div className="account-menu" ref={rootRef}>
      <button
        type="button"
        className="account-menu-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="account-avatar" aria-hidden="true">
          {initials}
        </span>
        <span className="account-menu-label">
          <span className="account-menu-name">{label}</span>
          <span className="small muted">Account</span>
        </span>
      </button>
      {open && (
        <div className="account-menu-panel" id={menuId} role="menu">
          {profile?.email && (
            <p className="account-menu-email small muted" role="presentation">
              {profile.email}
            </p>
          )}
          <button type="button" role="menuitem" onClick={() => choose(onAccount)}>
            Account settings
          </button>
          {showAdmin && (
            <button type="button" role="menuitem" onClick={() => choose(onAdmin)}>
              Role requests
            </button>
          )}
          <button type="button" role="menuitem" onClick={() => choose(onLogout)}>
            Log out
          </button>
        </div>
      )}
    </div>
  );
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
  // When signed in: "account", "quests", "joined", "my-quests", "grove", "create-event" or
  // "admin".
  const [page, setPage] = useState(defaultSignedInPage);
  const [openCreate, setOpenCreate] = useState(false);
  // An item opened from My quests, whose details replace that page until Back.
  const [openedItem, setOpenedItem] = useState(null);
  const [demoVersion, setDemoVersion] = useState(0);
  const [isResettingDemo, setIsResettingDemo] = useState(false);
  const demoMode = questsDemoEnabled();

  function endSession(message) {
    sessionStorage.removeItem(SESSION_KEY);
    setSession(null);
    setProfile(null);
    setProfileStatus("loading");
    setPage(defaultSignedInPage());
    setOpenCreate(false);
    setOpenedItem(null);
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
    setPage(defaultSignedInPage());
    setOpenCreate(false);
    setOpenedItem(null);
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

  function showPage(name, options = {}) {
    setPage(name);
    setOpenCreate(Boolean(options.openCreate));
    setOpenedItem(null);
    setNotice("");
  }

  async function handleResetDemo() {
    if (isResettingDemo || !demoMode) return;
    setIsResettingDemo(true);
    setOpenedItem(null);
    resetDemoDiscussions();
    resetDemoProofs();
    resetDemoRewards();
    await resetDemoQuests();
    setDemoVersion((version) => version + 1);
    setIsResettingDemo(false);
  }

  if (!session) {
    return (
      <main className="page page-auth">
        <section className="card card-auth">
          <header className="brand">
            <h1>QuestBoard</h1>
            <p className="tagline">Find something to do. Find someone to go with.</p>
            <p className="audience">For AUP students</p>
          </header>

          {notice && <p className="notice">{notice}</p>}

          {screen === "signup" ? (
            <Signup
              onAuthenticated={handleAuthenticated}
              onAccountCreated={handleAccountCreated}
              onBackToLogin={() => showScreen("login")}
            />
          ) : (
            <Login
              initialEmail={loginEmail}
              onAuthenticated={handleAuthenticated}
              onShowSignup={() => showScreen("signup")}
            />
          )}
        </section>
      </main>
    );
  }

  return renderSignedIn();

  function renderSignedIn() {
    // Which pages are offered is only a convenience; the backend checks the user's roles
    // on every request.
    const roles = profileStatus === "loaded" ? profile.roles : [];
    const questsOn = questsEnabled();
    const showAdmin = roles.includes("admin") && roleRequestsEnabled();
    const isOrganizer = roles.includes("organizer");
    const isStudent = roles.includes("student");
    const isModerator = roles.includes("moderator");
    const author = {
      id: session.userId,
      name: profile?.name || "You",
      token: session.token,
    };
    const sessionWithName = { ...session, userName: author.name };

    const navPages = [];
    if (profileStatus === "loaded" && questsOn) {
      navPages.push({ id: "quests", label: "Quests" });
      if (isStudent) navPages.push({ id: "joined", label: "My quests" });
      if (isOrganizer) navPages.push({ id: "my-quests", label: "My items" });
      navPages.push({ id: "grove", label: "Quest Grove" });
      if (isStudent || isOrganizer) navPages.push({ id: "rewards", label: "Rewards" });
      if (isModerator) navPages.push({ id: "moderation", label: "Proof review" });
    }

    // The event form always uses the live API, so it isn't offered in demo mode.
    const showCreateEvent = profileStatus === "loaded" && questsOn && isOrganizer && !demoMode;
    const showCreateQuest = profileStatus === "loaded" && questsOn && isOrganizer;

    const allowedPages = new Set(["account", ...navPages.map((item) => item.id)]);
    if (showAdmin) allowedPages.add("admin");
    if (showCreateEvent) allowedPages.add("create-event");
    const currentPage = allowedPages.has(page)
      ? page
      : questsOn && profileStatus === "loaded"
        ? "quests"
        : "account";

    const expiresAt = new Date(session.expiresAt).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });

    let body;
    if (profileStatus === "loading") {
      body = (
        <div className="panel-state" role="status">
          Loading your profile…
        </div>
      );
    } else if (profileStatus === "error") {
      body = (
        <div className="panel-state">
          <p className="form-error form-error-left" role="alert">
            Your profile couldn't be loaded. {profileError}
          </p>
          <button
            type="button"
            className="button button-inline"
            onClick={() => setProfileAttempt((attempt) => attempt + 1)}
          >
            Try again
          </button>
        </div>
      );
    } else if (currentPage === "admin") {
      body = (
        <AdminRoleRequests session={session} onSessionExpired={handleSessionRejected} />
      );
    } else if (currentPage === "quests") {
      body = (
        <QuestBoard
          key={`quests-${demoVersion}`}
          session={session}
          canJoin={isStudent}
          author={author}
          onSessionExpired={handleSessionRejected}
        />
      );
    } else if (currentPage === "joined" && openedItem) {
      body = (
        <QuestBoard
          key={`joined-item-${openedItem.id}-${demoVersion}`}
          session={session}
          canJoin={isStudent}
          author={author}
          initialItem={openedItem}
          onBack={() => setOpenedItem(null)}
          backLabel="← My quests"
          onSessionExpired={handleSessionRejected}
        />
      );
    } else if (currentPage === "joined") {
      body = (
        <JoinedQuests
          key={`joined-${demoVersion}`}
          session={session}
          onOpenItem={setOpenedItem}
          onBrowse={() => showPage("quests")}
          onSessionExpired={handleSessionRejected}
        />
      );
    } else if (currentPage === "grove") {
      body = (
        <QuestGrove
          key={`grove-${session.userId}-${demoVersion}`}
          author={author}
          onSessionExpired={handleSessionRejected}
        />
      );
    } else if (currentPage === "moderation") {
      body = (
        <ModeratorQueue
          key={`moderation-${demoVersion}`}
          session={sessionWithName}
          onSessionExpired={handleSessionRejected}
        />
      );
    } else if (currentPage === "rewards") {
      body = (
        <div className="page-stack">
          <RewardsPage
            key={`rewards-${demoVersion}`}
            session={sessionWithName}
            onSessionExpired={handleSessionRejected}
          />
          {isOrganizer && (
            <OrganizerRewards
              key={`org-rewards-inline-${demoVersion}`}
              session={sessionWithName}
              onSessionExpired={handleSessionRejected}
            />
          )}
        </div>
      );
    } else if (currentPage === "my-quests") {
      body = (
        <MyQuests
          key={`my-quests-${demoVersion}`}
          session={session}
          openCreate={openCreate}
          onSessionExpired={handleSessionRejected}
        />
      );
    } else if (currentPage === "create-event") {
      body = (
        <section className="section panel">
          <CreateEvent session={session} onSessionExpired={handleSessionRejected} />
        </section>
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
      <div className="app-shell">
        {demoMode && (
          <div className="demo-banner" role="status">
            <div className="demo-banner-copy">
              <span>
                <strong>Demo mode — sample data.</strong> Quest, proof, reward and discussion
                actions stay in this browser tab.
              </span>
              <details className="demo-banner-details">
                <summary>About sample data</summary>
                <p>
                  Posts, proof uploads and reward claims are not shared with other users and are
                  cleared when this tab closes or you reset demo data. Login still uses the real
                  API. Production builds hide these sample adapters.
                </p>
              </details>
            </div>
            <button
              type="button"
              className="button button-secondary button-small"
              onClick={handleResetDemo}
              disabled={isResettingDemo}
            >
              {isResettingDemo ? "Resetting…" : "Reset demo data"}
            </button>
          </div>
        )}

        <header className="app-topbar">
          <div className="app-brand">
            <p className="brand-mark">QuestBoard</p>
            <p className="tagline">Campus adventure noticeboard</p>
          </div>

          {navPages.length > 0 && (
            <nav className="app-nav" aria-label="Pages">
              {navPages.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={currentPage === item.id ? "nav-link active" : "nav-link"}
                  aria-current={currentPage === item.id ? "page" : undefined}
                  onClick={() => showPage(item.id)}
                >
                  {item.label}
                </button>
              ))}
              {showCreateQuest && (
                <button
                  type="button"
                  className="button button-small nav-create"
                  onClick={() => showPage("my-quests", { openCreate: true })}
                >
                  Create quest
                </button>
              )}
              {showCreateEvent && (
                <button
                  type="button"
                  className={
                    currentPage === "create-event"
                      ? "button button-small button-secondary nav-create active"
                      : "button button-small button-secondary nav-create"
                  }
                  aria-current={currentPage === "create-event" ? "page" : undefined}
                  onClick={() => showPage("create-event")}
                >
                  Create event
                </button>
              )}
            </nav>
          )}

          <div className="app-session">
            <span className="small muted session-ends">Session ends at {expiresAt}</span>
            <AccountMenu
              profile={profileStatus === "loaded" ? profile : null}
              showAdmin={showAdmin}
              onAccount={() => showPage("account")}
              onAdmin={() => showPage("admin")}
              onLogout={() => endSession("You have been logged out.")}
            />
          </div>
        </header>

        <div className="app-frame">
          <main className="app-main">
            {notice && <p className="notice">{notice}</p>}
            {body}
          </main>
        </div>
      </div>
    );
  }
}

export default App;
