// `jsPlugins` of `.oxlintrc.json` as oxlint itself applies them against `Config::from_rc_json_with_plugins` and `Linter::lint` with
// a host for JavaScript plugins: generated projects are linted by both. Compared: which rule reports with which severity on which
// line of which file, and what is said about a configuration that is refused.
//
//   OXLINT=<the oxlint executable> node js-plugins.mjs [<how many differences to show>]
//
// The workers are started with the `bun` in `PATH`, or with `$BUN_LINT_BUN`.

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { random, report, runBunLint } from "./shared.mjs";

const oxlint = resolve(process.env.OXLINT ?? "oxlint");
const show = Number(process.argv[2] ?? 6);

const plugin = `export default {
  meta: { name: "probe" },
  rules: {
    "no-foo": {
      meta: {
        schema: [{ type: "object", properties: { name: { type: "string" } }, additionalProperties: false }],
        defaultOptions: [{ name: "foo" }],
        messages: { found: "Found {{name}}." },
      },
      create(context) {
        const name = context.options[0].name;
        return { Identifier(node) { if (node.name === name) context.report({ node, messageId: "found", data: { name } }); } };
      },
    },
    "no-id": { create(context) { return { DebuggerStatement(node) { context.report({ node, message: "No debugger." }); } }; } },
    throws: { create() { return { Identifier(node) { if (node.name === "boom") throw new Error("boom"); } }; } },
  },
};
`;

const rng = random(23);
const list = (make, max) => Array.from({ length: 1 + rng.int(max) }, make);
const severity = () => rng.pick([0, 1, 2, "off", "warn", "error", "allow", "deny"]);
const names = ["index.js", "a.js", "src/b.mjs", "src/d.ts", "lib/e.tsx", "src/deep/f.js"];
const glob = () => rng.pick(["*.js", "*.ts", "**/*.js", "src/**", "src/*.mjs", "lib/*", "index.js"]);

function rules(prefix, mayBeWrong) {
  const entries = {
    [`${prefix}/no-foo`]: () =>
      rng.pick([
        severity(),
        severity(),
        [severity()],
        [severity(), { name: "bar" }],
        ...(mayBeWrong ? [[severity(), { nam: 1 }]] : []),
      ]),
    [`${prefix}/no-id`]: () =>
      rng.pick([severity(), severity(), [severity()], ...(mayBeWrong ? [[severity(), 1]] : [])]),
    [`${prefix}/throws`]: severity,
    "no-debugger": severity,
    ...(mayBeWrong ? { [`${prefix}/nope`]: severity } : {}),
  };
  const ids = [...new Set(list(() => rng.pick(Object.keys(entries)), 4))];
  return Object.fromEntries(ids.map(id => [id, entries[id]()]));
}

function source(prefix) {
  const lines = list(
    () =>
      rng.pick([
        "foo;",
        "foo;",
        "bar;",
        "debugger;",
        "debugger;",
        "baz;",
        ...(rng.int(6) === 0 ? ["boom;"] : []),
        `// oxlint-disable-next-line ${prefix}/no-foo`,
        `// eslint-disable-next-line ${prefix}/no-id`,
        `/* eslint-disable ${prefix}/no-foo */`,
        `/* oxlint-disable ${prefix}/no-id, no-debugger */`,
        "/* eslint-enable */",
        `/* oxlint-enable ${prefix}/no-foo */`,
        `foo; // oxlint-disable-line ${prefix}/no-foo`,
        "debugger; // eslint-disable-line",
      ]),
    9,
  );
  return `${lines.join("\n")}\n`;
}

/** What oxlint prints about a configuration that it refuses, without what depends on how it is made. */
function refusal(text) {
  const parsed = /^\s+x (.*)$/m.exec(text);
  if (parsed) return parsed[1];
  return /^Error: (.*)$/m.exec(text)?.[1] ?? text.slice(0, 200);
}
const ourRefusal = text => /^Error: (.*)$/m.exec(text)?.[1] ?? text.split("\n")[0];

