/**
 * Unit coverage for the EXIF orientation dispatcher `exif::read`
 * (src/runtime/image/exif.rs), exposed via `bun:internal-for-testing` as
 * `imageReadOrientation(bytes, format)`.
 *
 * The `Bun.Image` integration test for this (the `Orientation=6` TIFF in
 * test/js/bun/image/image.test.ts) can only run on macOS/Windows — HEIC/TIFF/
 * AVIF have no decoder on Linux, so the full decode path is unreachable there.
 * This unit test drives `exif::read` directly so the JPEG APP1/Exif walk and
 * the per-format dispatch (JPEG → Zig-style walker; HEIC/TIFF/AVIF → system
 * backend; everything else → identity) are exercised on every platform,
 * including the Linux CI/gate lanes. (#30235)
 */
import { imageReadOrientation } from "bun:internal-for-testing";
import { expect, test } from "bun:test";

// codecs::Format discriminants (src/runtime/image/codecs.rs, #[repr(u8)]).
const enum Format {
  Jpeg = 0,
  Png = 1,
  Webp = 2,
  Heic = 3,
  Avif = 4,
  Bmp = 5,
  Tiff = 6,
  Gif = 7,
}

// A minimal JPEG stream carrying an APP1/Exif segment with IFD0 tag 0x0112
// (Orientation) set to `value`. `read_jpeg` only walks markers up to SOS, so
// we don't need real scan data — SOI + the APP1 segment is enough.
function jpegWithOrientation(value: number): Uint8Array {
  // Big-endian TIFF ("MM\0*"), IFD0 at offset 8, one SHORT entry.
  // prettier-ignore
  const tiff = [
    0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, // header
    0x00, 0x01,                                     // 1 entry
    0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, // tag 0x0112, SHORT, count 1
    (value >> 8) & 0xff, value & 0xff, 0x00, 0x00,  // value (packed in first 2 bytes)
    0x00, 0x00, 0x00, 0x00,                         // next IFD = 0
  ];
  const exif = [...Buffer.from("Exif\0\0"), ...tiff];
  const seglen = exif.length + 2; // segment length includes the 2 length bytes
  // FF D8 (SOI) + FF E1 (APP1) + len + Exif payload + FF DA (SOS).
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe1, (seglen >> 8) & 0xff, seglen & 0xff, ...exif, 0xff, 0xda]);
}

test("exif::read parses JPEG APP1/Exif Orientation (each of 1..8)", () => {
  for (let v = 1; v <= 8; v++) {
    expect(imageReadOrientation(jpegWithOrientation(v), Format.Jpeg)).toBe(v);
  }
});

test("exif::read returns Normal (1) for a JPEG with no Exif segment", () => {
  // SOI + SOS, no APP1.
  expect(imageReadOrientation(new Uint8Array([0xff, 0xd8, 0xff, 0xda]), Format.Jpeg)).toBe(1);
});

test("exif::read ignores an out-of-range Orientation value", () => {
  // value 99 is not 1..8 → Normal.
  expect(imageReadOrientation(jpegWithOrientation(99), Format.Jpeg)).toBe(1);
});

test("exif::read does not read Exif for non-JPEG container formats", () => {
  // The same Exif-carrying bytes, dispatched as PNG/WebP/BMP/GIF, must NOT be
  // walked as JPEG — those formats are identity in the dispatcher regardless
  // of what the bytes contain.
  const jpeg = jpegWithOrientation(6);
  for (const fmt of [Format.Png, Format.Webp, Format.Bmp, Format.Gif]) {
    expect(imageReadOrientation(jpeg, fmt)).toBe(1);
  }
});

test("exif::read routes HEIC/TIFF/AVIF through the system backend", () => {
  // On Linux there is no system backend, so the dispatcher returns Normal (1);
  // on macOS/Windows ImageIO/WIC parse the container. Either way the call must
  // not be misrouted to the JPEG walker — a small TIFF header dispatched as
  // TIFF must never come back as a JPEG-parsed value.
  const tiff = new Uint8Array([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00]);
  for (const fmt of [Format.Heic, Format.Tiff, Format.Avif]) {
    const o = imageReadOrientation(tiff, fmt);
    expect(o).toBeGreaterThanOrEqual(1);
    expect(o).toBeLessThanOrEqual(8);
  }
});
