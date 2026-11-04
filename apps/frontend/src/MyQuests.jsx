import { useEffect, useRef, useState } from "react";
import MyItems from "./MyItems.jsx";
import QuestForm from "./QuestForm.jsx";

// The organizer's page: their own quests and events with Publish, Edit and Participants
// (QB-60, FE-14, FE-17), and the create quest form (QB-58). The form keeps what was typed
// while the list above it reloads.
function MyQuests({ session, openCreate = false, onSessionExpired }) {
  const createRef = useRef(null);
  const [createdItem, setCreatedItem] = useState(null);
  const [listReloadKey, setListReloadKey] = useState(0);

  useEffect(() => {
    if (!openCreate || !createRef.current) return;
    createRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    const title = createRef.current.querySelector("#quest-title");
    if (title) title.focus();
  }, [openCreate]);

  return (
    <div className="page-stack">
      <section className="section panel" aria-label="Your quests and events">
        <MyItems
          session={session}
          onSessionExpired={onSessionExpired}
          createdItem={createdItem}
          reloadKey={listReloadKey}
        />
      </section>

      <section ref={createRef} className="section panel" aria-labelledby="create-quest-title">
        <h3 className="section-title" id="create-quest-title">
          Create a quest
        </h3>
        <QuestForm
          session={session}
          onCreated={setCreatedItem}
          onResultUnknown={() => setListReloadKey((key) => key + 1)}
          onSessionExpired={onSessionExpired}
        />
      </section>
    </div>
  );
}

export default MyQuests;
