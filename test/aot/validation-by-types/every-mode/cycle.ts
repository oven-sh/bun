import { before } from "./program";
import type { Tree } from "./types";

export function parsedInCycle(text: string): string {
  try {
    return JSON.stringify(JSON.parse<Tree>(text));
  } catch (error: any) {
    return error.constructor.name + " " + error.message;
  }
}
export const seenFromCycle = typeof before;
