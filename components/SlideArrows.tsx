"use client";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { QUIET } from "./buttons";

const ICON = { size: 20, strokeWidth: 1.75, "aria-hidden": true } as const;

/** Previous / next slide for a mouse. The carousel is a scroll-snap list: a thumb swipes
 *  it and the arrow keys move it once it has focus, but a desktop mouse has nothing to
 *  grab because the scrollbar is hidden. Two buttons that scroll by one slide width are
 *  the smallest fix; snap alignment does the rest. Hidden below `sm`, where the swipe is
 *  the gesture and the slides are narrower than the viewport anyway. */
export function SlideArrows({ listId }: { listId: string }) {
  const by = (dir: -1 | 1) => () => {
    const list = document.getElementById(listId);
    // Instant here; the list's `motion-safe:scroll-smooth` animates it unless the person
    // asked for reduced motion, the same rule the rest of the page follows.
    if (list) list.scrollBy({ left: dir * list.clientWidth });
  };
  return (
    <div className="mt-2 hidden justify-between sm:flex">
      <button
        type="button"
        onClick={by(-1)}
        className={QUIET}
        aria-label="Previous slide"
      >
        <ChevronLeft {...ICON} />
        Previous slide
      </button>
      <button
        type="button"
        onClick={by(1)}
        className={QUIET}
        aria-label="Next slide"
      >
        Next slide
        <ChevronRight {...ICON} />
      </button>
    </div>
  );
}
