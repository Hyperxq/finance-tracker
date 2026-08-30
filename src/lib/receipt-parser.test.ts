import { describe, expect, it } from "vitest";
import { parseReceiptText } from "./receipt-parser";

const PAKNSAVE_SAMPLE = `
Rec# 0201288681 Date 12/03/2023 21:18:50
Operator SC20 Lane 20
Sticky Club tag : 5******2

TAYLOR FARMS SLAH (WD      1 @  $5.99 EA =    $5.99
BERRY FIX FROZEN MIXE      1 @ $14.39 EA =   $14.39
VALUE TOILET TISSUE W      1 @  $3.59 EA =    $3.59
FARRAHS WRAPS GARDEN       1 @  $5.25 EA =    $5.25
VALUE MILK STANDARD 2      1 @  $3.79 EA =    $3.79
TEGEL CHICKEN SWEET C      1 @  $4.99 EA =    $4.99
TEGEL CHICKEN SWEET C      1 @  $4.99 EA =    $4.99
WOODLAND FREE RANGE E      1 @  $5.09 EA =    $5.09
SANI SO GOOD DAIRY OA      1 @  $2.99 EA =    $2.99 *
HELLERS BURGERS ANGUS      1 @ $10.99 EA =   $10.99
HALO MANDARIN KG IMPO      1 @  $6.31 EA =    $6.31
GRAPES GREEN 500G IMP      1 @  $8.89 EA =    $8.89
KIWIFRUIT GREEN KG NZ      1 @  $9.84 EA =    $9.84
APPLES ROYAL GALA KG       1 @  $1.87 EA =    $1.87
PAMS FR. KALE BABY 12      1 @  $4.39 EA =    $4.39
SANI SO GOOD DAIRY OA      1 @  $2.99 EA =    $2.99 *
HEALTHERIES TEA SLEEP      1 @  $6.09 EA =    $6.09

Total including GST                              $102.44
VISA 12383                                       $102.44

PAK N SAVE RICCARTON
WESTFIELD MALL
RICCARTON ROAD
`;

const NOISY_OCR_TEXT = `
Rech 0201288031 Date 12/03/2023 21:18:50
TAYLOR FARMS SLAW (WD 10 $5.99EA= $5.99
RERRY FIX FROZEN MIXE 190 $14.39 FA = $14.39
VALUE TOILEY TISSUE # i@ $3.59EA= $3.59
FARRAHS WRAPS GARDEN 18 $5.25%6A= $5.25
VALUE WILK STANDARD 2 18 $3.79EA= $3.79
EGEL CHICKEN SWEETC  1@ $4.99 FA = $4.99
TEGEL CHICKEN SWEET C 16 $4.99EAs $4.99
WOODLAND FREE RANGE E 18 $5.09FA= $5.09
SANI SO GOOD DAIRY OA 10 $2.99FA= $2.99
HELLERS BURGERS ANGUS 1@ $10.99 EA = $10.99
HALO MANDARIN KG IHPO 10 $0.31EA= $6.31
GRAPES GREEN 5006 INP 1@ $8.89FEA= $5.89
KIWIFRUIT GREEN KG NZ 10 $984 EA= $9.84
APPLES ROVAL GALA KG 16 $1.87FA= $1.87
PAHS Fil. KALE BABY 12 16 $4.39FA= $4.39
SANT 50 GOOD DAIRY OA 10 $2.99FA= $2.99
HEALTHEKIES TEA SLEEP 10 $6.09FA= $6.09
Total including GSI $102.44
PAK N SAVE RICCARTON
`;

const LEGACY_SINGLE_PRICE_RECEIPT = `
ROYAL Oak
PAK N SAVE
05/01/91
SUGAR 3KG 3.79
PUREX CRIPS 2.63
NOODLES .59
NOODLES .59
CHUBS TRIPLE 3.18
FRUIT TARTS 1.99
CHEQUE FEE .20
ACNT # 2100077823
# 7 TOTAL 12.97
CHEQUE 12.97
`;

