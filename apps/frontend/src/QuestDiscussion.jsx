import { useMemo } from "react";
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
  QUEST_CATEGORIES,
  filterThreads,
  getDiscussionClient,
  questActiveDiscussionAccess,
  questActiveScope,
  questSubmittedDiscussionAccess,
  questSubmittedScope,
} from "./discussions.js";
import { useDiscussionBoard } from "./useDiscussionBoard.js";

/**
 * Quest discussion panel for one space: "active" (pre-submission) or "submitted"
 * (after confirmed proof — spoilers allowed, including while Pending).
 */
function QuestDiscussion({
  quest,
  participation,
  participationStatus,
  proofSubmission = null,
  space = "active",
  author,
  onSessionExpired,
  compact = false,
  showPrototypeNotice = true,
}) {
  const access =
    space === "submitted"
      ? questSubmittedDiscussionAccess(participation, participationStatus, proofSubmission)
      : questActiveDiscussionAccess(participation, participationStatus, proofSubmission);

  const titleId =
    space === "submitted" ? "quest-discussion-submitted-title" : "quest-discussion-active-title";
  const heading =
    space === "submitted" ? "After submission — spoilers allowed" : "Active participants";
  const hint =
    space === "submitted"
      ? "Spoilers about completing the quest are allowed here."
      : "Find teammates and share tips before you submit proof.";

  return (
    <section
      className={`quest-discussion panel quest-discussion-${space}${compact ? " is-compact" : ""}`}
      aria-labelledby={titleId}
    >
      <h3 className="section-title" id={titleId}>
        {heading}
      </h3>
      <p className="hint section-hint">{hint}</p>
      {!access.allowed ? (
        <p className="discussion-locked" role="status">
          {access.message}
        </p>
      ) : (
        <MemberDiscussion
          quest={quest}
          space={space}
          author={author}
          onSessionExpired={onSessionExpired}
          compact={compact}
          showPrototypeNotice={showPrototypeNotice}
        />
      )}
    </section>
  );
}

function MemberDiscussion({
  quest,
  space,
  author,
  onSessionExpired,
  compact,
  showPrototypeNotice,
}) {
  const client = getDiscussionClient(author);
  const scope = space === "submitted" ? questSubmittedScope(quest.id) : questActiveScope(quest.id);
  const board = useDiscussionBoard(client, scope, QUEST_CATEGORIES, {
    onSessionExpired,
  });
  const visible = useMemo(
    () => filterThreads(board.threads, board.filters),
    [board.threads, board.filters]
  );
  const searchId =
    space === "submitted" ? "quest-discussion-submitted-search" : "quest-discussion-active-search";
  const listLabel =
    space === "submitted"
      ? `After-submission discussions for ${quest.title}`
      : `Active discussions about ${quest.title}`;

  if (!client) return <DiscussionsUnavailable what="Quest discussions" />;

  let content;
  if (board.view.mode === "thread") {
    content = <DiscussionThread board={board} categories={QUEST_CATEGORIES} />;
  } else if (board.view.mode === "new") {
    content = <NewDiscussionForm board={board} categories={QUEST_CATEGORIES} />;
  } else {
    content = (
      <>
        <div className="discussion-toolbar">
          <DiscussionFilters
            filters={board.filters}
            onChange={board.setFilters}
            categories={QUEST_CATEGORIES}
            searchId={searchId}
            compact={compact}
          />
          <button type="button" className="button button-small" onClick={() => board.startNew()}>
            New discussion
          </button>
        </div>
        <ThreadListState
          board={board}
          visibleCount={visible.length}
          emptyMessage={
            space === "submitted"
              ? "No discussions yet in the after-submission space."
              : "No discussions yet. Start one to find teammates or ask a question."
          }
        >
          <DiscussionList
            threads={visible}
            categories={QUEST_CATEGORIES}
            onOpen={board.openThread}
            label={listLabel}
            excerptLength={compact ? 72 : 110}
          />
        </ThreadListState>
      </>
    );
  }

  return (
    <>
      {showPrototypeNotice && client?.isPrototype && <PrototypeNotice />}
      {content}
    </>
  );
}

export default QuestDiscussion;
