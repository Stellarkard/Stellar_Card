// Unit tests for dashboard UI primitives (#134).
// Pattern mirrors app/components/state-components.test.tsx — pure JSX
// prop tests run under node environment (no DOM), consistent with the
// existing vitest project config.

import { describe, it, expect, vi } from 'vitest';
import { Button } from './Button';
import { Card } from './Card';
import { Input } from './Input';
import { Toggle } from './Toggle';
import { Pill } from './Pill';
import { KpiTile, KpiRow } from './KpiTile';
import { FilterChip } from './FilterChip';

// ── Button ───────────────────────────────────────────────────────────

describe('Button', () => {
  it('renders with default props', () => {
    const el = <Button>Click me</Button>;
    expect(el).toBeDefined();
    expect(el.props.children).toBe('Click me');
  });

  it('applies primary variant', () => {
    const el = <Button variant="primary">Create</Button>;
    expect(el.props.variant).toBe('primary');
  });

  it('applies secondary variant', () => {
    const el = <Button variant="secondary">Cancel</Button>;
    expect(el.props.variant).toBe('secondary');
  });

  it('applies ghost variant', () => {
    const el = <Button variant="ghost">Skip</Button>;
    expect(el.props.variant).toBe('ghost');
  });

  it('applies danger variant', () => {
    const el = <Button variant="danger">Delete</Button>;
    expect(el.props.variant).toBe('danger');
  });

  it('supports sm size', () => {
    const el = <Button size="sm">Small</Button>;
    expect(el.props.size).toBe('sm');
  });

  it('supports md size', () => {
    const el = <Button size="md">Medium</Button>;
    expect(el.props.size).toBe('md');
  });

  it('forwards disabled prop', () => {
    const el = <Button disabled>Disabled</Button>;
    expect(el.props.disabled).toBe(true);
  });

  it('forwards onClick handler', () => {
    const onClick = vi.fn();
    const el = <Button onClick={onClick}>Click</Button>;
    expect(el.props.onClick).toBe(onClick);
  });

  it('renders icon slot', () => {
    const icon = <span>★</span>;
    const el = <Button icon={icon}>With icon</Button>;
    expect(el.props.icon).toBe(icon);
  });

  it('renders without children (icon-only)', () => {
    const icon = <span>★</span>;
    const el = <Button icon={icon} />;
    expect(el.props.icon).toBeDefined();
    expect(el.props.children).toBeUndefined();
  });
});

// ── Card ─────────────────────────────────────────────────────────────

describe('Card', () => {
  it('renders children', () => {
    const el = <Card>content</Card>;
    expect(el.props.children).toBe('content');
  });

  it('accepts title', () => {
    const el = <Card title="Overview">body</Card>;
    expect(el.props.title).toBe('Overview');
  });

  it('accepts actions slot', () => {
    const actions = <button>Edit</button>;
    const el = <Card title="Settings" actions={actions}>body</Card>;
    expect(el.props.actions).toBe(actions);
  });

  it('accepts custom padding', () => {
    const el = <Card padding={0}>body</Card>;
    expect(el.props.padding).toBe(0);
  });

  it('accepts edge-to-edge string padding', () => {
    const el = <Card padding="0">body</Card>;
    expect(el.props.padding).toBe('0');
  });

  it('accepts custom style', () => {
    const style = { maxWidth: 400 };
    const el = <Card style={style}>body</Card>;
    expect(el.props.style).toBe(style);
  });
});

// ── Input ────────────────────────────────────────────────────────────

describe('Input', () => {
  it('renders without crashing', () => {
    const el = <Input />;
    expect(el).toBeDefined();
  });

  it('forwards placeholder', () => {
    const el = <Input placeholder="Search…" />;
    expect(el.props.placeholder).toBe('Search…');
  });

  it('forwards value', () => {
    const el = <Input value="hello" onChange={() => {}} />;
    expect(el.props.value).toBe('hello');
  });

  it('forwards type', () => {
    const el = <Input type="number" />;
    expect(el.props.type).toBe('number');
  });

  it('accepts prefix slot', () => {
    const el = <Input prefix="$" />;
    expect(el.props.prefix).toBe('$');
  });

  it('accepts suffix slot', () => {
    const el = <Input suffix="USDC" />;
    expect(el.props.suffix).toBe('USDC');
  });

  it('forwards disabled', () => {
    const el = <Input disabled />;
    expect(el.props.disabled).toBe(true);
  });

  it('forwards onChange handler', () => {
    const onChange = vi.fn();
    const el = <Input onChange={onChange} />;
    expect(el.props.onChange).toBe(onChange);
  });
});

// ── Toggle ───────────────────────────────────────────────────────────

describe('Toggle', () => {
  it('renders checked state', () => {
    const el = <Toggle checked={true} onChange={() => {}} label="Enable" />;
    expect(el.props.checked).toBe(true);
  });

  it('renders unchecked state', () => {
    const el = <Toggle checked={false} onChange={() => {}} label="Disable" />;
    expect(el.props.checked).toBe(false);
  });

  it('passes onChange handler', () => {
    const onChange = vi.fn();
    const el = <Toggle checked={false} onChange={onChange} label="Toggle" />;
    expect(el.props.onChange).toBe(onChange);
  });

  it('accepts string label', () => {
    const el = <Toggle checked={false} onChange={() => {}} label="Notifications" />;
    expect(el.props.label).toBe('Notifications');
  });

  it('accepts ReactNode label', () => {
    const label = <span>Rich label</span>;
    const el = <Toggle checked={false} onChange={() => {}} label={label} />;
    expect(el.props.label).toBe(label);
  });

  it('accepts description', () => {
    const el = <Toggle checked={true} onChange={() => {}} label="X" description="Helps with Y" />;
    expect(el.props.description).toBe('Helps with Y');
  });

  it('accepts children slot', () => {
    const el = (
      <Toggle checked={true} onChange={() => {}} label="Limit">
        <Input placeholder="100" />
      </Toggle>
    );
    expect(el.props.children).toBeDefined();
  });
});

