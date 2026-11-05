import { useEffect, useMemo, useState } from "react";
import { getQuestClient, questApiUnavailableMessage } from "./api.js";
import { browserTimeZone } from "./dates.js";
import MonthCalendar from "./MonthCalendar.jsx";
import {
  filterByTime,
  formatDayKey,
  groupByStartDay,
  joinedEntries,
  participationStatusLabel,
} from "./myQuests.js";
import QuestCard from "./QuestCard.jsx";

const TIME_FILTERS = [
  { id: "upcoming", label: "Upcoming" },
  { id: "past", label: "Past" },
  { id: "all", label: "All" },
];

const EMPTY_MESSAGES = {
  upcoming: "Nothing coming up. Quests and events you join appear here until they end.",
  past: "Nothing in the past yet. Quests and events you joined move here once they end.",
  all: "",
};

// The student's own joined quests and RSVP'd events from GET /me/participations, as a
// list grouped by day or a month calendar. Items that are only saved aren't shown. The
// page loads on every visit, so anything joined meanwhile is included.
function JoinedQuests({ session, onOpenItem, onBrowse, onSessionExpired }) {
  const timeZone = browserTimeZone();
  // Loaded entries are kept with the account they belong to, so another account's list
  // is never shown, not even for one render.
  const [loaded, setLoaded] = useState({ userId: null, entries: [] });
  const [status, setStatus] = useState("loading"); // "loading", "loaded", "error"
  const [loadError, setLoadError] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [timeFilter, setTimeFilter] = useState("upcoming");
  const [view, setView] = useState("list");
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let ignore = false;
    setStatus("loading");
    setLoaded((current) =>
      current.userId === session.userId ? current : { userId: null, entries: [] }
    );

    getQuestClient(session)
      .listMyParticipations()
      .then((entries) => {
        if (ignore) return;
        setLoaded({ userId: session.userId, entries: joinedEntries(entries) });
        setNow(Date.now());
        setStatus("loaded");
      })
      .catch((error) => {
        if (ignore) return;
        if (error.status === 401) {
          onSessionExpired();
          return;
        }
        setLoadError(questApiUnavailableMessage(error, "load your quests"));
        setStatus("error");
      });

    return () => {
      ignore = true;
    };
    // onSessionExpired is left out on purpose: a new function each render must not reload.
  }, [session.token, session.userId, loadAttempt]);

  const entries = loaded.userId === session.userId ? loaded.entries : [];
  const visible = useMemo(() => filterByTime(entries, timeFilter, now), [entries, timeFilter, now]);
  const groups = useMemo(() => groupByStartDay(visible, timeZone), [visible, timeZone]);

  function reload() {
    setLoadAttempt((attempt) => attempt + 1);
  }

  let body;
  if (status === "loading" && entries.length === 0) {
    body = (
      <p className="panel-state muted" role="status">
        Loading your quests…
      </p>
    );
  } else if (status === "error") {
    body = (
      <div className="panel-state" role="alert">
        <p className="error">{loadError}</p>
        <button type="button" className="button button-secondary button-small" onClick={reload}>
          Try again
        </button>
      </div>
    );
  } else if (entries.length === 0) {
    body = (
      <div className="panel-state">
        <p className="muted">
          You haven't joined any quests or RSVP'd to any events yet. Saved items aren't listed
          here until you join them.
        </p>
        <button type="button" className="button button-secondary button-small" onClick={onBrowse}>
          Browse quests and events
        </button>
      </div>
    );
  } else if (view === "calendar") {
    body = (
      <MonthCalendar entries={visible} timeZone={timeZone} now={now} onOpenItem={onOpenItem} />
    );
  } else if (visible.length === 0) {
    body = <p className="panel-state muted">{EMPTY_MESSAGES[timeFilter]}</p>;
  } else {
    body = groups.map((group) => (
      <section key={group.key} className="joined-day" aria-labelledby={`joined-day-${group.key}`}>
        <h3 className="joined-day-title" id={`joined-day-${group.key}`}>
          {formatDayKey(group.key)}
        </h3>
        <ul className="quest-grid discovery-grid">
          {group.entries.map(({ item, participation }) => (
            <QuestCard
              key={item.id}
              quest={item}
              participationStatus={participation.status}
              statusLabel={participationStatusLabel(participation.status)}
              onView={() => onOpenItem(item)}
            />
          ))}
        </ul>
      </section>
    ));
  }

  return (
    <div className="page-stack">
      <header className="page-header list-toolbar joined-header">
        <div>
          <h2 className="screen-title">My quests</h2>
          <p className="page-lede">
            Quests you joined and events you RSVP'd to, with the status the organizer gave
            your participation.
          </p>
        </div>
        <button
          type="button"
          className="button button-secondary button-small"
          onClick={reload}
          disabled={status === "loading"}
        >
          {status === "loading" ? "Refreshing…" : "Refresh"}
        </button>
      </header>

      <div className="joined-controls discovery-filters">
        <div className="chip-row" role="group" aria-label="Show">
          {TIME_FILTERS.map((filter) => (
            <button
              key={filter.id}
              type="button"
              className={`chip${timeFilter === filter.id ? " chip-active" : ""}`}
              aria-pressed={timeFilter === filter.id}
              onClick={() => setTimeFilter(filter.id)}
            >
              {filter.label}
            </button>
          ))}
        </div>
        <div className="tabs view-toggle" role="group" aria-label="View">
          {["list", "calendar"].map((id) => (
            <button
              key={id}
              type="button"
              className={`tab${view === id ? " active" : ""}`}
              aria-pressed={view === id}
              onClick={() => setView(id)}
            >
              {id === "list" ? "List" : "Calendar"}
            </button>
          ))}
        </div>
      </div>

      {body}
    </div>
  );
}

export default JoinedQuests;
