const ROLE_LABELS = {
  admin: "Admin",
  moderator: "Moderator",
  organizer: "Organizer",
  student: "Student",
};

const STATUS_LABELS = {
  approved: "Approved",
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

// The backend's timestamps have no time zone, so show the date exactly as sent
// instead of converting it to the browser's time zone.
export function formatDate(timestamp) {
  return timestamp ? timestamp.slice(0, 10) : "";
}
