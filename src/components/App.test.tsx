import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HouseholdAccess, HouseholdAuth } from "../lib/household-auth";
import { App } from "./App";

function householdAuth(access: HouseholdAccess): HouseholdAuth {
  return {
    getAccess: vi.fn().mockResolvedValue(access),
    subscribe: vi.fn(() => vi.fn()),
    signIn: vi.fn().mockResolvedValue(undefined),
    signOut: vi.fn().mockResolvedValue(undefined),
  };
}

const workspace = (content: ReactNode = "Household workspace") => <div>{content}</div>;

afterEach(() => {
  window.history.replaceState({}, "", "/");
});

describe("App authentication", () => {
  it("offers Google sign-in to signed-out visitors", async () => {
    const auth = householdAuth({ status: "signed-out" });
    render(<App auth={auth} workspace={workspace()} />);

    await userEvent.click(await screen.findByRole("button", { name: /continue with google/i }));

    expect(auth.signIn).toHaveBeenCalledOnce();
  });

  it("renders the household only for an authorized member", async () => {
    const auth = householdAuth({
      status: "authorized",
      displayName: "Andrea",
      email: "andrea@example.test",
    });
    render(<App auth={auth} workspace={workspace()} />);

    expect(await screen.findByText("Household workspace")).toBeInTheDocument();
  });

  it("blocks authenticated accounts without household membership", async () => {
    const auth = householdAuth({ status: "denied", email: "outsider@example.test" });
    render(<App auth={auth} workspace={workspace()} />);

    expect(await screen.findByRole("heading", { name: /private household/i })).toBeInTheDocument();
    expect(screen.queryByText("Household workspace")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /use another account/i }));
    await waitFor(() => expect(auth.signOut).toHaveBeenCalledOnce());
  });

  it("explains an OAuth rejection and offers another Google account", async () => {
    window.history.replaceState(
      {},
      "",
      "/bank/?error=access_denied&error_description=This+Google+account+is+not+a+member+of+this+household.#error=access_denied&error_description=This+Google+account+is+not+a+member+of+this+household.",
    );
    const auth = householdAuth({ status: "signed-out" });

    render(<App auth={auth} workspace={workspace()} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This Google account is not part of Daniel & Andrea's household",
    );
    expect(window.location.href).not.toContain("error_description");

    await userEvent.click(screen.getByRole("button", { name: /try another google account/i }));
    expect(auth.signIn).toHaveBeenCalledOnce();
  });
});
