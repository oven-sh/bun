import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isRoot, isWindows, tempDir } from "harness";
import { chmodSync, readFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";

// The resolver walks from the filesystem root down to a directory to build its
// `DirInfo` (package.json, tsconfig.json, node_modules). That walk must not
// read the listing of any directory on the way: startup would then scale with
// the number of entries in the cwd and in every ancestor (200k files in
// $TMPDIR cost ~150 ms per spawn). A listing is read only when something
// needs the names in a directory: a relative import probes extensions,
// `bun test` scans for test files.

async function run(cmd: string[], cwd: string, env: Record<string, string | undefined> = {}) {
  await using proc = Bun.spawn({
    cmd,
    cwd,
    env: { ...bunEnv, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

/** The count of directory listings this process read, via `bun:internal-for-testing`. */
const countListings = `import { getCounters } from "bun:internal-for-testing"; console.log("listings", getCounters().readdir);`;

/** Program output, with the `listings N` line taken out. */
function splitListings(stdout: string): { output: string; listings: number } {
  const lines = stdout.split("\n");
  const line = lines.find(l => l.startsWith("listings "));
  return {
    output: lines.filter(l => !l.startsWith("listings ")).join("\n"),
    listings: line === undefined ? -1 : Number(line.slice("listings ".length)),
  };
}

describe("startup does not list directories", () => {
  test.concurrent("bun -e reads no directory listing", async () => {
    using dir = tempDir("no-listing-eval", {
      "a/b/c/.keep": "",
      "a/package.json": JSON.stringify({ name: "a" }),
      "a/b/tsconfig.json": "{}",
    });
    const { stdout, stderr, exitCode } = await run([bunExe(), "-e", countListings], join(dir, "a/b/c"));
    expect({ ...splitListings(stdout), stderr, exitCode }).toEqual({
      output: "",
      listings: 0,
      stderr: "",
      exitCode: 0,
    });
  });

  test.concurrent("running a script reads no directory listing", async () => {
    using dir = tempDir("no-listing-run", {
      "a/b/c/script.js": `console.log(import.meta.path === process.argv[1] ? "same" : import.meta.path);\n${countListings}`,
      "a/package.json": JSON.stringify({ name: "a" }),
    });
    const script = join(dir, "a/b/c/script.js");
    const { stdout, stderr, exitCode } = await run([bunExe(), script], join(dir, "a/b"));
    expect({ ...splitListings(stdout), stderr, exitCode }).toEqual({
      output: "same\n",
      listings: 0,
      stderr: "",
      exitCode: 0,
    });
  });

  test.concurrent("a relative import lists only the importing directory", async () => {
    using dir = tempDir("one-listing-import", {
      "a/b/c/index.js": `import { dep } from "./dep"; console.log(dep);\n${countListings}`,
      "a/b/c/dep.js": `export const dep = "dep";`,
    });
    const { stdout, stderr, exitCode } = await run([bunExe(), "index.js"], join(dir, "a/b/c"));
    expect({ ...splitListings(stdout), stderr, exitCode }).toEqual({
      output: "dep\n",
      listings: 1,
      stderr: "",
      exitCode: 0,
    });
  });

  test.concurrent("a bare import lists node_modules and the package, not .bin", async () => {
    using dir = tempDir("one-listing-bare-import", {
      "index.js": `import { v } from "pkg"; console.log(v);\n${countListings}`,
      "node_modules/pkg/package.json": JSON.stringify({ name: "pkg", main: "main.js" }),
      "node_modules/pkg/main.js": `export const v = "from pkg";`,
      "node_modules/.bin/.keep": "",
      "node_modules/other/index.js": "",
    });
    const { stdout, stderr, exitCode } = await run([bunExe(), "index.js"], String(dir));
    expect({ ...splitListings(stdout), stderr, exitCode }).toEqual({
      output: "from pkg\n",
      listings: 2,
      stderr: "",
      exitCode: 0,
    });
  });

  test.concurrent("a directory or file name that contains '..' still avoids the listing", async () => {
    using dir = tempDir("no-listing-dotdot", {
      "a..b/z..js": `console.log(import.meta.path);\n${countListings}`,
    });
    const script = join(dir, "a..b/z..js");
    const { stdout, stderr, exitCode } = await run([bunExe(), script], String(dir));
    expect({ ...splitListings(stdout), stderr, exitCode }).toEqual({
      output: script + "\n",
      listings: 0,
      stderr: "",
      exitCode: 0,
    });
  });

  test.concurrent("an entry path with a '..' segment runs as its normalized path", async () => {
    using dir = tempDir("entry-dotdot-segment", {
      "x/y.js": `console.log(import.meta.path);`,
      "other/.keep": "",
    });
    // Not `join`: it would normalize the argument before bun sees it.
    const { stdout, stderr, exitCode } = await run([bunExe(), `${dir}/other/../x//y.js`], String(dir));
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: join(dir, "x/y.js") + "\n", stderr: "", exitCode: 0 });
  });
});

describe("DirInfo markers without a listing", () => {
  test.concurrent("a bare import finds node_modules in the cwd", async () => {
    using dir = tempDir("markers-node-modules", {
      "index.js": `import { v } from "pkg"; console.log(v);`,
      "node_modules/pkg/package.json": JSON.stringify({ name: "pkg", main: "main.js" }),
      "node_modules/pkg/main.js": `export const v = "from pkg";`,
    });
    const { stdout, stderr, exitCode } = await run([bunExe(), "index.js"], String(dir));
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "from pkg\n", stderr: "", exitCode: 0 });
  });

  test.concurrent("tsconfig paths in the cwd apply", async () => {
    using dir = tempDir("markers-tsconfig", {
      "index.ts": `import { v } from "@app/dep"; console.log(v);`,
      "src/dep.ts": `export const v = "via paths";`,
      "tsconfig.json": JSON.stringify({ compilerOptions: { paths: { "@app/*": ["./src/*"] } } }),
    });
    const { stdout, stderr, exitCode } = await run([bunExe(), "index.ts"], String(dir));
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "via paths\n", stderr: "", exitCode: 0 });
  });

  test.concurrent("package.json imports in a parent apply to the entry point", async () => {
    using dir = tempDir("markers-package-imports", {
      "package.json": JSON.stringify({ name: "p", imports: { "#dep": "./src/dep.js" } }),
      "src/dep.js": `export const v = "hash import";`,
      "src/index.js": `import { v } from "#dep"; console.log(v);`,
    });
    const { stdout, stderr, exitCode } = await run([bunExe(), "src/index.js"], String(dir));
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "hash import\n", stderr: "", exitCode: 0 });
  });

  test.concurrent("tsconfig jsx settings in a parent apply to the entry point", async () => {
    using dir = tempDir("markers-tsconfig-jsx", {
      "tsconfig.json": JSON.stringify({ compilerOptions: { jsx: "react", jsxFactory: "h" } }),
      "src/app.jsx": `globalThis.h = (tag) => "h:" + tag;\nconsole.log(<div />);`,
    });
    const { stdout, stderr, exitCode } = await run([bunExe(), "src/app.jsx"], String(dir));
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "h:div\n", stderr: "", exitCode: 0 });
  });

  test.concurrent("the default .env files of the cwd load", async () => {
    using dir = tempDir("markers-dotenv", {
      ".env": "FROM_ENV=1\n",
      ".env.local": "FROM_LOCAL=2\n",
      ".env.production": "FROM_PROD=3\n",
    });
    const { stdout, stderr, exitCode } = await run(
      [bunExe(), "-e", "console.log(process.env.FROM_ENV, process.env.FROM_LOCAL, process.env.FROM_PROD)"],
      String(dir),
    );
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "1 2 undefined\n", stderr: "", exitCode: 0 });
  });
});

