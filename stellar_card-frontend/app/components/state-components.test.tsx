import { describe, it, expect } from 'vitest';
import { LoadingState, Skeleton, PageLoadingSkeleton } from './LoadingState';
import { EmptyState } from './EmptyState';
import { ErrorState } from './ErrorState';

describe('Skeleton', () => {
  it('renders without crashing', () => {
    const el = <Skeleton />;
    expect(el).toBeDefined();
  });

  it('accepts custom width', () => {
    const el = <Skeleton width="50%" />;
    expect(el.props.width).toBe('50%');
  });

  it('accepts custom height', () => {
    const el = <Skeleton height={20} />;
    expect(el.props.height).toBe(20);
  });

  it('accepts borderRadius', () => {
    const el = <Skeleton borderRadius={8} />;
    expect(el.props.borderRadius).toBe(8);
  });
});

describe('LoadingState', () => {
  it('renders without crashing', () => {
    const el = <LoadingState />;
    expect(el).toBeDefined();
  });

  it('renders children when provided', () => {
    const el = <LoadingState>Processing…</LoadingState>;
    expect(el.props.children).toBe('Processing…');
  });

  it('passes avatar prop', () => {
    const el = <LoadingState avatar lines={2} />;
    expect(el.props.avatar).toBe(true);
    expect(el.props.lines).toBe(2);
  });

  it('passes title prop', () => {
    const el = <LoadingState title />;
    expect(el.props.title).toBe(true);
  });
});

describe('PageLoadingSkeleton', () => {
  it('renders without crashing', () => {
    const el = <PageLoadingSkeleton />;
    expect(el).toBeDefined();
  });
});

describe('EmptyState', () => {
  it('renders without crashing', () => {
    const el = <EmptyState title="No items found" />;
    expect(el).toBeDefined();
  });

  it('passes title prop', () => {
    const el = <EmptyState title="No agents" />;
    expect(el.props.title).toBe('No agents');
  });

  it('passes description prop', () => {
    const el = <EmptyState title="Empty" description="Nothing here yet" />;
    expect(el.props.description).toBe('Nothing here yet');
  });

  it('passes action slot', () => {
    const el = <EmptyState title="Empty" action={<button>Create</button>} />;
    expect(el.props.action).toBeDefined();
  });

  it('passes compact prop', () => {
    const el = <EmptyState title="Tight" compact />;
    expect(el.props.compact).toBe(true);
  });

  it('passes icon prop', () => {
    const icon = <span>icon</span>;
    const el = <EmptyState title="With icon" icon={icon} />;
    expect(el.props.icon).toBe(icon);
  });
});

describe('ErrorState', () => {
  it('renders without crashing', () => {
    const el = <ErrorState />;
    expect(el).toBeDefined();
  });

  it('renders without crashing when no props', () => {
    const el = <ErrorState />;
    expect(el).toBeDefined();
  });

  it('passes custom title and message', () => {
    const el = <ErrorState title="Failed" message="Try later" />;
    expect(el.props.title).toBe('Failed');
    expect(el.props.message).toBe('Try later');
  });

  it('passes onRetry callback', () => {
    const fn = () => {};
    const el = <ErrorState onRetry={fn} />;
    expect(el.props.onRetry).toBe(fn);
  });

  it('passes digest prop', () => {
    const el = <ErrorState digest="abc-123" />;
    expect(el.props.digest).toBe('abc-123');
  });
});
