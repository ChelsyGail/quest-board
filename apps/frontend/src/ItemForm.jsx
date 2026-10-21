import { useState } from "react";
import {
  ITEM_CATEGORY_MAX_LENGTH,
  ITEM_DESCRIPTION_MAX_LENGTH,
  ITEM_LOCATION_MAX_LENGTH,
  ITEM_TITLE_MAX_LENGTH,
  POINT_VALUE_MAX,
  POINT_VALUE_MIN,
  PROOF_INSTRUCTIONS_MAX_LENGTH,
} from "./api.js";
import {
  browserTimeZone,
  isoToZonedInput,
  timeZoneOptions,
  zonedInputToIso,
} from "./dates.js";

// The form's fields use the backend's names, so the backend's field errors (which point
// at those names) show next to the right input.
export const ITEM_FIELDS = [
  "title",
  "description",
  "location",
  "category",
  "starts_at",
  "ends_at",
  "time_zone",
];

// Fields only quests have.
export const QUEST_FIELDS = ["proof_instructions", "point_value"];

export function itemFields(kind) {
  return kind === "quest" ? [...ITEM_FIELDS, ...QUEST_FIELDS] : ITEM_FIELDS;
}

const TEXT_LIMITS = {
  title: ["Title", ITEM_TITLE_MAX_LENGTH],
  description: ["Description", ITEM_DESCRIPTION_MAX_LENGTH],
  location: ["Location", ITEM_LOCATION_MAX_LENGTH],
  category: ["Category", ITEM_CATEGORY_MAX_LENGTH],
};

export function emptyItemValues() {
  return {
    title: "",
    description: "",
    location: "",
    category: "",
    starts_at: "",
    ends_at: "",
    time_zone: browserTimeZone(),
  };
}

// Form values for an existing item, with its times shown in its own zone.
export function itemFormValues(item) {
  const values = {
    title: item.title,
    description: item.description,
    location: item.location,
    category: item.category,
    starts_at: isoToZonedInput(item.startsAt, item.timeZone),
    ends_at: isoToZonedInput(item.endsAt, item.timeZone),
    time_zone: item.timeZone,
  };
  if (item.kind === "quest") {
    values.proof_instructions = item.proofInstructions;
    values.point_value = item.pointValue === null ? "" : String(item.pointValue);
  }
  return values;
}

// The request body for these form values: trimmed text and UTC times, plus the quest
// fields for a quest.
export function itemPayload(values, kind = "event") {
  const payload = {
    title: values.title.trim(),
    description: values.description.trim(),
    location: values.location.trim(),
    category: values.category.trim(),
    starts_at: zonedInputToIso(values.starts_at, values.time_zone),
    ends_at: zonedInputToIso(values.ends_at, values.time_zone),
    time_zone: values.time_zone,
  };
  if (kind === "quest") {
    payload.proof_instructions = values.proof_instructions.trim();
    payload.point_value = Number(values.point_value);
  }
  return payload;
}

// The same checks as the backend, so most mistakes are caught before sending.
function validate(values, kind) {
  const errors = {};
  for (const [field, [label, maxLength]] of Object.entries(TEXT_LIMITS)) {
    const value = values[field].trim();
    if (!value) {
      errors[field] = `${label} is required.`;
    } else if (value.length > maxLength) {
      errors[field] = `${label} must be at most ${maxLength} characters.`;
    }
  }

  const startsAt = zonedInputToIso(values.starts_at, values.time_zone);
  const endsAt = zonedInputToIso(values.ends_at, values.time_zone);
  if (!startsAt) errors.starts_at = "Start time is required.";
  if (!endsAt) {
    errors.ends_at = "End time is required.";
  } else if (startsAt && Date.parse(endsAt) <= Date.parse(startsAt)) {
    errors.ends_at = "End time must be after the start time.";
  }
  if (!values.time_zone) errors.time_zone = "Time zone is required.";

  if (kind === "quest") {
    const proof = values.proof_instructions.trim();
    if (!proof) {
      errors.proof_instructions = "Proof instructions are required.";
    } else if (proof.length > PROOF_INSTRUCTIONS_MAX_LENGTH) {
      errors.proof_instructions =
        `Proof instructions must be at most ${PROOF_INSTRUCTIONS_MAX_LENGTH} characters.`;
    }
    const points = Number(values.point_value);
    if (
      !/^\d+$/.test(values.point_value.trim()) ||
      points < POINT_VALUE_MIN ||
      points > POINT_VALUE_MAX
    ) {
      errors.point_value =
        `Points must be a whole number from ${POINT_VALUE_MIN} to ${POINT_VALUE_MAX}.`;
    }
  }
  return errors;
}

