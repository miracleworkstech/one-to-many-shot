import type { STATUS_TONE } from "@/lib/status";

export type Tone = (typeof STATUS_TONE)[keyof typeof STATUS_TONE];

/** One hue per meaning, from the @theme tokens in globals.css: ochre waits on a person,
 *  moss is done, clay is broken. A state is this dot beside neutral text, never a tinted
 *  badge; the word beside it carries the meaning, the dot only speeds it up. */
const DOT: Record<Tone, string> = {
  wait: "bg-ochre",
  ok: "bg-moss",
  stop: "bg-clay",
  neutral: "bg-stone-400",
};

export function StateDot({ tone }: { tone: Tone }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block size-2 shrink-0 rounded-full ${DOT[tone]}`}
    />
  );
}
