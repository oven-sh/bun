// Each export of lib.ts is reached once, through the namespace import, and each time the name is written in another way.
import * as lib from "./lib";

console.log(lib.plain());
console.log(lib["quoted"]());
console.log(lib[`template`]());
console.log(lib?.optional());
console.log(lib.optionalCall?.());
console.log(lib!.nonNull());
console.log((lib as any).cast());
console.log((lib satisfies object).satisfied());
console.log((lib).parenthesized());
console.log((0, lib.comma)());
console.log(lib.viaCall.call(undefined));
console.log(lib.tag`x`);
console.log(new lib.Constructed().value());
console.log(typeof lib.onlyTypeof);
console.log(lib.onlyName.name, lib.onlyLength.length);