describe("entry point resolved by stat", () => {
  test.concurrent("a symlinked entry file runs as its real path", async () => {
    using dir = tempDir("entry-symlink-file", {
      "real/script.js": `console.log(import.meta.path);`,
    });
    symlinkSync(join(dir, "real/script.js"), join(dir, "link.js"));
    const { stdout, stderr, exitCode } = await run([bunExe(), join(dir, "link.js")], String(dir));
    expect({ stdout, stderr, exitCode }).toEqual({
      stdout: join(dir, "real/script.js") + "\n",
      stderr: "",
      exitCode: 0,
    });
  });

  test.concurrent("an entry file in a symlinked directory runs as its real path", async () => {
    using dir = tempDir("entry-symlink-dir", {
      "real/script.js": `console.log(import.meta.path);`,
    });
    symlinkSync(join(dir, "real"), join(dir, "link"), "dir");
    const { stdout, stderr, exitCode } = await run([bunExe(), join(dir, "link/script.js")], String(dir));
    expect({ stdout, stderr, exitCode }).toEqual({
      stdout: join(dir, "real/script.js") + "\n",
      stderr: "",
      exitCode: 0,
    });
  });

  test.concurrent("the entry point can import its own directory", async () => {
    using dir = tempDir("entry-own-dir", {
      "app/main.js": `const m = await import("./"); console.log(m.v);`,
      "app/index.js": `export const v = "index";`,
    });
    const { stdout, stderr, exitCode } = await run([bunExe(), join(dir, "app/main.js")], String(dir));
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "index\n", stderr: "", exitCode: 0 });
  });

  // Root bypasses permission checks. On Linux we drop to `nobody` with runuser.
  const nobody = (() => {
    if (isWindows) return null;
    try {
      const line = readFileSync("/etc/passwd", "utf8")
        .split("\n")
        .find(l => l.startsWith("nobody:"));
      return line ? line.split(":")[2] : null;
    } catch {
      return null;
    }
  })();
  const canUseRunuser = isLinux && isRoot && !!Bun.which("runuser") && nobody !== null;
  const canTriggerEACCES = !isWindows && (!isRoot || canUseRunuser);

  test.skipIf(!canTriggerEACCES)("an entry file in a directory that cannot be listed runs", async () => {
    using dir = tempDir("entry-unlistable-dir", {
      "locked/script.js": `console.log("RAN", import.meta.path);`,
      "work/.keep": "",
    });
    const root = String(dir);
    const script = join(root, "locked/script.js");
    let cmd = [bunExe(), script];
    if (canUseRunuser) {
      for (const p of [root, join(root, "locked"), script, join(root, "work")]) chmodSync(p, 0o777);
      cmd = ["runuser", "-u", "nobody", "--", ...cmd];
    }
    // Searchable, not listable: `stat` of a file inside works, `readdir` fails.
    // As the owner, the owner's read bit has to go too.
    chmodSync(join(root, "locked"), canUseRunuser ? 0o711 : 0o111);
    try {
      const { stdout, stderr, exitCode } = await run(cmd, join(root, "work"), { HOME: join(root, "work") });
      expect({ stdout, stderr, exitCode }).toEqual({ stdout: `RAN ${script}\n`, stderr: "", exitCode: 0 });
    } finally {
      chmodSync(join(root, "locked"), 0o755);
    }
  });
});
