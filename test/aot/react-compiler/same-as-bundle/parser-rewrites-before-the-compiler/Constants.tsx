// Expressions the build replaces with constants, and the branches that die with them.
import { feature } from "bun:bundle";
import { Color, LIMIT, next, Size } from "./counter";

declare const IS_FAST: boolean;
const LOCAL_LIMIT = 2;
enum Level {
  Low,
  High,
}

export function Defined({ a }: { a: number }) {
  "use memo";
  const list = process.env.MODE === "fast" ? [a] : [a, next()];
  return list;
}

export function DefinedName({ a }: { a: number }) {
  "use memo";
  if (IS_FAST) return [a, "fast"];
  return [a, next()];
}

export function Flagged({ a }: { a: number }) {
  "use memo";
  const list = [a];
  if (feature("FAST")) list.push(1);
  if (feature("SLOW")) list.push(next());
  return list;
}

export function Dead({ a }: { a: number }) {
  "use memo";
  if (false) return [next()];
  const list = [a];
  return list;
  list.push(next());
}

export function Enums({ a }: { a: number }) {
  "use memo";
  const list = [a, Size.Large, Level.High, Color.Blue, LIMIT, LOCAL_LIMIT];
  return list;
}

export function Folded({ a }: { a: number }) {
  "use memo";
  const text = "a" + "b" + `${"c"}`;
  const list = [a, text, 1 + 2, typeof a === "undefined", !!a, void 0 === undefined];
  return list;
}

export function Main({ a }: { a: number }) {
  "use memo";
  const list = import.meta.main ? [a, next()] : [a];
  return list;
}