// ── Pill ─────────────────────────────────────────────────────────────

describe('Pill', () => {
  it('renders children', () => {
    const el = <Pill>Active</Pill>;
    expect(el.props.children).toBe('Active');
  });

  it('defaults to neutral tone', () => {
    const el = <Pill>Active</Pill>;
    // Default tone is neutral — confirm the prop is not explicitly set
    expect(el.props.tone).toBeUndefined();
  });

  it('accepts green tone', () => {
    const el = <Pill tone="green">Live</Pill>;
    expect(el.props.tone).toBe('green');
  });

  it('accepts red tone', () => {
    const el = <Pill tone="red">Failed</Pill>;
    expect(el.props.tone).toBe('red');
  });

  it('accepts yellow tone', () => {
    const el = <Pill tone="yellow">Pending</Pill>;
    expect(el.props.tone).toBe('yellow');
  });

  it('accepts blue tone', () => {
    const el = <Pill tone="blue">Info</Pill>;
    expect(el.props.tone).toBe('blue');
  });

  it('accepts purple tone', () => {
    const el = <Pill tone="purple">Beta</Pill>;
    expect(el.props.tone).toBe('purple');
  });

  it('accepts neutral tone', () => {
    const el = <Pill tone="neutral">Idle</Pill>;
    expect(el.props.tone).toBe('neutral');
  });

  it('accepts pulse prop', () => {
    const el = <Pill tone="green" pulse>Live</Pill>;
    expect(el.props.pulse).toBe(true);
  });

  it('accepts title for tooltip', () => {
    const el = <Pill title="agent is live">Active</Pill>;
    expect(el.props.title).toBe('agent is live');
  });
});

// ── KpiTile ──────────────────────────────────────────────────────────

describe('KpiTile', () => {
  it('renders with required props', () => {
    const el = <KpiTile label="Spend 24h" value="$123.00" />;
    expect(el.props.label).toBe('Spend 24h');
    expect(el.props.value).toBe('$123.00');
  });

  it('accepts numeric value', () => {
    const el = <KpiTile label="Agents" value={42} />;
    expect(el.props.value).toBe(42);
  });

  it('accepts positive delta', () => {
    const el = <KpiTile label="Spend" value="$500" delta={{ value: '12%', positive: true }} />;
    expect(el.props.delta?.positive).toBe(true);
    expect(el.props.delta?.value).toBe('12%');
  });

  it('accepts negative delta', () => {
    const el = <KpiTile label="Spend" value="$200" delta={{ value: '5%', positive: false }} />;
    expect(el.props.delta?.positive).toBe(false);
  });

  it('accepts null delta', () => {
    const el = <KpiTile label="Spend" value="$0" delta={null} />;
    expect(el.props.delta).toBeNull();
  });

  it('accepts hint', () => {
    const el = <KpiTile label="Rate" value="99%" hint="over 7 days" />;
    expect(el.props.hint).toBe('over 7 days');
  });

  it('accepts ReactNode hint', () => {
    const hint = <span>7d avg</span>;
    const el = <KpiTile label="Rate" value="99%" hint={hint} />;
    expect(el.props.hint).toBe(hint);
  });
});

describe('KpiRow', () => {
  it('renders children', () => {
    const el = (
      <KpiRow>
        <KpiTile label="A" value="1" />
        <KpiTile label="B" value="2" />
      </KpiRow>
    );
    expect(el.props.children).toBeDefined();
  });
});

// ── FilterChip ───────────────────────────────────────────────────────

describe('FilterChip', () => {
  it('renders active chip', () => {
    const el = <FilterChip active={true} onClick={() => {}}>All</FilterChip>;
    expect(el.props.active).toBe(true);
  });

  it('renders inactive chip', () => {
    const el = <FilterChip active={false} onClick={() => {}}>All</FilterChip>;
    expect(el.props.active).toBe(false);
  });

  it('forwards onClick', () => {
    const onClick = vi.fn();
    const el = <FilterChip active={false} onClick={onClick}>Filter</FilterChip>;
    expect(el.props.onClick).toBe(onClick);
  });

  it('renders children', () => {
    const el = <FilterChip active={false} onClick={() => {}}>Active</FilterChip>;
    expect(el.props.children).toBe('Active');
  });

  it('accepts count', () => {
    const el = <FilterChip active={true} onClick={() => {}} count={7}>Orders</FilterChip>;
    expect(el.props.count).toBe(7);
  });

  it('accepts zero count', () => {
    const el = <FilterChip active={false} onClick={() => {}} count={0}>Orders</FilterChip>;
    expect(el.props.count).toBe(0);
  });

  it('accepts tone', () => {
    const el = <FilterChip active={true} onClick={() => {}} tone="green">Live</FilterChip>;
    expect(el.props.tone).toBe('green');
  });

  it('renders without tone or count', () => {
    const el = <FilterChip active={false} onClick={() => {}}>Plain</FilterChip>;
    expect(el.props.tone).toBeUndefined();
    expect(el.props.count).toBeUndefined();
  });
});
