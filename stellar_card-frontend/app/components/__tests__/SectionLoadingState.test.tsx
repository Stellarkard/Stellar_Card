// Comprehensive tests for SectionLoadingState (Part 3)

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SectionLoadingState } from "../SectionLoadingState";

describe("SectionLoadingState", () => {
  const mockChildren = vi.fn(() => <div>Section Content</div>);

  beforeEach(() => {
    mockChildren.mockClear();
  });

  it("renders loading state with default variant", () => {
    render(
      <SectionLoadingState status="loading">
        {mockChildren}
      </SectionLoadingState>,
    );

    expect(document.querySelector(".skeleton-shimmer")).toBeInTheDocument();
    expect(mockChildren).not.toHaveBeenCalled();
  });

  it("renders compact loading state", () => {
    const { container } = render(
      <SectionLoadingState status="loading" variant="compact" loadingLines={2}>
        {mockChildren}
      </SectionLoadingState>,
    );

    const skeletons = container.querySelectorAll(".skeleton-shimmer");
    expect(skeletons.length).toBe(2);
  });

  it("renders error state in compact variant", () => {
    render(
      <SectionLoadingState
        status="error"
        error={new Error("Failed")}
        variant="compact"
      >
        {mockChildren}
      </SectionLoadingState>,
    );

    expect(screen.getByText("Error")).toBeInTheDocument();
  });

  it("renders empty state with custom title", () => {
    render(
      <SectionLoadingState
        status="success"
        isEmpty={true}
        emptyTitle="No items found"
      >
        {mockChildren}
      </SectionLoadingState>,
    );

    expect(screen.getByText("No items found")).toBeInTheDocument();
  });

  it("renders compact empty state", () => {
    render(
      <SectionLoadingState
        status="success"
        isEmpty={true}
        variant="compact"
        emptyTitle="Empty"
      >
        {mockChildren}
      </SectionLoadingState>,
    );

    expect(screen.getByText("Empty")).toBeInTheDocument();
  });

  it("renders children when success and not empty", () => {
    render(
      <SectionLoadingState status="success" isEmpty={false}>
        {mockChildren}
      </SectionLoadingState>,
    );

    expect(mockChildren).toHaveBeenCalled();
    expect(screen.getByText("Section Content")).toBeInTheDocument();
  });

  it("shows retry button when onRetry provided", () => {
    const handleRetry = vi.fn();

    render(
      <SectionLoadingState
        status="error"
        error={new Error("Failed")}
        onRetry={handleRetry}
      >
        {mockChildren}
      </SectionLoadingState>,
    );

    expect(screen.getByText("Try again")).toBeInTheDocument();
  });

  it("handles idle status as loading", () => {
    render(
      <SectionLoadingState status="idle">{mockChildren}</SectionLoadingState>,
    );

    expect(document.querySelector(".skeleton-shimmer")).toBeInTheDocument();
  });

  it("renders custom empty description", () => {
    render(
      <SectionLoadingState
        status="success"
        isEmpty={true}
        emptyDescription="Try changing filters"
      >
        {mockChildren}
      </SectionLoadingState>,
    );

    expect(screen.getByText("Try changing filters")).toBeInTheDocument();
  });

  it("renders empty action button", () => {
    render(
      <SectionLoadingState
        status="success"
        isEmpty={true}
        emptyAction={<button>Add Item</button>}
      >
        {mockChildren}
      </SectionLoadingState>,
    );

    expect(screen.getByText("Add Item")).toBeInTheDocument();
  });
});