// Form for an event's or quest's details; `kind` "quest" adds the quest-only fields. It keeps what was typed; the parent sends the request
// and passes back `serverErrors` (by field) and `formError`. Remount it with a new `key`
// to clear it.
function ItemForm({
  kind = "event",
  initialValues,
  submitLabel,
  submittingLabel,
  isSubmitting,
  serverErrors = {},
  formError = "",
  onSubmit,
  onCancel,
}) {
  const [values, setValues] = useState(initialValues);
  const [errors, setErrors] = useState({});
  const zones = timeZoneOptions(values.time_zone);
  const shownErrors = { ...serverErrors, ...errors };

  function change(field, value) {
    setValues((current) => ({ ...current, [field]: value }));
  }

  function handleSubmit(event) {
    event.preventDefault();
    if (isSubmitting) return;

    const found = validate(values, kind);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    onSubmit(values);
  }

  function inputProps(field) {
    return {
      id: `item-${field}`,
      value: values[field],
      onChange: (event) => change(field, event.target.value),
      className: shownErrors[field] ? "invalid" : "",
      "aria-invalid": shownErrors[field] ? true : undefined,
      "aria-describedby": `item-${field}-error`,
    };
  }

  function errorFor(field) {
    return (
      <p className="error" id={`item-${field}-error`}>
        {shownErrors[field]}
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="item-form">
      <div className="field">
        <label htmlFor="item-title">Title</label>
        <input type="text" {...inputProps("title")} />
        {errorFor("title")}
      </div>

      <div className="field">
        <label htmlFor="item-description">Description</label>
        <textarea rows="4" {...inputProps("description")} />
        {errorFor("description")}
      </div>

      <div className="field">
        <label htmlFor="item-location">Location</label>
        <input type="text" {...inputProps("location")} />
        {errorFor("location")}
      </div>

      <div className="field">
        <label htmlFor="item-category">Category</label>
        <input type="text" placeholder="e.g. Sports, Music, Study" {...inputProps("category")} />
        {errorFor("category")}
      </div>

      <div className="field-row">
        <div className="field">
          <label htmlFor="item-starts_at">Starts</label>
          <input type="datetime-local" {...inputProps("starts_at")} />
          {errorFor("starts_at")}
        </div>
        <div className="field">
          <label htmlFor="item-ends_at">Ends</label>
          <input type="datetime-local" {...inputProps("ends_at")} />
          {errorFor("ends_at")}
        </div>
      </div>

      <div className="field">
        <label htmlFor="item-time_zone">Time zone</label>
        <select {...inputProps("time_zone")}>
          {zones.map((zone) => (
            <option key={zone} value={zone}>
              {zone.replace(/_/g, " ")}
            </option>
          ))}
        </select>
        <p className="hint">The start and end times are in this time zone.</p>
        {errorFor("time_zone")}
      </div>

      {kind === "quest" && (
        <>
          <div className="field">
            <label htmlFor="item-proof_instructions">Proof instructions</label>
            <textarea rows="3" {...inputProps("proof_instructions")} />
            <p className="hint">What students must submit to show they completed the quest.</p>
            {errorFor("proof_instructions")}
          </div>

          <div className="field">
            <label htmlFor="item-point_value">Points</label>
            <input
              type="number"
              inputMode="numeric"
              min={POINT_VALUE_MIN}
              max={POINT_VALUE_MAX}
              step="1"
              {...inputProps("point_value")}
            />
            {errorFor("point_value")}
          </div>
        </>
      )}

      <button type="submit" className="button" disabled={isSubmitting}>
        {isSubmitting ? submittingLabel : submitLabel}
      </button>
      {onCancel && (
        <button
          type="button"
          className="button button-secondary button-block"
          onClick={onCancel}
          disabled={isSubmitting}
        >
          Cancel
        </button>
      )}
      <p className="form-error" role="alert">
        {formError}
      </p>
    </form>
  );
}

export default ItemForm;
