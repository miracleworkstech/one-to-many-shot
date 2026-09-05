"use client";

/** A native popover announced as a dialog. On open, focus moves to the sheet itself, so a
 *  screen reader says its name and a keyboard user's next Tab lands on the first control
 *  inside it instead of wherever the trigger sat in the page. Escape, the backdrop and
 *  light dismiss are the browser's; the trigger gets focus back on close. */
export function Sheet({
  id,
  className,
  children,
  ...label
}: {
  id: string;
  className: "sheet" | "lightbox" | `${"sheet" | "lightbox"} ${string}`;
  children: React.ReactNode;
} & (
  | { "aria-labelledby": string; "aria-label"?: never }
  | { "aria-label": string; "aria-labelledby"?: never }
)) {
  return (
    <div
      id={id}
      popover="auto"
      role="dialog"
      tabIndex={-1}
      onToggle={(e) => {
        if (e.newState === "open") e.currentTarget.focus();
      }}
      className={`${className} outline-none`}
      {...label}
    >
      {children}
    </div>
  );
}
