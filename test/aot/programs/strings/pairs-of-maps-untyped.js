// `for (const [k, v] of map)` allocates no pair when the pair is only destructured; everything else that is done with it, or with the Map meanwhile, is observable as usual (the same program without type annotations).
const print = (s) => console.log(s);
function show(x) {
  if (typeof x !== "string")
    return Object.is(x, -0) ? "-0" : String(x);
  let out = '"';
  for (let i = 0;i < x.length; i++) {
    const c = x.charCodeAt(i);
    out += c >= 32 && c < 127 ? x[i] : "\\u" + (c + 65536).toString(16).slice(1);
  }
  return out + '"';
}
function attempt(f) {
  try {
    return show(f());
  } catch (e) {
    return "throws " + e.name;
  }
}
function cat(a, b) {
  return a + b;
}
function cat3(a, b, c) {
  return `${a}${b}${c}`;
}
function part(s, from, to) {
  return s.slice(from, to);
}
function flattened(s) {
  s.charCodeAt(0);
  return s;
}
const log = [];
export function both(m) {
  let out = "";
  for (const [k, v] of m)
    out += k + "=" + v + ";";
  return out;
}
export function byNumber(m) {
  let out = "";
  for (const [k, v] of m)
    out += k + 1 + v + ";";
  return out;
}
export function keyOnly(m) {
  let out = "";
  for (const [k] of m)
    out += k + ";";
  return out;
}
export function valueOnly(m) {
  let n = 0;
  for (const [, v] of m)
    n += v;
  return n;
}
export function whole(m) {
  let out = "";
  for (const pair of m)
    out += pair.length + pair[0] + pair[1] + ";";
  return out;
}
export function kept(m) {
  const list = [];
  for (const pair of m) {
    const [k, v] = pair;
    if (v > 0)
      list.push(pair);
    log.push(k);
  }
  return list;
}
export function withDefault(m) {
  let out = "";
  for (const [k, v = -1] of m)
    out += k + v + ";";
  return out;
}
export function nestedPattern(m) {
  let out = "";
  for (const [k, [a, b]] of m)
    out += k + a + b + ";";
  return out;
}
export function three(m) {
  let out = "";
  for (const [k, v, w] of m)
    out += k + v + String(w) + ";";
  return out;
}
export function entriesOf(m) {
  let out = "";
  for (const [k, v] of m.entries())
    out += k + v + ";";
  return out;
}
export function changing(m) {
  let out = "";
  for (const [k, v] of m) {
    out += k + v + ";";
    if (v === 1)
      m.delete("b");
    if (v === 3) {
      m.set("z" + m.size, 30);
      m.set("a", 100);
    }
    if (v === 30 && m.size < 9)
      m.set("y" + m.size, 31);
  }
  return out;
}
export function clearing(m) {
  let out = "";
  for (const [k, v] of m) {
    out += k + v + ";";
    if (v === 2) {
      m.clear();
      m.set("new", 9);
    }
  }
  return out;
}
export function growing(m) {
  let n = 0;
  for (const [k, v] of m) {
    n += k * v;
    if (k < 300)
      m.set(k + 1000, 1);
    if (k % 3 === 0)
      m.delete(k + 1);
  }
  return n;
}
export function leaving(m, at) {
  let out = "";
  for (const [k, v] of m) {
    if (v === at)
      break;
    if (v === at - 1)
      continue;
    if (v === at + 10)
      return "R" + out;
    out += k;
  }
  return out;
}
export function throwing(m) {
  let out = "";
  for (const [k, v] of m) {
    try {
      if (v === 2)
        throw new Error(k);
      out += k;
    } catch (e) {
      out += "!" + e.message;
    }
  }
  try {
    for (const [k, v] of m) {
      if (v === 3)
        throw new Error("out " + k);
      out += v;
    }
  } catch (e) {
    out += e.message;
  }
  return out;
}
export function nestedLoops(m, n) {
  let out = "";
  for (const [k, v] of m)
    for (const [a, b] of n)
      for (const [k2] of m)
        out += k + v + a + b + k2 + ",";
  return out;
}
export async function awaiting(m) {
  let out = "";
  for (const [k, v] of m) {
    await null;
    out += k + v;
  }
  return out;
}
export function* yielding(m) {
  for (const [k, v] of m) {
    yield k;
    yield String(v);
  }
}

class Doubled extends Map {
  *[Symbol.iterator]() {
    for (const k of super.keys()) {
      log.push("own " + k);
      yield [k + k, 2 * super.get(k)];
    }
    return;
  }
}

class Closing extends Map {
  [Symbol.iterator]() {
    let i = 0;
    return { next: () => ({ done: i >= 3, value: ["c" + i, i++] }), return: () => {
      log.push("closed");
      return {};
    }, [Symbol.iterator]() {
      return this;
    } };
  }
}
const make = () => new Map([["a", 1], ["b", 2], ["c", 3], ["d", 4]]);
const numbers = new Map([[1, "x"], [2.5, "y"], [-0, "z"], [NaN, "n"]]);
print(both(make()) + " " + byNumber(numbers) + " " + keyOnly(make()) + " " + valueOnly(make()) + " " + whole(make()) + " " + kept(new Map([["p", 1], ["q", 0], ["r", 2]])).join("|") + " " + log.splice(0).join());
print(withDefault(new Map([["a", 1], ["b", undefined], ["c", 0]])) + " " + nestedPattern(new Map([["k", [1, "s"]], ["l", [2, "t"]]])) + " " + three(make()) + " " + entriesOf(make()));
print(changing(make()) + " " + clearing(make()) + " " + growing(new Map(Array.from({ length: 40 }, (_, i) => [i, i + 1]))) + " " + both(new Map) + "|" + valueOnly(new Map));
for (let at = 0;at < 6; at++)
  print(leaving(make(), at) + " " + leaving(new Map([["x", at + 10], ["y", 1]]), at));
print(throwing(make()) + " " + nestedLoops(new Map([["a", 1], ["b", 2]]), new Map([[7, "s"]])) + " " + [...yielding(make())].join(""));
print(both(new Doubled([["a", 1], ["b", 2]])) + " " + log.splice(0).join() + " " + both(new Closing) + " " + leaving(new Closing, 1) + " " + log.splice(0).join() + " " + valueOnly(new Doubled([["a", 5]])) + log.splice(0).join());
print(attempt(() => both(undefined)) + " " + attempt(() => both(null)) + " " + both(new Map([[cat("ro", "pe"), 1], [part("xsubx", 1, 4), 2], ["\u65E5", 3], ["", 4]])) + " " + both(new Map(Array.from({ length: 30 }, (_, i) => ["k" + i, i]))).length);
{
  const m = make();
  const seen = [];
  for (const [k, v] of m) {
    seen.push(k + v);
    for (let i = 0;i < 2000; i++)
      seen.length > 1e9 && seen.push("g" + i);
    if (typeof globalThis.gc === "function")
      globalThis.gc();
  }
  print(seen.join());
}
(async () => {
  print(await awaiting(make()));
  print((await Promise.all([awaiting(make()), awaiting(new Map([["z", 26]]))])).join());
})();
globalThis.kept = [both, byNumber, keyOnly, valueOnly, whole, kept, withDefault, nestedPattern, three, entriesOf, changing, clearing, growing, leaving, throwing, nestedLoops, awaiting, yielding];
console.log("number");
