// Comprehensive tests for GlobalStateProvider (Part 3)

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { GlobalStateProvider } from "../GlobalStateProvider";

// Avoid 'it " syntax - use it(" instead

describe("GlobalStateProvider", () => {
  const mockChildren = vi.fn(() => <div>Content</div>);

  beforeEach(() => {
    mockChildren.mockClear();
  });

  it("renders loading state when status is loading", () => {
    render(
      <GlobalStateProvider status="loading">
        {mockChildren}
      </GlobalStateProvider>,
    );

    // Should show skeleton
    expect(document.querySelector(".skeleton-shimmer")).toBeInTheDocument();
    expect(mockChildren).not.toHaveBeenCalled();
  });

  it("renders loading state when status is idle", () => {
    render(
      <GlobalStateProvider status="idle">{mockChildren}</GlobalStateProvider>,
    );

    expect(document.querySelector(".skeleton-shimmer")).toBeInTheDocument();
    expect(mockChildren).not.toHaveBeenCalled();
  });

  it("renders error state with error message", () => {
    const error = new Error("Network failure");

    render(
      <GlobalStateProvider status="error" error={error}>
        {mockChildren}
      </GlobalStateProvider>,
    );

    expect(screen.getByText("Failed to load")).toBeInTheDocument();
    expect(screen.getByText("Network failure")).toBeInTheDocument();
    expect(mockChildren).not.toHaveBeenCalled();
  });

  it("renders custom error title", () => {
    render(
      <GlobalStateProvider
        status="error"
        error={new Error("Error")}
        errorTitle="Custom Error Title"
      >
        {mockChildren}
      </GlobalStateProvider>,
    );

    expect(screen.getByText("Custom Error Title")).toBeInTheDocument();
  });

  it("renders retry button when onRetry is provided", () => {
    const handleRetry = vi.fn();

    render(
      <GlobalStateProvider
        status="error"
        error={new Error("Error")}
        onRetry={handleRetry}
      >
        {mockChildren}
      </GlobalStateProvider>,
    );

    const retryButton = screen.getByText("Try again");
    expect(retryButton).toBeInTheDocument();
  });

  it("renders empty state when success but isEmpty is true", () => {
    render(
      <GlobalStateProvider
        status="success"
        isEmpty={true}
        emptyTitle="No results"
      >
        {mockChildren}
      </GlobalStateProvider>,
    );

    expect(screen.getByText("No results")).toBeInTheDocument();
    expect(mockChildren).not.toHaveBeenCalled();
  });

  it("renders custom empty description", () => {
    render(
      <GlobalStateProvider
        status="success"
        isEmpty={true}
        emptyTitle="Empty"
        emptyDescription="Try adjusting your filters"
      >
        {mockChildren}
      </GlobalStateProvider>,
    );

    expect(screen.getByText("Try adjusting your filters")).toBeInTheDocument();
  });

  it("renders empty action when provided", () => {
    render(
      <GlobalStateProvider
        status="success"
        isEmpty={true}
        emptyAction={<button>Clear filters</button>}
      >
        {mockChildren}
      </GlobalStateProvider>,
    );

    expect(screen.getByText("Clear filters")).toBeInTheDocument();
  });

  it("renders children when status is success and not empty", () => {
    render(
      <GlobalStateProvider status="success" isEmpty={false}>
        {mockChildren}
      </GlobalStateProvider>,
    );

    expect(mockChildren).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Content")).toBeInTheDocument();
  });

  it("uses custom loading configuration", () => {
    const { container } = render(
      <GlobalStateProvider
        status="loading"
        loadingLines={10}
        loadingAvatar={true}
        loadingTitle={true}
      >
        {mockChildren}
      </GlobalStateProvider>,
    );

    // Should render more skeleton lines
    const skeletons = container.querySelectorAll(".skeleton-shimmer");
    expect(skeletons.length).toBeGreaterThan(5);
  });

  it("defaults isEmpty to false", () => {
    render(
      <GlobalStateProvider status="success">
        {mockChildren}
      </GlobalStateProvider>,
    );

    expect(mockChildren).toHaveBeenCalled();
    expect(screen.getByText("Content")).toBeInTheDocument();
  });

  it("renders error digest when provided", () => {
    const error = new Error("Test error");
    error.name = "ValidationError";

    render(
      <GlobalStateProvider status="error" error={error}>
        {mockChildren}
      </GlobalStateProvider>,
    );

    expect(screen.getByText("ValidationError")).toBeInTheDocument();
  });

  it("handles null error gracefully", () => {
    render(
      <GlobalStateProvider status="error" error={null}>
        {mockChildren}
      </GlobalStateProvider>,
    );

    expect(screen.getByText("Failed to load")).toBeInTheDocument();
  });

  it("renders loading with custom avatar and title", () => {
    const { container } = render(
      <GlobalStateProvider
        status="loading"
        loadingLines={8}
        loadingAvatar={true}
        loadingTitle={true}
      >
        {mockChildren}
      </GlobalStateProvider>,
    );

    // Should have avatar and title skeletons
    const hasAvatar = container.querySelector('[data-test="skeleton-avatar"]');
    const hasTitle = container.querySelector('[data-test="skeleton-title"]');
    expect(hasAvatar).toBeInTheDocument();
    expect(hasTitle).toBeInTheDocument();
  });

  it("renders error with digest message", () => {
    const error = new Error("Validation failed");
    error.name = "ValidationError";

    render(
      <GlobalStateProvider status="error" error={error} errorTitle="Error">
        {mockChildren}
      </GlobalStateProvider>,
    );

    expect(screen.getByText("ValidationError")).toBeInTheDocument();
    expect(screen.getByText("Failed to load")).toBeInTheDocument();
  });

  it("renders error action when provided", () => {
    const handleRetry = vi.fn();

    render(
      <GlobalStateProvider
        status="error"
        error={new Error("Error")}
        onRetry={handleRetry}
        errorAction={<button>Custom action</button>}
      >
        {mockChildren}
      </GlobalStateProvider>,
    );

    const actionButton = screen.getByText("Custom action");
    expect(actionButton).toBeInTheDocument();
  });
});