import sharp from "sharp";

/** The longest edge of the copy the review page shows. A phone shows the slide at 330 px
 *  wide and a 2× screen wants ~700; 1024 leaves room for the lightbox and desktop while
 *  cutting a 2048 px Luma JPEG to roughly a quarter of the bytes. The export still ships
 *  the original. */
export const REVIEW_EDGE = 1024;

/** A smaller JPEG of the same picture for the review page. Never enlarges: a source
 *  already under the edge comes back re-encoded at the same size. */
export async function reviewVariant(original: Buffer): Promise<Buffer> {
  return sharp(original)
    .rotate() // bake EXIF orientation in, so the small copy never flips against the original
    .resize({
      width: REVIEW_EDGE,
      height: REVIEW_EDGE,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();
}
