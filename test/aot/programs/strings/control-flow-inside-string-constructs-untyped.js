// `try`, `await`, `yield`, labelled `break` and `return` inside every string construct that the compiler treats specially (the same program without type annotations).
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
function boom(when, what) {
  if (when)
    throw new Error(what);
  return what;
}
export function switchCaught(s) {
  let out = "";
  switch (s) {
    case "one":
      try {
        out += boom(true, "1");
      } catch (e) {
        out += "c" + e.message;
      }
      break;
    case "two":
      try {
        out += "2";
        break;
      } finally {
        out += "f";
      }
    case "three":
      out += "3";
    case "four":
      try {
        return out + "4";
      } finally {
        log.push("left " + s);
      }
    default:
      try {
        out += boom(s.length > 6, "d");
      } catch {
        out += "D";
      }
  }
  return out + ".";
}
export function switchInTry(s) {
  try {
    switch (s) {
      case "one":
        return "1";
      case "two":
        throw new Error("two");
      case "three":
        return boom(true, "three");
      case "four":
        break;
      default:
        return "d";
    }
    return "after";
  } catch (e) {
    switch (e.message) {
      case "two":
        return "caught two";
      case "three":
        return "caught three";
      default:
        return "caught?";
    }
  } finally {
    log.push("f:" + s);
  }
}
export function chainLabelled(list) {
  let out = "";
  outer:
    for (const s of list) {
      for (let k = 0;k < 2; k++) {
        if (s === "skip")
          continue outer;
        else if (s === "stop")
          break outer;
        else if (s === "inner")
          break;
        else if (s === "ret")
          return out + "R";
        out += s[0] + k;
      }
      out += ";";
    }
  return out;
}
export async function switchAwaited(s) {
  let out = "";
  switch (s) {
    case "one":
      out += await Promise.resolve("1");
      break;
    case "two":
      await null;
      out += "2";
    case "three":
      out += "3";
      await null;
      break;
    default:
      try {
        await Promise.reject(new Error("r"));
      } catch {
        out += "d";
      }
  }
  if (s === "one")
    out += "!";
  else if (s === "two") {
    await null;
    out += "?";
  } else if (s === "three")
    out += "#";
  return out;
}
export function* switchYielded(s) {
  switch (s) {
    case "one":
      yield "1";
      break;
    case "two":
      yield "2";
    case "three":
      yield "3";
      return;
    default:
      try {
        yield "d";
      } finally {
        yield "f";
      }
  }
  yield s === "one" ? "end one" : s === "two" ? "end two" : "end";
}
export function searchCaught(s) {
  let out = "";
  try {
    if (s.startsWith("li"))
      out += boom(s.includes("!"), "L");
    if (s.endsWith("x"))
      return out + "X";
  } catch (e) {
    out += s.startsWith("lit") ? "lit" : s.includes("!") ? "bang" : "?";
  } finally {
    out += s.indexOf("t") + "";
    log.push(out);
  }
  return out;
}
export async function searchAwaited(s) {
  const a = s.startsWith("li");
  await null;
  const b = s.includes("!");
  await null;
  return a + "," + b + "," + s.endsWith("x") + "," + await Promise.resolve(s.indexOf("t"));
}
export function madeCaught(s, bad) {
  try {
    const re = new RegExp("ma+de", bad ? "gg" : "g");
    return String(re.test(s)) + re.lastIndex;
  } catch (e) {
    return e.name + new RegExp("ma+de").test(s);
  } finally {
    log.push(String(new RegExp("ma+de", "i").test(s)));
  }
}
export function loopLabelled(s, t) {
  let h = 0;
  outer:
    for (let i = 0;i < s.length; i++) {
      for (let j = 0;j < t.length; j++) {
        const c = t.charCodeAt(j);
        if (c === 45)
          continue outer;
        if (c === 33)
          break outer;
        if (c === 63)
          return -h;
        h = h + s.charCodeAt(i) + c | 0;
      }
      h = h * 31 | 0;
    }
  return h;
}
export function loopFinally(s) {
  let h = 0;
  for (let i = 0;i <= s.length + 1; i++) {
    try {
      if (i === 1)
        continue;
      if (i === 4)
        break;
      h = h + s.charCodeAt(i) | 0;
    } finally {
      h = h * 3 + s.length | 0;
    }
  }
  return h;
}
export function loopInHandler(s) {
  let h = 0;
  try {
    boom(s.length > 2, "x");
    for (let i = 0;i < s.length; i++)
      h = h + s.charCodeAt(i) | 0;
  } catch {
    for (let i = s.length;i-- > 0; )
      h = h * 7 + s.charCodeAt(i) | 0;
  } finally {
    for (let i = 0;i < s.length; i += 2)
      h = h ^ s.charCodeAt(i) | 0;
  }
  return h;
}
export function loopReturns(s, wanted) {
  for (let i = 0;i < s.length; i++) {
    if (s.charCodeAt(i) === wanted)
      return i;
  }
  return -1;
}
export function* loopYieldsLabelled(s) {
  outer:
    for (let i = 0;i < s.length; i++) {
      for (let j = i;j < s.length; j++) {
        if (s.charCodeAt(j) === 45)
          continue outer;
        if (s.charCodeAt(j) === 33)
          break outer;
        yield s.charCodeAt(i) + s.charCodeAt(j) | 0;
      }
    }
}
export async function loopAwaitsCaught(s) {
  let h = 0;
  for (let i = 0;i <= s.length; i++) {
    try {
      await null;
      boom(i === 1, "x");
      h = h + s.charCodeAt(i) | 0;
    } catch {
      h = ~h;
    } finally {
      await null;
      h = h + s.length | 0;
    }
  }
  return h;
}
export function lastIndexCaught(re, s) {
  let out = "";
  for (let i = 0;i < 4; i++) {
    try {
      re.lastIndex = i;
      const m = re.exec(s);
      out += (m ? m[0] : "-") + re.lastIndex;
    } catch (e) {
      out += e.name[0] + re.lastIndex;
    } finally {
      out += ",";
    }
  }
  return out;
}
export async function lastIndexAwaited(re, s) {
  re.lastIndex = 1;
  await null;
  const a = re.lastIndex;
  const m = re.exec(s);
  await null;
  re.lastIndex += 1;
  return a + ":" + (m && m[0]) + ":" + re.lastIndex;
}
export function* lastIndexYielded(re, s) {
  for (let i = 0;i < s.length; i = re.lastIndex > i ? re.lastIndex : i + 1) {
    re.lastIndex = i;
    yield String(re.lastIndex);
    const m = re.exec(s);
    yield m ? m[0] : "-";
  }
}
export function untypedCaught(s, i, j) {
  let out = "";
  try {
    out += s.charCodeAt(i);
    out += "," + s.slice(i, j);
    out += "," + s.includes(j);
    out += "," + s.indexOf(j, i);
    out += "," + s.at(i);
  } catch (e) {
    out += "!" + (e.name === "Error" ? e.message : e.name);
  } finally {
    out += ";";
  }
  return out;
}
export async function untypedAwaited(s, i) {
  return s.charCodeAt(await i) + "," + (await s).slice(await i, await i + 2) + "," + s.at(await Promise.resolve(i));
}
export function* untypedYielded(s) {
  const i = yield s.length;
  const j = yield s.charCodeAt(i);
  return s.slice(i, j) + s.includes(yield "?");
}
export function keyCaught(m, a, b) {
  try {
    const found = m.get(a.id + "," + b.id);
    if (found === undefined)
      throw new Error("none " + a.id + ":" + b.id);
    return "f" + found;
  } catch (e) {
    m.set(a.id + "," + b.id, m.size);
    return e.message;
  } finally {
    log.push(String(m.has(b.id + "," + a.id)));
  }
}
export async function keyAwaited(m, a, b) {
  const had = m.has(a.id + ":" + b.id);
  await null;
  m.set(a.id + ":" + await Promise.resolve(b.id), 1);
  return had + "," + m.has(a.id + ":" + b.id) + "," + m.get(`${a.id}:${b.id}`);
}
export function* keyYielded(m, list) {
  outer:
    for (const a of list)
      for (const b of list) {
        if (a.id === 3)
          continue outer;
        if (b.id === 4)
          break outer;
        yield m.get(a.id + "," + b.id);
        m.set(a.id + "," + b.id, a.id * 10 + b.id);
      }
}
export function charactersLabelled(s, t) {
  let out = "";
  outer:
    for (const c of s) {
      for (const d of t) {
        if (d === "-")
          continue outer;
        if (d === "!")
          break outer;
        if (d === "?")
          return out + "R";
        out += c + d;
      }
      out += ";";
    }
  return out;
}
export function charactersFinally(s) {
  let out = "";
  for (const c of s) {
    try {
      if (c === "b")
        continue;
      if (c === "d")
        break;
      if (c === "r")
        return out + "R";
      out += c;
    } finally {
      out += ".";
    }
  }
  return out;
}
const texts = ["one", "two", "three", "four", "five", "sixseven", cat("o", "ne"), part("xtwox", 1, 4), "", "On\xE9", "\u65E5"];
for (const s of texts)
  print(show(s) + " " + switchCaught(s) + " " + switchInTry(s) + " " + [...switchYielded(s)].join() + " | " + log.splice(0).join());
