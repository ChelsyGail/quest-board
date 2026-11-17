// Category-based decorative banners. There is no image field on the quest API
// (including Chelsy's QB-50 catalogue model), so these are local CSS themes only.

const THEMES = {
  volunteering: { tone: "forest", motif: "hands" },
  culture: { tone: "clay", motif: "ticket" },
  arts: { tone: "lime", motif: "frame" },
  sports: { tone: "forest", motif: "field" },
  academic: { tone: "ink", motif: "book" },
  social: { tone: "clay", motif: "pin" },
  food: { tone: "lime", motif: "bowl" },
};

export function categoryTheme(category) {
  const key = (category || "").trim().toLowerCase();
  return THEMES[key] || { tone: "forest", motif: "pin" };
}

export function bannerClassName(category) {
  const theme = categoryTheme(category);
  return `quest-banner tone-${theme.tone} motif-${theme.motif}`;
}

export function truncateText(text, maxLength = 110) {
  const value = (text || "").trim().replace(/\s+/g, " ");
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1).trimEnd()}…`;
}
