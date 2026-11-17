import { useState } from "react";
import {
  DEFAULT_QUEST_TIME_ZONE,
  QUEST_CATEGORY_MAX_LENGTH,
  QUEST_DESCRIPTION_MAX_LENGTH,
  QUEST_LOCATION_MAX_LENGTH,
  QUEST_POINTS_MAX,
  QUEST_POINTS_MIN,
  QUEST_PROOF_MAX_LENGTH,
  QUEST_TIME_ZONE_MAX_LENGTH,
  QUEST_TITLE_MAX_LENGTH,
  formErrorsFrom,
  getQuestClient,
  questApiUnavailableMessage,
} from "./api.js";
import { CATEGORY_SUGGESTIONS } from "./questFilters.js";
import { describeWallTimeError, isValidTimeZone, wallTimeToIso } from "./questTime.js";

// Form fields use the API's field names (QuestCreate on QB-50).
const EMPTY_FORM = {
  title: "",
  description: "",
  location: "",
  starts_at: "",
  ends_at: "",
  time_zone: DEFAULT_QUEST_TIME_ZONE,
  category: "",
  proof_instructions: "",
  point_value: "",
};
const FIELD_NAMES = Object.keys(EMPTY_FORM);

const TEXT_LIMITS = {
  title: ["Title", QUEST_TITLE_MAX_LENGTH],
  description: ["Description", QUEST_DESCRIPTION_MAX_LENGTH],
  location: ["Location", QUEST_LOCATION_MAX_LENGTH],
  category: ["Category", QUEST_CATEGORY_MAX_LENGTH],
  proof_instructions: ["Proof instructions", QUEST_PROOF_MAX_LENGTH],
  time_zone: ["Time zone", QUEST_TIME_ZONE_MAX_LENGTH],
};

function validate(form) {
  const errors = {};
  for (const [field, [label, maxLength]] of Object.entries(TEXT_LIMITS)) {
    const value = form[field].trim();
    if (value === "") {
      errors[field] = `Please enter the ${label.toLowerCase()}.`;
    } else if (value.length > maxLength) {
      errors[field] = `${label} must be at most ${maxLength} characters.`;
    }
  }

  const timeZone = form.time_zone.trim();
  if (!errors.time_zone && !isValidTimeZone(timeZone)) {
    errors.time_zone = "Enter a valid IANA time zone such as Europe/Paris.";
  }

  const starts = wallTimeToIso(form.starts_at, timeZone);
  const ends = wallTimeToIso(form.ends_at, timeZone);
  if (starts.error) {
    errors.starts_at =
      starts.error === "invalid"
        ? "Please choose when the quest starts."
        : describeWallTimeError(starts.error, "start time");
  }
  if (ends.error) {
    errors.ends_at =
      ends.error === "invalid"
        ? "Please choose when the quest ends."
        : describeWallTimeError(ends.error, "end time");
  } else if (starts.iso && ends.iso && ends.iso <= starts.iso) {
    errors.ends_at = "The end must be after the start.";
  }

  const points = form.point_value.trim();
  if (!/^\d+$/.test(points)) {
    errors.point_value = "Please enter a whole number of points.";
  } else if (Number(points) < QUEST_POINTS_MIN || Number(points) > QUEST_POINTS_MAX) {
    errors.point_value = `Points must be between ${QUEST_POINTS_MIN} and ${QUEST_POINTS_MAX}.`;
  }
  return errors;
}

function toPayload(form) {
  const timeZone = form.time_zone.trim();
  return {
    title: form.title.trim(),
    description: form.description.trim(),
    location: form.location.trim(),
    starts_at: wallTimeToIso(form.starts_at, timeZone).iso,
    ends_at: wallTimeToIso(form.ends_at, timeZone).iso,
    time_zone: timeZone,
    category: form.category.trim(),
    proof_instructions: form.proof_instructions.trim(),
    point_value: Number(form.point_value.trim()),
  };
}

function successCopy(quest, isDemo) {
  const where = [quest.location, quest.category].filter(Boolean).join(" · ");
  const points = quest.pointValue != null ? `${quest.pointValue} points` : "";
  const details = [where, points].filter(Boolean).join(" · ");
  const base = `"${quest.title}" was saved as draft #${quest.id}${details ? ` (${details})` : ""}.`;
  if (isDemo) {
    return `${base} Demo mode — sample data only; this was not saved to the database.`;
  }
  return `${base} Students can't see it until you publish it from your items above.`;
}

