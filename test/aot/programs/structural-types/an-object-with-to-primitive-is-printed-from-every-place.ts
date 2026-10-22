const log: string[] = [];

class Plain {
  n = 1;
}

class Speaking extends Plain {
  [Symbol.toPrimitive](hint: string): string {
    log.push(hint);
    return "speaking " + this.n;
  }
}

class Named extends Plain {
  toString(): string {
    log.push("toString");
    return "named " + this.n;
  }
}

class Holder {
  constructor(public item: Plain) {}
  text(): string {
    return `<${this.item}>`;
  }
}

function byParameter(p: Plain): string {
  return `<${p}>`;
}

function byPlus(p: Plain): string {
  return "<" + p + ">";
}

function byElement(list: Plain[]): string {
  return `<${list[0]}>` + list.join("+");
}

function byLocal(make: () => Plain): string {
  const local = make();
  return `<${local}>`;
}

function capture(p: Plain): () => string {
  return () => `<${p}>`;
}

function everywhere(label: string, make: () => Plain): void {
  log.length = 0;
  const parts = [byParameter(make()), byPlus(make()), new Holder(make()).text(), byElement([make(), make()]), byLocal(make), capture(make())(), String(make())];
  console.log(label + ": " + parts.join(" ") + " [" + log.join() + "]");
}

everywhere("plain, first", () => new Plain());
everywhere("with Symbol.toPrimitive, first", () => new Speaking());
everywhere("with toString, first", () => new Named());

let warm = 0;
for (let i = 0; i < 2000; i++) warm += byParameter(new Plain()).length + byPlus(new Plain()).length + new Holder(new Plain()).text().length + byElement([new Plain()]).length;
console.log("2000 plain ones: " + warm);
everywhere("with Symbol.toPrimitive, after them", () => new Speaking());
everywhere("with toString, after them", () => new Named());
everywhere("plain, again", () => new Plain());

everywhere("a plain one with an own toString", () => {
  const made = new Plain();
  made.toString = () => "own";
  return made;
});
everywhere("a plain one with an own Symbol.toPrimitive", () =>
  Object.assign(new Plain(), {
    [Symbol.toPrimitive]: () => "own primitive",
  }),
);

Plain.prototype.toString = function () {
  return "patched " + this.n;
};
everywhere("toString added to the plain class: plain", () => new Plain());
everywhere("toString added to the plain class: with Symbol.toPrimitive", () => new Speaking());
everywhere("toString added to the plain class: with toString", () => new Named());
Reflect.deleteProperty(Plain.prototype, "toString");
everywhere("removed", () => new Plain());

export {};
