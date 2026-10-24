const edges: any[] = [0, 1, -1, 2, -2, 3, 7, 31, 32, 33, 255, 65535, 65536, 46340, 46341, -46341, 1073741823, 1073741824, -1073741824, 2147483646, 2147483647, -2147483647, -2147483648, 0.5, -0.5, 1e10, NaN, -0, "3", null, undefined, true];

function add(a: any, b: any): any { return a + b; }
function sub(a: any, b: any): any { return a - b; }
function mul(a: any, b: any): any { return a * b; }
function mod(a: any, b: any): any { return a % b; }
function and(a: any, b: any): any { return a & b; }
function or(a: any, b: any): any { return a | b; }
function xor(a: any, b: any): any { return a ^ b; }
function shl(a: any, b: any): any { return a << b; }
function shr(a: any, b: any): any { return a >> b; }
function ushr(a: any, b: any): any { return a >>> b; }

function show(value: any): string {
  return Object.is(value, -0) ? "-0" : String(value);
}

const operations: [string, (a: any, b: any) => any][] = [["+", add], ["-", sub], ["*", mul], ["%", mod], ["&", and], ["|", or], ["^", xor], ["<<", shl], [">>", shr], [">>>", ushr]];
for (const [name, operation] of operations) {
  let line = name + ":";
  let sum = 0;
  for (let i = 0; i < edges.length; i++) {
    for (let j = 0; j < edges.length; j++) {
      const result = operation(edges[i], edges[j]);
      const again = operation(edges[i], edges[j]);
      if (!Object.is(result, again)) line += " UNSTABLE" + i + "," + j;
      if (typeof result === "number" && result === result && Math.abs(result) < 1e15) sum += result % 1000003;
      if ((i * 31 + j) % 37 === 0) line += " " + show(result);
    }
  }
  console.log(line, "|", sum);
}

function operandsSurvive(a: any, b: any): string {
  const first = a + b;
  const second = a - b;
  const third = a * b;
  const fourth = a >>> b;
  return [show(first), show(second), show(third), show(fourth), show(a), show(b)].join(",");
}
console.log(operandsSurvive(2147483647, 1), operandsSurvive(-2147483648, 1), operandsSurvive(65536, 65536), operandsSurvive(-1, 0), operandsSurvive(0, -5));

function lengths(values: any[]): string {
  let out = "";
  for (const value of values) out += value.length + ",";
  return out;
}
console.log(lengths([[], [1], [1, 2, 3], new Array(70000), "", "abc", "abc" + "def".repeat(10), new Uint8Array(5), function (a: any, b: any) {}, { length: -3 }, { length: "x" }]));
