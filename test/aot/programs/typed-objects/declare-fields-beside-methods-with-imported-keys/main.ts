// A `declare` field is left out of the layout of its class where the name of a method is computed and could be the field's own. A key read through `import * as` from a module that exports it as a const with a constant value is known, so the field keeps its place. A key that is reassigned, or is read from a TypeScript namespace, is not known.
// IR+ ^layout L[0-9]+ .*\{name="payload" declared=
// IR+ ^layout L[0-9]+ .*\{name="reasons" declared=
// IR- ^layout L[0-9]+ .*\{name="hidden" declared=
// IR- ^layout L[0-9]+ .*\{name="viaNamespace" declared=
import * as Keys from "./keys.ts";
import { inspectKey } from "./keys.ts";
declare const console: { log(...values: unknown[]): void };
abstract class Base {
  readonly tag: string;
  constructor(tag: string) {
    this.tag = tag;
  }
  abstract [Keys.equalKey](that: unknown): boolean;
  abstract [Keys.hashKey](): number;
  [inspectKey](): string { return `<${this.tag}>`; }
}
class Keyed extends Base {
  declare readonly payload: number;
  constructor(payload: number) {
    super("keyed");
    this.payload = payload;
  }
  [Keys.equalKey](that: unknown): boolean { return that instanceof Keyed && that.payload === this.payload; }
  [Keys.hashKey](): number { return this.payload * 31; }
}
class Group {
  declare readonly reasons: readonly Keyed[];
  constructor(reasons: readonly Keyed[]) {
    this.reasons = reasons;
  }
  [Keys.equalKey](that: unknown): boolean {
    return that instanceof Group && that.reasons.length === this.reasons.length && that.reasons.every((reason, i) => reason[Keys.equalKey](this.reasons[i]));
  }
  [Keys.hashKey](): number { return this.reasons.reduce((sum, reason) => sum + reason[Keys.hashKey](), 0); }
}
Keys.change("hidden");
class Unknown {
  declare hidden: unknown;
  [Keys.changing](): string { return "the method"; }
}
Keys.change("another");
namespace Local {
  export const key = "localKey";
}
class ByNamespace {
  declare viaNamespace: number;
  constructor(value: number) {
    this.viaNamespace = value;
  }
  [Local.key](): string { return "named by a namespace"; }
}
function show(value: any): string {
  return `${Object.getPrototypeOf(value).constructor.name} {${Reflect.ownKeys(value).map((key) => `${String(key)}=${JSON.stringify(value[key])}`).join()}}`;
}

const one = new Keyed(1);
const same = new Keyed(1);
const other = new Keyed(2);
console.log(show(one), one.payload, one[Keys.equalKey](same), one[Keys.equalKey](other), one[Keys.hashKey](), one[inspectKey](), "payload" in one, Object.keys(one).join());
console.log((one as any)["~kernel/Equal"](same), Object.getOwnPropertyNames(Keyed.prototype).join(), JSON.stringify(one));
const group = new Group([one, other]);
console.log(show(group), group[Keys.equalKey](new Group([same, new Keyed(2)])), group[Keys.equalKey](new Group([same])), group[Keys.hashKey](), group.reasons.length);

const unknown = new Unknown();
console.log(typeof unknown.hidden, (unknown.hidden as () => string)(), Object.keys(unknown).join(), "hidden" in unknown, Object.getOwnPropertyNames(Unknown.prototype).join());
unknown.hidden = 5;
console.log(unknown.hidden, Object.keys(unknown).join(), typeof Unknown.prototype.hidden);

const named = new ByNamespace(9);
console.log(show(named), named.viaNamespace, named[Local.key]());

let total = 0;
const kept: Keyed[] = [];
for (let i = 0; i < 500; i++) kept.push(new Keyed(i));
for (let i = 0; i < kept.length; i++) total += kept[i]!.payload + (kept[i]![Keys.equalKey](kept[(i * 7) % 500]) ? 1 : 0);
console.log(total);
