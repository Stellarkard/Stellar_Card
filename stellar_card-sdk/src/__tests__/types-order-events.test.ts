import { describe, it, expect } from 'vitest';
import {
  isOrderEventType,
  isOrderEvent,
  isWebhookDelivery,
  isOrderEventSubscription,
  type OrderEvent,
} from '../types';

describe('Order event typings and guards', () => {
  it('recognises valid OrderEventType values', () => {
    expect(isOrderEventType('payment_received')).toBe(true);
    expect(isOrderEventType('order_created')).toBe(true);
    expect(isOrderEventType('non_existent_type')).toBe(false);
  });

  it('validates OrderEvent objects', () => {
    const ev: OrderEvent = {
      event_id: 'evt_1',
      order_id: 'ord_1',
      event_type: 'payment_received',
      timestamp: new Date().toISOString(),
      source: 'api',
      message: 'Payment observed',
    } as OrderEvent;
    expect(isOrderEvent(ev)).toBe(true);

    const bad = { foo: 'bar' };
    expect(isOrderEvent(bad)).toBe(false);
  });

  it('validates webhook delivery records', () => {
    const w = {
      delivery_id: 'd1',
      event_id: 'evt_1',
      order_id: 'ord_1',
      webhook_url: 'https://example.com/hook',
      status: 'delivered',
      attempts: 1,
      last_attempt_at: new Date().toISOString(),
    };
    expect(isWebhookDelivery(w)).toBe(true);
    expect(isWebhookDelivery({})).toBe(false);
  });

  it('validates order event subscriptions', () => {
    const s = {
      subscription_id: 'sub_1',
      transport: 'webhook',
      active: true,
      created_at: new Date().toISOString(),
    };
    expect(isOrderEventSubscription(s)).toBe(true);
    expect(isOrderEventSubscription({ subscription_id: 1 })).toBe(false);
  });
});
