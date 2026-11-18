import { useMemo, useState } from "react";
import {
  DiscussionFilters,
  DiscussionList,
  DiscussionThread,
  DiscussionsUnavailable,
  NewDiscussionForm,
  PrototypeNotice,
  ThreadListState,
} from "./Discussions.jsx";
import {
  GROVE_SCOPE,
  GROVE_TOPICS,
  excerpt,
  filterThreads,
  getDiscussionClient,
} from "./discussions.js";
import { GROVE_HEIGHT, GROVE_WIDTH, groveLayout, trunkPath } from "./groveLayout.js";
import { useDiscussionBoard } from "./useDiscussionBoard.js";

const LIST_PAGE_SIZE = 20;
const NARROW_QUERY = "(max-width: 900px)";

function prefersList() {
  return typeof window.matchMedia === "function" && window.matchMedia(NARROW_QUERY).matches;
}

function replyCountLabel(count) {
  return count === 1 ? "1 reply" : `${count} replies`;
}

function percent(value, total) {
  return `${(value / total) * 100}%`;
}

function GroveTree({ layout, selectedTopic, selectedId, onOpen, onSelectTopic, onShowMore }) {
  // The leaf being hovered or focused, whose summary is shown beside it.
  const [active, setActive] = useState(null);
  const leaves = layout.flatMap((branch) => branch.leaves);
  const activeLeaf = leaves.find((leaf) => leaf.thread.id === active);

  return (
    <div className="grove-tree" role="group" aria-label="Discussion tree">
      <svg
        className="grove-svg"
        viewBox={`0 0 ${GROVE_WIDTH} ${GROVE_HEIGHT}`}
        preserveAspectRatio="none"
        aria-hidden="true"
        focusable="false"
      >
        <g className="grove-canopy">
          <ellipse cx="500" cy="270" rx="300" ry="210" />
          <ellipse cx="300" cy="420" rx="230" ry="140" />
          <ellipse cx="700" cy="420" rx="230" ry="140" />
        </g>
        <ellipse className="grove-ground" cx="500" cy="694" rx="300" ry="22" />
        {layout.map((branch) => (
          <path
            key={branch.topic.id}
            d={branch.path}
            className={`grove-branch grove-branch-${branch.topic.id}${
              selectedTopic === branch.topic.id ? " is-highlighted" : ""
            }${selectedTopic && selectedTopic !== branch.topic.id ? " is-dimmed" : ""}`}
          />
        ))}
        <path className="grove-trunk" d={trunkPath()} />
      </svg>

      {layout.map((branch) => (
        <div
          key={branch.topic.id}
          className={`grove-label grove-label-${branch.labelSide}`}
          style={{
            left: percent(branch.tip.x, GROVE_WIDTH),
            top: percent(branch.tip.y, GROVE_HEIGHT),
          }}
        >
          <button
            type="button"
            className={`grove-topic grove-topic-${branch.topic.id}${
              selectedTopic === branch.topic.id ? " is-selected" : ""
            }`}
            aria-pressed={selectedTopic === branch.topic.id}
            onClick={() => onSelectTopic(branch.topic.id)}
          >
            <span className={`grove-topic-mark grove-shape-${branch.topic.id}`} aria-hidden="true" />
            {branch.topic.label}
          </button>
          {branch.hidden > 0 && (
            <button
              type="button"
              className="link-button small grove-more"
              onClick={() => onShowMore(branch.topic.id)}
              aria-label={`Show all ${branch.total} ${branch.topic.label} discussions in the list`}
            >
              +{branch.hidden} more
            </button>
          )}
        </div>
      ))}

      {layout.map((branch) =>
        branch.leaves.map(({ thread, x, y }, index) => (
          <button
            key={thread.id}
            type="button"
            className={`grove-leaf${thread.id === selectedId ? " is-selected" : ""}`}
            style={{
              left: percent(x, GROVE_WIDTH),
              top: percent(y, GROVE_HEIGHT),
              animationDelay: `${index * 60}ms`,
            }}
            aria-label={`${thread.title}. ${branch.topic.label}, ${replyCountLabel(
              thread.replyCount
            )}, by ${thread.author.name}.`}
            aria-describedby={active === thread.id ? "grove-leaf-summary" : undefined}
            aria-current={thread.id === selectedId ? "true" : undefined}
            onClick={() => onOpen(thread.id)}
            onMouseEnter={() => setActive(thread.id)}
            onMouseLeave={() => setActive((current) => (current === thread.id ? null : current))}
            onFocus={() => setActive(thread.id)}
            onBlur={() => setActive((current) => (current === thread.id ? null : current))}
          >
            <span className={`grove-leaf-shape grove-shape-${branch.topic.id}`} aria-hidden="true">
              <span className="grove-leaf-count">{thread.replyCount}</span>
            </span>
          </button>
        ))
      )}

      {activeLeaf && (
        <div
          id="grove-leaf-summary"
          role="tooltip"
          className={`grove-tooltip${activeLeaf.x < 300 ? " align-start" : ""}${
            activeLeaf.x > 700 ? " align-end" : ""
          }${activeLeaf.y < 200 ? " below" : ""}`}
          style={{
            left: percent(activeLeaf.x, GROVE_WIDTH),
            top: percent(activeLeaf.y, GROVE_HEIGHT),
          }}
        >
          <strong>{activeLeaf.thread.title}</strong>
          <span>{excerpt(activeLeaf.thread.body, 90)}</span>
          <span className="small muted">{replyCountLabel(activeLeaf.thread.replyCount)}</span>
        </div>
      )}
    </div>
  );
}

