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
  /** The review page's smaller copy (lib/images.ts), beside the original. Reading falls
   *  back to the original for candidates saved before the copy existed. */
  reviewPath: (id: number) => path.join(dir(), `${id}-review.jpg`),
  hasReview: (id: number) => fs.existsSync(storage.reviewPath(id)),
  saveReview: (id: number, buf: Buffer) =>
    fs.writeFileSync(storage.reviewPath(id), buf),
  readReview: (id: number): Buffer | null => {
    const p = storage.reviewPath(id);
    return fs.existsSync(p) ? fs.readFileSync(p) : storage.readImage(id);
  },
  /** Byte size without reading the file, for the zip's exact Content-Length. */
  imageSize: (id: number): number | null => {
    try {
      return fs.statSync(storage.imagePath(id)).size;
    } catch {
      return null; // missing (or vanished between checks) reads as absent, not as an error
    }
  },
};
