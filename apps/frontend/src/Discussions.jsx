import { useId } from "react";
import { LIMITS, categoryLabel, excerpt, formatPostTime } from "./discussions.js";

// Building blocks shared by the quest discussion and Quest Grove. Everything people wrote
// is rendered as plain text; nothing is ever inserted as HTML.

export function PrototypeNotice() {
  return (
    <p className="discussion-prototype" role="note">
      <strong>Prototype with sample discussions.</strong> Posts and replies stay in this browser
      tab only. Nobody else can see them, and they're gone when the tab closes.
    </p>
  );
}

export function DiscussionsUnavailable({ what = "Discussions" }) {
  return (
    <div className="panel-state discussion-unavailable">
      <p className="eyebrow">Coming soon</p>
      <p>
        {what} aren't available yet. They need a discussion service on the QuestBoard
        backend, which hasn't been built.
      </p>
    </div>
  );
}

function replyCountLabel(count) {
  return count === 1 ? "1 reply" : `${count} replies`;
}

function Byline({ author, createdAt, sample }) {
  return (
    <p className="discussion-byline small muted">
      <span className="discussion-author">{author.name}</span> ·{" "}
      <time dateTime={createdAt}>{formatPostTime(createdAt)}</time>
      {sample && <span className="badge discussion-sample">Sample</span>}
    </p>
  );
}

export function TopicTag({ categories, id }) {
  return (
    <span className={`badge discussion-tag discussion-tag-${id}`}>
      <span className="discussion-tag-mark" aria-hidden="true" />
      {categoryLabel(categories, id)}
    </span>
  );
}

