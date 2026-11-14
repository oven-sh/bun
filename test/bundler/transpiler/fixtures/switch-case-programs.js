// generateSwitchCaseProgram(seed) returns the source of `function test(v)`. Its switch has one to four
// clauses (sometimes only `default:`) that declare plain, async and generator functions named `g` and
// `h`, each at most once, next to `let`, `const` and class declarations. The clauses, the case tests,
// the discriminant and the code around the switch read and call the functions. `test(v)` returns what
// they saw.
function random(seed) {
  let state = (seed * 2654435761 + 12345) >>> 0;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 4294967296;
  };
}

export function generateSwitchCaseProgram(seed) {
  const next = random(seed + 1);
  const pick = list => list[Math.floor(next() * list.length)];
  const chance = p => next() < p;
  const names = ["g", "h"];
  const use = name => pick([`typeof ${name}`, `call(() => ${name})`, `call(() => ${name})`]);
  const clauseCount = pick([1, 2, 2, 3, 3, 4]);
  const onlyDefault = clauseCount === 1 && chance(0.7);
  const clauses = Array.from({ length: clauseCount }, () => []);
  const blockLocals = [];
  for (let i = 0; i < clauseCount; i++) {
    if (chance(0.25)) {
      clauses[i].push(`${pick(["let", "const"])} x${i} = ${i};`);
      blockLocals.push("x" + i);
    }
    if (chance(0.08)) {
      clauses[i].push(`class K${i} {}`);
      blockLocals.push("K" + i);
    }
  }
  for (const name of names) {
    if (!chance(0.8)) continue;
    const kind = pick(["", "", "", "", "", "async ", "*"]);
    const value = blockLocals.length && chance(0.5) ? `typeof ${pick(blockLocals)} + "${name}"` : `"${name}"`;
    const declaration =
      kind === "*" ? `function* ${name}() { yield ${value}; }` : `${kind}function ${name}() { return ${value}; }`;
    const clause = clauses[Math.floor(next() * clauseCount)];
    clause.splice(Math.floor(next() * (clause.length + 1)), 0, declaration);
  }
  for (let i = 0; i < clauseCount; i++) {
    const count = Math.floor(next() * 3);
    for (let k = 0; k < count; k++) {
      const what = next();
      const at = Math.floor(next() * (clauses[i].length + 1));
      let statement;
      if (what < 0.6) statement = `out.push(${use(pick(names))});`;
      else if (what < 0.75) statement = `{ out.push(${use(pick(names))}); }`;
      else if (what < 0.88) statement = `var w${i}${k} = ${use(pick(names))}; out.push(w${i}${k});`;
      else statement = `switch (v) { case ${i}: out.push(${use(pick(names))}); }`;
      clauses[i].splice(at, 0, statement);
    }
    clauses[i].push(pick(["break;", "break;", "", "", "return out;"]));
  }
  const lines = clauses.map((statements, i) => {
    const label =
      onlyDefault || (i === clauseCount - 1 && chance(0.5))
        ? "default:"
        : `case ${chance(0.12) ? `(out.push(${use(pick(names))}), ${i})` : i}:`;
    return `    ${label} ${statements.join(" ")}`;
  });
  const before = chance(0.35) ? `out.push(${use(pick(names))});` : "";
  const discriminant = chance(0.15) ? `(out.push(${use(pick(names))}), v)` : "v";
  const after = chance(0.6) ? `out.push(${use(pick(names))});` : "";
  return `function test(v) {
  const out = [];
  const call = f => {
    try {
      let x = f();
      if (typeof x === "function") x = x();
      if (x && typeof x.next === "function") return x.next().value;
      if (x && typeof x.then === "function") return x.then(() => {}, () => {}), "promise";
      return x;
    } catch (e) {
      return "THREW " + e.constructor.name;
    }
  };
  ${before}
  switch (${discriminant}) {
${lines.join("\n")}
  }
  ${after}
  return out;
}`;
}
