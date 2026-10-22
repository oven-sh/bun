import { expect } from "bun:test";
import { featureNamed } from "../../scripts/build/trim/features";
import { model } from "../bundler/compile-trim-features";
import type { runtimeUse } from "./runtime-use-harness";

export type Use = Awaited<ReturnType<typeof runtimeUse>>;

export const build = ["build", "--compile", "--aot", "--outfile", "main"];
/** Declares a function that no file defines: its arguments are passed to code the compiler can't see. */
export const external = `declare const external: (...values: unknown[]) => unknown;\n`;

export const computedModuleName = "dynamic-import: the program calls import() or require() with a dynamic path";
export const uncompiledModule = "external-import: the program imports a module that isn't in the executable";
/** What the report lists when `holder` escapes. */
export const everyMemberOf = (holder: string) => `${holder} (escapes, so any member may be used)`;
export const globalObject = everyMemberOf("globalThis");

const hostHolders = ["globalThis", "process", "Bun"];
export const closed = { first: "the compiler can see every API this program uses", whyOpen: [] as string[], escaped: [] as string[] };
export const open = (why: string) =>
  why === globalObject
    ? { ...closed, escaped: expect.arrayContaining(["globalThis"]) }
    : { first: expect.stringMatching(/^blocked by /), whyOpen: expect.arrayContaining([why]), escaped: expect.any(Array) };
export const escapes = (holder: string) => ({ first: expect.any(String), whyOpen: expect.any(Array), escaped: expect.arrayContaining([holder]) });
const withoutPlace = (line: string) => line.replace(/ at \S+:\d+:\d+$/, "");
const withoutBuiltin = (line: string) => line.replace(/ \([^()]*\)$/, "");
export const completeness = (use: Use) => ({
  first: withoutPlace(use.lines[0] ?? use.stderr),
  whyOpen: [...new Set(use.whyOpen.map(withoutPlace).flatMap(why => [why, withoutBuiltin(why)]))],
  escaped: hostHolders.filter(holder => use.lines.includes(everyMemberOf(holder))),
});

/** Why a row of a table is not met yet: for `gap()` of ./supported. */
export const notYet = {
  everyBuiltin: "one value that nobody knows is in the program, and every member of the language's built-in objects counts as used",
  globalObject: "the global object counts as escaped, and with it every global",
  globalObjectForHolder: "the report says that the global object escapes and does not name the holder",
  bunOutOfSight: "the compiler does not follow Bun through the promise, so it does not see the call: --trim removes the function, and the call throws ERR_FEATURE_REMOVED",
  directEvalIsNotNamed: "the line does not name eval",
  moduleGraphBlocksNothing: "the report is closed",
};

/** What a `uses` line lists: `Bun serve` for `uses Bun serve`. */
const itemOf = (line: string) => line.replace(/^uses /, "");
/** The report lists `item`, says that any member of its holder may be used, or is blocked: --trim does not remove what `item` stands for. */
export function accountsFor(use: Use, item: string): boolean {
  const items = use.lines.map(itemOf);
  const wanted = itemOf(item);
  const holder = wanted.slice(0, wanted.indexOf(" "));
  return use.whyOpen.length > 0 || items.includes(wanted) || items.includes(everyMemberOf(holder === "global" ? "globalThis" : holder));
}

/** The reason after `blocked by` when only `use` blocks --trim. `use`: the path of a built-in. */
export function unseenCode(use: string): string {
  return `runtime-code: the program can run code that isn't in the executable (${use})`;
}

/** `name`: as in src/trim/features, for example `HtmlRewriter`. */
export function retainsFeature(lines: string[], name: string): boolean {
  const line = "kept " + featureNamed(model, name).text;
  return lines.some(each => each === line || each.startsWith(line + " (") || each.startsWith(line + ":"));
}
