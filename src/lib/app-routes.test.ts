import { describe, expect, it } from "vitest";
import { appPath, viewFromPath } from "./app-routes";

describe("application routes", () => {
  it("prefixes routes with the GitHub Pages base path", () => {
    expect(appPath("/bank", "/finance-tracker/")).toBe("/finance-tracker/bank");
    expect(appPath("/receipts", "/")).toBe("/receipts");
  });

  it("recognizes the bank view with or without a deployment base path", () => {
    expect(viewFromPath("/bank")).toBe("bank");
    expect(viewFromPath("/finance-tracker/bank")).toBe("bank");
    expect(viewFromPath("/finance-tracker/receipts")).toBe("receipts");
  });
});
