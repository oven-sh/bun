const log: string[] = [];

class Box {
  width = 2;
  height = 3;
  get area(): number {
    log.push("get area");
    return this.width * this.height;
  }
  get label(): string {
    log.push("get label");
    return "box";
  }
  set label(value: string) {
    log.push("set label " + value);
  }
  doubled(): number {
    return this.area * 2;
  }
}

class Holder {
  constructor(public box: Box) {}
  ask(): number {
    return this.box.area;
  }
}

function byParameter(b: Box): number {
  return b.area;
}

function byElement(list: Box[]): number {
  return list[0].area;
}

function labelOf(b: Box): string {
  return b.label;
}

function relabel(b: Box, value: string): string {
  b.label = value;
  return b.label;
}

const changed = new Box();
const honest = new Box();
const holder = new Holder(changed);
const list = [changed];
const captured = (): number => changed.area;

function everywhere(label: string): void {
  const local = changed;
  const values = [changed.area, local.area, byParameter(changed), holder.ask(), byElement(list), captured(), changed.doubled()];
  console.log(label + ": " + values.join(" ") + ", getter ran " + log.length + " times");
  log.length = 0;
  console.log(label + ", the label: " + labelOf(changed) + " " + relabel(changed, "new") + " [" + log.join(", ") + "]");
  log.length = 0;
  console.log(label + ", the honest one: " + byParameter(honest) + " " + honest.doubled() + " " + labelOf(honest) + ", own " + Object.hasOwn(changed, "area") + " " + Object.hasOwn(changed, "label") + ", keys " + Object.keys(changed).join() + ", json " + JSON.stringify(changed));
  log.length = 0;
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += byParameter(changed) + holder.ask() + byElement(list) + captured() + changed.doubled() + labelOf(changed).length;
log.length = 0;
console.log("2000 honest: " + warm);
everywhere("before");

Object.defineProperty(changed, "area", { value: 99, writable: true, enumerable: true, configurable: true });
everywhere("area is an own value");

Object.defineProperty(changed, "label", { value: "own label", writable: true, enumerable: true, configurable: true });
everywhere("label is an own value too");

changed.width = 10;
everywhere("after a store to the width");

Reflect.deleteProperty(changed, "area");
Reflect.deleteProperty(changed, "label");
everywhere("uncovered");

Object.defineProperty(changed, "area", { value: undefined, configurable: true });
everywhere("an own undefined that is not listed");

Object.defineProperty(changed, "area", {
  get() {
    log.push("own getter");
    return -1;
  },
  configurable: true,
});
everywhere("an own getter");

Reflect.deleteProperty(changed, "area");
everywhere("restored");

export {};
