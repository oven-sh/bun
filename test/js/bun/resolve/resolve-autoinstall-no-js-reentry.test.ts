import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// With install=auto and no node_modules in scope, resolving a bare npm
// specifier blocks in `PackageManager::sleep_until` while the manifest
// request is pending. That wait must not pump the JS event loop: user
// `process.nextTick` / microtask / `setTimeout` callbacks must not fire
// *inside* a synchronous `Bun.resolveSync` / `import.meta.resolve` /
// `require.resolve` call.
test("auto-install resolve wait does not run user JS inside the sync call", async () => {
  // Registry that delays before 404 so the resolver's sleep_until actually
  // parks (makes the setTimeout@0 observation deterministic).
  await using server = Bun.serve({
    port: 0,
    async fetch() {
      await Bun.sleep(40);
      return new Response("Not Found", { status: 404 });
    },
  });

  // Run from an empty dir so the resolver falls through to auto-install
  // instead of stopping at the repo's own node_modules.
  using dir = tempDir("resolve-autoinstall-reentry", {});

  const src = /* js */ `
    const events = [];
    async function probe(name, fn) {
      const st = { p: "before" };
      setTimeout(() => events.push(name + ":setTimeout@" + st.p), 0);
      Promise.resolve().then(() => events.push(name + ":microtask@" + st.p));
      process.nextTick(() => events.push(name + ":nextTick@" + st.p));
      st.p = "INSIDE";
      try { fn(); } catch {}
      st.p = "after";
      await Bun.sleep(20);
    }
    const spec = "nope-pkg-" + process.pid;
    const box = process.cwd();
    await probe("resolveSync", () => Bun.resolveSync(spec, box));
    await probe("importMeta",  () => import.meta.resolve(spec + "a", "file://" + box + "/x.ts"));
    await probe("require",     () => require.resolve(spec + "b", { paths: [box] }));
    console.log(JSON.stringify(events));
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "--install=auto", "-e", src],
    cwd: String(dir),
    env: {
      ...bunEnv,
      BUN_CONFIG_REGISTRY: `http://127.0.0.1:${server.port}`,
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const events: string[] = JSON.parse(stdout.trim());
  const inside = events.filter(e => e.includes("@INSIDE"));
  expect({ inside, stderr }).toEqual({ inside: [], stderr: "" });
  // All three callback kinds should have fired for each of the three probes.
  expect(events.length).toBe(9);
  expect(exitCode).toBe(0);
});
