// Differential fuzzer. Usage:
//   node fuzz.mjs --profile=dag --from=1 --count=200 --variants=node,bun,spec,plan,bunbuild [--keep] [--shift] [--agree=node,bun,spec]
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, emitESM, generate, hasTLA } from "./gen.mjs";
import { analyze, plan } from "./plan-linker.mjs";
import { VARIANTS } from "./variants.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    return [m[1], m[2] ?? true];
  }),
);
const profile = args.profile ?? "dag";
const from = Number(args.from ?? 1);
const count = Number(args.count ?? 100);
const names = (args.variants ?? "node,bun,spec,plan").split(",");
const ref = args.ref ?? names[0];
const WORK = args.work ?? path.join(os.tmpdir(), "tla-fuzz");
const CONC = Number(args.conc ?? 24);
const show = Number(args.show ?? 2);
const pumpDelay = profile.endsWith("dyn") ? 15 : 0;

export function run(engine, entry, env = {}) {
  return new Promise(resolve => {
    const bin = engine === "bun" ? (process.env.BUN_BIN ?? "bun") : "node";
    const p = spawn(bin, [path.join(HERE, "runner.mjs"), entry, String(pumpDelay)], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...env, ...(profile.endsWith("dyn") ? { NO_TICKER: "1" } : {}) },
    });
    let out = "",
      err = "";
    p.stdout.on("data", d => (out += d));
    p.stderr.on("data", d => (err += d));
    const timer = setTimeout(() => p.kill("SIGKILL"), 8000);
    p.on("close", (code, sig) => {
      clearTimeout(timer);
      try {
        const line = out.trim().split("\n").pop();
        resolve({ ...JSON.parse(line), code, sig });
      } catch {
        resolve({ trace: [], result: sig ? "KILLED" : "CRASH", unhandled: [], code, sig, err: err.slice(0, 2000) });
      }
    });
  });
}

const isMark = s => s[0] === "<";
const isFine = s => s === "|" || s.includes("~") || s[0] === "@";
export const views = {
  boundary: t => t.trace.join("\n") + "\n" + t.unhandled.join(),
  exact: t => t.trace.filter(s => !isMark(s)).join("\n") + "\n" + t.result,
  coarse: t => t.trace.filter(s => !isMark(s) && !isFine(s)).join("\n") + "\n" + t.result,
  // order of module starts/ends only, without what each module observed of its deps
  order: t =>
    t.trace
      .filter(s => !isMark(s) && !isFine(s))
      .map(s => s.replace(/ \[.*$/, ""))
      .join("\n") +
    "\n" +
    t.result,
};

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (i < items.length) {
        const k = i++;
        await fn(items[k], k);
      }
    }),
  );
}

const stats = Object.fromEntries(
  names.map(n => [n, { boundary: 0, exact: 0, coarse: 0, order: 0, total: 0, buildFail: 0, hang: 0, bad: [] }]),
);
const shifts = {};
let skipped = 0;
const seeds = Array.from({ length: count }, (_, i) => from + i);
fs.mkdirSync(WORK, { recursive: true });

await pool(seeds, CONC, async seed => {
  const g = generate(seed, profile, { maxN: Number(args.maxN ?? 9) });
  const dir = path.join(WORK, `${profile}-${seed}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  for (const [f, s] of Object.entries(emitESM(g))) fs.writeFileSync(path.join(dir, "src", f), s);
  fs.writeFileSync(path.join(dir, "graph.txt"), describe(g) + "\n");
  const results = {};
  for (const name of names) {
    const [v, engine = v === "bun" ? "bun" : "node"] = name.split("@");
    try {
      const entry = await VARIANTS[v](g, dir);
      results[name] = await run(engine, entry);
    } catch (e) {
      results[name] = {
        buildFail: String(e?.message ?? e).slice(0, 500),
        trace: [],
        result: "BUILDFAIL",
        unhandled: [],
      };
    }
  }
  const R = results[ref];
  let anyBad = false;
  if (args.agree) {
    // only keep graphs whose behaviour does not depend on the host's import() latency
    const A = args.agree.split(",");
    if (A.some(n => views.coarse(results[n]) !== views.coarse(R))) {
      skipped++;
      fs.rmSync(dir, { recursive: true, force: true });
      return;
    }
  }
  if (args.shift) {
    const ticksBefore = t => {
      const i = t.trace.findIndex(isMark);
      return i < 0 ? null : t.trace.slice(0, i).filter(x => x === "|").length;
    };
    const e = plan(g, analyze(g)).items.at(-1);
    const cls =
      (!e.async ? "sync" : e.tla ? (e.W.length ? "tla+deps" : "tla-only") : "sync-tainted") +
      (R.result === "OK" ? "" : "/err");
    for (const name of names) {
      const a = ticksBefore(results[name]),
        b = ticksBefore(R);
      if (a == null || b == null) continue;
      const h = ((shifts[name] ??= {})[cls] ??= {});
      h[a - b] = (h[a - b] ?? 0) + 1;
    }
  }
  for (const name of names) {
    const st = stats[name],
      t = results[name];
    st.total++;
    if (t.buildFail) st.buildFail++;
    if ((t.result === "PENDING" || t.result === "KILLED") && R.result !== t.result) st.hang++;
    let ok = true;
    for (const lvl of ["boundary", "exact", "coarse", "order"]) {
      if (views[lvl](t) === views[lvl](R)) st[lvl]++;
      else if (lvl === (args.level ?? "exact")) ok = false;
    }
    if (!ok) {
      st.bad.push(seed);
      anyBad = true;
    }
  }
  fs.writeFileSync(path.join(dir, "results.json"), JSON.stringify(results, null, 1));
  if (!anyBad && !args.keep) fs.rmSync(dir, { recursive: true, force: true });
});

const pct = (a, b) => ((100 * a) / b).toFixed(1).padStart(5) + "%";
console.log(
  `profile=${profile} seeds=${from}..${from + count - 1} ref=${ref}` +
    (args.agree ? ` (skipped ${skipped} latency-dependent graphs)` : ""),
);
console.log("variant".padEnd(22), "order ", "coarse", "exact ", "bound.", " hang", " buildfail");
for (const n of names) {
  const s = stats[n];
  console.log(
    n.padEnd(22),
    pct(s.order, s.total),
    pct(s.coarse, s.total),
    pct(s.exact, s.total),
    pct(s.boundary, s.total),
    String(s.hang).padStart(5),
    String(s.buildFail).padStart(5),
    s.bad.length
      ? "  bad: " +
          s.bad
            .sort((a, b) => a - b)
            .slice(0, show + 6)
            .join(",")
      : "",
  );
}

if (args.shift) for (const n of names) console.log(n.padEnd(12), JSON.stringify(shifts[n]));
