/**
 * scripts/build/msvc.ts against made-up Visual Studio and Windows SDK installs.
 * It finds both from %ProgramData% and %ProgramFiles(x86)%, so pointing those
 * at a temporary directory is a whole machine, on any platform.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { tempDir } from "harness";
import { mkdirSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";

import { BuildError } from "../../../scripts/build/error.ts";
import { findMsvc, loadMsvcEnv, msvcEnv } from "../../../scripts/build/msvc.ts";

const arch = process.arch === "arm64" ? "arm64" : "x64";
const otherArch = arch === "arm64" ? "x64" : "arm64";

type Files = Record<string, string>;

/** A Visual Studio the installer knows about, at `vs/<name>`. */
function visualStudio(root: string, name: string, version: string, toolsets: Files[]): Files {
  const state = JSON.stringify({ installationPath: join(root, "vs", name), installationVersion: version });
  const files: Files = { [`ProgramData/Microsoft/VisualStudio/Packages/_Instances/${name}/state.json`]: state };
  for (const toolset of toolsets) {
    for (const [path, content] of Object.entries(toolset)) files[`vs/${name}/VC/Tools/MSVC/${path}`] = content;
  }
  return files;
}

function toolset(version: string, libArch = arch, toolsHostArch = libArch): Files {
  return {
    [`${version}/include/vcruntime.h`]: "",
    [`${version}/lib/${libArch}/msvcrt.lib`]: "",
    [`${version}/bin/Host${toolsHostArch}/${libArch}/cl.exe`]: "",
    [`${version}/bin/Host${toolsHostArch}/${libArch}/link.exe`]: "",
  };
}

function sdk(version: string, libArch = arch): Files {
  const kit = "ProgramFilesX86/Windows Kits/10";
  return {
    [`${kit}/Include/${version}/um/windows.h`]: "",
    [`${kit}/Include/${version}/ucrt/stdio.h`]: "",
    [`${kit}/Lib/${version}/um/${libArch}/kernel32.lib`]: "",
    [`${kit}/Lib/${version}/ucrt/${libArch}/ucrt.lib`]: "",
    [`${kit}/bin/${version}/${libArch}/rc.exe`]: "",
  };
}