const BALANCE_DUE_RECEIPT = `
PAKN'SAVE
ANCHOR COTTAGE CHEESE ORIGINAL 500G $12.58
MEADOW FRESH CHEESE COLBY 1KG $18.98
MEADOW FRESH SOUR CRM TRADITIONAL 250G $3.49
STEINLAGER PURE 330ML 24PK BTL $45.99
47 BALANCE DUE $81.04
EFTPOS $81.04
`;

const SMALL_PHOTO_OCR = `
PAKNhSAVE
ANCHOR COYTAGE CHEESE ORIGINAL 5000
24 £6.29 $12.50
WERDUY FRESH CHEESE COLBY 1KG
2d $9.49 $16.58
MEADOU FRESH SUUR CRM RADITIONML 25060 $3.45
SIEINLAGER PURE 330ML 24PK BTL
23 $45.99 $91.96
NZ BEEF SCHNITZEL $13.19
AT BALANCE DUE £45.19
EFTPOS $345. 19
`;

const NARROW_LEGACY_OCR = `
ROYAL Oak
PAK NERayE
05/01/91
SUGAR 3KG 2 79
NOODLES 59
NOODLES 59
CHUBS TRIPLE 3.18
FRUIT TARTS 1.99
TINY TEDDYS 1.60
DIET SPRITE 1.59
DIET SPRITE 1.59
CHEQUE FEE 20
ACNT # 2100077823
# 10 TOTAL 50.45
CHEQUE 50.45
`;

const WEIGHTED_AND_MISALIGNED_TOTAL_OCR = `
PAKNSAVE
BALDUCCI 18 PENNE RIGATI 500G $1.49
PUMPKIN BUTTERNUT EA 19 $3.99 EA= $3.9
CARROTS
0.288 Kg @ $2.79/Kg $0.80
ONIONS BROWN
0.298 Kg @ $1.99/Kg $0.59
NZ BEEF MINCE 312.52
19 BALANCE OUE
og N $100.00
SUB TOTAL $63.57
TOTAL 6ST $73.11
TOTAL
$26.90
CHANGE
`;

