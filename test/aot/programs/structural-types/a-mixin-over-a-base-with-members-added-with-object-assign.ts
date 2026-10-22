function describe(made: object): string {
  return "keys [" + Object.keys(made).join(" ") + "] json " + JSON.stringify(made);
}

class Base {
  x = 1;
  constructor() {
    Object.assign(this, { added: "by assign" });
  }
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
