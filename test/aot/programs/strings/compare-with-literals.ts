// Strings in every internal representation, undefined, null, numbers and objects are compared with string literals of 0 to 33 characters and with non-ASCII literals: === !== == != as a condition and as a value, in loops and outside, typed string, string | undefined and unknown.
const opaque = new Function("value", "return value") as <T>(value: T) => T;
const unseen = new Function("f", "return (...values) => f(...values)") as <F>(f: F) => F;

const flat = (text: string): string => opaque(text.split("").join(""));
const rope = (text: string): string => (text.length < 2 ? flat(text) : flat(text.slice(0, 1)) + flat(text.slice(1)));
const substring = (text: string): string => flat("<" + text + ">").slice(1, -1);
const wide = (text: string): string => flat(text + "☃").replace("☃", "");
const wideSubstring = (text: string): string => flat("☃" + text).slice(1);
const wideRope = (text: string): string => (text.length < 2 ? wide(text) : wide(text.slice(0, 1)) + wide(text.slice(1)));
const mixedRope = (text: string): string => (text.length < 2 ? flat(text) : flat(text.slice(0, 1)) + wide(text.slice(1)));
const makers = [flat, rope, substring, wide, wideSubstring, wideRope, mixedRope];

// Every code unit is the literal's plus 0x100: a comparison that looks at the low bytes alone finds it equal.
const raised = (text: string): string => String.fromCharCode(...text.split("").map(unit => unit.charCodeAt(0) + 0x100));

function nearMisses(text: string): string[] {
  if (text.length === 0) return [" ", "\0", "☃"];
  const middle = text.length >> 1;
  return [text.slice(0, -1), text + text.slice(-1), text + "\0", "~" + text.slice(1), text.slice(0, -1) + "~", text.slice(0, middle) + "~" + text.slice(middle + 1)];
}

function stringsFor(text: string): string[] {
  const subjects = makers.map(make => make(text));
  subjects.push(raised(text));
  for (const miss of nearMisses(text)) for (const make of makers) subjects.push(make(miss));
  subjects.push(flat(""));
  return subjects;
}

function optionalsFor(text: string): (string | undefined)[] {
  return [...stringsFor(text), undefined];
}

function valuesFor(text: string): unknown[] {
  const others: unknown[] = [undefined, null, 0, -0, 7, 7.5, NaN, true, false, 7n, Symbol.iterator, {}, [], [text], [[text]], { toString: () => text }, { valueOf: () => text }, new String(text)];
  return (stringsFor(text) as unknown[]).concat(others);
}

type Check = {
  text: string;
  ofString: (s: string) => number;
  ofOptional: (s: string | undefined) => number;
  ofUnknown: (x: unknown) => number;
  ofStrings: (list: string[], masks: number[]) => void;
  ofOptionals: (list: (string | undefined)[], masks: number[]) => void;
  ofUnknowns: (list: unknown[], masks: number[]) => void;
};

