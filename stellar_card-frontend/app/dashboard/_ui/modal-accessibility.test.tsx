import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Modal } from './Modal';
import { Drawer } from './Drawer';
import { getFocusableElements } from '../_lib/useFocusTrap';

describe('getFocusableElements', () => {
  it('returns empty array when container is null', () => {
    expect(getFocusableElements(null)).toEqual([]);
  });

  it('filters out disabled buttons and hidden elements', () => {
    if (typeof document !== 'undefined') {
      const container = document.createElement('div');
      container.innerHTML = `
        <button id="btn1">Button 1</button>
        <button id="btn2" disabled>Button 2</button>
        <a id="link1" href="#">Link</a>
        <input id="input1" type="text" />
        <div id="div1">Plain div</div>
      `;
      Array.from(container.children).forEach((child) => {
        Object.defineProperty(child, 'offsetWidth', { value: 100, configurable: true });
        Object.defineProperty(child, 'offsetHeight', { value: 30, configurable: true });
      });

      const focusable = getFocusableElements(container);
      const ids = focusable.map((el) => el.id);
      expect(ids).toContain('btn1');
      expect(ids).toContain('link1');
      expect(ids).toContain('input1');
      expect(ids).not.toContain('btn2');
      expect(ids).not.toContain('div1');
    }
  });
});

describe('Modal accessibility', () => {
  it('renders nothing when open is false', () => {
    const markup = renderToStaticMarkup(
      <Modal open={false} onClose={() => {}}>
        Content
      </Modal>
    );
    expect(markup).toBe('');
  });

  it('renders role="dialog" and aria-modal="true" when open', () => {
    const markup = renderToStaticMarkup(
      <Modal
        open={true}
        onClose={() => {}}
        title="Transfer Funds"
        description="Send funds to agent wallet"
      >
        <div>Form fields here</div>
      </Modal>
    );
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain('aria-labelledby=');
    expect(markup).toContain('aria-describedby=');
    expect(markup).toContain('Transfer Funds');
    expect(markup).toContain('Send funds to agent wallet');
    expect(markup).toContain('aria-label="Close dialog"');
  });

  it('supports role="alertdialog"', () => {
    const markup = renderToStaticMarkup(
      <Modal
        open={true}
        role="alertdialog"
        onClose={() => {}}
        title="Confirm Deletion"
      >
        Are you sure?
      </Modal>
    );
    expect(markup).toContain('role="alertdialog"');
    expect(markup).toContain('aria-modal="true"');
  });

  it('renders custom footer actions', () => {
    const markup = renderToStaticMarkup(
      <Modal
        open={true}
        onClose={() => {}}
        title="Modal with Footer"
        footer={<button>Confirm</button>}
      >
        Body content
      </Modal>
    );
    expect(markup).toContain('Confirm');
    expect(markup).toContain('Body content');
  });
});

describe('Drawer accessibility', () => {
  it('renders nothing when open is false', () => {
    const markup = renderToStaticMarkup(
      <Drawer open={false} onClose={() => {}}>
        Drawer Content
      </Drawer>
    );
    expect(markup).toBe('');
  });

  it('renders role="dialog", aria-modal="true", and close button aria-label', () => {
    const markup = renderToStaticMarkup(
      <Drawer
        open={true}
        onClose={() => {}}
        title="Agent Details"
        description="View and manage agent keys"
      >
        <div>Drawer body</div>
      </Drawer>
    );
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain('aria-labelledby=');
    expect(markup).toContain('aria-describedby=');
    expect(markup).toContain('Agent Details');
    expect(markup).toContain('aria-label="Close drawer"');
  });
});
