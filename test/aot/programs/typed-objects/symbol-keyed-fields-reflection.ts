// Every reflective operation sees a field keyed by a symbol as an ordinary own property: key lists and their order, in, delete, defineProperty, spread, assign, rest, JSON, structuredClone, freeze, seal.
const kHandle = Symbol("kHandle");
const kCount = Symbol("kCount");
const kLabel = Symbol("kLabel");
const kOther = Symbol("kOther");

class Socket {
  name: string;
  [kHandle]: number;
  port: number = 80;
  [kCount]: number = 0;
  [kLabel]?: string;
  constructor(name: string, handle: number) {
    this.name = name;
    this[kHandle] = handle;
  }
}

interface Request {
  url: string;
  [kHandle]: number;
  method: string;
  [kLabel]?: string;
}

function show(keys: (string | symbol)[]): string {
  return keys.map(key => String(key)).join(",");
}

function untyped(value: unknown): any {
  return value;
}

function inspect(what: string, object: object) {
  const any = untyped(object);
  console.log(what, "keys", Object.keys(object).join());
  console.log(what, "names", Object.getOwnPropertyNames(object).join());
  console.log(what, "symbols", show(Object.getOwnPropertySymbols(object)));
  console.log(what, "ownKeys", show(Reflect.ownKeys(object)));
  console.log(what, "entries", JSON.stringify(Object.entries(object)));
  console.log(what, "values", JSON.stringify(Object.values(object)));
  console.log(what, "json", JSON.stringify(object));
  const listed: string[] = [];
  for (const key in object) listed.push(key);
  console.log(what, "for-in", listed.join());
  console.log(what, "in", kHandle in object, kLabel in object, kOther in object);
  console.log(what, "hasOwn", Object.hasOwn(object, kHandle), Object.hasOwn(object, kLabel), Object.prototype.hasOwnProperty.call(object, kHandle));
  console.log(what, "enumerable", Object.prototype.propertyIsEnumerable.call(object, kHandle), Object.prototype.propertyIsEnumerable.call(object, kLabel));
  console.log(what, "descriptor", JSON.stringify(Object.getOwnPropertyDescriptor(object, kHandle)), JSON.stringify(Object.getOwnPropertyDescriptor(object, kLabel)));
  console.log(what, "descriptors", show(Reflect.ownKeys(Object.getOwnPropertyDescriptors(object))));
  console.log(what, "by key", any[kHandle], any[kLabel], any[kOther]);
  console.log(what, "Reflect.get", Reflect.get(object, kHandle), Reflect.has(object, kHandle), Reflect.has(object, kOther));
  const spread = { ...any };
  console.log(what, "spread", show(Reflect.ownKeys(spread)), spread[kHandle]);
  const assigned = Object.assign({}, object);
  console.log(what, "assign", show(Reflect.ownKeys(assigned)), untyped(assigned)[kHandle]);
  const { [kHandle]: taken, ...rest } = any;
  console.log(what, "rest", taken, show(Reflect.ownKeys(rest)));
  console.log(what, "clone", show(Reflect.ownKeys(structuredClone(object))));
}

const socket = new Socket("a", 7);
inspect("class", socket);
socket[kLabel] = "late";
inspect("class with label", socket);

const request: Request = { url: "/x", [kHandle]: 3, method: "GET" };
inspect("record", request);
request[kLabel] = "tag";
inspect("record with label", request);

untyped(socket)[kOther] = "extra";
inspect("class with an extra symbol", socket);
untyped(request)[kOther] = "extra";
untyped(request).more = 1;
inspect("record with extras", request);

console.log("delete", delete request[kLabel], kLabel in request, show(Reflect.ownKeys(request)));
request[kLabel] = "again";
console.log("again", show(Reflect.ownKeys(request)), request[kLabel]);
console.log("delete by key", delete untyped(socket)[kLabel], show(Reflect.ownKeys(socket)));

Object.defineProperty(request, kHandle, { value: 9, writable: true, enumerable: true, configurable: true });
console.log("defined", request[kHandle]);
console.log("Reflect.set", Reflect.set(request, kHandle, 10), request[kHandle]);
untyped(request)[kHandle] = 11;
console.log("stored by key", request[kHandle]);

const frozen: Request = { url: "/f", [kHandle]: 1, method: "PUT" };
Object.freeze(frozen);
console.log("frozen", Object.isFrozen(frozen), JSON.stringify(Object.getOwnPropertyDescriptor(frozen, kHandle)));
try {
  frozen[kHandle] = 2;
  console.log("stored to a frozen object");
} catch (error) {
  console.log("refused", error instanceof TypeError, frozen[kHandle]);
}
const sealed: Request = { url: "/s", [kHandle]: 1, method: "PUT" };
Object.seal(sealed);
sealed[kHandle] = 5;
console.log("sealed", Object.isSealed(sealed), sealed[kHandle], JSON.stringify(Object.getOwnPropertyDescriptor(sealed, kHandle)));

const ordered: Request = { url: "/o", [kHandle]: 1, method: "GET" };
untyped(ordered)[kOther] = 1;
untyped(ordered).late = 2;
ordered[kLabel] = "after";
console.log("order", show(Reflect.ownKeys(ordered)), show(Reflect.ownKeys({ ...ordered })), show(Object.getOwnPropertySymbols(ordered)));
delete untyped(ordered)[kLabel];
untyped(ordered)[kCount] = 3;
untyped(ordered)[kLabel] = "again";
console.log("order after delete", show(Reflect.ownKeys(ordered)), ordered[kLabel]);
Object.defineProperty(ordered, kLabel, { value: "hidden", enumerable: false, writable: true, configurable: true });
console.log("hidden", show(Reflect.ownKeys(ordered)), show(Reflect.ownKeys({ ...ordered })), ordered[kLabel], Object.prototype.propertyIsEnumerable.call(ordered, kLabel));
