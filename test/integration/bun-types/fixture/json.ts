import { expectType } from "./utilities";

interface User {
  id: number;
  name: string;
  tags?: string[];
}
declare const text: string;
declare const user: User;

expectType(JSON.parse(text)).is<any>();
expectType(JSON.parse(text, (key, value) => value)).is<any>();
expectType(JSON.parse(text) as User).is<User>();

const annotated: User = JSON.parse(text);
expectType(annotated).is<User>();

function identity<T>(value: T): T {
  return value;
}
expectType(identity(JSON.parse(text))).is<any>();

export const parse: typeof JSON.parse = (from, reviver) => (reviver ? null : JSON.parse(from));
export const parseWithoutReviver: typeof JSON.parse = from => JSON.parse(from.trim());
export const stringify: typeof JSON.stringify = (value: unknown) => JSON.stringify(value);
expectType<ReturnType<typeof JSON.parse>>().is<any>();
expectType<Parameters<typeof JSON.parse>[0]>().is<string>();
Promise.resolve(text)
  .then(JSON.parse)
  .then(value => expectType(value).is<any>());
expectType([text].map(each => JSON.parse(each))).is<any[]>();
const held: (from: string) => unknown = JSON.parse;
expectType(held(text)).is<unknown>();

expectType(JSON.stringify(user)).is<string>();
expectType<Parameters<typeof JSON.stringify>[1]>().is<(string | number)[] | null | undefined>();
expectType(JSON.stringify(user, null, 2)).is<string>();
expectType(JSON.stringify(user, ["id"], "\t")).is<string>();
expectType(JSON.stringify(user, (key, value) => value)).is<string>();

class OwnTypeError extends TypeError {
  detail = 1;
}
expectType(new OwnTypeError("message").detail).is<number>();
