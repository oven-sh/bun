// Random ESM graph generator for top-level-await evaluation-order fuzzing.
//
// A graph is { n, mods: [{ id, imports: [idx], body: [action] }] }, entry is mods[0].
// Actions:
//   {t:"log"}                 trace point (also bumps the module's exported progress var)
//   {t:"probe", d}            spawn a microtask chain of depth d that logs at every tick
//   {t:"await0"}              await 0                        (1 tick)
//   {t:"tick", n}             await __tick(n)                (n+1 ticks)
//   {t:"sleep", k}            await __sleep(k)               (virtual macrotask clock)
//   {t:"never"}               if (globalThis.__never) await 0   (HasTLA without suspending)
//   {t:"throw"}               throw new Error(id)
//   {t:"dyn", to, mode}       import() of mods[to]; mode: "await" | "fire" | "catch"

export function rng(seed) {
  // mulberry32
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    f: next,
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    chance: p => next() < p,
    pick: arr => arr[Math.floor(next() * arr.length)],
  };
}

export const PROFILES = {
  // static DAG, microtask-only awaits: tick-exact comparison is meaningful
  dag: { cycles: 0, errors: 0, sleep: 0, dyn: 0, probes: 1 },
  cyc: { cycles: 0.25, errors: 0, sleep: 0, dyn: 0, probes: 1 },
  err: { cycles: 0.15, errors: 0.15, sleep: 0, dyn: 0, probes: 1 },
  // like err, and a module that throws may still have an await behind the throw (HasTLA, rejects before it suspends)
  err2: { cycles: 0.15, errors: 0.25, sleep: 0, dyn: 0, probes: 1, awaitAfterThrow: 0.6 },
  // like err, and many modules only declare things: evaluating them does nothing that anyone can see
  inert: { cycles: 0.15, errors: 0.12, sleep: 0, dyn: 0, probes: 1, inert: 0.45 },
  // like inert, and modules also make objects and classes out of what they import: statements without side effects,
  // whose values show whether they ran too early
  pure: { cycles: 0.12, errors: 0.1, sleep: 0, dyn: 0, probes: 1, inert: 0.4, pure: 0.7 },
  // pure with import()
  puredyn: { cycles: 0.15, errors: 0.08, sleep: 1, dyn: 0.3, probes: 0, inert: 0.3, pure: 0.6 },
  time: { cycles: 0.15, errors: 0.08, sleep: 0.6, dyn: 0, probes: 1 },
  // a TLA module may wait for a signal that another module's body fires (bundling-induced deadlocks)
  sig: { cycles: 0.15, errors: 0.05, sleep: 0, dyn: 0, probes: 1, sig: 0.5 },
  // dynamic import: host-defined latency, so only macrotask-level awaits and no probes
  dyn: { cycles: 0.15, errors: 0.08, sleep: 1, dyn: 0.35, probes: 0 },
};

