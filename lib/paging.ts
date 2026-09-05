/** One page of a list for the status page's Prev / Next links. Out-of-range pages clamp
 *  rather than 404: a stale link after a re-import still lands on a real page. */
export type Page<T> = {
  items: T[];
  page: number;
  pages: number;
  /** 1-based positions shown, "13–24 of 33"; both 0 for an empty list. */
  from: number;
  to: number;
};

export function pageOf<T>(
  rows: readonly T[],
  page: number,
  size: number,
): Page<T> {
  if (!(Number.isInteger(size) && size > 0))
    throw new RangeError(`page size must be a positive integer, got ${size}`);
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const p = Math.min(Math.max(1, page), pages);
  const start = (p - 1) * size;
  const items = rows.slice(start, start + size);
  return {
    items,
    page: p,
    pages,
    from: items.length ? start + 1 : 0,
    to: start + items.length,
  };
}

/** A page number from a query string value; anything that is not a positive integer is
 *  page 1. */
export function pageParam(v: string | string[] | undefined): number {
  const n = Number(Array.isArray(v) ? v[0] : v);
  return Number.isInteger(n) && n > 0 ? n : 1;
}
