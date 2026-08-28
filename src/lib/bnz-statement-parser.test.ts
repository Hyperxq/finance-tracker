import { describe, expect, it } from "vitest";
import { parseBnzStatement, type BnzStatementRow } from "./bnz-statement-parser";

const statementText = `FOR THE PERIOD 26 JUNE TO
24 JULY 2026
ACCOUNT NUMBER
02-0200-1234567-000`;

describe("parseBnzStatement", () => {
  it("separates withdrawals, deposits, and internal transfers", () => {
    const rows: BnzStatementRow[] = [
      { date: "05 Jul", particulars: "GOOD TO GO SUPERMARK 0245", type: "PS", withdrawal: "22.42" },
      { date: "06 Jul", particulars: "EMPLOYER Salary/Wages", type: "BP", deposit: "3,400.88" },
      { date: "08 Jul", particulars: "Saving money AUTO PAYMENT", type: "AP", withdrawal: "1,000.00" },
    ];

    const result = parseBnzStatement({ rows, statementText });

    expect(result.periodStart).toBe("2026-06-26");
    expect(result.periodEnd).toBe("2026-07-24");
    expect(result.accountLastFour).toBe("7000");
    expect(result.cardLastFour).toBe("0245");
    expect(result.outflowTotal).toBe(1022.42);
    expect(result.inflowTotal).toBe(3400.88);
    expect(result.transactions).toEqual(expect.arrayContaining([
      expect.objectContaining({ merchant: "GOOD TO GO SUPERMARK", direction: "outflow", category: "Groceries", amount: 22.42, transfer: false }),
      expect.objectContaining({ merchant: "EMPLOYER Salary/Wages", direction: "inflow", category: "Income", amount: 3400.88, transfer: false }),
      expect.objectContaining({ merchant: "Saving money AUTO PAYMENT", direction: "outflow", category: "Transfers", amount: 1000, transfer: true }),
    ]));
  });

  it("merges foreign-currency continuation rows into one transaction", () => {
    const rows: BnzStatementRow[] = [
      { date: "07 Jul", particulars: "AMAZON MARKETPLACE A 0245" },
      { particulars: "75.26 Australian Dollars at 0.8188" },
      { particulars: "Includes Foreign Currency Service Fee of $2.06", type: "PS", withdrawal: "93.97" },
    ];

    const result = parseBnzStatement({ rows, statementText });

    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0]).toMatchObject({
      date: "2026-07-07",
      merchant: "AMAZON MARKETPLACE A",
      rawDescription: "AMAZON MARKETPLACE A 0245 75.26 Australian Dollars at 0.8188 Includes Foreign Currency Service Fee of $2.06",
      type: "PS",
      amount: 93.97,
    });
  });

  it("assigns dates before a January statement end to the previous year", () => {
    const result = parseBnzStatement({
      rows: [
        { date: "31 Dec", particulars: "COUNTDOWN 7777", type: "PS", withdrawal: "18.20" },
        { date: "02 Jan", particulars: "AT PUBLIC TRANSPORT 7777", type: "PS", withdrawal: "5.00" },
      ],
      statementText: "FOR THE PERIOD 20 DECEMBER TO 19 JANUARY 2027 ACCOUNT NUMBER 12-3456-1234567-000",
    });

    expect(result.transactions.map((transaction) => transaction.date)).toEqual(["2026-12-31", "2027-01-02"]);
  });

  it("ignores table fragments that do not form a monetary transaction", () => {
    const result = parseBnzStatement({
      rows: [
        { particulars: "CARRIED FORWARD", balance: "396.76" },
        { date: "09 Jul", particulars: "Incomplete line" },
      ],
      statementText,
    });

    expect(result.transactions).toEqual([]);
  });
});
