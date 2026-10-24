// A record's fields that are born `undefined` may have no storage. Untyped code reads such fields of records that nothing ever stored to. The reads are cached: they do not enter the runtime every time.
interface Reply {
  statusCode: number;
  sent: boolean;
  url: string;
  peer: object | null;
  statusMessage: string | undefined;
  header: string | undefined;
  trailer: string | undefined;
  timeout: number | undefined;
  encoding: string | undefined;
  chunked: boolean | undefined;
  size: number | undefined;
  upgrade: object | undefined;
  first: string | undefined;
  second: string | undefined;
  third: string | undefined;
  fourth: string | undefined;
}
const make = (url: string): Reply => ({
  statusCode: 200,
  sent: false,
  url,
  peer: null,
  statusMessage: undefined,
  header: undefined,
  trailer: undefined,
  timeout: undefined,
  encoding: undefined,
  chunked: undefined,
  size: undefined,
  upgrade: undefined,
  first: undefined,
  second: undefined,
  third: undefined,
  fourth: undefined,
});
const count: (name: string) => number = (globalThis as any).aotOperationCount ?? (() => 0);
const replies: any[] = [];
for (let i = 0; i < 100; i++) replies.push(make("/" + i));
let undefinedOnes = 0;
const read = (reply: any) => {
  if (reply.statusMessage === undefined) undefinedOnes++;
  if (reply.header === undefined) undefinedOnes++;
  if (reply.trailer === undefined) undefinedOnes++;
  if (reply.timeout === undefined) undefinedOnes++;
  if (reply.encoding === undefined) undefinedOnes++;
  if (reply.chunked === undefined) undefinedOnes++;
  if (reply.size === undefined) undefinedOnes++;
  if (reply.upgrade === undefined) undefinedOnes++;
  if (reply.first === undefined) undefinedOnes++;
  if (reply.second === undefined) undefinedOnes++;
  if (reply.third === undefined) undefinedOnes++;
  if (reply.fourth === undefined) undefinedOnes++;
};
for (let i = 0; i < replies.length; i++) read(replies[i]);
const before = count("operationAOTGetByIdAndCache");
for (let turn = 0; turn < 100; turn++) for (let i = 0; i < replies.length; i++) read(replies[i]);
console.log(undefinedOnes, count("operationAOTGetByIdAndCache") - before < 100);

const inherited: any = make("/");
Object.setPrototypeOf(inherited, { fourth: "from the prototype", size: 1, other: "inherited" });
undefinedOnes = 0;
for (let turn = 0; turn < 100; turn++) read(inherited);
console.log(undefinedOnes, inherited.fourth, inherited.size, inherited.other, Object.hasOwn(inherited, "fourth"), Object.keys(inherited).length);
const prototype: any = {};
const later: any = make("/");
Object.setPrototypeOf(later, prototype);
undefinedOnes = 0;
for (let turn = 0; turn < 100; turn++) read(later);
prototype.fourth = "added to the prototype";
prototype.third = "too";
for (let turn = 0; turn < 100; turn++) read(later);
console.log(undefinedOnes, later.fourth, later.third);