describe("parseReceiptText", () => {
  it("extracts metadata and every item from the PAK'nSAVE sample", () => {
    const receipt = parseReceiptText(PAKNSAVE_SAMPLE);

    expect(receipt.merchant).toBe("PAK N SAVE RICCARTON");
    expect(receipt.receiptNumber).toBe("0201288681");
    expect(receipt.purchasedAt).toBe("2023-03-12T21:18:50");
    expect(receipt.items).toHaveLength(17);
    expect(receipt.items[0]).toEqual({
      name: "TAYLOR FARMS SLAH (WD",
      quantity: 1,
      unitPrice: 5.99,
      amount: 5.99,
    });
    expect(receipt.items.filter((item) => item.name === "TEGEL CHICKEN SWEET C")).toHaveLength(2);
  });

  it("reconciles extracted line amounts against the printed total", () => {
    const receipt = parseReceiptText(PAKNSAVE_SAMPLE);

    expect(receipt.calculatedTotal).toBe(102.44);
    expect(receipt.receiptTotal).toBe(102.44);
    expect(receipt.difference).toBe(0);
    expect(receipt.matched).toBe(true);
  });

  it("flags a receipt when OCR line amounts do not match the printed total", () => {
    const receipt = parseReceiptText(PAKNSAVE_SAMPLE.replace("$14.39 EA =   $14.39", "$14.39 EA =   $14.09"));

    expect(receipt.calculatedTotal).toBe(102.14);
    expect(receipt.receiptTotal).toBe(102.44);
    expect(receipt.difference).toBe(-0.3);
    expect(receipt.matched).toBe(false);
  });

  it("keeps noisy OCR items editable while reconciliation catches the wrong line", () => {
    const receipt = parseReceiptText(NOISY_OCR_TEXT);

    expect(receipt.items).toHaveLength(17);
    expect(receipt.items[0]).toMatchObject({ name: "TAYLOR FARMS SLAW (WD", quantity: 1, amount: 5.99 });
    expect(receipt.items[12]).toMatchObject({ name: "KIWIFRUIT GREEN KG NZ", unitPrice: 9.84, amount: 9.84 });
    expect(receipt.calculatedTotal).toBe(99.44);
    expect(receipt.receiptTotal).toBe(102.44);
    expect(receipt.matched).toBe(false);
  });

  it("accepts common OCR substitutions in currency and GST glyphs", () => {
    const receipt = parseReceiptText(`
PAM FR. KALE BABY 12 16 $439 FA= §4.39
Total including G51 $4.39
PAK N SAVE RICCARTON
`);

    expect(receipt.items[0]).toMatchObject({ name: "PAM FR. KALE BABY 12", quantity: 1, unitPrice: 4.39, amount: 4.39 });
    expect(receipt.receiptTotal).toBe(4.39);
    expect(receipt.matched).toBe(true);
  });

  it("extracts legacy item lines with one trailing price", () => {
    const receipt = parseReceiptText(LEGACY_SINGLE_PRICE_RECEIPT);

    expect(receipt.items).toHaveLength(7);
    expect(receipt.items[0]).toEqual({
      name: "SUGAR 3KG",
      quantity: 1,
      unitPrice: 3.79,
      amount: 3.79,
    });
    expect(receipt.items[2]).toMatchObject({ name: "NOODLES", amount: 0.59 });
    expect(receipt.receiptNumber).toBe("2100077823");
    expect(receipt.purchasedAt).toBe("1991-01-05T00:00:00");
    expect(receipt.receiptTotal).toBe(12.97);
    expect(receipt.matched).toBe(true);
  });

  it("stops item extraction at a balance-due total", () => {
    const receipt = parseReceiptText(BALANCE_DUE_RECEIPT);

    expect(receipt.merchant).toBe("PAKN'SAVE");
    expect(receipt.items).toHaveLength(4);
    expect(receipt.items.at(-1)).toMatchObject({
      name: "STEINLAGER PURE 330ML 24PK BTL",
      amount: 45.99,
    });
    expect(receipt.items.some((item) => item.name === "EFTPOS")).toBe(false);
    expect(receipt.receiptTotal).toBe(81.04);
    expect(receipt.matched).toBe(true);
  });

  it("joins item descriptions with a following quantity and price line", () => {
    const receipt = parseReceiptText(SMALL_PHOTO_OCR);

    expect(receipt.items).toHaveLength(5);
    expect(receipt.items[0]).toMatchObject({
      name: "ANCHOR COYTAGE CHEESE ORIGINAL 5000",
      unitPrice: 6.29,
      amount: 12.5,
    });
    expect(receipt.items[2]).toMatchObject({ name: "MEADOU FRESH SUUR CRM RADITIONML 25060", amount: 3.45 });
    expect(receipt.merchant).toBe("PAKNhSAVE");
    expect(receipt.receiptTotal).toBe(345.19);
  });

  it("keeps cents-only legacy prices editable", () => {
    const receipt = parseReceiptText(NARROW_LEGACY_OCR);

    expect(receipt.items).toHaveLength(9);
    expect(receipt.items[0]).toMatchObject({ name: "SUGAR 3KG", amount: 2.79 });
    expect(receipt.items[1]).toMatchObject({ name: "NOODLES", amount: 0.59 });
    expect(receipt.items.at(-1)).toMatchObject({ name: "CHEQUE FEE", amount: 0.2 });
    expect(receipt.receiptTotal).toBe(50.45);
  });

  it("keeps weighted products together and recovers a misaligned printed total", () => {
    const receipt = parseReceiptText(WEIGHTED_AND_MISALIGNED_TOTAL_OCR);

    expect(receipt.items).toEqual([
      { name: "BALDUCCI 18 PENNE RIGATI 500G", quantity: 1, unitPrice: 1.49, amount: 1.49 },
      { name: "PUMPKIN BUTTERNUT EA", quantity: 1, unitPrice: 3.99, amount: 3.99 },
      { name: "CARROTS", quantity: 0.288, unitPrice: 2.79, amount: 0.8 },
      { name: "ONIONS BROWN", quantity: 0.298, unitPrice: 1.99, amount: 0.59 },
      { name: "NZ BEEF MINCE", quantity: 1, unitPrice: 12.52, amount: 12.52 },
    ]);
    expect(receipt.receiptTotal).toBe(73.11);
  });
});
