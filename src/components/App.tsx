import { GoogleLogoIcon, LockKeyIcon, ShieldCheckIcon } from "@phosphor-icons/react";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { createHouseholdAuth, type HouseholdAccess, type HouseholdAuth } from "../lib/household-auth";
import { createFinanceStore } from "../lib/finance-store";
import { getSupabaseClient } from "../lib/supabase";
import { ReceiptWorkspace } from "./ReceiptWorkspace";

type AppProps = {
  auth?: HouseholdAuth;
  workspace?: ReactNode;
};

const oauthErrorKeys = ["error", "error_code", "error_description", "sb"];

function consumeOAuthError() {
  if (typeof window === "undefined") return "";

  const url = new URL(window.location.href);
  const hashParameters = new URLSearchParams(url.hash.replace(/^#/, ""));
  const error = url.searchParams.get("error") ?? hashParameters.get("error");
  const description = url.searchParams.get("error_description") ?? hashParameters.get("error_description");
  if (!error && !description) return "";

  oauthErrorKeys.forEach((key) => {
    url.searchParams.delete(key);
    hashParameters.delete(key);
  });
  url.hash = hashParameters.toString() ? `#${hashParameters.toString()}` : "";
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);

  return description?.toLowerCase().includes("not a member")
    ? "This Google account is not part of Daniel & Andrea's household. Try again with an invited account."
    : "Google sign-in was not completed. Try again with another account.";
}

export function App({ auth, workspace }: AppProps) {
  const householdAuth = useMemo(
    () => auth ?? createHouseholdAuth(getSupabaseClient()),
    [auth],
  );
  const financeStore = useMemo(
    () => workspace ? undefined : createFinanceStore(getSupabaseClient()),
    [workspace],
  );
  const [access, setAccess] = useState<HouseholdAccess | null>(null);
  const [oauthError, setOauthError] = useState(consumeOAuthError);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const visibleError = oauthError || error;

  const refreshAccess = useCallback(async () => {
    try {
      setError("");
      setAccess(await householdAuth.getAccess());
    } catch {
      setError("Night Ledger could not verify your household access. Try again.");
    }
  }, [householdAuth]);

  useEffect(() => {
    void refreshAccess();
    return householdAuth.subscribe(() => void refreshAccess());
  }, [householdAuth, refreshAccess]);

  const signIn = async () => {
    setBusy(true);
    setOauthError("");
    setError("");
    try {
      await householdAuth.signIn();
    } catch {
      setError("Google sign-in could not start. Try again.");
      setBusy(false);
    }
  };

  const signOut = async () => {
    setBusy(true);
    try {
      await householdAuth.signOut();
      setAccess({ status: "signed-out" });
    } catch {
      setError("Night Ledger could not sign you out. Try again.");
    } finally {
      setBusy(false);
    }
  };

  if (access?.status === "authorized") {
    return workspace ?? (
      <ReceiptWorkspace
        memberName={access.displayName}
        memberEmail={access.email}
        onSignOut={() => void signOut()}
        receiptStore={financeStore}
        bankStore={financeStore}
      />
    );
  }

  return (
    <main className="auth-shell">
      <section className="auth-card" aria-live="polite">
        <div className="auth-mark"><LockKeyIcon size={34} weight="duotone" /></div>
        <p className="eyebrow">Private household ledger</p>
        {!access && !visibleError ? (
          <>
            <h1>Opening your household</h1>
            <p>Checking your secure session…</p>
            <span className="auth-loader" aria-label="Checking household access" />
          </>
        ) : access?.status === "denied" ? (
          <>
            <h1>Private household</h1>
            <p><strong>{access.email}</strong> is signed in, but it is not a member of this household.</p>
            <button className="secondary-button" type="button" disabled={busy} onClick={() => void signOut()}>
              Use another account
            </button>
          </>
        ) : (
          <>
            <h1>Daniel &amp; Andrea’s finances, together</h1>
            <p>Receipts and bank activity stay inside your shared household.</p>
            <button className="primary-button auth-google" type="button" disabled={busy} onClick={() => void signIn()}>
              <GoogleLogoIcon size={22} weight="bold" />{busy ? "Opening Google…" : oauthError ? "Try another Google account" : "Continue with Google"}
            </button>
            <small><ShieldCheckIcon size={17} weight="duotone" />Only invited household accounts can continue.</small>
          </>
        )}
        {visibleError && <div className="auth-error" role="alert">{visibleError}</div>}
      </section>
    </main>
  );
}
