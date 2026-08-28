import { describe, expect, it } from "vitest";
import packageManifest from "../package.json";

describe("package manifest", () => {
  it("does not install a platform-specific Rollup binary directly", () => {
    expect(packageManifest.devDependencies).not.toHaveProperty("@rollup/rollup-darwin-arm64");
  });
});
