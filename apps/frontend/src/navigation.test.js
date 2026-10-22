import { beforeEach, describe, expect, it, vi } from "vitest";
import { roleRequestsEnabled } from "./api.js";
import { pagesFor, resolvePage } from "./navigation.js";

vi.mock("./api.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, roleRequestsEnabled: vi.fn() };
});

function pageIds(roles) {
  return pagesFor(roles).map((page) => page.id);
}

beforeEach(() => {
  vi.resetAllMocks();
  roleRequestsEnabled.mockReturnValue(true);
});

describe("Role-aware pages (FE-10)", () => {
  it.each([
    [[], ["account"]],
    [["student"], ["account"]],
    [["student", "organizer"], ["account"]],
    [["student", "moderator"], ["account"]],
    [["admin"], ["account", "admin"]],
    [["student", "organizer", "moderator", "admin"], ["account", "admin"]],
  ])("roles %j see %j", (roles, expected) => {
    expect(pageIds(roles)).toEqual(expected);
  });

  it("hides a page the backend doesn't support, even for a role that may see it", () => {
    roleRequestsEnabled.mockReturnValue(false);
    expect(pageIds(["admin"])).toEqual(["account"]);
  });

  it("ignores roles it doesn't know", () => {
    expect(pageIds(["superuser"])).toEqual(["account"]);
  });

  it("resolves a page the user may not see to the default page", () => {
    const pages = pagesFor(["student"]);
    expect(resolvePage(pages, "admin").id).toBe("account");
    expect(resolvePage(pagesFor(["admin"]), "admin").id).toBe("admin");
  });
});
