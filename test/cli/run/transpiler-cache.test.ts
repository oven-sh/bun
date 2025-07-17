import { Subprocess } from "bun";
import { beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readdirSync, realpathSync, rmSync, writeFileSync } from "fs";
import { bunEnv, bunExe, bunRun, tmpdirSync } from "harness";
import { join } from "path";

function dummyFile(size: number, cache_bust: string, value: string | { code: string }) {
  const data = Buffer.alloc(size);
  data.write("/*" + cache_bust);
  const end = `*/\nconsole.log(${(value as any).code ?? JSON.stringify(value)});`;
  data.fill("*", 2 + cache_bust.length, size - end.length, "utf-8");
  data.write(end, size - end.length, "utf-8");
  return data;
}

let temp_dir: string = "";
let cache_dir = "";

const env = {
  ...bunEnv,
  BUN_RUNTIME_TRANSPILER_CACHE_PATH: cache_dir,
  BUN_DEBUG_ENABLE_RESTORE_FROM_TRANSPILER_CACHE: "1",
};

let prev_cache_count = 0;
function newCacheCount() {
  let new_count = readdirSync(cache_dir).length;
  let delta = new_count - prev_cache_count;
  prev_cache_count = new_count;
  return delta;
}

function removeCache() {
  prev_cache_count = 0;
  try {
    rmSync(cache_dir, { recursive: true, force: true });
  } catch (error) {
    chmodSync(cache_dir, 0o777);
    readdirSync(cache_dir).forEach(item => {
      chmodSync(join(cache_dir, item), 0o777);
    });
    rmSync(cache_dir, { recursive: true, force: true });
  }
}

beforeEach(() => {
  if (cache_dir) {
    rmSync(temp_dir, { recursive: true, force: true });
    removeCache();
  }

  temp_dir = tmpdirSync();
  mkdirSync(temp_dir, { recursive: true });
  temp_dir = realpathSync(temp_dir);
  cache_dir = join(temp_dir, ".cache");
  env.BUN_RUNTIME_TRANSPILER_CACHE_PATH = cache_dir;
});

