// The shapes of all the files, for gen.ts and sweep.ts.
import * as common from "./shapes";
import * as eslint1 from "./shapes-eslint-1";
import * as eslint2 from "./shapes-eslint-2";
import * as eslint3 from "./shapes-eslint-3";
import * as eslint4 from "./shapes-eslint-4";
import * as oxlint from "./shapes-oxlint";
import * as reactCompiler from "./shapes-react-compiler";
import * as typed from "./shapes-typed";
import * as typescript from "./shapes-typescript";

const more = {
  "eslint-1": eslint1,
  "eslint-2": eslint2,
  "eslint-3": eslint3,
  "eslint-4": eslint4,
  typescript,
  typed,
  oxlint,
  "react-compiler": reactCompiler,
};

/**
 * The names of the shapes, each with what makes its text: a shape is made when it is asked for.
 *
 * `all`: not only those of shapes.ts, which are for all rules, but also those of the other files, which are each for some rules.
 * A name that two files have gets the name of the second file in front.
 */
export function shapesOf(kind: "wide" | "deep", n: number, all: boolean): Map<string, () => string> {
  const found = new Map<string, () => string>();
  for (const [set, functions] of Object.entries({ common, ...(all ? more : {}) })) {
    const shapes = functions[kind](n);
    for (const shape of Object.keys(shapes))
      found.set(found.has(shape) ? `${set}-${shape}` : shape, () => shapes[shape]);
  }
  return found;
}
