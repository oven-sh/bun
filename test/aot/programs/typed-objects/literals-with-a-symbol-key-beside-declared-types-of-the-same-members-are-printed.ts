// Literals with a symbol under a computed key stand beside declared types with the same members: an interface below a base with a numeric member, an intersection, a union, Partial, Readonly, a generic, a Record; each is printed.
interface Base {
  42: null;
}
interface Limits extends Base {
  maxByteLength: number;
}
interface Named {
  name: string;
}
type Both = Limits & Named;
type Either = Limits | Named;
interface Box<T> {
  held: T;
  size: number;
}
function pick(name: string): any {
  return (Symbol as any)[name];
}
function show(label: string, made: any) {
  console.log(label, made);
  console.log(label, "own keys", Reflect.ownKeys(made));
  console.log(label, "assigned", Object.assign({}, made));
  console.log(label, "spread", { ...made });
}
const known = (Symbol as any).asyncDispose;
const first = pick("asyncDispose");
const holder = {
  next() {
    const limits: Limits = 1 as any;
    const both: Both = 1 as any;
    const either: Either = 1 as any;
    const box: Box<number> = 1 as any;
    const part: Partial<Limits> = 1 as any;
    const fixed: Readonly<Limits> = 1 as any;
  },
};
console.log(holder);
show("beside an interface", { [known]() {}, maxByteLength: 1024 });
show("beside an interface, unknown key", { [first]() {}, maxByteLength: 1024 });
const limits: Limits = { [first]: 1, 42: null, maxByteLength: 1024 } as Limits;
show("as the interface", limits);
const both: Both = { [first]: 1, 42: null, name: "a", [known]: 2, maxByteLength: 1024 } as Both;
show("as an intersection", both);
const either: Either = { [first]: 1, name: "a" } as Either;
show("as a union", either);
const part: Partial<Limits> = { [first]: 1, maxByteLength: 1 } as Partial<Limits>;
show("as Partial", part);
const empty: Partial<Limits> = { [first]: 1 } as Partial<Limits>;
empty.maxByteLength = 2;
show("as Partial, stored later", empty);
const fixed: Readonly<Limits> = { [first]: 1, 42: null, maxByteLength: 1 } as Readonly<Limits>;
show("as Readonly", fixed);
function box<T>(held: T): Box<T> {
  return { [first]: 1, held, [known]: 2, size: 1 } as Box<T>;
}
show("through a generic", box(1));
show("through a generic", box("text"));
const parsed: Limits = JSON.parse('{"maxByteLength":1}');
(parsed as any)[first] = 2;
(parsed as any).more = 3;
show("parsed", parsed);
const record: Record<string, number> = { [first]: 1, size: 2 } as any;
record.count = 3;
show("as a Record", record);
