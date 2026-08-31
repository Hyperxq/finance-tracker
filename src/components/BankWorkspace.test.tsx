import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ParsedBnzStatement } from "../lib/bnz-statement-parser";
import type { FinanceStore } from "../lib/finance-store";
import { BankWorkspace } from "./BankWorkspace";

if (!File.prototype.arrayBuffer) {
  Object.defineProperty(File.prototype, "arrayBuffer", {
    value(this: File) {
      return new Promise<ArrayBuffer>((resolve, reject) => {
        const reader = new FileReader();
        reader.addEventListener("load", () => resolve(reader.result as ArrayBuffer));
        reader.addEventListener("error", () => reject(reader.error));
        reader.readAsArrayBuffer(this);
      });
    },
  });
}

if (!globalThis.crypto.subtle) {
  Object.defineProperty(globalThis.crypto, "subtle", {
    configurable: true,
    value: {
      digest: async (_algorithm: string, data: ArrayBuffer | ArrayBufferView) => {
        const bytes = ArrayBuffer.isView(data)
          ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
          : new Uint8Array(data);
        const digest = new Uint8Array(32);
        bytes.forEach((byte, index) => {
          digest[index % digest.length] = (digest[index % digest.length] + byte + index) % 256;
        });
        return digest.buffer;
      },
    },
  });
}

const parsedStatement: ParsedBnzStatement = {
  periodStart: "2026-06-26",
  periodEnd: "2026-07-24",
  accountLastFour: "5000",
  cardLastFour: "0245",
  outflowTotal: 1022.42,
  inflowTotal: 3400.88,
  transactions: [
    { id: "expense", date: "2026-07-05", rawDescription: "GOOD TO GO SUPERMARK 0245", merchant: "GOOD TO GO SUPERMARK", type: "PS", direction: "outflow", amount: 22.42, category: "Groceries", cardLastFour: "0245", transfer: false },
    { id: "income", date: "2026-07-06", rawDescription: "EMPLOYER Salary/Wages", merchant: "EMPLOYER Salary/Wages", type: "BP", direction: "inflow", amount: 3400.88, category: "Income", transfer: false },
    { id: "transfer", date: "2026-07-08", rawDescription: "Saving money AUTO PAYMENT", merchant: "Saving money AUTO PAYMENT", type: "AP", direction: "outflow", amount: 1000, category: "Transfers", transfer: true },
  ],
};

const augustStatement: ParsedBnzStatement = {
  periodStart: "2026-07-25",
  periodEnd: "2026-08-26",
  accountLastFour: "5000",
  cardLastFour: "0245",
  outflowTotal: 40,
  inflowTotal: 0,
  transactions: [
    { id: "august-expense", date: "2026-08-03", rawDescription: "WOOLWORTHS 0245", merchant: "WOOLWORTHS", type: "PS", direction: "outflow", amount: 40, category: "Groceries", cardLastFour: "0245", transfer: false },
  ],
};

const addCard = async (user: ReturnType<typeof userEvent.setup>, lastFour = "4321") => {
  await user.click(screen.getByRole("button", { name: /add card/i }));
  await user.type(screen.getByLabelText("Card nickname"), "Joint Visa");
  await user.type(screen.getByLabelText("Card holder"), "Daniel & Andrea");
  const lastFourInput = screen.getByLabelText("Last four digits");
  expect(lastFourInput).not.toHaveAttribute("readonly");
  await user.type(lastFourInput, lastFour);
  await user.click(screen.getByRole("button", { name: /save card/i }));
};

