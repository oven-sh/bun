// Every call the program shows passes an int32 for these parameters of type number, so the compiler may test for one.
// Whatever else arrives, from a caller it doesn't see or through `any`, gives what plain Bun gives.

let limit = (process.argv.length + 1000000) | 0;

function makeAdder(k: number): (a: number) => number {
  return (a: number): number => {
    if (limit < 0) limit = (limit + 1) | 0;
    return (a + k) | 0;
  };
}

function sum(a: number, b: number): number {
  return a + b;
}

function half(a: number): number {
  return a / 2;
}

function index(list: number[], at: number): number | undefined {
  return list[at];
}

function twice(f: (a: number) => number, r: number): number {
  r = f(r);
  r = f(r);
  return r;
}

const launder = new Function("v", "return v") as <V>(v: V) => V;
const addTwo = launder(makeAdder(2));
const addThree = launder(makeAdder(3));
const list = [10, 20, 30];

let total = 0;
for (let i = 0; i < 1000; i++) {
  total = (total + twice((i & 1) === 0 ? addTwo : addThree, i) + sum(i, 1) + half(i * 2) + (index(list, i % 3) ?? 0)) | 0;
}
console.log("int32s only", total);

function show(value: unknown): string {
  return `${typeof value} ${Object.is(value, -0) ? "-0" : String(value)}`;
}

const impostors: unknown[] = [0.5, NaN, -0, 2 ** 31, -(2 ** 31) - 1, 2 ** 53, Infinity, -Infinity, 1e-300, "7", "", null, undefined, true, { valueOf: () => 4 }, [5], 6n];

for (const impostor of impostors) {
  const lines: string[] = [];
  const attempt = (label: string, run: () => unknown): void => {
    try {
      lines.push(`${label} ${show(run())}`);
    } catch (error) {
      lines.push(`${label} threw ${(error as Error).constructor.name}`);
    }
  };
  attempt("adder", () => addTwo(impostor as number));
  attempt("made with", () => makeAdder(impostor as number)(1));
  attempt("sum left", () => sum(impostor as number, 1));
  attempt("sum right", () => sum(1, impostor as number));
  attempt("half", () => half(impostor as number));
  attempt("index", () => index(list, impostor as number));
  attempt("twice", () => twice(addThree, impostor as number));
  console.log(`${show(impostor)}: ${lines.join("; ")}`);
}

const evaluated = new Function("adder", "sum", "half", "return [adder('1'), adder(1.5), sum('a', 'b'), sum(0.1, 0.2), half('9'), adder(), sum()].map(String).join()");
console.log("from evaluated text", evaluated(addTwo, sum, half));

total = 0;
for (let i = 0; i < 1000; i++) total = (total + twice(addTwo, i) + sum(i, 1)) | 0;
console.log("int32s again", total);