const checks: Check[] = [
  {
    text: "",
    ofString: (s: string): number => (s === "" ? 1 : 0) | (s !== "" ? 2 : 0) | (s == "" ? 4 : 0) | (s != "" ? 8 : 0) | ("" === s ? 16 : 0) | (Number(s === "") << 5),
    ofOptional: (s: string | undefined): number => (s === "" ? 1 : 0) | (s !== "" ? 2 : 0) | (s == "" ? 4 : 0) | (s != "" ? 8 : 0) | ("" === s ? 16 : 0) | (Number(s === "") << 5),
    ofUnknown: (x: unknown): number => (x === "" ? 1 : 0) | (x !== "" ? 2 : 0) | (x == "" ? 4 : 0) | (x != "" ? 8 : 0) | ("" === x ? 16 : 0) | (Number(x === "") << 5),
    ofStrings: (list: string[], masks: number[]): void => { for (let i = 0; i < list.length; i++) { const s = list[i]; masks.push((s === "" ? 1 : 0) | (s !== "" ? 2 : 0) | (s == "" ? 4 : 0) | (s != "" ? 8 : 0) | ("" === s ? 16 : 0) | (Number(s === "") << 5)); } },
    ofOptionals: (list: (string | undefined)[], masks: number[]): void => { for (let i = 0; i < list.length; i++) { const s = list[i]; masks.push((s === "" ? 1 : 0) | (s !== "" ? 2 : 0) | (s == "" ? 4 : 0) | (s != "" ? 8 : 0) | ("" === s ? 16 : 0) | (Number(s === "") << 5)); } },
    ofUnknowns: (list: unknown[], masks: number[]): void => { for (let i = 0; i < list.length; i++) { const x = list[i]; masks.push((x === "" ? 1 : 0) | (x !== "" ? 2 : 0) | (x == "" ? 4 : 0) | (x != "" ? 8 : 0) | ("" === x ? 16 : 0) | (Number(x === "") << 5)); } },
  },
  {
    text: "7",
    ofString: (s: string): number => (s === "7" ? 1 : 0) | (s !== "7" ? 2 : 0) | (s == "7" ? 4 : 0) | (s != "7" ? 8 : 0) | ("7" === s ? 16 : 0) | (Number(s === "7") << 5),
    ofOptional: (s: string | undefined): number => (s === "7" ? 1 : 0) | (s !== "7" ? 2 : 0) | (s == "7" ? 4 : 0) | (s != "7" ? 8 : 0) | ("7" === s ? 16 : 0) | (Number(s === "7") << 5),
    ofUnknown: (x: unknown): number => (x === "7" ? 1 : 0) | (x !== "7" ? 2 : 0) | (x == "7" ? 4 : 0) | (x != "7" ? 8 : 0) | ("7" === x ? 16 : 0) | (Number(x === "7") << 5),
    ofStrings: (list: string[], masks: number[]): void => { for (let i = 0; i < list.length; i++) { const s = list[i]; masks.push((s === "7" ? 1 : 0) | (s !== "7" ? 2 : 0) | (s == "7" ? 4 : 0) | (s != "7" ? 8 : 0) | ("7" === s ? 16 : 0) | (Number(s === "7") << 5)); } },
    ofOptionals: (list: (string | undefined)[], masks: number[]): void => { for (let i = 0; i < list.length; i++) { const s = list[i]; masks.push((s === "7" ? 1 : 0) | (s !== "7" ? 2 : 0) | (s == "7" ? 4 : 0) | (s != "7" ? 8 : 0) | ("7" === s ? 16 : 0) | (Number(s === "7") << 5)); } },
    ofUnknowns: (list: unknown[], masks: number[]): void => { for (let i = 0; i < list.length; i++) { const x = list[i]; masks.push((x === "7" ? 1 : 0) | (x !== "7" ? 2 : 0) | (x == "7" ? 4 : 0) | (x != "7" ? 8 : 0) | ("7" === x ? 16 : 0) | (Number(x === "7") << 5)); } },
  },
  {
    text: "ab",
    ofString: (s: string): number => (s === "ab" ? 1 : 0) | (s !== "ab" ? 2 : 0) | (s == "ab" ? 4 : 0) | (s != "ab" ? 8 : 0) | ("ab" === s ? 16 : 0) | (Number(s === "ab") << 5),
    ofOptional: (s: string | undefined): number => (s === "ab" ? 1 : 0) | (s !== "ab" ? 2 : 0) | (s == "ab" ? 4 : 0) | (s != "ab" ? 8 : 0) | ("ab" === s ? 16 : 0) | (Number(s === "ab") << 5),
    ofUnknown: (x: unknown): number => (x === "ab" ? 1 : 0) | (x !== "ab" ? 2 : 0) | (x == "ab" ? 4 : 0) | (x != "ab" ? 8 : 0) | ("ab" === x ? 16 : 0) | (Number(x === "ab") << 5),
    ofStrings: (list: string[], masks: number[]): void => { for (let i = 0; i < list.length; i++) { const s = list[i]; masks.push((s === "ab" ? 1 : 0) | (s !== "ab" ? 2 : 0) | (s == "ab" ? 4 : 0) | (s != "ab" ? 8 : 0) | ("ab" === s ? 16 : 0) | (Number(s === "ab") << 5)); } },
    ofOptionals: (list: (string | undefined)[], masks: number[]): void => { for (let i = 0; i < list.length; i++) { const s = list[i]; masks.push((s === "ab" ? 1 : 0) | (s !== "ab" ? 2 : 0) | (s == "ab" ? 4 : 0) | (s != "ab" ? 8 : 0) | ("ab" === s ? 16 : 0) | (Number(s === "ab") << 5)); } },
    ofUnknowns: (list: unknown[], masks: number[]): void => { for (let i = 0; i < list.length; i++) { const x = list[i]; masks.push((x === "ab" ? 1 : 0) | (x !== "ab" ? 2 : 0) | (x == "ab" ? 4 : 0) | (x != "ab" ? 8 : 0) | ("ab" === x ? 16 : 0) | (Number(x === "ab") << 5)); } },
  },
  {
    text: "abcdefg",
    ofString: (s: string): number => (s === "abcdefg" ? 1 : 0) | (s !== "abcdefg" ? 2 : 0) | (s == "abcdefg" ? 4 : 0) | (s != "abcdefg" ? 8 : 0) | ("abcdefg" === s ? 16 : 0) | (Number(s === "abcdefg") << 5),
    ofOptional: (s: string | undefined): number => (s === "abcdefg" ? 1 : 0) | (s !== "abcdefg" ? 2 : 0) | (s == "abcdefg" ? 4 : 0) | (s != "abcdefg" ? 8 : 0) | ("abcdefg" === s ? 16 : 0) | (Number(s === "abcdefg") << 5),
    ofUnknown: (x: unknown): number => (x === "abcdefg" ? 1 : 0) | (x !== "abcdefg" ? 2 : 0) | (x == "abcdefg" ? 4 : 0) | (x != "abcdefg" ? 8 : 0) | ("abcdefg" === x ? 16 : 0) | (Number(x === "abcdefg") << 5),
    ofStrings: (list: string[], masks: number[]): void => { for (let i = 0; i < list.length; i++) { const s = list[i]; masks.push((s === "abcdefg" ? 1 : 0) | (s !== "abcdefg" ? 2 : 0) | (s == "abcdefg" ? 4 : 0) | (s != "abcdefg" ? 8 : 0) | ("abcdefg" === s ? 16 : 0) | (Number(s === "abcdefg") << 5)); } },
    ofOptionals: (list: (string | undefined)[], masks: number[]): void => { for (let i = 0; i < list.length; i++) { const s = list[i]; masks.push((s === "abcdefg" ? 1 : 0) | (s !== "abcdefg" ? 2 : 0) | (s == "abcdefg" ? 4 : 0) | (s != "abcdefg" ? 8 : 0) | ("abcdefg" === s ? 16 : 0) | (Number(s === "abcdefg") << 5)); } },
    ofUnknowns: (list: unknown[], masks: number[]): void => { for (let i = 0; i < list.length; i++) { const x = list[i]; masks.push((x === "abcdefg" ? 1 : 0) | (x !== "abcdefg" ? 2 : 0) | (x == "abcdefg" ? 4 : 0) | (x != "abcdefg" ? 8 : 0) | ("abcdefg" === x ? 16 : 0) | (Number(x === "abcdefg") << 5)); } },
  },
  {
    text: "abcdefgh",
    ofString: (s: string): number => (s === "abcdefgh" ? 1 : 0) | (s !== "abcdefgh" ? 2 : 0) | (s == "abcdefgh" ? 4 : 0) | (s != "abcdefgh" ? 8 : 0) | ("abcdefgh" === s ? 16 : 0) | (Number(s === "abcdefgh") << 5),
    ofOptional: (s: string | undefined): number => (s === "abcdefgh" ? 1 : 0) | (s !== "abcdefgh" ? 2 : 0) | (s == "abcdefgh" ? 4 : 0) | (s != "abcdefgh" ? 8 : 0) | ("abcdefgh" === s ? 16 : 0) | (Number(s === "abcdefgh") << 5),
    ofUnknown: (x: unknown): number => (x === "abcdefgh" ? 1 : 0) | (x !== "abcdefgh" ? 2 : 0) | (x == "abcdefgh" ? 4 : 0) | (x != "abcdefgh" ? 8 : 0) | ("abcdefgh" === x ? 16 : 0) | (Number(x === "abcdefgh") << 5),
    ofStrings: (list: string[], masks: number[]): void => { for (let i = 0; i < list.length; i++) { const s = list[i]; masks.push((s === "abcdefgh" ? 1 : 0) | (s !== "abcdefgh" ? 2 : 0) | (s == "abcdefgh" ? 4 : 0) | (s != "abcdefgh" ? 8 : 0) | ("abcdefgh" === s ? 16 : 0) | (Number(s === "abcdefgh") << 5)); } },
    ofOptionals: (list: (string | undefined)[], masks: number[]): void => { for (let i = 0; i < list.length; i++) { const s = list[i]; masks.push((s === "abcdefgh" ? 1 : 0) | (s !== "abcdefgh" ? 2 : 0) | (s == "abcdefgh" ? 4 : 0) | (s != "abcdefgh" ? 8 : 0) | ("abcdefgh" === s ? 16 : 0) | (Number(s === "abcdefgh") << 5)); } },
    ofUnknowns: (list: unknown[], masks: number[]): void => { for (let i = 0; i < list.length; i++) { const x = list[i]; masks.push((x === "abcdefgh" ? 1 : 0) | (x !== "abcdefgh" ? 2 : 0) | (x == "abcdefgh" ? 4 : 0) | (x != "abcdefgh" ? 8 : 0) | ("abcdefgh" === x ? 16 : 0) | (Number(x === "abcdefgh") << 5)); } },
  },
  {
    text: "abcdefghi",
    ofString: (s: string): number => (s === "abcdefghi" ? 1 : 0) | (s !== "abcdefghi" ? 2 : 0) | (s == "abcdefghi" ? 4 : 0) | (s != "abcdefghi" ? 8 : 0) | ("abcdefghi" === s ? 16 : 0) | (Number(s === "abcdefghi") << 5),
    ofOptional: (s: string | undefined): number => (s === "abcdefghi" ? 1 : 0) | (s !== "abcdefghi" ? 2 : 0) | (s == "abcdefghi" ? 4 : 0) | (s != "abcdefghi" ? 8 : 0) | ("abcdefghi" === s ? 16 : 0) | (Number(s === "abcdefghi") << 5),
    ofUnknown: (x: unknown): number => (x === "abcdefghi" ? 1 : 0) | (x !== "abcdefghi" ? 2 : 0) | (x == "abcdefghi" ? 4 : 0) | (x != "abcdefghi" ? 8 : 0) | ("abcdefghi" === x ? 16 : 0) | (Number(x === "abcdefghi") << 5),
    ofStrings: (list: string[], masks: number[]): void => { for (let i = 0; i < list.length; i++) { const s = list[i]; masks.push((s === "abcdefghi" ? 1 : 0) | (s !== "abcdefghi" ? 2 : 0) | (s == "abcdefghi" ? 4 : 0) | (s != "abcdefghi" ? 8 : 0) | ("abcdefghi" === s ? 16 : 0) | (Number(s === "abcdefghi") << 5)); } },
    ofOptionals: (list: (string | undefined)[], masks: number[]): void => { for (let i = 0; i < list.length; i++) { const s = list[i]; masks.push((s === "abcdefghi" ? 1 : 0) | (s !== "abcdefghi" ? 2 : 0) | (s == "abcdefghi" ? 4 : 0) | (s != "abcdefghi" ? 8 : 0) | ("abcdefghi" === s ? 16 : 0) | (Number(s === "abcdefghi") << 5)); } },
    ofUnknowns: (list: unknown[], masks: number[]): void => { for (let i = 0; i < list.length; i++) { const x = list[i]; masks.push((x === "abcdefghi" ? 1 : 0) | (x !== "abcdefghi" ? 2 : 0) | (x == "abcdefghi" ? 4 : 0) | (x != "abcdefghi" ? 8 : 0) | ("abcdefghi" === x ? 16 : 0) | (Number(x === "abcdefghi") << 5)); } },
  },
  {
    text: "abcdefghijklmnopqrstuvwxyz012345",
    ofString: (s: string): number => (s === "abcdefghijklmnopqrstuvwxyz012345" ? 1 : 0) | (s !== "abcdefghijklmnopqrstuvwxyz012345" ? 2 : 0) | (s == "abcdefghijklmnopqrstuvwxyz012345" ? 4 : 0) | (s != "abcdefghijklmnopqrstuvwxyz012345" ? 8 : 0) | ("abcdefghijklmnopqrstuvwxyz012345" === s ? 16 : 0) | (Number(s === "abcdefghijklmnopqrstuvwxyz012345") << 5),
    ofOptional: (s: string | undefined): number => (s === "abcdefghijklmnopqrstuvwxyz012345" ? 1 : 0) | (s !== "abcdefghijklmnopqrstuvwxyz012345" ? 2 : 0) | (s == "abcdefghijklmnopqrstuvwxyz012345" ? 4 : 0) | (s != "abcdefghijklmnopqrstuvwxyz012345" ? 8 : 0) | ("abcdefghijklmnopqrstuvwxyz012345" === s ? 16 : 0) | (Number(s === "abcdefghijklmnopqrstuvwxyz012345") << 5),
    ofUnknown: (x: unknown): number => (x === "abcdefghijklmnopqrstuvwxyz012345" ? 1 : 0) | (x !== "abcdefghijklmnopqrstuvwxyz012345" ? 2 : 0) | (x == "abcdefghijklmnopqrstuvwxyz012345" ? 4 : 0) | (x != "abcdefghijklmnopqrstuvwxyz012345" ? 8 : 0) | ("abcdefghijklmnopqrstuvwxyz012345" === x ? 16 : 0) | (Number(x === "abcdefghijklmnopqrstuvwxyz012345") << 5),
    ofStrings: (list: string[], masks: number[]): void => { for (let i = 0; i < list.length; i++) { const s = list[i]; masks.push((s === "abcdefghijklmnopqrstuvwxyz012345" ? 1 : 0) | (s !== "abcdefghijklmnopqrstuvwxyz012345" ? 2 : 0) | (s == "abcdefghijklmnopqrstuvwxyz012345" ? 4 : 0) | (s != "abcdefghijklmnopqrstuvwxyz012345" ? 8 : 0) | ("abcdefghijklmnopqrstuvwxyz012345" === s ? 16 : 0) | (Number(s === "abcdefghijklmnopqrstuvwxyz012345") << 5)); } },
    ofOptionals: (list: (string | undefined)[], masks: number[]): void => { for (let i = 0; i < list.length; i++) { const s = list[i]; masks.push((s === "abcdefghijklmnopqrstuvwxyz012345" ? 1 : 0) | (s !== "abcdefghijklmnopqrstuvwxyz012345" ? 2 : 0) | (s == "abcdefghijklmnopqrstuvwxyz012345" ? 4 : 0) | (s != "abcdefghijklmnopqrstuvwxyz012345" ? 8 : 0) | ("abcdefghijklmnopqrstuvwxyz012345" === s ? 16 : 0) | (Number(s === "abcdefghijklmnopqrstuvwxyz012345") << 5)); } },
    ofUnknowns: (list: unknown[], masks: number[]): void => { for (let i = 0; i < list.length; i++) { const x = list[i]; masks.push((x === "abcdefghijklmnopqrstuvwxyz012345" ? 1 : 0) | (x !== "abcdefghijklmnopqrstuvwxyz012345" ? 2 : 0) | (x == "abcdefghijklmnopqrstuvwxyz012345" ? 4 : 0) | (x != "abcdefghijklmnopqrstuvwxyz012345" ? 8 : 0) | ("abcdefghijklmnopqrstuvwxyz012345" === x ? 16 : 0) | (Number(x === "abcdefghijklmnopqrstuvwxyz012345") << 5)); } },
  },
  {
    text: "abcdefghijklmnopqrstuvwxyz0123456",
    ofString: (s: string): number => (s === "abcdefghijklmnopqrstuvwxyz0123456" ? 1 : 0) | (s !== "abcdefghijklmnopqrstuvwxyz0123456" ? 2 : 0) | (s == "abcdefghijklmnopqrstuvwxyz0123456" ? 4 : 0) | (s != "abcdefghijklmnopqrstuvwxyz0123456" ? 8 : 0) | ("abcdefghijklmnopqrstuvwxyz0123456" === s ? 16 : 0) | (Number(s === "abcdefghijklmnopqrstuvwxyz0123456") << 5),
    ofOptional: (s: string | undefined): number => (s === "abcdefghijklmnopqrstuvwxyz0123456" ? 1 : 0) | (s !== "abcdefghijklmnopqrstuvwxyz0123456" ? 2 : 0) | (s == "abcdefghijklmnopqrstuvwxyz0123456" ? 4 : 0) | (s != "abcdefghijklmnopqrstuvwxyz0123456" ? 8 : 0) | ("abcdefghijklmnopqrstuvwxyz0123456" === s ? 16 : 0) | (Number(s === "abcdefghijklmnopqrstuvwxyz0123456") << 5),
    ofUnknown: (x: unknown): number => (x === "abcdefghijklmnopqrstuvwxyz0123456" ? 1 : 0) | (x !== "abcdefghijklmnopqrstuvwxyz0123456" ? 2 : 0) | (x == "abcdefghijklmnopqrstuvwxyz0123456" ? 4 : 0) | (x != "abcdefghijklmnopqrstuvwxyz0123456" ? 8 : 0) | ("abcdefghijklmnopqrstuvwxyz0123456" === x ? 16 : 0) | (Number(x === "abcdefghijklmnopqrstuvwxyz0123456") << 5),
    ofStrings: (list: string[], masks: number[]): void => { for (let i = 0; i < list.length; i++) { const s = list[i]; masks.push((s === "abcdefghijklmnopqrstuvwxyz0123456" ? 1 : 0) | (s !== "abcdefghijklmnopqrstuvwxyz0123456" ? 2 : 0) | (s == "abcdefghijklmnopqrstuvwxyz0123456" ? 4 : 0) | (s != "abcdefghijklmnopqrstuvwxyz0123456" ? 8 : 0) | ("abcdefghijklmnopqrstuvwxyz0123456" === s ? 16 : 0) | (Number(s === "abcdefghijklmnopqrstuvwxyz0123456") << 5)); } },
    ofOptionals: (list: (string | undefined)[], masks: number[]): void => { for (let i = 0; i < list.length; i++) { const s = list[i]; masks.push((s === "abcdefghijklmnopqrstuvwxyz0123456" ? 1 : 0) | (s !== "abcdefghijklmnopqrstuvwxyz0123456" ? 2 : 0) | (s == "abcdefghijklmnopqrstuvwxyz0123456" ? 4 : 0) | (s != "abcdefghijklmnopqrstuvwxyz0123456" ? 8 : 0) | ("abcdefghijklmnopqrstuvwxyz0123456" === s ? 16 : 0) | (Number(s === "abcdefghijklmnopqrstuvwxyz0123456") << 5)); } },
    ofUnknowns: (list: unknown[], masks: number[]): void => { for (let i = 0; i < list.length; i++) { const x = list[i]; masks.push((x === "abcdefghijklmnopqrstuvwxyz0123456" ? 1 : 0) | (x !== "abcdefghijklmnopqrstuvwxyz0123456" ? 2 : 0) | (x == "abcdefghijklmnopqrstuvwxyz0123456" ? 4 : 0) | (x != "abcdefghijklmnopqrstuvwxyz0123456" ? 8 : 0) | ("abcdefghijklmnopqrstuvwxyz0123456" === x ? 16 : 0) | (Number(x === "abcdefghijklmnopqrstuvwxyz0123456") << 5)); } },
  },
  {
    text: "é",
    ofString: (s: string): number => (s === "é" ? 1 : 0) | (s !== "é" ? 2 : 0) | (s == "é" ? 4 : 0) | (s != "é" ? 8 : 0) | ("é" === s ? 16 : 0) | (Number(s === "é") << 5),
    ofOptional: (s: string | undefined): number => (s === "é" ? 1 : 0) | (s !== "é" ? 2 : 0) | (s == "é" ? 4 : 0) | (s != "é" ? 8 : 0) | ("é" === s ? 16 : 0) | (Number(s === "é") << 5),
    ofUnknown: (x: unknown): number => (x === "é" ? 1 : 0) | (x !== "é" ? 2 : 0) | (x == "é" ? 4 : 0) | (x != "é" ? 8 : 0) | ("é" === x ? 16 : 0) | (Number(x === "é") << 5),
    ofStrings: (list: string[], masks: number[]): void => { for (let i = 0; i < list.length; i++) { const s = list[i]; masks.push((s === "é" ? 1 : 0) | (s !== "é" ? 2 : 0) | (s == "é" ? 4 : 0) | (s != "é" ? 8 : 0) | ("é" === s ? 16 : 0) | (Number(s === "é") << 5)); } },
    ofOptionals: (list: (string | undefined)[], masks: number[]): void => { for (let i = 0; i < list.length; i++) { const s = list[i]; masks.push((s === "é" ? 1 : 0) | (s !== "é" ? 2 : 0) | (s == "é" ? 4 : 0) | (s != "é" ? 8 : 0) | ("é" === s ? 16 : 0) | (Number(s === "é") << 5)); } },
    ofUnknowns: (list: unknown[], masks: number[]): void => { for (let i = 0; i < list.length; i++) { const x = list[i]; masks.push((x === "é" ? 1 : 0) | (x !== "é" ? 2 : 0) | (x == "é" ? 4 : 0) | (x != "é" ? 8 : 0) | ("é" === x ? 16 : 0) | (Number(x === "é") << 5)); } },
  },
  {
    text: "\u{1F600}",
    ofString: (s: string): number => (s === "\u{1F600}" ? 1 : 0) | (s !== "\u{1F600}" ? 2 : 0) | (s == "\u{1F600}" ? 4 : 0) | (s != "\u{1F600}" ? 8 : 0) | ("\u{1F600}" === s ? 16 : 0) | (Number(s === "\u{1F600}") << 5),
    ofOptional: (s: string | undefined): number => (s === "\u{1F600}" ? 1 : 0) | (s !== "\u{1F600}" ? 2 : 0) | (s == "\u{1F600}" ? 4 : 0) | (s != "\u{1F600}" ? 8 : 0) | ("\u{1F600}" === s ? 16 : 0) | (Number(s === "\u{1F600}") << 5),
    ofUnknown: (x: unknown): number => (x === "\u{1F600}" ? 1 : 0) | (x !== "\u{1F600}" ? 2 : 0) | (x == "\u{1F600}" ? 4 : 0) | (x != "\u{1F600}" ? 8 : 0) | ("\u{1F600}" === x ? 16 : 0) | (Number(x === "\u{1F600}") << 5),
    ofStrings: (list: string[], masks: number[]): void => { for (let i = 0; i < list.length; i++) { const s = list[i]; masks.push((s === "\u{1F600}" ? 1 : 0) | (s !== "\u{1F600}" ? 2 : 0) | (s == "\u{1F600}" ? 4 : 0) | (s != "\u{1F600}" ? 8 : 0) | ("\u{1F600}" === s ? 16 : 0) | (Number(s === "\u{1F600}") << 5)); } },
    ofOptionals: (list: (string | undefined)[], masks: number[]): void => { for (let i = 0; i < list.length; i++) { const s = list[i]; masks.push((s === "\u{1F600}" ? 1 : 0) | (s !== "\u{1F600}" ? 2 : 0) | (s == "\u{1F600}" ? 4 : 0) | (s != "\u{1F600}" ? 8 : 0) | ("\u{1F600}" === s ? 16 : 0) | (Number(s === "\u{1F600}") << 5)); } },
    ofUnknowns: (list: unknown[], masks: number[]): void => { for (let i = 0; i < list.length; i++) { const x = list[i]; masks.push((x === "\u{1F600}" ? 1 : 0) | (x !== "\u{1F600}" ? 2 : 0) | (x == "\u{1F600}" ? 4 : 0) | (x != "\u{1F600}" ? 8 : 0) | ("\u{1F600}" === x ? 16 : 0) | (Number(x === "\u{1F600}") << 5)); } },
  },
];

