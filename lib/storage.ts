// ponytail: local disk only. Swap this module for R2/S3 if a second instance or CDN is ever needed (DECISIONS.md D6).
import fs from "node:fs";
import path from "node:path";
import { env } from "./env";

const dir = () => {
  const p = path.join(env.dataDir, "images");
  fs.mkdirSync(p, { recursive: true });
  return p;
};
export const storage = {
  imagePath: (id: number) => path.join(dir(), `${id}.jpg`),
  saveImage: (id: number, buf: Buffer) =>
    fs.writeFileSync(storage.imagePath(id), buf),
  readImage: (id: number): Buffer | null => {
    const p = storage.imagePath(id);
    return fs.existsSync(p) ? fs.readFileSync(p) : null;
  },
};