print(chainLabelled(["ab", "inner", "skip", "cd", "stop", "ef"]) + " " + chainLabelled(["x", "ret", "y"]) + " " + chainLabelled([cat("sk", "ip"), cat("in", "ner"), "z"]) + " " + chainLabelled([]));
for (const s of ["lit", "li!", "lix", "li!x", "x", "", "tli", cat("li", "t!"), "l\xED"])
  print(show(s) + " " + searchCaught(s) + " " + madeCaught(s + "maade", s.length === 3) + " | " + log.splice(0).join());
for (const [s, t] of [["abc", "xy"], ["abc", "x-y"], ["abc", "x!y"], ["abc", "x?y"], ["", "x"], ["abc", ""], [cat("a", "\u65E5c"), part("--xy--", 2, 4)], ["ab-c!d", "z"]])
  print(show(s) + show(t) + " " + loopLabelled(s, t) + " " + loopFinally(s) + " " + loopInHandler(s) + " " + loopReturns(s, 99) + " " + [...loopYieldsLabelled(s)].join() + " " + show(charactersLabelled(s, t)) + " " + show(charactersFinally(s + "bxdz")) + " " + show(charactersFinally(t + "r")));
const frozen = Object.freeze(/a/g);
for (const re of [/a+/g, /a+/y, /a+/, frozen, { lastIndex: 0, exec() {
  return boom(this.lastIndex === 2, "two") === "two" ? ["e" + this.lastIndex] : null;
} }, null])
  print(attempt(() => lastIndexCaught(re, "aabaa")) + " " + (re instanceof RegExp && re !== frozen ? [...lastIndexYielded(re, "aabaa")].join() : ""));
