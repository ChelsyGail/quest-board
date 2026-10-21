import { catalogueEnabled, roleRequestsEnabled } from "./api.js";

// The signed-in pages, in tab order, and who may see them (FE-10).
// `roles`: the user needs at least one of these; leave it out for a page everyone sees.
// `isAvailable`: an optional check that the backend supports the page.
// `wide`: the page needs the wider card layout.
// Hiding a page is only a convenience; the backend checks roles on every request.
export const PAGES = [
  { id: "account", label: "Your account" },
  {
    id: "my-items",
    label: "My items",
    roles: ["organizer"],
    isAvailable: catalogueEnabled,
    wide: true,
  },
  {
    id: "create-event",
    label: "Create event",
    roles: ["organizer"],
    isAvailable: catalogueEnabled,
    wide: true,
  },
  {
    id: "admin",
    label: "Role requests",
    roles: ["admin"],
    isAvailable: roleRequestsEnabled,
    wide: true,
  },
];

// The pages a user with these roles may see. The first one is the default page.
export function pagesFor(roles) {
  return PAGES.filter(
    (page) =>
      (!page.roles || page.roles.some((role) => roles.includes(role))) &&
      (!page.isAvailable || page.isAvailable())
  );
}

// The page to show: `requestedId` if this user may see it, otherwise the default page.
export function resolvePage(pages, requestedId) {
  return pages.find((page) => page.id === requestedId) || pages[0];
}
