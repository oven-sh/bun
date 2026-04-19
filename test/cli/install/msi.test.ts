// Validates the Windows MSI packaging sources. These run on every platform
// because the .wxs/.ps1 files are plain text; an actual `wix build` only
// happens on Windows CI in the `windows-msi` Buildkite step.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..", "..", "..");
const msiDir = join(repoRoot, "packages", "bun-msi");

// Tiny helpers to pick attributes out of the first matching element in the
// .wxs without pulling in an XML dependency. The source is ours and
// hand-formatted so a non-greedy attribute scan is sufficient; if the tag
// or attribute isn't there we return undefined and the calling assertion
// fails with a readable diff.
function elements(src: string, tag: string): string[] {
  return [...src.matchAll(new RegExp(`<${tag}\\b[^>]*?\\/?>`, "gs"))].map(m => m[0]);
}
function attr(el: string | undefined, name: string): string | undefined {
  if (!el) return undefined;
  return el.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`))?.[1];
}
function findBy(src: string, tag: string, key: string, value: string): string | undefined {
  return elements(src, tag).find(e => attr(e, key) === value);
}

describe("packages/bun-msi/bun.wxs", () => {
  const wxs = readFileSync(join(msiDir, "bun.wxs"), "utf8");

  test("container elements are balanced and use the WiX v4/v5 schema", () => {
    // Catch the easy-to-miss mistakes: a stray `<` from a botched edit, a
    // missing close tag. This doesn't validate against the XSD — WiX does
    // that at build time on the windows-msi agent — but it stops
    // obviously-broken pushes from every other lane.
    // Comments and CDATA are stripped first so prose like
    // `bun-windows-<arch>.msi` and the VBScript body don't confuse the scan.
    const body = wxs.replace(/<!--[\s\S]*?-->/g, "").replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "");
    const opens: string[] = [];
    for (const m of body.matchAll(/<\/?([A-Za-z][\w:.-]*)\b[^>]*?(\/?)>/gs)) {
      const [raw, name, selfClose] = m;
      if (raw.startsWith("</")) {
        expect(opens.pop()).toBe(name);
      } else if (selfClose !== "/") {
        opens.push(name);
      }
    }
    expect(opens).toEqual([]);

    expect(attr(elements(wxs, "Wix")[0], "xmlns")).toBe("http://wixtoolset.org/schemas/v4/wxs");
  });

  test("Package metadata is wired to preprocessor vars", () => {
    const pkg = elements(wxs, "Package")[0];
    expect({
      Name: attr(pkg, "Name"),
      Manufacturer: attr(pkg, "Manufacturer"),
      Scope: attr(pkg, "Scope"),
      Version: attr(pkg, "Version"),
      UpgradeCode: attr(pkg, "UpgradeCode"),
      Compressed: attr(pkg, "Compressed"),
    }).toEqual({
      Name: "Bun",
      Manufacturer: "Oven",
      Scope: "perMachine",
      Version: "$(BunVersion)",
      UpgradeCode: "$(BunUpgradeCode)",
      Compressed: "yes",
    });
  });

  test("installs bun.exe and bunx.exe under ProgramFiles64\\Bun\\bin", () => {
    const pf = elements(wxs, "StandardDirectory")[0];
    expect(attr(pf, "Id")).toBe("ProgramFiles64Folder");

    const installDir = findBy(wxs, "Directory", "Id", "INSTALLFOLDER");
    expect(attr(installDir, "Name")).toBe("Bun");
    const binDir = findBy(wxs, "Directory", "Id", "BunBinFolder");
    expect(attr(binDir, "Name")).toBe("bin");

    const group = elements(wxs, "ComponentGroup")[0];
    expect(attr(group, "Id")).toBe("BunFiles");
    expect(attr(group, "Directory")).toBe("BunBinFolder");

    const fileNames = elements(wxs, "File")
      .map(f => attr(f, "Name"))
      .sort();
    expect(fileNames).toEqual(["bun.exe", "bunx.exe"]);
  });

  test("appends the bin folder to system PATH", () => {
    const env = findBy(wxs, "Environment", "Name", "PATH");
    expect({
      Action: attr(env, "Action"),
      Part: attr(env, "Part"),
      System: attr(env, "System"),
      Permanent: attr(env, "Permanent"),
      Value: attr(env, "Value"),
    }).toEqual({
      Action: "set",
      Part: "last",
      System: "yes",
      Permanent: "no",
      Value: "[BunBinFolder]",
    });
  });

  test("sets BUN_INSTALL to the install root without a trailing backslash", () => {
    const env = findBy(wxs, "Environment", "Name", "BUN_INSTALL");
    expect({
      Action: attr(env, "Action"),
      Part: attr(env, "Part"),
      System: attr(env, "System"),
      Permanent: attr(env, "Permanent"),
      Value: attr(env, "Value"),
    }).toEqual({
      Action: "set",
      Part: "all",
      System: "yes",
      Permanent: "no",
      Value: "[BUNINSTALLVALUE]",
    });

    const setProp = findBy(wxs, "SetProperty", "Id", "BUNINSTALLVALUE");
    expect(attr(setProp, "Value")).toBe("[INSTALLFOLDER]");

    const ca = wxs.match(/<CustomAction\b[^>]*Id="StripTrailingSlash"[^>]*>([\s\S]*?)<\/CustomAction>/);
    expect(ca?.[1]).toContain('Right(p, 1) = "\\"');

    const seq = elements(wxs, "Custom").find(e => attr(e, "Action") === "StripTrailingSlash");
    expect(attr(seq, "Before")).toBe("WriteEnvironmentStrings");
  });

  test("gates on Windows 10 1809 / build 17763 like install.ps1", () => {
    const launch = elements(wxs, "Launch")[0];
    expect(attr(launch, "Condition")).toContain("WINDOWSBUILDNUMBER &gt;= 17763");

    const installPs1 = readFileSync(join(repoRoot, "src", "cli", "install.ps1"), "utf8");
    expect(installPs1).toMatch(/\$MinBuild\s*=\s*17763/);
  });

  test("wires the branded UI bitmaps and ARP icon", () => {
    const vars = Object.fromEntries(elements(wxs, "WixVariable").map(v => [attr(v, "Id"), attr(v, "Value")]));
    expect(vars).toEqual({
      WixUIBannerBmp: "$(BunBannerBmp)",
      WixUIDialogBmp: "$(BunDialogBmp)",
      WixUILicenseRtf: "$(BunLicense)",
    });

    const ui = elements(wxs, "ui:WixUI")[0];
    expect(attr(ui, "Id")).toBe("WixUI_InstallDir");
    expect(attr(ui, "InstallDirectory")).toBe("INSTALLFOLDER");

    expect(attr(elements(wxs, "Icon")[0], "SourceFile")).toBe("$(BunIcon)");
    const arpIcon = findBy(wxs, "Property", "Id", "ARPPRODUCTICON");
    expect(attr(arpIcon, "Value")).toBe("BunIcon");
    const arpUrl = findBy(wxs, "Property", "Id", "ARPURLINFOABOUT");
    expect(attr(arpUrl, "Value")).toBe("https://bun.com");

    const exitText = findBy(wxs, "Property", "Id", "WIXUI_EXITDIALOGOPTIONALTEXT");
    expect(attr(exitText, "Value")).toContain("bun --version");
  });

  test("exposes ADDTOPATH / SETBUNINSTALL as Secure public properties", () => {
    const addToPath = findBy(wxs, "Property", "Id", "ADDTOPATH");
    expect({ Value: attr(addToPath, "Value"), Secure: attr(addToPath, "Secure") }).toEqual({
      Value: "1",
      Secure: "yes",
    });
    const setBunInstall = findBy(wxs, "Property", "Id", "SETBUNINSTALL");
    expect({ Value: attr(setBunInstall, "Value"), Secure: attr(setBunInstall, "Secure") }).toEqual({
      Value: "1",
      Secure: "yes",
    });

    // Each is wired to a sub-feature that disables at Level 0 when the
    // property is "0", so `msiexec /i ... ADDTOPATH=0` actually skips it.
    const pathFeature = findBy(wxs, "Feature", "Id", "PathEnv");
    expect(attr(pathFeature, "Level")).toBe("1");
    const envFeature = findBy(wxs, "Feature", "Id", "BunInstallEnv");
    expect(attr(envFeature, "Level")).toBe("1");

    const levelToggles = elements(wxs, "Level").map(l => ({
      Value: attr(l, "Value"),
      Condition: attr(l, "Condition"),
    }));
    expect(levelToggles).toEqual([
      { Value: "0", Condition: "ADDTOPATH = &quot;0&quot;" },
      { Value: "0", Condition: "SETBUNINSTALL = &quot;0&quot;" },
    ]);
  });

  test("writes HKLM\\Software\\Oven\\Bun for fleet inventory", () => {
    const key = elements(wxs, "RegistryKey")[0];
    expect({ Root: attr(key, "Root"), Key: attr(key, "Key") }).toEqual({
      Root: "HKLM",
      Key: "Software\\Oven\\Bun",
    });
    const valueNames = elements(wxs, "RegistryValue")
      .filter(v => attr(v, "Name") && !attr(v, "Name")?.endsWith("Installed") && !attr(v, "Name")?.endsWith("Set"))
      .map(v => attr(v, "Name"))
      .sort();
    expect(valueNames).toEqual(["BinDir", "InstallRoot", "Version"]);
  });

  test("defines MajorUpgrade and distinct per-arch UpgradeCodes", () => {
    const mu = elements(wxs, "MajorUpgrade")[0];
    expect(attr(mu, "AllowSameVersionUpgrades")).toBe("yes");
    expect(attr(mu, "DowngradeErrorMessage")).toContain("newer version of Bun");

    const guids = [...wxs.matchAll(/BunUpgradeCode\s*=\s*"([0-9a-f-]{36})"/gi)].map(m => m[1].toLowerCase());
    expect(guids).toHaveLength(2);
    expect(new Set(guids).size).toBe(2);
    for (const g of guids) {
      expect(g).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    }
  });
});

describe("packages/bun-msi/build-msi.ps1", () => {
  const ps1 = readFileSync(join(msiDir, "build-msi.ps1"), "utf8");

  test("declares the documented parameters", () => {
    expect(ps1).toMatch(/\[ValidateSet\("x64",\s*"arm64"\)\]\s*\r?\n\s*\[string\]\$Arch/);
    for (const p of ["$BunExe", "$Arch", "$Version", "$Output"]) {
      expect(ps1).toContain(p);
    }
  });

  test("renders both WixUI bitmaps from src/bun.ico in Bun brand colours", () => {
    expect(ps1).toMatch(/New-BunBitmap\s+-Width\s+493\s+-Height\s+312\b/);
    expect(ps1).toMatch(/New-BunBitmap\s+-Width\s+493\s+-Height\s+58\b/);
    expect(ps1).toContain("System.Drawing");
    expect(ps1).toContain("src\\bun.ico");
    // Brand gradient stops are literal so a palette drift on bun.com
    // doesn't silently change the installer.
    expect(ps1).toContain("#fbf0df");
    expect(ps1).toContain("#f6dece");
  });

  test("invokes wix build with every preprocessor var bun.wxs consumes", () => {
    const wxs = readFileSync(join(msiDir, "bun.wxs"), "utf8");
    const referenced = new Set([...wxs.matchAll(/\$\((Bun\w+)\)/g)].map(m => m[1]));
    // Derived preprocessor vars defined inside the .wxs don't come from -d.
    referenced.delete("BunUpgradeCode");
    referenced.delete("BunPlatform");
    expect([...referenced].sort()).toEqual(
      ["BunArch", "BunBannerBmp", "BunDialogBmp", "BunExe", "BunIcon", "BunLicense", "BunVersion", "BunxExe"].sort(),
    );
    for (const d of referenced) {
      expect(ps1).toContain(`-d "${d}=`);
    }
    expect(ps1).toContain("WixToolset.UI.wixext");
    expect(ps1).toContain("-arch $Arch");
  });
});

