import { useEffect, useState } from "react";
import {
  isItemNotFound,
  listMyItems,
  publishItem,
  questApiUnavailableMessage,
  questsDemoEnabled,
} from "./api.js";
import { formatItemTime } from "./dates.js";
import { demoListMyItems, demoPublishItem } from "./demoQuests.js";
import EditItem from "./EditItem.jsx";
import { itemKindLabel, itemStatusLabel } from "./format.js";
import ItemParticipants from "./ItemParticipants.jsx";

function byStartTime(a, b) {
  return Date.parse(a.startsAt) - Date.parse(b.startsAt) || Number(a.id) - Number(b.id);
}

// The live API, or the in-browser sample data when demo mode is explicitly on. Editing and
// participants always use the live API, so demo mode doesn't offer them.
function itemsApi(session) {
  if (questsDemoEnabled()) {
    return { isDemo: true, list: demoListMyItems, publish: demoPublishItem };
  }
  return {
    isDemo: false,
    list: () => listMyItems(session.token),
    publish: (itemId) => publishItem(itemId, session.token),
  };
}

// Organizer page listing their own events and quests (drafts included), from which each
// one can be published (QB-60), edited (FE-14) or its participants shown (FE-17). The
// backend checks the organizer role and ownership on every request.
// `createdItem`: an item just created on this page, shown without waiting for a reload.
// Changing `reloadKey` reloads the list.
function MyItems({ session, onSessionExpired, createdItem = null, reloadKey = 0 }) {
  const api = itemsApi(session);
  const [items, setItems] = useState([]);
  const [status, setStatus] = useState("loading"); // "loading", "loaded", "error", "forbidden"
  const [loadError, setLoadError] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);
  // The item whose edit or participants screen is open: { id, screen } or null.
  const [opened, setOpened] = useState(null);
  const [publishingIds, setPublishingIds] = useState([]);
  const [actionError, setActionError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  useEffect(() => {
    let ignore = false;
    setStatus("loading");

    api
      .list()
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
          setLoadError(questApiUnavailableMessage(error, "load your items"));
          setStatus("error");
        }
      });

    return () => {
      ignore = true;
    };
    // onSessionExpired is left out on purpose: a new function each render must not reload.
  }, [session.token, loadAttempt, reloadKey]);

  useEffect(() => {
    if (!createdItem) return;
    setItems((list) =>
      [...list.filter((item) => item.id !== createdItem.id), createdItem].sort(byStartTime)
    );
    // A list that failed to load is still worth showing once it has the new item.
    setStatus((current) => (current === "error" ? "loaded" : current));
  }, [createdItem]);

  function reload() {
    setLoadAttempt((attempt) => attempt + 1);
  }

  function open(item, screen) {
    setOpened({ id: item.id, screen });
    setActionError("");
    setSuccessMessage("");
  }

  function replaceItem(updated) {
    setItems((list) =>
      list.map((item) => (item.id === updated.id ? updated : item)).sort(byStartTime)
    );
  }

  function handleSaved(updated) {
    replaceItem(updated);
    setOpened(null);
    setSuccessMessage(`Your changes to "${updated.title}" were saved.`);
  }

  function handleDone(message, reloadList) {
    setOpened(null);
    setActionError(message);
    if (reloadList) reload();
  }

  async function checkWhetherPublished(item, error) {
    let list;
    try {
      list = await api.list();
    } catch (reloadError) {
      if (reloadError.status === 401) {
        onSessionExpired();
        return;
      }
      setActionError(
        `We couldn't confirm whether "${item.title}" was published. ${error.message} ` +
          "Reload your items to check before trying again."
      );
      return;
    }

    setItems(list);
    const current = list.find((entry) => entry.id === item.id);
    if (current && current.status === "published") {
      setSuccessMessage(`"${item.title}" is now published. Students can see it.`);
    } else {
      setActionError(
        `We couldn't confirm whether "${item.title}" was published. ${error.message} ` +
          "The server still shows it as a draft, so you can publish it again."
      );
    }
  }

  async function handlePublish(item) {
    if (publishingIds.includes(item.id)) return;
    if (Date.now() >= Date.parse(session.expiresAt)) {
      onSessionExpired();
      return;
    }

    setPublishingIds((ids) => [...ids, item.id]);
    setActionError("");
    setSuccessMessage("");
    try {
      replaceItem(await api.publish(item.id));
      setSuccessMessage(`"${item.title}" is now published. Students can see it.`);
    } catch (error) {
      if (error.status === 401) {
        onSessionExpired();
        return;
      }
      if (error.resultUnknown) {
        await checkWhetherPublished(item, error);
      } else if (error.status === 409 && error.code === "item_already_published") {
        setSuccessMessage(`"${item.title}" was already published.`);
        reload();
      } else if (error.status === 409 && error.code === "item_archived") {
        setActionError(`"${item.title}" is archived, so it can't be published.`);
        reload();
      } else if (error.status === 403) {
        setActionError(`You can't publish "${item.title}". ${error.message}`);
      } else if (isItemNotFound(error)) {
        setActionError(`"${item.title}" no longer exists.`);
        reload();
      } else {
        setActionError(
          `"${item.title}" couldn't be published. ` +
            questApiUnavailableMessage(error, `publish "${item.title}"`)
        );
      }
    } finally {
      setPublishingIds((ids) => ids.filter((id) => id !== item.id));
    }
  }

  const openedItem = opened && items.find((item) => item.id === opened.id);
  if (status === "loaded" && openedItem && opened.screen === "edit") {
    return (
      <EditItem
        session={session}
        item={openedItem}
        onSaved={handleSaved}
        onDone={handleDone}
        onSessionExpired={onSessionExpired}
      />
    );
  }
  if (status === "loaded" && openedItem && opened.screen === "participants") {
    return (
      <ItemParticipants
        session={session}
        item={openedItem}
        onBack={() => setOpened(null)}
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
        <button type="button" className="button button-secondary" onClick={reload}>
          Try again
        </button>
      </>
    );
  } else if (items.length === 0) {
    content = <p className="muted">You haven't created any events or quests yet.</p>;
  } else {
    content = (
      <>
        <div className="list-toolbar">
          <span className="muted small">
            {items.length} item{items.length === 1 ? "" : "s"}
          </span>
          <button type="button" className="button button-secondary button-small" onClick={reload}>
            Reload
          </button>
        </div>
        <ul className="request-list">
          {items.map((item) => {
            const isPublishing = publishingIds.includes(item.id);
            return (
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
                  {item.status === "draft" && (
                    <button
                      type="button"
                      className="button button-small"
                      aria-label={`Publish "${item.title}"`}
                      onClick={() => handlePublish(item)}
                      disabled={isPublishing}
                    >
                      {isPublishing ? "Publishing…" : "Publish"}
                    </button>
                  )}
                  {!api.isDemo && (
                    <>
                      <button
                        type="button"
                        className="button button-secondary button-small"
                        aria-label={`Edit "${item.title}"`}
                        onClick={() => open(item, "edit")}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="button button-secondary button-small"
                        aria-label={`Participants of "${item.title}"`}
                        onClick={() => open(item, "participants")}
                      >
                        Participants
                      </button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </>
    );
  }

  return (
    <>
      <h2 className="screen-title">My items</h2>
      <p className="hint section-hint">
        Your events and quests, drafts included. Students only see an item once you publish
        it. Items that have been archived aren't shown.
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
