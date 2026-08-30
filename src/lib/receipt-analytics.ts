import type { ReceiptData } from "./finance-store";

export type ReceiptPeriod = "week" | "month" | "year";
export type ReceiptGrouping = "week" | "month";

type AnalyticsOptions = {
  start: string;
  end: string;
  groupBy: ReceiptGrouping;
  selectedProducts: string[];
};

const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const calendarDate = (date: string) => new Date(`${date}T12:00:00Z`);
const isoDate = (date: Date) => date.toISOString().slice(0, 10);

function weekStart(date: string) {
  const value = calendarDate(date);
  const daysSinceMonday = (value.getUTCDay() + 6) % 7;
  value.setUTCDate(value.getUTCDate() - daysSinceMonday);
  return isoDate(value);
}

function bucketKey(date: string, groupBy: ReceiptGrouping) {
  return groupBy === "month" ? date.slice(0, 7) : weekStart(date);
}

function bucketLabel(key: string, groupBy: ReceiptGrouping) {
  const value = calendarDate(groupBy === "month" ? `${key}-01` : key);
  return new Intl.DateTimeFormat("en-NZ", groupBy === "month"
    ? { month: "short", year: "numeric", timeZone: "UTC" }
    : { day: "numeric", month: "short", timeZone: "UTC" }).format(value);
}

export function normalizeProductKey(name: string) {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function receiptDateRange(period: ReceiptPeriod, today: string) {
  const date = calendarDate(today);
  if (period === "week") {
    const start = calendarDate(weekStart(today));
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 6);
    return { start: isoDate(start), end: isoDate(end) };
  }
  if (period === "month") {
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth();
    return {
      start: `${year}-${String(month + 1).padStart(2, "0")}-01`,
      end: isoDate(new Date(Date.UTC(year, month + 1, 0, 12))),
    };
  }
  return { start: `${date.getUTCFullYear()}-01-01`, end: `${date.getUTCFullYear()}-12-31` };
}

export function buildReceiptAnalytics(data: ReceiptData, options: AnalyticsOptions) {
  const receipts = data.receipts.filter((receipt) => {
    const date = receipt.purchasedAt.slice(0, 10);
    return date >= options.start && date <= options.end;
  });
  const receiptById = new Map(receipts.map((receipt) => [receipt.id, receipt]));
  const spendBuckets = new Map<string, { total: number; receiptCount: number }>();

  for (const receipt of receipts) {
    const key = bucketKey(receipt.purchasedAt.slice(0, 10), options.groupBy);
    const current = spendBuckets.get(key) ?? { total: 0, receiptCount: 0 };
    current.total += receipt.total;
    current.receiptCount += 1;
    spendBuckets.set(key, current);
  }

  const products = new Map<string, {
    label: string;
    quantity: number;
    spend: number;
    weeks: Set<string>;
  }>();
  const priceBuckets = new Map<string, Map<string, { total: number; count: number }>>();

  for (const item of data.items) {
    const receipt = receiptById.get(item.receiptId);
    if (!receipt) continue;
    const key = normalizeProductKey(item.name);
    const product = products.get(key) ?? { label: item.name.trim(), quantity: 0, spend: 0, weeks: new Set<string>() };
    product.quantity += item.quantity;
    product.spend += item.amount;
    product.weeks.add(weekStart(receipt.purchasedAt.slice(0, 10)));
    products.set(key, product);

    if (!options.selectedProducts.includes(key)) continue;
    const periodKey = bucketKey(receipt.purchasedAt.slice(0, 10), options.groupBy);
    const period = priceBuckets.get(periodKey) ?? new Map<string, { total: number; count: number }>();
    const price = period.get(key) ?? { total: 0, count: 0 };
    price.total += item.unitPrice;
    price.count += 1;
    period.set(key, price);
    priceBuckets.set(periodKey, period);
  }

  const total = money(receipts.reduce((sum, receipt) => sum + receipt.total, 0));
  return {
    total,
    receiptCount: receipts.length,
    averageBasket: receipts.length ? money(total / receipts.length) : 0,
    spend: [...spendBuckets.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => ({
      key,
      label: bucketLabel(key, options.groupBy),
      total: money(value.total),
      receiptCount: value.receiptCount,
    })),
    products: [...products.entries()].map(([key, product]) => ({
      key,
      label: product.label,
      purchaseWeeks: product.weeks.size,
      quantity: money(product.quantity),
      spend: money(product.spend),
    })).sort((left, right) => right.purchaseWeeks - left.purchaseWeeks || right.spend - left.spend || left.label.localeCompare(right.label)),
    prices: [...priceBuckets.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([key, period]) => ({
      key,
      label: bucketLabel(key, options.groupBy),
      values: Object.fromEntries([...period.entries()].map(([product, price]) => [product, money(price.total / price.count)])),
    })),
  };
}
