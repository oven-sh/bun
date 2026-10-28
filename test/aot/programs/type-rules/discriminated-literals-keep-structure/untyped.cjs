const name = ["f", "kind", "x"];
exports.run = function (makers) {
  const said = [];
  const tell = (what, f) => { try { said.push(what + ": " + f()); } catch (e) { said.push(what + ": " + e.name + ": " + e.message.split(":")[0]); } };
  for (const [holder, make] of makers) {
    tell(holder + " | a boolean by key", () => { const o = make(); o[name[0]] = true; return typeof o.f; });
    tell(holder + " | an object by Reflect.set", () => Reflect.set(make(), "f", {}));
    tell(holder + " | a boolean by Object.assign", () => typeof Object.assign(make(), { f: true }).f);
    tell(holder + " | delete by key", () => delete make()[name[0]]);
    tell(holder + " | an accessor", () => { Object.defineProperty(make(), "f", { get() { return 1; }, configurable: true }); return "defined"; });
    tell(holder + " | another prototype", () => { Object.setPrototypeOf(make(), { other: 1 }); return "set"; });
    tell(holder + " | a name that is not declared", () => { const o = make(); o.extra = 1; return Object.keys(o).join(); });
  }
  return said;
};
