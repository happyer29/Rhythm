import { useEffect, useId, useRef } from "react";

const english = (en) => en;

// Keep the callback current without making a parent's inline function an effect
// dependency. This reports form state without creating parent/child render loops.
export function useDraftDirty(dirty, onDirtyChange) {
  const callback = useRef(onDirtyChange);
  callback.current = onDirtyChange;
  useEffect(() => {
    callback.current?.(dirty);
  }, [dirty]);
  useEffect(
    () => () => {
      callback.current?.(false);
    },
    [],
  );
}

/**
 * Native modal dialogs keep keyboard focus inside the dialog and make the
 * background inert. The caller decides whether closing may discard a draft.
 */
export default function Modal({
  title,
  subtitle,
  children,
  onClose,
  wide = false,
  flush = false,
  busy = false,
  t = english,
}) {
  const dialogRef = useRef(null);
  const titleId = useId();
  const subtitleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement;
    if (!dialog.open) dialog.showModal();
    return () => {
      dialog.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected)
        previousFocus.focus();
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className={`rf-modal${wide ? " rf-modal-wide" : ""}`}
      aria-labelledby={titleId}
      aria-describedby={subtitle ? subtitleId : undefined}
      aria-busy={busy}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="rf-modal-heading">
        <div>
          <h2 id={titleId}>{title}</h2>
          {subtitle && <p id={subtitleId}>{subtitle}</p>}
        </div>
        <button
          className="rf-icon-button"
          type="button"
          disabled={busy}
          onClick={onClose}
          aria-label={t("Close dialog", "关闭对话框")}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            aria-hidden="true"
          >
            <path d="m6 6 12 12M18 6 6 18" />
          </svg>
        </button>
      </div>
      <div className={`rf-modal-body${flush ? " rf-modal-body-flush" : ""}`}>
        {children}
      </div>
    </dialog>
  );
}
