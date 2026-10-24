// `@mark(label())` on a parameter is written inside a method, yet it runs when the class is defined, whether or not anything names the class. label, labelOfConstructor and mark have no other reference.
const log: string[] = [];

function label(): string {
  return "a parameter of a method";
}

function labelOfConstructor(): string {
  return "a parameter of the constructor";
}

function mark(text: string) {
  return (target: object, member: string | undefined, index: number): void => {
    log.push(text + ", " + String(member) + " " + index);
  };
}

class Unnamed {
  constructor(@mark(labelOfConstructor()) first: number) {}
  method(first: number, @mark(label()) second: number): void {}
}

console.log(log.join("\n"));
