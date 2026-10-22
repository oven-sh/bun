class Greeter {
  greet(): string {
    return "method";
  }
}

function greet(g: Greeter): string {
  return g.greet();
}

const g = new Greeter();
console.log(greet(g));
g.greet = () => "own";
console.log(greet(g));
console.log(greet(new Greeter()));
Greeter.prototype.greet = () => "patched";
console.log(greet(new Greeter()));
console.log(greet(g));

export {};
