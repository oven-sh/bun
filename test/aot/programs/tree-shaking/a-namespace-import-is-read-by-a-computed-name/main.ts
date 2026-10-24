// The name is put together at run time, so every export of lib.ts may be the one that is called.
import * as lib from "./lib";

const names = ["al" + "pha", ["be", "ta"].join(""), String.fromCharCode(103, 97, 109, 109, 97)];
for (const name of names) console.log((lib as Record<string, () => string>)[name]());
