import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
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
});
