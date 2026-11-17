const ROLE_LABELS = {
  admin: "Admin",
  moderator: "Moderator",
  organizer: "Organizer",
  student: "Student",
};

// Role request and participation statuses.
const STATUS_LABELS = {
  approved: "Approved",
  joined: "Joined",
  pending: "Pending approval",
  rejected: "Rejected",
};

const ITEM_KIND_LABELS = {
  event: "Event",
  quest: "Quest",
};

const ITEM_STATUS_LABELS = {
  draft: "Draft",
  published: "Published",
};

export function roleLabel(role) {
  return ROLE_LABELS[role] || role;
}

export function statusLabel(status) {
  return STATUS_LABELS[status] || status;
}

export function itemKindLabel(kind) {
  return ITEM_KIND_LABELS[kind] || kind;
}

export function itemStatusLabel(status) {
  return ITEM_STATUS_LABELS[status] || status;
}

export const questStatusLabel = itemStatusLabel;

// Quest times are sent as ISO 8601 with a time zone, so they are shown in local time.
export function formatDateTime(timestamp) {
  const date = new Date(timestamp);
  if (!timestamp || Number.isNaN(date.getTime())) return "";
  const pad = (number) => String(number).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

export function formatTimeWindow(startsAt, endsAt) {
  const start = formatDateTime(startsAt);
  const end = formatDateTime(endsAt);
  if (!start || !end) return start || end;
  // Leave out the date of the end time when it's the same day.
  return start.slice(0, 10) === end.slice(0, 10)
    ? `${start} – ${end.slice(11)}`
    : `${start} – ${end}`;
}

// The backend's timestamps have no time zone, so show the date exactly as sent
// instead of converting it to the browser's time zone.
export function formatDate(timestamp) {
  return timestamp ? timestamp.slice(0, 10) : "";
}
