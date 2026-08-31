import { TrashIcon, WarningCircleIcon, XIcon } from "@phosphor-icons/react";
import { useEffect, useId } from "react";

type DeleteConfirmationDialogProps = {
  title: string;
  subject: string;
  consequence: string;
  confirmLabel: string;
  busy: boolean;
  error?: string;
  onCancel: () => void;
  onConfirm: () => void;
};

export function DeleteConfirmationDialog({
  title,
  subject,
  consequence,
  confirmLabel,
  busy,
  error = "",
  onCancel,
  onConfirm,
}: DeleteConfirmationDialogProps) {
  const titleId = useId();

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [busy, onCancel]);

  return (
    <div className="card-modal-backdrop delete-modal-backdrop">
      <div className="card-modal delete-modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="card-modal-header">
          <div><span>Permanent deletion</span><h3 id={titleId}>{title}</h3></div>
          <button type="button" disabled={busy} aria-label="Close deletion confirmation" onClick={onCancel}><XIcon /></button>
        </div>
        <div className="delete-subject"><TrashIcon size={24} weight="duotone" /><strong title={subject}>{subject}</strong></div>
        <div className="delete-warning"><WarningCircleIcon size={21} weight="fill" /><span>{consequence}</span></div>
        {error && <div className="delete-error" role="alert">{error}</div>}
        <div className="delete-actions">
          <button className="secondary-button" type="button" autoFocus disabled={busy} onClick={onCancel}>Keep data</button>
          <button className="danger-button" type="button" disabled={busy} onClick={onConfirm}><TrashIcon weight="bold" />{busy ? "Deleting…" : confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
