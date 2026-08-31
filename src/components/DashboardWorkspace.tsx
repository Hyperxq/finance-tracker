import {
  ChartBarIcon,
  ChartLineUpIcon,
  DownloadSimpleIcon,
  MagnifyingGlassIcon,
  ReceiptIcon,
  StorefrontIcon,
  TrashIcon,
  XIcon,
} from "@phosphor-icons/react";
import { Fragment, useEffect, useMemo, useState } from "react";
import { appPath } from "../lib/app-routes";
import {
  buildReceiptAnalytics,
  receiptDateRange,
  type ReceiptGrouping,
  type ReceiptPeriod,
} from "../lib/receipt-analytics";
import type { FinanceStore, ReceiptData } from "../lib/finance-store";
import { downloadReceiptCsv } from "../lib/receipt-csv";
import { DeleteConfirmationDialog } from "./DeleteConfirmationDialog";

type DashboardWorkspaceProps = {
  store?: Pick<FinanceStore, "loadReceiptData" | "deleteReceipt">;
  today?: string;
  exportCsv?: (data: ReceiptData, filename: string) => void;
};

const emptyData: ReceiptData = { receipts: [], items: [] };
const money = (value: number) => `NZ$${value.toFixed(2)}`;
const productColors = ["#a78bfa", "#f0abfc", "#7dd3fc"];
const receiptDate = (purchasedAt: string) => new Intl.DateTimeFormat("en-NZ", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
}).format(new Date(`${purchasedAt.slice(0, 10)}T12:00:00Z`));

