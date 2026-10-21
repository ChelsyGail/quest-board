import { useEffect, useState } from "react";
import { listParticipants } from "./api.js";
import { formatItemTime } from "./dates.js";
import { itemKindLabel, statusLabel } from "./format.js";

// Everyone who joined one of the organizer's own items (FE-17). Only the item's owner
// may see this list; the backend checks that on every request.
function ItemParticipants({ session, item, onBack, onSessionExpired }) {
  const [participants, setParticipants] = useState([]);
  // "loading", "loaded", "error", "forbidden" or "gone"
  const [status, setStatus] = useState("loading");
  const [loadError, setLoadError] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    let ignore = false;
    // Once a list is shown, reloads keep it on screen instead of replacing it.
    const keepList = status === "loaded";
    if (keepList) {
      setIsRefreshing(true);
    } else {
      setStatus("loading");
    }

    listParticipants(item.id, session.token)
      .then((list) => {
        if (ignore) return;
        setParticipants(list);
        setStatus("loaded");
        setLoadError("");
        setIsRefreshing(false);
      })
      .catch((error) => {
        if (ignore) return;
        setIsRefreshing(false);
        if (error.status === 401) {
          onSessionExpired();
        } else if (error.status === 403) {
          setStatus("forbidden");
        } else if (error.status === 404) {
          setStatus("gone");
        } else if (keepList) {
          setLoadError(`The list couldn't be refreshed. ${error.message}`);
        } else {
          setLoadError(`Participants couldn't be loaded. ${error.message}`);
          setStatus("error");
        }
      });

    return () => {
      ignore = true;
    };
    // `status` and onSessionExpired are left out on purpose: only these should reload.
  }, [item.id, session.token, loadAttempt]);

  const reload = () => setLoadAttempt((attempt) => attempt + 1);

  let content;
  if (status === "loading") {
    content = (
      <p className="muted" role="status">
        Loading participants…
      </p>
    );
  } else if (status === "forbidden") {
    content = (
      <p className="form-error" role="alert">
        Only the organizer who created this item can see who joined it.
      </p>
    );
  } else if (status === "gone") {
    content = (
      <p className="form-error" role="alert">
        This item no longer exists, so its participants can't be shown.
      </p>
    );
  } else if (status === "error") {
    content = (
      <>
        <p className="form-error" role="alert">
          {loadError}
        </p>
        <button type="button" className="button button-secondary" onClick={reload}>
          Try again
        </button>
      </>
    );
  } else {
    const count = participants.length;
    content = (
      <>
        <div className="list-toolbar">
          <p className="small" role="status">
            {count === 0
              ? "Nobody has joined yet."
              : `${count} ${count === 1 ? "person has" : "people have"} joined.`}
          </p>
          <button
            type="button"
            className="button button-secondary button-small"
            onClick={reload}
            disabled={isRefreshing}
          >
            {isRefreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>
        <p className="form-error" role="alert">
          {loadError}
        </p>
        {count > 0 && (
          <ul className="request-list">
            {participants.map((participant) => (
              <li key={participant.id} className="request-item">
                <div className="request-heading">
                  <strong>{participant.name}</strong>
                  <span className={`status status-${participant.status}`}>
                    {statusLabel(participant.status)}
                  </span>
                </div>
                {participant.joinedAt && (
                  <p className="small muted request-meta">
                    Joined {formatItemTime(participant.joinedAt, item.timeZone)}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </>
    );
  }

  return (
    <>
      <h2 className="screen-title">Participants</h2>
      <p className="hint section-hint">
        {itemKindLabel(item.kind)} "{item.title}" ·{" "}
        {formatItemTime(item.startsAt, item.timeZone)}
      </p>
      {content}
      <button type="button" className="button button-secondary button-block" onClick={onBack}>
        Back to my items
      </button>
    </>
  );
}

export default ItemParticipants;
