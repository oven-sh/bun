/** `DirectBuild.steps` and `.libs` (scripts/build/source.ts): generators of a dependency, as edges of the graph. */
import { expect, test } from "bun:test";
import { isWindows, tempDir } from "harness";
import { isAbsolute, join } from "node:path";

import { resolveConfig, type Toolchain } from "../../../scripts/build/config.ts";
import { Ninja, readManifest } from "../../../scripts/build/ninja.ts";
import { registerAllRules } from "../../../scripts/build/rules.ts";
import { resolveDep, type Dependency } from "../../../scripts/build/source.ts";

const toolchain = {
  cc: "/fake/clang",
  cxx: "/fake/clang++",
  ar: "/fake/llvm-ar",
  ld: "/fake/ld.lld",
  strip: "/fake/strip",
  bun: "/fake/bun",
  jsRuntime: "/fake/bun",
  esbuild: "/fake/esbuild",
  cmake: "/fake/cmake",
} as Toolchain;

// build.ninja spells paths with the host's separator; the expectations are written with `/`.
test.skipIf(isWindows)("the steps of a fetched dependency stand between its fetch and its compiles", () => {
  using dir = tempDir("build-direct-steps", {});
  const buildDir = join(String(dir), "build");
  const cfg = {
    ...resolveConfig({ os: "linux", arch: "x64", abi: "gnu", linuxSysroot: "/fake", buildDir }, toolchain),
    cwd: String(dir),
    vendorDir: join(String(dir), "vendor"),
  };
  const fetched = join(cfg.vendorDir, "zstd");
  const out = join(buildDir, "deps", "zstd");
  const dep: Dependency = {
    name: "zstd",
    source: () => ({ kind: "github-archive", repo: "x/y", commit: "0" }),
    build: () => ({
      kind: "direct",
      sources: ["a.c", { path: join(out, "data.S"), implicitInputs: [join(out, "data.bin")] }],
      steps: [
        {
          outputs: [join(out, "data.S")],
          implicitOutputs: [join(out, "data.bin")],
          inputs: [join(fetched, "data.txt"), join(fetched, "a.c"), "/elsewhere/pack.ts"],
          cmd: ["bun", "/elsewhere/pack.ts"],
          cwd: out,
          env: { K: "V" },
          stdout: true,
          desc: "data.S",
        },
      ],
      libs: ["/outside/libdata.a"],
    }),
    provides: () => ({ libs: [], includes: [] }),
  };
  const n = new Ninja({ buildDir });
  registerAllRules(n, cfg);

  const resolved = resolveDep(n, cfg, dep, new Map())!;

  expect(resolved.libs).toEqual(["/outside/libdata.a"]);
  expect(resolved.objects.map(object => n.rel(object))).toEqual(["obj/vendor/zstd/a.c.o", "obj/deps/zstd/data.S.o"]);
  const { edges } = readManifest(n.toString());
  const edgeOf = (output: string) => edges.find(edge => edge.outputs.includes(output))!;
  expect(edgeOf("../vendor/zstd/.ref").implicitOutputs.filter(output => !isAbsolute(output))).toEqual([
    "../vendor/zstd/a.c",
    "../vendor/zstd/data.txt",
  ]);
  const step = edgeOf("deps/zstd/data.S");
  expect(step.rule).toBe("dep_gen");
  expect(step.implicitOutputs).toContain("deps/zstd/data.bin");
  expect(step.orderOnlyInputs).toEqual(["../vendor/zstd/.ref"]);
  expect(step.bindings.opts).toBe(`--cwd=${out} --env=K=V --stdout=${join(out, "data.S")}`);
  expect(step.bindings.cmd).toBe("bun /elsewhere/pack.ts");
  expect(edgeOf("obj/deps/zstd/data.S.o").implicitInputs).toContain("deps/zstd/data.bin");
  expect(edgeOf("obj/vendor/zstd/a.c.o").implicitInputs).not.toContain("deps/zstd/data.bin");
});
