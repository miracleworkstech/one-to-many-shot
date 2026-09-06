/** The product's name, in one place: the tab, the review page titles, the header. */
export const APP_NAME = "Dropshot";

/** The mark: a photo frame with one shot landed in it, in moss because moss already means
 *  approved everywhere else on the page. Decorative beside the wordmark; the name is the
 *  accessible text. The favicon (app/icon.svg) is the same drawing with fixed colours. */
export function Mark({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className="shrink-0"
    >
      <rect
        x="2.5"
        y="2.5"
        width="19"
        height="19"
        rx="3.5"
        stroke="currentColor"
        strokeWidth="1.75"
      />
      <circle cx="12" cy="14.5" r="4" className="fill-moss" />
    </svg>
  );
}

/** Mark and wordmark together, sized to sit where a page heading does. */
export function Logo() {
  return (
    <span className="inline-flex items-center gap-2 text-stone-900">
      <Mark />
      <span className="text-xl font-semibold tracking-tight">{APP_NAME}</span>
    </span>
  );
}
