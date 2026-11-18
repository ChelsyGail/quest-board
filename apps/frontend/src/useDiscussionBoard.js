import { useEffect, useState } from "react";
import { validateReply, validateThread } from "./discussions.js";

const EMPTY_DRAFT = { title: "", category: "", body: "" };

// State shared by the quest discussion and Quest Grove: the threads in one scope, the one
// open, and drafts. Drafts live here rather than in the forms, so moving between the list
// and a thread doesn't lose what was typed. `client` is null when there's no discussion
// backend, in which case nothing is loaded.
export function useDiscussionBoard(client, scope, categories, { onSessionExpired } = {}) {
  const [threads, setThreads] = useState([]);
  const [listStatus, setListStatus] = useState(client ? "loading" : "unavailable");
  const [listError, setListError] = useState("");
  const [listAttempt, setListAttempt] = useState(0);
  const [filters, setFilters] = useState({ query: "", category: "" });
  // { mode: "list" } | { mode: "thread", id } | { mode: "new" }
  const [view, setView] = useState({ mode: "list" });
  const [detail, setDetail] = useState({ status: "idle", thread: null, replies: [] });
  const [detailAttempt, setDetailAttempt] = useState(0);
  const [newDraft, setNewDraft] = useState(EMPTY_DRAFT);
  const [newErrors, setNewErrors] = useState({});
  const [replyDrafts, setReplyDrafts] = useState({});
  const [replyError, setReplyError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  function handleError(error, setMessage) {
    if (error.status === 401 && onSessionExpired) {
      onSessionExpired();
      return;
    }
    setMessage(error.message || "Something went wrong.");
  }

  // Clear selected thread, drafts and filters when the discussion space changes so
  // active-space content cannot linger after submission unlocks the other space.
  useEffect(() => {
    setView({ mode: "list" });
    setFilters({ query: "", category: "" });
    setNewDraft(EMPTY_DRAFT);
    setNewErrors({});
    setReplyDrafts({});
    setReplyError("");
    setSubmitError("");
    setDetail({ status: "idle", thread: null, replies: [] });
    setThreads([]);
  }, [scope]);

  useEffect(() => {
    if (!client) return undefined;
    let ignore = false;
    setListStatus("loading");
    setListError("");
    client
      .listThreads(scope)
      .then((list) => {
        if (ignore) return;
        setThreads(list);
        setListStatus("loaded");
      })
      .catch((error) => {
        if (ignore) return;
        handleError(error, setListError);
        setListStatus("error");
      });
    return () => {
      ignore = true;
    };
    // Client identity is cached by author; scope + attempt decide when to reload.
  }, [scope, listAttempt, Boolean(client)]);

  const openId = view.mode === "thread" ? view.id : null;
  useEffect(() => {
    if (!client || !openId) return undefined;
    let ignore = false;
    setDetail({ status: "loading", thread: null, replies: [] });
    client
      .getThread(openId)
      .then(({ thread, replies }) => {
        if (!ignore) setDetail({ status: "loaded", thread, replies });
      })
      .catch((error) => {
        if (ignore) return;
        handleError(error, (message) =>
          setDetail({ status: "error", thread: null, replies: [], error: message })
        );
      });
    return () => {
      ignore = true;
    };
  }, [openId, detailAttempt, Boolean(client)]);

  function openThread(id) {
    setReplyError("");
    setView({ mode: "thread", id });
  }

  function showList() {
    setView({ mode: "list" });
  }

  function startNew(category = "") {
    setSubmitError("");
    setNewDraft((draft) => (draft.category || !category ? draft : { ...draft, category }));
    setView({ mode: "new" });
  }

  function updateNewDraft(patch) {
    setNewDraft((draft) => ({ ...draft, ...patch }));
    setNewErrors((errors) => {
      const next = { ...errors };
      Object.keys(patch).forEach((key) => delete next[key]);
      return next;
    });
  }

  async function submitThread() {
    if (submitting) return;
    const errors = validateThread(newDraft, categories);
    setNewErrors(errors);
    if (Object.keys(errors).length > 0) return;
    setSubmitting(true);
    setSubmitError("");
    try {
      const thread = await client.createThread(scope, newDraft);
      setThreads((list) => [...list, thread]);
      setNewDraft(EMPTY_DRAFT);
      setView({ mode: "thread", id: thread.id });
    } catch (error) {
      handleError(error, setSubmitError);
    } finally {
      setSubmitting(false);
    }
  }

  function updateReplyDraft(threadId, body) {
    setReplyDrafts((drafts) => ({ ...drafts, [threadId]: body }));
    setReplyError("");
  }

  async function submitReply(threadId) {
    if (submitting) return;
    const body = replyDrafts[threadId] || "";
    const problem = validateReply(body);
    setReplyError(problem);
    if (problem) return;
    setSubmitting(true);
    try {
      const reply = await client.createReply(threadId, { body });
      setDetail((current) =>
        current.thread?.id === threadId
          ? { ...current, replies: [...current.replies, reply] }
          : current
      );
      setThreads((list) =>
        list.map((thread) =>
          thread.id === threadId ? { ...thread, replyCount: thread.replyCount + 1 } : thread
        )
      );
      setReplyDrafts((drafts) => ({ ...drafts, [threadId]: "" }));
    } catch (error) {
      handleError(error, setReplyError);
    } finally {
      setSubmitting(false);
    }
  }

  return {
    threads,
    listStatus,
    listError,
    reloadList: () => setListAttempt((attempt) => attempt + 1),
    filters,
    setFilters: (patch) => setFilters((current) => ({ ...current, ...patch })),
    view,
    openThread,
    showList,
    startNew,
    detail,
    reloadThread: () => setDetailAttempt((attempt) => attempt + 1),
    newDraft,
    newErrors,
    updateNewDraft,
    submitThread,
    submitError,
    replyDraft: openId ? replyDrafts[openId] || "" : "",
    updateReplyDraft,
    submitReply,
    replyError,
    submitting,
  };
}
