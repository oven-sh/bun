import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// A plugin that registers onResolve either as
//   (A) onResolve({ filter: /^virt:/ })                   — default/file namespace, full specifier
//   (B) onResolve({ filter: /.*/, namespace: "virt" })    — explicit namespace, stripped path
// must handle `import "virt:x"` in both the runtime module loader and Bun.build.
// Previously the runtime only consulted (B) and Bun.build only consulted (A),
// so a plugin written one way worked in one context and failed in the other.

const fixture = (forms: "A" | "B" | "AB") => `
const calls: string[] = [];
const setup = (b: any) => {
${
  forms.includes("A")
    ? `  b.onResolve({ filter: /^virt:/ }, (args: any) => {
    calls.push("A:" + args.path);
    return { path: "a", namespace: "va" };
  });
  b.onLoad({ filter: /.*/, namespace: "va" }, () => ({ contents: 'export default "VIA-A";', loader: "js" }));
`
    : ""
}${
  forms.includes("B")
    ? `  b.onResolve({ filter: /.*/, namespace: "virt" }, (args: any) => {
    calls.push("B:" + args.path);
    return { path: "b", namespace: "vb" };
  });
  b.onLoad({ filter: /.*/, namespace: "vb" }, () => ({ contents: 'export default "VIA-B";', loader: "js" }));
`
    : ""
}};

Bun.plugin({ name: "dual", setup });
const runtime = (await import("virt:thing")).default;

const fs = require("fs");
const path = require("path");
const entry = path.join(import.meta.dir, "entry.ts");
fs.writeFileSync(entry, 'import v from "virt:thing"; export { v };');
const r = await Bun.build({ entrypoints: [entry], plugins: [{ name: "dual", setup }] });
if (!r.success) {
  console.log(JSON.stringify({ ok: false, logs: r.logs.map((l: any) => l.message) }));
  process.exit(1);
}
const bundled = (await r.outputs[0].text()).match(/VIA-[AB]/)![0];
console.log(JSON.stringify({ ok: true, runtime, bundled, calls }));
`;

async function run(forms: "A" | "B" | "AB") {
  using dir = tempDir("plugin-onresolve-ns", {
    "index.ts": fixture(forms),
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.ts"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

describe.concurrent("onResolve namespace-prefix dispatch is consistent between runtime and Bun.build", () => {
  test('onResolve({ filter: /^virt:/ }) resolves `import "virt:x"` at runtime and in Bun.build', async () => {
    const { stdout, stderr, exitCode } = await run("A");
    expect(stderr).toBe("");
    const out = JSON.parse(stdout);
    expect(out.ok).toBe(true);
    expect(out.runtime).toBe("VIA-A");
    expect(out.bundled).toBe("VIA-A");
    // Callback receives the full specifier in this form.
    expect(out.calls).toContain("A:virt:thing");
    expect(exitCode).toBe(0);
  });

  test('onResolve({ namespace: "virt" }) resolves `import "virt:x"` at runtime and in Bun.build', async () => {
    const { stdout, stderr, exitCode } = await run("B");
    expect(stderr).toBe("");
    const out = JSON.parse(stdout);
    expect(out.ok).toBe(true);
    expect(out.runtime).toBe("VIA-B");
    expect(out.bundled).toBe("VIA-B");
    // Callback receives the path with the "virt:" prefix stripped in this form.
    expect(out.calls).toContain("B:thing");
    expect(exitCode).toBe(0);
  });

  test("registering both forms keeps each context's existing primary lookup", async () => {
    const { stdout, stderr, exitCode } = await run("AB");
    expect(stderr).toBe("");
    const out = JSON.parse(stdout);
    expect(out.ok).toBe(true);
    expect(out.runtime).toBe("VIA-B");
    expect(out.bundled).toBe("VIA-A");
    expect(out.calls).toContain("B:thing");
    expect(out.calls).toContain("A:virt:thing");
    expect(exitCode).toBe(0);
  });

  test('onResolve({ namespace: "virt" }) returning { path } without namespace resolves to a file on disk in both', async () => {
    using dir = tempDir("plugin-onresolve-ns-file", {
      "real.js": `export default "FROM-DISK";`,
      "entry.ts": `import v from "virt:thing"; export { v };`,
      "index.ts": `
        const path = require("path");
        const real = path.join(import.meta.dir, "real.js");
        const setup = (b: any) => {
          b.onResolve({ filter: /.*/, namespace: "virt" }, () => ({ path: real }));
        };
        Bun.plugin({ name: "to-file", setup });
        const runtime = (await import("virt:thing")).default;
        const r = await Bun.build({
          entrypoints: [path.join(import.meta.dir, "entry.ts")],
          plugins: [{ name: "to-file", setup }],
        });
        if (!r.success) {
          console.log(JSON.stringify({ ok: false, logs: r.logs.map((l: any) => l.message) }));
          process.exit(1);
        }
        const bundled = (await r.outputs[0].text()).includes("FROM-DISK") ? "FROM-DISK" : "?";
        console.log(JSON.stringify({ ok: true, runtime, bundled }));
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.ts"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    const out = JSON.parse(stdout);
    expect(out).toEqual({ ok: true, runtime: "FROM-DISK", bundled: "FROM-DISK" });
    expect(exitCode).toBe(0);
  });
});
