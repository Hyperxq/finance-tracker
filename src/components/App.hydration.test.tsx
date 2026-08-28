import { act } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HouseholdAuth } from "../lib/household-auth";
import { App } from "./App";

const auth: HouseholdAuth = {
  getAccess: vi.fn().mockResolvedValue({ status: "signed-out" }),
  subscribe: vi.fn(() => vi.fn()),
  signIn: vi.fn(),
  signOut: vi.fn(),
};

afterEach(() => {
  window.history.replaceState({}, "", "/");
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("App hydration", () => {
  it("preserves an OAuth rejection received after server rendering", async () => {
    const container = document.createElement("div");
    container.innerHTML = renderToString(<App auth={auth} workspace={<div>Household</div>} />);
    document.body.append(container);
    window.history.replaceState(
      {},
      "",
      "/bank/?error=access_denied&error_description=This+Google+account+is+not+a+member+of+this+household.",
    );
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const root = hydrateRoot(container, <App auth={auth} workspace={<div>Household</div>} />);

    await expect.poll(() => container.querySelector('[role="alert"]')?.textContent).toContain(
      "This Google account is not part of Daniel & Andrea's household",
    );
    expect(consoleError).not.toHaveBeenCalledWith(expect.stringContaining("Hydration failed"));

    act(() => root.unmount());
  });
});
