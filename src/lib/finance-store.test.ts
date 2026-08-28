import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { createFinanceStore } from "./finance-store";

describe("createFinanceStore", () => {
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
});
