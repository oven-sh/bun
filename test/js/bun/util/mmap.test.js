import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, gcTick, isWindows, tmpdirSync } from "harness";
import { truncateSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "path";

// TODO: We do not support mmap() on Windows. Maybe we can add it later.
describe.skipIf(isWindows)("Bun.mmap", async () => {
  await gcTick();
  const path = join(tmpdirSync(), "bun-mmap-test.txt");
  await gcTick();
  await Bun.write(path, "hello");
  await gcTick();

  it("mmap finalizer", async () => {
    let map = Bun.mmap(path);
    await gcTick();
    const map2 = Bun.mmap(path);

    map = null;
    await gcTick();
  });

  it("mmap passed to other syscalls", async () => {
    const map = Bun.mmap(path);
    await gcTick();
    await Bun.write(path + "1", map);
    await gcTick();
    const text = await (await Bun.file(path + "1")).text();
    await gcTick();

    expect(text).toBe(new TextDecoder().decode(map));
  });

  it("mmap sync", async () => {
    const map = Bun.mmap(path);
    await gcTick();
    const map2 = Bun.mmap(path);
    await gcTick();

    const old = map[0];
    await gcTick();
    map[0] = 0;
    await gcTick();
    expect(map2[0]).toBe(0);

    map2[0] = old;
    await gcTick();
    expect(map[0]).toBe(old);
    await gcTick();
    await Bun.write(path, "olleh");
    await gcTick();
    expect(new TextDecoder().decode(map)).toBe("olleh");
    await gcTick();
  });

  it("mmap private", async () => {
    await gcTick();
    const map = Bun.mmap(path, { shared: true });
    await gcTick();
    const map2 = Bun.mmap(path, { shared: false });
    await gcTick();
    const old = map[0];

    await gcTick();
    map2[0] = 0;
    await gcTick();
    expect(map2[0]).toBe(0);
    await gcTick();
    expect(map[0]).toBe(old);
    await gcTick();
  });

  it("mmap rejects negative offset", () => {
    expect(() => Bun.mmap(path, { offset: -1 })).toThrow("offset must be a non-negative integer");
  });

  it("mmap rejects negative size", () => {
    expect(() => Bun.mmap(path, { size: -1 })).toThrow("size must be a non-negative integer");
  });

  it("mmap rejects non-object options", () => {
    expect(() => Bun.mmap(path, 256)).toThrow("Expected options to be an object");
    expect(() => Bun.mmap(path, "foo")).toThrow("Expected options to be an object");
    expect(() => Bun.mmap(path, true)).toThrow("Expected options to be an object");
    expect(() => Bun.mmap(path, undefined)).not.toThrow();
    expect(() => Bun.mmap(path, null)).not.toThrow();
  });

  it("mmap file > 4 GiB throws RangeError instead of aborting", async () => {
    // Sparse file: truncate() to 4 GiB + 1 uses no disk space.
    const dir = tmpdirSync();
    const big = join(dir, "big.bin");
    writeFileSync(big, "");
    truncateSync(big, 2 ** 32 + 1);
    try {
      // Spawned so a regression (SIGABRT) fails the test rather than the runner.
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `const f = ${JSON.stringify(big)};
           try { Bun.mmap(f); console.log("no throw"); }
           catch (e) { console.log("threw", e.name, e.message); }
           // exactly 4 GiB must still succeed
           console.log("at-limit", Bun.mmap(f, { size: 2 ** 32 }).length);
           // and a capped size on the same file works
           console.log("capped", Bun.mmap(f, { size: 4096 }).length);`,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      const lines = stdout.trim().split("\n");
      expect({ lines, signalCode: proc.signalCode, exitCode }).toEqual({
        lines: [expect.stringMatching(/^threw RangeError .*4294967297/), "at-limit 4294967296", "capped 4096"],
        signalCode: null,
        exitCode: 0,
      });
    } finally {
      unlinkSync(big);
    }
  });

  it("mmap handles non-number offset/size without crashing", () => {
    // These should not crash - non-number values coerce to 0 per JavaScript semantics
    // Previously these caused assertion failures (issue ENG-22413)

    // null coerces to 0, which is valid for offset
    expect(() => {
      Bun.mmap(path, { offset: null });
    }).not.toThrow();

    // size: null coerces to 0, which is invalid (EINVAL), but shouldn't crash
    expect(() => {
      Bun.mmap(path, { size: null });
    }).toThrow("EINVAL");

    // undefined is ignored (property not set)
    expect(() => {
      Bun.mmap(path, { offset: undefined });
    }).not.toThrow();
  });
});
