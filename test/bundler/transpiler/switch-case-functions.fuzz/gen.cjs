// gen(seed) -> { src } : one function `test<seed>(v)` with a switch whose case clauses declare functions.
function rng(seed) { let s = (seed * 2654435761 + 12345) >>> 0; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
function gen(seed) {
  const r = rng(seed + 1), pick = a => a[Math.floor(r() * a.length)], chance = p => r() < p;
  const names = ["g", "h"];
  const use = n => pick([`typeof ${n}`, `call(() => ${n})`, `call(() => ${n})`]);
  const nClauses = pick([1, 2, 2, 3, 3, 4]);
  const onlyDefault = nClauses === 1 && chance(0.7);
  const clauses = [];
  for (let i = 0; i < nClauses; i++) clauses.push([]);
  const blockLocals = [];
  // other declarations of the switch block
  for (let i = 0; i < nClauses; i++) {
    if (chance(0.25)) { clauses[i].push(`${pick(["let", "const"])} x${i} = ${i};`); blockLocals.push("x" + i); }
    if (chance(0.08)) { clauses[i].push(`class K${i} {}`); blockLocals.push("K" + i); }
  }
  // each name is declared at most once in the switch block
  for (const name of names) {
    if (!chance(0.8)) continue;
    const kind = pick(["", "", "", "", "", "async ", "*"]);
    const reads = blockLocals.length && chance(0.5) ? `typeof ${pick(blockLocals)} + "${name}"` : `"${name}"`;
    const decl = kind === "*" ? `function* ${name}() { yield ${reads}; }` : `${kind}function ${name}() { return ${reads}; }`;
    const c = clauses[Math.floor(r() * nClauses)];
    c.splice(Math.floor(r() * (c.length + 1)), 0, decl);
  }
  for (let i = 0; i < nClauses; i++) {
    const n = Math.floor(r() * 3);
    for (let k = 0; k < n; k++) {
      const what = r(), at = Math.floor(r() * (clauses[i].length + 1));
      let stmt;
      if (what < 0.6) stmt = `out.push(${use(pick(names))});`;
      else if (what < 0.75) stmt = `{ out.push(${use(pick(names))}); }`;
      else if (what < 0.88) stmt = `var w${i}${k} = ${use(pick(names))}; out.push(w${i}${k});`;
      else stmt = `switch (v) { case ${i}: out.push(${use(pick(names))}); }`;
      clauses[i].splice(at, 0, stmt);
    }
    clauses[i].push(pick(["break;", "break;", "", "", "return out;"]));
  }
  const lines = clauses.map((stmts, i) => {
    const label = onlyDefault || (i === nClauses - 1 && chance(0.5)) ? "default:" : `case ${chance(0.12) ? `(out.push(${use(pick(names))}), ${i})` : i}:`;
    return `    ${label} ${stmts.join(" ")}`;
  });
  const pre = [];
  if (chance(0.35)) pre.push(`out.push(${use(pick(names))});`);
  const disc = chance(0.15) ? `(out.push(${use(pick(names))}), v)` : "v";
  const post = chance(0.6) ? `out.push(${use(pick(names))});` : "";
  const src = `function test${seed}(v) { const out = []; const call = f => { try { let x = f(); if (typeof x === "function") x = x(); return x && typeof x.next === "function" ? x.next().value : x && typeof x.then === "function" ? (x.then(() => {}, () => {}), "promise") : x; } catch (e) { return "THREW " + e.constructor.name; } };
  ${pre.join(" ")}
  switch (${disc}) {
${lines.join("\n")}
  }
  ${post}
  return out; }`;
  return { src };
}
module.exports = { gen };
if (require.main === module) console.log(gen(+process.argv[2] || 0).src);
