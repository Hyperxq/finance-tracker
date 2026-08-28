import { readFileSync } from "node:fs";
import { fileURLToPath, URL as NodeURL } from "node:url";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  fileURLToPath(new NodeURL("../supabase/migrations/20260828000000_household_finance.sql", import.meta.url)),
  "utf8",
);
const membershipMigration = readFileSync(
  fileURLToPath(new NodeURL("../supabase/migrations/20260828010000_authorize_household_members.sql", import.meta.url)),
  "utf8",
);

describe("Supabase household schema", () => {
  it("applies the household schema as one transaction", () => {
    expect(migration.trimStart()).toMatch(/^begin;/);
    expect(migration.trimEnd()).toMatch(/commit;$/);
  });

  it("keeps the email allowlist private and accepts Google identities only", () => {
    expect(migration).not.toContain("@gmail.com");
    expect(migration).toContain("private.allowed_member_emails");
    expect(migration).toContain("hook_restrict_household_signup");
    expect(migration).toContain("provider <> 'google'");
  });

  it("grants the auth hook only the private allowlist access it needs", () => {
    const hookDefinition = migration.match(
      /create or replace function public\.hook_restrict_household_signup[\s\S]*?\n\$\$;/,
    )?.[0];

    expect(migration).toContain("grant usage on schema public, private, extensions to supabase_auth_admin");
    expect(migration).toContain("grant select on private.allowed_member_emails to supabase_auth_admin");
    expect(hookDefinition).not.toContain("security definer");
  });

  it("backfills an authorized member who authenticated before the migration", () => {
    expect(migration).toMatch(/insert into public\.household_members[\s\S]*?from auth\.users/);
  });

  it.each([
    "households",
    "household_members",
    "receipts",
    "receipt_items",
    "cards",
    "bank_statements",
    "bank_transactions",
  ])("enables row-level security for %s", (table) => {
    expect(migration).toContain(`alter table public.${table} enable row level security`);
  });

  it("saves receipt and statement aggregates atomically", () => {
    expect(migration).toContain("function public.save_receipt");
    expect(migration).toContain("function public.import_bank_statement");
  });

  it("lets Google authentication finish before deciding household access", () => {
    const hookDefinition = membershipMigration.match(
      /create or replace function public\.hook_restrict_household_signup[\s\S]*?\n\$\$;/,
    )?.[0];

    expect(hookDefinition).toContain("provider = 'google'");
    expect(hookDefinition).toContain("return '{}'::jsonb");
    expect(hookDefinition).not.toContain("allowed_member_emails");
  });

  it("only creates membership for a normalized allowlisted Google email", () => {
    const triggerDefinition = membershipMigration.match(
      /create or replace function private\.handle_new_auth_user[\s\S]*?\n\$\$;/,
    )?.[0];

    expect(membershipMigration).toContain("function private.normalized_google_email_hash");
    expect(membershipMigration).toContain("'@googlemail\\.com$'");
    expect(triggerDefinition).toContain("private.normalized_google_email_hash(new.email)");
    expect(triggerDefinition).toContain("private.allowed_member_emails");
    expect(triggerDefinition).toContain("provider', '') <> 'google'");
  });

  it("backfills approved Google users without granting membership to others", () => {
    expect(membershipMigration).toMatch(
      /from auth\.users as auth_user[\s\S]*?join private\.allowed_member_emails as allowed[\s\S]*?private\.normalized_google_email_hash\(auth_user\.email\)/,
    );
  });
});
