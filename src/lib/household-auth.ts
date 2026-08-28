import type { SupabaseClient } from "@supabase/supabase-js";

export type HouseholdAccess =
  | { status: "signed-out" }
  | { status: "authorized"; displayName: string; email: string }
  | { status: "denied"; email: string };

export type HouseholdAuth = {
  getAccess: () => Promise<HouseholdAccess>;
  subscribe: (listener: () => void) => () => void;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
};

export function createHouseholdAuth(
  client: SupabaseClient,
  redirectUrl = () => window.location.href,
): HouseholdAuth {
  return {
    async getAccess() {
      const { data: sessionData, error: sessionError } = await client.auth.getSession();
      if (sessionError) throw sessionError;
      const user = sessionData.session?.user;
      if (!user) return { status: "signed-out" };

      const { data: membership, error: membershipError } = await client
        .from("household_members")
        .select("display_name")
        .eq("user_id", user.id)
        .maybeSingle();
      if (membershipError) throw membershipError;
      if (!membership) return { status: "denied", email: user.email ?? "Unknown account" };

      return {
        status: "authorized",
        displayName: membership.display_name,
        email: user.email ?? "",
      };
    },

    subscribe(listener) {
      const { data } = client.auth.onAuthStateChange(() => {
        setTimeout(listener, 0);
      });
      return () => data.subscription.unsubscribe();
    },

    async signIn() {
      const { error } = await client.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: redirectUrl(),
          queryParams: { prompt: "select_account" },
        },
      });
      if (error) throw error;
    },

    async signOut() {
      const { error } = await client.auth.signOut();
      if (error) throw error;
    },
  };
}
