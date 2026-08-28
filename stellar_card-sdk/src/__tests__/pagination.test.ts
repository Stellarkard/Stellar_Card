import { describe, it, expect, vi } from 'vitest';
import {
  paginate,
  iteratePages,
  collectAllPages,
  mapPaginated,
  type PaginationCursor,
} from '../pagination';

// fetchPage backed by an in-memory array.
const arraySource =
  <T,>(source: T[]) =>
  async (cur: PaginationCursor): Promise<T[]> =>
    source.slice(cur.offset, cur.offset + cur.limit);

// ── paginate ──────────────────────────────────────────────────────────────────

describe('paginate', () => {
  it('returns items and hasMore=false on a single small page', async () => {
    const items = [1, 2, 3];
    const result = await paginate({
      fetchPage: async () => items,
      limit: 10,
    });
    expect(result.items).toEqual([1, 2, 3]);
    expect(result.hasMore).toBe(false);
    expect(result.nextCursor).toBeNull();
    expect(result.offset).toBe(0);
    expect(result.limit).toBe(10);
  });

  it('detects hasMore via the probe-extra strategy', async () => {
    // Source has 21 items; limit is 20 — probe fetches 21 and finds more.
    const source = Array.from({ length: 21 }, (_, i) => i);
    const result = await paginate({
      fetchPage: async (cur) => source.slice(cur.offset, cur.offset + cur.limit),
      limit: 20,
    });
    expect(result.items).toHaveLength(20);
    expect(result.hasMore).toBe(true);
    expect(result.nextCursor).toEqual({ offset: 20, limit: 20 });
  });

  it('passes correct cursor values to fetchPage', async () => {
    const spy = vi.fn().mockResolvedValue([42]);
    await paginate({ fetchPage: spy, limit: 5, initialOffset: 15 });
    // probe asks for limit + 1
    expect(spy).toHaveBeenCalledWith({ offset: 15, limit: 6 });
  });

  it('defaults limit to 20 and offset to 0', async () => {
    const spy = vi.fn().mockResolvedValue([]);
    await paginate({ fetchPage: spy });
    expect(spy).toHaveBeenCalledWith({ offset: 0, limit: 21 });
  });

  it('throws RangeError for non-positive limit', async () => {
    await expect(paginate({ fetchPage: async () => [], limit: 0 })).rejects.toThrow(RangeError);
    await expect(paginate({ fetchPage: async () => [], limit: -1 })).rejects.toThrow(RangeError);
  });

  it('throws RangeError for negative offset', async () => {
    await expect(
      paginate({ fetchPage: async () => [], initialOffset: -1 }),
    ).rejects.toThrow(RangeError);
  });

  it('handles exact page boundary — last item fills the page exactly', async () => {
    const source = [1, 2, 3];
    const result = await paginate({
      fetchPage: async (cur) => source.slice(cur.offset, cur.offset + cur.limit),
      limit: 3,
    });
    expect(result.items).toHaveLength(3);
    expect(result.hasMore).toBe(false);
    expect(result.nextCursor).toBeNull();
  });

  it('handles empty source', async () => {
    const result = await paginate({ fetchPage: async () => [] });
    expect(result.items).toHaveLength(0);
    expect(result.hasMore).toBe(false);
    expect(result.nextCursor).toBeNull();
  });
});

// ── iteratePages ─────────────────────────────────────────────────────────────

describe('iteratePages', () => {
  function makeSource(total: number) {
    const data = Array.from({ length: total }, (_, i) => i);
    return async (cur: PaginationCursor) => data.slice(cur.offset, cur.offset + cur.limit);
  }

  it('yields all items across multiple pages', async () => {
    const collected: number[] = [];
    for await (const item of iteratePages({ fetchPage: makeSource(45), limit: 20 })) {
      collected.push(item);
    }
    expect(collected).toHaveLength(45);
    expect(collected[0]).toBe(0);
    expect(collected[44]).toBe(44);
  });

  it('respects maxItems cap', async () => {
    const collected: number[] = [];
    for await (const item of iteratePages({
      fetchPage: makeSource(100),
      limit: 20,
      maxItems: 35,
    })) {
      collected.push(item);
    }
    expect(collected).toHaveLength(35);
  });

  it('yields nothing for an empty source', async () => {
    const items: number[] = [];
    for await (const item of iteratePages({ fetchPage: async () => [] })) {
      items.push(item);
    }
    expect(items).toHaveLength(0);
  });

  it('maxItems=0 yields nothing', async () => {
    const items: number[] = [];
    for await (const item of iteratePages({ fetchPage: makeSource(10), maxItems: 0 })) {
      items.push(item);
    }
    expect(items).toHaveLength(0);
  });

  it('throws RangeError for negative maxItems', async () => {
    const gen = iteratePages({ fetchPage: async () => [], maxItems: -1 });
    await expect(gen.next()).rejects.toThrow(RangeError);
  });

  it('respects initialOffset', async () => {
    const items: number[] = [];
    for await (const item of iteratePages({
      fetchPage: makeSource(10),
      initialOffset: 7,
      limit: 5,
    })) {
      items.push(item);
    }
    // Items 7, 8, 9
    expect(items).toEqual([7, 8, 9]);
  });
});

// ── collectAllPages ───────────────────────────────────────────────────────────

describe('collectAllPages', () => {
  function makeSource(total: number) {
    const data = Array.from({ length: total }, (_, i) => i);
    return async (cur: PaginationCursor) => data.slice(cur.offset, cur.offset + cur.limit);
  }

  it('returns all items in a single array', async () => {
    const result = await collectAllPages({ fetchPage: makeSource(45), limit: 20 });
    expect(result).toHaveLength(45);
    expect(result[0]).toBe(0);
    expect(result[44]).toBe(44);
  });

  it('returns empty array for empty source', async () => {
    const result = await collectAllPages({ fetchPage: async () => [] });
    expect(result).toEqual([]);
  });

  it('respects maxItems', async () => {
    const result = await collectAllPages({ fetchPage: makeSource(100), limit: 20, maxItems: 35 });
    expect(result).toHaveLength(35);
  });

  it('respects initialOffset', async () => {
    const result = await collectAllPages({ fetchPage: makeSource(10), initialOffset: 7, limit: 5 });
    expect(result).toEqual([7, 8, 9]);
  });
});

// ── mapPaginated ──────────────────────────────────────────────────────────────

describe('mapPaginated', () => {
  it('applies the transform to every item with a running index', async () => {
    const source = ['a', 'b', 'c', 'd'];
    const out: string[] = [];
    for await (const v of mapPaginated({
      fetchPage: arraySource(source),
      limit: 2,
      transform: (item, i) => `${i}:${item}`,
    })) {
      out.push(v);
    }
    expect(out).toEqual(['0:a', '1:b', '2:c', '3:d']);
  });

  it('supports async transforms', async () => {
    const source = [1, 2, 3];
    const out: number[] = [];
    for await (const v of mapPaginated({
      fetchPage: arraySource(source),
      limit: 10,
      transform: async (n) => n * 2,
    })) {
      out.push(v);
    }
    expect(out).toEqual([2, 4, 6]);
  });
});
