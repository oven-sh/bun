enum Color {
  Red,
  Green,
}
class Pixel {
  color: Color = Color.Red;
  after = 7;
}
function text(p: Pixel): string {
  if (p.color === Color.Red) return "red";
  if (p.color === Color.Green) return "green";
  return "neither " + typeof p.color + " " + (p.color === undefined) + " " + String(p.color);
}
const a = new Pixel();
Reflect.set(a, "color", "0");
console.log(text(a), a.color + 1, a.color | 0, a.after, JSON.stringify(a));
const b = new Pixel();
Reflect.set(b, "color", undefined);
console.log(text(b), b.color + 1, b.color | 0, b.after, JSON.stringify(b));
const c = new Pixel();
Reflect.set(c, "color", 1.5);
console.log(text(c), c.color + 1, c.color | 0, c.after, JSON.stringify(c));
const d = new Pixel();
Reflect.set(d, "color", null);
console.log(text(d), d.color + 1, d.color | 0, d.after, JSON.stringify(d));
