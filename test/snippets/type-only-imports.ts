// @ts-nocheck
import type Bacon from "tree";
import type { SilentSymbolCollisionsAreOkayInTypeScript } from "./app";

export const baconator: Bacon = true;
export const SilentSymbolCollisionsAreOkayInTypeScript: SilentSymbolCollisionsAreOkayInTypeScript = true;

export function test() {
  console.assert(SilentSymbolCollisionsAreOkayInTypeScript);
  console.assert(baconator);
  return testDone(import.meta.url);
}
