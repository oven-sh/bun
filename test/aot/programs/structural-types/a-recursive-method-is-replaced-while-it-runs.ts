const trace: string[] = [];

class Walker {
  down(n: number): number {
    trace.push("first " + n);
    if (n === 3) Walker.prototype.down = second;
    if (n <= 0) return 0;
    return 1 + this.down(n - 1);
  }
  ownDown(n: number): number {
    trace.push("method " + n);
    if (n === 2)
      this.ownDown = m => {
        trace.push("own " + m);
        return m <= 0 ? 0 : 100 + first.call(this, m - 1);
      };
    if (n <= 0) return 0;
    return 1 + this.ownDown(n - 1);
  }
  static depth(n: number): number {
    trace.push("static " + n);
    if (n === 2) Walker.depth = m => (trace.push("replaced static " + m), m * 1000);
    if (n <= 0) return 0;
    return 1 + Walker.depth(n - 1);
  }
}

const original = Walker.prototype.down;
const first = Walker.prototype.ownDown;
const originalDepth = Walker.depth;

function second(this: Walker, n: number): number {
  trace.push("second " + n);
  if (n === 1) Walker.prototype.down = original;
  if (n <= 0) return 0;
  return 10 + this.down(n - 1);
}

function run(label: string, body: () => number): void {
  trace.length = 0;
  const result = body();
  console.log(label + ": " + result + " [" + trace.join(", ") + "]");
}

const w = new Walker();
run("the prototype changes twice on the way down", () => w.down(5));
run("again", () => w.down(5));
run("short", () => w.down(2));

run("an own member appears on the way down", () => w.ownDown(4));
run("the own member stays", () => w.ownDown(2));
run("another instance", () => new Walker().ownDown(1));
Reflect.deleteProperty(w, "ownDown");
run("uncovered", () => w.ownDown(1));

run("a static method", () => Walker.depth(4));
run("it stays replaced", () => Walker.depth(4));
Walker.depth = originalDepth;
run("put back", () => Walker.depth(1));

let sum = 0;
const honest = new Walker();
for (let i = 0; i < 2000; i++) sum += honest.down(2) + honest.ownDown(1) + Walker.depth(1);
trace.length = 0;
console.log("2000 honest: " + sum);
run("then the prototype changes", () => honest.down(4));
run("then an own member", () => honest.ownDown(3));
run("then the static method", () => Walker.depth(3));

export {};
