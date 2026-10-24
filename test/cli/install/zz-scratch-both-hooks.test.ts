import { spawn, write } from "bun";
import { afterAll, beforeAll, test } from "bun:test";
import { bunEnv, bunExe, readdirSorted } from "harness";
import { join } from "path";
import { TestRegistry } from "registry";

const registry = new TestRegistry();
beforeAll(async () => {
  await registry.start();
});
afterAll(() => {
  registry.stop();
});

async function bun(cwd: string, ...args: string[]) {
  await using proc = spawn({ cmd: [bunExe(), ...args], cwd, env: bunEnv, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { out, err, exitCode };
}

test("extension removal + re-key fires both hooks", async () => {
  const { packageDir: dir, packageJson } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });
  const store = join(dir, "node_modules", ".bun");
  const pinned = { "a-dep": "1.0.4", "no-deps": "1.0.0" };
  const install = async (m: any) => {
    await write(packageJson, JSON.stringify({ name: "app", version: "1.0.0", ...m }));
    const r = await bun(dir, "install");
    console.log(r.out.split("\n").filter(l => /installed|removed|no changes/.test(l)).join(" | "), r.err.trim());
    console.log(await readdirSorted(store));
    return r;
  };
  await install({ dependencies: pinned });
  await install({
    dependencies: pinned,
    packageExtensions: { "a-dep": { dependencies: { "peer-no-deps": "1.0.0" }, peerDependencies: { "no-deps": "*" } } },
  });
  await install({ dependencies: pinned });
  const { out } = await bun(dir, "prune");
  console.log(out.trim().split("\n").slice(-2).join(" | "));
});
