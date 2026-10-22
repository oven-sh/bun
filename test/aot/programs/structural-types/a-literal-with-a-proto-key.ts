interface Leaf {
  own: number;
  shared?: number;
  __proto__?: unknown;
}

const base = { shared: 7 };

function facts(label: string, o: Leaf): void {
  const walked: string[] = [];
  for (const key in o) walked.push(key);
  console.log(
    label +
      ": own " + o.own +
      " shared " + o.shared +
      " keys " + Object.keys(o).join() +
      " for-in " + walked.join() +
      " json " + JSON.stringify(o) +
      " spread " + JSON.stringify({ ...o }) +
      " prototype is base " + (Object.getPrototypeOf(o) === base) +
      " own __proto__ " + Object.hasOwn(o, "__proto__"),
  );
}

facts("a plain key sets the prototype", { __proto__: base, own: 1 });
facts("after another member", { own: 2, __proto__: base });
facts("a quoted key sets it too", { "__proto__": base, own: 3 });
facts("a computed key makes a member", { ["__proto__"]: base, own: 4 });

const __proto__ = base;
facts("shorthand makes a member", { __proto__, own: 5 });
facts("a method makes a member", {
  __proto__() {
    return base;
  },
  own: 6,
});

const withOwn = { ["__proto__"]: base, own: 7 };
facts("a spread copies the member as a member", { ...withOwn });

const nothing: Leaf = { __proto__: null, own: 8 };
console.log("null: " + (Object.getPrototypeOf(nothing) === null) + " " + Object.keys(nothing).join() + " " + nothing.own + " " + nothing.shared + " " + ("toString" in nothing));

const ignored: Leaf = { __proto__: 5, own: 9 };
console.log("a number is ignored: " + (Object.getPrototypeOf(ignored) === Object.prototype) + " " + Object.keys(ignored).join());

function make(parent: { shared: number } | null, own: number): Leaf {
  return { __proto__: parent, own };
}

let sum = 0;
for (let i = 0; i < 2000; i++) sum += make(base, i).shared ?? 0;
console.log("2000 with the base: " + sum);
console.log("then null: " + make(null, 1).shared + ", another: " + make({ shared: 9 }, 1).shared + ", the base: " + make(base, 1).shared);

base.shared = 70;
console.log("the base changed: " + make(base, 1).shared);

const chain: Leaf = { __proto__: { __proto__: { shared: 3 } }, own: 10 };
console.log("two levels: " + chain.shared + " " + Object.keys(chain).join());

const child: Leaf = { __proto__: base, own: 11 };
child.shared = 1;
console.log("a store makes an own member: " + JSON.stringify(child) + " " + base.shared);
delete child.shared;
console.log("deleted, the base shows again: " + child.shared + " " + JSON.stringify(child));

class Holder {
  leaf: Leaf = { __proto__: base, own: 12 };
  leaves: Leaf[] = [{ own: 13 }, { __proto__: base, own: 14 }, { own: 15, shared: 16 }];
  total(): number {
    let total = this.leaf.shared ?? 0;
    for (const leaf of this.leaves) total += leaf.shared ?? 0;
    return total;
  }
}
console.log("fields and elements: " + new Holder().total() + " " + JSON.stringify(new Holder()));

export {};
