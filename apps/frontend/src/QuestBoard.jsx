import { useEffect, useMemo, useState } from "react";
import { getQuestClient, isItemNotFound, questApiUnavailableMessage } from "./api.js";
import { formatItemWindow } from "./dates.js";
import { resolveQuestDiscussionPhase } from "./discussions.js";
import { itemKindLabel } from "./format.js";
import { participationStatusLabel } from "./myQuests.js";
import QuestDiscussion from "./QuestDiscussion.jsx";
import { bannerClassName } from "./questBanners.js";
import {
  EMPTY_FILTERS,
  catalogueQuery,
  categoryOptions,
  filtersActive as hasActiveFilters,
} from "./questFilters.js";
import ProofSubmit from "./ProofSubmit.jsx";
import QuestCard from "./QuestCard.jsx";

const SEARCH_DELAY_MS = 300;

const DATE_OPTIONS = [
  { id: "all", label: "Any time" },
  { id: "today", label: "Today" },
  { id: "week", label: "Next 7 days" },
  { id: "range", label: "Date range" },
];

function joinedLabel(item) {
  return item.kind === "event" ? `You're going to "${item.title}".` : `You joined "${item.title}".`;
}

function countLabel(count) {
  return count === 1 ? "1 quest or event" : `${count} quests and events`;
}

