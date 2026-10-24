import { JSON, JSON as Codec, type Schema } from "bun";
import { validate as check } from "bun:bundle";
import { expectType } from "./utilities";

interface User {
  id: number & Schema.Int & Schema.Min<1>;
  name: string;
}
declare const text: string;
declare const user: User;

expectType(JSON.parse<User>(text)).is<User>();
expectType(JSON.parse<User>(text, (key, value) => value)).is<User>();
expectType(Codec.parse<User[]>(text)).is<User[]>();
expectType(Bun.JSON.parse<User>(text)).is<User>();
expectType(check<User>(user)).is<User>();
expectType(check(user)).is<unknown>();

expectType(JSON.parse(text)).is<any>();
expectType(JSON.parse<any>(text)).is<any>();
expectType(JSON.parse<unknown>(text)).is<unknown>();
const annotated: User = JSON.parse(text);
expectType(annotated).is<User>();

expectType(JSON.stringify(user)).is<string>();
expectType(JSON.stringify(user, null, 2)).is<string>();
expectType(JSON[Symbol.toStringTag]).is<string>();

const asGlobal: typeof globalThis.JSON = JSON;
const asImported: typeof JSON = globalThis.JSON;
function takesGlobal(codec: globalThis.JSON) {
  return codec.parse(text);
}
expectType(takesGlobal(JSON)).is<any>();
expectType(asGlobal.parse(text)).is<any>();
expectType(asImported.parse<User>(text)).is<User>();

// The global `JSON` has the one signature of the standard library, so TypeScript infers these parameters.
export const parse: typeof globalThis.JSON.parse = (from, reviver) => (reviver ? null : globalThis.JSON.parse(from));
export const parseWithoutReviver: typeof globalThis.JSON.parse = from => globalThis.JSON.parse(from.trim());
export const codec: Pick<globalThis.JSON, "parse"> = {
  parse(from, reviver) {
    return reviver ? null : globalThis.JSON.parse(from.trim());
  },
};
// @ts-expect-error
globalThis.JSON.parse<User>(text);
Promise.resolve(text)
  .then(JSON.parse)
  .then(value => expectType(value).is<any>());
const held: (from: string) => unknown = JSON.parse;
expectType(held(text)).is<unknown>();

// @ts-expect-error
JSON.parse<User, string>(text);
// @ts-expect-error
JSON.stringify<User>(user);
// @ts-expect-error
check<User>();