describe("transpiler cache", () => {
  test("works", async () => {
    writeFileSync(join(temp_dir, "a.js"), dummyFile((50 * 1024 * 1.5) | 0, "1", "a"));
    const a = bunRun(join(temp_dir, "a.js"), env);
    expect(a.stdout == "a");
    expect(existsSync(cache_dir)).toBeTrue();
    expect(newCacheCount()).toBe(1);
    const b = bunRun(join(temp_dir, "a.js"), env);
    expect(b.stdout == "a");
    expect(newCacheCount()).toBe(0);
  });
  test("works with empty files", async () => {
    writeFileSync(join(temp_dir, "a.js"), "//" + "a".repeat(50 * 1024 * 1.5));
    const a = bunRun(join(temp_dir, "a.js"), env);
    expect(a.stdout == "");
    expect(existsSync(cache_dir)).toBeTrue();
    expect(newCacheCount()).toBe(1);
    const b = bunRun(join(temp_dir, "a.js"), env);
    expect(b.stdout == "");
    expect(newCacheCount()).toBe(0);
  });
  test("ignores files under 50kb", async () => {
    writeFileSync(join(temp_dir, "a.js"), dummyFile(50 * 1024 - 1, "1", "a"));
    const a = bunRun(join(temp_dir, "a.js"), env);
    expect(a.stdout == "a");
    expect(!existsSync(cache_dir)).toBeTrue();
  });
  test("it is indeed content addressable", async () => {
    writeFileSync(join(temp_dir, "a.js"), dummyFile(50 * 1024, "1", "b"));
    const a = bunRun(join(temp_dir, "a.js"), env);
    expect(a.stdout == "b");
    expect(newCacheCount()).toBe(1);

    writeFileSync(join(temp_dir, "a.js"), dummyFile(50 * 1024, "1", "c"));
    const b = bunRun(join(temp_dir, "a.js"), env);
    expect(b.stdout == "c");
    expect(newCacheCount()).toBe(1);

    writeFileSync(join(temp_dir, "b.js"), dummyFile(50 * 1024, "1", "b"));
    const c = bunRun(join(temp_dir, "b.js"), env);
    expect(b.stdout == "b");
    expect(newCacheCount()).toBe(0);
  });
  test("doing 50 buns at once does not crash", async () => {
    writeFileSync(join(temp_dir, "a.js"), dummyFile(50 * 1024, "1", "b"));
    writeFileSync(join(temp_dir, "b.js"), dummyFile(50 * 1024, "2", "b"));

    const remover = Bun.spawn({
      cmd: [bunExe(), join(import.meta.dir, "transpiler-cache-aggressive-remover.js"), cache_dir],
      env,
      cwd: temp_dir,
    });

    let processes: Subprocess<"ignore", "pipe", "inherit">[] = [];
    let killing = false;
    for (let i = 0; i < 50; i++) {
      processes.push(
        Bun.spawn({
          cmd: [bunExe(), i % 2 == 0 ? "a.js" : "b.js"],
          env,
          cwd: temp_dir,
          onExit(subprocess, exitCode, signalCode, error) {
            if (exitCode != 0 && !killing) {
              killing = true;
              processes.forEach(x => x.kill(9));
              remover.kill(9);
            }
          },
        }),
      );
    }

    await Promise.all(processes.map(x => x.exited));

    expect(!killing).toBeTrue();

    remover.kill(9);

    for (const proc of processes) {
      expect(proc.exitCode).toBe(0);
      expect(await proc.stdout.text()).toBe("b\n");
    }
  }, 99999999);
  test("works if the cache is not user-readable", () => {
    mkdirSync(cache_dir, { recursive: true });
    writeFileSync(join(temp_dir, "a.js"), dummyFile((50 * 1024 * 1.5) | 0, "1", "b"));
    const a = bunRun(join(temp_dir, "a.js"), env);
    expect(a.stdout == "b");
    expect(newCacheCount()).toBe(1);

    const cache_item = readdirSync(cache_dir)[0];

    chmodSync(join(cache_dir, cache_item), 0);
    const b = bunRun(join(temp_dir, "a.js"), env);
    expect(b.stdout == "b");
    expect(newCacheCount()).toBe(0);

    chmodSync(join(cache_dir), "0");
    try {
      const c = bunRun(join(temp_dir, "a.js"), env);
      expect(c.stdout == "b");
    } finally {
      chmodSync(join(cache_dir), "777");
    }
  });
  test("works if the cache is not user-writable", () => {
    mkdirSync(cache_dir, { recursive: true });
    writeFileSync(join(temp_dir, "a.js"), dummyFile((50 * 1024 * 1.5) | 0, "1", "b"));

    try {
      chmodSync(join(cache_dir), "0");
      const a = bunRun(join(temp_dir, "a.js"), env);
      expect(a.stdout == "b");
    } finally {
      chmodSync(join(cache_dir), "777");
    }
  });
  test("does not inline process.env", () => {
    writeFileSync(
      join(temp_dir, "a.js"),
      dummyFile((50 * 1024 * 1.5) | 0, "1", { code: "process.env.NODE_ENV, process.env.HELLO" }),
    );
    const a = bunRun(join(temp_dir, "a.js"), { ...env, NODE_ENV: undefined, HELLO: "1" });
    expect(a.stdout == "development 1");
    expect(existsSync(cache_dir)).toBeTrue();
    expect(newCacheCount()).toBe(1);
    const b = bunRun(join(temp_dir, "a.js"), { ...env, NODE_ENV: "production", HELLO: "5" });
    expect(b.stdout == "production 5");
    expect(newCacheCount()).toBe(0);
  });
});
