// The result of JSON.parse is cast to a type that it does not match and kept in a variable without an annotation:
// every operator has to produce what ECMAScript says for the actual values.
// string + anything is a string, and number - * / anything is a number, so a variable holding such a result keeps its inferred type. number + anything may be a string.
const data = JSON.parse('{"t":"abc","u":"d","n":5,"b":true,"z":null,"o":{"x":1},"l":["x","y"],"d":{"k":"v"}}') as { t: number; u: number; n: number; b: number; z: number; o: number; l: number[]; d: Record<string, number> };
const say = (label: string, f: () => unknown): void => { let r: string; try { const v = f(); r = typeof v + " " + String(v); } catch (e) { r = "throws " + (e as Error).constructor.name; } console.log(label + " ==> " + r); };
const one = [1].length;

// Nested operands: the operand is itself a binary, conditional or assignment expression.
say("1 + data.t + 1", () => 1 + data.t + 1);
say("data.t + 1 + 1", () => data.t + 1 + 1);
say("data.t + data.u + 1", () => data.t + data.u + 1);
say("data.n + data.t + data.u", () => data.n + data.t + data.u);
say("1 + (data.t + 1)", () => 1 + (data.t + 1));
say("string + (data.t + 1)", () => "a" + (data.t + 1));
say("(data.t + 1) - 1", () => data.t + 1 - 1);
say("(data.t + 1) * 2", () => (data.t + 1) * 2);
say("-(data.t + 1)", () => -(data.t + 1));
say("(data.t + 1) < 5", () => data.t + 1 < 5);
say("Math.max(data.t + 1, 2)", () => Math.max(data.t + 1, 2));
say("(c ? data.t : 1) + 1", () => (data.n ? data.t : 1) + 1);
say("(data.t || 1) + 1", () => (data.t || 1) + 1);
say("(data.t ?? 1) + 1", () => (data.t ?? 1) + 1);
say("(data.z ?? 1) + 1", () => (data.z ?? 1) + 1);
say("(data.t, data.u) + 1", () => (data.t, data.u) + 1);
say("(x = data.t) + 1", () => { let x = 0; return (x = data.t) + 1; });
say("(x += data.t) + 1", () => { let x = 0; return (x += data.t) + 1; });

// Element and computed-key accesses as operands.
const key = ["t"].join("") as "t" | "u";
say("data[key] + 1", () => data[key] + 1);
say("data[key] + data[key]", () => data[key] + data[key]);
say("data[key] * 2", () => data[key] * 2);
say("data.l[0] + 1", () => data.l[0] + 1);
say("data.l[one] + 1", () => data.l[one] + 1);
say("data.l[0] + data.l[1]", () => data.l[0] + data.l[1]);
say("data.l[5] + 1", () => data.l[5] + 1);
say("data.d.k + 1", () => data.d.k + 1);
say("data.d[key] + 1", () => data.d[key] + 1);
say("for of", () => { let s = ""; for (const v of data.l) s += v + 1; return s; });
say("map", () => data.l.map(v => v + 1));
say("reduce", () => data.l.reduce((a, v) => a + v, 0));

// Variables with inferred types.
for (const name of ["t", "n", "b", "z", "o"] as const) {
  say(name + ": string += data", () => { let s = ""; s += data[name]; s += "!"; return s; });
  say(name + ": string = string + data", () => { let s = "a"; for (let i = 0; i < 2; i++) s = s + data[name]; return s; });
  say(name + ": string = data + string", () => { let s = "a"; for (let i = 0; i < 2; i++) s = data[name] + s; return s; });
  say(name + ": length afterwards", () => { let s = ""; for (let i = 0; i < 3; i++) s += data[name]; return s.length; });
  say(name + ": number += data", () => { let n = 1; n += data[name]; return n; });
  say(name + ": number -= data", () => { let n = 1; n -= data[name]; return n; });
  say(name + ": number *= data", () => { let n = 2; n *= data[name]; return n; });
  say(name + ": number /= data", () => { let n = 2; n /= data[name]; return n; });
  say(name + ": number %= data", () => { let n = 7; n %= data[name]; return n; });
  say(name + ": number **= data", () => { let n = 2; n **= data[name]; return n; });
  say(name + ": number |= data", () => { let n = 1; n |= data[name]; return n; });
  say(name + ": number &= data", () => { let n = 7; n &= data[name]; return n; });
  say(name + ": number ^= data", () => { let n = 7; n ^= data[name]; return n; });
  say(name + ": number <<= data", () => { let n = 1; n <<= data[name]; return n; });
  say(name + ": number >>= data", () => { let n = 64; n >>= data[name]; return n; });
  say(name + ": number >>>= data", () => { let n = 64; n >>>= data[name]; return n; });
  say(name + ": number = data - number", () => { let n = 1; n = data[name] - n; return n; });
  say(name + ": number = data * data", () => { let n = 1; n = data[name] * data[name]; return n; });
  say(name + ": number = data + data", () => { let n = 1; n = data[name] + data[name]; return n; });
  say(name + ": number = -data", () => { let n = 1; n = -data[name]; return n; });
  say(name + ": number = ~data", () => { let n = 1; n = ~data[name]; return n; });
  say(name + ": number = +data", () => { let n = 1; n = +data[name]; return n; });
  say(name + ": number = number + (data - 1)", () => { let n = 1; n = n + (data[name] - 1); return n; });
  say(name + ": number = number + (data + 1)", () => { let n = 1; n = n + (data[name] + 1); return n; });
  say(name + ": toFixed afterwards", () => { let n = 0; for (let i = 0; i < 3; i++) n -= data[name]; return n.toFixed(1); });
}
