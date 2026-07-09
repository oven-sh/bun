// https://github.com/oven-sh/bun/issues/18115
// Bun's transpiler escaped non-ASCII bytes inside tagged-template raw
// contents and RegExp literals, so the values observed via
// `TemplateStringsArray.raw` / `RegExp.prototype.source` diverged from
// the spec and from every other engine. Twin of #26785 (regex) and #8745.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

const fixture = /* js */ `
const tag = (s, ...v) => ({ raw: s.raw.slice(), cooked: [...s], vals: v });
const out = {
  latin1Len: String.raw\`é\`.length,
  latin1: String.raw\`café\`,
  cjk: String.raw\`日本語\`,
  astral: String.raw\`🎉\`,
  astralLen: String.raw\`🎉\`.length,
  multiPart: tag\`héllo \${1} wörld 🎉\`,
  regexSource: /café日本語🎉/u.source,
  regexLen: /café/.source.length,
  regexFlagsMatch: /日本語/u.test("日本語"),
};
process.stdout.write(JSON.stringify(out));
`;

const expected = {
  latin1Len: 1,
  latin1: "café",
  cjk: "日本語",
  astral: "🎉",
  astralLen: 2,
  multiPart: {
    raw: ["héllo ", " wörld 🎉"],
    cooked: ["héllo ", " wörld 🎉"],
    vals: [1],
  },
  regexSource: "café日本語🎉",
  regexLen: 4,
  regexFlagsMatch: true,
};

async function run(cmd: string[], opts: { cwd?: string; env?: Record<string, string | undefined> } = {}) {
  await using proc = Bun.spawn({
    cmd,
    env: { ...bunEnv, ...opts.env },
    cwd: opts.cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

describe("tagged-template .raw and RegExp.source preserve non-ASCII source text", () => {
  test.concurrent("runtime (sync module load)", async () => {
    using dir = tempDir("18115-run", { "entry.mjs": fixture });
    const { stdout, stderr, exitCode } = await run([bunExe(), join(String(dir), "entry.mjs")]);
    expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
    expect(JSON.parse(stdout)).toEqual(expected);
  });

  test.concurrent("runtime (via require, async transpiler store)", async () => {
    using dir = tempDir("18115-async", {
      "mod.js": fixture,
      "entry.js": `require("./mod.js");`,
    });
    const { stdout, stderr, exitCode } = await run([bunExe(), join(String(dir), "entry.js")]);
    expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
    expect(JSON.parse(stdout)).toEqual(expected);
  });

  test.concurrent("pre-bundled (// @bun) source", async () => {
    using dir = tempDir("18115-atbun", { "entry.js": "// @bun\n" + fixture });
    const { stdout, stderr, exitCode } = await run([bunExe(), join(String(dir), "entry.js")]);
    expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
    expect(JSON.parse(stdout)).toEqual(expected);
  });

  test.concurrent("watcher path", async () => {
    using dir = tempDir("18115-watch", {
      "entry.mjs": fixture + `\nprocess.exit(0);\n`,
    });
    const { stdout, stderr, exitCode } = await run([bunExe(), "--watch", join(String(dir), "entry.mjs")]);
    expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
    expect(JSON.parse(stdout)).toEqual(expected);
  });

  test.concurrent("runtime transpiler cache round-trips non-ASCII", async () => {
    // The cache only writes when the source is at least MINIMUM_CACHE_SIZE
    // bytes; pad with a comment so the entry is actually persisted.
    const padding = "/*" + Buffer.alloc(64 * 1024, "*").toString() + "*/\n";
    using dir = tempDir("18115-cache", { "entry.js": padding + fixture, "cache/.keep": "" });
    const env = { BUN_RUNTIME_TRANSPILER_CACHE_PATH: join(String(dir), "cache") };

    // First run writes the cache entry.
    {
      const { stdout, stderr, exitCode } = await run([bunExe(), join(String(dir), "entry.js")], { env });
      expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
      expect(JSON.parse(stdout)).toEqual(expected);
    }

    // Second run serves the cached entry (regresses if the on-disk encoding
    // tag and the written bytes disagree).
    {
      const { stdout, stderr, exitCode } = await run([bunExe(), join(String(dir), "entry.js")], { env });
      expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
      expect(JSON.parse(stdout)).toEqual(expected);
    }
  });

  test.concurrent("bun build --target=bun output runs correctly", async () => {
    using dir = tempDir("18115-build", { "entry.mjs": fixture });
    const build = await run([bunExe(), "build", "--target=bun", join(String(dir), "entry.mjs")], {
      cwd: String(dir),
    });
    expect(build.exitCode).toBe(0);
    // The built output should keep the raw bytes verbatim (no unicode escapes).
    expect(build.stdout).not.toContain("\\u00E9");
    expect(build.stdout).toContain("café");

    await Bun.write(join(String(dir), "out.js"), build.stdout);
    const { stdout, stderr, exitCode } = await run([bunExe(), join(String(dir), "out.js")]);
    expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
    expect(JSON.parse(stdout)).toEqual(expected);
  });

  // The `--target=node` / `browser` paths were already correct; guard that
  // they stay that way.
  for (const target of ["node", "browser"] as const) {
    test.concurrent(`bun build --target=${target} output is unchanged`, async () => {
      using dir = tempDir(`18115-build-${target}`, { "entry.mjs": fixture });
      const build = await run([bunExe(), "build", `--target=${target}`, join(String(dir), "entry.mjs")], {
        cwd: String(dir),
      });
      expect(build.exitCode).toBe(0);
      expect(build.stdout).not.toContain("\\u00E9");
      expect(build.stdout).toContain("café");
    });
  }
});
