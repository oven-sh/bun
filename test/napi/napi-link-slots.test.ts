// Stub NAPI link slots: a fixed table baked into the bun binary that lets a
// `.node` addon be appended to a `bun build --compile` executable *after* the
// fact, without re-running the bundler. Each slot is 256 bytes
// ({magic,offset,length,hash,path}) and lives in its own section so an
// external patcher can find it by name and stamp it in place.

import { spawnSync } from "bun";
import { beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isMacOS, tempDir } from "harness";
import { join } from "path";

const unsafe = Bun.unsafe as any;

test("Bun.unsafe.napiLinkSlots() exposes the stub loader table", () => {
  expect(typeof unsafe.napiLinkSlots).toBe("function");
  const slots = unsafe.napiLinkSlots();
  expect(Array.isArray(slots)).toBe(true);
  expect(slots.length).toBe(8);
  for (let i = 0; i < slots.length; i++) {
    // The running bun binary has never been post-processed, so every slot
    // should be unused but carry its slot index in the magic.
    expect(slots[i].index).toBe(i);
    expect(slots[i].used).toBe(false);
    expect(slots[i].offset).toBe(0);
    expect(slots[i].length).toBe(0);
    expect(slots[i].path).toBe("");
  }
});

test("Bun.unsafe.linkNapiModule() validates its inputs", () => {
  expect(typeof unsafe.linkNapiModule).toBe("function");
  expect(() => unsafe.linkNapiModule()).toThrow();

  using dir = tempDir("napi-link-validate", {});
  const base = String(dir);
  // Valid 64-bit ELF header — enough to fail the Mach-O magic check
  // deterministically regardless of host.
  writeFileSync(join(base, "notmacho.bin"), Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
  writeFileSync(join(base, "addon.bin"), Buffer.from([0xcf, 0xfa, 0xed, 0xfe]));
  expect(() =>
    unsafe.linkNapiModule(
      join(base, "notmacho.bin"),
      join(base, "addon.bin"),
      "/$bunfs/addon.node",
      join(base, "out.bin"),
    ),
  ).toThrow(/Mach-O/);
});

// Full round-trip: compile → link → run. Only exercisable on macOS for now
// because the post-link patcher is implemented against Mach-O; the runtime
// loader side is cross-platform.
describe.skipIf(!isMacOS)("linkNapiModule round-trip", () => {
  let addonPath: string;

  beforeAll(() => {
    // Reuse the existing napi-app build so we don't need our own toolchain.
    const build = spawnSync({
      cmd: [bunExe(), "install"],
      cwd: join(import.meta.dirname, "napi-app"),
      env: bunEnv,
      stdout: "inherit",
      stderr: "inherit",
    });
    if (!build.success) throw new Error("napi-app build failed");
    addonPath = join(import.meta.dirname, "napi-app/build/Debug/second_addon.node");
    expect(existsSync(addonPath)).toBe(true);
  }, 180_000);

  test("appended addon is visible in the slot table and loadable via process.dlopen", async () => {
    using dir = tempDir("napi-link-roundtrip", {
      // The virtual path is not known to the bundler — it only exists
      // after `linkNapiModule` stamps a slot. `process.dlopen` is used so
      // the bundler does not try to resolve it.
      "app.js": `
        const slots = (Bun.unsafe).napiLinkSlots();
        const used = slots.filter(s => s.used);
        console.log("slots", used.length, used[0]?.path ?? "");
        const m = { exports: {} };
        process.dlopen(m, "/$bunfs/linked.node");
        console.log("loaded", typeof m.exports.try_unwrap);
      `,
    });
    const cwd = String(dir);

    // 1. Compile the standalone executable with an empty slot table.
    const compile = spawnSync({
      cmd: [bunExe(), "build", "--compile", "app.js", "--outfile", "app"],
      cwd,
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });
    expect(compile.stderr.toString()).not.toContain("error");
    expect(compile.success).toBe(true);

    // Before linking, dlopen of the unknown /$bunfs path should fail.
    {
      const r = spawnSync({ cmd: [join(cwd, "app")], cwd, env: bunEnv, stderr: "pipe", stdout: "pipe" });
      expect(r.stdout.toString()).toContain("slots 0");
      expect(r.exitCode).not.toBe(0);
    }

    // 2. Link the addon in post-hoc — no rebundle.
    unsafe.linkNapiModule(join(cwd, "app"), addonPath, "/$bunfs/linked.node", join(cwd, "app-linked"));
    chmodSync(join(cwd, "app-linked"), 0o755);

    // 3. Run the linked executable. The slot should now report used, and
    //    the addon's `try_unwrap` export should be reachable. The loader is
    //    in-memory on macOS (NSCreateObjectFileImageFromMemory) so no
    //    cache dir is needed.
    const r = spawnSync({
      cmd: [join(cwd, "app-linked")],
      cwd,
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });
    const out = r.stdout.toString();
    const err = r.stderr.toString();
    expect(err).toBe("");
    expect(out).toContain("slots 1 /$bunfs/linked.node");
    expect(out).toContain("loaded function");
    expect(r.exitCode).toBe(0);
  }, 60_000);
});
