import { check } from "../src/show";
import { texts, getAt, putAt, inAt, delAt, forIn } from "fake-shapes/more";
import { readKey, hasKey, builtKey } from "fake-shapes";
const F = "33";
const here = (o: any, k: any) => o[k];
check(F, "the empty name", () => { const o: any = { "": 1, a: 2 }; const e = texts.empty; return [getAt(o, e), getAt(o, ""), here(o, e), here(o, ""), o[e], o[""], readKey(o, e), inAt(o, e), hasKey(o, e), e in o, Object.hasOwn(o, e), getAt(o, builtKey("", "")), getAt(o, "x".slice(1)), e === "", e.length, forIn(o), Object.keys(o)]; });
check(F, "stored there", () => { const o: any = {}; putAt(o, texts.empty, 5); return [o[""], getAt(o, ""), getAt(o, texts.empty), Object.keys(o), delAt(o, texts.empty), Object.keys(o)]; });
check(F, "a Map and a switch", () => { const m = new Map([["", 1]]); const s = (t: string) => { switch (t) { case "": return "empty"; default: return "other"; } }; return [m.get(texts.empty), new Set([texts.empty, ""]).size, s(texts.empty), JSON.stringify({ [texts.empty]: 1 }), JSON.parse('{"":7}')[texts.empty], getAt(JSON.parse('{"":7}'), texts.empty)]; });