const root = mkdtempSync(join(tmpdir(), "js-plugins-"));
const cases = [];
const expected = [];
try {
  for (let i = 0; i < 160; i++) {
    const basePath = join(root, String(i));
    const alias = rng.int(3) === 0 ? "other" : undefined;
    const prefix = alias ?? "probe";
    const mayBeWrong = rng.int(5) === 0;
    const place = rng.pick(["root", "root", "override", "extended"]);
    const jsPlugins = [alias ? { name: alias, specifier: "./plugin.mjs" } : "./plugin.mjs"];
    const override = () => ({ files: list(glob, 2), rules: rules(prefix, mayBeWrong) });
    const config = {
      categories: { correctness: "off" },
      ...(place === "root" ? { jsPlugins } : {}),
      ...(place === "extended" ? { extends: ["./base.json"] } : {}),
      rules: rules(prefix, mayBeWrong),
      overrides: Array.from({ length: rng.int(3) }, override),
    };
    if (place === "override") config.overrides.push({ ...override(), jsPlugins });
    const extended = place === "extended" ? { "./base.json": { jsPlugins, rules: rules(prefix, false) } } : {};
    const sources = Object.fromEntries(
      [...new Set(list(() => rng.pick(names), 5))].map(it => [join(basePath, it), source(prefix)]),
    );
    const files = { ".oxlintrc.json": JSON.stringify(config), "plugin.mjs": plugin };
    for (const [name, it] of Object.entries(extended)) files[name] = JSON.stringify(it);
    for (const [name, text] of [
      ...Object.entries(files).map(([name, text]) => [join(basePath, name), text]),
      ...Object.entries(sources),
    ]) {
      mkdirSync(dirname(name), { recursive: true });
      writeFileSync(name, text);
    }
    const { stdout } = spawnSync(oxlint, ["--format", "json", "--threads", "1", ...Object.keys(sources)], {
      cwd: basePath,
      maxBuffer: 1 << 26,
    });
    cases.push({ basePath, flavor: "oxlint", jsPlugins: true, config, extended, sources });
    let answer;
    try {
      answer = JSON.parse(stdout.toString());
    } catch {
      expected.push({ error: refusal(stdout.toString()) });
      continue;
    }
    const byFile = Object.fromEntries(Object.keys(sources).map(name => [name, []]));
    for (const { code, message, severity, filename, labels } of answer.diagnostics) {
      const of = /^(.*)\((.*)\)$/.exec(code ?? "");
      const id = message.startsWith("Error running JS plugin.")
        ? null
        : of[1] === "eslint"
          ? of[2]
          : `${of[1]}/${of[2]}`;
      byFile[resolve(basePath, filename)].push([
        id,
        severity === "error" ? 2 : 1,
        id === null ? 0 : labels[0].span.line,
      ]);
    }
    expected.push(byFile);
  }

  const sorted = messages => [...messages].sort((a, b) => a[2] - b[2] || (String(a[0]) < String(b[0]) ? -1 : 1));
  const actual = runBunLint("project", cases);
  const flat = { cases: [], expected: [], actual: [] };
  cases.forEach(({ basePath, config, extended, sources }, i) => {
    // A configuration is refused as a whole by oxlint. Here, options that are wrong are found with the files that they are for.
    const ours = actual[i].error ?? Object.values(actual[i]).find(it => it?.error)?.error;
    if (expected[i].error !== undefined || ours !== undefined) {
      flat.cases.push({ config, extended });
      flat.expected.push({ error: expected[i].error });
      flat.actual.push({ error: ours === undefined ? undefined : ourRefusal(ours) });
      return;
    }
    for (const name of Object.keys(sources)) {
      flat.cases.push({ file: name.slice(basePath.length + 1), code: sources[name], config, extended });
      flat.expected.push(sorted(expected[i][name]));
      flat.actual.push(sorted(actual[i][name] ?? []));
    }
  });
  report("js plugins", flat.cases, flat.expected, flat.actual, show);
} finally {
  rmSync(root, { recursive: true, force: true });
}
