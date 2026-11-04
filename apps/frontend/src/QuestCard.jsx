import { formatItemWindow } from "./dates.js";
import { itemKindLabel } from "./format.js";
import { bannerClassName, truncateText } from "./questBanners.js";

// A published quest or event on the board. Points only exist on quests.
function QuestCard({ quest, joined = false, onView }) {
  const isQuest = quest.kind !== "event";
  const actionLabel = isQuest ? "View quest" : "View event";
  return (
    <li className="quest-card discovery-card">
      <div className={bannerClassName(quest.category)} aria-hidden="true">
        <span className="quest-banner-stamp">{itemKindLabel(quest.kind)}</span>
      </div>
      <div className="quest-card-body">
        <div className="quest-card-meta">
          <span className="badge badge-category">{quest.category || "Campus"}</span>
          {isQuest && <span className="badge badge-points">{quest.pointValue ?? "—"} pts</span>}
          {joined && <span className="badge badge-joined">{isQuest ? "Joined" : "Going"}</span>}
        </div>
        <h3 className="quest-card-title">{quest.title}</h3>
        <p className="small muted quest-card-when">
          {formatItemWindow(quest.startsAt, quest.endsAt, quest.timeZone)}
        </p>
        <p className="small muted quest-card-where">{quest.location}</p>
        <p className="quest-card-blurb">{truncateText(quest.description)}</p>
        <div className="request-actions">
          <button
            type="button"
            className="button button-secondary button-small"
            onClick={() => onView(quest.id)}
            aria-label={`${actionLabel}: ${quest.title}`}
          >
            {actionLabel}
          </button>
        </div>
      </div>
    </li>
  );
}

export default QuestCard;
