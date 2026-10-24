function early(): number {
  return Kind.Late;
}
let seen: unknown;
try {
  seen = early();
} catch (error) {
  seen = (error as Error).constructor.name;
}
console.log("before the enum ran", seen);
enum Kind {
  Soon,
}
console.log("between the parts", (Kind as any).Late, early());
enum Kind {
  Late = 7,
}
console.log("after both", Kind.Late, early());
namespace Outer {
  export enum Inner {
    One = 1,
  }
  export const atStart = [Inner.One, (Inner as any).Two];
  export function two(): number {
    return Inner.Two;
  }
  export const twoAtStart = two();
}
console.log(Outer.atStart, Outer.twoAtStart, Outer.Inner.Two);
namespace Outer {
  export enum Inner {
    Two = 2,
  }
  export const atEnd = [Inner.One, Inner.Two];
}
console.log(Outer.atEnd, Outer.two(), Outer.Inner.Two);
