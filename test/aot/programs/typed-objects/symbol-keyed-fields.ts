// A member keyed by a symbol that a module-level constant holds is a field of the layout: classes, subclasses, interfaces, type literals, optional and union types.
// IR+ ^layout L[0-9]+ .*\{name=UniqueSymbol "[^"]*handle" declared=number
// IR= 0 bump (ElemGet|ElemSet)
// IR= 1 bump : number = PropGet v[0-9]+ name=UniqueSymbol "[^"]*count"
// IR= 1 bump PropSet v[0-9]+, v[0-9]+ name=UniqueSymbol "[^"]*count"
// IR= 1 bump : number = PropGet v[0-9]+ name=UniqueSymbol "[^"]*handle"
// IR= 0 readRequest ElemGet
// IR= 1 readRequest : number = PropGet v[0-9]+ name=UniqueSymbol "[^"]*handle"
// IR= 0 sum ElemGet
// IR= 1 sum : number = PropGet v[0-9]+ name=UniqueSymbol "[^"]*same"
// IR= 0 update (ElemGet|ElemSet)
// IR= 0 describe ElemGet
const kHandle = Symbol("handle");
const kCount = Symbol("count");
const kSame = Symbol("same");
const kSameAgain = Symbol("same");
const kNoDescription = Symbol();
const kCallback = Symbol("callback");

class Socket {
  name: string;
  [kHandle]: number;
  [kCount]: number = 0;
  constructor(name: string, handle: number) {
    this.name = name;
    this[kHandle] = handle;
  }
  bump(): number {
    this[kCount] += 1;
    return this[kHandle] + this[kCount];
  }
}

interface Request {
  url: string;
  [kHandle]: number;
}
function readRequest(request: Request): number {
  return request[kHandle] + request.url.length;
}

class Base {
  [kSame]: number = 1;
  plain = "p";
}
class Derived extends Base {
  [kSameAgain]: string = "b";
  [kNoDescription]: boolean = true;
  [kCallback] = () => 1;
  describe(): string {
    return this[kSame] + this[kSameAgain] + this[kNoDescription] + this.plain;
  }
}
interface Shared {
  [kSame]: number;
}
class Other implements Shared {
  [kSame]: number = 5;
}
function sum(values: Shared[]): number {
  let total = 0;
  for (const value of values) total += value[kSame];
  return total;
}

type Literal = { [kSame]: number; [kSameAgain]?: string | number; x: number };
function update(value: Literal): number {
  value[kSame] += 2;
  value[kSame]++;
  value[kSameAgain] ??= "set";
  return value[kSame];
}

(globalThis as { kept?: unknown }).kept = [readRequest, sum, update];
const socket = new Socket("a", 7);
let total = 0;
for (let i = 0; i < 10; i++) total += socket.bump();
console.log(total, readRequest({ url: "/x", [kHandle]: 3 }), Object.getOwnPropertySymbols(socket).length, Object.keys(socket).join());
const derived = new Derived();
console.log(derived.describe(), derived[kCallback].name, derived[kCallback]());
console.log(Reflect.ownKeys(derived).map(String).join());
console.log(kSame === (kSameAgain as symbol), kSame.description, kNoDescription.description, String(kNoDescription));
const literal: Literal = { [kSame]: 1, x: 2 };
console.log(update(literal), literal[kSameAgain], Reflect.ownKeys(literal).map(String).join());
console.log(sum([derived, new Other(), { [kSame]: 10 }]));
const named = { [kCallback]: function () {}, [kNoDescription]: () => {}, [kSame]: class {} };
console.log(JSON.stringify([named[kCallback].name, named[kNoDescription].name, named[kSame].name]));
const { [kSame]: first, x } = literal;
console.log(first, x, derived?.[kSame], (derived as Derived | undefined)?.[kSameAgain], kSame in literal, kHandle in literal);
console.log(delete literal[kSameAgain], kSameAgain in literal, Reflect.ownKeys(literal).map(String).join());
