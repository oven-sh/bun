// What the tests of single rules give to Bun.Image, and how they look at what comes back.
import { expect } from "bun:test";
import zlib from "node:zlib";
import { decoded } from "./check";
import { chunk, iccp, png } from "./write";

/** `rows` are unfiltered. */
export const idat = (...rows: number[][]) =>
  chunk("IDAT", zlib.deflateSync(Buffer.from(rows.flatMap(row => [0, ...row]))));

/** The pixels as `rrggbbaa`, and the color profile. */
export async function decodeToHex(file: Uint8Array, options: { maxPixels?: number } = {}) {
  const { width, lines, profile } = await decoded(file, options.maxPixels);
  const rows: string[] = [];
  for (let at = 0; at < lines.length; at += 1 + width * 4) {
    expect(lines[at]).toBe(0);
    rows.push(Buffer.from(lines).toString("hex", at + 1, at + 1 + width * 4));
  }
  return { hex: rows.join(""), profile: profile ? Buffer.from(profile).toString("latin1") : null };
}
export async function decode(file: Uint8Array, options: { maxPixels?: number } = {}) {
  const { hex, profile } = await decodeToHex(file, options);
  const pixels: string[] = hex.match(/.{8}/g) ?? [];
  return { pixels, profile };
}
export const pixels = async (...chunks: Buffer[]) => (await decode(png(...chunks))).pixels;
export const profile = async (...chunks: Buffer[]) => (await decode(png(...chunks))).profile;
export const rejects = (...chunks: Buffer[]) =>
  expect(decode(png(...chunks))).rejects.toMatchObject({ code: "ERR_IMAGE_DECODE_FAILED" });
/** Whether it does. What else went wrong, if something did. */
export const decodes = (file: Uint8Array, options?: { maxPixels?: number }) =>
  decode(file, options).then(
    () => true,
    error => error.code !== "ERR_IMAGE_DECODE_FAILED" && error,
  );

export const iccpOf = (text: string, name = "name") => iccp(name, text);
