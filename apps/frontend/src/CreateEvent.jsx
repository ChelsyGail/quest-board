import { useState } from "react";
import { createEvent, formErrorsFrom } from "./api.js";
import { formatItemTime } from "./dates.js";
import ItemForm, { ITEM_FIELDS, emptyItemValues, itemPayload } from "./ItemForm.jsx";

// Organizer page for creating an event (FE-12). New events are saved as drafts, which
// students can't see. The backend checks the organizer role on every request.
function CreateEvent({ session, onSessionExpired }) {
  const [formKey, setFormKey] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [serverErrors, setServerErrors] = useState({});
  const [formError, setFormError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [forbidden, setForbidden] = useState(false);

  async function handleSubmit(values) {
    setIsSubmitting(true);
    setServerErrors({});
    setFormError("");
    setSuccessMessage("");

    try {
      const created = await createEvent(itemPayload(values), session.token);
      setSuccessMessage(
        `"${created.title}" (${formatItemTime(created.startsAt, created.timeZone)}) ` +
          "was saved as a draft. Students can't see it until it's published."
      );
      // A new key clears the form for the next event.
      setFormKey((key) => key + 1);
    } catch (error) {
      if (error.status === 401) {
        onSessionExpired();
        return;
      }
      if (error.status === 403) {
        setForbidden(true);
      } else if (error.resultUnknown) {
        // The event may have been saved before the answer was lost. Keep what was typed,
        // but don't invite a second click that could create a duplicate.
        setFormError(
          `We couldn't confirm whether the event was saved. ${error.message} ` +
            "Check My items before creating it again."
        );
      } else {
        const mapped = formErrorsFrom(error, ITEM_FIELDS);
        setServerErrors(mapped.fieldErrors);
        setFormError(mapped.formError);
      }
    }
    setIsSubmitting(false);
  }

  return (
    <>
      <h2 className="screen-title">Create an event</h2>
      {forbidden ? (
        <p className="form-error" role="alert">
          Your account doesn't have organizer access, so events can't be created.
        </p>
      ) : (
        <>
          <p className="hint section-hint">
            Events are saved as drafts. Students see them only after they're published.
          </p>
          <p className="message" aria-live="polite">
            {successMessage}
          </p>
          <ItemForm
            key={formKey}
            initialValues={emptyItemValues()}
            submitLabel="Save event"
            submittingLabel="Saving event…"
            isSubmitting={isSubmitting}
            serverErrors={serverErrors}
            formError={formError}
            onSubmit={handleSubmit}
          />
        </>
      )}
    </>
  );
}

export default CreateEvent;