export function generate(seed, profileName = "dag", opts = {}) {
  const P = PROFILES[profileName];
  const r = rng(seed);
  const n = r.int(opts.minN ?? 2, opts.maxN ?? 9);
  const tlaP = r.pick([0.15, 0.3, 0.5, 0.7]);
  const mods = [];
  for (let i = 0; i < n; i++) mods.push({ id: "m" + i, imports: [], body: [] });

  // Every module but the entry gets at least one importer with a smaller index (or a
  // dynamic importer), so everything is reachable.
  const dynOnly = new Set();
  for (let i = 1; i < n; i++) {
    const parent = r.int(0, i - 1);
    if (P.dyn && r.chance(P.dyn)) {
      dynOnly.add(i);
      mods[parent].dynTargets ??= [];
      mods[parent].dynTargets.push(i);
    } else mods[parent].imports.push(i);
  }
  // extra forward edges
  const extra = r.int(0, n);
  for (let k = 0; k < extra; k++) {
    const a = r.int(0, n - 1),
      b = r.int(0, n - 1);
    if (a === b) {
      if (P.cycles && r.chance(0.1) && !mods[a].imports.includes(a)) mods[a].imports.push(a);
      continue;
    }
    const [lo, hi] = a < b ? [a, b] : [b, a];
    if (P.cycles && r.chance(P.cycles)) {
      if (!mods[hi].imports.includes(lo)) mods[hi].imports.push(lo); // back edge
    } else if (!mods[lo].imports.includes(hi)) mods[lo].imports.push(hi);
  }
  // shuffle import order
  for (const m of mods) {
    for (let i = m.imports.length - 1; i > 0; i--) {
      const j = r.int(0, i);
      [m.imports[i], m.imports[j]] = [m.imports[j], m.imports[i]];
    }
  }

  for (let i = 0; i < n; i++) {
    const m = mods[i];
    const body = m.body;
    const isTLA = r.chance(tlaP);
    body.push({ t: "log" });
    if (P.probes && r.chance(0.5)) body.push({ t: "probe", d: r.int(1, 3) });
    const dyn = (m.dynTargets ?? []).slice();
    if (P.dyn && r.chance(0.15)) dyn.push(r.int(0, n - 1)); // import() of anything, incl. ancestors/self
    if (isTLA) {
      const segs = r.int(1, 3);
      for (let s = 0; s < segs; s++) {
        if (P.sig && r.chance(P.sig)) body.push({ t: "wait", ch: r.int(0, n - 1) });
        else if (P.sleep && r.chance(P.sleep)) body.push({ t: "sleep", k: r.int(1, 6) });
        else if (P.dyn) body.push({ t: "sleep", k: r.int(1, 6) });
        else {
          const k = r.int(0, 9);
          if (k < 4) body.push({ t: "await0" });
          else if (k < 9) body.push({ t: "tick", n: r.int(0, 4) });
          else body.push({ t: "never" });
        }
        body.push({ t: "log" });
        if (P.probes && r.chance(0.4)) body.push({ t: "probe", d: r.int(1, 3) });
      }
    }
    for (const to of dyn) {
      const at = r.int(1, body.length);
      const mode = isTLA ? r.pick(["await", "await", "catch", "fire"]) : "fire";
      body.splice(at, 0, { t: "dyn", to, mode }, { t: "log" });
    }
    if (P.errors && r.chance(P.errors)) {
      // cut the body at a random point and throw there
      const at = r.int(1, body.length);
      body.length = at;
      body.push({ t: "throw" });
      if (P.awaitAfterThrow && r.chance(P.awaitAfterThrow)) body.push({ t: "await0" }, { t: "log" });
    }
    delete m.dynTargets;
    if (P.inert && i > 0 && r.chance(P.inert)) {
      m.inert = true;
      body.length = 0;
    }
  }
  if (P.pure) {
    // highest index first: mostly, what a module imports has its declarations by the time the module picks from them
    for (let i = n - 1; i >= 0; i--) {
      const m = mods[i];
      const deps = [...new Set(m.imports)].filter(j => j !== i).map(j => mods[j]);
      const some = list => list.filter(() => r.chance(0.6)).map(d => d.id);
      const at = () => r.int(0, m.body.length);
      if (r.chance(P.pure)) {
        const bases = deps.filter(d => d.body.some(a => a.t === "cls"));
        m.body.splice(at(), 0, { t: "cls", base: bases.length && r.chance(0.7) ? r.pick(bases).id : null });
      }
      if (r.chance(P.pure))
        m.body.splice(at(), 0, {
          t: "obj",
          o: some(deps.filter(d => d.body.some(a => a.t === "obj"))),
          k: some(deps.filter(d => d.body.some(a => a.t === "cls"))),
          // the progress of a module changes while it runs, so this one has to be read at the right time
          v: r.chance(0.3) ? some(deps.filter(d => !d.inert)) : [],
          lazy: some(deps.filter(d => !d.inert)),
        });
    }
  }
  return { seed, profile: profileName, n, mods };
}

const has = (m, t) => m.body.some(a => a.t === t);
// The namespace object of a module, for the emitters that print all modules into one file.
export const namespace = m =>
  `{ ${names(m)
    .map(name => `get ${name}() { return ${name}; }`)
    .join(", ")} }`;
// The top-level variables of a module.
export const names = m => [
  ...(m.inert ? [] : ["v_" + m.id]),
  ...(has(m, "obj") ? ["o_" + m.id] : []),
  ...(has(m, "cls") ? ["K_" + m.id] : []),
];

export function hasTLA(m) {
  return m.body.some(
    a =>
      a.t === "await0" ||
      a.t === "tick" ||
      a.t === "sleep" ||
      a.t === "never" ||
      a.t === "wait" ||
      (a.t === "dyn" && (a.mode === "await" || a.mode === "catch")),
  );
}

