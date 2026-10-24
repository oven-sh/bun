// With "strict" a field without an initializer must be assigned in the constructor, and a function with a return type must return on every path. Whether that holds is read from bodies that nobody calls here. A build that does not look into them must not report what they prove.
class NeverConstructed {
  first: number;
  second: string;
  readonly third: boolean;
  constructor(flag: boolean) {
    this.first = 1;
    if (flag) this.second = "a";
    else this.second = "b";
    this.third = flag;
  }
}
function neverCalled(value: number | string): string {
  if (typeof value === "number") return "number";
  else return value;
}
function alwaysThrows(): never {
  throw new Error("never called");
}
function usesNever(value: string | undefined): string {
  if (value === undefined) alwaysThrows();
  return value;
}
let assignedInBody: number;
function assigns() {
  assignedInBody = 1;
}
type Instance = InstanceType<typeof NeverConstructed>;
const literal: Instance = { first: 2, second: "c", third: true };

console.log(literal.first, literal.second, literal.third);
