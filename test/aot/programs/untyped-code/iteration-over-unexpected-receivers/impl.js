const out = [];
const attempt = f => { try { return String(f()); } catch (e) { return e.name; } };
globalThis.given = [["ij", "k"], new Set(["l", "m"]), new String("no"), 7, {}, undefined];
function characters(s) { const seen = []; for (const c of s) seen.push(c); return seen.join("+"); }
function lengths(s) { let n = 0; for (const c of s) n += c.length; return n; }
out.push("texts: " + [characters("ab"), characters("c\u{1F600}d"), characters("e" + "f".repeat(3)), lengths("gh"), lengths("\u{1F600}")].join(" | "));
out.push("what is no text: " + globalThis.given.map(v => attempt(() => characters(v)) + "/" + attempt(() => lengths(v))).join(" | "));
function at(a, k) { return a[k]; }
function put(a, k, v) { a[k] = v; return a[k]; }
{ const a = ["x", "y", "z"]; a.extra = "named"; a.undefined = "named undefined"; out.push("keys: " + [at(a, 0), at(a, 1), at(a, 2), put(a, 1, "w")].join() + " | " + ["length", "extra", "1", 1.5, -1, null, undefined, NaN, true, { toString() { return "2"; } }].map(k => attempt(() => at(a, k)) + "/" + attempt(() => put(a, k, "p"))).join(" | ") + " | " + a.length + " " + a.join()); }
console.log(out.join("\n"));
