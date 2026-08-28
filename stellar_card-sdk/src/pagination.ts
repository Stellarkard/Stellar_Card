/**
 * Generic pagination utilities for the stellar_card SDK.
 *
 * These helpers are independent of the REST client and work with any
 * async page-fetching function that returns items + a continuation cursor.
 */

/** Opaque offset-based cursor carried between page requests. */
export interface PaginationCursor {
  /** Zero-based row offset for the next page fetch. */
  offset: number;
  /** Maximum items to return per page. */
  limit: number;
}

/** A single page of results plus forward-pagination metadata. */
export interface PaginatedResult<T> {
  /** Items returned for this page. */
  items: T[];
  /** Cursor for the next page, or null when the final page has been reached. */
  nextCursor: PaginationCursor | null;
  /** Whether additional items exist beyond this page. */
  hasMore: boolean;
  /** Zero-based offset used to fetch this page. */
  offset: number;
  /** Page size used to fetch this page. */
  limit: number;
}

/** Options accepted by `paginate`. */
export interface PaginateOptions<T> {
  /**
   * Async function that fetches a page.
   * Receives the current cursor and must return the items for that page.
   * Return fewer items than `cursor.limit` to signal the last page.
   */
  fetchPage: (cursor: PaginationCursor) => Promise<T[]>;
  /** Number of items per page. Defaults to 20. */
  limit?: number;
  /** Zero-based offset to start from. Defaults to 0. */
  initialOffset?: number;
}

/**
 * Fetch a single page using the provided `fetchPage` function and return
 * a `PaginatedResult` including the next cursor (or null when done).
 *
 * The implementation probes one extra item beyond `limit` so it can set
 * `hasMore` reliably — the extra item is stripped from the returned `items`.
 *
 * @example
 * const page = await paginate({
 *   fetchPage: (cur) => myApi.list({ limit: cur.limit, offset: cur.offset }),
 *   limit: 10,
 * });
 * if (page.hasMore) {
 *   const next = await paginate({ fetchPage, limit: 10, initialOffset: page.nextCursor!.offset });
 * }
 */
export async function paginate<T>(opts: PaginateOptions<T>): Promise<PaginatedResult<T>> {
  const limit = opts.limit ?? 20;
  const offset = opts.initialOffset ?? 0;

  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError(`paginate: limit must be a positive integer, got ${limit}`);
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw new RangeError(`paginate: initialOffset must be a non-negative integer, got ${offset}`);
  }

  // Probe one extra to determine hasMore without a separate count request.
  const raw = await opts.fetchPage({ offset, limit: limit + 1 });
  const hasMore = raw.length > limit;
  const items = hasMore ? raw.slice(0, limit) : raw;

  return {
    items,
    hasMore,
    offset,
    limit,
    nextCursor: hasMore ? { offset: offset + items.length, limit } : null,
  };
}

/**
 * Async generator that iterates every item across all pages using
 * the provided `fetchPage` function.
 *
 * Memory usage is bounded to one page at a time regardless of total
 * item count.  Use `maxItems` to impose a hard cap.
 *
 * @example
 * for await (const item of iteratePages({ fetchPage, limit: 50 })) {
 *   console.log(item);
 * }
 */
export interface IteratePagesOptions<T> extends PaginateOptions<T> {
  /** Hard cap on total items yielded. Unlimited when omitted. */
  maxItems?: number;
}

/**
 * Collect all pages into a single array.
 *
 * Convenience wrapper around {@link iteratePages} for cases where the full
 * result set fits in memory and caller-side streaming is not needed.
 *
 * @param opts - Pagination options (same as {@link iteratePages}).
 * @returns A promise that resolves to an array containing every item across
 *   all pages in ascending offset order.
 *
 * @example
 * ```typescript
 * const all = await collectAllPages({ fetchPage, limit: 50 });
 * ```
 */
export async function collectAllPages<T>(opts: IteratePagesOptions<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of iteratePages(opts)) {
    items.push(item);
  }
  return items;
}

/**
 * Async generator that iterates every item across all pages using
 * the provided `fetchPage` function.
 *
 * Memory usage is bounded to one page at a time regardless of total
 * item count. Use `maxItems` to impose a hard cap on the number of
 * yielded items.
 *
 * @param opts - Pagination options including `fetchPage`, `limit`, `initialOffset`,
 *   and an optional `maxItems` cap.
 * @yields Each item across all pages in ascending offset order.
 * @throws {RangeError} When `maxItems` is not a non-negative integer.
 *
 * @example
 * ```typescript
 * for await (const item of iteratePages({ fetchPage, limit: 50 })) {
 *   console.log(item);
 * }
 * ```
 */
export async function* iteratePages<T>(
  opts: IteratePagesOptions<T>,
): AsyncGenerator<T, void, void> {
  const { maxItems, ...pageOpts } = opts;
  if (maxItems !== undefined && (!Number.isInteger(maxItems) || maxItems < 0)) {
    throw new RangeError(`iteratePages: maxItems must be a non-negative integer, got ${maxItems}`);
  }

  let remaining = maxItems === undefined ? Infinity : maxItems;
  let cursor: PaginationCursor | null = {
    offset: opts.initialOffset ?? 0,
    limit: opts.limit ?? 20,
  };

  while (cursor !== null && remaining > 0) {
    const effectiveLimit: number = Number.isFinite(remaining)
      ? Math.min(cursor.limit, remaining)
      : cursor.limit;

    const page: PaginatedResult<T> = await paginate<T>({
      ...pageOpts,
      limit: effectiveLimit,
      initialOffset: cursor.offset,
    });

    for (const item of page.items) {
      yield item;
      if (Number.isFinite(remaining)) remaining--;
      if (remaining <= 0) return;
    }

    cursor = page.nextCursor;
  }
}

/** Options accepted by {@link mapPaginated}. */
export interface MapPaginatedOptions<T, R> extends IteratePagesOptions<T> {
  /**
   * Transform applied to every item as it is streamed. Receives the item and
   * its zero-based index across the whole result set. May be async.
   */
  transform: (item: T, index: number) => R | Promise<R>;
}

/**
 * Iterate every item across all pages, applying `transform` to each one.
 *
 * Like {@link iteratePages}, memory stays bounded to a single page (plus the
 * in-flight transformed value) regardless of total item count. The transform
 * receives the running index so callers can number rows across page
 * boundaries.
 *
 * @example
 * for await (const id of mapPaginated({ fetchPage, transform: (o) => o.id })) {
 *   console.log(id);
 * }
 */
export async function* mapPaginated<T, R>(
  opts: MapPaginatedOptions<T, R>,
): AsyncGenerator<R, void, void> {
  const { transform, ...iterOpts } = opts;
  let index = 0;
  for await (const item of iteratePages<T>(iterOpts)) {
    yield await transform(item, index);
    index++;
  }
}
