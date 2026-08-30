import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReceiptData } from "./finance-store";
import { createReceiptCsv, downloadReceiptCsv } from "./receipt-csv";

const headers = [
  "receipt_id",
  "purchased_at",
  "merchant",
  "receipt_total_nzd",
  "item_name",
  "quantity",
  "unit_price_nzd",
  "line_total_nzd",
].join(",");

describe("createReceiptCsv", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("returns only the header row when no confirmed items exist", () => {
    expect(createReceiptCsv({ receipts: [], items: [] })).toBe(headers);
  });

  it("joins items to receipts, formats money, and preserves item order per receipt", () => {
    const data: ReceiptData = {
      receipts: [
        { id: "receipt-b", merchant: "New World", purchasedAt: "2026-08-12", total: 13 },
        { id: "receipt-a", merchant: "PAK'nSAVE", purchasedAt: "2026-08-05", total: 7.5 },
      ],
      items: [
        { id: "item-2", receiptId: "receipt-b", name: "Bread", quantity: 2, unitPrice: 3.5, amount: 7 },
        { id: "item-1", receiptId: "receipt-a", name: "Milk", quantity: 1, unitPrice: 4.2, amount: 4.2 },
        { id: "item-3", receiptId: "receipt-b", name: "Eggs", quantity: 1.5, unitPrice: 4, amount: 6 },
      ],
    };

    expect(createReceiptCsv(data)).toBe(
      [
        headers,
        "receipt-a,2026-08-05,PAK'nSAVE,7.50,Milk,1,4.20,4.20",
        "receipt-b,2026-08-12,New World,13.00,Bread,2,3.50,7.00",
        "receipt-b,2026-08-12,New World,13.00,Eggs,1.5,4.00,6.00",
      ].join("\r\n"),
    );
  });

  it("sorts same-date receipts by id and omits orphan items", () => {
    const data: ReceiptData = {
      receipts: [
        { id: "receipt-z", merchant: "Store Z", purchasedAt: "2026-08-05", total: 3 },
        { id: "receipt-a", merchant: "Store A", purchasedAt: "2026-08-05", total: 2 },
      ],
      items: [
        { id: "orphan", receiptId: "missing", name: "Unknown", quantity: 1, unitPrice: 99, amount: 99 },
        { id: "item-z", receiptId: "receipt-z", name: "Zucchini", quantity: 1, unitPrice: 3, amount: 3 },
        { id: "item-a", receiptId: "receipt-a", name: "Apple", quantity: 1, unitPrice: 2, amount: 2 },
      ],
    };

    expect(createReceiptCsv(data)).toBe(
      [
        headers,
        "receipt-a,2026-08-05,Store A,2.00,Apple,1,2.00,2.00",
        "receipt-z,2026-08-05,Store Z,3.00,Zucchini,1,3.00,3.00",
      ].join("\r\n"),
    );
  });

  it("escapes commas, quotes, carriage returns, and line feeds", () => {
    const data: ReceiptData = {
      receipts: [
        {
          id: "receipt-1",
          merchant: "Market, \"Central\"\r\nAuckland",
          purchasedAt: "2026-08-05T10:30:00+12:00",
          total: 5,
        },
      ],
      items: [
        {
          id: "item-1",
          receiptId: "receipt-1",
          name: "Bread\nlarge",
          quantity: 1,
          unitPrice: 5,
          amount: 5,
        },
      ],
    };

    expect(createReceiptCsv(data)).toBe(
      `${headers}\r\nreceipt-1,2026-08-05T10:30:00+12:00,"Market, ""Central""\r\nAuckland",5.00,"Bread\nlarge",1,5.00,5.00`,
    );
  });

  it("downloads an Excel-compatible UTF-8 file and releases its object URL", async () => {
    const data: ReceiptData = {
      receipts: [{ id: "receipt-1", merchant: "PAK'nSAVE", purchasedAt: "2026-08-05", total: 4.2 }],
      items: [{ id: "item-1", receiptId: "receipt-1", name: "Milk", quantity: 1, unitPrice: 4.2, amount: 4.2 }],
    };
    const link = { href: "", download: "", click: vi.fn() };
    const createObjectUrl = vi.fn().mockReturnValue("blob:receipt-csv");
    const revokeObjectUrl = vi.fn();
    class CapturedBlob {
      constructor(public parts: BlobPart[], public options?: BlobPropertyBag) {}
      get type() { return this.options?.type ?? ""; }
    }
    vi.stubGlobal("Blob", CapturedBlob);
    vi.stubGlobal("URL", class extends URL {
      static createObjectURL = createObjectUrl;
      static revokeObjectURL = revokeObjectUrl;
    });
    vi.spyOn(document, "createElement").mockReturnValue(link as unknown as HTMLAnchorElement);

    downloadReceiptCsv(data, "night-ledger-receipts.csv");

    const file = createObjectUrl.mock.calls[0][0] as CapturedBlob;
    expect(file.parts).toEqual(["\uFEFF", createReceiptCsv(data)]);
    expect(file.type).toBe("text/csv;charset=utf-8");
    expect(link).toMatchObject({ href: "blob:receipt-csv", download: "night-ledger-receipts.csv" });
    expect(link.click).toHaveBeenCalledOnce();
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:receipt-csv");
  });
});
