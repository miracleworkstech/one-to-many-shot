"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** While something is in flight, re-fetch the page every few seconds so the finished
 *  images land on their own. A soft refresh keeps scroll, open sheets and typed text; it
 *  pauses while the tab is hidden. Rendered only while the product is generating, so it
 *  unmounts, and stops, the moment nothing is in flight. */
export function Refresher({ every = 5000 }: { every?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => {
      if (!document.hidden) router.refresh();
    }, every);
    return () => clearInterval(id);
  }, [router, every]);
  return null;
}