function todayInNewZealand() {
  const parts = new Intl.DateTimeFormat("en-NZ", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Pacific/Auckland",
  }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((value) => value.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function shiftDate(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function PriceChart({
  points,
  products,
}: {
  points: Array<{ key: string; label: string; values: Record<string, number> }>;
  products: Array<{ key: string; label: string }>;
}) {
  const values = points.flatMap((point) => products.flatMap((product) => point.values[product.key] ?? []));
  if (!values.length) {
    return <div className="dashboard-chart-empty">No price history is available for these products in this period.</div>;
  }

  const width = 720;
  const height = 250;
  const inset = { top: 24, right: 18, bottom: 38, left: 54 };
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const spread = Math.max(maximum - minimum, maximum * 0.08, 1);
  const x = (index: number) => points.length === 1
    ? width / 2
    : inset.left + index * ((width - inset.left - inset.right) / (points.length - 1));
  const y = (value: number) => inset.top + ((maximum + spread * 0.12 - value) / (spread * 1.24)) * (height - inset.top - inset.bottom);

  return (
    <div className="price-chart-scroll">
      <svg className="price-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Selected product price history">
        {[0, 1, 2, 3].map((line) => {
          const lineY = inset.top + line * ((height - inset.top - inset.bottom) / 3);
          return <line key={line} x1={inset.left} x2={width - inset.right} y1={lineY} y2={lineY} className="price-grid-line" />;
        })}
        {products.map((product, productIndex) => {
          const productPoints = points.flatMap((point, index) => point.values[product.key] === undefined
            ? []
            : [{ x: x(index), y: y(point.values[product.key]), value: point.values[product.key], label: point.label }]);
          return (
            <Fragment key={product.key}>
              {productPoints.length > 1 && (
                <polyline
                  points={productPoints.map((point) => `${point.x},${point.y}`).join(" ")}
                  fill="none"
                  stroke={productColors[productIndex]}
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}
              {productPoints.map((point) => (
                <circle key={`${product.key}-${point.label}`} cx={point.x} cy={point.y} r="5" fill={productColors[productIndex]}>
                  <title>{`${product.label}, ${point.label}: ${money(point.value)}`}</title>
                </circle>
              ))}
            </Fragment>
          );
        })}
        {points.map((point, index) => (
          <text key={point.key} x={x(index)} y={height - 12} textAnchor="middle" className="price-axis-label">{point.label}</text>
        ))}
      </svg>
    </div>
  );
}

export function DashboardWorkspace({ store, today = todayInNewZealand(), exportCsv = downloadReceiptCsv }: DashboardWorkspaceProps) {
  const [data, setData] = useState<ReceiptData>(emptyData);
  const [loading, setLoading] = useState(Boolean(store));
  const [error, setError] = useState("");
  const [period, setPeriod] = useState<ReceiptPeriod | "custom">("year");
  const [groupBy, setGroupBy] = useState<ReceiptGrouping>("month");
  const yearRange = receiptDateRange("year", today);
  const [customStart, setCustomStart] = useState(yearRange.start);
  const [customEnd, setCustomEnd] = useState(today);
  const [productSearch, setProductSearch] = useState("");
  const [selectedProducts, setSelectedProducts] = useState<string[]>([]);
  const [receiptToDelete, setReceiptToDelete] = useState<ReceiptData["receipts"][number] | null>(null);
  const [isDeletingReceipt, setIsDeletingReceipt] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [deleteNotice, setDeleteNotice] = useState("");

  useEffect(() => {
    if (!store) return;
    let active = true;
    setLoading(true);
    setError("");
    store.loadReceiptData()
      .then((result) => {
        if (active) setData(result);
      })
      .catch(() => {
        if (active) setError("Receipt insights could not be loaded. Check your connection and try again.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [store]);

  const range = period === "custom" ? { start: customStart, end: customEnd } : receiptDateRange(period, today);
  const analytics = useMemo(() => buildReceiptAnalytics(data, {
    ...range,
    groupBy,
    selectedProducts,
  }), [customEnd, customStart, data, groupBy, period, range.end, range.start, selectedProducts, today]);
  const currentWeek = useMemo(() => buildReceiptAnalytics(data, {
    ...receiptDateRange("week", today),
    groupBy: "week",
    selectedProducts: [],
  }), [data, today]);
  const previousWeek = useMemo(() => buildReceiptAnalytics(data, {
    ...receiptDateRange("week", shiftDate(today, -7)),
    groupBy: "week",
    selectedProducts: [],
  }), [data, today]);

  useEffect(() => {
    if (!selectedProducts.length && analytics.products.length) {
      setSelectedProducts([analytics.products[0].key]);
    }
  }, [analytics.products, selectedProducts.length]);

  const productOptions = analytics.products.filter((product) => product.label.toLowerCase().includes(productSearch.trim().toLowerCase())).slice(0, 8);
  const selectedProductDetails = selectedProducts.flatMap((key) => {
    const product = analytics.products.find((candidate) => candidate.key === key);
    return product ? [product] : [];
  });
  const largestSpend = Math.max(...analytics.spend.map((bucket) => bucket.total), 1);
  const largestProductSpend = Math.max(...analytics.products.map((product) => product.spend), 1);
  const weeklyDifference = previousWeek.total > 0
    ? Math.round(((currentWeek.total - previousWeek.total) / previousWeek.total) * 100)
    : null;
  const rangeIsInvalid = customStart > customEnd;
  const receiptDeleteItemCount = receiptToDelete
    ? data.items.filter((item) => item.receiptId === receiptToDelete.id).length
    : 0;

  const choosePeriod = (nextPeriod: ReceiptPeriod | "custom") => {
    setPeriod(nextPeriod);
    if (nextPeriod === "year") setGroupBy("month");
    if (nextPeriod === "week" || nextPeriod === "month") setGroupBy("week");
  };
  const toggleProduct = (key: string) => {
    setSelectedProducts((current) => {
      if (current.includes(key)) return current.length === 1 ? current : current.filter((product) => product !== key);
      return current.length < 3 ? [...current, key] : current;
    });
  };
  const deleteReceipt = async () => {
    if (!receiptToDelete || isDeletingReceipt) return;
    setIsDeletingReceipt(true);
    setDeleteError("");
    try {
      await store?.deleteReceipt(receiptToDelete.id);
      setData((current) => ({
        receipts: current.receipts.filter((receipt) => receipt.id !== receiptToDelete.id),
        items: current.items.filter((item) => item.receiptId !== receiptToDelete.id),
      }));
      setReceiptToDelete(null);
      setDeleteNotice("Receipt deleted. Your grocery insights are up to date.");
    } catch {
      setDeleteError("The receipt could not be deleted. Check your connection and try again.");
    } finally {
      setIsDeletingReceipt(false);
    }
  };

  return (
    <section className="dashboard-view">
      <header className="dashboard-header">
        <div className="dashboard-hero-copy">
          <p><span>Receipt dashboard</span><i>/</i>{period === "year" ? "This year" : "Selected period"}</p>
          <h1>Your grocery<br />rhythm</h1>
          <h2>See the weekly shop, compare monthly totals, and follow the products that quietly change price.</h2>
          <button
            className="secondary-button dashboard-export"
            type="button"
            disabled={loading || !data.items.length}
            onClick={() => exportCsv(data, `night-ledger-receipts-${today}.csv`)}
          >
            <DownloadSimpleIcon size={19} />
            Export all receipts CSV
          </button>
        </div>
        <div className="dashboard-filters" aria-label="Receipt dashboard filters">
          <div className="dashboard-filter-group">
            <span>Period</span>
            <div className="dashboard-segments period-segments">
              {(["week", "month", "year", "custom"] as const).map((value) => (
                <button key={value} type="button" aria-pressed={period === value} onClick={() => choosePeriod(value)}>
                  {value === "week" ? "This week" : value === "month" ? "This month" : value === "year" ? "This year" : "Custom"}
                </button>
              ))}
            </div>
          </div>
          <div className="dashboard-filter-group">
            <span>Group by</span>
            <div className="dashboard-segments">
              {(["week", "month"] as const).map((value) => (
                <button key={value} type="button" aria-pressed={groupBy === value} onClick={() => setGroupBy(value)}>
                  {value === "week" ? "Week" : "Month"}
                </button>
              ))}
            </div>
          </div>
          {period === "custom" && (
            <div className="dashboard-date-range">
              <label><span>From</span><input type="date" value={customStart} onChange={(event) => setCustomStart(event.target.value)} /></label>
              <label><span>To</span><input type="date" value={customEnd} onChange={(event) => setCustomEnd(event.target.value)} /></label>
              {rangeIsInvalid && <small>Choose an end date after the start date.</small>}
            </div>
          )}
        </div>
      </header>

      {error && <div className="dashboard-error" role="alert">{error}</div>}
      {deleteNotice && <div className="dashboard-delete-notice" role="status">{deleteNotice}</div>}
      {loading ? (
        <div className="dashboard-loading" aria-live="polite">Loading confirmed receipts…</div>
      ) : !data.receipts.length ? (
        <div className="dashboard-empty">
          <ReceiptIcon size={34} weight="duotone" />
          <strong>No confirmed receipts yet</strong>
          <span>Your weekly rhythm will appear after you review and confirm a receipt.</span>
          <a className="primary-button" href={appPath("/receipts")}>Add your first receipt</a>
        </div>
      ) : (
        <>
          <section className="dashboard-metrics" aria-label="Receipt summary">
            <article className="dashboard-metric dashboard-metric-primary">
              <span>This week</span>
              <strong>{money(currentWeek.total)}</strong>
              <small>{weeklyDifference === null ? "No previous week yet" : `${weeklyDifference >= 0 ? "+" : ""}${weeklyDifference}% from last week`}</small>
            </article>
            <article className="dashboard-metric">
              <span>Selected period</span>
              <strong>{money(analytics.total)}</strong>
              <small>{analytics.receiptCount} {analytics.receiptCount === 1 ? "shop" : "shops"}</small>
            </article>
            <article className="dashboard-metric">
              <span>Average basket</span>
              <strong>{money(analytics.averageBasket)}</strong>
              <small>Across confirmed receipts</small>
            </article>
            <article className="dashboard-metric">
              <span>Most regular</span>
              <strong title={analytics.products[0]?.label}>{analytics.products[0]?.label ?? "—"}</strong>
              <small>{analytics.products[0]?.purchaseWeeks ?? 0} weeks</small>
            </article>
          </section>

          <div className="dashboard-grid">
            <section className="dashboard-card spend-cadence-card" aria-labelledby="spend-cadence-title">
              <div className="dashboard-card-heading">
                <div><span>Household cadence</span><h3 id="spend-cadence-title">What each shop cost</h3></div>
                <ChartBarIcon size={27} weight="duotone" />
              </div>
              {analytics.spend.length ? (
                <ol className="receipt-spend-bars">
                  {analytics.spend.map((bucket) => (
                    <li key={bucket.key}>
                      <strong>{money(bucket.total)}</strong>
                      <span><i style={{ height: `${Math.max(8, (bucket.total / largestSpend) * 100)}%` }} /></span>
                      <small>{bucket.label}</small>
                    </li>
                  ))}
                </ol>
              ) : <div className="dashboard-chart-empty">No shops fall inside this period.</div>}
            </section>

            <section className="dashboard-card frequent-products-card" aria-labelledby="frequent-products-title">
              <div className="dashboard-card-heading">
                <div><span>Weekly staples</span><h3 id="frequent-products-title">Bought most often</h3></div>
                <StorefrontIcon size={27} weight="duotone" />
              </div>
              <ol className="frequent-products">
                {analytics.products.slice(0, 6).map((product) => (
                  <li key={product.key}>
                    <div><strong title={product.label}>{product.label}</strong><span>{product.purchaseWeeks} weeks</span></div>
                    <span className="bar-track"><i style={{ width: `${(product.spend / largestProductSpend) * 100}%` }} /></span>
                    <small>{money(product.spend)} · {product.quantity} purchased</small>
                  </li>
                ))}
              </ol>
            </section>
          </div>

          <section className="dashboard-card price-history-card" aria-labelledby="price-history-title">
            <div className="dashboard-card-heading price-heading">
              <div><span>Product watch</span><h3 id="price-history-title">How prices are moving</h3></div>
              <ChartLineUpIcon size={27} weight="duotone" />
            </div>
            <div className="product-picker">
              <label>
                <span><MagnifyingGlassIcon size={18} />Search products</span>
                <input role="searchbox" aria-label="Search products" value={productSearch} onChange={(event) => setProductSearch(event.target.value)} placeholder="Milk, bread, beef…" />
              </label>
              <div className="product-options" aria-label="Available products">
                {productOptions.map((product) => (
                  <label key={product.key}>
                    <input
                      type="checkbox"
                      aria-label={product.label}
                      checked={selectedProducts.includes(product.key)}
                      disabled={!selectedProducts.includes(product.key) && selectedProducts.length >= 3}
                      onChange={() => toggleProduct(product.key)}
                    />
                    <span>{product.label}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="selected-products" aria-label="Selected products">
              {selectedProductDetails.map((product, index) => (
                <button className="product-chip" key={product.key} type="button" onClick={() => toggleProduct(product.key)}>
                  <i style={{ background: productColors[index] }} /><span>{product.label}</span><XIcon size={13} />
                </button>
              ))}
              <small>Compare up to three products.</small>
            </div>
            <PriceChart points={analytics.prices} products={selectedProductDetails} />
            <div className="price-legend">
              {selectedProductDetails.map((product, index) => <span key={product.key}><i style={{ background: productColors[index] }} />{product.label}</span>)}
            </div>
          </section>

          <section className="dashboard-card receipt-history-card" aria-label="Receipt history">
            <div className="dashboard-card-heading">
              <div><span>Confirmed data</span><h3>Receipt history</h3></div>
              <ReceiptIcon size={27} weight="duotone" />
            </div>
            <div className="receipt-history-list">
              {data.receipts.slice().sort((left, right) => right.purchasedAt.localeCompare(left.purchasedAt)).map((receipt) => (
                <article key={receipt.id}>
                  <div>
                    <strong title={receipt.merchant}>{receipt.merchant}</strong>
                    <span>{receiptDate(receipt.purchasedAt)} · {data.items.filter((item) => item.receiptId === receipt.id).length} items</span>
                  </div>
                  <strong>{money(receipt.total)}</strong>
                  <button type="button" aria-label={`Delete ${receipt.merchant} receipt from ${receiptDate(receipt.purchasedAt)}`} onClick={() => { setDeleteError(""); setDeleteNotice(""); setReceiptToDelete(receipt); }}><TrashIcon size={18} /></button>
                </article>
              ))}
            </div>
          </section>
        </>
      )}
      {receiptToDelete && (
        <DeleteConfirmationDialog
          title="Delete receipt?"
          subject={`${receiptToDelete.merchant} · ${receiptDate(receiptToDelete.purchasedAt)} · ${money(receiptToDelete.total)}`}
          consequence={`${receiptDeleteItemCount} ${receiptDeleteItemCount === 1 ? "extracted item" : "extracted items"} will be permanently deleted.`}
          confirmLabel="Delete receipt"
          busy={isDeletingReceipt}
          error={deleteError}
          onCancel={() => { setReceiptToDelete(null); setDeleteError(""); }}
          onConfirm={() => void deleteReceipt()}
        />
      )}
    </section>
  );
}
