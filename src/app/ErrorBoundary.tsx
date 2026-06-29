import { Component, type ErrorInfo, type ReactNode } from "react";
import { logError } from "../platform/logger";
import { APP_VERSION } from "../platform/appVersion";

type ErrorBoundaryProps = {
  children: ReactNode;
};

type ErrorBoundaryState = {
  error: Error | null;
};

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    logError("React render error", { error, componentStack: info.componentStack });
  }

  private handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.error) {
      return (
        <div className="app-error-boundary" role="alert">
          <strong>Ari столкнулась с ошибкой</strong>
          <p>{this.state.error.message}</p>
          <p className="app-error-version">v{APP_VERSION}</p>
          <button type="button" onClick={this.handleReload}>
            Перезагрузить
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
