/**
 * The link's lazy group (scripts/build/compile.ts `link()`'s `lazyObjects`, scripts/build/bun.ts `lazyDepObjects`).
 *
 * A dependency is a library: the link takes the translation units something references and no others. The build
 * says that without archives, by handing the linker the dependency objects between `--start-lib` and `--end-lib` in
 * a response file of its own. These check what the link edge and that file say; no compiler or ninja runs.
 */
import { describe, expect, test } from "bun:test";
import { isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { lazyDepObjects } from "../../scripts/build/bun.ts";
import { link } from "../../scripts/build/compile.ts";
import type { Config } from "../../scripts/build/config.ts";
import { Ninja } from "../../scripts/build/ninja.ts";

type Target = Pick<Config, "windows" | "darwin" | "crossTarget" | "exeSuffix">;
const linux: Target = { windows: false, darwin: false, crossTarget: undefined, exeSuffix: "" };
const windows: Target = { windows: true, darwin: false, crossTarget: undefined, exeSuffix: ".exe" };
const macosNative: Target = { windows: false, darwin: true, crossTarget: undefined, exeSuffix: "" };
const macosCross: Target = { ...macosNative, crossTarget: "arm64-apple-macosx13.0" };

/** The link edge `link()` emits for `target`, and the group file it wrote (undefined when there is none). */
function emitLink(target: Target, buildDir: string) {
  const cfg = { buildDir, cwd: buildDir, host: { os: "linux" }, cxx: "/fake/clang++", ld: "/fake/ld.lld", ...target };
  const n = new Ninja({ buildDir });
  n.rule("link", { command: "clang++ @$out.rsp $lazy $ldflags -o $out" });
  n.rule("mkdir_stamp", { command: "mkdir -p $dir && touch $out" });
  link(n, cfg as Config, "bun", ["obj/bun.o"], {
    libs: [join(buildDir, "cache", "libWTF.a")],
    lazyObjects: [join(buildDir, "obj", "dep", "used.o"), join(buildDir, "obj", "dep", "unused.o")],
    flags: [],
  });
  const lines = n
    .toString()
    .replace(/ \$\n +/g, " ")
    .split("\n");
  const at = lines.findIndex(l => l.startsWith("build ") && l.includes(": link "));
  const [explicit, implicit = ""] = lines[at]!.slice(lines[at]!.indexOf(": link ") + 7)
    .split(" || ")[0]!
    .split(" | ");
  const groupFile = join(buildDir, `bun${target.exeSuffix}.lazy.rsp`);
  let group: string | undefined;
  try {
    group = readFileSync(groupFile, "utf8");
  } catch {}
  return {
    explicit: explicit!.split(" "),
    implicit: implicit.split(" "),
    lazy:
      lines
        .slice(at + 1)
        .find(l => l.startsWith("  lazy = "))
        ?.slice("  lazy = ".length) ?? "",
    group,
  };
}

describe.each([
  ["ELF", linux],
  ["a cross-linked macOS target", macosCross],
])("an lld link (%s)", (_, target) => {
  // build.ninja spells paths with the host's separator; the expectations in this file are written with `/`.
  test.skipIf(isWindows)("takes the lazy objects as a --start-lib group in a response file of its own", () => {
    using dir = tempDir("build-link-lazy", {});
    const edge = emitLink(target, String(dir));
    // Not in $in: `@$out.rsp` would hand them to the linker as plain objects.
    expect(edge.explicit).toEqual(["obj/bun.o", "cache/libWTF.a"]);
    // Still inputs of the edge, with the group file: a member added or dropped changes only that file.
    expect(edge.implicit).toEqual(expect.arrayContaining(["bun.lazy.rsp", "obj/dep/used.o", "obj/dep/unused.o"]));
    expect(edge.lazy).toBe("-Wl,@bun.lazy.rsp");
    expect(edge.group).toBe("--start-lib\nobj/dep/used.o\nobj/dep/unused.o\n--end-lib\n");
  });
});

test.skipIf(isWindows)("lld-link gets the group through clang-cl as a linker input", () => {
  using dir = tempDir("build-link-lazy", {});
  const edge = emitLink(windows, String(dir));
  expect(edge.explicit).toEqual(["obj/bun.o", "cache/libWTF.a"]);
  expect(edge.lazy).toBe("/clang:-Wl,@bun.exe.lazy.rsp");
  expect(edge.group).toBe("/start-lib\nobj/dep/used.o\nobj/dep/unused.o\n/end-lib\n");
});

test.skipIf(isWindows)("Apple's ld has no such group: a native macOS link takes them as plain objects", () => {
  using dir = tempDir("build-link-lazy", {});
  const edge = emitLink(macosNative, String(dir));
  expect(edge.explicit).toEqual(["obj/bun.o", "obj/dep/used.o", "obj/dep/unused.o", "cache/libWTF.a"]);
  expect(edge.lazy).toBe("");
  expect(edge.group).toBeUndefined();
});

test("on Windows only assembler outputs are lazy; elsewhere every dependency object is", () => {
  const objects = ["obj/vendor/zlib/adler32.c.obj", "obj/vendor/boringssl/aesni-gcm-x86_64-win.asm.obj", "obj/x.S.obj"];
  expect(lazyDepObjects({ windows: true } as Config, objects)).toEqual({
    eager: ["obj/vendor/zlib/adler32.c.obj"],
    lazy: ["obj/vendor/boringssl/aesni-gcm-x86_64-win.asm.obj", "obj/x.S.obj"],
  });
  expect(lazyDepObjects({ windows: false } as Config, objects)).toEqual({ eager: [], lazy: objects });
});
