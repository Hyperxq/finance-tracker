import type { ReceiptData } from "./finance-store";

const headers = [
  "receipt_id",
  "purchased_at",
  "merchant",
  "receipt_total_nzd",
  "item_name",
  "quantity",
  "unit_price_nzd",
  "line_total_nzd",
];

const escapeCsvField = (value: string) =>
  /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;

export function createReceiptCsv(data: ReceiptData): string {
  const receiptsById = new Map(data.receipts.map((receipt) => [receipt.id, receipt]));
  const rows = data.items
    .map((item, index) => ({ item, index, receipt: receiptsById.get(item.receiptId) }))
    .filter((row): row is typeof row & { receipt: NonNullable<typeof row.receipt> } => Boolean(row.receipt))
    .sort(
      (left, right) =>
        left.receipt.purchasedAt.localeCompare(right.receipt.purchasedAt) ||
        left.receipt.id.localeCompare(right.receipt.id) ||
        left.index - right.index,
    )
    .map(({ item, receipt }) =>
      [
        receipt.id,
        receipt.purchasedAt,
        receipt.merchant,
        receipt.total.toFixed(2),
        item.name,
        String(item.quantity),
        item.unitPrice.toFixed(2),
        item.amount.toFixed(2),
      ]
        .map(escapeCsvField)
        .join(","),
    );

  return [headers.join(","), ...rows].join("\r\n");
}

export function downloadReceiptCsv(data: ReceiptData, filename: string): void {
  const url = URL.createObjectURL(new Blob(["\uFEFF", createReceiptCsv(data)], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
