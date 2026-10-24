function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  const parts: string[] = [];
  if (Array.isArray(value)) {
    const list: unknown[] = value;
    for (let i = 0; i < list.length; i++) parts.push(i in list ? show(list[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  for (const [key, member] of Object.entries(value)) parts.push(key + ": " + show(member));
  return "{" + parts.join(", ") + "}";
}

function numbers(): string {
  const a = [1, 2, 3];
  return show(a[3]) + " " + show(a[-1]) + " " + show(a[1.5]) + " " + show(a[-0]) + " " + show(a[NaN]) + " " + show(a[99]) + " " + show(a[3] + 1) + " " + show(a[3] | 0) + " " + typeof a[3] + " " + a.length;
}

function fractions(): string {
  const a = [0.5, 1.5];
  return show(a[2]) + " " + show(a[2] + 1) + " " + show(a[2] * 2) + " " + typeof a[2] + " " + show(a[2] === undefined) + " " + show(a[-1]);
}

function strings(): string {
  const a = ["a", "b"];
  return show(a[2]) + " " + show(a[2] + "!") + " " + typeof a[2] + " " + show(a[2] === "") + " " + show(a[-1]);
}

function stringsThenAMethod(): string {
  const a = ["a", "b"];
  try {
    return a[2].toUpperCase();
  } catch (error) {
    return "threw " + (error instanceof TypeError);
  }
}

function functionsThenACall(): string {
  const a = [() => 1, () => 2];
  try {
    return String(a[2]());
  } catch (error) {
    return "threw " + (error instanceof TypeError);
  }
}

function objectsThenAMember(): string {
  const a = [{ x: 1 }, { x: 2 }];
  try {
    return String(a[2].x);
  } catch (error) {
    return "threw " + (error instanceof TypeError);
  }
}

function texts(): string {
  const s = "abc";
  return show(s[3]) + " " + show(s[-1]) + " " + show(s[1.5]) + " " + show(s[-0]) + " " + typeof s[3] + " " + show(s[3] + "!") + " " + show(s.charAt(3)) + " " + show(s.charCodeAt(3)) + " " + show(s.at(3)) + " " + show(s.at(-1)) + " " + show(s.codePointAt(3)) + " " + s.length;
}

function directly(): string {
  return show([1, 2, 3][3]) + " " + show([1, 2, 3][-1]) + " " + show("abc"[3]) + " " + show("abc"[-1]) + " " + show([1, 2, 3].at(3)) + " " + show([1, 2, 3].at(-1)) + " " + show([][0]) + " " + show(""[0]) + " " + show("abc".charCodeAt(-1)) + " " + show([0.5][1]);
}

function tuples(): string {
  const t: [number, string] = [1, "a"];
  const index: number = 2;
  const negative: number = -1;
  return show(t[index]) + " " + show(t[negative]) + " " + typeof t[index] + " " + t.length;
}

function afterACut(): string {
  const a = [1, 2, 3];
  a.length = 1;
  return show(a[1]) + " " + show(a[2]) + " " + show(a[1] + 1) + " " + a.length + " " + show(a);
}

function afterGrowth(): string {
  const a = [1, 2, 3];
  a.length = 5;
  return show(a[3]) + " " + show(a[4] + 1) + " " + a.length + " " + show(a) + " " + (4 in a);
}

function afterAPop(): string {
  const a = [1, 2, 3];
  a.pop();
  return show(a[2]) + " " + show(a[2] + 1) + " " + a.length;
}

function afterADelete(): string {
  const a = [1, 2, 3];
  delete a[1];
  return show(a[1]) + " " + show(a[1] + 1) + " " + a.length + " " + show(a) + " " + (1 in a);
}

function newArray(): string {
  const a = new Array<number>(3);
  return show(a[0]) + " " + show(a[0] + 1) + " " + show(a[0] | 0) + " " + typeof a[0] + " " + a.length + " " + show(a) + " " + (0 in a);
}

function newArrayStoredTo(): string {
  const a = new Array<number>(3);
  a[1] = 5;
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i];
  return show(sum) + " " + show(a[0]) + " " + show(a[1]) + " " + show(a);
}

function destructured(): string {
  const two = [1, 2];
  const [a, b, c] = two;
  const [d, e] = "x";
  return show(a) + " " + show(b) + " " + show(c) + " " + show(d) + " " + show(e);
}

function sumOneTooFar(): string {
  const a = [1, 2, 3];
  let sum = 0;
  for (let i = 0; i <= 3; i++) sum += a[i];
  return show(sum);
}

console.log("numbers: " + numbers());
console.log("fractions: " + fractions());
console.log("strings: " + strings());
console.log("strings, then a method: " + stringsThenAMethod());
console.log("functions, then a call: " + functionsThenACall());
console.log("objects, then a member: " + objectsThenAMember());
console.log("texts: " + texts());
console.log("directly: " + directly());
console.log("tuples: " + tuples());
console.log("after a cut: " + afterACut());
console.log("after growth: " + afterGrowth());
console.log("after a pop: " + afterAPop());
console.log("after a delete: " + afterADelete());
console.log("new Array: " + newArray());
console.log("new Array, stored to: " + newArrayStoredTo());
console.log("destructured: " + destructured());
console.log("a sum one too far: " + sumOneTooFar());

export {};
