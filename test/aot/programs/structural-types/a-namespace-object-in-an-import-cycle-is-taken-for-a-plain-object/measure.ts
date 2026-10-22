import { note } from "./report.ts";
import * as shape from "./shape.ts";

interface Sized {
  width: number;
  height: number;
  depth: number;
}

function widthOf(s: Sized): number {
  return s.width;
}
function heightOf(s: Sized): number {
  return s.height;
}
function depthOf(s: Sized): number {
  return s.depth;
}
function volume(s: Sized): number {
  return s.width * s.height * s.depth;
}

export function measure(when: string): string {
  note(when + " width", () => widthOf(shape));
  note(when + " height", () => heightOf(shape));
  note(when + " depth", () => depthOf(shape));
  note(when + " depth + 1", () => depthOf(shape) + 1);
  note(when + " volume", () => volume(shape));
  note(when + " keys", () => Object.keys(shape).join());
  note(when + " spread", () => JSON.stringify({ ...shape }));
  note(when + " a plain object", () => volume({ width: 1, height: 2, depth: 3 }));
  return when;
}

measure("early");
