import {
  CalendarBlankIcon,
  ChartBarIcon,
  CheckCircleIcon,
  CoffeeIcon,
  CreditCardIcon,
  FilePdfIcon,
  PlusIcon,
  StorefrontIcon,
  UploadSimpleIcon,
  WarningCircleIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { extractBnzStatement } from "../lib/bnz-statement-pdf";
import type { BnzTransaction, ParsedBnzStatement } from "../lib/bnz-statement-parser";
import type {
  BankStatement as Statement,
  BankTransaction as Transaction,
  FinanceStore,
  HouseholdCard,
} from "../lib/finance-store";

type ReviewTransaction = BnzTransaction & { included: boolean };

type StatementReview = Omit<ParsedBnzStatement, "transactions"> & {
  fileName: string;
  fingerprint: string;
  cardId: string;
  transactions: ReviewTransaction[];
};

type BankWorkspaceProps = {
  extractStatement?: (file: File) => Promise<ParsedBnzStatement>;
  memberName?: string;
  store?: FinanceStore;
};

const money = (amount: number) => `NZ$${amount.toFixed(2)}`;
const CATEGORIES = ["Groceries", "Eating out", "Transport", "Housing", "Utilities", "Health", "Subscriptions", "Shopping", "Household", "Transfers", "Income", "Other"];
const monthName = (month: string) => new Intl.DateTimeFormat("en-NZ", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-01T12:00:00Z`));
const shortDate = (date: string) => new Intl.DateTimeFormat("en-NZ", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
const monthDates = (month: string) => {
  const [year, monthNumber] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return { start: `${month}-01`, end: `${month}-${String(lastDay).padStart(2, "0")}` };
};
const fingerprintPdf = async (file: File) => {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(await file.arrayBuffer()));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};
const scrollToImportedActivity = (element: HTMLElement | null) => {
  const reducedMotion = typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  element?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
};

export function BankWorkspace({ extractStatement = extractBnzStatement, memberName = "", store }: BankWorkspaceProps) {
  const statementInputRef = useRef<HTMLInputElement>(null);
  const importedActivityRef = useRef<HTMLElement>(null);
  const [cards, setCards] = useState<HouseholdCard[]>([]);
  const [statements, setStatements] = useState<Statement[]>([]);
  const [allTransactions, setAllTransactions] = useState<Transaction[]>([]);
  const [selectedMonth, setSelectedMonth] = useState("");
  const [periodMode, setPeriodMode] = useState<"month" | "range">("month");
  const [rangeStart, setRangeStart] = useState("");
  const [rangeEnd, setRangeEnd] = useState("");
  const [selectedCard, setSelectedCard] = useState("all");
  const [selectedHolder, setSelectedHolder] = useState("all");
  const [smallSpendLimit, setSmallSpendLimit] = useState(20);
  const [cardFormContext, setCardFormContext] = useState<"maintenance" | "statement" | null>(null);
  const [uploadError, setUploadError] = useState("");
  const [importNotice, setImportNotice] = useState("");
  const [isReadingStatement, setIsReadingStatement] = useState(false);
  const [statementReview, setStatementReview] = useState<StatementReview | null>(null);
  const [cardDraft, setCardDraft] = useState({ nickname: "", holder: memberName, lastFour: "" });
  const [dataError, setDataError] = useState("");
  const [cardError, setCardError] = useState("");
  const [isSavingCard, setIsSavingCard] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  useEffect(() => {
    if (!store) return;
    let active = true;
    setDataError("");
    store.loadBankData()
      .then((data) => {
        if (!active) return;
        setCards(data.cards);
        setStatements(data.statements);
        setAllTransactions(data.transactions);
        const latestMonth = [...new Set(data.transactions.map((transaction) => transaction.date.slice(0, 7)))].sort().reverse()[0];
        if (latestMonth) setSelectedMonth((current) => current || latestMonth);
      })
      .catch(() => {
        if (active) setDataError("Your saved bank activity could not be loaded. Check your connection and try again.");
      });
    return () => { active = false; };
  }, [store]);

  const availableMonths = useMemo(() => [...new Set(allTransactions.map((transaction) => transaction.date.slice(0, 7)))].sort().reverse(), [allTransactions]);
  const availableHolders = useMemo(() => [...new Set(cards.map((card) => card.holder))].sort((left, right) => left.localeCompare(right)), [cards]);
  const cardHolderById = useMemo(() => new Map(cards.map((card) => [card.id, card.holder])), [cards]);
  const rangeIsInvalid = Boolean(rangeStart && rangeEnd && rangeStart > rangeEnd);
  const transactions = useMemo(
    () => allTransactions.filter((transaction) => {
      const withinPeriod = periodMode === "month"
        ? transaction.date.startsWith(selectedMonth)
        : !rangeIsInvalid && (!rangeStart || transaction.date >= rangeStart) && (!rangeEnd || transaction.date <= rangeEnd);
      const matchesCard = selectedCard === "all" || transaction.cardId === selectedCard;
      const matchesHolder = selectedHolder === "all" || cardHolderById.get(transaction.cardId) === selectedHolder;
      return withinPeriod && matchesCard && matchesHolder;
    }),
    [allTransactions, cardHolderById, periodMode, rangeEnd, rangeIsInvalid, rangeStart, selectedCard, selectedHolder, selectedMonth],
  );
  const total = transactions.reduce((sum, transaction) => sum + transaction.amount, 0);
  const smallSpends = transactions.filter((transaction) => transaction.amount <= smallSpendLimit);
  const smallSpendTotal = smallSpends.reduce((sum, transaction) => sum + transaction.amount, 0);

  const merchants = Object.entries(transactions.reduce<Record<string, number>>((totals, transaction) => {
    totals[transaction.merchant] = (totals[transaction.merchant] ?? 0) + transaction.amount;
    return totals;
  }, {})).sort(([, left], [, right]) => right - left).slice(0, 6);
  const largestMerchantAmount = merchants[0]?.[1] ?? 1;

  const categories = Object.entries(transactions.reduce<Record<string, number>>((totals, transaction) => {
    totals[transaction.category] = (totals[transaction.category] ?? 0) + transaction.amount;
    return totals;
  }, {})).sort(([, left], [, right]) => right - left);
  const largestCategory = categories[0] ?? ["—", 0];

  const dailySmallSpends = Object.entries(smallSpends.reduce<Record<string, number>>((totals, transaction) => {
    totals[transaction.date] = (totals[transaction.date] ?? 0) + transaction.amount;
    return totals;
  }, {}));
  const largestDailySmallSpend = Math.max(...dailySmallSpends.map(([, amount]) => amount), 1);
  const monthlyHistory = Object.entries((periodMode === "range" ? transactions : allTransactions
    .filter((transaction) => (selectedCard === "all" || transaction.cardId === selectedCard)
      && (selectedHolder === "all" || cardHolderById.get(transaction.cardId) === selectedHolder)))
    .reduce<Record<string, number>>((totals, transaction) => {
      const month = transaction.date.slice(0, 7);
      totals[month] = (totals[month] ?? 0) + transaction.amount;
      return totals;
    }, {}))
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(-4)
    .map(([month, amount]) => ({ month, amount }));
  const largestMonthlySpend = Math.max(...monthlyHistory.map(({ amount }) => amount), 1);
  const selectedPeriodLabel = periodMode === "range"
    ? rangeStart && rangeEnd
      ? `${shortDate(rangeStart)} – ${shortDate(rangeEnd)}`
      : "Custom range"
    : selectedMonth
      ? monthName(selectedMonth)
      : "No imported data";

  const saveCard = async (event: FormEvent) => {
    event.preventDefault();
    const lastFour = cardDraft.lastFour.replace(/\D/g, "").slice(-4);
    if (!cardDraft.nickname.trim() || !cardDraft.holder.trim() || lastFour.length !== 4) return;
    setCardError("");
    setIsSavingCard(true);
    const payload = {
      issuer: "BNZ",
      nickname: cardDraft.nickname.trim(),
      holder: cardDraft.holder.trim(),
      lastFour,
    };
    let card: HouseholdCard;
    try {
      card = store ? await store.saveCard(payload) : { id: `card-${Date.now()}`, ...payload };
    } catch {
      setCardError("The card could not be saved. Check for a duplicate card and try again.");
      setIsSavingCard(false);
      return;
    }
    setCards((current) => [...current, card]);
    if (cardFormContext === "statement") {
      setStatementReview((current) => current ? { ...current, cardId: card.id } : current);
    }
    setCardDraft({ nickname: "", holder: memberName, lastFour: "" });
    setCardFormContext(null);
    setIsSavingCard(false);
  };

  const uploadStatement = async (file: File) => {
    setUploadError("");
    setImportNotice("");
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      setUploadError("Choose a PDF statement from your bank.");
      return;
    }
    setIsReadingStatement(true);
    setStatementReview(null);
    try {
      const fingerprint = await fingerprintPdf(file);
      const duplicate = statements.find((statement) => statement.fingerprint === fingerprint);
      if (duplicate) {
        setUploadError(`This PDF was already imported as ${duplicate.fileName}.`);
        return;
      }
      const parsed = await extractStatement(file);
      if (!parsed.transactions.length) throw new Error("No transactions found");
      const matchedCard = parsed.cardLastFour
        ? cards.find((card) => card.lastFour === parsed.cardLastFour)
        : undefined;
      setStatementReview({
        ...parsed,
        fileName: file.name,
        fingerprint,
        cardId: matchedCard?.id ?? "",
        transactions: parsed.transactions.map((transaction) => ({
          ...transaction,
          included: transaction.direction === "outflow" && !transaction.transfer,
        })),
      });
      if (!matchedCard) {
        setCardDraft({ nickname: "", holder: memberName, lastFour: parsed.cardLastFour ?? "" });
        setCardFormContext("statement");
      }
    } catch {
      setUploadError("We could not read this as a BNZ YouMoney statement. Choose the original PDF downloaded from BNZ.");
    } finally {
      setIsReadingStatement(false);
      if (statementInputRef.current) statementInputRef.current.value = "";
    }
  };

  const updateReviewTransaction = (id: string, update: Partial<ReviewTransaction>) => {
    setStatementReview((current) => current ? {
      ...current,
      transactions: current.transactions.map((transaction) => transaction.id === id ? { ...transaction, ...update } : transaction),
    } : current);
  };

  const includedReviewTransactions = statementReview?.transactions.filter((transaction) => transaction.included) ?? [];
  const reviewHasInvalidExpense = includedReviewTransactions.some((transaction) => !transaction.date || !transaction.merchant.trim() || transaction.amount <= 0);
  const reviewIssue = statementReview && (!statementReview.cardId || !includedReviewTransactions.length || reviewHasInvalidExpense)
    ? !statementReview.cardId
      ? "Choose or add a card for this statement."
      : reviewHasInvalidExpense
      ? "Fix the highlighted expense fields before importing."
      : "Select at least one expense to import."
    : "";

  const confirmStatement = async () => {
    if (!statementReview || reviewIssue || isImporting) return;
    setIsImporting(true);
    setUploadError("");
    const importedAt = Date.now();
    let statementId = `statement-${importedAt}`;
    try {
      if (store) {
        statementId = await store.importStatement({
          cardId: statementReview.cardId,
          fileName: statementReview.fileName,
          fingerprint: statementReview.fingerprint,
          periodStart: statementReview.periodStart,
          periodEnd: statementReview.periodEnd,
          transactions: includedReviewTransactions.map((transaction) => ({
            date: transaction.date,
            merchant: transaction.merchant.trim(),
            category: transaction.category,
            amount: transaction.amount,
          })),
        });
      }
    } catch {
      setUploadError("The statement could not be saved. It may already exist, or your connection was interrupted.");
      setIsImporting(false);
      return;
    }
    const imported = includedReviewTransactions.map<Transaction>((transaction, index) => ({
      id: `statement-${importedAt}-${index}`,
      cardId: statementReview.cardId,
      date: transaction.date,
      merchant: transaction.merchant.trim(),
      category: transaction.category,
      amount: transaction.amount,
    }));
    setAllTransactions((current) => [...current, ...imported]);
    setStatements((current) => [{
      id: statementId,
      cardId: statementReview.cardId,
      fileName: statementReview.fileName,
      fingerprint: statementReview.fingerprint,
      periodStart: statementReview.periodStart,
      periodEnd: statementReview.periodEnd,
      status: "Imported",
    }, ...current]);
    setSelectedMonth(statementReview.periodEnd.slice(0, 7));
    setPeriodMode("month");
    setSelectedHolder("all");
    setSelectedCard(statementReview.cardId);
    setImportNotice(`${imported.length} ${imported.length === 1 ? "expense" : "expenses"} imported from ${statementReview.fileName}.`);
    setStatementReview(null);
    setIsImporting(false);
    scrollToImportedActivity(importedActivityRef.current);
  };

  const showStatementActivity = (statement: Statement) => {
    setPeriodMode("range");
    setRangeStart(statement.periodStart);
    setRangeEnd(statement.periodEnd);
    setSelectedHolder("all");
    setSelectedCard(statement.cardId);
    setImportNotice(`Showing activity from ${statement.fileName}.`);
    scrollToImportedActivity(importedActivityRef.current);
  };

  return (
    <section className="bank-view">
      <header className="bank-header">
        <div>
          <p><span>Bank spending</span><i>/</i>{selectedPeriodLabel}</p>
          <h1>See where the<br />month went</h1>
          <h2>Card-level spending for any period—separate from your itemized receipt analysis.</h2>
        </div>
        <div className="bank-filters" aria-label="Bank spending filters">
          <div className="period-toggle" role="group" aria-label="Period type"><span>Period</span><div><button type="button" aria-pressed={periodMode === "month"} onClick={() => setPeriodMode("month")}>Month</button><button type="button" aria-pressed={periodMode === "range"} onClick={() => { if (selectedMonth && !rangeStart && !rangeEnd) { const dates = monthDates(selectedMonth); setRangeStart(dates.start); setRangeEnd(dates.end); } setPeriodMode("range"); }}>Date range</button></div></div>
          {periodMode === "month" && <label><span>Month</span><select aria-label="Filter by month" value={selectedMonth} disabled={!availableMonths.length} onChange={(event) => setSelectedMonth(event.target.value)}>{!availableMonths.length && <option value="">No imported months</option>}{availableMonths.map((month) => <option key={month} value={month}>{monthName(month)}</option>)}</select></label>}
          {periodMode === "range" && <div className="date-range-fields"><label><span>From</span><input aria-label="Start date" type="date" value={rangeStart} max={rangeEnd || undefined} onChange={(event) => setRangeStart(event.target.value)} /></label><label><span>To</span><input aria-label="End date" type="date" value={rangeEnd} min={rangeStart || undefined} onChange={(event) => setRangeEnd(event.target.value)} /></label>{rangeIsInvalid && <span role="alert">Choose an end date after the start date.</span>}</div>}
          <label><span>Member</span><select aria-label="Filter by member" value={selectedHolder} onChange={(event) => { setSelectedHolder(event.target.value); setSelectedCard("all"); }}><option value="all">All household members</option>{availableHolders.map((holder) => <option key={holder} value={holder}>{holder}</option>)}</select></label>
          <label><span>Card</span><select aria-label="Filter by card" value={selectedCard} onChange={(event) => { setSelectedCard(event.target.value); if (event.target.value !== "all") setSelectedHolder("all"); }}><option value="all">All household cards</option>{cards.map((card) => <option key={card.id} value={card.id}>{card.nickname} · {card.lastFour}</option>)}</select></label>
        </div>
      </header>

      {dataError && <div className="statement-error bank-data-error" role="alert"><WarningCircleIcon />{dataError}</div>}

      <section className="bank-metrics" aria-label="Bank summary">
        <article className="metric-card metric-primary"><span>Period total</span><strong>{money(total)}</strong><small>{transactions.length} transactions</small></article>
        <article className="metric-card"><span>Largest category</span><strong>{largestCategory[0]}</strong><small>{transactions.length ? `${money(largestCategory[1])} in this period` : "No imported expenses"}</small></article>
        <article className="metric-card"><span>Small spends</span><strong>{smallSpends.length}</strong><small>under NZ${smallSpendLimit}</small></article>
        <article className="metric-card"><span>Average transaction</span><strong>{money(transactions.length ? total / transactions.length : 0)}</strong><small>{transactions.length ? "Across selected cards" : "No imported expenses"}</small></article>
      </section>

      <div className="bank-chart-grid">
        <section className="chart-card merchant-chart" aria-label="Merchant spending" role="region">
          <div className="section-heading"><div><span>Merchant spending</span><h3>Where the money went</h3></div><StorefrontIcon size={25} weight="duotone" /></div>
          {merchants.length ? <ol>
            {merchants.map(([merchant, amount]) => (
              <li key={merchant}>
                <div><strong>{merchant}</strong><span>{money(amount)}</span></div>
                <span className="bar-track" aria-hidden="true"><i style={{ width: `${(amount / largestMerchantAmount) * 100}%` }} /></span>
              </li>
            ))}
          </ol> : <div className="data-empty"><StorefrontIcon size={28} weight="duotone" /><strong>No merchant data yet</strong><span>Import and confirm a bank statement to see where the month went.</span></div>}
        </section>

        <section className="chart-card small-spend-card" aria-label="Small-spend activity" role="region">
          <div className="section-heading"><div><span>Small-spend finder</span><h3>The quiet leak</h3></div><CoffeeIcon size={25} weight="duotone" /></div>
          {transactions.length ? <><div className="small-spend-total"><strong>{money(smallSpendTotal)}</strong><span>across {smallSpends.length} transactions</span></div>
            <div className="threshold-control"><label htmlFor="small-spend-limit">Count purchases up to</label><select id="small-spend-limit" value={smallSpendLimit} onChange={(event) => setSmallSpendLimit(Number(event.target.value))}><option value="10">NZ$10</option><option value="20">NZ$20</option><option value="30">NZ$30</option></select></div>
            <ol className="small-spend-pulse" aria-label="Small spending by day">
              {dailySmallSpends.map(([date, amount]) => <li key={date}><span style={{ height: `${Math.max((amount / largestDailySmallSpend) * 100, 12)}%` }} title={`${shortDate(date)}: ${money(amount)}`} /><small>{shortDate(date)}</small></li>)}
            </ol></> : <div className="data-empty data-empty-dark"><CoffeeIcon size={28} weight="duotone" /><strong>Small purchases will appear here</strong><span>Once a statement is imported, adjust the threshold to find recurring leaks.</span></div>}
        </section>
      </div>

      <section className="trend-card" aria-label="Four month spending trend">
        <div className="section-heading"><div><span>Four-month view</span><h3>Monthly card spending</h3></div><ChartBarIcon size={25} weight="duotone" /></div>
        {monthlyHistory.length ? <ol>
          {monthlyHistory.map(({ month, amount }) => <li key={month}><strong>{money(amount)}</strong><span className="trend-bar"><i style={{ height: `${(amount / largestMonthlySpend) * 100}%` }} /></span><small>{monthName(month).replace(/ \d{4}$/, "")}</small></li>)}
        </ol> : <div className="data-empty data-empty-wide"><ChartBarIcon size={28} weight="duotone" /><strong>Your monthly comparison will grow here</strong><span>Each confirmed statement adds a real month to this view.</span></div>}
      </section>

      <div className="bank-management-grid">
        <section className="management-card" aria-label="Household cards" role="region">
          <div className="section-heading"><div><span>Card maintenance</span><h3>Your cards</h3></div><button type="button" onClick={() => { setCardError(""); setCardDraft({ nickname: "", holder: memberName, lastFour: "" }); setCardFormContext("maintenance"); }}><PlusIcon weight="bold" />Add card</button></div>
          {cards.length > 0 && <div className="household-cards">
            {cards.map((card, index) => <article className={`household-card card-tone-${index % 2}`} key={card.id}><div><CreditCardIcon size={28} weight="duotone" /><span>{card.issuer}</span></div><strong>{card.nickname}</strong><small>{card.holder} · •••• {card.lastFour}</small></article>)}
          </div>}
          {!cards.length && <div className="data-empty management-empty"><CreditCardIcon size={28} weight="duotone" /><strong>No cards yet</strong><span>Upload a BNZ statement and we will detect the card, or add one manually.</span></div>}
        </section>

        <section className="management-card statement-card" aria-label="Monthly bank statements" role="region">
          <div className="section-heading"><div><span>Monthly reports</span><h3>Bank statements</h3></div><FilePdfIcon size={25} weight="duotone" /></div>
          <div className="statement-upload">
            <div><strong>Upload first</strong><span>We will match the card from the PDF.</span></div>
            <label className={`secondary-button${isReadingStatement ? " is-disabled" : ""}`} htmlFor="bank-statement"><UploadSimpleIcon size={19} />{isReadingStatement ? "Reading locally…" : "Choose PDF"}</label>
            <input ref={statementInputRef} id="bank-statement" aria-label="Choose bank statement PDF" type="file" accept="application/pdf,.pdf" disabled={isReadingStatement} onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadStatement(file); }} />
          </div>
          <p className="statement-privacy"><CheckCircleIcon weight="fill" />Your PDF is read on this device and is not uploaded.</p>
          {uploadError && <div className="statement-error" role="alert"><WarningCircleIcon />{uploadError}</div>}
          <div className="statement-list">
            {statements.map((statement) => {
              const card = cards.find((candidate) => candidate.id === statement.cardId);
              const active = periodMode === "range" && rangeStart === statement.periodStart && rangeEnd === statement.periodEnd && selectedCard === statement.cardId;
              return <button className={active ? "is-active" : ""} type="button" aria-label={`View ${statement.fileName} activity`} key={statement.id} onClick={() => showStatementActivity(statement)}><FilePdfIcon size={24} /><div><strong>{statement.fileName}</strong><span>{card?.nickname ?? "Unknown card"} · {shortDate(statement.periodStart)} – {shortDate(statement.periodEnd)} · {statement.status}</span></div></button>;
            })}
          </div>
          {!statements.length && <div className="data-empty statement-empty"><FilePdfIcon size={28} weight="duotone" /><strong>No statements imported</strong><span>Choose the original PDF downloaded from BNZ.</span></div>}
        </section>
      </div>

      {statementReview && (
        <section className="statement-review" role="region" aria-label="Review BNZ statement">
          <div className="statement-review-header">
            <div>
              <span>Check before import</span>
              <h3>Review BNZ statement</h3>
              <p>{shortDate(statementReview.periodStart)} – {shortDate(statementReview.periodEnd)} · <span>{statementReview.transactions.length} detected transactions</span></p>
            </div>
            <button type="button" aria-label="Close statement review" onClick={() => setStatementReview(null)}><XIcon /></button>
          </div>
          <div className="statement-review-summary">
            <div><span>Account</span><strong>•••• {statementReview.accountLastFour ?? "Unknown"}</strong></div>
            <div><span>Detected card</span><strong>{statementReview.cardLastFour ? `Card •••• ${statementReview.cardLastFour}` : "No card suffix"}</strong></div>
            <div><span>Withdrawals</span><strong>{money(statementReview.outflowTotal)}</strong></div>
            <div><span>Deposits</span><strong>{money(statementReview.inflowTotal)}</strong></div>
          </div>
          <div className="statement-card-association">
            <label><span>Associated card</span><select aria-label="Card for statement" value={statementReview.cardId} onChange={(event) => setStatementReview((current) => current ? { ...current, cardId: event.target.value } : current)}><option value="">Choose a card</option>{cards.map((card) => <option key={card.id} value={card.id}>{card.nickname} · •••• {card.lastFour}</option>)}</select></label>
            <button type="button" onClick={() => { setCardError(""); setCardDraft({ nickname: "", holder: memberName, lastFour: statementReview.cardLastFour ?? "" }); setCardFormContext("statement"); }}><PlusIcon weight="bold" />Add new card</button>
          </div>
          <div className="statement-review-note"><WarningCircleIcon /><span><strong>Review required.</strong> Transfers and deposits are excluded from spending by default. You can edit every field and choose what belongs in the dashboard.</span></div>
          <div className="statement-review-list">
            {statementReview.transactions.map((transaction, index) => (
              <article className={transaction.included ? "is-included" : "is-excluded"} key={transaction.id}>
                <label className="statement-include">
                  <input type="checkbox" aria-label={`Include ${transaction.merchant}`} checked={transaction.included} onChange={(event) => updateReviewTransaction(transaction.id, { included: event.target.checked })} />
                  <span>{transaction.direction === "inflow" ? "Deposit" : transaction.transfer ? "Transfer" : "Expense"}</span>
                </label>
                <label><span>Date</span><input className={transaction.included && !transaction.date ? "is-invalid" : ""} aria-label={`Date ${index + 1}`} type="date" value={transaction.date} onChange={(event) => updateReviewTransaction(transaction.id, { date: event.target.value })} /></label>
                <label className="statement-merchant"><span>Merchant</span><input className={transaction.included && !transaction.merchant.trim() ? "is-invalid" : ""} aria-label={`Merchant ${index + 1}`} value={transaction.merchant} onChange={(event) => updateReviewTransaction(transaction.id, { merchant: event.target.value })} /></label>
                <label><span>Category</span><select aria-label={`Category ${index + 1}`} value={transaction.category} onChange={(event) => updateReviewTransaction(transaction.id, { category: event.target.value })}>{CATEGORIES.map((category) => <option key={category}>{category}</option>)}</select></label>
                <label><span>Amount</span><input className={transaction.included && transaction.amount <= 0 ? "is-invalid" : ""} aria-label={`Amount ${index + 1}`} type="number" min="0.01" step="0.01" value={transaction.amount} onChange={(event) => updateReviewTransaction(transaction.id, { amount: Number(event.target.value) })} /></label>
              </article>
            ))}
          </div>
          <div className="statement-review-actions">
            <div><strong>{includedReviewTransactions.length} expenses · {money(includedReviewTransactions.reduce((sum, transaction) => sum + transaction.amount, 0))}</strong>{reviewIssue && <span role="alert">{reviewIssue}</span>}</div>
            <button className="primary-button" type="button" disabled={Boolean(reviewIssue) || isImporting} onClick={() => void confirmStatement()}><CheckCircleIcon weight="bold" />{isImporting ? "Saving statement…" : `Confirm ${includedReviewTransactions.length} ${includedReviewTransactions.length === 1 ? "expense" : "expenses"}`}</button>
          </div>
        </section>
      )}

      <section ref={importedActivityRef} className="transaction-card" aria-label={selectedPeriodLabel === "No imported data" ? "Imported transactions" : `${selectedPeriodLabel} transactions`}>
        <div className="section-heading"><div><span>Transaction detail</span><h3>{selectedPeriodLabel === "No imported data" ? "Imported activity" : `${selectedPeriodLabel} activity`}</h3></div><CalendarBlankIcon size={25} weight="duotone" /></div>
        {importNotice && <div className="import-notice" role="status"><CheckCircleIcon weight="fill" /><span>{importNotice}</span></div>}
        <div className="transaction-list">
          {transactions.slice().reverse().slice(0, 8).map((transaction) => {
            const card = cards.find((candidate) => candidate.id === transaction.cardId);
            return <article key={transaction.id}><time>{shortDate(transaction.date)}</time><div><strong>{transaction.merchant}</strong><span>{transaction.category} · {card?.nickname}</span></div><strong>{money(transaction.amount)}</strong></article>;
          })}
        </div>
        {!transactions.length && <div className="data-empty data-empty-wide"><CalendarBlankIcon size={28} weight="duotone" /><strong>No imported transactions</strong><span>Confirmed expenses from your statements will appear here.</span></div>}
      </section>

      {cardFormContext && (
        <div className="card-modal-backdrop">
          <div className="card-modal" role="dialog" aria-modal="true" aria-labelledby="card-modal-title">
            <div className="card-modal-header"><div><span>{cardFormContext === "statement" ? "No exact match" : "Card maintenance"}</span><h3 id="card-modal-title">{cardFormContext === "statement" ? "Add a card for this statement" : "Add household card"}</h3></div><button type="button" aria-label="Close add card form" onClick={() => setCardFormContext(null)}><XIcon /></button></div>
            {cardFormContext === "statement" && <p className="card-modal-copy">We detected {cardDraft.lastFour ? `•••• ${cardDraft.lastFour}` : "a statement without a card suffix"}. Add its details now, then review the association before importing.</p>}
            <form className="card-form" onSubmit={saveCard}>
              <label><span>Card nickname</span><input autoFocus aria-label="Card nickname" value={cardDraft.nickname} onChange={(event) => setCardDraft((current) => ({ ...current, nickname: event.target.value }))} placeholder="Joint Visa" required /></label>
              <label><span>Card holder</span><input aria-label="Card holder" value={cardDraft.holder} onChange={(event) => setCardDraft((current) => ({ ...current, holder: event.target.value }))} placeholder="Daniel & Andrea" required /></label>
              <label><span>Last four digits</span><input aria-label="Last four digits" value={cardDraft.lastFour} readOnly={cardFormContext === "statement" && Boolean(statementReview?.cardLastFour)} onChange={(event) => setCardDraft((current) => ({ ...current, lastFour: event.target.value.replace(/\D/g, "").slice(0, 4) }))} inputMode="numeric" pattern="\d{4}" placeholder="1234" required /></label>
              {cardError && <span className="card-form-error" role="alert">{cardError}</span>}
              <button className="primary-button" type="submit" disabled={isSavingCard}>{isSavingCard ? "Saving card…" : cardFormContext === "statement" ? "Save and associate card" : "Save card"}</button>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
