import { describe, expect, test } from "bun:test";
import { existsSync, linkSync, mkdirSync, readdirSync, readFileSync, symlinkSync } from "fs";
import { bunEnv, bunExe, isWindows, substDrive, tempDir, unprivilegedSpawnOptions } from "harness";
import { join } from "path";

async function compile(cwd: string, args: string[], user: { uid?: number; gid?: number } = {}) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "compile", "--library", ...args],
    cwd,
    env: { ...bunEnv, NO_COLOR: "1" },
    stdout: "pipe",
    stderr: "pipe",
    ...user,
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

// Every file under `folder`, with its text.
const filesIn = (folder: string) =>
  readdirSync(folder, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => join(entry.parentPath, entry.name))
    .sort()
    .map(path => [path, readFileSync(path, "utf8")]);

const packageJson = JSON.stringify({
  name: "@acme/shapes",
  version: "1.2.3",
  scripts: { build: "bun compile --library" },
});
// The project is packages/shapes, so that a test can name the folders around it.
const packages = {
  packages: {
    shapes: {
      "package.json": packageJson,
      "src/index.js": `export const sides = 4;\n`,
    },
  },
};
const workspace = () => tempDir("library-outdir", packages);
const built = ["index.d.ts", "index.js", "package.json"];
const linkFolder = (target: string, path: string) => symlinkSync(target, path, "junction");

const outdirHoldsProject = (folder: string) =>
  `error: --library writes a package.json into --outdir, so --outdir can't be the project folder (${folder}). Use a folder inside it, such as --outdir=dist\n`;
const entryPointInsideOutdir = (entryPoint: string) =>
  `error: the entry point ${entryPoint} is inside --outdir, where it would be overwritten. Choose another --outdir\n`;

// True if the file system of the temp directory ignores case.
const isCaseInsensitive = (() => {
  using dir = tempDir("library-case", { probe: "" });
  return existsSync(join(String(dir), "PROBE"));
})();

// True if the volume of the temp directory gives a long name a short one too. NTFS does, unless that is turned off.
const hasShortNames =
  isWindows &&
  (() => {
    using dir = tempDir("library-short-names", { "long-directory-name": {} });
    return existsSync(join(String(dir), "LONG-D~1"));
  })();

// No file under `dir` is written, changed or removed.
async function expectRefused(dir: string, cwd: string, args: string[], stderr: string, user = {}) {
  const before = filesIn(dir);
  expect(await compile(cwd, args, user)).toEqual({ stdout: "", stderr, exitCode: 1 });
  expect(filesIn(dir)).toEqual(before);
}

