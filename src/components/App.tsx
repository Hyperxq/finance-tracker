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
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

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
        {!access && !error ? (
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
              <GoogleLogoIcon size={22} weight="bold" />{busy ? "Opening Google…" : "Continue with Google"}
            </button>
            <small><ShieldCheckIcon size={17} weight="duotone" />Only invited household accounts can continue.</small>
          </>
        )}
        {error && <div className="auth-error" role="alert">{error}</div>}
      </section>
    </main>
  );
}
