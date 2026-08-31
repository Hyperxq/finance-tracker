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
  statementId: string;
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

export type SavedReceipt = {
  id: string;
  merchant: string;
  purchasedAt: string;
  total: number;
};

export type SavedReceiptItem = {
  id: string;
  receiptId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  amount: number;
};

export type ReceiptData = {
  receipts: SavedReceipt[];
  items: SavedReceiptItem[];
};

export type CardPayload = Omit<HouseholdCard, "id">;

export type StatementPayload = {
  cardId: string;
  fileName: string;
  fingerprint: string;
  periodStart: string;
  periodEnd: string;
  transactions: Array<Omit<BankTransaction, "id" | "statementId" | "cardId">>;
};

export type BankData = {
  cards: HouseholdCard[];
  statements: BankStatement[];
  transactions: BankTransaction[];
};

export type FinanceStore = {
  loadReceiptData: () => Promise<ReceiptData>;
  loadBankData: () => Promise<BankData>;
  saveReceipt: (payload: ReceiptPayload) => Promise<string>;
  deleteReceipt: (receiptId: string) => Promise<void>;
  saveCard: (payload: CardPayload) => Promise<HouseholdCard>;
  importStatement: (payload: StatementPayload) => Promise<string>;
  deleteStatement: (statementId: string) => Promise<void>;
};

type CardRow = {
  id: string;
  issuer: string;
  nickname: string;
  holder: string;
  last_four: string;
};

type ReceiptRow = {
  id: string;
  merchant: string;
  purchased_at: string;
  total: string | number;
};

type ReceiptItemRow = {
  id: string;
  receipt_id: string;
  name: string;
  quantity: string | number;
  unit_price: string | number;
  amount: string | number;
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
    async loadReceiptData() {
      const [receiptResult, itemResult] = await Promise.all([
        client.from("receipts").select("id, merchant, purchased_at, total").order("purchased_at"),
        client.from("receipt_items").select("id, receipt_id, name, quantity, unit_price, amount").order("position"),
      ]);
      if (receiptResult.error) throw receiptResult.error;
      if (itemResult.error) throw itemResult.error;

      return {
        receipts: (receiptResult.data as ReceiptRow[]).map((row) => ({
          id: row.id,
          merchant: row.merchant,
          purchasedAt: row.purchased_at,
          total: Number(row.total),
        })),
        items: (itemResult.data as ReceiptItemRow[]).map((row) => ({
          id: row.id,
          receiptId: row.receipt_id,
          name: row.name,
          quantity: Number(row.quantity),
          unitPrice: Number(row.unit_price),
          amount: Number(row.amount),
        })),
      };
    },

    async loadBankData() {
      const [cardResult, statementResult, transactionResult] = await Promise.all([
        client.from("cards").select("id, issuer, nickname, holder, last_four").order("created_at"),
        client.from("bank_statements").select("id, card_id, file_name, fingerprint, period_start, period_end, status").order("period_end", { ascending: false }),
        client.from("bank_transactions").select("id, statement_id, card_id, transaction_date, merchant, category, amount").order("transaction_date", { ascending: false }),
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
          statementId: row.statement_id,
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

    async deleteReceipt(receiptId) {
      const { error } = await client.from("receipts").delete().eq("id", receiptId);
      if (error) throw error;
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

    async deleteStatement(statementId) {
      const { error } = await client.from("bank_statements").delete().eq("id", statementId);
      if (error) throw error;
    },
  };
}