describe.concurrent("bun compile --library --outdir", () => {
  // `\` is a separator on every platform, as it is for the entry points.
  test.each([
    ["./", "."],
    [".//", "."],
    ["../", "src"],
    ["<project>/", "."],
    [".\\", "."],
    ["..\\", "src"],
    ["<project>\\", "."],
  ])("%j from %j is the project folder", async (outdir, from) => {
    using dir = workspace();
    const project = join(String(dir), "packages/shapes");
    const args = ["--outdir", outdir.replace("<project>", project)];
    await expectRefused(String(dir), join(project, from), args, outdirHoldsProject(project));
  });

  test.each([
    ["../", "."],
    ["../../", "src"],
  ])("%j from %j holds the project folder", async (outdir, from) => {
    using dir = workspace();
    const cwd = join(String(dir), "packages/shapes", from);
    await expectRefused(String(dir), cwd, ["--outdir", outdir], outdirHoldsProject(join(String(dir), "packages")));
  });

  test.skipIf(isWindows)("/ holds the project folder", async () => {
    using dir = workspace();
    const project = join(String(dir), "packages/shapes");
    // Without the check, root would write into `/`.
    using unprivileged = unprivilegedSpawnOptions(String(dir));
    await expectRefused(String(dir), project, ["--outdir", "/"], outdirHoldsProject("/"), unprivileged);
  });

  test.skipIf(!isWindows)("the root of the drive holds the project folder", async () => {
    using dir = workspace();
    using drive = substDrive(String(dir));
    const project = join(drive.root, "packages/shapes");
    for (const outdir of ["\\", "/", drive.root, drive.root.toLowerCase(), "..\\..\\"]) {
      await expectRefused(drive.root, project, ["--outdir", outdir], outdirHoldsProject(drive.root));
    }
  });

  test("a link to the project folder is refused", async () => {
    using dir = workspace();
    const project = join(String(dir), "packages/shapes");
    // As `bun install` links a package of a workspace into the packages that use it.
    mkdirSync(join(String(dir), "packages/app/node_modules/@acme"), { recursive: true });
    linkFolder(project, join(String(dir), "packages/app/node_modules/@acme/shapes"));
    for (const outdir of ["../app/node_modules/@acme/shapes", "../app/node_modules/@acme/shapes/"]) {
      await expectRefused(String(dir), project, ["--outdir", outdir], outdirHoldsProject(project));
    }
  });

  test("a link to a folder that holds the project is refused", async () => {
    using dir = workspace();
    const project = join(String(dir), "packages/shapes");
    linkFolder(join(String(dir), "packages"), join(String(dir), "up"));
    const refused = outdirHoldsProject(join(String(dir), "packages"));
    await expectRefused(String(dir), project, ["--outdir", "../../up"], refused);
  });

  // The working directory of a process on Windows keeps the link, so there the two are one spelling.
  test.skipIf(isWindows)("the $PWD of a shell that a link led to the project is refused", async () => {
    using dir = workspace();
    const project = join(String(dir), "packages/shapes");
    linkFolder(join(String(dir), "packages"), join(String(dir), "link"));
    const pwd = join(String(dir), "link/shapes");
    await expectRefused(String(dir), pwd, ["--outdir", pwd], outdirHoldsProject(project));
  });

  // On Windows only the real path of the project folder tells that the two are one.
  test("the project folder is refused where a link led to the working directory", async () => {
    using dir = workspace();
    const project = join(String(dir), "packages/shapes");
    linkFolder(join(String(dir), "packages"), join(String(dir), "link"));
    const cwd = join(String(dir), "link/shapes");
    await expectRefused(String(dir), cwd, ["--outdir", project], outdirHoldsProject(project));
  });

  // `LONG-D~1` is the short name of `long-directory-name`.
  test.skipIf(!hasShortNames)("the project folder under its short name is refused", async () => {
    using dir = tempDir("library-outdir", { "long-directory-name": packages });
    const long = join(String(dir), "long-directory-name");
    const project = join(long, "packages/shapes");
    const underShortName = join(String(dir), "LONG-D~1", "packages/shapes");
    await expectRefused(long, project, ["--outdir", underShortName], outdirHoldsProject(project));
    await expectRefused(long, underShortName, ["--outdir", project], outdirHoldsProject(project));
  });

  // A name in another case is not the name of the project folder. The real path of the folder that it opens is.
  test.skipIf(!isCaseInsensitive)("the project folder in another case is refused", async () => {
    using dir = workspace();
    const project = join(String(dir), "packages/shapes");
    await expectRefused(String(dir), project, ["--outdir", "../SHAPES"], outdirHoldsProject(project));
  });

  test("a folder whose package.json is a link to the project's own is refused", async () => {
    using dir = workspace();
    const project = join(String(dir), "packages/shapes");
    // As `bun install` links the files of a `file:` dependency.
    const installed = join(String(dir), "packages/app/node_modules/@acme/shapes");
    mkdirSync(installed, { recursive: true });
    linkSync(join(project, "package.json"), join(installed, "package.json"));
    const refused = `error: --library writes a package.json into --outdir, but ${join(installed, "package.json")} is a link to the project's own package.json. Delete it or choose another --outdir\n`;
    await expectRefused(String(dir), project, ["--outdir", "../app/node_modules/@acme/shapes"], refused);
  });

  test.each([
    ["src/", "src/index.js"],
    ["./src//", "src/index.js"],
    ["src", "src"],
    ["src\\", "src/index.js"],
  ])("%j holds the entry point %j", async (outdir, entryPoint) => {
    using dir = workspace();
    const project = join(String(dir), "packages/shapes");
    const args = [entryPoint, "--outdir", outdir];
    await expectRefused(String(dir), project, args, entryPointInsideOutdir(entryPoint));
  });

  test("a link to the folder of an entry point is refused", async () => {
    using dir = workspace();
    const project = join(String(dir), "packages/shapes");
    linkFolder(join(project, "src"), join(String(dir), "packages/built"));
    const args = ["src/index.js", "--outdir", "../built"];
    await expectRefused(String(dir), project, args, entryPointInsideOutdir("src/index.js"));
  });

  test("the folder of an entry point is refused when a link leads to the entry point", async () => {
    using dir = workspace();
    const project = join(String(dir), "packages/shapes");
    linkFolder(join(project, "src"), join(project, "sources"));
    const args = ["sources/index.js", "--outdir", "src"];
    await expectRefused(String(dir), project, args, entryPointInsideOutdir("sources/index.js"));
  });

  const noEntryPoint = (project: string) =>
    `error: No entry point. There is no "exports", "module" or "main" in package.json that is a source file, and no index.ts, index.tsx, index.mts or index.js in ${project} or in its src folder\n\nUsage:\n  $ bun compile <entrypoint> [...flags]\n\nTo see full documentation:\n  $ bun compile --help\n`;
  const earlierBuild = {
    "package.json": JSON.stringify({ name: "shapes", version: "1.0.0", main: "dist/index.js" }),
    "dist/index.js": `export const from = "an earlier build";\n`,
  };

  // `../link/dist` is the folder `dist` by its real path only.
  test.each(["dist/", "../link/dist"])("without an entry point, a file in %j is not a source", async outdir => {
    using dir = tempDir("library-outdir-earlier-build", { shapes: earlierBuild });
    const project = join(String(dir), "shapes");
    linkFolder(project, join(String(dir), "link"));
    await expectRefused(String(dir), project, ["--outdir", outdir], noEntryPoint(project));
  });

  // The rest run a whole build.
  test.each(["dist/", "dist\\"])("%j, a link to a folder outside the project, is written to", async outdir => {
    using dir = tempDir("library-outdir-accepted", {
      shapes: {
        "package.json": JSON.stringify({ name: "shapes", version: "1.0.0", main: "dist/index.js", bin: "./cli.js" }),
        "index.js": `export const from = "the source";\n`,
      },
      elsewhere: { "index.js": `export const from = "an earlier build";\n` },
    });
    const project = join(String(dir), "shapes");
    linkFolder(join(String(dir), "elsewhere"), join(project, "dist"));
    expect(await compile(project, ["--outdir", outdir])).toMatchObject({
      stderr: `warn: dist/package.json has no "shapes" bin, because ./cli.js is not an entry point\n`,
      exitCode: 0,
    });
    expect(readdirSync(join(String(dir), "elsewhere")).sort()).toEqual(built);
    expect(readFileSync(join(String(dir), "elsewhere/index.js"), "utf8")).toContain("the source");
  });

  test(".. is resolved before a link is followed, and every file is written there", async () => {
    using dir = workspace();
    const project = join(String(dir), "packages/shapes");
    mkdirSync(join(project, "out"));
    linkFolder(join(project, "src"), join(project, "out/sources"));
    expect(await compile(project, ["src/index.js", "--outdir", "out/sources/.."])).toMatchObject({
      stderr: "",
      exitCode: 0,
    });
    expect(readdirSync(join(project, "out")).sort()).toEqual([...built, "sources"]);
    expect(readdirSync(join(project, "src"))).toEqual(["index.js"]);
    expect(readdirSync(project).sort()).toEqual(["out", "package.json", "src"]);
    expect(readFileSync(join(project, "package.json"), "utf8")).toBe(packageJson);
  });

  // Only without `--root` is the root directory of the build the folder of the entry points.
  test("a --root inside --outdir is not taken for the folder of the entry points", async () => {
    using dir = workspace();
    const project = join(String(dir), "packages/shapes");
    mkdirSync(join(project, "out/root"), { recursive: true });
    expect(await compile(project, ["src/index.js", "--root", "out/root", "--outdir", "out"])).toMatchObject({
      stderr: expect.stringContaining("because it is outside the root directory"),
      exitCode: 1,
    });
  });
});
