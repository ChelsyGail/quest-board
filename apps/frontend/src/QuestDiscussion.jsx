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
  questDiscussionAccess,
  questScope,
} from "./discussions.js";
import { useDiscussionBoard } from "./useDiscussionBoard.js";

// The discussion inside a quest's details, for students who joined it. The page only offers
// it to members; the discussion API will have to check membership itself on every request.
function QuestDiscussion({ quest, participation, participationStatus, author, onSessionExpired }) {
  const access = questDiscussionAccess(participation, participationStatus);
  return (
    <section className="quest-discussion panel" aria-labelledby="quest-discussion-title">
      <h3 className="section-title" id="quest-discussion-title">
        Discussion
      </h3>
      <p className="hint section-hint">
        Find teammates, ask questions and share tips with others on this quest.
      </p>
      {!access.allowed ? (
        <p className="discussion-locked" role="status">
          {access.message}
        </p>
      ) : (
        <MemberDiscussion quest={quest} author={author} onSessionExpired={onSessionExpired} />
      )}
    </section>
  );
}

function MemberDiscussion({ quest, author, onSessionExpired }) {
  const client = getDiscussionClient(author);
  const board = useDiscussionBoard(client, questScope(quest.id), QUEST_CATEGORIES, {
    onSessionExpired,
  });
  const visible = useMemo(
    () => filterThreads(board.threads, board.filters),
    [board.threads, board.filters]
  );

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
            searchId="quest-discussion-search"
          />
          <button type="button" className="button button-small" onClick={() => board.startNew()}>
            New discussion
          </button>
        </div>
        <ThreadListState
          board={board}
          visibleCount={visible.length}
          emptyMessage="No discussions yet. Start one to find teammates or ask a question."
        >
          <DiscussionList
            threads={visible}
            categories={QUEST_CATEGORIES}
            onOpen={board.openThread}
            label={`Discussions about ${quest.title}`}
          />
        </ThreadListState>
      </>
    );
  }

  return (
    <>
      <PrototypeNotice />
      {content}
    </>
  );
}

export default QuestDiscussion;
