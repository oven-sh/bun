// Encodes with Bun.Image. read.ts validates the file, model.ts has the expected coefficients, write.ts the bytes.
import { randomBytes } from "../png-golden/write";
import { pngOf, type Picture } from "./decode";
import { coefficientsOf } from "./model";
import { read } from "./read";
import { as, jfif, simpleProgression, SOF2, typical, write, type Frame } from "./write";

export type Options = { quality?: number; progressive?: boolean };

export function fill(width: number, height: number, color: (x: number, y: number) => number[]): Picture {
  const rgba = Buffer.alloc(width * height * 4, 255);
  for (let y = 0, at = 0; y < height; y++) for (let x = 0; x < width; x++, at += 4) rgba.set(color(x, y), at);
  return { width, height, rgba };
}
export function noisy(width: number, height: number, seed = width * 1000 + height): Picture {
  const random = randomBytes(seed);
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < rgba.length; i++) rgba[i] = random();
  return { width, height, rgba };
}

export const encode = (picture: Picture, options?: Options) => new Bun.Image(pngOf(picture)).jpeg(options).buffer();

/** The expected file for these coefficients. */
export const fileOf = (frame: Frame, progressive = false) =>
  progressive
    ? write(as(SOF2, frame), simpleProgression, { before: [jfif] })
    : write(frame, undefined, { before: [jfif], tables: typical });

/** How the files differ from the expected ones. */
export async function mistakes(pictures: Picture[], quality: number, kinds = [false, true]) {
  const found = await Promise.all(
    pictures.flatMap(picture => {
      const expected = coefficientsOf(picture, quality);
      return kinds.map(async progressive => {
        const name = `${picture.width} by ${picture.height} at ${quality}${progressive ? ", progressive" : ""}`;
        const file = await encode(picture, { quality, progressive });
        if (file.equals(fileOf(expected, progressive))) return [];
        try {
          const wrong = read(file).frame.components.flatMap(({ data }, c) => {
            const at = data.findIndex((value, i) => value !== expected.components[c].data[i]);
            return at < 0
              ? []
              : [`${data[at]} at ${at % 64} in block ${at >> 6} of ${c}, not ${expected.components[c].data[at]}`];
          });
          return [`${name}: ${wrong[0] ?? "other bytes"}`];
        } catch (error: any) {
          return [`${name}: ${error.message}`];
        }
      });
    }),
  );
  return found.flat();
}
