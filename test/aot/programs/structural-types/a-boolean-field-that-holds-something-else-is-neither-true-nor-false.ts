class Switch {
  on: boolean = false;
  after = 7;
}
function text(s: Switch): string {
  if (s.on === true) return "true";
  if (s.on === false) return "false";
  return "neither " + typeof s.on + " " + (s.on === undefined) + " " + String(s.on);
}
const a = new Switch();
Reflect.set(a, "on", 1);
console.log(text(a), a.on ? "truthy" : "falsy", !a.on, a.on === true, a.after, JSON.stringify(a));
const b = new Switch();
Reflect.set(b, "on", "");
console.log(text(b), b.on ? "truthy" : "falsy", !b.on, b.on === false, b.after, JSON.stringify(b));
const c = new Switch();
Reflect.set(c, "on", undefined);
console.log(text(c), c.on ? "truthy" : "falsy", !c.on, c.on === false, c.after, JSON.stringify(c));
const d = new Switch();
Reflect.deleteProperty(d, "on");
console.log(text(d), d.on ? "truthy" : "falsy", d.after, JSON.stringify(d), Object.keys(d).join());
