import { useState } from "react";
import { formErrorsFrom, updateItem } from "./api.js";
import { itemKindLabel } from "./format.js";
import ItemForm, { itemFields, itemFormValues, itemPayload } from "./ItemForm.jsx";

// The fields whose value differs from the item as loaded, in the backend's format.
function changedFields(item, values) {
  const before = itemPayload(itemFormValues(item), item.kind);
  const after = itemPayload(values, item.kind);
  return Object.fromEntries(
    Object.entries(after).filter(([field, value]) => value !== before[field])
  );
}

// Edit screen for one of the organizer's own events or quests (FE-14). Sends only the
// changed fields. The backend checks ownership on every request.
// `onDone(message, reload)` returns to the list; `reload` asks for a fresh list when this
// one may be out of date.
function EditItem({ session, item, onSaved, onDone, onSessionExpired }) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [serverErrors, setServerErrors] = useState({});
  const [formError, setFormError] = useState("");
  const label = `${itemKindLabel(item.kind).toLowerCase()} "${item.title}"`;

  async function handleSubmit(values) {
    setServerErrors({});
    setFormError("");
    const changes = changedFields(item, values);
    if (Object.keys(changes).length === 0) {
      setFormError("You haven't changed anything yet.");
      return;
    }

    setIsSubmitting(true);
    try {
      const updated = await updateItem(item.id, changes, session.token);
      onSaved(updated);
      return;
    } catch (error) {
      if (error.status === 401) {
        onSessionExpired();
        return;
      }
      if (error.status === 404 || error.code === "item_archived") {
        onDone(`The ${label} can no longer be edited. ${error.message}`, true);
        return;
      }
      if (error.status === 403) {
        onDone(`You can't edit the ${label}. ${error.message}`, true);
        return;
      }
      if (error.resultUnknown) {
        onDone(
          `We couldn't confirm whether your changes to the ${label} were saved. ` +
            `${error.message} Your items have been reloaded; check them before editing again.`,
          true
        );
        return;
      }
      const mapped = formErrorsFrom(error, itemFields(item.kind));
      setServerErrors(mapped.fieldErrors);
      setFormError(mapped.formError);
    }
    setIsSubmitting(false);
  }

  return (
    <>
      <h2 className="screen-title">Edit {label}</h2>
      {item.status === "published" && (
        <p className="hint section-hint">
          This {itemKindLabel(item.kind).toLowerCase()} is published, so students see your
          changes as soon as you save them.
        </p>
      )}
      <ItemForm
        kind={item.kind}
        initialValues={itemFormValues(item)}
        submitLabel="Save changes"
        submittingLabel="Saving changes…"
        isSubmitting={isSubmitting}
        serverErrors={serverErrors}
        formError={formError}
        onSubmit={handleSubmit}
        onCancel={() => onDone("", false)}
      />
    </>
  );
}

export default EditItem;
