import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
    ],
  },
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/ban-ts-comment": "error",
    },
  },
  {
    // Both pages navigate with plain anchors on purpose: a full load is one small server
    // render here, and it is what lets the cross-document view transition run (D24).
    files: ["app/page.tsx", "app/review/*/page.tsx"], // [sku] would read as a glob class
    rules: { "@next/next/no-html-link-for-pages": "off" },
  },
];

export default eslintConfig;
