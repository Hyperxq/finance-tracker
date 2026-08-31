import { readFileSync } from "node:fs";
import { fileURLToPath, URL as NodeURL } from "node:url";
import { describe, expect, it } from "vitest";

const projectFile = (path: string) =>
  readFileSync(fileURLToPath(new NodeURL(`../${path}`, import.meta.url)), "utf8");

describe("installable app configuration", () => {
  it("describes Night Ledger as a standalone app at either deployment base", () => {
    const manifest = JSON.parse(projectFile("public/manifest.webmanifest"));

    expect(manifest).toMatchObject({
      name: "Night Ledger",
      short_name: "Night Ledger",
      start_url: "./",
      scope: "./",
      display: "standalone",
      background_color: "#090b09",
      theme_color: "#090b09",
    });
    expect(manifest.icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ src: "icons/icon-192.png", sizes: "192x192", type: "image/png" }),
        expect.objectContaining({ src: "icons/icon-512.png", sizes: "512x512", type: "image/png" }),
      ]),
    );
  });

  it("links base-aware install metadata for browsers and iOS", () => {
    const layout = projectFile("src/layouts/AppPage.astro");

    expect(layout).toContain('rel="manifest"');
    expect(layout).toContain('rel="apple-touch-icon"');
    expect(layout).toContain('name="apple-mobile-web-app-capable"');
    expect(layout).toContain("import.meta.env.BASE_URL");
  });
});
