import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";
import Modal from "./Modal.jsx";
import { createConfirmationController } from "../confirmation.js";

const ConfirmationContext = createContext(() => Promise.resolve(false));
const english = (en) => en;

export function useConfirm() {
  return useContext(ConfirmationContext);
}

function ConfirmationDialog({ request, settle }) {
  const cancel = useRef(null);
  const t = request.t ?? english;
  useEffect(() => {
    // Modal has entered the top layer before this parent effect runs.
    cancel.current?.focus();
  }, []);
  return (
    <Modal
      title={request.title ?? t("Are you sure?", "确定继续？")}
      onClose={() => settle(request.id, false)}
      t={t}
    >
      {request.message && <p className="muted">{request.message}</p>}
      <div className="rf-form-actions">
        <button
          ref={cancel}
          autoFocus
          type="button"
          className="rf-button rf-button-quiet"
          onClick={() => settle(request.id, false)}
        >
          {request.cancelLabel ?? t("Cancel", "取消")}
        </button>
        <button
          type="button"
          className="rf-button rf-button-primary"
          style={
            request.danger
              ? { background: "#b7483c", color: "#fff" }
              : undefined
          }
          onClick={() => settle(request.id, true)}
        >
          {request.confirmLabel ?? t("Continue", "继续")}
        </button>
      </div>
    </Modal>
  );
}

export function ConfirmationProvider({ children }) {
  const controller = useMemo(createConfirmationController, []);
  const request = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  useEffect(() => {
    controller.activate();
    return () => controller.dispose();
  }, [controller]);
  return (
    <ConfirmationContext.Provider value={controller.request}>
      {children}
      {request && (
        <ConfirmationDialog
          key={request.id}
          request={request}
          settle={controller.settle}
        />
      )}
    </ConfirmationContext.Provider>
  );
}
