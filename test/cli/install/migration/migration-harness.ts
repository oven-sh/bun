import fs from "fs";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
import { dirname, join } from "path";

/**
 * A YAML sequence under `key` in which each `&a` holds the one before it. No line is deep, but whoever follows the
 * last `*a` goes down `lines * levels` levels. Debug and ASAN builds have the stack for fewer levels in one line.
 * `sibling` is a flow node that follows the deep one inside each `&a`.
 */
export function yamlAliasChain(key: string, sibling?: string) {
  const [levels, lines] = isDebug || isASAN ? [300, 74] : [4000, 40];
  const deep = `${Buffer.alloc(levels, "[")}*a${Buffer.alloc(levels, "]")}`;
  const line = `  - &a ${sibling === undefined ? deep : `[${deep}, ${sibling}]`}\n`;
  return `${key}:\n  - &a [1]\n${Buffer.alloc(lines * line.length, line)}`;
}

export const ARBORIST = join(import.meta.dir, "npm-arborist");
export const arboristFixtures: { name: string; root?: string }[] = JSON.parse(
  fs.readFileSync(join(ARBORIST, "fixtures.json"), "utf8"),
);
// Port 1 refuses connections, so any accidental registry access fails the test.
export const OFFLINE_REGISTRY = "http://localhost:1/";

export function writeExtra(dir: string, extra: Record<string, string>, registry = OFFLINE_REGISTRY) {
  fs.writeFileSync(join(dir, "bunfig.toml"), `[install]\nregistry = "${registry}"\n`);
  for (const [name, contents] of Object.entries(extra)) {
    fs.mkdirSync(dirname(join(dir, name)), { recursive: true });
    fs.writeFileSync(join(dir, name), contents);
  }
}

// The project dir of a fixture copy; disposing removes the whole copy, including out-of-tree link targets.
class FixtureDir extends String {
  constructor(
    dir: string,
    private copy: Disposable,
  ) {
    super(dir);
  }
  [Symbol.dispose]() {
    this.copy[Symbol.dispose]();
  }
}

export function fixture(name: string, extra: Record<string, string> = {}) {
  const entry = arboristFixtures.find(f => f.name === name);
  if (!entry) throw new Error(`${name} is not listed in npm-arborist/fixtures.json`);
  const copy = tempDir("npm-migrate-" + name, join(ARBORIST, name));
  const dir = entry.root ? join(String(copy), entry.root) : String(copy);
  writeExtra(dir, extra);
  return new FixtureDir(dir, copy) as unknown as string & Disposable;
}

export async function run(dir: string, ...args: string[]) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args],
    env: { ...bunEnv, BUN_INSTALL_CACHE_DIR: join(String(dir), ".bun-cache") },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

export async function readLock(dir: string) {
  const text = await Bun.file(join(String(dir), "bun.lock")).text();
  return { text, lock: Bun.JSONC.parse(text) as any };
}
