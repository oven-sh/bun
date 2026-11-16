import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug, isLinux, isMacOS, isMusl, isWindows, libcPathForDlopen, tempDir } from "harness";
import { chmodSync, existsSync, readdirSync, readFileSync, readlinkSync, statSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { crc32, deflateSync } from "node:zlib";
import { isHardened } from "../aot/hardened";
import { unsupported as aotIsUnsupported } from "../aot/harness/commands";
import { canTrim } from "./compile-trim-features";
import { hasLibrary } from "../js/bun/desktop/library";
import { machoTemplate, minimalPE64Template } from "./executable-templates";

/** The left half is opaque red. The right half is transparent green, which must not show in a smaller copy. */
function png(width: number, height = width) {
  const row = Buffer.alloc(1 + width * 4);
  for (let x = 0; x < width; x++) row.set(x < width / 2 ? [255, 0, 0, 255] : [0, 255, 0, 0], 1 + x * 4);
  const chunk = (type: string, data: Buffer) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, "latin1");
    data.copy(out, 8);
    out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6], 8);
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.concat(Array.from({ length: height }, () => row)))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const pngSize = (bytes: Buffer) => [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];

function project(packageJson: object | undefined, files: Record<string, string | Buffer> = {}) {
  return tempDir("compile-desktop", {
    "app.ts": `console.log("started");`,
    "library": "the UI library",
    "darwin-template": machoTemplate(),
    "windows-template": minimalPE64Template(),
    ...(packageJson && { "package.json": JSON.stringify(packageJson) }),
    ...files,
  });
}

