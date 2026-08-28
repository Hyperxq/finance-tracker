import type { SupabaseClient } from "@supabase/supabase-js";

export type HouseholdCard = {
  id: string;
  issuer: string;
  nickname: string;
  holder: string;
  lastFour: string;
};

export type BankStatement = {
  id: string;
  cardId: string;
  fileName: string;
  fingerprint: string;
  periodStart: string;
  periodEnd: string;
  status: "Imported";
};

export type BankTransaction = {
  id: string;
  cardId: string;
  date: string;
  merchant: string;
  category: string;
  amount: number;
};

export type ReceiptPayload = {
  merchant: string;
  receiptNumber: string;
  purchasedAt: string;
  total: number;
  confidence: number;
  items: Array<{
    name: string;
    quantity: number;
    unitPrice: number;
    amount: number;
  }>;
};

export type CardPayload = Omit<HouseholdCard, "id">;

export type StatementPayload = {
  cardId: string;
  fileName: string;
  fingerprint: string;
  periodStart: string;
  periodEnd: string;
  transactions: Array<Omit<BankTransaction, "id" | "cardId">>;
};

export type BankData = {
  cards: HouseholdCard[];
  statements: BankStatement[];
  transactions: BankTransaction[];
};

export type FinanceStore = {
  loadBankData: () => Promise<BankData>;
  saveReceipt: (payload: ReceiptPayload) => Promise<string>;
  saveCard: (payload: CardPayload) => Promise<HouseholdCard>;
  importStatement: (payload: StatementPayload) => Promise<string>;
};

type CardRow = {
  id: string;
  issuer: string;
  nickname: string;
  holder: string;
  last_four: string;
};

const cardFromRow = (row: CardRow): HouseholdCard => ({
  id: row.id,
  issuer: row.issuer,
  nickname: row.nickname,
  holder: row.holder,
  lastFour: row.last_four,
});

export function createFinanceStore(client: SupabaseClient): FinanceStore {
  return {
    async loadBankData() {
      const [cardResult, statementResult, transactionResult] = await Promise.all([
        client.from("cards").select("id, issuer, nickname, holder, last_four").order("created_at"),
        client.from("bank_statements").select("id, card_id, file_name, fingerprint, period_start, period_end, status").order("period_end", { ascending: false }),
        client.from("bank_transactions").select("id, card_id, transaction_date, merchant, category, amount").order("transaction_date", { ascending: false }),
      ]);
      if (cardResult.error) throw cardResult.error;
      if (statementResult.error) throw statementResult.error;
      if (transactionResult.error) throw transactionResult.error;

      return {
        cards: (cardResult.data as CardRow[]).map(cardFromRow),
        statements: statementResult.data.map((row) => ({
          id: row.id,
          cardId: row.card_id,
          fileName: row.file_name,
          fingerprint: row.fingerprint,
          periodStart: row.period_start,
          periodEnd: row.period_end,
          status: row.status as "Imported",
        })),
        transactions: transactionResult.data.map((row) => ({
          id: row.id,
          cardId: row.card_id,
          date: row.transaction_date,
          merchant: row.merchant,
          category: row.category,
          amount: Number(row.amount),
        })),
      };
    },

    async saveReceipt(payload) {
      const { data, error } = await client.rpc("save_receipt", { payload });
      if (error) throw error;
      return data as string;
    },

    async saveCard(payload) {
      const { data, error } = await client.rpc("save_card", { payload });
      if (error) throw error;
      return cardFromRow(data as CardRow);
    },

    async importStatement(payload) {
      const { data, error } = await client.rpc("import_bank_statement", { payload });
      if (error) throw error;
      return data as string;
    },
  };
}
