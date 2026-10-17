import type { Kind, Parsed } from "./types";
export function parse(text: string, kind: Kind): Parsed {
  return { value: kind + text };
}
