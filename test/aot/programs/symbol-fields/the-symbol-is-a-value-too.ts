// The symbol that names a field is also stored in fields, compared, put into collections and handed around. It stays the same symbol.
export {};

const kSelf = Symbol("self");
class Holder {
  [kSelf]: symbol;
  constructor() {
    this[kSelf] = kSelf;
  }
}
const holder = new Holder();
const byKey = new Map<symbol, string>([[kSelf, "found"]]);
const wrapped = Object(kSelf);
console.log(
  (holder as any)[holder[kSelf]] === kSelf,
  byKey.get(holder[kSelf]),
  (holder as any)[wrapped] === kSelf,
  typeof wrapped,
  wrapped == kSelf,
  kSelf.description,
  kSelf.toString(),
  [kSelf].includes(holder[kSelf]),
);
try {
  console.log("" + (holder[kSelf] as any));
} catch (error) {
  console.log((error as Error).name);
}