describe(".buildkite windows-msi wiring", () => {
  const sh = readFileSync(join(repoRoot, ".buildkite", "scripts", "upload-release.sh"), "utf8");
  const ci = readFileSync(join(repoRoot, ".buildkite", "ci.mjs"), "utf8");
  const driver = readFileSync(join(repoRoot, ".buildkite", "scripts", "build-windows-msi.ps1"), "utf8");

  test("upload-release.sh publishes .msi artifacts when the step ran", () => {
    expect(sh).toContain("WINDOWS_MSI_STEP");
    expect(sh).toContain("bun-windows-x64.msi");
    expect(sh).toContain("bun-windows-x64-baseline.msi");
    expect(sh).toContain("bun-windows-aarch64.msi");
    // .msi routing must be checked before the generic bun-windows-* case
    // so MSIs aren't fetched from the sign step (which doesn't have them).
    expect(sh.indexOf("bun-windows-*.msi")).toBeGreaterThan(0);
    expect(sh.indexOf("bun-windows-*.msi")).toBeLessThan(
      sh.indexOf('"$WINDOWS_ARTIFACT_STEP" && "$name" == bun-windows-*'),
    );
  });

  test("ci.mjs defines the windows-msi step and threads it into release", () => {
    expect(ci).toContain("function getWindowsMsiStep(");
    expect(ci).toContain('key: "windows-msi"');
    expect(ci).toContain("build-windows-msi.ps1");
    expect(ci).toContain('platform.arch === "aarch64" ? "arm64" : "x64"');
    expect(ci).toContain('WINDOWS_MSI_STEP: msi ? "windows-msi" : ""');
    expect(ci).toMatch(/buildMsi:\s*parseOption\(\/\\\[\(build msi\|msi\)\\\]\/i\)/);
  });

  test("CI driver forwards the expected knobs to build-msi.ps1", () => {
    for (const p of ["-BunExe", "-Arch", "-Version", "-Output"]) {
      expect(driver).toContain(p);
    }
    expect(driver).toContain("packages\\bun-msi\\build-msi.ps1");
    expect(driver).toContain("buildkite-agent artifact upload");
  });
});
