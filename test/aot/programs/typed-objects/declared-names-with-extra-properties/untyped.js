import { Options, Packed, Extended, makeSettings, fillSettings, tag } from "./shapes.ts";

class Heir extends Extended {}
class HeirWithPort extends Extended {
  get port() { return -1; }
  set port(value) { this.seen = value; }
}
const nameOfHost = ["ho", "st"].join("");

function ask(o) {
  return [("host" in o), ("port" in o), ("maybe" in o), ("always" in o), ("id" in o), ("tag" in o), ("other" in o), ("fill" in o), ("toString" in o), (nameOfHost in o),
    Object.hasOwn(o, "host"), Object.hasOwn(o, "port"), Object.hasOwn(o, "tag"), o.hasOwnProperty("host"), o.propertyIsEnumerable("port")].map(Number).join("");
}

const makers = {
  Options: () => new Options(),
  Packed: () => new Packed(),
  Extended: () => new Extended(),
  Heir: () => new Heir(),
  HeirWithPort: () => new HeirWithPort(),
  record: () => makeSettings(1),
};
const fill = (o, i) => (o.fill ? o.fill(i) : fillSettings(o, i));
const steps = {
  bare: () => {},
  tagged: (o, i) => { o.tag = i; },
  taggedByTypedCode: (o, i) => { tag(o, i); },
  taggedUnderAKey: (o, i) => { o[["t", "ag"].join("")] = i; },
  filled: (o, i) => { fill(o, i); },
  taggedThenFilled: (o, i) => { o.tag = i; fill(o, i); },
  filledThenTagged: (o, i) => { fill(o, i); tag(o, i); },
  taggedFilledHostDeleted: (o, i) => { o.tag = i; fill(o, i); delete o.host; },
  taggedHostByName: (o, i) => { tag(o, i); o.host = "h"; },
  taggedMaybe: (o, i) => { tag(o, i); if (o.setMaybe) o.setMaybe(); },
  tagDeleted: (o, i) => { o.tag = i; delete o.tag; },
  frozen: (o, i) => { o.tag = i; fill(o, i); Object.freeze(o); },
};

export function run() {
  for (const maker in makers) {
    for (const step in steps) {
      const said = new Set();
      for (let i = 0; i < 12; i++) {
        const o = makers[maker]();
        steps[step](o, i);
        said.add(ask(o));
      }
      console.log(maker, step, [...said].join(" "));
    }
  }
  const before = [];
  const after = [];
  for (let i = 0; i < 20; i++) {
    const o = new Heir();
    o.tag = i;
    before.push(ask(o));
  }
  Object.defineProperty(Heir.prototype, nameOfHost, { get() { return "inherited"; }, configurable: true });
  for (let i = 0; i < 20; i++) {
    const o = new Heir();
    o.tag = i;
    after.push(ask(o));
  }
  delete Heir.prototype[nameOfHost];
  const o = new Heir();
  o.tag = 1;
  console.log("the heir's prototype gets the name", [...new Set(before)].join(" "), [...new Set(after)].join(" "), ask(o));
}