/** Make `files(root)` the machine's disk until the returned directory is disposed. */
function machine(files: (root: string) => Files[]) {
  const dir = tempDir("build-msvc", {});
  const root = String(dir);
  for (const [path, content] of files(root).flatMap(Object.entries)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  process.env.ProgramData = join(root, "ProgramData");
  process.env["ProgramFiles(x86)"] = join(root, "ProgramFilesX86");
  return dir;
}

function findError(): BuildError {
  try {
    findMsvc();
  } catch (error) {
    if (error instanceof BuildError) return error;
    throw error;
  }
  throw new Error("findMsvc() found something");
}

let saved: NodeJS.ProcessEnv;
beforeEach(() => {
  saved = { ...process.env };
});
afterEach(() => {
  for (const name of Object.keys(process.env)) if (!(name in saved)) delete process.env[name];
  Object.assign(process.env, saved);
});

describe("findMsvc", () => {
  test("takes the newest Visual Studio, toolset and SDK, comparing versions as numbers", () => {
    using dir = machine(root => [
      visualStudio(root, "2022", "17.14.37012.4", [toolset("14.44.35207")]),
      visualStudio(root, "18", "18.3.11520.95", [toolset("14.9.1"), toolset("14.50.35717"), toolset("14.44.35207")]),
      visualStudio(root, "2019", "16.11.2.50704", [toolset("14.29.30133")]),
      sdk("10.0.9600.0"),
      sdk("10.0.26100.0"),
      sdk("10.0.22621.0"),
    ]);
    const toolsDir = join(String(dir), "vs", "18", "VC", "Tools", "MSVC", "14.50.35717");
    expect(findMsvc()).toEqual({
      arch,
      toolsHostArch: arch,
      vsDir: join(String(dir), "vs", "18"),
      vsVersion: "18.3.11520.95",
      toolsDir,
      toolsVersion: "14.50.35717",
      sdkDir: join(String(dir), "ProgramFilesX86", "Windows Kits", "10"),
      sdkVersion: "10.0.26100.0",
    });
  });

  test("passes over a newer toolset or SDK that lacks this architecture", () => {
    using _ = machine(root => [
      visualStudio(root, "18", "18.0.0.0", [toolset("14.50.35717", otherArch), toolset("14.44.35207")]),
      sdk("10.0.26100.0", otherArch),
      sdk("10.0.22621.0"),
    ]);
    expect(findMsvc()).toMatchObject({ toolsVersion: "14.44.35207", sdkVersion: "10.0.22621.0" });
  });

  test("passes over a newer toolset that has the tools and headers but not the libraries", () => {
    const { [`14.50.35717/lib/${arch}/msvcrt.lib`]: _libs, ...withoutLibs } = toolset("14.50.35717");
    using _ = machine(root => [
      visualStudio(root, "18", "18.0.0.0", [withoutLibs, toolset("14.44.35207")]),
      sdk("10.0.26100.0"),
    ]);
    expect(findMsvc()).toMatchObject({ toolsVersion: "14.44.35207" });
  });

  test.each(["cl.exe", "link.exe"])("passes over a newer toolset that lacks %s", exe => {
    const { [`14.50.35717/bin/Host${arch}/${arch}/${exe}`]: _exe, ...without } = toolset("14.50.35717");
    using _ = machine(root => [
      visualStudio(root, "18", "18.0.0.0", [without, toolset("14.44.35207")]),
      sdk("10.0.26100.0"),
    ]);
    expect(findMsvc()).toMatchObject({ toolsVersion: "14.44.35207" });
  });

  test("falls back to an older Visual Studio when the newest has no complete toolset", () => {
    using _ = machine(root => [
      visualStudio(root, "18", "18.0.0.0", [toolset("14.50.35717", otherArch)]),
      visualStudio(root, "2022", "17.0.0.0", [toolset("14.44.35207")]),
      sdk("10.0.26100.0"),
    ]);
    expect(findMsvc()).toMatchObject({ vsVersion: "17.0.0.0", toolsVersion: "14.44.35207" });
  });

  test("takes the newest toolset whichever Visual Studio has it, and the newer Visual Studio's of two alike", () => {
    using _ = machine(root => [
      visualStudio(root, "BuildTools", "18.0.0.0", [toolset("14.29.30133"), toolset("14.40.33807")]),
      visualStudio(root, "Community", "17.0.0.0", [toolset("14.44.35207"), toolset("14.40.33807")]),
      sdk("10.0.26100.0"),
    ]);
    expect(findMsvc()).toMatchObject({ vsVersion: "17.0.0.0", toolsVersion: "14.44.35207" });
  });

  test("of one toolset in two Visual Studios, takes the newer Visual Studio's", () => {
    // Named so that the older one is listed first.
    using _ = machine(root => [
      visualStudio(root, "a", "17.0.0.0", [toolset("14.44.35207")]),
      visualStudio(root, "b", "18.0.0.0", [toolset("14.44.35207")]),
      sdk("10.0.26100.0"),
    ]);
    expect(findMsvc()).toMatchObject({ vsVersion: "18.0.0.0", toolsVersion: "14.44.35207" });
  });

  test("finds what the caller's target needs, whatever this process runs as", () => {
    using dir = machine(root => [
      visualStudio(root, "18", "18.0.0.0", [toolset("14.50.35717"), toolset("14.44.35207", otherArch)]),
      sdk("10.0.26100.0"),
      sdk("10.0.22621.0", otherArch),
    ]);
    const found = findMsvc(otherArch);
    expect(found).toMatchObject({ arch: otherArch, toolsVersion: "14.44.35207", sdkVersion: "10.0.22621.0" });
    expect(msvcEnv(found).vars.LIB!.split(delimiter)).toEqual([
      join(String(dir), "vs", "18", "VC", "Tools", "MSVC", "14.44.35207", "lib", otherArch),
      join(String(dir), "ProgramFilesX86", "Windows Kits", "10", "Lib", "10.0.22621.0", "ucrt", otherArch),
      join(String(dir), "ProgramFilesX86", "Windows Kits", "10", "Lib", "10.0.22621.0", "um", otherArch),
    ]);
    expect(msvcEnv(found).vars.VSCMD_ARG_TGT_ARCH).toBe(otherArch);
  });

  test("runs the x64 tools for arm64 where there are no native ones", () => {
    using _ = machine(root => [
      visualStudio(root, "18", "18.0.0.0", [toolset("14.50.35717", "arm64", "x64")]),
      sdk("10.0.26100.0", "arm64"),
    ]);
    expect(findMsvc("arm64")).toMatchObject({ arch: "arm64", toolsHostArch: "x64" });
  });

  test("ignores the developer shell it is run from", () => {
    using dir = machine(root => [
      visualStudio(root, "18", "18.0.0.0", [toolset("14.50.35717")]),
      visualStudio(root, "2022", "17.0.0.0", [toolset("14.44.35207")]),
      sdk("10.0.26100.0"),
      sdk("10.0.22621.0"),
    ]);
    const old = join(String(dir), "vs", "2022");
    process.env.VSINSTALLDIR = old;
    process.env.VCINSTALLDIR = join(old, "VC");
    process.env.VCToolsInstallDir = join(old, "VC", "Tools", "MSVC", "14.44.35207");
    process.env.VCToolsVersion = "14.44.35207";
    process.env.WindowsSDKVersion = "10.0.22621.0\\";
    expect(findMsvc()).toMatchObject({ toolsVersion: "14.50.35717", sdkVersion: "10.0.26100.0" });
  });

  test("skips an instance whose state.json does not parse", () => {
    using _ = machine(root => [
      { "ProgramData/Microsoft/VisualStudio/Packages/_Instances/broken/state.json": "{" },
      { "ProgramData/Microsoft/VisualStudio/Packages/_Instances/empty/state.json": "{}" },
      visualStudio(root, "2022", "17.0.0.0", [toolset("14.44.35207")]),
      sdk("10.0.26100.0"),
    ]);
    expect(findMsvc()).toMatchObject({ toolsVersion: "14.44.35207" });
  });

  test("says which of Visual Studio, a toolset and the SDK is missing", () => {
    {
      using _ = machine(() => [sdk("10.0.26100.0")]);
      expect(findError().message).toBe("Visual Studio is not installed");
    }
    {
      using dir = machine(root => [
        visualStudio(root, "18", "18.0.0.0", [toolset("14.50.35717", otherArch)]),
        sdk("10.0.26100.0"),
      ]);
      const error = findError();
      expect(error.message).toBe(`No installed MSVC toolset has the ${arch} compiler and libraries`);
      expect(error.hint).toContain(
        `incomplete: ${join(String(dir), "vs", "18", "VC", "Tools", "MSVC", "14.50.35717")}`,
      );
    }
  });

  // On Windows the registry names the machine's real SDK once the usual directory has none.
  test.skipIf(process.platform === "win32")("says the SDK is missing", () => {
    using _ = machine(root => [visualStudio(root, "18", "18.0.0.0", [toolset("14.50.35717")])]);
    expect(findError().message).toBe(`No installed Windows SDK has the ${arch} headers and libraries`);
  });
});

describe("msvcEnv", () => {
  test("names only directories that exist", () => {
    using dir = machine(root => [
      visualStudio(root, "18", "18.3.11520.95", [toolset("14.50.35717")]),
      sdk("10.0.26100.0"),
    ]);
    const vs = join(String(dir), "vs", "18");
    const tools = join(vs, "VC", "Tools", "MSVC", "14.50.35717");
    const kit = join(String(dir), "ProgramFilesX86", "Windows Kits", "10");
    const include = [
      join(tools, "include"),
      join(kit, "Include", "10.0.26100.0", "ucrt"),
      join(kit, "Include", "10.0.26100.0", "um"),
    ].join(delimiter);
    expect(msvcEnv(findMsvc())).toEqual({
      vars: {
        INCLUDE: include,
        EXTERNAL_INCLUDE: include,
        LIB: [
          join(tools, "lib", arch),
          join(kit, "Lib", "10.0.26100.0", "ucrt", arch),
          join(kit, "Lib", "10.0.26100.0", "um", arch),
        ].join(delimiter),
        VSINSTALLDIR: `${vs}\\`,
        VCINSTALLDIR: `${join(vs, "VC")}\\`,
        VCToolsInstallDir: `${tools}\\`,
        VCToolsVersion: "14.50.35717",
        VisualStudioVersion: "18.0",
        VSCMD_VER: "18.3.11520.95",
        VSCMD_ARG_HOST_ARCH: arch,
        VSCMD_ARG_TGT_ARCH: arch,
        WindowsSdkDir: `${kit}\\`,
        WindowsSDKVersion: "10.0.26100.0\\",
        WindowsSDKLibVersion: "10.0.26100.0\\",
        WindowsSdkBinPath: `${join(kit, "bin")}\\`,
        WindowsSdkVerBinPath: `${join(kit, "bin", "10.0.26100.0")}\\`,
        UniversalCRTSdkDir: `${kit}\\`,
        UCRTVersion: "10.0.26100.0",
      },
      path: [join(tools, "bin", `Host${arch}`, arch), join(kit, "bin", "10.0.26100.0", arch)],
    });
  });
});

describe("loadMsvcEnv", () => {
  test("puts the tools ahead of PATH once, however often it runs", () => {
    using _ = machine(root => [visualStudio(root, "18", "18.0.0.0", [toolset("14.50.35717")]), sdk("10.0.26100.0")]);
    process.env.PATH = ["first", "second"].join(delimiter);
    process.env.LIB = "stale";
    const { vars, path } = msvcEnv(findMsvc());

    loadMsvcEnv();
    loadMsvcEnv();

    expect(process.env.PATH!.split(delimiter)).toEqual([...path, "first", "second"]);
    expect(process.env.LIB).toBe(vars.LIB!);
  });
});