// Body statements, shared by every emitter. `imp(to)` prints the import() expression.
// `declare`: what goes in front of a statement that gives a top-level variable its only value.
export function bodyLines(g, m, imp, declare = "") {
  const out = [];
  let k = 0;
  const deps = [...new Set(m.imports)].filter(i => g.mods[i] !== m).flatMap(i => names(g.mods[i]));
  const sees = deps.length
    ? ` + " [" + [${deps.map(d => (d[0] === "v" ? d : `__show(${d})`)).join(", ")}].join() + "]"`
    : "";
  if (!m.inert) out.push(`__start();`);
  for (const a of m.body) {
    switch (a.t) {
      case "cls":
        out.push(`${declare}K_${m.id} = class ${a.base ? `extends K_${a.base} ` : ""}{ static id = "${m.id}"; };`);
        break;
      case "obj":
        out.push(
          `${declare}o_${m.id} = { id: "${m.id}", a: [${[...a.o.map(d => "o_" + d), ...a.k.map(d => "K_" + d), ...a.v.map(d => "v_" + d)].join(", ")}], lazy: () => [${a.lazy.map(d => "v_" + d).join(", ")}] };`,
        );
        break;
      case "log":
        out.push(`__log("${m.id}.${k}"${sees});`, `v_${m.id} = ${k};`);
        k++;
        break;
      case "probe":
        out.push(`__probe("${m.id}.${k}", ${a.d});`);
        break;
      case "await0":
        out.push(`await 0;`);
        break;
      case "tick":
        out.push(`await __tick(${a.n});`);
        break;
      case "sleep":
        out.push(`await __sleep(${a.k});`);
        break;
      case "wait":
        out.push(`await __chan("${g.mods[a.ch].id}");`);
        break;
      case "never":
        out.push(`if (globalThis.__never) await 0;`);
        break;
      case "throw":
        out.push(`if (!globalThis.__never) throw new Error("${m.id}");`);
        break;
      case "dyn": {
        const tid = g.mods[a.to].id;
        const tag = `${m.id}.${k}>${tid}`;
        const ok = `ns => __log("${tag} ok " + ns.v_${tid})`;
        const bad = `e => __log("${tag} err " + e.message)`;
        if (a.mode === "await") out.push(`(${ok})(await ${imp(a.to)});`);
        else if (a.mode === "catch") out.push(`await ${imp(a.to)}.then(${ok}, ${bad});`);
        else out.push(`${imp(a.to)}.then(${ok}, ${bad});`);
        break;
      }
    }
  }
  if (!m.inert) out.push(`v_${m.id} = "done";`);
  if (g.profile === "sig") out.push(`__fire("${m.id}");`);
  return out;
}

// Native ESM sources: { "m0.mjs": "...", ... }
export function emitESM(g) {
  const files = {};
  for (const m of g.mods) {
    const lines = [];
    for (const i of m.imports)
      lines.push(
        g.mods[i] === m || !names(g.mods[i]).length
          ? `import "./${g.mods[i].id}.mjs";`
          : `import { ${names(g.mods[i]).join(", ")} } from "./${g.mods[i].id}.mjs";`,
      );
    lines.push(m.inert ? `export function f_${m.id}() {}\nexport const c_${m.id} = () => 1;` : `export var v_${m.id};`);
    lines.push(...bodyLines(g, m, to => `import("./${g.mods[to].id}.mjs")`, "export var "));
    files[m.id + ".mjs"] = lines.join("\n") + "\n";
  }
  return files;
}

export function describe(g) {
  return g.mods
    .map(
      m =>
        `${m.id}${hasTLA(m) ? "*" : m.inert ? "~" : ""} -> [${m.imports.map(i => "m" + i).join(",")}]  ` +
        m.body
          .map(a =>
            a.t === "dyn"
              ? `dyn(${a.mode} m${a.to})`
              : a.t === "wait"
                ? `wait(m${a.ch})`
                : a.t === "cls"
                  ? `cls(${a.base ?? ""})`
                  : a.t === "obj"
                    ? `obj(${[...a.o.map(d => "o_" + d), ...a.k.map(d => "K_" + d), ...a.v.map(d => "v_" + d), ...a.lazy.map(d => "lazy v_" + d)]})`
                    : a.t + (a.n ?? a.k ?? a.d ?? ""),
          )
          .join(" "),
    )
    .join("\n");
}
