import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ReceiptData } from "../lib/finance-store";
import { DashboardWorkspace } from "./DashboardWorkspace";

const DATA: ReceiptData = {
  receipts: [
    { id: "receipt-1", merchant: "PAK'nSAVE", purchasedAt: "2026-07-20T18:00:00Z", total: 40 },
    { id: "receipt-2", merchant: "PAK'nSAVE", purchasedAt: "2026-08-03T18:00:00Z", total: 60 },
    { id: "receipt-3", merchant: "Woolworths", purchasedAt: "2026-08-10T18:00:00Z", total: 70 },
    { id: "receipt-4", merchant: "PAK'nSAVE", purchasedAt: "2026-08-31T18:00:00Z", total: 80 },
  ],
  items: [
    { id: "item-1", receiptId: "receipt-1", name: "Value Milk 2L", quantity: 1, unitPrice: 4, amount: 4 },
    { id: "item-2", receiptId: "receipt-2", name: "Value Milk 2L", quantity: 1, unitPrice: 4.5, amount: 4.5 },
    { id: "item-3", receiptId: "receipt-3", name: "Bread", quantity: 2, unitPrice: 5, amount: 10 },
    { id: "item-4", receiptId: "receipt-4", name: "Value Milk 2L", quantity: 1, unitPrice: 5, amount: 5 },
  ],
};

const storeWith = (data: ReceiptData) => ({ loadReceiptData: vi.fn().mockResolvedValue(data) });

describe("DashboardWorkspace", () => {
  it("starts with this year, monthly context, and real receipt summaries", async () => {
    render(<DashboardWorkspace store={storeWith(DATA)} today="2026-08-31" />);

    expect(screen.getByRole("heading", { name: /your grocery rhythm/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "This year" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Month" })).toHaveAttribute("aria-pressed", "true");
    expect(await screen.findByText("NZ$250.00")).toBeInTheDocument();
    expect(screen.getByText("4 shops")).toBeInTheDocument();
    const summary = screen.getByRole("region", { name: "Receipt summary" });
    expect(within(summary).getByText("Value Milk 2L")).toBeInTheDocument();
    expect(within(summary).getByText("3 weeks")).toBeInTheDocument();
    expect(screen.getByText("NZ$80.00", { selector: "strong" })).toBeInTheDocument();
  });

  it("switches between weekly and monthly chart grouping", async () => {
    const user = userEvent.setup();
    render(<DashboardWorkspace store={storeWith(DATA)} today="2026-08-31" />);
    await screen.findByText("NZ$250.00");

    await user.click(screen.getByRole("button", { name: "Week" }));

    expect(screen.getByRole("button", { name: "Week" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByText("3 Aug")).not.toHaveLength(0);
    expect(screen.getAllByText("10 Aug")).not.toHaveLength(0);
  });

  it("searches and selects up to three products for price comparison", async () => {
    const user = userEvent.setup();
    render(<DashboardWorkspace store={storeWith(DATA)} today="2026-08-31" />);
    await screen.findByText("NZ$250.00");

    const search = screen.getByRole("searchbox", { name: /search products/i });
    await user.type(search, "bread");
    await user.click(screen.getByRole("checkbox", { name: "Bread" }));

    expect(screen.getByText("Bread", { selector: ".product-chip span" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Bread" })).toBeChecked();
  });

  it("exports every confirmed receipt as CSV", async () => {
    const user = userEvent.setup();
    const exportCsv = vi.fn();
    render(<DashboardWorkspace store={storeWith(DATA)} today="2026-08-31" exportCsv={exportCsv} />);
    await screen.findByText("NZ$250.00");

    await user.click(screen.getByRole("button", { name: "Export all receipts CSV" }));

    expect(exportCsv).toHaveBeenCalledWith(DATA, "night-ledger-receipts-2026-08-31.csv");
  });

  it("guides the household when no confirmed receipts exist", async () => {
    render(<DashboardWorkspace store={storeWith({ receipts: [], items: [] })} today="2026-08-31" />);

    expect(await screen.findByText("No confirmed receipts yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /add your first receipt/i })).toHaveAttribute("href", "/receipts");
  });

  it("shows a recoverable load error", async () => {
    const store = { loadReceiptData: vi.fn().mockRejectedValue(new Error("offline")) };
    render(<DashboardWorkspace store={store} today="2026-08-31" />);

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Receipt insights could not be loaded"));
  });
});
