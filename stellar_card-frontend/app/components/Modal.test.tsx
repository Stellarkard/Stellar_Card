// Modal Accessibility Tests (Part 2)
// Comprehensive tests for keyboard navigation, ARIA attributes, and focus management

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Modal } from "../dashboard/_ui/Modal";

describe("Modal Accessibility (Part 2)", () => {
  const mockOnClose = vi.fn();

  beforeEach(() => {
    mockOnClose.mockClear();
  });

  it("has proper ARIA role", () => {
    render(
      <Modal open onClose={mockOnClose} title="Test Modal">
        Content
      </Modal>,
    );

    const modal = screen.getByRole("dialog");
    expect(modal).toBeInTheDocument();
  });

  it("sets aria-modal attribute", () => {
    render(
      <Modal open onClose={mockOnClose} title="Test Modal">
        Content
      </Modal>,
    );

    const modal = screen.getByRole("dialog");
    expect(modal).toHaveAttribute("aria-modal", "true");
  });

  it("links title with aria-labelledby", () => {
    render(
      <Modal open onClose={mockOnClose} title="Modal Title">
        Content
      </Modal>,
    );

    const modal = screen.getByRole("dialog");
    const titleElement = screen.getByText("Modal Title");

    expect(modal).toHaveAttribute("aria-labelledby");
    expect(titleElement).toHaveAttribute("id");
  });

  it("links description with aria-describedby", () => {
    render(
      <Modal
        open
        onClose={mockOnClose}
        title="Test"
        description="Description text"
      >
        Content
      </Modal>,
    );

    const modal = screen.getByRole("dialog");
    const description = screen.getByText("Description text");

    expect(modal).toHaveAttribute("aria-describedby");
    expect(description).toHaveAttribute("id");
  });

  it("close button has aria-label", () => {
    render(
      <Modal open onClose={mockOnClose} showCloseButton>
        Content
      </Modal>,
    );

    const closeButton = screen.getByLabelText(/close/i);
    expect(closeButton).toBeInTheDocument();
  });

  it("allows custom close button aria-label", () => {
    render(
      <Modal
        open
        onClose={mockOnClose}
        closeButtonAriaLabel="Dismiss notification"
      >
        Content
      </Modal>,
    );

    const closeButton = screen.getByLabelText("Dismiss notification");
    expect(closeButton).toBeInTheDocument();
  });

  it("closes on Escape key by default", () => {
    render(
      <Modal open onClose={mockOnClose}>
        Content
      </Modal>,
    );

    fireEvent.keyDown(document, { key: "Escape", code: "Escape" });
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it("does not close on Escape when disabled", () => {
    render(
      <Modal open onClose={mockOnClose} closeOnEscape={false}>
        Content
      </Modal>,
    );

    fireEvent.keyDown(document, { key: "Escape", code: "Escape" });
    expect(mockOnClose).not.toHaveBeenCalled();
  });

  it("closes on backdrop click by default", () => {
    render(
      <Modal open onClose={mockOnClose}>
        Content
      </Modal>,
    );

    // Click backdrop
    const backdrop = document.querySelector('[role="presentation"]');
    fireEvent.click(backdrop!);

    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it("does not close on backdrop click when disabled", () => {
    render(
      <Modal open onClose={mockOnClose} closeOnBackdropClick={false}>
        Content
      </Modal>,
    );

    const backdrop = document.querySelector('[role="presentation"]');
    fireEvent.click(backdrop!);

    expect(mockOnClose).not.toHaveBeenCalled();
  });

  it("does not close on content click", () => {
    render(
      <Modal open onClose={mockOnClose}>
        <div data-testid="content">Content</div>
      </Modal>,
    );

    const content = screen.getByTestId("content");
    fireEvent.click(content);

    expect(mockOnClose).not.toHaveBeenCalled();
  });

  it("supports alertdialog role", () => {
    render(
      <Modal open onClose={mockOnClose} role="alertdialog">
        Critical alert
      </Modal>,
    );

    const modal = screen.getByRole("alertdialog");
    expect(modal).toBeInTheDocument();
  });

  it("renders footer when provided", () => {
    render(
      <Modal
        open
        onClose={mockOnClose}
        footer={
          <>
            <button>Cancel</button>
            <button>Confirm</button>
          </>
        }
      >
        Content
      </Modal>,
    );

    expect(screen.getByText("Cancel")).toBeInTheDocument();
    expect(screen.getByText("Confirm")).toBeInTheDocument();
  });

  it("applies custom className", () => {
    const { container } = render(
      <Modal open onClose={mockOnClose} className="custom-modal">
        Content
      </Modal>,
    );

    expect(container.querySelector(".custom-modal")).toBeInTheDocument();
  });

  it("supports different sizes", () => {
    const { rerender } = render(
      <Modal open onClose={mockOnClose} size="sm">
        Content
      </Modal>,
    );

    let modal = screen.getByRole("dialog");
    expect(modal).toHaveStyle({ maxWidth: 380 });

    rerender(
      <Modal open onClose={mockOnClose} size="md">
        Content
      </Modal>,
    );
    modal = screen.getByRole("dialog");
    expect(modal).toHaveStyle({ maxWidth: 480 });

    rerender(
      <Modal open onClose={mockOnClose} size="lg">
        Content
      </Modal>,
    );
    modal = screen.getByRole("dialog");
    expect(modal).toHaveStyle({ maxWidth: 640 });
  });

  it("does not render when closed", () => {
    const { container } = render(
      <Modal open={false} onClose={mockOnClose}>
        Content
      </Modal>,
    );

    expect(container.firstChild).toBeNull();
  });

  it("hides close button when showCloseButton is false", () => {
    render(
      <Modal open onClose={mockOnClose} showCloseButton={false}>
        Content
      </Modal>,
    );

    expect(screen.queryByLabelText(/close/i)).not.toBeInTheDocument();
  });

  it("focus management works with initialFocusRef", async () => {
    const TestComponent = () => {
      const buttonRef = React.useRef<HTMLButtonElement>(null);

      return (
        <Modal open onClose={mockOnClose} initialFocusRef={buttonRef}>
          <input placeholder="First input" />
          <button ref={buttonRef}>Focus me</button>
        </Modal>
      );
    };

    render(<TestComponent />);

    await waitFor(() => {
      expect(screen.getByText("Focus me")).toHaveFocus();
    });
  });

  it("backdrop has presentation role and aria-hidden", () => {
    render(
      <Modal open onClose={mockOnClose}>
        Content
      </Modal>,
    );

    const backdrop = document.querySelector('[role="presentation"]');
    expect(backdrop).toHaveAttribute("aria-hidden", "true");
  });

  it("renders title and description together", () => {
    render(
      <Modal open onClose={mockOnClose} title="Title" description="Description">
        Content
      </Modal>,
    );

    expect(screen.getByText("Title")).toBeInTheDocument();
    expect(screen.getByText("Description")).toBeInTheDocument();
  });
});
