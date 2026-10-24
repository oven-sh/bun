// An object that Reflect.construct makes with the constructor of one class for another class has the fields of the first and the prototype of the second: `instanceof` follows the prototype.
class Journal {
  lines: string[] = [];
  size(): number {
    return this.lines.length;
  }
}
class Quiet {
  lines: string[] = [];
  size(): number {
    return -1;
  }
}
function louder(Base: any): any {
  return class extends Base {};
}
let current: Journal | null = new Journal();
function attempt(what: string, run: () => unknown): void {
  console.log(what, run());
}
attempt("a subclass made by value", () => {
  const Louder = louder(Journal);
  current = new Louder() as Journal;
  return current instanceof Journal;
});
attempt("constructed for another class", () => {
  current = Reflect.construct(Journal, [], Quiet) as Journal;
  return current.size() + " " + (current instanceof Journal);
});
