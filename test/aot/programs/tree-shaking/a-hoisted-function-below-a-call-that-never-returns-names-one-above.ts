// stop() has the type never, so a type checker calls what follows unreachable. `below` stands there, is hoisted and has run before; it holds the only references to what is declared above.
function above(): string {
  return "above";
}
const constantAbove = (): string => "constant above";
class ClassAbove {
  method(): string {
    return "class above";
  }
}
function stop(): never {
  (globalThis as any).process.exit(0);
  throw new Error("not reached");
}

console.log(below());
stop();

function below(): string {
  return [above(), constantAbove(), new ClassAbove().method()].join(", ");
}
