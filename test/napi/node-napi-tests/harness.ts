import { spawn, spawnSync } from "bun";
import { existsSync, renameSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { bunExe, bunEnv, isCI, isMusl } from "../../harness";

// Tests that intentionally abort and should not generate core dumps when they abort
// due to a Node-API error
const abortingJsNativeApiTests = ["test_finalizer/test_fatal_finalize.js"];

// Must match the npm_config_target passed to node-gyp below (without the leading "v").
const NODE_HEADERS_VERSION = "26.3.0";

const linuxClang = !isMusl ? "/usr/lib/llvm-22/bin/clang" : "/usr/lib/llvm22/bin/clang";

interface GypTarget {
  target_name: string;
  sources: string[];
  defines?: string[];
}

// Every binding.gyp in this suite is `{ targets: [{ target_name, sources[, defines] }] }`.
// Returns null for anything else so build() falls back to real node-gyp.
function parseSimpleBindingGyp(text: string): GypTarget[] | null {
  let parsed: any;
  try {
    // gyp files are python literals: allow comments, single quotes, and trailing commas.
    const json = text
      .split("\n")
      .filter(line => !/^\s*#/.test(line))
      .join("\n")
      .replace(/'/g, '"')
      .replace(/,(\s*[\]}])/g, "$1");
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  if (Object.keys(parsed).length !== 1 || !Array.isArray(parsed.targets) || parsed.targets.length === 0) return null;
  for (const target of parsed.targets) {
    for (const key of Object.keys(target)) {
      if (key !== "target_name" && key !== "sources" && key !== "defines") return null;
    }
    if (typeof target.target_name !== "string" || target.target_name.length === 0) return null;
    if (!Array.isArray(target.sources) || target.sources.length === 0) return null;
    const isC = (s: unknown) => typeof s === "string" && s.endsWith(".c");
    const isCxx = (s: unknown) => typeof s === "string" && s.endsWith(".cc");
    // A target must be all C or all C++ so one compiler driver handles it.
    if (!(target.sources.every(isC) || target.sources.every(isCxx))) return null;
    if (target.defines !== undefined) {
      if (!Array.isArray(target.defines) || !target.defines.every((d: unknown) => typeof d === "string")) return null;
    }
  }
  return parsed.targets;
}

// Read-only lookup of the header tree node-gyp itself installs. Never downloads or
// mutates the cache; if it isn't complete we fall back to node-gyp (which fills it).
function findNodeHeaders(): string | null {
  const candidates: string[] = [];
  if (process.env.npm_config_devdir) candidates.push(process.env.npm_config_devdir);
  if (process.platform === "darwin") {
    candidates.push(join(homedir(), "Library", "Caches", "node-gyp"));
  } else {
    if (process.env.XDG_CACHE_HOME) candidates.push(join(process.env.XDG_CACHE_HOME, "node-gyp"));
    candidates.push(join(homedir(), ".cache", "node-gyp"));
  }
  for (const devDir of candidates) {
    const base = join(devDir, NODE_HEADERS_VERSION);
    const include = join(base, "include", "node");
    // node-gyp writes `installVersion` last, only after the headers finish extracting.
    if (existsSync(join(base, "installVersion")) && existsSync(join(include, "node_api.h"))) {
      return include;
    }
  }
  return null;
}

function compilerFor(cxx: boolean): string {
  if (process.platform === "linux" && isCI) return cxx ? `${linuxClang}++` : linuxClang;
  if (cxx) return process.env.CXX || "c++";
  return process.env.CC || "cc";
}

// node-gyp's fixed per-addon bootstrap (bun x + python gyp configure + make) costs several
// seconds per directory. When binding.gyp is the trivial shape used by every addon in this
// suite and the node headers are already cached, one direct compiler invocation produces
// the same build/Debug/<target>.node in well under a second. Returns false to fall back.
async function tryBuildFast(dir: string): Promise<boolean> {
  if (process.platform === "win32") return false;
  const gypPath = join(dir, "binding.gyp");
  if (!existsSync(gypPath)) return false;
  const targets = parseSimpleBindingGyp(await Bun.file(gypPath).text());
  if (targets === null) return false;
  const nodeInclude = findNodeHeaders();
  if (nodeInclude === null) return false;

  const outDir = join(dir, "build", "Debug");
  await mkdir(outDir, { recursive: true });

  const results = await Promise.all(
    targets.map(async target => {
      const cxx = target.sources[0].endsWith(".cc");
      // Compile to a temporary name and rename so a partial artifact is never loadable.
      const output = join(outDir, `${target.target_name}.node`);
      const tmpOutput = join(outDir, `.${target.target_name}.${process.pid}.tmp.node`);
      try {
        const child = spawn({
          cmd: [
            compilerFor(cxx),
            ...(cxx ? ["-std=gnu++20"] : []),
            "-shared",
            "-fPIC",
            "-g",
            "-O0",
            ...(process.platform === "darwin" ? ["-undefined", "dynamic_lookup"] : []),
            `-I${nodeInclude}`,
            `-DNODE_GYP_MODULE_NAME=${target.target_name}`,
            "-DBUILDING_NODE_EXTENSION",
            "-DDEBUG",
            "-D_DEBUG",
            ...(target.defines ?? []).map(define => `-D${define}`),
            ...target.sources,
            "-o",
            tmpOutput,
          ],
          cwd: dir,
          stderr: "pipe",
          stdout: "ignore",
          stdin: "ignore",
          env: bunEnv,
        });
        const [stderr, exitCode] = await Promise.all([new Response(child.stderr).text(), child.exited]);
        if (exitCode !== 0) {
          console.warn(
            `direct compile of ${target.target_name} in ${dir} failed, falling back to node-gyp:\n${stderr}`,
          );
          return false;
        }
        renameSync(tmpOutput, output);
        return true;
      } catch (error) {
        console.warn(`direct compile of ${target.target_name} in ${dir} failed, falling back to node-gyp: ${error}`);
        return false;
      }
    }),
  );
  return results.every(Boolean);
}

async function buildWithNodeGyp(dir: string) {
  const child = spawn({
    // `configure build` instead of `rebuild`: `clean` is pure waste (CI checkouts are always
    // cold) and skipping it keeps local re-runs incremental. No `--verbose`/`-j max`: every
    // addon here has 1-2 source files, and many of these build concurrently on one runner.
    cmd: [bunExe(), "--bun", "x", "node-gyp@11", "configure", "build", "--debug"],
    cwd: dir,
    stderr: "pipe",
    stdout: "ignore",
    stdin: "inherit",
    env: {
      ...bunEnv,
      npm_config_target: `v${NODE_HEADERS_VERSION}`,
      CXXFLAGS: (bunEnv.CXXFLAGS ?? "") + (process.platform == "win32" ? " -std=c++20" : " -std=gnu++20"),
      // on linux CI, node-gyp will default to g++ and the version installed there is very old,
      // so we make it use clang instead
      ...(process.platform == "linux" && isCI
        ? {
            CC: linuxClang,
            CXX: `${linuxClang}++`,
          }
        : {}),
    },
  });
  const [stderr, exitCode] = await Promise.all([new Response(child.stderr).text(), child.exited]);
  if (exitCode !== 0) {
    console.error(`node-gyp build in ${dir} failed:\n${stderr}`);
    console.error("bailing out!");
    process.exit(1);
  }
}

export async function build(dir: string) {
  if (await tryBuildFast(dir)) return;
  await buildWithNodeGyp(dir);
}

function envFor(test: string) {
  return abortingJsNativeApiTests.includes(test)
    ? { ...bunEnv, BUN_INTERNAL_SUPPRESS_CRASH_ON_NAPI_ABORT: "1" }
    : bunEnv;
}

export function run(dir: string, test: string) {
  const result = spawnSync({
    cmd: [bunExe(), "run", test],
    cwd: dir,
    stderr: "inherit",
    stdout: "ignore",
    stdin: "inherit",
    env: envFor(test),
  });
  expect(result.success).toBeTrue();
  expect(result.exitCode).toBe(0);
}

// Non-blocking variant of run() so callers can execute the addon's .js tests concurrently.
export async function runAsync(dir: string, test: string) {
  const child = spawn({
    cmd: [bunExe(), "run", test],
    cwd: dir,
    stderr: "inherit",
    stdout: "ignore",
    stdin: "inherit",
    env: envFor(test),
  });
  const exitCode = await child.exited;
  expect(child.signalCode).toBeNull();
  expect(exitCode).toBe(0);
}
