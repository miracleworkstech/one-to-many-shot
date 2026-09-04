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
  // The SKU is importer-controlled text and becomes a zip entry name: keep it to a safe
  // character set so "../x" or "a/b" can never traverse or nest on extraction (Codex, Task 7).
  const safeSku = sku.replace(/[^A-Za-z0-9_-]+/g, "-");
  return `${safeSku}-${slug}-${String(n).padStart(2, "0")}.jpg`;
}
