// React error boundary. Catches render-time errors in child components
// and displays an ErrorState with retry. Class component required —
// error boundaries cannot be written as function components.

'use client';

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { ErrorState } from './ErrorState';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, info: ErrorInfo) => void;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.props.onError?.(error, info);
  }

  handleRetry = () => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <ErrorState
          title="Something went wrong"
          message={this.state.error.message || 'An unexpected error occurred.'}
          digest={'digest' in this.state.error ? String(this.state.error.digest) : undefined}
          onRetry={this.handleRetry}
        />
      );
    }
    return this.props.children;
  }
}
