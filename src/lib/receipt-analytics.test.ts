import { describe, expect, it } from "vitest";
import type { ReceiptData } from "./finance-store";
import { buildReceiptAnalytics, normalizeProductKey, receiptDateRange } from "./receipt-analytics";

const DATA: ReceiptData = {
  receipts: [
    { id: "receipt-1", merchant: "PAK'nSAVE", purchasedAt: "2026-01-08T18:00:00Z", total: 15 },
    { id: "receipt-2", merchant: "PAK'nSAVE", purchasedAt: "2026-01-15T18:00:00Z", total: 20 },
    { id: "receipt-3", merchant: "Woolworths", purchasedAt: "2026-02-03T18:00:00Z", total: 25 },
  ],
  items: [
    { id: "item-1", receiptId: "receipt-1", name: "Value Milk 2L", quantity: 1, unitPrice: 4, amount: 4 },
    { id: "item-2", receiptId: "receipt-1", name: "Bread", quantity: 1, unitPrice: 5, amount: 5 },
    { id: "item-3", receiptId: "receipt-2", name: "VALUE  MILK 2L", quantity: 1, unitPrice: 4.5, amount: 4.5 },
    { id: "item-4", receiptId: "receipt-3", name: "Value Milk 2L", quantity: 2, unitPrice: 5, amount: 10 },
    { id: "item-5", receiptId: "receipt-3", name: "Apples", quantity: 0.5, unitPrice: 4, amount: 2 },
  ],
};

describe("receipt analytics", () => {
  it("creates week, month, and year ranges in New Zealand calendar terms", () => {
    expect(receiptDateRange("week", "2026-08-31")).toEqual({ start: "2026-08-31", end: "2026-09-06" });
    expect(receiptDateRange("month", "2026-08-31")).toEqual({ start: "2026-08-01", end: "2026-08-31" });
    expect(receiptDateRange("year", "2026-08-31")).toEqual({ start: "2026-01-01", end: "2026-12-31" });
  });

  it("normalizes harmless OCR formatting without merging different products", () => {
    expect(normalizeProductKey(" VALUE  MILK 2L ")).toBe("value milk 2l");
    expect(normalizeProductKey("Value-Milk 2L")).toBe("value milk 2l");
  });

  it("summarizes weekly spend and ranks products by purchase weeks", () => {
    const analytics = buildReceiptAnalytics(DATA, {
      start: "2026-01-01",
      end: "2026-12-31",
      groupBy: "week",
      selectedProducts: ["value milk 2l"],
    });

    expect(analytics.total).toBe(60);
    expect(analytics.receiptCount).toBe(3);
    expect(analytics.averageBasket).toBe(20);
    expect(analytics.spend.map((bucket) => bucket.total)).toEqual([15, 20, 25]);
    expect(analytics.products[0]).toMatchObject({
      key: "value milk 2l",
      label: "Value Milk 2L",
      purchaseWeeks: 3,
      quantity: 4,
      spend: 18.5,
    });
    expect(analytics.prices).toHaveLength(3);
  });

  it("groups product prices by month and limits the series to selected products", () => {
    const analytics = buildReceiptAnalytics(DATA, {
      start: "2026-01-01",
      end: "2026-12-31",
      groupBy: "month",
      selectedProducts: ["value milk 2l"],
    });

    expect(analytics.spend).toEqual([
      expect.objectContaining({ key: "2026-01", total: 35, receiptCount: 2 }),
      expect.objectContaining({ key: "2026-02", total: 25, receiptCount: 1 }),
    ]);
    expect(analytics.prices).toEqual([
      expect.objectContaining({ key: "2026-01", values: { "value milk 2l": 4.25 } }),
      expect.objectContaining({ key: "2026-02", values: { "value milk 2l": 5 } }),
    ]);
  });
});
