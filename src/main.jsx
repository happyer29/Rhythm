import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import { ConfirmationProvider } from "./components/Confirmation.jsx";
import "./styles.css";
import "./components/forms.css";

class ErrorBoundary extends React.Component {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  render() {
    if (this.state.error)
      return (
        <main className="crash-screen">
          <h1>Something interrupted your journal.</h1>
          <p>
            Your saved records are still in your account. Keep this tab open if
            you have an unsaved draft.
          </p>
          <button
            onClick={() => {
              const json = window.rhythmJournalExport?.();
              if (json)
                window.rhythmBrowser.download("rhythm-recovery.json", json);
            }}
          >
            Export current draft
          </button>
          <button onClick={() => window.location.reload()}>
            Reload saved journal
          </button>
        </main>
      );
    return this.props.children;
  }
}

createRoot(document.getElementById("root")).render(
  <ErrorBoundary>
    <ConfirmationProvider>
      <App />
    </ConfirmationProvider>
  </ErrorBoundary>,
);
