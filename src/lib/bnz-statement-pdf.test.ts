import { describe, expect, it } from "vitest";
import { rowsFromPositionedItems } from "./bnz-statement-pdf";

describe("rowsFromPositionedItems", () => {
  it("maps positioned BNZ text into the six statement columns", () => {
    const rows = rowsFromPositionedItems([
      { str: "Date", x: 153, y: 476 },
      { str: "Particulars", x: 198, y: 476 },
      { str: "Type", x: 453, y: 476 },
      { str: "Withdrawals", x: 504, y: 476 },
      { str: "Deposits", x: 613, y: 476 },
      { str: "Balance", x: 732, y: 476 },
      { str: "27 Jun", x: 153, y: 461 },
      { str: "TB SHORTLAND ST 0245", x: 198, y: 459.4 },
      { str: "PS", x: 457, y: 459.1 },
      { str: "25.48", x: 549, y: 459.1 },
      { str: "1,557.90", x: 762, y: 459.1 },
      { str: "06 Jul", x: 153, y: 349 },
      { str: "EMPLOYER Salary/Wages", x: 198, y: 347.4 },
      { str: "BP", x: 457, y: 347.1 },
      { str: "3,400.88", x: 639, y: 347.1 },
      { str: "3,670.35", x: 762, y: 347.1 },
    ]);

    expect(rows).toEqual([
      { date: "27 Jun", particulars: "TB SHORTLAND ST 0245", type: "PS", withdrawal: "25.48", balance: "1,557.90" },
      { date: "06 Jul", particulars: "EMPLOYER Salary/Wages", type: "BP", deposit: "3,400.88", balance: "3,670.35" },
    ]);
  });

  it("keeps foreign-currency detail on continuation rows", () => {
    const rows = rowsFromPositionedItems([
      { str: "Date", x: 153, y: 476 },
      { str: "Particulars", x: 198, y: 476 },
      { str: "Type", x: 453, y: 476 },
      { str: "Withdrawals", x: 504, y: 476 },
      { str: "Deposits", x: 613, y: 476 },
      { str: "Balance", x: 732, y: 476 },
      { str: "07 Jul", x: 153, y: 221.1 },
      { str: "AMAZON MARKETPLACE A 0245", x: 198, y: 221.1 },
      { str: "75.26 Australian Dollars at 0.8188", x: 200, y: 210.7 },
      { str: "Includes Foreign Currency Service Fee", x: 200, y: 200.4 },
      { str: "PS", x: 457, y: 200.6 },
      { str: "93.97", x: 549, y: 200.6 },
    ]);

    expect(rows).toEqual([
      { date: "07 Jul", particulars: "AMAZON MARKETPLACE A 0245" },
      { particulars: "75.26 Australian Dollars at 0.8188" },
      { particulars: "Includes Foreign Currency Service Fee", type: "PS", withdrawal: "93.97" },
    ]);
  });

  it("ignores supplemental BNZ pages without a transaction table", () => {
    expect(rowsFromPositionedItems([
      { str: "YouMoney", x: 20, y: 500 },
      { str: "AP", x: 20, y: 40 },
      { str: "Automatic Payment", x: 35, y: 40 },
    ])).toEqual([]);
  });

  it("rejects partially formed transaction tables", () => {
    expect(() => rowsFromPositionedItems([
      { str: "Date", x: 153, y: 476 },
      { str: "Particulars", x: 198, y: 476 },
    ])).toThrow("BNZ transaction table");
  });
});
