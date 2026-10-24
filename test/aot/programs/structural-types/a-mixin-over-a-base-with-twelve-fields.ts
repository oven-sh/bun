function describe(made: object): string {
  return "keys [" + Object.keys(made).join(" ") + "] json " + JSON.stringify(made);
}

class Base {
  f0 = 0;
  f1 = 1;
  f2 = 2;
  f3 = 3;
  f4 = 4;
  f5 = 5;
  f6 = 6;
  f7 = 7;
  f8 = 8;
  f9 = 9;
  f10 = 10;
  f11 = 11;
}

function Tagged(Base: new () => object) {
  return class extends Base {
    tag = "tagged";
  };
}

const Made = Tagged(Base);
const made = new Made();
console.log(describe(made));
console.log("all own keys: " + Reflect.ownKeys(made).map(String).join(" "));
console.log("tag: " + made.tag + " instance: " + (made instanceof Base));
console.log("the base alone: " + describe(new Base()));
console.log("a second one: " + describe(new Made()));