// Create quest form (QB-58). A new quest is always saved as a draft.
// `onResultUnknown` is called when the save may or may not have happened, so the caller
// can reload the organizer's items to show whether it did.
function QuestForm({ session, onCreated, onResultUnknown, onSessionExpired }) {
  const client = getQuestClient(session);
  const [form, setForm] = useState(EMPTY_FORM);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function saved(quest) {
    setForm(EMPTY_FORM);
    setSuccessMessage(successCopy(quest, client.isDemo));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (isSubmitting) return;

    const newErrors = validate(form);
    setErrors(newErrors);
    setFormError("");
    setSuccessMessage("");
    if (Object.keys(newErrors).length > 0) return;

    if (Date.now() >= Date.parse(session.expiresAt)) {
      onSessionExpired();
      return;
    }

    const payload = toPayload(form);
    setIsSubmitting(true);
    try {
      const created = await client.createQuest(payload);
      onCreated?.(created);
      saved(created);
    } catch (error) {
      if (error.status === 401) {
        onSessionExpired();
        return;
      }
      if (error.resultUnknown) {
        // Nothing identifies a retried create, so never resubmit automatically.
        setFormError(
          `We couldn't confirm the result of saving "${payload.title}". ${error.message} ` +
            "Your details are still below. Check your items for this draft before saving again, " +
            "so you don't create it twice."
        );
        onResultUnknown?.();
      } else if (error.status === 403) {
        setFormError(`You don't have permission to create quests. ${error.message}`);
      } else if (error.status === 404 || error.status === 405 || error.isUnsupported) {
        setFormError(questApiUnavailableMessage(error, "save this quest"));
      } else {
        const mapped = formErrorsFrom(error, FIELD_NAMES);
        setErrors(mapped.fieldErrors);
        setFormError(mapped.formError);
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  function textField(field, label, { multiline = false, hint = "", list } = {}) {
    const Input = multiline ? "textarea" : "input";
    const hintId = hint ? `quest-${field}-hint` : undefined;
    return (
      <div className="field">
        <label htmlFor={`quest-${field}`}>{label}</label>
        <Input
          id={`quest-${field}`}
          type={multiline ? undefined : "text"}
          rows={multiline ? 3 : undefined}
          aria-describedby={hintId}
          list={list}
          value={form[field]}
          onChange={(event) => update(field, event.target.value)}
          className={errors[field] ? "invalid" : ""}
        />
        {hint && (
          <p className="hint" id={hintId}>
            {hint}
          </p>
        )}
        <p className="error">{errors[field]}</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="quest-form">
      <div className="form-grid">
        {textField("title", "Title")}
        {textField("category", "Category", {
          hint: "Pick a suggestion or type your own. Students can filter by it.",
          list: "quest-category-suggestions",
        })}
        <datalist id="quest-category-suggestions">
          {CATEGORY_SUGGESTIONS.map((category) => (
            <option key={category} value={category} />
          ))}
        </datalist>
      </div>
      {textField("description", "Description", { multiline: true })}
      <div className="form-grid">
        {textField("location", "Location")}
        {textField("time_zone", "Time zone", {
          hint: "IANA name for where the quest happens. Start and end times use this zone, not your computer’s.",
        })}
      </div>

      <div className="field-row">
        <div className="field">
          <label htmlFor="quest-starts_at">Starts</label>
          <input
            id="quest-starts_at"
            type="datetime-local"
            value={form.starts_at}
            onChange={(event) => update("starts_at", event.target.value)}
            className={errors.starts_at ? "invalid" : ""}
          />
          <p className="error">{errors.starts_at}</p>
        </div>
        <div className="field">
          <label htmlFor="quest-ends_at">Ends</label>
          <input
            id="quest-ends_at"
            type="datetime-local"
            value={form.ends_at}
            onChange={(event) => update("ends_at", event.target.value)}
            className={errors.ends_at ? "invalid" : ""}
          />
          <p className="error">{errors.ends_at}</p>
        </div>
      </div>

      {textField("proof_instructions", "Proof instructions", {
        multiline: true,
        hint: "What students must submit to show they completed the quest.",
      })}

      <div className="field field-narrow">
        <label htmlFor="quest-point_value">Points</label>
        <input
          id="quest-point_value"
          type="number"
          inputMode="numeric"
          min={QUEST_POINTS_MIN}
          max={QUEST_POINTS_MAX}
          step="1"
          aria-describedby="quest-points-hint"
          value={form.point_value}
          onChange={(event) => update("point_value", event.target.value)}
          className={errors.point_value ? "invalid" : ""}
        />
        <p className="hint" id="quest-points-hint">
          {QUEST_POINTS_MIN}–{QUEST_POINTS_MAX} points.
        </p>
        <p className="error">{errors.point_value}</p>
      </div>

      <div className="form-actions">
        <button type="submit" className="button button-inline" disabled={isSubmitting}>
          {isSubmitting ? "Saving draft…" : "Save as draft"}
        </button>
      </div>
      <p className="form-error form-error-left" role="alert">
        {formError}
      </p>
      <p className="message message-left" aria-live="polite">
        {successMessage}
      </p>
    </form>
  );
}

export default QuestForm;
