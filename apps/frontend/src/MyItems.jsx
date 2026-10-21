import { useEffect, useState } from "react";
import { listMyItems } from "./api.js";
import { formatItemTime } from "./dates.js";
import EditItem from "./EditItem.jsx";
import { itemKindLabel, itemStatusLabel } from "./format.js";

function byStartTime(a, b) {
  return Date.parse(a.startsAt) - Date.parse(b.startsAt) || Number(a.id) - Number(b.id);
}

// Organizer page listing their own events and quests (drafts included), from which each
// one can be edited (FE-14). The backend checks the organizer role on every request.
function MyItems({ session, onSessionExpired }) {
  const [items, setItems] = useState([]);
  const [status, setStatus] = useState("loading"); // "loading", "loaded", "error", "forbidden"
  const [loadError, setLoadError] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [editingId, setEditingId] = useState(null);
  const [actionError, setActionError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  useEffect(() => {
    let ignore = false;
    setStatus("loading");

    listMyItems(session.token)
      .then((list) => {
        if (ignore) return;
        setItems(list);
        setStatus("loaded");
      })
      .catch((error) => {
        if (ignore) return;
        if (error.status === 401) {
          onSessionExpired();
        } else if (error.status === 403) {
          setStatus("forbidden");
        } else {
          setLoadError(error.message);
          setStatus("error");
        }
      });

    return () => {
      ignore = true;
    };
    // onSessionExpired is left out on purpose: a new function each render must not reload.
  }, [session.token, loadAttempt]);

  function startEditing(item) {
    setEditingId(item.id);
    setActionError("");
    setSuccessMessage("");
  }

  function handleSaved(updated) {
    setItems((list) =>
      list.map((item) => (item.id === updated.id ? updated : item)).sort(byStartTime)
    );
    setEditingId(null);
    setSuccessMessage(`Your changes to "${updated.title}" were saved.`);
  }

  function handleDone(message, reload) {
    setEditingId(null);
    setActionError(message);
    if (reload) {
      setStatus("loading");
      setLoadAttempt((attempt) => attempt + 1);
    }
  }

  const editing = items.find((item) => item.id === editingId);
  if (status === "loaded" && editing) {
    return (
      <EditItem
        session={session}
        item={editing}
        onSaved={handleSaved}
        onDone={handleDone}
        onSessionExpired={onSessionExpired}
      />
    );
  }

  let content;
  if (status === "loading") {
    content = (
      <p className="muted" role="status">
        Loading your items…
      </p>
    );
  } else if (status === "forbidden") {
    content = (
      <p className="form-error" role="alert">
        Your account doesn't have organizer access, so your items can't be shown.
      </p>
    );
  } else if (status === "error") {
    content = (
      <>
        <p className="form-error" role="alert">
          Your items couldn't be loaded. {loadError}
        </p>
        <button
          type="button"
          className="button button-secondary"
          onClick={() => setLoadAttempt((attempt) => attempt + 1)}
        >
          Try again
        </button>
      </>
    );
  } else if (items.length === 0) {
    content = <p className="muted">You haven't created any events or quests yet.</p>;
  } else {
    content = (
      <ul className="request-list">
        {items.map((item) => (
          <li key={item.id} className="request-item">
            <div className="request-heading">
              <strong>{item.title}</strong>
              <span className={`status status-${item.status}`}>
                {itemStatusLabel(item.status)}
              </span>
            </div>
            <p className="small muted request-meta">
              {`${itemKindLabel(item.kind)} · ` +
                `${formatItemTime(item.startsAt, item.timeZone)} ` +
                `(${item.timeZone.replace(/_/g, " ")}) · ${item.location}`}
            </p>
            <div className="request-actions">
              <button
                type="button"
                className="button button-secondary button-small"
                aria-label={`Edit "${item.title}"`}
                onClick={() => startEditing(item)}
              >
                Edit
              </button>
            </div>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <>
      <h2 className="screen-title">My items</h2>
      <p className="hint section-hint">
        Your events and quests, drafts included. Items that have been archived aren't shown.
      </p>
      <p className="form-error" role="alert">
        {actionError}
      </p>
      <p className="message" aria-live="polite">
        {successMessage}
      </p>
      {content}
    </>
  );
}

export default MyItems;
