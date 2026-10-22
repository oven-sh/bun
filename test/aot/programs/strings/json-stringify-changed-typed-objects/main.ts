import { Account, Money, Wallet, labeled, line, point, type Point } from "./records";
import { write } from "./writer.js";

function show(title: string, value: unknown, replacer?: unknown, indent?: unknown): void {
  console.log(title, write(value, replacer, indent));
}

function changed(change: (target: any) => void, target: Point = labeled(1, 2, "p")): Point {
  change(target);
  return target;
}

for (let round = 0; round < 2; round++) {
  show("plain", point(1, 2));
  show("nested", line());
  show("absent label", point(1, 2));
  show("undefined label", labeled(1, 2, undefined));
  show("label created late", changed((p) => (p.label = "late"), point(1, 2)));
  show("tag before label", changed((p) => ((p.tag = 1), (p.label = "l")), point(1, 2)));
  show("label before tag", changed((p) => ((p.label = "l"), (p.tag = 1)), point(1, 2)));

  show("added", changed((p) => (p.added = true)));
  show("added index", changed((p) => ((p[2] = "two"), (p[0] = "zero"), (p["1"] = "one"))));
  show("added symbol", changed((p) => (p[Symbol("s")] = 1)));
  show("deleted", changed((p) => delete p.x));
  show("deleted and created", changed((p) => (delete p.x, (p.x = 9))));
  show("other type", changed((p) => (p.x = "text")));
  show("hidden", changed((p) => Object.defineProperty(p, "y", { enumerable: false })));
  show("getter", changed((p) => Object.defineProperty(p, "y", { get: () => 42, enumerable: true })));
  show("getter that changes", changed((p) => Object.defineProperty(p, "x", { get: () => (delete p.label, 1), enumerable: true })));
  show("frozen", Object.freeze(labeled(1, 2, "f")));
  show("sealed", Object.seal(labeled(1, 2, "s")));

  show("own toJSON", changed((p) => (p.toJSON = () => "own")));
  show("own toJSON that is no function", changed((p) => (p.toJSON = 5)));
  show("hidden own toJSON", changed((p) => Object.defineProperty(p, "toJSON", { value: () => "hidden own" })));
  show("toJSON through a new prototype", changed((p) => Object.setPrototypeOf(p, { toJSON: () => "inherited" })));
  show("null prototype", changed((p) => Object.setPrototypeOf(p, null)));
  show("toJSON of a class", new Money(5, "EUR"));
  show("toJSON of a member", new Wallet("ann", new Money(7, "USD")));
  show("toJSON in an array", [new Money(1, "A"), point(1, 1), new Money(2, "B")]);

  show("undefined", changed((p) => (p.tag = undefined)));
  show("function", changed((p) => (p.tag = () => 1)));
  show("function with toJSON", changed((p) => (p.tag = Object.assign(() => 1, { toJSON: () => "f" }))));
  show("symbol", changed((p) => (p.tag = Symbol("t"))));
  show("array of nothing", changed((p) => (p.tag = [undefined, () => 1, Symbol("t")])));
  show("bigint", changed((p) => (p.tag = 10n)));
  show("boxed", changed((p) => (p.tag = [new Number(1), new String("s"), new Boolean(true), Object(2n)].slice(0, 3))));
  show("proxy", changed((p) => (p.tag = new Proxy(point(3, 4), {}))));
  show("proxy of an array", changed((p) => (p.tag = new Proxy([point(3, 4)], {}))));
  show("date", changed((p) => (p.tag = new Date(0))));
  show("invalid date", changed((p) => (p.tag = new Date(NaN))));
  show("map", changed((p) => (p.tag = new Map([[1, 2]]))));
  show("numbers", changed((p) => (p.tag = [-0, 0, NaN, Infinity, -Infinity, 1e21, 1e-7, 2 ** 31, -(2 ** 31), 0.1])));
  show("texts", changed((p) => (p.tag = ["", "\"", "\\", "\n\u0000\u001f", "\u007fé", "€", "😀", "\ud800", "\udc00x", "a".repeat(40)])));
  show("lone surrogate label", labeled(1, 2, "\udfff"));
  show("wide label", labeled(1, 2, "中文"));

  show("instance", new Account(1, "ann"));
  const used = new Account(2, "bob");
  used.describe();
  const handler = used.describe;
  show("instance whose closure exists", used);
  (handler as any).toJSON = () => "closure";
  show("instance whose closure has toJSON", used);

  const cycle: any = line();
  cycle.points.push(cycle.from);
  show("shared, no cycle", cycle);
  cycle.to.tag = cycle;
  show("cycle", cycle);
  const self: any = point(1, 2);
  self.tag = self;
  show("self", self);

  show("replacer function", line(), (key: string, value: unknown) => (key === "y" ? undefined : value));
  show("replacer array", line(), ["from", "x", "points"]);
  show("indent", labeled(1, 2, "i"), null, 2);
  show("indent text", line(), undefined, "--");
  show("empty indent", point(1, 2), undefined, "");
}

(Account.prototype as any).toJSON = function (this: Account) {
  return `account ${this.id}`;
};
show("toJSON added to the class", new Account(3, "cy"));
show("toJSON added to the class, in a member", { holder: new Account(4, "di"), at: point(1, 2) });
delete (Account.prototype as any).toJSON;
show("toJSON removed again", new Account(5, "ed"));
