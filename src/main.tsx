import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./app/App";
import { ErrorBoundary } from "./app/ErrorBoundary";
import { logError, logInfo } from "./platform/logger";
import { migrateToTaskStore } from "./tasks/taskMigration";

window.addEventListener("error", (event) => {
  logError("Unhandled window error", event.error ?? event.message);
});

window.addEventListener("unhandledrejection", (event) => {
  logError("Unhandled promise rejection", event.reason);
});

logInfo("Frontend initialized");
void migrateToTaskStore().catch((error) => {
  logError("Task migration failed", error);
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