async function run(cmd: string[], cwd: string, env: Record<string, string | undefined> = {}) {
  await using proc = Bun.spawn({ cmd, cwd, env: { ...bunEnv, ...env }, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

const bun = (dir: { toString(): string }, ...args: string[]) =>
  run([bunExe(), ...args], String(dir), { BUN_DESKTOP_LIBRARY: join(String(dir), "library") });

const forMac = ["--target=bun-darwin-arm64", "--compile-executable-path=darwin-template"];
const forWindows = ["--target=bun-windows-x64", "--compile-executable-path=windows-template"];

function filesIn(directory: string) {
  return (readdirSync(directory, { recursive: true }) as string[])
    .filter(name => statSync(join(directory, name)).isFile() && !name.includes("_CodeSignature"))
    .map(name => name.replaceAll("\\", "/"))
    .sort();
}

const everything = {
  name: "@acme/notes",
  version: "1.2.3-beta.1",
  description: "Back\\slash <notes>",
  desktop: {
    name: `Tom & Jerry's <Notes>`,
    identifier: "com.example.notes",
    icon: "art/icon.png",
    category: "developer-tools",
    copyright: "© A & B",
    urlSchemes: ["notes", "web+notes"],
    fileAssociations: [
      { extensions: [".md", "markdown"], name: "Markdown", mimeType: "text/markdown", role: "Viewer" },
      { extensions: "note", name: "A <note>" },
    ],
    resources: ["templates", { from: "bin/helper", to: "tools/helper" }],
    infoPlist: {
      LSMinimumSystemVersion: "14.0",
      NSSupportsAutomaticGraphicsSwitching: null,
      LSUIElement: false,
      "A<B": { list: [1, 1.5, "</string>"] },
    },
  },
};
const filesOfEverything = {
  "art/icon.png": png(128),
  "templates/a.txt": "a",
  "templates/deep/b.txt": "b",
  "bin/helper": "#!/bin/sh\n",
};

describe.concurrent("--desktop", () => {
  test("macOS: .app", async () => {
    using dir = project(everything, filesOfEverything);
    chmodSync(join(String(dir), "bin/helper"), 0o755);
    const { stdout, stderr, exitCode } = await bun(dir, "build", "--compile", "--desktop", ...forMac, "app.ts");
    expect(stderr).not.toContain("error:");
    if (!isMacOS) expect(stderr).toContain("The .app is not signed as a whole");
    expect(stdout).toContain(`compile  Tom & Jerry's -Notes-.app bun-darwin`);

    const contents = join(String(dir), `Tom & Jerry's -Notes-.app`, "Contents");
    expect(filesIn(contents)).toEqual([
      "Frameworks/libbun_desktop.dylib",
      "Info.plist",
      "MacOS/Tom & Jerry's -Notes-",
      "PkgInfo",
      "Resources/desktop.json",
      "Resources/icon.icns",
      "Resources/templates/a.txt",
      "Resources/templates/deep/b.txt",
      "Resources/tools/helper",
    ]);
    expect(readFileSync(join(contents, "Info.plist"), "utf8")).toMatchInlineSnapshot(`
      "<?xml version="1.0" encoding="UTF-8"?>
      <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
      <plist version="1.0">
      <dict>
      	<key>CFBundleDevelopmentRegion</key>
      	<string>en</string>
      	<key>CFBundleDisplayName</key>
      	<string>Tom &amp; Jerry&apos;s &lt;Notes&gt;</string>
      	<key>CFBundleExecutable</key>
      	<string>Tom &amp; Jerry&apos;s -Notes-</string>
      	<key>CFBundleIdentifier</key>
      	<string>com.example.notes</string>
      	<key>CFBundleInfoDictionaryVersion</key>
      	<string>6.0</string>
      	<key>CFBundleName</key>
      	<string>Tom &amp; Jerry&apos;s &lt;Notes&gt;</string>
      	<key>CFBundlePackageType</key>
      	<string>APPL</string>
      	<key>CFBundleShortVersionString</key>
      	<string>1.2.3</string>
      	<key>CFBundleVersion</key>
      	<string>1.2.3</string>
      	<key>NSHighResolutionCapable</key>
      	<true/>
      	<key>CFBundleIconFile</key>
      	<string>icon.icns</string>
      	<key>LSApplicationCategoryType</key>
      	<string>public.app-category.developer-tools</string>
      	<key>NSHumanReadableCopyright</key>
      	<string>© A &amp; B</string>
      	<key>CFBundleURLTypes</key>
      	<array>
      		<dict>
      			<key>CFBundleURLName</key>
      			<string>com.example.notes</string>
      			<key>CFBundleURLSchemes</key>
      			<array>
      				<string>notes</string>
      				<string>web+notes</string>
      			</array>
      		</dict>
      	</array>
      	<key>CFBundleDocumentTypes</key>
      	<array>
      		<dict>
      			<key>CFBundleTypeExtensions</key>
      			<array>
      				<string>md</string>
      				<string>markdown</string>
      			</array>
      			<key>CFBundleTypeName</key>
      			<string>Markdown</string>
      			<key>CFBundleTypeRole</key>
      			<string>Viewer</string>
      		</dict>
      		<dict>
      			<key>CFBundleTypeExtensions</key>
      			<array>
      				<string>note</string>
      			</array>
      			<key>CFBundleTypeName</key>
      			<string>A &lt;note&gt;</string>
      			<key>CFBundleTypeRole</key>
      			<string>Editor</string>
      		</dict>
      	</array>
      	<key>LSMinimumSystemVersion</key>
      	<string>14.0</string>
      	<key>LSUIElement</key>
      	<false/>
      	<key>A&lt;B</key>
      	<dict>
      		<key>list</key>
      		<array>
      			<integer>1</integer>
      			<real>1.5</real>
      			<string>&lt;/string&gt;</string>
      		</array>
      	</dict>
      </dict>
      </plist>
      "
    `);
    expect(readFileSync(join(contents, "PkgInfo"), "utf8")).toBe("APPL????");
    expect(readFileSync(join(contents, "Frameworks/libbun_desktop.dylib"), "utf8")).toBe("the UI library");
    expect(await Bun.file(join(contents, "Resources/desktop.json")).json()).toEqual({
      name: `Tom & Jerry's <Notes>`,
      version: "1.2.3-beta.1",
      identifier: "com.example.notes",
    });
    if (!isWindows) {
      expect(statSync(join(contents, "Resources/tools/helper")).mode & 0o100).toBe(0o100);
      expect(statSync(join(contents, "Resources/templates/a.txt")).mode & 0o100).toBe(0);
    }

    const icns = readFileSync(join(contents, "Resources/icon.icns"));
    expect([icns.latin1Slice(0, 4), icns.readUInt32BE(4)]).toEqual(["icns", icns.length]);
    const entries: Record<string, number[]> = {};
    for (let at = 8; at < icns.length; at += icns.readUInt32BE(at + 4)) {
      entries[icns.latin1Slice(at, at + 4)] = pngSize(icns.subarray(at + 8));
    }
    expect(entries).toEqual({ icp4: [16, 16], icp5: [32, 32], ic11: [32, 32], ic12: [64, 64], ic07: [128, 128] });
    expect(exitCode).toBe(0);
  });

  test("Windows: folder", async () => {
    using dir = project({ name: "notes", productName: "My Notes" }, { "icon.png": png(300) });
    const args = ["--desktop", "--desktop-icon=icon.png", ...forWindows, "app.ts", "--outfile=dist/out.exe"];
    const { stdout, stderr, exitCode } = await bun(dir, "build", "--compile", ...args);
    // The stand-in has no resources that Windows could edit.
    if (!isWindows) {
      expect(stderr).toBe("");
      expect(stdout).toContain("compile  dist/out bun-windows");
      expect(exitCode).toBe(0);
    }

    const root = join(String(dir), "dist", "out");
    expect(filesIn(root)).toEqual(["My Notes.exe", "bun_desktop.dll", "resources/desktop.json", "resources/icon.ico"]);
    const exe = readFileSync(join(root, "My Notes.exe"));
    const IMAGE_SUBSYSTEM_WINDOWS_GUI = 2;
    expect(exe.readUInt16LE(exe.readUInt32LE(0x3c) + 24 + 68)).toBe(IMAGE_SUBSYSTEM_WINDOWS_GUI);
    expect(await Bun.file(join(root, "resources/desktop.json")).json()).toEqual({
      name: "My Notes",
      version: "0.0.0",
      identifier: "sh.bun.app.my-notes",
    });

    const ico = readFileSync(join(root, "resources/icon.ico"));
    const images = Array.from({ length: ico.readUInt16LE(4) }, (_, index) => {
      const entry = 6 + index * 16;
      return [ico[entry], ...pngSize(ico.subarray(ico.readUInt32LE(entry + 12)))];
    });
    expect(images).toEqual([16, 24, 32, 48, 64, 128, 256].map(size => [size % 256, size, size]));
  });

  test.skipIf(!isLinux || isMusl)("Linux: AppDir", async () => {
    using dir = project(
      { ...everything, desktop: { ...everything.desktop, icon: ["art/icon.icns", "art/icon.svg", "art/icon.png"] } },
      {
        ...filesOfEverything,
        "art/icon.png": png(50),
        "art/icon.svg": "<svg/>",
        "app.ts": `
          import { app } from "bun:desktop";
          console.log(JSON.stringify([app.name, app.getVersion(), app.identifier, app.getAppPath(), process.argv.slice(2)]));
        `,
      },
    );
    const { stdout, stderr, exitCode } = await bun(dir, "build", "--compile", "--desktop", "app.ts");
    expect(stderr).toBe("");
    expect(stdout).toContain("compile  tom-jerry-s-notes.AppDir\n");
    expect(exitCode).toBe(0);

    const root = join(String(dir), "tom-jerry-s-notes.AppDir");
    expect(filesIn(root)).toEqual([
      ".DirIcon",
      "AppRun",
      "com.example.notes.desktop",
      "com.example.notes.png",
      "usr/bin/tom-jerry-s-notes",
      "usr/lib/tom-jerry-s-notes/libbun_desktop.so",
      "usr/share/applications/com.example.notes.desktop",
      "usr/share/icons/hicolor/16x16/apps/com.example.notes.png",
      "usr/share/icons/hicolor/24x24/apps/com.example.notes.png",
      "usr/share/icons/hicolor/32x32/apps/com.example.notes.png",
      "usr/share/icons/hicolor/48x48/apps/com.example.notes.png",
      "usr/share/icons/hicolor/scalable/apps/com.example.notes.svg",
      "usr/share/mime/packages/com.example.notes.xml",
      "usr/share/tom-jerry-s-notes/desktop.json",
      "usr/share/tom-jerry-s-notes/templates/a.txt",
      "usr/share/tom-jerry-s-notes/templates/deep/b.txt",
      "usr/share/tom-jerry-s-notes/tools/helper",
    ]);
    expect(readFileSync(join(root, "com.example.notes.desktop"), "utf8")).toMatchInlineSnapshot(`
      "[Desktop Entry]
      Type=Application
      Name=Tom & Jerry's <Notes>
      Comment=Back\\\\slash <notes>
      Exec=tom-jerry-s-notes %U
      Icon=com.example.notes
      Terminal=false
      Categories=Development;
      StartupWMClass=com.example.notes
      MimeType=text/markdown;application/x-com.example.notes.note;x-scheme-handler/notes;x-scheme-handler/web+notes;
      X-AppImage-Version=1.2.3-beta.1
      "
    `);
    expect(readFileSync(join(root, "usr/share/mime/packages/com.example.notes.xml"), "utf8")).toMatchInlineSnapshot(`
      "<?xml version="1.0" encoding="UTF-8"?>
      <mime-info xmlns="http://www.freedesktop.org/standards/shared-mime-info">
      	<mime-type type="application/x-com.example.notes.note">
      		<comment>A &lt;note&gt;</comment>
      		<glob pattern="*.note"/>
      	</mime-type>
      </mime-info>
      "
    `);

    expect(readlinkSync(join(root, "AppRun"))).toBe("usr/bin/tom-jerry-s-notes");
    symlinkSync(join(root, "AppRun"), join(String(dir), "templates", "link"));
    const started = await run([join(String(dir), "templates", "link"), "a b", "notes://x"], "/");
    expect(JSON.parse(started.stdout)).toEqual([
      `Tom & Jerry's <Notes>`,
      "1.2.3-beta.1",
      "com.example.notes",
      join(root, "usr/share/tom-jerry-s-notes"),
      ["a b", "notes://x"],
    ]);
    expect(started.exitCode).toBe(0);
  });

  // With a debug build of WTF, the compiler's threads race in the iterator checks of HashTable on a program of this size.
  describe.skipIf(!!aotIsUnsupported || isMusl || isDebug)("bun compile", () => {
    const [extension, executable] = isMacOS
      ? [".app", "Contents/MacOS/Memo"]
      : isWindows
        ? ["", "Memo.exe"]
        : [".AppDir", "AppRun"];
    const memo = () =>
      project(
        { name: "notes", version: "2.0.0", module: "app.ts", desktop: { name: "Memo" } },
        { "app.ts": `import { app } from "bun:desktop";\nconsole.log(app.name, app.getVersion(), app.isPackaged);` },
      );
    const started = { stdout: "Memo 2.0.0 true\n", exitCode: 0 };

    test("names the bundle after the app", async () => {
      using dir = memo();
      const { stdout, exitCode } = await bun(dir, "compile", "--desktop");
      const bundle = (isLinux ? "memo" : "Memo") + extension;
      expect(stdout).toContain(`compile  ${bundle} `);
      expect(exitCode).toBe(0);
      expect(await run([join(String(dir), bundle, executable)], String(dir))).toMatchObject(started);
    });

    test.skipIf(!canTrim)("--trim keeps bun:desktop", async () => {
      using dir = memo();
      expect(await bun(dir, "compile", "--desktop", "--trim", "--outfile=out")).toMatchObject({ exitCode: 0 });
      expect(await run([join(String(dir), "out" + extension, executable)], String(dir))).toMatchObject(started);
    });

    test("--aot-record-order and --aot-order", async () => {
      using dir = memo();
      const recording = await bun(dir, "compile", "--desktop", "--aot-record-order", "--outfile=recording");
      expect(recording).toMatchObject({ exitCode: 0 });
      const env = { BUN_AOT_ORDER_OUT: join(String(dir), "memo.order") };
      expect(await run([join(String(dir), "recording" + extension, executable)], String(dir), env)).toMatchObject(
        started,
      );
      const ordered = await bun(dir, "compile", "--desktop", "--aot-order=memo.order", "--outfile=ordered");
      expect(ordered).toMatchObject({ exitCode: 0 });
      expect(await run([join(String(dir), "ordered" + extension, executable)], String(dir))).toMatchObject(started);
    });

    test("the loader does not go through graphs that are all in the executable", async () => {
      using dir = project(
        { name: "notes", module: "app.cjs", desktop: { name: "Memo" } },
        {
          "app.cjs": `const { log } = require("./main.mjs");
Promise.all([import("./a.mjs"), import("./b.mjs"), import("./waits.mjs")]).then(([a, b, waits]) => {
  console.log(log.join(), a.default, b.default, waits.default);
});`,
          "main.mjs": `import { log } from "./log.mjs";
import file from "./file.cjs";
log.push("main:" + file.name);
export { log };`,
          "file.cjs": `const { log } = require("./log.mjs");\nlog.push("file");\nexports.name = "f";`,
          "log.mjs": `export const log = ["log"];`,
          "shared.mjs": `import { log } from "./log.mjs";\nlog.push("shared");\nexport default 1;`,
          "a.mjs": `import one from "./shared.mjs";\nexport default one + 1;`,
          "b.mjs": `import one from "./shared.mjs";\nimport two from "./a.mjs";\nexport default one + two;`,
          "waits.mjs": `import three from "./b.mjs";\nexport default await Promise.resolve(three + 1);`,
        },
      );
      expect(await bun(dir, "compile", "--desktop", "--outfile=out")).toMatchObject({ exitCode: 0 });
      const env = { BUN_JSC_aotCountsPath: join(String(dir), "report") };
      const { stdout, exitCode } = await run([join(String(dir), "out" + extension, executable)], String(dir), env);
      expect(stdout).toBe("log,file,main:f,shared 2 3 4\n");
      expect(readFileSync(join(String(dir), "report"), "utf8")).toMatch(/^0\tcounter:CompiledModulesWalkedByLoader$/m);
      expect(exitCode).toBe(0);
    });

    test.skipIf(!hasLibrary)("--aot-assume", async () => {
      using dir = project(
        { name: "notes" },
        {
          "app.js": `const { app, BrowserWindow, protocol } = require("bun:desktop/electron");
protocol.registerSchemesAsPrivileged([{ scheme: "app", privileges: { standard: true, secure: true } }]);
app.trustOrigins(["app://bundle"]);
const source = url => url.endsWith("/rare.js") ? "import { Box } from '/box.js'; export default new (class extends Box { size() { return super.size() + 1; } })(2).size();" : undefined;
app.setCompiledScripts({ "app://bundle/": "/$bunfs/root/web/" }, { exclusive: true, source });
app.whenReady().then(() => {
  protocol.handle("app", () => new Response("<script type=module src=/page.js></script>", { headers: { "content-type": "text/html" } }));
  const { webContents } = new BrowserWindow();
  webContents.on("console-message", event => (console.log(event.message), process.exit(0)));
  webContents.loadURL("app://bundle/");
});`,
          "web/box.js": `export class Box { constructor(side) { this.side = side; } size() { return this.side * 2; } }`,
          "web/page.js": `import { Box } from "./box.js";
const sizeOf = box => box.size();
const call = (text, name) => text[name]() + text.trimEnd().length;
let replaced = "replaced";
try { String.prototype[self.name || "trimEnd"] = () => ""; } catch (error) { replaced = error.name; }
import(self.origin + "/rare.js").then(rare => console.log([sizeOf(new Box(1)), sizeOf({ size: () => 7 }), call("a ", "trim"), replaced, rare.default].join()));`,
        },
      );
      const outputs = [];
      for (const flags of [[], ["--aot-assume=separate-realms,locked-builtins"]]) {
        const files = ["app.js", "web/page.js", "web/box.js"];
        const built = await run([bunExe(), "compile", "--desktop", ...flags, ...files, "--outfile=out"], String(dir));
        expect(built).toMatchObject({ exitCode: 0 });
        const cmd = [join(String(dir), "out" + extension, executable)];
        outputs.push((await run(cmd, String(dir), { BUN_DESKTOP_HEADLESS: "1" })).stdout);
      }
      expect(outputs).toEqual(["2,7,a0,replaced,5\n", "2,7,a1,TypeError,5\n"]);
      const { stderr } = await bun(dir, "compile", "--aot-assume=anything", "app.js");
      expect(stderr).toContain("--aot-assume");
    });

    test("finds a missing library before it compiles", async () => {
      using dir = project({ name: "notes" }, { "app.ts": "syntax error" });
      const cmd = [bunExe(), "compile", "--desktop", "app.ts"];
      const { stderr, exitCode } = await run(cmd, String(dir), { BUN_DESKTOP_LIBRARY: "missing" });
      expect(stderr.trim()).toBe("error: BUN_DESKTOP_LIBRARY names a file that does not exist: missing");
      expect(exitCode).toBe(1);
    });
  });

  test.skipIf(!!aotIsUnsupported || !isLinux || isMusl)("Bun.build with aot", async () => {
    using dir = project(
      { name: "notes" },
      { "build.ts": `await Bun.build({ entrypoints: ["app.ts"], compile: { aot: true, desktop: true } });` },
    );
    expect(await bun(dir, "build.ts")).toMatchObject({ stderr: "", exitCode: 0 });
    expect(await run([join(String(dir), "notes.AppDir/AppRun")], "/")).toMatchObject({
      stdout: "started\n",
      exitCode: 0,
    });
  });

  test.skipIf(!!aotIsUnsupported || !isLinux || isMusl || isHardened)(
    "an app compiled ahead of time lets a graphics driver run the code it writes",
    async () => {
      using dir = project(
        { name: "notes" },
        {
          "app.ts": `
            import { dlopen } from "bun:ffi";
            const { prctl } = dlopen(${JSON.stringify(isLinux ? libcPathForDlopen() : "")}, {
              prctl: { args: ["i32", "u64", "u64", "u64", "u64"], returns: "i32" },
            }).symbols;
            const PR_GET_MDWE = 66;
            console.log(prctl(PR_GET_MDWE, 0, 0, 0, 0) > 0 ? "refused" : "allowed");
          `,
        },
      );
      expect(await bun(dir, "compile", "--desktop", "app.ts")).toMatchObject({ exitCode: 0 });
      expect(await run([join(String(dir), "notes.AppDir/AppRun")], "/")).toMatchObject({
        stdout: "allowed\n",
        exitCode: 0,
      });
    },
  );

  test("Bun.build", async () => {
    using dir = project(
      { name: "notes", version: "3.0.0", desktop: { identifier: "com.example.notes", icon: "missing.png" } },
      {
        "icon.icns": "as it is",
        "build.ts": `
          const { outputs } = await Bun.build({
            entrypoints: ["app.ts"],
            outdir: "dist",
            compile: {
              target: "bun-darwin-arm64",
              executablePath: "darwin-template",
              desktop: { name: "Memo", icon: "icon.icns" },
            },
          });
          console.log(outputs.map(output => output.path).join());
          for (const desktop of ["yes", [], { name: 1 }, { nmae: "x" }]) {
            try {
              await Bun.build({ entrypoints: ["app.ts"], compile: { target: "bun-darwin-arm64", desktop } });
            } catch (error) {
              console.log(error.message);
            }
          }
        `,
      },
    );
    const { stdout, stderr, exitCode } = await bun(dir, "build.ts");
    expect(stderr).not.toContain("error:");
    const contents = join(String(dir), "dist", "Memo.app", "Contents");
    expect(stdout.trim().split("\n")).toEqual([
      join(contents, "MacOS", "Memo"),
      "compile.desktop must be a boolean or an object",
      "compile.desktop must be a boolean or an object",
      `"name" of compile.desktop must be a string`,
      expect.stringContaining(`compile.desktop has the unknown key "nmae"`),
    ]);
    expect(readFileSync(join(contents, "Resources/icon.icns"), "utf8")).toBe("as it is");
    expect(await Bun.file(join(contents, "Resources/desktop.json")).json()).toEqual({
      name: "Memo",
      version: "3.0.0",
      identifier: "com.example.notes",
    });
    expect(exitCode).toBe(0);
  });

  test.each([
    ["flags", { name: "a", desktop: { name: "b" } }, ["--desktop-name=c", "--desktop-version=2"], "c.app", "c", "2"],
    ["the scope is dropped", { name: "@acme/notes", version: "1.0.0" }, [], "notes.app", "notes", "1.0.0"],
    ["the outfile only names the bundle", { name: "notes" }, ["--outfile=x/Other.app/"], "x/Other.app", "notes"],
    ["the outfile", {}, ["--outfile=x/Other"], "x/Other.app", "Other"],
    ["the entry point", {}, [], "app.app", "app"],
  ])("name: %s", async (_, packageJson, args, bundle, name, version = "0.0.0") => {
    using dir = project(packageJson);
    const { exitCode } = await bun(dir, "build", "--compile", "--desktop", ...forMac, ...args, "app.ts");
    const manifest = Bun.file(join(String(dir), bundle, "Contents/Resources/desktop.json"));
    expect(await manifest.json()).toMatchObject({ name, version });
    expect(existsSync(join(String(dir), bundle, "Contents/MacOS", name))).toBe(true);
    expect(exitCode).toBe(0);
  });

  test("a smaller icon does not take on the color of transparent pixels", async () => {
    using dir = project({ name: "notes", desktop: { icon: "icon.png" } }, { "icon.png": png(17) });
    await bun(dir, "build", "--compile", "--desktop", ...forWindows, "app.ts");
    const ico = readFileSync(join(String(dir), "notes/resources/icon.ico"));
    const image = ico.subarray(ico.readUInt32LE(6 + 12));
    const flattened = await new Bun.Image(image).png({ compressionLevel: 0, palette: true }).bytes();
    const palette = Buffer.from(flattened);
    const at = palette.indexOf("PLTE");
    const colors = new Set<string>();
    for (let i = 0; i < palette.readUInt32BE(at - 4); i += 3) colors.add(palette.hexSlice(at + 4 + i, at + 7 + i));
    expect([...colors].sort()).toEqual(["000000", "ff0000"]);
  });

  test("a second build replaces the files of the first and removes none", async () => {
    using dir = project({ name: "notes", desktop: { resources: [{ from: ".", to: "all" }] } });
    const args = ["build", "--compile", "--desktop", ...forMac, "app.ts"];
    expect(await bun(dir, ...args)).toMatchObject({ exitCode: 0 });
    const resources = join(String(dir), "notes.app/Contents/Resources");
    await Bun.write(join(resources, "kept"), "kept");
    await Bun.write(join(String(dir), "library"), "newer");
    expect(await bun(dir, ...args)).toMatchObject({ exitCode: 0 });
    expect(filesIn(resources)).toEqual([
      "all/app.ts",
      "all/darwin-template",
      "all/library",
      "all/package.json",
      "all/windows-template",
      "desktop.json",
      "kept",
    ]);
    expect(readFileSync(join(resources, "../Frameworks/libbun_desktop.dylib"), "utf8")).toBe("newer");
  });

  test("does not write into another directory", async () => {
    using dir = project({ name: "src" }, { "src/mine.ts": "" });
    const { stderr, exitCode } = await bun(dir, "build", "--compile", "--desktop", ...forWindows, "app.ts");
    expect(stderr).toContain(`"src" already exists and is not a bundle of this app`);
    expect(filesIn(join(String(dir), "src"))).toEqual(["mine.ts"]);
    expect(exitCode).toBe(1);
  });

  test.skipIf(isWindows)("follows links in resources, and stops at a cycle", async () => {
    using dir = project({ name: "notes", desktop: { resources: ["data"] } }, { "data/a": "a", "outside/b": "b" });
    symlinkSync("../outside", join(String(dir), "data/linked"));
    const args = ["build", "--compile", "--desktop", ...forMac, "app.ts"];
    expect(await bun(dir, ...args)).toMatchObject({ exitCode: 0 });
    expect(filesIn(join(String(dir), "notes.app/Contents/Resources/data"))).toEqual(["a", "linked/b"]);

    symlinkSync("../data", join(String(dir), "outside/back"));
    const { stderr, exitCode } = await bun(dir, ...args);
    expect(stderr).toContain("is a link to a directory above it");
    expect(exitCode).toBe(1);
  });

  test("downloads the library for the target", async () => {
    using dir = project({ name: "notes" });
    const archive = new Bun.Archive({ "package/bin/libbun_desktop.dylib": "downloaded" }, { compress: "gzip" });
    const tarball = await archive.bytes();
    let requests = 0;
    using server = Bun.serve({ port: 0, fetch: () => (requests++, new Response(tarball)) });
    const env = {
      BUN_DESKTOP_LIBRARY: undefined,
      BUN_DESKTOP_TARBALL_URL: server.url.href,
      BUN_INSTALL_CACHE_DIR: join(String(dir), "cache"),
    };
    for (const outfile of ["first", "second"]) {
      const cmd = [bunExe(), "build", "--compile", "--desktop", ...forMac, "app.ts", "--outfile", outfile];
      expect(await run(cmd, String(dir), env)).toMatchObject({ exitCode: 0 });
      const library = join(String(dir), `${outfile}.app/Contents/Frameworks/libbun_desktop.dylib`);
      expect(readFileSync(library, "utf8")).toBe("downloaded");
    }
    expect(requests).toBe(1);
  });

  test("the library is missing", async () => {
    using dir = project({ name: "notes" });
    const cmd = [bunExe(), "build", "--compile", "--desktop", ...forMac, "app.ts"];
    const { stderr, exitCode } = await run(cmd, String(dir), { BUN_DESKTOP_LIBRARY: "missing" });
    expect(stderr).toContain("BUN_DESKTOP_LIBRARY names a file that does not exist: missing");
    expect(existsSync(join(String(dir), "notes.app/Contents/MacOS/notes"))).toBe(false);
    expect(exitCode).toBe(1);
  });

  test.each([
    [["--desktop"], "--desktop requires --compile"],
    [["--compile", "--desktop-name=x"], "--desktop-name requires --desktop"],
    [["--compile", "--desktop", "--target=browser"], "cannot use --desktop with --target browser"],
    [["--compile", "--desktop", "--target=bun-linux-x64-musl"], "bun:desktop is not available for 'bun-linux-x64-musl"],
    [["--compile", "--desktop", ...forMac, "--outfile=.."], `".." does not name a bundle`],
    [["--compile", "--desktop", ...forWindows, "--desktop-name=nul"], `"nul" cannot be the name of an app`],
  ])("bun build %j", async (args, message) => {
    using dir = project({ name: "notes" });
    const { stderr, exitCode } = await bun(dir, "build", ...args, "app.ts");
    expect(stderr).toContain(message);
    expect(exitCode).toBe(1);
  });

  test.each([
    [{ name: "../escape" }, "cannot be the name of an app"],
    [{ name: "a\\b" }, "cannot be the name of an app"],
    [{ name: ".." }, "cannot be the name of an app"],
    [{ name: "" }, "cannot be the name of an app"],
    [{ name: "Bun" }, "cannot be the name of an app"],
    [{ name: "a\nExec=evil" }, "The name of the app has a control character"],
    [{ description: "a\nExec=evil" }, "The description has a control character"],
    [{ identifier: "../../x.y" }, "cannot be the identifier of an app"],
    [{ identifier: "notes" }, "cannot be the identifier of an app"],
    [{ identifier: "com..notes" }, "cannot be the identifier of an app"],
    [{ version: "one" }, "cannot be the version of an app"],
    [{ version: "1.0.0-a\nb" }, "cannot be the version of an app"],
    [{ category: "Utility" }, `"Utility" is not a category`],
    [{ urlSchemes: ["a;b"] }, `"a;b", which is not a URL scheme`],
    [{ fileAssociations: [{ extensions: [`a"b`] }] }, "has an invalid list of extensions"],
    [{ fileAssociations: [{ extensions: "a", mimeType: "a;b/c" }] }, "which is not a MIME type"],
    [{ resources: ["missing"] }, `"missing", which does not exist`],
    [{ resources: [{ from: "app.ts", to: "../MacOS/x" }] }, "cannot put a file at"],
    [{ resources: [{ from: "app.ts", to: "/tmp/x" }] }, "cannot put a file at"],
    [{ resources: [{ from: "app.ts", to: "Desktop.json" }] }, "would replace"],
    [{ icon: "missing.png" }, "Failed to read the icon"],
    [{ icon: "wide.png" }, "has 32x16 pixels. It must be square"],
    [{ icon: "text.png" }, "is not a PNG"],
    [{ icon: "icon.ico" }, "cannot be used for this target. Use a .png or a .icns file"],
    [{ infoPlist: { CFBundleExecutable: "x" } }, `"infoPlist" cannot set CFBundleExecutable`],
    [{ infoPlist: { a: "\u0001" } }, `"infoPlist" has a control character`],
    [{ icons: "x" }, `"desktop" in package.json has the unknown key "icons"`],
    ["yes", `"desktop" in package.json must be an object`],
  ])("desktop: %j", async (desktop, message) => {
    using dir = project({ name: "notes", desktop }, { "wide.png": png(32, 16), "text.png": "text" });
    const before = readdirSync(String(dir)).sort();
    const { stderr, exitCode } = await bun(dir, "build", "--compile", "--desktop", ...forMac, "app.ts");
    expect(stderr).toContain(message);
    expect(readdirSync(String(dir)).sort()).toEqual(before);
    expect(exitCode).toBe(1);
  });
});
