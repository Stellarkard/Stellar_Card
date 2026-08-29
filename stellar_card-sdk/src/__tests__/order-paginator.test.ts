import { describe, it, expect } from 'vitest';
import { createOrderPaginator } from '../pagination';

function makeFetcher<T>(items: T[]) {
  return async (offset: number, limit: number) => items.slice(offset, offset + limit);
}

describe('createOrderPaginator', () => {
  it('pages through results and reports hasMore/nextOffset correctly', async () => {
    const items = Array.from({ length: 7 }, (_, i) => i + 1);
    const paginator = createOrderPaginator<number>({ fetchPage: makeFetcher(items), pageSize: 3 });

    const p1 = await paginator.next();
    expect(p1).not.toBeNull();
    expect(p1!.items).toEqual([1, 2, 3]);
    expect(p1!.hasMore).toBe(true);
    expect(p1!.nextOffset).toBe(3);

    const p2 = await paginator.next();
    expect(p2).not.toBeNull();
    expect(p2!.items).toEqual([4, 5, 6]);
    expect(p2!.hasMore).toBe(true);
    expect(p2!.nextOffset).toBe(6);

    const p3 = await paginator.next();
    expect(p3).not.toBeNull();
    expect(p3!.items).toEqual([7]);
    expect(p3!.hasMore).toBe(false);
    expect(p3!.nextOffset).toBeNull();

    const p4 = await paginator.next();
    expect(p4).toBeNull();
  });

  it('collects all results via all()', async () => {
    const items = Array.from({ length: 10 }, (_, i) => i);
    const paginator = createOrderPaginator<number>({ fetchPage: makeFetcher(items), pageSize: 4 });
    const all = await paginator.all();
    expect(all).toEqual(items);
  });

  it('reset() rewinds the cursor', async () => {
    const items = [1, 2, 3, 4];
    const paginator = createOrderPaginator<number>({ fetchPage: makeFetcher(items), pageSize: 2 });
    const first = await paginator.next();
    expect(first!.items).toEqual([1, 2]);
    await paginator.next();
    paginator.reset();
    const again = await paginator.next();
    expect(again!.items).toEqual([1, 2]);
  });

  it('is async-iterable', async () => {
    const items = [10, 11, 12];
    const paginator = createOrderPaginator<number>({ fetchPage: makeFetcher(items), pageSize: 2 });
    const collected: number[] = [];
    for await (const it of paginator) collected.push(it);
    expect(collected).toEqual(items);
  });
});
