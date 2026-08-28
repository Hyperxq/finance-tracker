import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReceiptWorkspace } from "./ReceiptWorkspace";

const OCR_TEXT = `
Rec# 0201288681 Date 12/03/2023 21:18:50
TAYLOR FARMS SLAH (WD 1 @ $5.99 EA = $5.99
BERRY FIX FROZEN MIXE 1 @ $14.39 EA = $14.39
Total including GST $20.38
PAK N SAVE RICCARTON
`;

const PARTIAL_OCR_TEXT = `
PAKNhSAVE
ANCHOR COYTAGE CHEESE ORIGINAL 5000 $12.50
1 BALANCE DUE $12.50
`;

const REPORTED_MISMATCH_OCR_TEXT = `
Rec# 2100077823 Date 05/01/1991 10:01:32
MED SLICED 1 @ $28.85 EA = $28.85
Total including GST $50.45
PAK N SAVE ROYAL OAK
`;

describe("ReceiptWorkspace", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/");
    Reflect.deleteProperty(document, "startViewTransition");
  });

  it("uses a view transition to keep receipt and bank navigation continuous", async () => {
    const user = userEvent.setup();
    const startViewTransition = vi.fn((update: () => void) => {
      update();
      expect(screen.getByRole("heading", { name: /see where the month went/i })).toBeInTheDocument();
      return { finished: Promise.resolve() };
    });
    Object.defineProperty(document, "startViewTransition", { configurable: true, value: startViewTransition });
    render(<ReceiptWorkspace />);

    await user.click(screen.getByRole("link", { name: /bank spending/i }));

    expect(startViewTransition).toHaveBeenCalledOnce();
    expect(window.location.pathname).toBe("/bank");
    expect(screen.getByRole("heading", { name: /see where the month went/i })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /turn a receipt into clean data/i })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /bank spending/i })).toHaveAttribute("aria-current", "page");
  });

  it("falls back to immediate navigation when view transitions are unavailable", async () => {
    const user = userEvent.setup();
    render(<ReceiptWorkspace />);

    await user.click(screen.getByRole("link", { name: /bank spending/i }));

    expect(window.location.pathname).toBe("/bank");
    expect(screen.getByRole("heading", { name: /see where the month went/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /bank spending/i })).toHaveAttribute("aria-current", "page");
  });

  it("transitions back and forward when the URL path changes", async () => {
    const startViewTransition = vi.fn((update: () => void) => {
      update();
      return { finished: Promise.resolve() };
    });
    Object.defineProperty(document, "startViewTransition", { configurable: true, value: startViewTransition });
    render(<ReceiptWorkspace />);

    window.history.replaceState(null, "", "/bank");
    window.dispatchEvent(new PopStateEvent("popstate"));

    expect(await screen.findByRole("heading", { name: /see where the month went/i })).toBeInTheDocument();

    window.history.replaceState(null, "", "/receipts");
    window.dispatchEvent(new PopStateEvent("popstate"));

    expect(await screen.findByRole("heading", { name: /turn a receipt into clean data/i })).toBeInTheDocument();
    expect(startViewTransition).toHaveBeenCalledTimes(2);
  });

  it("hydrates a bank URL from the receipt shell before synchronizing without a transition", async () => {
    window.history.replaceState(null, "", "/bank");
    const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
    Reflect.deleteProperty(globalThis, "window");
    let serverMarkup = "";
    try {
      serverMarkup = renderToString(<ReceiptWorkspace />);
    } finally {
      if (windowDescriptor) Object.defineProperty(globalThis, "window", windowDescriptor);
    }

    const startViewTransition = vi.fn((update: () => void) => {
      update();
      return { finished: Promise.resolve() };
    });
    Object.defineProperty(document, "startViewTransition", { configurable: true, value: startViewTransition });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const container = document.createElement("div");
    container.innerHTML = serverMarkup;
    document.body.append(container);

    const root = hydrateRoot(container, <ReceiptWorkspace />);
    await waitFor(() => expect(screen.getByRole("heading", { name: /see where the month went/i })).toBeInTheDocument());

    expect(consoleError).not.toHaveBeenCalled();
    expect(startViewTransition).not.toHaveBeenCalled();

    act(() => root.unmount());
    container.remove();
    consoleError.mockRestore();
  });

  it("starts with a private local photo upload", () => {
    render(<ReceiptWorkspace />);

    expect(screen.getByText("Daniel & Andrea")).toBeInTheDocument();
    expect(screen.getByText("Household workspace")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /turn a receipt into clean data/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/choose receipt photo/i)).toBeInTheDocument();
    expect(screen.getByText(/stays on this device/i)).toBeInTheDocument();
  });

  it("shows an editable reconciled review after OCR completes", async () => {
    const user = userEvent.setup();
    const recognize = vi.fn().mockResolvedValue({ text: OCR_TEXT, confidence: 96 });
    render(<ReceiptWorkspace recognize={recognize} />);

    const image = new File(["receipt"], "receipt.png", { type: "image/png" });
    await user.upload(screen.getByLabelText(/choose receipt photo/i), image);

    expect(await screen.findByRole("heading", { name: /review receipt/i })).toBeInTheDocument();
    expect(screen.getByText("PAK’nSAVE Riccarton")).toBeInTheDocument();
    expect(screen.getByLabelText("Merchant")).toHaveValue("PAK N SAVE RICCARTON");
    expect(screen.getByLabelText("Receipt number")).toHaveValue("0201288681");
    expect(screen.getByLabelText("Purchase date")).toHaveValue("2023-03-12");
    expect(screen.getByLabelText("Purchase time")).toHaveValue("21:18");
    expect(screen.getByLabelText("Printed total")).toHaveValue(20.38);
    expect(screen.getByDisplayValue("TAYLOR FARMS SLAH (WD")).toBeInTheDocument();
    expect(screen.getByLabelText("Unit price for TAYLOR FARMS SLAH (WD")).toHaveValue(5.99);
    expect(screen.getByRole("button", { name: "Remove TAYLOR FARMS SLAH (WD" })).toBeEnabled();
    expect(screen.getByText("Matched")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /confirm 2 items/i })).toBeEnabled();

    await user.clear(screen.getByLabelText("Merchant"));
    await user.type(screen.getByLabelText("Merchant"), "Woolworths Riccarton");
    expect(screen.getByLabelText("Merchant")).toHaveValue("Woolworths Riccarton");
  });

  it("marks even a one-cent edit as mismatched until the totals agree", async () => {
    const user = userEvent.setup();
    const recognize = vi.fn().mockResolvedValue({ text: OCR_TEXT, confidence: 96 });
    render(<ReceiptWorkspace recognize={recognize} />);

    await user.upload(
      screen.getByLabelText(/choose receipt photo/i),
      new File(["receipt"], "receipt.png", { type: "image/png" }),
    );

    const amount = await screen.findByLabelText("Amount for TAYLOR FARMS SLAH (WD");
    await user.clear(amount);
    await user.type(amount, "5.98");

    await waitFor(() => expect(screen.getByText("Needs review")).toBeInTheDocument());
    expect(screen.getByRole("status")).toHaveTextContent("Before you can confirm");
    expect(screen.getByRole("status")).toHaveTextContent("NZ$0.01 below the receipt total");
    expect(screen.getByRole("status")).toHaveTextContent("Check for missing or misread items");
    expect(screen.getByRole("button", { name: /confirm 2 items/i })).toHaveAttribute("aria-describedby", "confirmation-blockers");

    await user.clear(amount);
    await user.type(amount, "5.99");

    await waitFor(() => expect(screen.queryByText("Before you can confirm")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: /confirm 2 items/i })).toBeEnabled();
  });

  it("explains the exact total difference reported by the reviewer", async () => {
    const user = userEvent.setup();
    const recognize = vi.fn().mockResolvedValue({ text: REPORTED_MISMATCH_OCR_TEXT, confidence: 75 });
    render(<ReceiptWorkspace recognize={recognize} />);

    await user.upload(
      screen.getByLabelText(/choose receipt photo/i),
      new File(["receipt"], "receipt.png", { type: "image/png" }),
    );

    expect(await screen.findByRole("status")).toHaveTextContent("NZ$21.60 below the receipt total");
    expect(screen.getByRole("button", { name: /confirm 1 item/i })).toBeDisabled();
  });

  it("lets the reviewer add and remove extracted rows", async () => {
    const user = userEvent.setup();
    const recognize = vi.fn().mockResolvedValue({ text: OCR_TEXT, confidence: 96 });
    render(<ReceiptWorkspace recognize={recognize} />);

    await user.upload(
      screen.getByLabelText(/choose receipt photo/i),
      new File(["receipt"], "receipt.png", { type: "image/png" }),
    );

    await user.click(await screen.findByRole("button", { name: /add item/i }));
    expect(screen.getByRole("button", { name: /confirm 3 items/i })).toBeDisabled();
    expect(screen.getByLabelText("Item 3")).toHaveValue("");
    expect(screen.getByRole("status")).toHaveTextContent("Complete 1 item with a name, quantity, unit price, and line total");

    await user.click(screen.getByRole("button", { name: "Remove item 3" }));
    expect(screen.getByRole("button", { name: /confirm 2 items/i })).toBeEnabled();
  });

  it("opens partial OCR for correction without rendering an invalid date", async () => {
    const user = userEvent.setup();
    const recognize = vi.fn().mockResolvedValue({ text: PARTIAL_OCR_TEXT, confidence: 55 });
    render(<ReceiptWorkspace recognize={recognize} />);

    await user.upload(
      screen.getByLabelText(/choose receipt photo/i),
      new File(["receipt"], "receipt.png", { type: "image/png" }),
    );

    expect(await screen.findByRole("heading", { name: /review receipt/i })).toBeInTheDocument();
    expect(screen.getByText(/Date needs review/)).toBeInTheDocument();
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
    expect(screen.getByText("Missing details")).toBeInTheDocument();
  });
});
