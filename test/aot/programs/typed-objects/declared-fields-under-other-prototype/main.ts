// A class declares fields that no initializer defines. The first store creates each, and asks the prototype chain first: under a class that extends it in JavaScript the chain is not what the class itself has.
import { Core } from "./core";
import { Deep, OfValued, Plain, WithOwn, WithReadOnly, WithSetter, WithSetterLater, WithValue, storeFourth, storeThird } from "./heirs.js";

const show = (label: string, value: unknown) => console.log(label + ": " + JSON.stringify(value));
const attempt = (action: () => unknown): unknown => {
  try {
    return action();
  } catch (error) {
    return "throws " + (error as Error).constructor.name;
  }
};
const classes: [string, new (options: unknown) => any][] = [
  ["Core", Core],
  ["Plain", Plain],
  ["WithOwn", WithOwn],
  ["WithSetter", WithSetter],
  ["WithSetterLater", WithSetterLater],
  ["WithReadOnly", WithReadOnly],
  ["WithValue", WithValue],
  ["Deep", Deep],
];
function look(object: any): unknown[] {
  return [object.describe(), Object.keys(object).join(), String(object.caught), Object.hasOwn(object, "first"), Object.hasOwn(object, "third"), Object.hasOwn(object, "fourth")];
}
for (let round = 0; round < 4; round++) {
  console.log("== round " + round);
  for (const [label, constructor] of classes) {
    show(
      label,
      attempt(() => {
        const object = new constructor(round);
        const atBirth = look(object);
        object.later("later " + round);
        const afterwards = look(object);
        return [atBirth, afterwards];
      }),
    );
  }
  if (round === 1) {
    Object.defineProperty(WithSetterLater.prototype, "fourth", {
      set(value) {
        this.caught = "caught later " + value;
      },
      configurable: true,
    });
  }
  if (round === 2) delete (WithSetterLater.prototype as any).fourth;
}

console.log("== from code without the type");
for (let round = 0; round < 3; round++) {
  for (const [label, constructor] of classes) {
    show(
      label,
      attempt(() => {
        const object = new constructor(0);
        storeThird(object, round);
        storeFourth(object, "stored " + round);
        storeFourth(object, "stored again " + round);
        return look(object);
      }),
    );
  }
}

console.log("== in another order");
for (const [label, constructor] of classes) {
  show(
    label,
    attempt(() => {
      const object = new constructor(0);
      storeFourth(object, "fourth first");
      storeThird(object, 1);
      delete object.fourth;
      storeFourth(object, "fourth last");
      return look(object);
    }),
  );
}

console.log("== a class that is a value");
for (let round = 0; round < 3; round++) {
  const object = new OfValued(round);
  const before = Object.keys(object).join();
  object.fill("filled " + round);
  show("OfValued", [before, Object.keys(object).join(), object.one, object.two]);
}

console.log("== objects that take no more");
function closed(): unknown[] {
  const results: unknown[] = [];
  for (let i = 0; i < 4; i++) {
    const object = new Plain(0);
    if (i >= 2) Object.preventExtensions(object);
    results.push(attempt(() => (storeFourth(object, "x"), object.fourth)), attempt(() => (object.later("y"), object.fourth)));
  }
  return results;
}
show("Plain", closed());