const strictlyEqual = 1 | 4 | 16 | 32;
const looselyEqual = 2 | 4;
const different = 2 | 8;
const describe = (mask: number): string => (mask === strictlyEqual ? "=" : mask === looselyEqual ? "~" : mask === different ? "." : "(" + mask + ")");
const quoted = (text: string): string => '"' + text.split("").map(unit => (unit.charCodeAt(0) < 0x7f ? unit : "\\u" + unit.charCodeAt(0).toString(16).padStart(4, "0"))).join("") + '"';

function outsideLoops<T>(subjects: T[], compare: (subject: T) => number): string {
  const called = unseen(compare);
  return subjects.map(subject => describe(called(subject))).join("");
}

function inLoops<T>(subjectsOf: () => T[], compareAll: (list: T[], masks: number[]) => void): string {
  let line = "";
  for (let round = 0; round < 10; round++) {
    const masks: number[] = [];
    compareAll(subjectsOf(), masks);
    const next = masks.map(describe).join("");
    if (round > 0 && next !== line) return "round " + round + " differs: " + line + " " + next;
    line = next;
  }
  return line;
}

for (const check of checks) {
  const text = check.text;
  console.log(quoted(text));
  console.log("  string              " + outsideLoops(stringsFor(text), check.ofString));
  console.log("  string, loop        " + inLoops(() => stringsFor(text), check.ofStrings));
  console.log("  string | undefined  " + outsideLoops(optionalsFor(text), check.ofOptional));
  console.log("  the same, loop      " + inLoops(() => optionalsFor(text), check.ofOptionals));
  console.log("  unknown             " + outsideLoops(valuesFor(text), check.ofUnknown));
  console.log("  unknown, loop       " + inLoops(() => valuesFor(text), check.ofUnknowns));
}

const once: string = rope("abcdefgh");
const onceOptional: string | undefined = substring("ab");
const onceUnknown: unknown = wide("abcdefghijklmnopqrstuvwxyz0123456");
const onceMissing: string | undefined = opaque(undefined);
const onceAccented: string = wideSubstring("é");
const atTopLevel = [
  once === "abcdefgh", once === "abcdefgi", once !== "abcdefgh", once == "abcdefgh", once === "abcdefg", once === "abcdefghi", once === "", once === "é",
  onceOptional === "ab", onceOptional !== "ab", onceOptional === "a", onceOptional === "",
  onceUnknown === "abcdefghijklmnopqrstuvwxyz0123456", onceUnknown == "abcdefghijklmnopqrstuvwxyz0123456", onceUnknown === "abcdefghijklmnopqrstuvwxyz012345", onceUnknown === "7", onceUnknown === "\u{1F600}",
  onceMissing === "", onceMissing === "7", onceMissing == "ab", onceMissing !== "abcdefghi", onceMissing === "é",
  onceAccented === "é", onceAccented == "é", onceAccented === "e", onceAccented === "\u{1F600}",
];
console.log("top level " + atTopLevel.map(answer => (answer ? "=" : ".")).join(""));
