import {
  ArrowRightIcon,
  BrainIcon,
  CameraRotateIcon,
  ChartBarIcon,
  CheckCircleIcon,
  FileImageIcon,
  HouseIcon,
  ImageSquareIcon,
  PlusIcon,
  ReceiptIcon,
  ShieldCheckIcon,
  TrashIcon,
  UploadSimpleIcon,
  WarningCircleIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { flushSync } from "react-dom";
import { BankWorkspace } from "./BankWorkspace";
import { appPath, viewFromPath, type AppView } from "../lib/app-routes";
import { parseReceiptText, type ParsedReceipt, type ReceiptItem } from "../lib/receipt-parser";
import { recognizeReceipt, type OcrProgress, type RecognizeReceipt } from "../lib/receipt-ocr";

type ReceiptWorkspaceProps = {
  recognize?: RecognizeReceipt;
};

type EditableReceiptItem = ReceiptItem & {
  rowId: number;
};

let nextRowId = 0;

const editableItem = (item: ReceiptItem): EditableReceiptItem => ({ ...item, rowId: nextRowId += 1 });

const money = (value: number) => `NZ$${value.toFixed(2)}`;
const dashboardPath = appPath("/dashboard");
const receiptsPath = appPath("/receipts");
const bankPath = appPath("/bank");

function displayMerchant(merchant: string) {
  const normalized = merchant.replace(/^PAK\s+N\s+SAVE/i, "PAK’nSAVE");
  const [brand, ...location] = normalized.split(" ");
  const title = location.join(" ").toLowerCase().replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
  return [brand, title].filter(Boolean).join(" ");
}

function displayDate(purchasedAt: string) {
  const [date] = purchasedAt.split("T");
  if (!date) return "Date needs review";
  const [year, month, day] = date.split("-");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${Number(day)} ${months[Number(month) - 1]} ${year}`;
}

export function ReceiptWorkspace({ recognize = recognizeReceipt }: ReceiptWorkspaceProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [receipt, setReceipt] = useState<ParsedReceipt | null>(null);
  const [items, setItems] = useState<EditableReceiptItem[]>([]);
  const [confidence, setConfidence] = useState(0);
  const [progress, setProgress] = useState<OcrProgress | null>(null);
  const [error, setError] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  const [showOriginal, setShowOriginal] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [saved, setSaved] = useState(false);
  const [activeView, setActiveView] = useState<AppView>("receipts");
  const activeViewRef = useRef(activeView);

  const changeView = useCallback((nextView: AppView) => {
    if (activeViewRef.current === nextView) return;
    activeViewRef.current = nextView;

    const commit = () => setActiveView(nextView);
    const startViewTransition = (document as Document & {
      startViewTransition?: (update: () => void) => unknown;
    }).startViewTransition;

    if (startViewTransition) {
      startViewTransition.call(document, () => flushSync(commit));
      return;
    }

    commit();
  }, []);

  const navigate = (event: ReactMouseEvent<HTMLAnchorElement>, path: string, nextView: AppView) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (window.location.pathname !== path) window.history.pushState(null, "", path);
    changeView(nextView);
  };

  useEffect(() => {
    const initialView = viewFromPath(window.location.pathname);
    if (activeViewRef.current !== initialView) {
      activeViewRef.current = initialView;
      setActiveView(initialView);
    }

    const syncView = () => changeView(viewFromPath(window.location.pathname));
    window.addEventListener("popstate", syncView);
    return () => window.removeEventListener("popstate", syncView);
  }, [changeView]);

  const calculatedTotal = useMemo(
    () => Math.round(items.reduce((total, item) => total + item.amount, 0) * 100) / 100,
    [items],
  );
  const differenceInCents = receipt
    ? Math.round(calculatedTotal * 100) - Math.round(receipt.receiptTotal * 100)
    : 0;
  const missingReceiptDetails = receipt ? [
    receipt.merchant.trim().length === 0 ? "merchant" : "",
    receipt.purchasedAt.length === 0 ? "purchase date" : "",
    receipt.receiptTotal < 0 ? "printed total" : "",
  ].filter(Boolean) : [];
  const incompleteItemCount = items.filter(
    (item) => item.name.trim().length === 0 || item.quantity <= 0 || item.unitPrice < 0 || item.amount < 0,
  ).length;
  const matched = receipt !== null
    && items.length > 0
    && differenceInCents === 0;
  const complete = receipt !== null
    && items.length > 0
    && missingReceiptDetails.length === 0
    && incompleteItemCount === 0;
  const canConfirm = matched && complete;
  const confirmationBlockers = receipt ? [
    missingReceiptDetails.length > 0
      ? `Complete the ${missingReceiptDetails.join(" and ")}.`
      : "",
    items.length === 0
      ? "Add at least one item."
      : incompleteItemCount > 0
        ? `Complete ${incompleteItemCount} ${incompleteItemCount === 1 ? "item" : "items"} with a name, quantity, unit price, and line total.`
        : "",
    differenceInCents < 0
      ? `The extracted items are ${money(Math.abs(differenceInCents) / 100)} below the receipt total. Check for missing or misread items.`
      : differenceInCents > 0
        ? `The extracted items are ${money(differenceInCents / 100)} above the receipt total. Check for duplicated or misread items.`
        : "",
  ].filter(Boolean) : [];
  const indexedItems = items.map((item, index) => ({ item, index }));
  const visibleItems = expanded ? indexedItems : indexedItems.slice(0, 9);
  const today = new Intl.DateTimeFormat("en-NZ", { day: "numeric", month: "long", year: "numeric" }).format(new Date());

  const reset = () => {
    if (previewUrl) URL.revokeObjectURL?.(previewUrl);
    setReceipt(null);
    setItems([]);
    setConfidence(0);
    setProgress(null);
    setError("");
    setPreviewUrl("");
    setExpanded(false);
    setSaved(false);
    if (inputRef.current) inputRef.current.value = "";
  };

  const processFile = async (file: File) => {
    reset();
    setPreviewUrl(typeof URL.createObjectURL === "function" ? URL.createObjectURL(file) : "");
    setProgress({ label: "Preparing image", progress: 2 });

    try {
      const result = await recognize(file, setProgress);
      const parsed = parseReceiptText(result.text);
      if (parsed.items.length === 0 || parsed.receiptTotal === 0) {
        throw new Error("No itemized receipt was found. Retake the photo with the receipt flat and fully visible.");
      }
      setReceipt(parsed);
      setItems(parsed.items.map(editableItem));
      setConfidence(Math.round(result.confidence));
      setProgress(null);
    } catch (caught) {
      setProgress(null);
      setError(caught instanceof Error ? caught.message : "The receipt could not be read.");
    }
  };

  const updateReceipt = (field: "merchant" | "receiptNumber" | "receiptTotal", value: string) => {
    setSaved(false);
    setReceipt((current) => current ? {
      ...current,
      [field]: field === "receiptTotal" ? Number(value) : value,
    } : current);
  };

  const updatePurchasedAt = (part: "date" | "time", value: string) => {
    setSaved(false);
    setReceipt((current) => {
      if (!current) return current;
      const [date = "", time = "00:00:00"] = current.purchasedAt.split("T");
      return {
        ...current,
        purchasedAt: part === "date" ? `${value}T${time}` : `${date}T${value}:00`,
      };
    });
  };

  const updateItem = (index: number, field: keyof ReceiptItem, value: string) => {
    setSaved(false);
    setItems((current) => current.map((item, itemIndex) => {
      if (itemIndex !== index) return item;
      return {
        ...item,
        [field]: field === "name" ? value : Number(value),
      };
    }));
  };

  const addItem = () => {
    setSaved(false);
    setExpanded(true);
    setItems((current) => [...current, editableItem({ name: "", quantity: 1, unitPrice: 0, amount: 0 })]);
  };

  const removeItem = (rowId: number) => {
    setSaved(false);
    setItems((current) => current.filter((item) => item.rowId !== rowId));
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div>
            <strong>Night Ledger</strong>
            <span>Shared finances, sorted.</span>
          </div>
        </div>

        <nav aria-label="Primary navigation" className="primary-nav">
          <a href={dashboardPath} onClick={(event) => navigate(event, dashboardPath, "receipts")}><HouseIcon size={21} />Dashboard</a>
          <a href={receiptsPath} aria-current={activeView === "receipts" ? "page" : undefined} onClick={(event) => navigate(event, receiptsPath, "receipts")}><UploadSimpleIcon size={22} />Receipts</a>
          <a href={bankPath} aria-current={activeView === "bank" ? "page" : undefined} onClick={(event) => navigate(event, bankPath, "bank")}><ChartBarIcon size={22} />Bank spending</a>
        </nav>

        <div className="sidebar-utility">
          <BrainIcon size={25} />
          <div>
            <strong>Export for AI</strong>
            <span>Export clean data for tools like ChatGPT, Claude, or Gemini.</span>
          </div>
          <ArrowRightIcon className="utility-arrow" size={19} />
        </div>

        <div className="household-profile">
          <span>D &amp; A</span>
          <div><strong>Daniel &amp; Andrea</strong><small>Household workspace</small></div>
        </div>
      </aside>

      {activeView === "bank" ? (
        <main className="workspace bank-workspace" id="bank"><BankWorkspace /></main>
      ) : (
      <main className="workspace" id="add">
        {!receipt ? (
          <section className="upload-view">
            <header className="page-header">
              <p><span>Add information</span><i>/</i>Receipt OCR</p>
              <h1>Turn a receipt<br />into clean data</h1>
              <h2>Photograph the full receipt. Review every item before it joins your household.</h2>
            </header>

            <div
              className={`upload-panel${progress ? " is-processing" : ""}`}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                const file = event.dataTransfer.files[0];
                if (file) void processFile(file);
              }}
            >
              <div className="upload-icon"><FileImageIcon size={38} weight="light" /></div>
              {progress ? (
                <div className="progress-content" aria-live="polite">
                  <span className="eyebrow">Local OCR</span>
                  <h3>{progress.label}</h3>
                  <p>{progress.progress}% complete</p>
                  <div className="progress-track"><span style={{ width: `${progress.progress}%` }} /></div>
                  <small>Keep this tab open while the receipt is read.</small>
                </div>
              ) : (
                <>
                  <span className="eyebrow">Receipt photo</span>
                  <h3>Drop a clear image here</h3>
                  <p>Include the store, every item, and the printed total.</p>
                  <label className="primary-button" htmlFor="receipt-photo">
                    <ImageSquareIcon size={21} weight="bold" />Choose receipt photo
                  </label>
                  <input
                    ref={inputRef}
                    id="receipt-photo"
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void processFile(file);
                    }}
                  />
                  <small>PNG, JPEG, or HEIC · up to 20 MB</small>
                </>
              )}
            </div>

            <div className="privacy-note">
              <ShieldCheckIcon size={23} weight="duotone" />
              <div><strong>Your photo stays on this device</strong><span>This spike runs OCR inside your browser and does not upload the receipt.</span></div>
            </div>

            {error && (
              <div className="error-banner" role="alert">
                <WarningCircleIcon size={24} weight="fill" />
                <div><strong>Receipt not recognized</strong><span>{error}</span></div>
                <button type="button" onClick={() => setError("")} aria-label="Dismiss error"><XIcon /></button>
              </div>
            )}
          </section>
        ) : (
          <section className="review-view">
            <header className="review-header">
              <div className="review-kicker">
                <p><span>Add information</span><i>/</i>Review receipt</p>
                <time>{today}</time>
              </div>
              <h1>Review receipt</h1>
              <h2>Check the extracted details before adding them to your household.</h2>
            </header>

            <section className="receipt-summary" aria-labelledby="receipt-details-title">
              <div className="receipt-summary-header">
                <span className="summary-icon"><ReceiptIcon size={29} weight="duotone" /></span>
                <div className="summary-title">
                  <strong id="receipt-details-title">{displayMerchant(receipt.merchant)}</strong>
                  <span>Receipt #{receipt.receiptNumber}<i>·</i>{displayDate(receipt.purchasedAt)}</span>
                </div>
                <div className="confidence">
                  <span>Extraction confidence</span>
                  <strong><ShieldCheckIcon size={20} weight="duotone" />{confidence >= 85 ? "High" : "Review"} ({confidence}%)</strong>
                </div>
              </div>

              <div className="receipt-fields">
                <label className="merchant-field"><span>Merchant</span><input aria-label="Merchant" value={receipt.merchant} onChange={(event) => updateReceipt("merchant", event.target.value)} /></label>
                <label className="receipt-number-field"><span>Receipt number</span><input aria-label="Receipt number" value={receipt.receiptNumber} onChange={(event) => updateReceipt("receiptNumber", event.target.value)} /></label>
                <label><span>Purchase date</span><input aria-label="Purchase date" type="date" value={receipt.purchasedAt.split("T")[0] ?? ""} onChange={(event) => updatePurchasedAt("date", event.target.value)} /></label>
                <label><span>Purchase time</span><input aria-label="Purchase time" type="time" value={receipt.purchasedAt.split("T")[1]?.slice(0, 5) ?? ""} onChange={(event) => updatePurchasedAt("time", event.target.value)} /></label>
                <label className="total-field"><span>Printed total</span><input aria-label="Printed total" type="number" inputMode="decimal" min="0" step="0.01" value={receipt.receiptTotal} onChange={(event) => updateReceipt("receiptTotal", event.target.value)} /></label>
              </div>
            </section>

            <div className="items-table" role="region" aria-label="Extracted receipt items">
              <div className="table-head"><span>Item</span><span>Qty</span><span>Unit price</span><span>Line total</span><span /></div>
              {visibleItems.map(({ item, index }) => {
                const itemLabel = item.name || `item ${index + 1}`;
                return (
                <div className="item-row" key={item.rowId}>
                  <span className="row-number">{index + 1}</span>
                  <label className="item-field item-name-field"><span>Item</span><input aria-label={`Item ${index + 1}`} value={item.name} onChange={(event) => updateItem(index, "name", event.target.value)} /></label>
                  <label className="item-field"><span>Qty</span><input aria-label={`Quantity for ${item.name}`} inputMode="numeric" min="0" type="number" value={item.quantity} onChange={(event) => updateItem(index, "quantity", event.target.value)} /></label>
                  <label className="item-field"><span>Unit</span><input aria-label={`Unit price for ${item.name}`} inputMode="decimal" min="0" step="0.01" type="number" value={item.unitPrice} onChange={(event) => updateItem(index, "unitPrice", event.target.value)} /></label>
                  <label className="item-field"><span>Total</span><input aria-label={`Amount for ${item.name}`} inputMode="decimal" min="0" step="0.01" type="number" value={item.amount} onChange={(event) => updateItem(index, "amount", event.target.value)} /></label>
                  <button className="remove-item" type="button" aria-label={`Remove ${itemLabel}`} onClick={() => removeItem(item.rowId)}><TrashIcon size={18} /></button>
                </div>
              );
              })}
              <div className="table-footer">
                {items.length > 9 ? (
                  <button className="expand-items" type="button" onClick={() => setExpanded((value) => !value)}>
                    {expanded ? "Show fewer items" : `Show ${items.length - 9} more items`}
                  </button>
                ) : <span />}
                <button className="add-item" type="button" onClick={addItem}><PlusIcon size={18} weight="bold" />Add item</button>
              </div>
            </div>

            <div className="reconciliation">
              <div><strong>{items.length}</strong><span>items</span></div>
              <div><span>Extracted total</span><strong>{money(calculatedTotal)}</strong></div>
              <div><span>Receipt total</span><strong>{money(receipt.receiptTotal)}</strong></div>
              <div className={canConfirm ? "status-matched" : "status-review"}>
                <span>Status</span>
                <strong>{canConfirm ? <CheckCircleIcon weight="duotone" /> : <WarningCircleIcon weight="duotone" />}{!complete ? "Missing details" : matched ? "Matched" : "Needs review"}</strong>
              </div>
            </div>

            {!canConfirm && confirmationBlockers.length > 0 && (
              <div className="confirmation-guidance" id="confirmation-blockers" role="status" aria-live="polite">
                <WarningCircleIcon size={23} weight="fill" />
                <div>
                  <strong>Before you can confirm</strong>
                  <ul>{confirmationBlockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul>
                </div>
              </div>
            )}

            <div className="review-actions">
              <button
                className="primary-button"
                type="button"
                disabled={!canConfirm || saved}
                aria-describedby={!canConfirm ? "confirmation-blockers" : undefined}
                onClick={() => setSaved(true)}
              >
                <CheckCircleIcon size={21} weight="bold" />{saved ? "Confirmed" : `Confirm ${items.length} items`}
              </button>
              <button className="secondary-button" type="button" onClick={reset}><CameraRotateIcon size={21} />Retake photo</button>
              <button className="text-button" type="button" onClick={() => setShowOriginal(true)} disabled={!previewUrl}>
                <ImageSquareIcon size={20} />View original image
              </button>
            </div>

            {saved && (
              <div className="success-banner" role="status">
                <CheckCircleIcon size={23} weight="fill" />
                <div><strong>Receipt ready for Supabase</strong><span>The spike stops before persistence; the normalized payload is valid.</span></div>
              </div>
            )}
          </section>
        )}
      </main>
      )}

      {showOriginal && previewUrl && (
        <div className="image-modal" role="dialog" aria-modal="true" aria-label="Original receipt image">
          <div className="modal-toolbar"><strong>Original receipt</strong><button type="button" onClick={() => setShowOriginal(false)} aria-label="Close original image"><XIcon /></button></div>
          <img src={previewUrl} alt="Original uploaded receipt" />
        </div>
      )}
    </div>
  );
}
