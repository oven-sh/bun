// lib.ts is imported for one function and for the types of the others: `typeof import()`, an import used only in typeof, a type that lib.ts derives from a function nobody calls, and an inferred type that passes through two such functions.
import { used, type Config, type Deep } from "./lib";
import { unusedFactory } from "./lib";

const config: Config = { port: 80, host: "localhost" };
const deep: Deep = { inner: { value: 5 } };
const made: ReturnType<typeof unusedFactory> = { id: 1, tags: ["a"] };
const other: ReturnType<typeof import("./lib").neverImported> = "text";

console.log(used(config), deep.inner.value + 1, made.tags.length + made.id, other.toUpperCase());
