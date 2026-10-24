// Nothing names an export of lib.ts: the program lists the namespace object in six ways and calls what it finds.
import * as lib from "./lib";

type Functions = Record<string, () => string>;
for (const key of Object.keys(lib)) console.log("keys", (lib as Functions)[key]());
for (const key in lib) console.log("for in", (lib as Functions)[key]());
for (const value of Object.values(lib)) console.log("values", value());
for (const [key, value] of Object.entries(lib)) console.log("entries", key, value());
for (const key of Reflect.ownKeys(lib)) if (typeof key === "string") console.log("own keys", Reflect.get(lib, key)());
for (const key of Object.getOwnPropertyNames(lib)) console.log("descriptor", Object.getOwnPropertyDescriptor(lib, key)!.value());