// Quest Grove: discussions open to every signed-in user, shown as a tree whose branches are
// topics and whose leaves are discussions, or as a plain list. Both show the same
// discussions under the same filters, and both open threads in the side panel.
function QuestGrove({ author, onSessionExpired }) {
  const client = getDiscussionClient(author);
  const board = useDiscussionBoard(client, GROVE_SCOPE, GROVE_TOPICS, { onSessionExpired });
  const [view, setView] = useState(() => (prefersList() ? "list" : "tree"));
  const [listLimit, setListLimit] = useState(LIST_PAGE_SIZE);
  const visible = useMemo(
    () => filterThreads(board.threads, board.filters),
    [board.threads, board.filters]
  );
  const layout = useMemo(() => groveLayout(visible, GROVE_TOPICS), [visible]);
  const selectedId = board.view.mode === "thread" ? board.view.id : null;

  function updateFilters(patch) {
    board.setFilters(patch);
    setListLimit(LIST_PAGE_SIZE);
  }

  function selectTopic(topicId) {
    updateFilters({ category: board.filters.category === topicId ? "" : topicId });
  }

  function showMore(topicId) {
    updateFilters({ category: topicId });
    setView("list");
  }

  const header = (
    <header className="page-header">
      <h2 className="screen-title">Quest Grove</h2>
      <p className="page-lede">
        Talk with other students about campus life, quests and ideas. Pick a branch for a
        topic and a leaf to read the discussion.
      </p>
    </header>
  );

  if (!client) {
    return (
      <div className="page-stack">
        {header}
        <section className="panel">
          <DiscussionsUnavailable what="Quest Grove discussions" />
        </section>
      </div>
    );
  }

  let panel;
  if (board.view.mode === "thread") {
    panel = <DiscussionThread board={board} categories={GROVE_TOPICS} backLabel="Close" />;
  } else if (board.view.mode === "new") {
    panel = <NewDiscussionForm board={board} categories={GROVE_TOPICS} categoryLabelText="Topic" />;
  } else {
    panel = (
      <div className="grove-panel-empty">
        <p className="section-title">Pick a discussion</p>
        <p className="small muted">
          {view === "tree"
            ? "Each leaf is a discussion. Hover or focus a leaf for a preview, then select it to read the thread here."
            : "Select a discussion to read the thread here."}
        </p>
        <button
          type="button"
          className="button button-secondary button-small"
          onClick={() => board.startNew(board.filters.category)}
        >
          Start a discussion
        </button>
      </div>
    );
  }

  return (
    <div className="page-stack grove-page">
      {header}
      {client?.isPrototype && <PrototypeNotice />}
      <section className="discovery-filters grove-controls" aria-label="Search and topics">
        <DiscussionFilters
          filters={board.filters}
          onChange={updateFilters}
          categories={GROVE_TOPICS}
          label="Topics"
          searchId="grove-search"
        />
        <div className="grove-actions">
          <div className="tabs view-toggle" role="group" aria-label="View">
            {["tree", "list"].map((id) => (
              <button
                key={id}
                type="button"
                className={`tab${view === id ? " active" : ""}`}
                aria-pressed={view === id}
                onClick={() => setView(id)}
              >
                {id === "tree" ? "Tree" : "List"}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="button button-small"
            onClick={() => board.startNew(board.filters.category)}
          >
            New discussion
          </button>
        </div>
        <p className="small muted" aria-live="polite">
          {board.listStatus === "loaded" &&
            `${visible.length} ${visible.length === 1 ? "discussion" : "discussions"}`}
        </p>
      </section>

      <div className="grove-layout">
        <div className="grove-main panel">
          <ThreadListState
            board={board}
            visibleCount={visible.length}
            emptyMessage="No discussions yet. Start the first one."
          >
            {view === "tree" ? (
              <>
                <GroveTree
                  layout={layout}
                  selectedTopic={board.filters.category}
                  selectedId={selectedId}
                  onOpen={board.openThread}
                  onSelectTopic={selectTopic}
                  onShowMore={showMore}
                />
                <p className="hint">
                  Each branch shows its newest discussions. Use +more or the List view to browse
                  the rest.
                </p>
              </>
            ) : (
              <>
                <DiscussionList
                  threads={visible.slice(0, listLimit)}
                  categories={GROVE_TOPICS}
                  selectedId={selectedId}
                  onOpen={board.openThread}
                  label="Quest Grove discussions"
                />
                {visible.length > listLimit && (
                  <button
                    type="button"
                    className="button button-secondary button-small"
                    onClick={() => setListLimit((limit) => limit + LIST_PAGE_SIZE)}
                  >
                    Show more ({visible.length - listLimit} left)
                  </button>
                )}
              </>
            )}
          </ThreadListState>
        </div>
        <aside className="grove-side panel" aria-label="Discussion">
          {panel}
        </aside>
      </div>
    </div>
  );
}

export default QuestGrove;
