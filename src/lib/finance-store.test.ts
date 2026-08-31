import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { createFinanceStore } from "./finance-store";

describe("createFinanceStore", () => {
  it("loads confirmed receipts and their items for household analytics", async () => {
    const receipts = {
      select: vi.fn().mockReturnValue({
        order: vi.fn().mockResolvedValue({
          data: [{ id: "receipt-1", merchant: "PAK'nSAVE", purchased_at: "2026-08-28T18:30:00Z", total: "12.50" }],
          error: null,
        }),
      }),
    };
    const items = {
      select: vi.fn().mockReturnValue({
        order: vi.fn().mockResolvedValue({
          data: [{ id: "item-1", receipt_id: "receipt-1", name: "Milk", quantity: "1.000", unit_price: "4.50", amount: "4.50" }],
          error: null,
        }),
      }),
    };
    const from = vi.fn((table: string) => table === "receipts" ? receipts : items);
    const store = createFinanceStore({ from } as unknown as SupabaseClient);

    await expect(store.loadReceiptData()).resolves.toEqual({
      receipts: [{ id: "receipt-1", merchant: "PAK'nSAVE", purchasedAt: "2026-08-28T18:30:00Z", total: 12.5 }],
      items: [{ id: "item-1", receiptId: "receipt-1", name: "Milk", quantity: 1, unitPrice: 4.5, amount: 4.5 }],
    });
    expect(from).toHaveBeenCalledWith("receipts");
    expect(from).toHaveBeenCalledWith("receipt_items");
  });

  it("saves normalized receipts through the atomic database function", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: "receipt-1", error: null });
    const store = createFinanceStore({ rpc } as unknown as SupabaseClient);
    const receipt = {
      merchant: "PAK'nSAVE",
      receiptNumber: "1234",
      purchasedAt: "2026-08-28T18:30:00",
      total: 12.5,
      confidence: 91,
      items: [{ name: "Milk", quantity: 1, unitPrice: 4.5, amount: 4.5 }],
    };

    await expect(store.saveReceipt(receipt)).resolves.toBe("receipt-1");
    expect(rpc).toHaveBeenCalledWith("save_receipt", { payload: receipt });
  });

  it("creates a card and maps the database fields for the workspace", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        id: "card-1",
        issuer: "BNZ",
        nickname: "Everyday",
        holder: "Andrea",
        last_four: "0245",
      },
      error: null,
    });
    const store = createFinanceStore({ rpc } as unknown as SupabaseClient);

    await expect(store.saveCard({ issuer: "BNZ", nickname: "Everyday", holder: "Andrea", lastFour: "0245" }))
      .resolves.toEqual({ id: "card-1", issuer: "BNZ", nickname: "Everyday", holder: "Andrea", lastFour: "0245" });
  });

  it("imports a statement and its selected expenses in one transaction", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: "statement-1", error: null });
    const store = createFinanceStore({ rpc } as unknown as SupabaseClient);
    const statement = {
      cardId: "card-1",
      fileName: "YouMoney.pdf",
      fingerprint: "a".repeat(64),
      periodStart: "2026-07-25",
      periodEnd: "2026-08-24",
      transactions: [{ date: "2026-08-02", merchant: "PAK'nSAVE", category: "Groceries", amount: 120 }],
    };

    await expect(store.importStatement(statement)).resolves.toBe("statement-1");
    expect(rpc).toHaveBeenCalledWith("import_bank_statement", { payload: statement });
  });

  it("deletes parent records so their imported details cascade", async () => {
    const receiptEq = vi.fn().mockResolvedValue({ error: null });
    const statementEq = vi.fn().mockResolvedValue({ error: null });
    const receipts = { delete: vi.fn().mockReturnValue({ eq: receiptEq }) };
    const statements = { delete: vi.fn().mockReturnValue({ eq: statementEq }) };
    const from = vi.fn((table: string) => table === "receipts" ? receipts : statements);
    const store = createFinanceStore({ from } as unknown as SupabaseClient);

    await expect(store.deleteReceipt("receipt-1")).resolves.toBeUndefined();
    await expect(store.deleteStatement("statement-1")).resolves.toBeUndefined();

    expect(receiptEq).toHaveBeenCalledWith("id", "receipt-1");
    expect(statementEq).toHaveBeenCalledWith("id", "statement-1");
  });

  it("surfaces a failed parent deletion", async () => {
    const failure = new Error("offline");
    const eq = vi.fn().mockResolvedValue({ error: failure });
    const store = createFinanceStore({
      from: vi.fn().mockReturnValue({ delete: vi.fn().mockReturnValue({ eq }) }),
    } as unknown as SupabaseClient);

    await expect(store.deleteReceipt("receipt-1")).rejects.toBe(failure);
  });
});
