exports.run = function (made) {
  const said = [];
  const tell = (name, f) => { try { said.push(name + ": " + f()); } catch (e) { said.push(name + ": " + e.name + ": " + e.message.replace(/ \(bun compile.*$/s, "")); } };
  tell("delete `only` of the first", () => delete made.makeA().only);
  tell("delete `other` of the second", () => delete made.makeB().other);
  tell("delete `only` of the second, which has none", () => delete made.makeB().only);
  tell("delete `other` of the first, which has none", () => delete made.makeA().other);
  tell("an accessor `other` on the first, which has none", () => { Object.defineProperty(made.makeA(), "other", { get() { return 1; }, configurable: true }); return "defined"; });
  tell("an accessor `other` on the second", () => { Object.defineProperty(made.makeB(), "other", { get() { return 1; }, configurable: true }); return "defined"; });
  tell("an accessor `only` on the first", () => { Object.defineProperty(made.makeA(), "only", { get() { return 1; }, configurable: true }); return "defined"; });
  tell("another prototype for the first", () => { Object.setPrototypeOf(made.makeA(), {}); return "set"; });
  tell("another prototype for the second", () => { Object.setPrototypeOf(made.makeB(), {}); return "set"; });
  tell("both still read", () => made.readA(made.makeA()) + " " + made.readB(made.makeB()));
  return said;
};
