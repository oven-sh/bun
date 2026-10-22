// The namespace object is copied into a const, a let that changes, a class field and a Map, and read from there by plain and by computed names.
import * as first from "./first";
import * as second from "./second";

const alias = first;
console.log(alias.named());

let current: { pick(): string } = first;
console.log(current.pick());
current = second;
console.log(current.pick());

class Holder {
  lib = second;
  static lib = first;
}
console.log(new Holder().lib.inField(), Holder.lib.inStaticField());

const table = new Map<string, Record<string, any>>([["first", first], ["second", second]]);
console.log(table.get("first")!["in" + "Map"](), table.get("second")!["in" + "Map"]());
console.log((Math.random() < 2 ? first : second).inCondition());