describe("BankWorkspace", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("starts empty until household data is added", () => {
    render(<BankWorkspace />);

    expect(screen.getByRole("heading", { name: /see where the month went/i })).toBeInTheDocument();
    const summary = screen.getByRole("region", { name: /bank summary/i });
    expect(within(summary).getAllByText("NZ$0.00")).not.toHaveLength(0);
    expect(within(summary).getByText("0 transactions")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /merchant spending/i })).toHaveTextContent("No merchant data yet");
    expect(screen.getByRole("region", { name: /small-spend activity/i })).toHaveTextContent("Small purchases will appear here");
    expect(screen.getByRole("region", { name: /four month spending trend/i })).toHaveTextContent("Your monthly comparison will grow here");
    expect(screen.getByRole("region", { name: /household cards/i })).toHaveTextContent("No cards yet");
    expect(screen.getByRole("region", { name: /monthly bank statements/i })).toHaveTextContent("Choose the original PDF downloaded from BNZ");
    expect(screen.getByLabelText("Choose bank statement PDF")).toBeEnabled();
  });

  it("prefills a new card with the signed-in household member", async () => {
    const user = userEvent.setup();
    render(<BankWorkspace memberName="Daniel" />);

    await user.click(screen.getByRole("button", { name: /add card/i }));

    expect(screen.getByLabelText("Card holder")).toHaveValue("Daniel");
  });

  it("loads the household bank history from Supabase", async () => {
    const store: FinanceStore = {
      loadReceiptData: vi.fn().mockResolvedValue({ receipts: [], items: [] }),
      loadBankData: vi.fn().mockResolvedValue({
        cards: [{ id: "card-1", issuer: "BNZ", nickname: "Everyday", holder: "Andrea", lastFour: "0245" }],
        statements: [{ id: "statement-1", cardId: "card-1", fileName: "YouMoney.pdf", fingerprint: "a".repeat(64), periodStart: "2026-07-25", periodEnd: "2026-08-24", status: "Imported" }],
        transactions: [{ id: "transaction-1", statementId: "statement-1", cardId: "card-1", date: "2026-08-03", merchant: "WOOLWORTHS", category: "Groceries", amount: 40 }],
      }),
      saveReceipt: vi.fn(),
      deleteReceipt: vi.fn(),
      saveCard: vi.fn(),
      importStatement: vi.fn(),
      deleteStatement: vi.fn(),
    };

    render(<BankWorkspace store={store} />);

    expect(await screen.findAllByText("WOOLWORTHS")).toHaveLength(2);
    expect(screen.getByRole("region", { name: /bank summary/i })).toHaveTextContent("NZ$40.00");
    expect(screen.getByRole("region", { name: /household cards/i })).toHaveTextContent("Everyday");
    expect(screen.getByRole("region", { name: /monthly bank statements/i })).toHaveTextContent("YouMoney.pdf");
  });

  it("deletes an imported statement and its transactions after confirmation", async () => {
    const user = userEvent.setup();
    const deleteStatement = vi.fn().mockResolvedValue(undefined);
    const store = {
      loadBankData: vi.fn().mockResolvedValue({
        cards: [{ id: "card-1", issuer: "BNZ", nickname: "Everyday", holder: "Andrea", lastFour: "0245" }],
        statements: [{ id: "statement-1", cardId: "card-1", fileName: "YouMoney.pdf", fingerprint: "a".repeat(64), periodStart: "2026-07-25", periodEnd: "2026-08-24", status: "Imported" }],
        transactions: [{ id: "transaction-1", statementId: "statement-1", cardId: "card-1", date: "2026-08-03", merchant: "WOOLWORTHS", category: "Groceries", amount: 40 }],
      }),
      deleteStatement,
    } as unknown as FinanceStore;
    render(<BankWorkspace store={store} />);
    const statements = await screen.findByRole("region", { name: /monthly bank statements/i });

    await user.click(screen.getByRole("button", { name: "Date range" }));
    expect(screen.getByRole("button", { name: "Date range" })).toHaveAttribute("aria-pressed", "true");
    await user.click(within(statements).getByRole("button", { name: "Delete YouMoney.pdf" }));

    const dialog = screen.getByRole("dialog", { name: "Delete bank statement?" });
    expect(within(dialog).getByText("1 imported transaction will be permanently deleted.")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Delete statement" }));

    await waitFor(() => expect(deleteStatement).toHaveBeenCalledWith("statement-1"));
    expect(within(statements).queryByText("YouMoney.pdf")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("YouMoney.pdf and 1 transaction deleted.");
    expect(screen.getByRole("region", { name: /bank summary/i })).toHaveTextContent("NZ$0.00");
    expect(screen.getByRole("button", { name: "Month" })).toHaveAttribute("aria-pressed", "true");
  });

  it("keeps an imported statement when deletion fails", async () => {
    const user = userEvent.setup();
    const store = {
      loadBankData: vi.fn().mockResolvedValue({
        cards: [{ id: "card-1", issuer: "BNZ", nickname: "Everyday", holder: "Andrea", lastFour: "0245" }],
        statements: [{ id: "statement-1", cardId: "card-1", fileName: "YouMoney.pdf", fingerprint: "a".repeat(64), periodStart: "2026-07-25", periodEnd: "2026-08-24", status: "Imported" }],
        transactions: [],
      }),
      deleteStatement: vi.fn().mockRejectedValue(new Error("offline")),
    } as unknown as FinanceStore;
    render(<BankWorkspace store={store} />);
    const statements = await screen.findByRole("region", { name: /monthly bank statements/i });

    await user.click(within(statements).getByRole("button", { name: "Delete YouMoney.pdf" }));
    await user.click(within(screen.getByRole("dialog", { name: "Delete bank statement?" })).getByRole("button", { name: "Delete statement" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("The statement could not be deleted");
    expect(within(statements).getByText("YouMoney.pdf")).toBeInTheDocument();
  });

  it("filters household spending by card holder", async () => {
    const user = userEvent.setup();
    const store: FinanceStore = {
      loadReceiptData: vi.fn().mockResolvedValue({ receipts: [], items: [] }),
      loadBankData: vi.fn().mockResolvedValue({
        cards: [
          { id: "daniel-card", issuer: "BNZ", nickname: "Daniel Visa", holder: "Daniel", lastFour: "1234" },
          { id: "andrea-card", issuer: "BNZ", nickname: "Andrea Visa", holder: "Andrea", lastFour: "5678" },
        ],
        statements: [],
        transactions: [
          { id: "daniel-spend", statementId: "daniel-statement", cardId: "daniel-card", date: "2026-08-03", merchant: "CAFE", category: "Eating out", amount: 30 },
          { id: "andrea-spend", statementId: "andrea-statement", cardId: "andrea-card", date: "2026-08-04", merchant: "WOOLWORTHS", category: "Groceries", amount: 40 },
        ],
      }),
      saveReceipt: vi.fn(),
      deleteReceipt: vi.fn(),
      saveCard: vi.fn(),
      importStatement: vi.fn(),
      deleteStatement: vi.fn(),
    };
    render(<BankWorkspace memberName="Daniel" store={store} />);

    const summary = screen.getByRole("region", { name: /bank summary/i });
    await waitFor(() => expect(summary).toHaveTextContent("NZ$70.00"));

    await user.selectOptions(screen.getByLabelText("Filter by member"), "Andrea");

    expect(summary).toHaveTextContent("NZ$40.00");
    expect(summary).toHaveTextContent("1 transactions");
    expect(screen.getByRole("region", { name: /merchant spending/i })).toHaveTextContent("WOOLWORTHS");
    expect(screen.getByRole("region", { name: /merchant spending/i })).not.toHaveTextContent("CAFE");
  });

  it("matches an uploaded statement to an existing card by exact last four digits", async () => {
    const user = userEvent.setup();
    const extractStatement = vi.fn().mockResolvedValue(parsedStatement);
    render(<BankWorkspace extractStatement={extractStatement} />);

    await addCard(user, "0245");
    await user.upload(
      screen.getByLabelText("Choose bank statement PDF"),
      new File(["statement"], "bnz-august-2026.pdf", { type: "application/pdf" }),
    );

    const review = await screen.findByRole("region", { name: /review bnz statement/i });
    expect(screen.queryByRole("dialog", { name: /add a card for this statement/i })).not.toBeInTheDocument();
    expect(within(review).getByLabelText<HTMLSelectElement>("Card for statement").value).toMatch(/^card-/);
  });

  it("opens a card modal when no exact match exists and redirects to imported activity after confirmation", async () => {
    const user = userEvent.setup();
    const extractStatement = vi.fn().mockResolvedValue(parsedStatement);
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    render(<BankWorkspace extractStatement={extractStatement} />);

    await user.upload(
      screen.getByLabelText("Choose bank statement PDF"),
      new File(["statement"], "bnz-august-2026.pdf", { type: "application/pdf" }),
    );

    const dialog = await screen.findByRole("dialog", { name: /add a card for this statement/i });
    const lastFourInput = within(dialog).getByLabelText("Last four digits");
    expect(lastFourInput).toHaveValue("0245");
    expect(lastFourInput).toHaveAttribute("readonly");
    await user.type(within(dialog).getByLabelText("Card nickname"), "Daniel Visa");
    await user.type(within(dialog).getByLabelText("Card holder"), "Daniel");
    await user.click(within(dialog).getByRole("button", { name: /save and associate card/i }));

    const review = await screen.findByRole("region", { name: /review bnz statement/i });
    expect(within(review).getByLabelText("Card for statement")).toHaveTextContent("Daniel Visa");
    await user.click(within(review).getByRole("button", { name: /confirm 1 expense/i }));

    expect(await screen.findByRole("status")).toHaveTextContent("1 expense imported from bnz-august-2026.pdf");
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
  });

  it("keeps the card suffix editable when a statement has no detected suffix", async () => {
    const user = userEvent.setup();
    const extractStatement = vi.fn().mockResolvedValue({ ...parsedStatement, cardLastFour: undefined });
    render(<BankWorkspace extractStatement={extractStatement} />);

    await user.upload(
      screen.getByLabelText("Choose bank statement PDF"),
      new File(["statement without card suffix"], "bnz-no-card.pdf", { type: "application/pdf" }),
    );

    const dialog = await screen.findByRole("dialog", { name: /add a card for this statement/i });
    const lastFourInput = within(dialog).getByLabelText("Last four digits");
    expect(lastFourInput).not.toHaveAttribute("readonly");
    await user.type(lastFourInput, "7788");
    expect(lastFourInput).toHaveValue("7788");
  });

  it("adds a household card from the maintenance panel", async () => {
    const user = userEvent.setup();
    render(<BankWorkspace />);

    await addCard(user);

    const cards = screen.getByRole("region", { name: /household cards/i });
    expect(within(cards).getByText("Joint Visa")).toBeInTheDocument();
    expect(within(cards).getByText(/Daniel & Andrea · •••• 4321/)).toBeInTheDocument();
  });

  it("reviews extracted BNZ transactions before adding spending", async () => {
    const user = userEvent.setup();
    const extractStatement = vi.fn().mockResolvedValue(parsedStatement);
    render(<BankWorkspace extractStatement={extractStatement} />);
    await addCard(user, "0245");

    await user.upload(
      screen.getByLabelText("Choose bank statement PDF"),
      new File(["statement"], "bnz-august-2026.pdf", { type: "application/pdf" }),
    );

    const review = await screen.findByRole("region", { name: /review bnz statement/i });
    expect(within(review).getByText("•••• 5000")).toBeInTheDocument();
    expect(within(review).getByText("Card •••• 0245")).toBeInTheDocument();
    expect(within(review).getByText("3 detected transactions")).toBeInTheDocument();
    expect(within(review).getByText(/Transfers and deposits are excluded/i)).toBeInTheDocument();
    expect(within(review).getByRole("button", { name: /confirm 1 expense/i })).toBeEnabled();

    const transferToggle = within(review).getByRole("checkbox", { name: /include saving money auto payment/i });
    const incomeToggle = within(review).getByRole("checkbox", { name: /include employer salary\/wages/i });
    expect(transferToggle).not.toBeChecked();
    expect(incomeToggle).not.toBeChecked();

    await user.clear(within(review).getByLabelText("Merchant 1"));
    await user.type(within(review).getByLabelText("Merchant 1"), "Neighbourhood market");
    await user.click(within(review).getByRole("button", { name: /confirm 1 expense/i }));

    await waitFor(() => expect(screen.queryByRole("region", { name: /review bnz statement/i })).not.toBeInTheDocument());
    expect(within(screen.getByRole("region", { name: /monthly bank statements/i })).getByText(/bnz-august-2026.pdf/)).toBeInTheDocument();
    expect(screen.getAllByText(/Imported/)).toHaveLength(1);
    const summary = screen.getByRole("region", { name: /bank summary/i });
    expect(within(summary).getAllByText("NZ$22.42")).not.toHaveLength(0);
    expect(within(summary).getByText("1 transactions")).toBeInTheDocument();
  });

  it("filters the dashboard and activity by a custom date range", async () => {
    const user = userEvent.setup();
    const extractStatement = vi.fn()
      .mockResolvedValueOnce(parsedStatement)
      .mockResolvedValueOnce(augustStatement);
    render(<BankWorkspace extractStatement={extractStatement} />);
    await addCard(user, "0245");

    await user.upload(screen.getByLabelText("Choose bank statement PDF"), new File(["july"], "bnz-july.pdf", { type: "application/pdf" }));
    await user.click(within(await screen.findByRole("region", { name: /review bnz statement/i })).getByRole("button", { name: /confirm 1 expense/i }));
    await waitFor(() => expect(screen.queryByRole("region", { name: /review bnz statement/i })).not.toBeInTheDocument());
    await user.upload(screen.getByLabelText("Choose bank statement PDF"), new File(["august"], "bnz-august.pdf", { type: "application/pdf" }));
    await user.click(within(await screen.findByRole("region", { name: /review bnz statement/i })).getByRole("button", { name: /confirm 1 expense/i }));

    await user.click(screen.getByRole("button", { name: "Date range" }));
    fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2026-07-01" } });
    fireEvent.change(screen.getByLabelText("End date"), { target: { value: "2026-07-31" } });

    const summary = screen.getByRole("region", { name: /bank summary/i });
    expect(within(summary).getAllByText("NZ$22.42")).not.toHaveLength(0);
    const activity = screen.getByRole("heading", { name: "1 Jul – 31 Jul activity" }).closest("section")!;
    expect(within(activity).getByText("GOOD TO GO SUPERMARK")).toBeInTheDocument();
    expect(within(activity).queryByText("WOOLWORTHS")).not.toBeInTheDocument();
  });

  it("uses an imported statement as a linked period", async () => {
    const user = userEvent.setup();
    const extractStatement = vi.fn().mockResolvedValue(parsedStatement);
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    render(<BankWorkspace extractStatement={extractStatement} />);
    await addCard(user, "0245");

    await user.upload(screen.getByLabelText("Choose bank statement PDF"), new File(["july"], "bnz-july.pdf", { type: "application/pdf" }));
    await user.click(within(await screen.findByRole("region", { name: /review bnz statement/i })).getByRole("button", { name: /confirm 1 expense/i }));
    await user.click(screen.getByRole("button", { name: /view bnz-july.pdf activity/i }));

    expect(screen.getByRole("button", { name: "Date range" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Start date")).toHaveValue("2026-06-26");
    expect(screen.getByLabelText("End date")).toHaveValue("2026-07-24");
    expect(screen.getByRole("heading", { name: "26 Jun – 24 Jul activity" })).toBeInTheDocument();
    expect(scrollIntoView).toHaveBeenLastCalledWith({ behavior: "smooth", block: "start" });
  });

  it("avoids smooth activity scrolling when reduced motion is preferred", async () => {
    const user = userEvent.setup();
    const extractStatement = vi.fn().mockResolvedValue(parsedStatement);
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));
    render(<BankWorkspace extractStatement={extractStatement} />);
    await addCard(user, "0245");

    await user.upload(screen.getByLabelText("Choose bank statement PDF"), new File(["july"], "bnz-july.pdf", { type: "application/pdf" }));
    await user.click(within(await screen.findByRole("region", { name: /review bnz statement/i })).getByRole("button", { name: /confirm 1 expense/i }));

    expect(scrollIntoView).toHaveBeenLastCalledWith({ behavior: "auto", block: "start" });
  });

  it("rejects an imported statement when the same PDF content is selected under a different filename", async () => {
    const user = userEvent.setup();
    const extractStatement = vi.fn().mockResolvedValue(parsedStatement);
    render(<BankWorkspace extractStatement={extractStatement} />);
    await addCard(user, "0245");

    await user.upload(screen.getByLabelText("Choose bank statement PDF"), new File(["same pdf bytes"], "bnz-july.pdf", { type: "application/pdf" }));
    await user.click(within(await screen.findByRole("region", { name: /review bnz statement/i })).getByRole("button", { name: /confirm 1 expense/i }));
    await user.upload(screen.getByLabelText("Choose bank statement PDF"), new File(["same pdf bytes"], "renamed-statement.pdf", { type: "application/pdf" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("This PDF was already imported as bnz-july.pdf");
    expect(screen.queryByRole("region", { name: /review bnz statement/i })).not.toBeInTheDocument();
    expect(extractStatement).toHaveBeenCalledTimes(1);
    expect(within(screen.getByRole("region", { name: /monthly bank statements/i })).getAllByRole("button", { name: /view .* activity/i })).toHaveLength(1);
  });

  it("allows different PDF content that uses an already imported filename", async () => {
    const user = userEvent.setup();
    const extractStatement = vi.fn()
      .mockResolvedValueOnce(parsedStatement)
      .mockResolvedValueOnce(augustStatement);
    render(<BankWorkspace extractStatement={extractStatement} />);
    await addCard(user, "0245");

    await user.upload(screen.getByLabelText("Choose bank statement PDF"), new File(["july pdf bytes"], "bnz-statement.pdf", { type: "application/pdf" }));
    await user.click(within(await screen.findByRole("region", { name: /review bnz statement/i })).getByRole("button", { name: /confirm 1 expense/i }));
    await user.upload(screen.getByLabelText("Choose bank statement PDF"), new File(["august pdf bytes"], "bnz-statement.pdf", { type: "application/pdf" }));

    expect(await screen.findByRole("region", { name: /review bnz statement/i })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(extractStatement).toHaveBeenCalledTimes(2);
  });

  it("only treats matching content as a duplicate after the first statement is confirmed", async () => {
    const user = userEvent.setup();
    const extractStatement = vi.fn().mockResolvedValue(parsedStatement);
    render(<BankWorkspace extractStatement={extractStatement} />);
    await addCard(user, "0245");

    await user.upload(screen.getByLabelText("Choose bank statement PDF"), new File(["same pdf bytes"], "first-name.pdf", { type: "application/pdf" }));
    await user.click(within(await screen.findByRole("region", { name: /review bnz statement/i })).getByRole("button", { name: /close statement review/i }));
    await user.upload(screen.getByLabelText("Choose bank statement PDF"), new File(["same pdf bytes"], "second-name.pdf", { type: "application/pdf" }));

    expect(await screen.findByRole("region", { name: /review bnz statement/i })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(extractStatement).toHaveBeenCalledTimes(2);
  });

  it("explains when a PDF cannot be read as a BNZ statement", async () => {
    const user = userEvent.setup();
    const extractStatement = vi.fn().mockRejectedValue(new Error("No transaction table"));
    render(<BankWorkspace extractStatement={extractStatement} />);
    await addCard(user);

    await user.upload(
      screen.getByLabelText("Choose bank statement PDF"),
      new File(["statement"], "other-bank.pdf", { type: "application/pdf" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("We could not read this as a BNZ YouMoney statement");
  });

  it("explains when an uploaded statement is not a PDF", async () => {
    const user = userEvent.setup();
    render(<BankWorkspace />);
    await addCard(user);

    fireEvent.change(screen.getByLabelText("Choose bank statement PDF"), {
      target: { files: [new File(["statement"], "statement.csv", { type: "text/csv" })] },
    });

    expect(screen.getByRole("alert")).toHaveTextContent("Choose a PDF statement from your bank");
  });
});
