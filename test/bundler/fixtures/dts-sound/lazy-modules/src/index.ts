import type { Options } from "./parse";

export async function load(text: string, options?: Options): Promise<string | number> {
  const { parse } = await import("./parse");
  return parse(text, options);
}
