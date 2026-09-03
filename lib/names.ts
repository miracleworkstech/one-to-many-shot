export function approvedFilename(
  sku: string,
  idea: string | null,
  n: number,
): string {
  const words = (idea ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3);
  const slug = words.length ? words.join("-") : "styled";
  return `${sku}-${slug}-${String(n).padStart(2, "0")}.jpg`;
}
