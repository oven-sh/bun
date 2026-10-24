// A host object and built-in objects satisfy an object type of the program's own and are stored into a field of a class and of a literal declared with it.
type Sized = { length: number };
type Platform = { platform: string; env: Record<string, string | undefined> };

class Probe {
  constructor(private readonly host: Platform = process) {}
  kind(): string {
    return typeof this.host.platform + " " + typeof this.host.env.PATH + " " + (this.host === process);
  }
}
function wrap(sized: Sized) {
  return { sized, twice: sized.length * 2 };
}
function measure(box: { sized: Sized; twice: number }): string {
  return box.sized.length + " " + box.twice + " " + typeof box.sized;
}
console.log(new Probe().kind());
console.log(new Probe({ platform: "none", env: {} }).kind());
console.log(new Probe().kind());
const boxes = [wrap("four"), wrap([1, 2, 3]), wrap({ length: 9 }), wrap(function (a: number, b: number) {}), wrap(new Uint8Array(5))];
for (const box of boxes) console.log(measure(box));
const box = wrap({ length: 1 });
for (const sized of ["ab", [1], { length: 7 }, new Float64Array(2)] as Sized[]) {
  box.sized = sized;
  console.log(measure(box));
}
