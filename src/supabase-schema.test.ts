import { readFileSync } from "node:fs";
import { fileURLToPath, URL as NodeURL } from "node:url";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  fileURLToPath(new NodeURL("../supabase/migrations/20260828000000_household_finance.sql", import.meta.url)),
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
});