export function DiscussionFilters({
  filters,
  onChange,
  categories,
  label = "Categories",
  searchId,
  compact = false,
}) {
  const topicId = `${searchId}-topic`;
  if (compact) {
    return (
      <div className="discussion-filters discussion-filters-compact">
        <div className="field filter-search">
          <label htmlFor={searchId}>Search</label>
          <input
            id={searchId}
            type="search"
            placeholder="Search threads"
            value={filters.query}
            onChange={(event) => onChange({ query: event.target.value })}
          />
        </div>
        <div className="field filter-topic">
          <label htmlFor={topicId}>Topic</label>
          <select
            id={topicId}
            value={filters.category}
            onChange={(event) => onChange({ category: event.target.value })}
          >
            <option value="">All topics</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.label}
              </option>
            ))}
          </select>
        </div>
      </div>
    );
  }

  return (
    <div className="discussion-filters">
      <div className="field filter-search">
        <label htmlFor={searchId}>Search discussions</label>
        <input
          id={searchId}
          type="search"
          placeholder="Title or message"
          value={filters.query}
          onChange={(event) => onChange({ query: event.target.value })}
        />
      </div>
      <div className="chip-row" role="group" aria-label={label}>
        <button
          type="button"
          className={!filters.category ? "chip chip-active" : "chip"}
          aria-pressed={!filters.category}
          onClick={() => onChange({ category: "" })}
        >
          All
        </button>
        {categories.map((category) => (
          <button
            key={category.id}
            type="button"
            className={filters.category === category.id ? "chip chip-active" : "chip"}
            aria-pressed={filters.category === category.id}
            onClick={() =>
              onChange({ category: filters.category === category.id ? "" : category.id })
            }
          >
            {category.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function DiscussionList({
  threads,
  categories,
  selectedId = null,
  onOpen,
  label,
  excerptLength = 110,
}) {
  return (
    <ul className="discussion-list" aria-label={label}>
      {threads.map((thread) => (
        <li key={thread.id}>
          <button
            type="button"
            className={`discussion-row${thread.id === selectedId ? " is-selected" : ""}`}
            aria-current={thread.id === selectedId ? "true" : undefined}
            onClick={() => onOpen(thread.id)}
          >
            <span className="discussion-row-top">
              <TopicTag categories={categories} id={thread.category} />
              <span className="small muted">{replyCountLabel(thread.replyCount)}</span>
            </span>
            <span className="discussion-row-title">{thread.title}</span>
            <span className="discussion-row-excerpt small muted">
              {excerpt(thread.body, excerptLength)}
            </span>
            <span className="small muted">
              {thread.author.name} · {formatPostTime(thread.createdAt)}
              {thread.sample && " · Sample"}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function DiscussionThread({ board, categories, backLabel = "← All discussions" }) {
  const replyId = useId();
  const { detail } = board;
  return (
    <article className="discussion-thread" aria-labelledby={`${replyId}-title`}>
      <button type="button" className="link-button small" onClick={board.showList}>
        {backLabel}
      </button>
      {detail.status === "loading" && (
        <p className="panel-state muted" role="status">
          Loading the discussion…
        </p>
      )}
      {detail.status === "error" && (
        <div className="panel-state" role="alert">
          <p className="error">{detail.error}</p>
          <button type="button" className="button button-secondary button-small" onClick={board.reloadThread}>
            Try again
          </button>
        </div>
      )}
      {detail.status === "loaded" && (
        <>
          <header className="discussion-post discussion-original">
            <TopicTag categories={categories} id={detail.thread.category} />
            <h3 className="section-title" id={`${replyId}-title`}>
              {detail.thread.title}
            </h3>
            <Byline {...detail.thread} />
            <p className="discussion-body">{detail.thread.body}</p>
          </header>
          <h4 className="quest-subtitle">{replyCountLabel(detail.replies.length)}</h4>
          {detail.replies.length > 0 && (
            <ol className="discussion-replies">
              {detail.replies.map((reply) => (
                <li key={reply.id} className="discussion-post">
                  <Byline {...reply} />
                  <p className="discussion-body">{reply.body}</p>
                </li>
              ))}
            </ol>
          )}
          <form
            className="discussion-reply-form"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              board.submitReply(detail.thread.id);
            }}
          >
            <label htmlFor={replyId}>Your reply</label>
            <textarea
              id={replyId}
              rows={3}
              maxLength={LIMITS.replyMax}
              value={board.replyDraft}
              aria-invalid={Boolean(board.replyError)}
              aria-describedby={`${replyId}-error`}
              onChange={(event) => board.updateReplyDraft(detail.thread.id, event.target.value)}
            />
            <p className="error" id={`${replyId}-error`} role="alert">
              {board.replyError}
            </p>
            <button type="submit" className="button button-inline" disabled={board.submitting}>
              {board.submitting ? "Posting…" : "Post reply"}
            </button>
          </form>
        </>
      )}
    </article>
  );
}

export function NewDiscussionForm({ board, categories, categoryLabelText = "Category" }) {
  const id = useId();
  const { newDraft: draft, newErrors: errors } = board;
  return (
    <form
      className="discussion-new"
      noValidate
      aria-labelledby={`${id}-heading`}
      onSubmit={(event) => {
        event.preventDefault();
        board.submitThread();
      }}
    >
      <button type="button" className="link-button small" onClick={board.showList}>
        ← Back to discussions
      </button>
      <h3 className="section-title" id={`${id}-heading`}>
        New discussion
      </h3>
      <div className="field">
        <label htmlFor={`${id}-title`}>Title</label>
        <input
          id={`${id}-title`}
          value={draft.title}
          maxLength={LIMITS.titleMax}
          aria-invalid={Boolean(errors.title)}
          aria-describedby={`${id}-title-error`}
          onChange={(event) => board.updateNewDraft({ title: event.target.value })}
        />
        <p className="error" id={`${id}-title-error`}>
          {errors.title}
        </p>
      </div>
      <div className="field">
        <label htmlFor={`${id}-category`}>{categoryLabelText}</label>
        <select
          id={`${id}-category`}
          value={draft.category}
          aria-invalid={Boolean(errors.category)}
          aria-describedby={`${id}-category-error`}
          onChange={(event) => board.updateNewDraft({ category: event.target.value })}
        >
          <option value="">Choose…</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.label}
            </option>
          ))}
        </select>
        <p className="error" id={`${id}-category-error`}>
          {errors.category}
        </p>
      </div>
      <div className="field">
        <label htmlFor={`${id}-body`}>Message</label>
        <textarea
          id={`${id}-body`}
          rows={6}
          maxLength={LIMITS.bodyMax}
          value={draft.body}
          aria-invalid={Boolean(errors.body)}
          aria-describedby={`${id}-body-error ${id}-body-hint`}
          onChange={(event) => board.updateNewDraft({ body: event.target.value })}
        />
        <p className="hint" id={`${id}-body-hint`}>
          Plain text, up to {LIMITS.bodyMax} characters.
        </p>
        <p className="error" id={`${id}-body-error`}>
          {errors.body}
        </p>
      </div>
      <p className="form-error form-error-left" role="alert">
        {board.submitError}
      </p>
      <button type="submit" className="button button-inline" disabled={board.submitting}>
        {board.submitting ? "Posting…" : "Post discussion"}
      </button>
    </form>
  );
}

// Loading, error and empty states for a list of threads, or `children` when there are some.
export function ThreadListState({ board, visibleCount, emptyMessage, children }) {
  if (board.listStatus === "loading") {
    return (
      <p className="panel-state muted" role="status">
        Loading discussions…
      </p>
    );
  }
  if (board.listStatus === "error") {
    return (
      <div className="panel-state" role="alert">
        <p className="error">We couldn't load the discussions. {board.listError}</p>
        <button type="button" className="button button-secondary button-small" onClick={board.reloadList}>
          Try again
        </button>
      </div>
    );
  }
  if (visibleCount === 0) {
    const filtered = board.filters.query.trim() || board.filters.category;
    return (
      <p className="panel-state muted">
        {filtered ? "No discussions match your search." : emptyMessage}
      </p>
    );
  }
  return children;
}
