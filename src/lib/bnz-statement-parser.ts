export type BnzStatementRow = {
  date?: string;
  particulars?: string;
  type?: string;
  withdrawal?: string;
  deposit?: string;
  balance?: string;
};

export type BnzTransaction = {
  id: string;
  date: string;
  rawDescription: string;
  merchant: string;
  type: string;
  direction: "outflow" | "inflow";
  amount: number;
  category: string;
  cardLastFour?: string;
  transfer: boolean;
};

export type ParsedBnzStatement = {
  periodStart: string;
  periodEnd: string;
  accountLastFour?: string;
  cardLastFour?: string;
  transactions: BnzTransaction[];
  outflowTotal: number;
  inflowTotal: number;
};

type StatementInput = {
  rows: BnzStatementRow[];
  statementText: string;
};

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

const moneyValue = (value?: string) => {
  if (!value) return undefined;
  const amount = Number(value.replace(/[^\d.-]/g, ""));
  return Number.isFinite(amount) ? amount : undefined;
};

const isoDate = (day: number, month: number, year: number) =>
  `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

const parsePeriod = (text: string) => {
  const match = text.replace(/\s+/g, " ").match(/FOR THE PERIOD\s+(\d{1,2})\s+([A-Z]+)\s+TO\s+(\d{1,2})\s+([A-Z]+)\s+(\d{4})/i);
  if (!match) throw new Error("This PDF does not contain a BNZ statement period.");
  const [, startDayText, startMonthText, endDayText, endMonthText, endYearText] = match;
  const startMonth = MONTHS[startMonthText.toLowerCase()];
  const endMonth = MONTHS[endMonthText.toLowerCase()];
  if (!startMonth || !endMonth) throw new Error("The BNZ statement period could not be read.");
  const endYear = Number(endYearText);
  const startYear = startMonth > endMonth ? endYear - 1 : endYear;
  return {
    start: isoDate(Number(startDayText), startMonth, startYear),
    end: isoDate(Number(endDayText), endMonth, endYear),
    endMonth,
    endYear,
  };
};

const transactionDate = (value: string, endMonth: number, endYear: number) => {
  const match = value.trim().match(/^(\d{1,2})\s+([A-Z]{3,9})/i);
  if (!match) return "";
  const month = MONTHS[match[2].toLowerCase()];
  if (!month) return "";
  return isoDate(Number(match[1]), month, month > endMonth ? endYear - 1 : endYear);
};

const cardSuffix = (description: string) => description.match(/\b(\d{4})\b/)?.[1];

const merchantName = (description: string) => {
  const firstLine = description.split(/\s+(?=\d+(?:\.\d+)?\s+[A-Z][a-z]+\s+Dollars)|\s+Includes Foreign Currency/i)[0];
  return firstLine.replace(/\s+\d{4}\s*$/, "").trim();
};

const categoryFor = (description: string, direction: "outflow" | "inflow") => {
  const value = description.toLowerCase();
  if (direction === "inflow") return "Income";
  if (/saving money|internet xfr|transfer/.test(value)) return "Transfers";
  if (/rent/.test(value)) return "Housing";
  if (/power|electric|water|broadband|internet/.test(value)) return "Utilities";
  if (/supermark|pak.?n.?save|countdown|woolworth|new world|mart convenie|dairy/.test(value)) return "Groceries";
  if (/uber \*eats|restaurant|coffee|espresso|ekiben|thai|baa baa|food|cafe|bar\b/.test(value)) return "Eating out";
  if (/public transport|fullers|uber(?! \*eats)|fuel|petrol|bp\b/.test(value)) return "Transport";
  if (/jetts|chemist|pharmacy|medical/.test(value)) return "Health";
  if (/youtube|spotify|netflix|webtoon|clash of crit/.test(value)) return "Subscriptions";
  if (/amazon|whitcoulls|choice retail|kmart/.test(value)) return "Shopping";
  return "Other";
};

const isSummaryRow = (row: BnzStatementRow) => /CARRIED FORWARD|OPENING BALANCE|CLOSING BALANCE/i.test(row.particulars ?? "");

export function parseBnzStatement({ rows, statementText }: StatementInput): ParsedBnzStatement {
  const period = parsePeriod(statementText);
  const merged: BnzStatementRow[] = [];
  let pending: BnzStatementRow | undefined;

  const flush = () => {
    if (pending) merged.push(pending);
    pending = undefined;
  };

  for (const row of rows) {
    if (isSummaryRow(row)) {
      flush();
      continue;
    }
    if (row.date) {
      flush();
      pending = { ...row };
      continue;
    }
    if (!pending) continue;
    pending = {
      ...pending,
      particulars: [pending.particulars, row.particulars].filter(Boolean).join(" "),
      type: row.type || pending.type,
      withdrawal: row.withdrawal || pending.withdrawal,
      deposit: row.deposit || pending.deposit,
      balance: row.balance || pending.balance,
    };
  }
  flush();

  const transactions = merged.flatMap<BnzTransaction>((row, index) => {
    const withdrawal = moneyValue(row.withdrawal);
    const deposit = moneyValue(row.deposit);
    const amount = withdrawal ?? deposit;
    const date = row.date ? transactionDate(row.date, period.endMonth, period.endYear) : "";
    const rawDescription = row.particulars?.replace(/\s+/g, " ").trim() ?? "";
    if (!amount || !date || !rawDescription || (!withdrawal && !deposit)) return [];
    const direction = withdrawal ? "outflow" as const : "inflow" as const;
    const transfer = direction === "outflow" && /saving money|internet xfr|transfer/i.test(rawDescription);
    return [{
      id: `${date}-${index}`,
      date,
      rawDescription,
      merchant: merchantName(rawDescription),
      type: row.type?.trim() ?? "",
      direction,
      amount,
      category: categoryFor(rawDescription, direction),
      cardLastFour: cardSuffix(rawDescription),
      transfer,
    }];
  });

  const suffixCounts = transactions.reduce<Record<string, number>>((counts, transaction) => {
    if (transaction.cardLastFour) counts[transaction.cardLastFour] = (counts[transaction.cardLastFour] ?? 0) + 1;
    return counts;
  }, {});
  const detectedCard = Object.entries(suffixCounts).sort(([, left], [, right]) => right - left)[0]?.[0];
  const account = statementText.match(/\b\d{2}-\d{4}-\d{7}-\d{3}\b/)?.[0];
  const totalFor = (direction: BnzTransaction["direction"]) => Number(transactions
    .filter((transaction) => transaction.direction === direction)
    .reduce((sum, transaction) => sum + transaction.amount, 0)
    .toFixed(2));

  return {
    periodStart: period.start,
    periodEnd: period.end,
    accountLastFour: account?.replace(/\D/g, "").slice(-4),
    cardLastFour: detectedCard,
    transactions,
    outflowTotal: totalFor("outflow"),
    inflowTotal: totalFor("inflow"),
  };
}
