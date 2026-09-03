export function buildPrompt(
  p: { name: string; color: string; material: string; notes: string },
  idea: string,
): string {
  const scene = idea.trim().replace(/[?.]+$/, "");
  const spec = [p.color, p.material].filter(Boolean).join(", ");
  const parts = [
    `Place this exact ${p.name}${spec ? ` (${spec})` : ""} in this scene: ${scene}.`,
    "Keep the product identical in shape, color, glaze, material, proportions and details. Do not add text, logos or extra copies of the product.",
    "Photorealistic product photography for an e-commerce page, natural light, shallow depth of field.",
  ];
  if (p.notes)
    parts.push(`Team notes for context: ${p.notes.replace(/[?]+/g, "")}.`);
  return parts.join(" ");
}
