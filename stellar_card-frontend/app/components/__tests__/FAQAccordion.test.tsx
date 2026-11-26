import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FAQAccordion, GENERAL_FAQ, DEVELOPER_FAQ } from '../components/FAQAccordion';

describe('FAQAccordion', () => {
  const mockItems = [
    { question: 'Question 1?', answer: 'Answer 1' },
    { question: 'Question 2?', answer: 'Answer 2' },
    { question: 'Question 3?', answer: 'Answer 3' },
  ];

  it('renders all questions', () => {
    render(<FAQAccordion items={mockItems} />);
    expect(screen.getByText('Question 1?')).toBeInTheDocument();
    expect(screen.getByText('Question 2?')).toBeInTheDocument();
    expect(screen.getByText('Question 3?')).toBeInTheDocument();
  });

  it('opens first item by default in single-open mode', () => {
    render(<FAQAccordion items={mockItems} />);
    expect(screen.getByText('Answer 1')).toBeInTheDocument();
    expect(screen.queryByText('Answer 2')).not.toBeInTheDocument();
    expect(screen.queryByText('Answer 3')).not.toBeInTheDocument();
  });

  it('opens clicked item and closes others in single-open mode', () => {
    render(<FAQAccordion items={mockItems} />);
    fireEvent.click(screen.getByText('Question 2?'));
    expect(screen.getByText('Answer 2')).toBeInTheDocument();
    expect(screen.queryByText('Answer 1')).not.toBeInTheDocument();
    expect(screen.queryByText('Answer 3')).not.toBeInTheDocument();
  });

  it('allows multiple open items when allowMultiple is true', () => {
    render(<FAQAccordion items={mockItems} allowMultiple />);
    fireEvent.click(screen.getByText('Question 1?'));
    fireEvent.click(screen.getByText('Question 2?'));
    expect(screen.getByText('Answer 1')).toBeInTheDocument();
    expect(screen.getByText('Answer 2')).toBeInTheDocument();
    expect(screen.queryByText('Answer 3')).not.toBeInTheDocument();
  });

  it('closes item when clicked again in allowMultiple mode', () => {
    render(<FAQAccordion items={mockItems} allowMultiple />);
    fireEvent.click(screen.getByText('Question 1?'));
    expect(screen.getByText('Answer 1')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Question 1?'));
    expect(screen.queryByText('Answer 1')).not.toBeInTheDocument();
  });

  it('handles Enter key to toggle', () => {
    render(<FAQAccordion items={mockItems} />);
    const trigger = screen.getByText('Question 2?');
    fireEvent.keyDown(trigger, { key: 'Enter' });
    expect(screen.getByText('Answer 2')).toBeInTheDocument();
  });

  it('handles Space key to toggle', () => {
    render(<FAQAccordion items={mockItems} />);
    const trigger = screen.getByText('Question 2?');
    fireEvent.keyDown(trigger, { key: ' ' });
    expect(screen.getByText('Answer 2')).toBeInTheDocument();
  });

  it('handles ArrowDown key to focus next', () => {
    render(<FAQAccordion items={mockItems} />);
    const trigger1 = screen.getByText('Question 1?');
    fireEvent.keyDown(trigger1, { key: 'ArrowDown' });
    // Focus should move to Question 2
    expect(screen.getByText('Question 2?')).toHaveFocus();
  });

  it('handles ArrowUp key to focus previous', () => {
    render(<FAQAccordion items={mockItems} />);
    const trigger3 = screen.getByText('Question 3?');
    fireEvent.keyDown(trigger3, { key: 'ArrowUp' });
    expect(screen.getByText('Question 2?')).toHaveFocus();
  });

  it('handles Home key to focus first', () => {
    render(<FAQAccordion items={mockItems} />);
    const trigger3 = screen.getByText('Question 3?');
    fireEvent.keyDown(trigger3, { key: 'Home' });
    expect(screen.getByText('Question 1?')).toHaveFocus();
  });

  it('handles End key to focus last', () => {
    render(<FAQAccordion items={mockItems} />);
    const trigger1 = screen.getByText('Question 1?');
    fireEvent.keyDown(trigger1, { key: 'End' });
    expect(screen.getByText('Question 3?')).toHaveFocus();
  });

  it('has correct ARIA attributes', () => {
    render(<FAQAccordion items={mockItems} />);
    const trigger = screen.getByText('Question 1?');
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(trigger).toHaveAttribute('aria-controls');
  });

  it('renders GENERAL_FAQ data', () => {
    render(<FAQAccordion items={GENERAL_FAQ} />);
    expect(screen.getByText('What is Stellar_Card?')).toBeInTheDocument();
    expect(screen.getByText('How does the referral program work?')).toBeInTheDocument();
    expect(screen.getByText('What are the payout terms?')).toBeInTheDocument();
  });

  it('renders DEVELOPER_FAQ data', () => {
    render(<FAQAccordion items={DEVELOPER_FAQ} />);
    expect(screen.getByText('What APIs are available?')).toBeInTheDocument();
    expect(screen.getByText('How does authorisation work?')).toBeInTheDocument();
    expect(screen.getByText('What is the SLA for API uptime?')).toBeInTheDocument();
  });

  it('renders rich content in answers', () => {
    const itemsWithRichContent = [
      {
        question: 'Rich content?',
        answer: (
          <>
            <p>Paragraph 1</p>
            <p>Paragraph 2 with <strong>bold</strong> text.</p>
            <a href="/test">Link</a>
          </>
        ),
      },
    ];
    render(<FAQAccordion items={itemsWithRichContent} />);
    expect(screen.getByText('Paragraph 1')).toBeInTheDocument();
    expect(screen.getByText('Paragraph 2 with bold text.')).toBeInTheDocument();
    expect(screen.getByText('Link')).toBeInTheDocument();
  });
});