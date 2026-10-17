// A class in JavaScript extends a class with declared fields and has class fields of its own. Each is a definition: it asks no setter and no read-only property above, and gives the property the default attributes.
import { DefinesBorn, DefinesDeclared, DefinesDeclaredBelowSetter, heirsOf, parents } from "./heirs.js";

const show = (label: string, value: unknown) => console.log(label + ": " + JSON.stringify(value));
const attempt = (action: () => unknown): unknown => {
  try {
    return action();
  } catch (error) {
    return "throws " + (error as Error).constructor.name;
  }
};
function look(object: any): unknown[] {
  const own: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(object)) {
    const descriptor = Object.getOwnPropertyDescriptor(object, key)!;
    own[String(key)] = [descriptor.value, (descriptor.writable ? "w" : "") + (descriptor.enumerable ? "e" : "") + (descriptor.configurable ? "c" : "")];
  }
  return [object.describe(), Object.keys(object).join(), own];
}
for (const [name, parent] of Object.entries(parents)) {
  console.log("== under " + name);
  const heirs: Record<string, new (...given: unknown[]) => any> = heirsOf(parent);
  for (let round = 0; round < 6; round++) {
    const second = round === 3 || round === 4;
    for (const [label, heir] of Object.entries(heirs)) show(label + " " + round, attempt(() => look(new heir(round, second))));
  }
}
console.log("== fields that the parent declares");
for (let round = 0; round < 4; round++) {
  for (const [label, heir] of Object.entries({ DefinesDeclared, DefinesBorn, DefinesDeclaredBelowSetter })) {
    show(label + " " + round, attempt(() => look(new heir(round % 2 ? "with count" : round))));
  }
}
