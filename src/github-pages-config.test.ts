import { readFileSync } from "node:fs";
import { fileURLToPath, URL as NodeURL } from "node:url";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(
  fileURLToPath(new NodeURL("../.github/workflows/deploy-pages.yml", import.meta.url)),
  "utf8",
);

describe("GitHub Pages Supabase configuration", () => {
  it("passes public Supabase variables to the Astro build", () => {
    expect(workflow).toContain("PUBLIC_SUPABASE_URL: ${{ vars.PUBLIC_SUPABASE_URL }}");
    expect(workflow).toContain(
      "PUBLIC_SUPABASE_PUBLISHABLE_KEY: ${{ vars.PUBLIC_SUPABASE_PUBLISHABLE_KEY }}",
    );
    expect(workflow).toContain(
      "PUBLIC_RECEIPT_OCR_PROVIDER: ${{ vars.PUBLIC_RECEIPT_OCR_PROVIDER }}",
    );
  });
});