// Published quests and events (GET /items), their details (GET /items/{id}) and joining or
// RSVPing (POST /items/{id}/join, QB-90). Search, category, dates and paging all happen on
// the server, so every page is part of the complete filtered catalogue.
// `initialItem` opens straight on that item's details, and `onBack` then replaces going
// back to the list (used when another page opened the item). `author` is { id, name }.
function QuestBoard({
  session,
  canJoin,
  onSessionExpired,
  author,
  initialItem = null,
  onBack = null,
  backLabel = "← All quests and events",
}) {
  const client = getQuestClient(session);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState({ items: [], page: null });
  const [status, setStatus] = useState("loading");
  const [loadError, setLoadError] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);
  // Which request `result` and `loadError` answer. The render right after a filter or page
  // change still holds the previous answer, which must not be shown under the new filters.
  const [answeredKey, setAnsweredKey] = useState(null);

  // itemId -> participation, from GET /me/participations. Loaded separately so that a
  // failure here never hides the catalogue.
  const [participations, setParticipations] = useState(() => new Map());
  const [participationStatus, setParticipationStatus] = useState("loading");
  const [participationAttempt, setParticipationAttempt] = useState(0);

  // The item opened from the list, and its current details from the backend.
  const [selected, setSelected] = useState(initialItem);
  const [detail, setDetail] = useState({ status: "idle", item: null });
  const [isJoining, setIsJoining] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);
  const [actionError, setActionError] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  // Authoritative proof submission for the open quest (from ProofSubmit), not guessed from join status.
  const [proofByItem, setProofByItem] = useState(() => new Map());

  const query = useMemo(
    () => catalogueQuery({ ...filters, query: searchQuery }, page),
    // The search box is debounced into searchQuery, so filters.query is left out.
    [searchQuery, filters.category, filters.dateFilter, filters.from, filters.to, page]
  );
  const queryKey = JSON.stringify(query);
  const requestKey = `${queryKey}#${loadAttempt}#${session.userId}`;

  useEffect(() => {
    if (filters.query === searchQuery) return undefined;
    const timer = setTimeout(() => {
      setSearchQuery(filters.query);
      setPage(1);
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [filters.query, searchQuery]);

  useEffect(() => {
    // Opened on one item from another page: the catalogue isn't shown, so isn't loaded.
    if (query.error || onBack) return undefined;
    // Cleared when the query changes, so an older response can't replace a newer one.
    let ignore = false;

    client
      .listPublishedItems(query)
      .then((loaded) => {
        if (ignore) return;
        if (loaded.page.totalPages > 0 && query.page > loaded.page.totalPages) {
          // The catalogue shrank since the last page was loaded.
          setPage(loaded.page.totalPages);
          return;
        }
        setResult(loaded);
        setStatus("loaded");
        setAnsweredKey(requestKey);
      })
      .catch((error) => {
        if (ignore) return;
        if (error.status === 401) {
          onSessionExpired();
          return;
        }
        setLoadError(questApiUnavailableMessage(error, "load the quest board"));
        setStatus("error");
        setAnsweredKey(requestKey);
      });

    return () => {
      ignore = true;
    };
    // onSessionExpired and client are left out on purpose: new functions each render.
  }, [queryKey, loadAttempt, session.token, session.userId]);

  useEffect(() => {
    let ignore = false;
    setParticipationStatus("loading");

    client
      .listMyParticipations()
      .then((list) => {
        if (ignore) return;
        setParticipations(
          new Map(
            list
              .filter((entry) => entry.participation)
              .map((entry) => [entry.item.id, entry.participation])
          )
        );
        setParticipationStatus("loaded");
      })
      .catch((error) => {
        if (ignore) return;
        if (error.status === 401) {
          onSessionExpired();
          return;
        }
        setParticipationStatus("error");
      });

    return () => {
      ignore = true;
    };
  }, [session.token, session.userId, participationAttempt]);

  useEffect(() => {
    if (!selected) return undefined;
    let ignore = false;
    setDetail({ status: "loading", item: null });

    client
      .getItem(selected.id)
      .then((item) => {
        if (!ignore) setDetail({ status: "loaded", item });
      })
      .catch((error) => {
        if (ignore) return;
        if (error.status === 401) {
          onSessionExpired();
        } else if (isItemNotFound(error)) {
          itemGone(selected);
        } else {
          setDetail({
            status: "error",
            item: null,
            error: questApiUnavailableMessage(error, "load the latest details"),
          });
        }
      });

    return () => {
      ignore = true;
    };
  }, [selected?.id, session.token]);

  const items = result.items;
  const loadStatus = answeredKey === requestKey ? status : "loading";
  const filtersActive = hasActiveFilters({ ...filters, query: searchQuery });
  const categories = useMemo(
    () => categoryOptions(items, filters.category),
    [items, filters.category]
  );
  const featured = loadStatus === "loaded" && !filtersActive && page === 1 ? items[0] : null;

  function reload() {
    setActionError("");
    setActionMessage("");
    setLoadAttempt((attempt) => attempt + 1);
    setParticipationAttempt((attempt) => attempt + 1);
  }

  function openItem(item) {
    setSelected(item);
    setActionError("");
    setActionMessage("");
  }

  function closeItem() {
    if (onBack) {
      onBack();
      return;
    }
    setSelected(null);
    setDetail({ status: "idle", item: null });
  }

  function itemGone(item) {
    if (onBack) {
      // Opened from another page, e.g. an archived item in My quests: keep showing what
      // that page had rather than leaving it.
      setDetail({ status: "gone", item: null });
      return;
    }
    closeItem();
    setActionError(`"${item.title}" is no longer available.`);
    setLoadAttempt((attempt) => attempt + 1);
  }

  function updateFilter(patch) {
    setFilters((current) => ({ ...current, ...patch }));
    setPage(1);
  }

  function clearFilters() {
    setFilters(EMPTY_FILTERS);
    setSearchQuery("");
    setPage(1);
  }

  function markJoined(itemId, participation) {
    setParticipations((current) => new Map(current).set(itemId, participation));
  }

  function markLeft(itemId) {
    setParticipations((current) => {
      const next = new Map(current);
      next.delete(itemId);
      return next;
    });
    setProofByItem((current) => {
      const next = new Map(current);
      next.delete(itemId);
      return next;
    });
  }

  function canLeaveParticipation(item, participation, proofSubmission) {
    if (!participation) return false;
    if (proofSubmission && ["pending", "rejected", "approved"].includes(proofSubmission.status)) {
      return false;
    }
    if (item.kind === "event") return participation.status === "joined";
    return participation.status === "joined";
  }

  async function handleLeave(item) {
    if (isLeaving || isJoining || !participations.has(item.id)) return;
    if (Date.now() >= Date.parse(session.expiresAt)) {
      onSessionExpired();
      return;
    }
    const leaveLabel =
      item.kind === "event" ? `Cancel RSVP for "${item.title}"?` : `Leave "${item.title}"?`;
    if (!window.confirm(`${leaveLabel} Your place will be removed if you haven't submitted proof.`)) {
      return;
    }
    setIsLeaving(true);
    setActionError("");
    setActionMessage("");
    try {
      await client.leaveItem(item.id);
      markLeft(item.id);
      setActionMessage(
        item.kind === "event"
          ? `RSVP cancelled for "${item.title}".`
          : `You left "${item.title}".`
      );
    } catch (error) {
      if (error.status === 401) {
        onSessionExpired();
        return;
      }
      if (error.status === 409 && error.code === "proof_already_submitted") {
        setActionError(
          `You can't leave "${item.title}" after submitting proof. Your participation and proof history stay on record.`
        );
        setParticipationAttempt((attempt) => attempt + 1);
      } else if (error.status === 404 && (error.code === "not_joined" || error.code === "not_found")) {
        markLeft(item.id);
        setActionMessage(`You're not joined to "${item.title}".`);
        setParticipationAttempt((attempt) => attempt + 1);
      } else if (error.resultUnknown) {
        setActionError(
          `We couldn't confirm whether you left "${item.title}". Reload My Quests before trying again.`
        );
        setParticipationAttempt((attempt) => attempt + 1);
      } else {
        setActionError(
          `Couldn't leave "${item.title}". ` +
            questApiUnavailableMessage(error, `leave "${item.title}"`)
        );
      }
    } finally {
      setIsLeaving(false);
    }
  }

  async function checkWhetherJoined(item, error, { successMessage } = {}) {
    let list;
    try {
      list = await client.listMyParticipations();
    } catch (reloadError) {
      if (reloadError.status === 401) {
        onSessionExpired();
        return;
      }
      setActionError(
        `We couldn't confirm whether you joined "${item.title}". ${error.message} ` +
          "Use Reload to check before trying again."
      );
      return;
    }

    const entry = list.find((candidate) => candidate.item.id === item.id && candidate.participation);
    if (entry) {
      markJoined(item.id, entry.participation);
      setActionMessage(successMessage || joinedLabel(item));
    } else {
      setActionError(
        `We couldn't confirm whether you joined "${item.title}". ${error.message} ` +
          "The server doesn't show you as joined, so you can try again."
      );
    }
  }

  async function handleJoin(item) {
    if (isJoining || participations.has(item.id)) return;
    if (Date.now() >= Date.parse(session.expiresAt)) {
      onSessionExpired();
      return;
    }

    setIsJoining(true);
    setActionError("");
    setActionMessage("");
    try {
      const participation = await client.joinItem(item.id);
      markJoined(item.id, participation);
      setActionMessage(joinedLabel(item));
    } catch (error) {
      if (error.status === 401) {
        onSessionExpired();
        return;
      }
      if (error.resultUnknown) {
        await checkWhetherJoined(item, error);
      } else if (error.status === 409 && error.code === "already_joined") {
        // Reload so proof uses the real participation id, never a placeholder.
        await checkWhetherJoined(item, error, {
          successMessage: `You've already joined "${item.title}".`,
        });
      } else if (isItemNotFound(error)) {
        itemGone(item);
      } else if (error.status === 403) {
        setActionError(`You can't join "${item.title}". ${error.message}`);
      } else {
        setActionError(
          `You couldn't join "${item.title}". ` +
            questApiUnavailableMessage(error, `join "${item.title}"`)
        );
      }
    } finally {
      setIsJoining(false);
    }
  }

  const participationNotice =
    participationStatus === "error" ? (
      <div className="panel-state panel-state-inline" role="status">
        <p className="form-error form-error-left">
          We couldn't load which quests and events you've joined, so Joined labels may be
          missing.
        </p>
        <button
          type="button"
          className="button button-secondary button-small"
          onClick={() => setParticipationAttempt((attempt) => attempt + 1)}
        >
          Retry
        </button>
      </div>
    ) : null;

  let content;
  if (selected) {
    const shown = detail.item || selected;
    const isQuest = shown.kind !== "event";
    const participation = participations.get(shown.id);
    const proofSubmission = proofByItem.get(shown.id) || null;
    const displayStatus = proofSubmission?.status || participation?.status;
    const joined = Boolean(participation);
    const showStatus = displayStatus && displayStatus !== "joined";
    const withWorkspace = isQuest && canJoin;
    const discussionPhase = resolveQuestDiscussionPhase(
      participation,
      participationStatus,
      proofSubmission
    );
    const discussionSpace = discussionPhase.phase === "submitted" ? "submitted" : "active";
    const proofParticipationStatus =
      proofSubmission?.status === "pending" || proofSubmission?.status === "approved"
        ? proofSubmission.status
        : participation?.status === "rejected" || proofSubmission?.status === "rejected"
          ? "rejected"
          : participation?.status || "joined";

    const mainPanel = (
      <article
        className={`quest-detail panel${withWorkspace ? " quest-workspace-main" : ""}`}
        aria-labelledby="quest-detail-title"
      >
        <div
          className={`${bannerClassName(shown.category)} quest-detail-banner quest-detail-banner-hero`}
          aria-hidden="true"
        >
          <span className="quest-banner-stamp">{itemKindLabel(shown.kind)}</span>
        </div>
        <div className="request-heading quest-detail-heading">
          <h2 className="quest-detail-title" id="quest-detail-title">
            {shown.title}
          </h2>
          {showStatus ? (
            <span className={`badge status-${displayStatus}`}>
              {displayStatus === "pending" && isQuest
                ? "Pending review"
                : participationStatusLabel(displayStatus)}
            </span>
          ) : (
            joined && <span className="badge badge-joined">{isQuest ? "Joined" : "Going"}</span>
          )}
        </div>
        {detail.status === "gone" && (
          <p className="small muted" role="status">
            This is no longer on the board, so these are the last details we had.
          </p>
        )}
        {detail.status === "loading" && (
          <p className="small muted" role="status">
            Checking for the latest details…
          </p>
        )}
        {detail.status === "error" && (
          <p className="small muted" role="status">
            These details may be out of date. {detail.error}
          </p>
        )}
        <ul className="quest-summary" aria-label="Quest summary">
          <li>
            <span className="quest-summary-label">When</span>
            <span>{formatItemWindow(shown.startsAt, shown.endsAt, shown.timeZone)}</span>
          </li>
          <li>
            <span className="quest-summary-label">Where</span>
            <span>{shown.location}</span>
          </li>
          <li>
            <span className="quest-summary-label">Category</span>
            <span>{shown.category || "Campus"}</span>
          </li>
          {isQuest && (
            <li>
              <span className="quest-summary-label">Points</span>
              <span>{shown.pointValue ?? "—"}</span>
            </li>
          )}
          <li>
            <span className="quest-summary-label">Time zone</span>
            <span>{shown.timeZone.replace(/_/g, " ")}</span>
          </li>
        </ul>
        <div className="quest-detail-body">
          <p className="quest-text">{shown.description}</p>
          {isQuest && (
            <div className="quest-proof-block">
              <h3 className="quest-subtitle">How to show you did it</h3>
              <p className="quest-text">{shown.proofInstructions}</p>
            </div>
          )}
        </div>
        {joined && isQuest && displayStatus === "pending" && (
          <p className="message quest-joined" role="status">
            Your proof is pending review.
          </p>
        )}
        {joined && isQuest && displayStatus === "rejected" && (
          <p className="message quest-joined" role="status">
            Your proof was rejected. Check feedback on the proof panel to resubmit.
          </p>
        )}
        {joined && isQuest && displayStatus === "approved" && (
          <p className="message quest-joined" role="status">
            Your proof was approved.
          </p>
        )}
        <p className="form-error form-error-left" role="alert">
          {actionError}
        </p>
        <p className="message message-left" aria-live="polite">
          {actionMessage}
        </p>
      </article>
    );

    const actionsPanel = (
      <aside className="quest-workspace-actions" aria-label="Participation and proof">
        {!joined && detail.status !== "gone" && canJoin && (
          <section className="panel">
            <h3 className="section-title">Join</h3>
            <p className="hint">
              {isQuest
                ? "Joining unlocks proof submission and the active participants discussion."
                : "RSVP to mark that you're going."}
            </p>
            <button
              type="button"
              className="button"
              onClick={() => handleJoin(shown)}
              disabled={isJoining}
            >
              {isJoining ? (isQuest ? "Joining…" : "Sending RSVP…") : isQuest ? "Join quest" : "RSVP"}
            </button>
          </section>
        )}
        {!joined && !canJoin && (
          <section className="panel">
            <p className="hint">Only students can join quests or RSVP to events.</p>
          </section>
        )}
        {!joined && participationStatus === "error" && (
          <p className="hint">We couldn't check whether you've already joined this one.</p>
        )}
        {joined &&
          canJoin &&
          canLeaveParticipation(shown, participation, proofSubmission) && (
            <section className="panel">
              <h3 className="section-title">{isQuest ? "Leave quest" : "Cancel RSVP"}</h3>
              <p className="hint">
                {isQuest
                  ? "You can leave before submitting proof. After proof is submitted, your place stays on record."
                  : "Cancel your RSVP if you can no longer attend."}
              </p>
              <button
                type="button"
                className="button button-secondary"
                onClick={() => handleLeave(shown)}
                disabled={isLeaving || isJoining}
              >
                {isLeaving
                  ? isQuest
                    ? "Leaving…"
                    : "Cancelling…"
                  : isQuest
                    ? "Leave quest"
                    : "Cancel RSVP"}
              </button>
            </section>
          )}
        {isQuest && canJoin && joined && (
          <ProofSubmit
            session={{
              token: session.token,
              userId: session.userId,
              userName: author?.name,
            }}
            item={shown}
            participationId={participation?.id}
            participationStatus={proofParticipationStatus}
            onSessionExpired={onSessionExpired}
            onProofState={(submission) => {
              setProofByItem((current) => {
                const next = new Map(current);
                if (submission) next.set(shown.id, submission);
                else next.delete(shown.id);
                return next;
              });
            }}
            onSubmitted={(submission) => {
              setProofByItem((current) => {
                const next = new Map(current);
                next.set(shown.id, submission);
                return next;
              });
              // Keep membership; sync proof-phase status for My Quests labels without calling Leave.
              setParticipations((current) => {
                const next = new Map(current);
                const previous = next.get(shown.id) || {
                  id: `local-${shown.id}`,
                  itemId: shown.id,
                  status: "joined",
                };
                next.set(shown.id, {
                  ...previous,
                  status: submission.status,
                  proofStatus: submission.status,
                });
                return next;
              });
            }}
          />
        )}
      </aside>
    );

    const discussionsPanel = withWorkspace ? (
      <aside className="quest-workspace-discussions" aria-label="Quest discussions">
        <QuestDiscussion
          quest={shown}
          space={discussionSpace}
          participation={participation}
          participationStatus={participationStatus}
          proofSubmission={proofSubmission}
          author={author}
          onSessionExpired={onSessionExpired}
          compact
          showPrototypeNotice={false}
        />
        {discussionSpace === "active" && (
          <p className="discussion-alt-hint muted small">
            After you submit proof, a separate after-submission discussion unlocks (spoilers
            allowed).
          </p>
        )}
        {discussionSpace === "submitted" && (
          <p className="discussion-alt-hint muted small">
            The active participants discussion is closed so spoilers stay out of unfinished
            quests.
          </p>
        )}
      </aside>
    ) : null;

    content = withWorkspace ? (
      <div className="quest-workspace">
        {discussionsPanel}
        {mainPanel}
        {actionsPanel}
      </div>
    ) : (
      <div className="quest-detail-layout quest-detail-layout-simple">
        {mainPanel}
        {actionsPanel}
      </div>
    );
  } else {
    let results;
    if (query.error) {
      results = <div className="panel-state muted">{query.error}</div>;
    } else if (loadStatus === "loading") {
      results = (
        <div className="panel-state" role="status">
          Loading quests…
        </div>
      );
    } else if (loadStatus === "error") {
      results = (
        <div className="panel-state">
          <p className="form-error form-error-left">{loadError}</p>
          <button type="button" className="button button-secondary button-inline" onClick={reload}>
            Try again
          </button>
        </div>
      );
    } else if (items.length === 0) {
      results = (
        <div className="panel-state muted">
          {filtersActive
            ? "Nothing matches these filters. Try another search, category, or date."
            : "There are no published quests or events yet."}
        </div>
      );
    } else {
      const { totalItems, totalPages } = result.page;
      results = (
        <>
          <ul className="quest-grid discovery-grid" aria-label="Published quests and events">
            {items.map((item) => (
              <QuestCard
                key={item.id}
                quest={item}
                joined={participations.has(item.id)}
                onView={() => openItem(item)}
              />
            ))}
          </ul>
          {totalPages > 1 && (
            <nav className="pagination" aria-label="Result pages">
              <button
                type="button"
                className="button button-secondary button-small"
                onClick={() => setPage(page - 1)}
                disabled={page <= 1}
              >
                Previous
              </button>
              <span className="small muted">
                Page {page} of {totalPages} · {countLabel(totalItems)}
              </span>
              <button
                type="button"
                className="button button-secondary button-small"
                onClick={() => setPage(page + 1)}
                disabled={page >= totalPages}
              >
                Next
              </button>
            </nav>
          )}
        </>
      );
    }

    const total = loadStatus === "loaded" && result.page ? result.page.totalItems : null;
    content = (
      <>
        {featured && (
          <section className="featured-quest" aria-labelledby="featured-quest-title">
            <div className={`${bannerClassName(featured.category)} featured-banner`} aria-hidden="true">
              <span className="quest-banner-stamp">Coming up</span>
            </div>
            <div className="featured-body">
              <p className="eyebrow">Next on the board</p>
              <h3 id="featured-quest-title">{featured.title}</h3>
              <p className="small muted">
                {formatItemWindow(featured.startsAt, featured.endsAt, featured.timeZone)} ·{" "}
                {featured.location}
              </p>
              <div className="quest-card-meta">
                <span className="badge badge-category">{featured.category || "Campus"}</span>
                {featured.kind !== "event" && (
                  <span className="badge badge-points">{featured.pointValue ?? "—"} pts</span>
                )}
                {participations.has(featured.id) && (
                  <span className="badge badge-joined">
                    {featured.kind === "event" ? "Going" : "Joined"}
                  </span>
                )}
              </div>
              <button
                type="button"
                className="button button-inline"
                onClick={() => openItem(featured)}
              >
                {featured.kind === "event" ? "View event" : "View quest"}
              </button>
            </div>
          </section>
        )}

        <section className="discovery-filters" aria-label="Search and filters">
          <div className="filter-row">
            <div className="field filter-search">
              <label htmlFor="quest-search">Search</label>
              <input
                id="quest-search"
                type="search"
                placeholder="Title or description"
                value={filters.query}
                onChange={(event) => setFilters((current) => ({ ...current, query: event.target.value }))}
              />
            </div>
            <fieldset className="filter-dates">
              <legend>When</legend>
              <div className="chip-row" role="group" aria-label="Date filters">
                {DATE_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    className={filters.dateFilter === option.id ? "chip chip-active" : "chip"}
                    aria-pressed={filters.dateFilter === option.id}
                    onClick={() => updateFilter({ dateFilter: option.id })}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              {filters.dateFilter === "range" && (
                <div className="field-row filter-range">
                  <div className="field">
                    <label htmlFor="quest-from">From</label>
                    <input
                      id="quest-from"
                      type="date"
                      value={filters.from}
                      onChange={(event) => updateFilter({ from: event.target.value })}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="quest-to">To</label>
                    <input
                      id="quest-to"
                      type="date"
                      value={filters.to}
                      onChange={(event) => updateFilter({ to: event.target.value })}
                    />
                  </div>
                </div>
              )}
              <p className="hint">Days are in your own time zone. Anything happening during them is shown.</p>
            </fieldset>
          </div>

          <div className="chip-row" role="group" aria-label="Categories">
            <button
              type="button"
              className={!filters.category ? "chip chip-active" : "chip"}
              aria-pressed={!filters.category}
              onClick={() => updateFilter({ category: "" })}
            >
              All categories
            </button>
            {categories.map((category) => {
              const active = filters.category.toLowerCase() === category.toLowerCase();
              return (
                <button
                  key={category}
                  type="button"
                  className={active ? "chip chip-active" : "chip"}
                  aria-pressed={active}
                  onClick={() => updateFilter({ category: active ? "" : category })}
                >
                  {category}
                </button>
              );
            })}
          </div>

          <div className="filter-summary">
            <p className="small muted" aria-live="polite">
              {total === null
                ? ""
                : filtersActive
                  ? `${countLabel(total)} ${total === 1 ? "matches" : "match"} your filters`
                  : `${countLabel(total)} on the board`}
            </p>
            {filtersActive && (
              <button type="button" className="link-button small" onClick={clearFilters}>
                Clear filters
              </button>
            )}
          </div>
        </section>

        {participationNotice}
        {results}
        <p className="form-error form-error-left" role="alert">
          {actionError}
        </p>
      </>
    );
  }

  if (selected) {
    return (
      <div className="page-stack quest-workspace-page">
        <nav className="quest-workspace-crumb" aria-label="Breadcrumb">
          <button type="button" className="link-button" onClick={closeItem}>
            {backLabel}
          </button>
        </nav>
        {content}
      </div>
    );
  }

  if (onBack) {
    return <div className="page-stack discovery-page">{content}</div>;
  }

  return (
    <div className="page-stack discovery-page">
      <div className="list-toolbar page-header discovery-intro">
        <div>
          <h2 className="screen-title">What&apos;s your next campus adventure?</h2>
          <p className="page-lede">
            Browse the noticeboard for quests and events you can join. Open one for the full
            details and join or RSVP from there.
          </p>
        </div>
        <button
          type="button"
          className="button button-secondary button-small"
          onClick={reload}
          disabled={loadStatus === "loading"}
        >
          Reload
        </button>
      </div>
      {content}
    </div>
  );
}

export default QuestBoard;
