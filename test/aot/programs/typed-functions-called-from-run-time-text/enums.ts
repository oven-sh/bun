// A typed function is handed to text that becomes code at run time, and called from there: parameters of a numeric and of a string enum.
function open<F>(f: F): F { (globalThis as any).held = f; return (0, eval)("globalThis.held"); }
enum Flags { None = 0, A = 1, B = 2, C = 4 }
enum Color { Red = "r", Green = "g" }
function probe(f: Flags, c: Color): number {
  return (f & Flags.B) + (f | Flags.C) + (c === Color.Red ? 1 : 0);
}
console.log(open(probe)(Flags.A | Flags.B, Color.Red));
