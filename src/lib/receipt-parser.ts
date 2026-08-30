export type ReceiptItem = {
  name: string;
  quantity: number;
  unitPrice: number;
  amount: number;
};

export type ParsedReceipt = {
  merchant: string;
  receiptNumber: string;
  purchasedAt: string;
  items: ReceiptItem[];
  calculatedTotal: number;
  receiptTotal: number;
  difference: number;
  matched: boolean;
};

const ITEM_PATTERN = /^(?<name>.+?)\s+(?<quantity>\d+)\s*@\s*\$?(?<unitPrice>\d+\.\d{2})\s*EA\s*=\s*\$?(?<amount>\d+\.\d{2})(?:\s+\*)?$/i;
const RECEIPT_PATTERN = /Rec(?:#|h)?\s*(?<receiptNumber>\d+)\s+Date\s+(?<date>\d{1,2}\/\d{1,2}\/\d{4})\s+(?<time>\d{2}:\d{2}:\d{2})/i;
const ACCOUNT_PATTERN = /(?:ACNT|ACCT|ACCOUNT)\s*#?\s*(?<receiptNumber>\d+)/i;
const DATE_PATTERN = /\b(?<date>\d{1,2}\/\d{1,2}\/\d{2,4})\b/;
const OCR_CURRENCY = String.raw`[$§£]?`;
const OCR_MONEY_VALUE = String.raw`(?:\d+[.,]\s*\d{2}|[.,]\s*\d{2}|\d+\s+\d{2}|\d{2})`;
const TOTAL_PATTERNS = [
  new RegExp(String.raw`Total\s+including\s+G[S5][T1I]\s+${OCR_CURRENCY}(?<total>${OCR_MONEY_VALUE})`, "i"),
  new RegExp(String.raw`(?:#\s*)?\d+\s+TOTAL\s+${OCR_CURRENCY}(?<total>${OCR_MONEY_VALUE})`, "i"),
  new RegExp(String.raw`(?:\d+\s+)?BALANCE\s+[DO0]UE\s+${OCR_CURRENCY}(?<total>${OCR_MONEY_VALUE})`, "i"),
  new RegExp(String.raw`^TOTAL\s+${OCR_CURRENCY}(?<total>${OCR_MONEY_VALUE})\s*$`, "i"),
  new RegExp(String.raw`^TOTAL\s+[G69][S56][T1I]\s+${OCR_CURRENCY}(?<total>${OCR_MONEY_VALUE})\s*$`, "i"),
];
const PAYMENT_PATTERN = new RegExp(String.raw`^(?:EFTPOS|VISA|CHEQUE)\b.*?${OCR_CURRENCY}(?<total>${OCR_MONEY_VALUE})\s*$`, "i");
const LEGACY_ITEM_PATTERN = new RegExp(String.raw`^(?<name>.+?)\s+${OCR_CURRENCY}(?<amount>${OCR_MONEY_VALUE})\s*$`, "i");
const WEIGHTED_ITEM_PATTERN = new RegExp(
  String.raw`^(?<weight>\d+[.,]\d{3})\s*K[GQ]\s*@\s*${OCR_CURRENCY}(?<unitPrice>\d+[.,]\d{2})\s*\/?K[GQ]\s+${OCR_CURRENCY}(?<amount>\d+[.,]\d{2})$`,
  "i",
);
const OCR_PRICE_PATTERN = /[$§£](\d+(?:[.,]\s*\d{1,2})?)/g;
const NON_ITEM_PATTERN = /^(?:ACNT|ACCT|ACCOUNT|BALANCE|CASH|CHANGE|DATE|GST|OPERATOR|PHONE|REC(?:EIPT)?|ROUNDING|STICKY\s+CLUB|SUB\s+TOTAL|TAX\s+INVOICE|TOTAL)\b/i;
const ITEM_SECTION_END_PATTERN = /^(?:\d+\s+)?BALANCE\s+[DO0]UE\b/i;

const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

function toIsoDate(date: string, time: string) {
  const [day, month, rawYear] = date.split("/");
  const year = rawYear.length === 2 ? `${Number(rawYear) >= 70 ? "19" : "20"}${rawYear}` : rawYear;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T${time}`;
}

function parseOcrMoney(rawValue: string) {
  const normalized = rawValue.replace(/\s/g, "").replace(",", ".");
  if (!normalized.includes(".") && normalized.length === 2) {
    return Number(`0.${normalized}`);
  }
  if (!normalized.includes(".") && normalized.length >= 3) {
    return Number(`${normalized.slice(0, -2)}.${normalized.slice(-2)}`);
  }
  return Number(normalized);
}

function parseOcrQuantity(rawValue: string) {
  const digits = rawValue.replace(/[iIl]/g, "1").replace(/\D/g, "");
  const quantity = Number(digits || 1);
  return quantity > 9 ? 1 : quantity;
}

function parseItemLine(line: string, maximumAmount = Number.POSITIVE_INFINITY): ReceiptItem | null {
  if (NON_ITEM_PATTERN.test(line)) return null;

  const exactMatch = line.match(ITEM_PATTERN);
  if (exactMatch?.groups) {
    return {
      name: exactMatch.groups.name.trim(),
      quantity: Number(exactMatch.groups.quantity),
      unitPrice: Number(exactMatch.groups.unitPrice),
      amount: Number(exactMatch.groups.amount),
    };
  }

  const prices = [...line.matchAll(OCR_PRICE_PATTERN)];
  if (prices.length >= 2 && prices[0].index !== undefined) {
    const prefix = line.slice(0, prices[0].index).trim();
    const prefixMatch = prefix.match(/^(?<name>.+)\s+(?<quantity>\S+)$/);
    if (!prefixMatch?.groups) return null;

    const quantity = parseOcrQuantity(prefixMatch.groups.quantity);
    const unitPrice = parseOcrMoney(prices[0][1]);
    const rawAmount = prices.at(-1)?.[1] ?? "0";
    const amount = /[.,]\s*\d$/.test(rawAmount)
      ? money(quantity * unitPrice)
      : parseOcrMoney(rawAmount);

    return {
      name: prefixMatch.groups.name.trim(),
      quantity,
      unitPrice,
      amount,
    };
  }

  const legacyMatch = line.match(LEGACY_ITEM_PATTERN);
  if (!legacyMatch?.groups || !/[a-z]/i.test(legacyMatch.groups.name)) return null;

  let amount = parseOcrMoney(legacyMatch.groups.amount);
  if (amount > maximumAmount && !/[$§£]/.test(line)) {
    amount = parseOcrMoney(legacyMatch.groups.amount.slice(1));
  }
  if (amount <= 0 || amount > maximumAmount) return null;

  return {
    name: legacyMatch.groups.name.trim(),
    quantity: 1,
    unitPrice: amount,
    amount,
  };
}

function findTotal(lines: string[]) {
  for (const pattern of TOTAL_PATTERNS) {
    for (const [index, line] of lines.entries()) {
      const match = line.match(pattern);
      if (match?.groups) {
        const printedTotal = parseOcrMoney(match.groups.total);
        const paymentTotal = lines.slice(index + 1).reduce<number | null>((largest, paymentLine) => {
          const paymentMatch = paymentLine.match(PAYMENT_PATTERN);
          if (!paymentMatch?.groups) return largest;
          const value = parseOcrMoney(paymentMatch.groups.total);
          return largest === null || value > largest ? value : largest;
        }, null);
        return { index, total: paymentTotal !== null && paymentTotal > printedTotal ? paymentTotal : printedTotal };
      }
    }
  }

  return { index: lines.length, total: 0 };
}

function parseItemLines(lines: string[], maximumAmount: number) {
  const items: ReceiptItem[] = [];

  for (const [index, line] of lines.entries()) {
    const weightedMatch = line.match(WEIGHTED_ITEM_PATTERN);
    if (
      weightedMatch?.groups &&
      index > 0 &&
      [...lines[index - 1].matchAll(OCR_PRICE_PATTERN)].length === 0
    ) {
      items.push({
        name: lines[index - 1],
        quantity: parseOcrMoney(weightedMatch.groups.weight),
        unitPrice: parseOcrMoney(weightedMatch.groups.unitPrice),
        amount: parseOcrMoney(weightedMatch.groups.amount),
      });
      continue;
    }

    const firstPrice = [...line.matchAll(OCR_PRICE_PATTERN)][0];
    const prefix = firstPrice?.index === undefined ? "" : line.slice(0, firstPrice.index).trim();
    const isContinuation = index > 0
      && [...line.matchAll(OCR_PRICE_PATTERN)].length >= 2
      && /^\S{1,3}$/.test(prefix);
    const item = isContinuation
      ? parseItemLine(`${lines[index - 1]} ${line}`, maximumAmount)
      : parseItemLine(line, maximumAmount);
    if (item) items.push(item);
  }

  return items;
}

export function parseReceiptText(rawText: string): ParsedReceipt {
  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const receiptMatch = rawText.match(RECEIPT_PATTERN);
  const accountMatch = rawText.match(ACCOUNT_PATTERN);
  const dateMatch = rawText.match(DATE_PATTERN);
  const total = findTotal(lines);
  const merchant = lines.find((line) => /^PAK[A-Z]{0,3}SAVE/.test(line.replace(/[^a-z0-9]/gi, "").toUpperCase())) ?? "Unknown merchant";
  const balanceIndex = lines.findIndex((line) => ITEM_SECTION_END_PATTERN.test(line));
  const itemSectionEnd = balanceIndex >= 0 ? Math.min(balanceIndex, total.index) : total.index;
  const items = parseItemLines(lines.slice(0, itemSectionEnd), total.total || Number.POSITIVE_INFINITY);

  const receiptTotal = total.total;
  const calculatedTotal = money(items.reduce((total, item) => total + item.amount, 0));
  const difference = money(calculatedTotal - receiptTotal);

  return {
    merchant,
    receiptNumber: receiptMatch?.groups?.receiptNumber ?? accountMatch?.groups?.receiptNumber ?? "",
    purchasedAt: receiptMatch?.groups
      ? toIsoDate(receiptMatch.groups.date, receiptMatch.groups.time)
      : dateMatch?.groups
        ? toIsoDate(dateMatch.groups.date, "00:00:00")
        : "",
    items,
    calculatedTotal,
    receiptTotal,
    difference,
    matched: items.length > 0 && difference === 0,
  };
}
