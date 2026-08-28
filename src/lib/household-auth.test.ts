import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createHouseholdAuth } from "./household-auth";

function authClient(options: { user?: { id: string; email?: string }; memberName?: string }) {
  let authStateListener: (() => void) | undefined;
  const maybeSingle = vi.fn().mockResolvedValue({
    data: options.memberName ? { display_name: options.memberName } : null,
    error: null,
  });
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  const signInWithOAuth = vi.fn().mockResolvedValue({ error: null });
  const signOut = vi.fn().mockResolvedValue({ error: null });
  const client = {
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: options.user ? { user: options.user } : null },
        error: null,
      }),
      onAuthStateChange: vi.fn((listener) => {
        authStateListener = listener;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      }),
      signInWithOAuth,
      signOut,
    },
    from,
  } as unknown as SupabaseClient;

  return { client, from, signInWithOAuth, signOut, emitAuthState: () => authStateListener?.() };
}

describe("createHouseholdAuth", () => {
  it("keeps signed-out visitors outside the household", async () => {
    const { client, from } = authClient({});

    await expect(createHouseholdAuth(client).getAccess()).resolves.toEqual({ status: "signed-out" });
    expect(from).not.toHaveBeenCalled();
  });

  it("authorizes a Google user with household membership", async () => {
    const { client } = authClient({
      user: { id: "user-1", email: "member@example.test" },
      memberName: "Daniel",
    });

    await expect(createHouseholdAuth(client).getAccess()).resolves.toEqual({
      status: "authorized",
      displayName: "Daniel",
      email: "member@example.test",
    });
  });

  it("denies an authenticated account without household membership", async () => {
    const { client } = authClient({ user: { id: "user-2", email: "outsider@example.test" } });

    await expect(createHouseholdAuth(client).getAccess()).resolves.toEqual({
      status: "denied",
      email: "outsider@example.test",
    });
  });

  it("starts Google OAuth with the current app URL", async () => {
    const { client, signInWithOAuth } = authClient({});
    const auth = createHouseholdAuth(client, () => "https://example.test/finance-tracker/bank");

    await auth.signIn();

    expect(signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: { redirectTo: "https://example.test/finance-tracker/bank" },
    });
  });

  it("defers access queries until the auth callback has returned", async () => {
    vi.useFakeTimers();
    const { client, emitAuthState } = authClient({});
    const listener = vi.fn();

    createHouseholdAuth(client).subscribe(listener);
    emitAuthState();

    expect(listener).not.toHaveBeenCalled();
    await vi.runAllTimersAsync();
    expect(listener).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });
});
