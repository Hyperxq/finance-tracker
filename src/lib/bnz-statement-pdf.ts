import { parseBnzStatement, type BnzStatementRow, type ParsedBnzStatement } from "./bnz-statement-parser";

export type PositionedTextItem = {
  str: string;
  x: number;
  y: number;
};

type ColumnName = keyof BnzStatementRow;

const HEADER_COLUMNS: Array<{ label: string; name: ColumnName }> = [
  { label: "Date", name: "date" },
  { label: "Particulars", name: "particulars" },
  { label: "Type", name: "type" },
  { label: "Withdrawals", name: "withdrawal" },
  { label: "Deposits", name: "deposit" },
  { label: "Balance", name: "balance" },
];

export function rowsFromPositionedItems(items: PositionedTextItem[]): BnzStatementRow[] {
  const headerItems = HEADER_COLUMNS.map((column) =>
    items.find((candidate) => candidate.str.trim() === column.label));
  if (headerItems.every((item) => !item)) return [];

  const headers = HEADER_COLUMNS.map((column, index) => {
    const item = headerItems[index];
    if (!item) throw new Error("The PDF does not contain a BNZ transaction table.");
    return { ...column, x: item.x, y: item.y };
  });
  const headerY = headers[0].y;
  const dateX = headers[0].x;
  const content = items
    .filter((item) => item.str.trim() && item.x >= dateX - 3 && item.y < headerY - 4)
    .sort((left, right) => right.y - left.y || left.x - right.x);
  const lines: Array<{ y: number; items: PositionedTextItem[] }> = [];

  for (const item of content) {
    const line = lines.find((candidate) => Math.abs(candidate.y - item.y) <= 2.5);
    if (line) {
      line.items.push(item);
    } else {
      lines.push({ y: item.y, items: [item] });
    }
  }

  return lines.flatMap<BnzStatementRow>((line) => {
    const values: Partial<Record<ColumnName, string[]>> = {};
    for (const item of line.items.sort((left, right) => left.x - right.x)) {
      let column = headers[headers.length - 1];
      for (let index = 1; index < headers.length; index += 1) {
        const boundary = (headers[index - 1].x + headers[index].x) / 2;
        if (item.x < boundary) {
          column = headers[index - 1];
          break;
        }
      }
      values[column.name] = [...(values[column.name] ?? []), item.str.trim()];
    }
    const row = Object.fromEntries(Object.entries(values)
      .map(([name, parts]) => [name, parts?.join(" ").trim()])
      .filter(([, value]) => value)) as BnzStatementRow;
    if (!row.date && !row.particulars && !row.type && !row.withdrawal && !row.deposit) return [];
    return [row];
  });
}

export async function extractBnzStatement(file: File): Promise<ParsedBnzStatement> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (typeof window !== "undefined") {
    const workerModule = await import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url");
    pdfjs.GlobalWorkerOptions.workerSrc = workerModule.default;
  }
  const document = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const rows: BnzStatementRow[] = [];
  const statementText: string[] = [];

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const items = content.items.flatMap<PositionedTextItem>((item) => {
      if (!("str" in item) || !("transform" in item)) return [];
      statementText.push(item.str);
      return [{ str: item.str, x: item.transform[4], y: item.transform[5] }];
    });
    rows.push(...rowsFromPositionedItems(items));
  }

  return parseBnzStatement({ rows, statementText: statementText.join(" ") });
}
