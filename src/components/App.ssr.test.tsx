// @vitest-environment node
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { HouseholdAuth } from "../lib/household-auth";
import { App } from "./App";

const auth: HouseholdAuth = {
  getAccess: vi.fn(),
  subscribe: vi.fn(() => vi.fn()),
  signIn: vi.fn(),
  signOut: vi.fn(),
};

describe("App server rendering", () => {
  it("does not read browser APIs during Astro prerender", () => {
    expect(() => renderToString(<App auth={auth} workspace={<div>Household</div>} />)).not.toThrow();
  });
});
