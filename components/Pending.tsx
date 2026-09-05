"use client";
import { useFormStatus } from "react-dom";
import { LoaderCircle } from "lucide-react";

/** The one pending mark: a turning ring beside the verb ("Approving…"). Reduced motion
 *  keeps the ring still and lets the word carry it. */
export function Spinner({ className = "" }: { className?: string }) {
  return (
    <LoaderCircle
      size={20}
      strokeWidth={1.75}
      aria-hidden="true"
      className={`animate-spin motion-reduce:animate-none ${className}`}
    />
  );
}

/** A submit button for a plain server-action form: while the action runs it goes inert,
 *  shows the ring and its pending verb, and blocks the second tap. */
export function SubmitButton({
  label,
  pendingLabel,
  className,
  ...rest
}: {
  label: React.ReactNode;
  pendingLabel: string;
  className: string;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "className">) {
  const { pending } = useFormStatus();
  return (
    <button
      {...rest}
      disabled={pending}
      aria-busy={pending}
      className={`${className} disabled:opacity-60`}
    >
      {pending ? (
        <>
          <Spinner />
          {pendingLabel}
        </>
      ) : (
        label
      )}
    </button>
  );
}
