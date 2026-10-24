import { one } from "./values.mjs";
(globalThis.ran ??= []).push("other");
export default n => n * 100 + one;