const thrower = { valueOf() {
  throw new Error("valueOf");
} };
const counter = { valueOf() {
  log.push("v");
  return 1;
} };
for (const s of ["hello", cat("he", "llo"), "h\xE9\u65E5lo", ["h", "e", "l"], { charCodeAt: () => boom(true, "mine") }, 5, null, undefined])
  for (const [i, j] of [[1, 3], [thrower, 2], [1, thrower], [counter, "l"], ["1", undefined], [-1, 9], [1.5, NaN]])
    print(show(String(s)) + " " + show(untypedCaught(s, i, j)) + log.splice(0).join(""));
{
  const g = untypedYielded("hello");
  print([g.next().value, g.next(1).value, g.next(3).value, g.next("l").value].join());
  const h = untypedYielded(["a", "b", "c"]);
  print(attempt(() => [h.next().value, h.next(1).value].join()));
}
const m = new Map;
const items = [1, 2, 3, 123456, 4, 5].map((id) => ({ id, name: "n" + id }));
for (const a of items.slice(0, 3))
  for (const b of items.slice(2, 4))
    print(keyCaught(m, a, b) + " " + keyCaught(m, a, b) + " " + log.splice(0).join());
print([...keyYielded(m, items)].join() + " " + [...keyYielded(m, items)].join() + " " + m.size);
(async () => {
  for (const s of texts)
    print(show(s) + " " + await switchAwaited(s) + " " + await searchAwaited(s + "lit!x") + " " + await loopAwaitsCaught(s));
  print(await lastIndexAwaited(/a+/g, "aabaa") + " " + await lastIndexAwaited(/a+/y, "aabaa") + " " + await lastIndexAwaited(/b/, "aabaa"));
  print(await untypedAwaited("hello", 1) + " " + await untypedAwaited(cat("h\u65E5", "llo"), Promise.resolve(1)) + " " + await untypedAwaited(["x", "y", "z"], 1).catch((e) => e.name));
  print(await keyAwaited(m, items[0], items[3]) + " " + await keyAwaited(m, items[0], items[3]) + " " + (await Promise.all(items.map((a) => keyAwaited(m, a, a)))).join("/"));
})();
globalThis.kept = [switchCaught, switchInTry, chainLabelled, switchAwaited, switchYielded, searchCaught, searchAwaited, madeCaught, loopLabelled, loopFinally, loopInHandler, loopReturns, loopYieldsLabelled, loopAwaitsCaught, lastIndexCaught, lastIndexAwaited, lastIndexYielded, untypedCaught, untypedAwaited, untypedYielded, keyCaught, keyAwaited, keyYielded, charactersLabelled, charactersFinally];
console.log("number");
