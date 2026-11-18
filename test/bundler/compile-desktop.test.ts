import { describe, expect, test } from "bun:test";
import {
  bunEnv,
  bunExe,
  isASAN,
  isDebug,
  isLinux,
  isMacOS,
  isMusl,
  isWindows,
  libcPathForDlopen,
  tempDir,
  tls,
} from "harness";
import { chmodSync, existsSync, readdirSync, readFileSync, readlinkSync, rmSync, statSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { crc32, deflateSync } from "node:zlib";
import { isHardened } from "../aot/hardened";
import { unsupported as aotIsUnsupported } from "../aot/harness/commands";
import { hasLibrary } from "../js/bun/desktop/library";
import { canTrim } from "./compile-trim-features";
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

/** The arguments for pages in the process of the app, and in others. */
const places = isLinux ? [[], ["--enable-sandbox"]] : [[]];
const withSandbox = { BUN_DESKTOP_HEADLESS: "1", BUN_DESKTOP_PAGE_PROCESSES: "asked" };

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
    expect(stdout).toContain(`compile  Tom & Jerry's -Notes-.app`);

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

  test.each([
    [0x800, "out/notes.exe", ["build", "--compile", "--desktop", ...forWindows, "app.ts", "--outfile=out"]],
    [
      0x800,
      "out/notes.exe",
      [
        "-e",
        `await Bun.build({ entrypoints: ["app.ts"], compile: { desktop: true, target: "bun-windows-x64", executablePath: "windows-template", outfile: "out" } })`,
      ],
    ],
    [0, "out.exe", ["build", "--compile", ...forWindows, "app.ts", "--outfile=out"]],
  ])("Windows: DependentLoadFlags %d in %s", async (flags, file, args) => {
    const template = minimalPE64Template();
    template.writeUInt32LE(4096 + 64, 64 + 24 + 112 + 10 * 8);
    template.writeUInt32LE(0x140, 64 + 24 + 112 + 10 * 8 + 4);
    template.fill(0, 512 + 64, 512 + 64 + 0x140).writeUInt32LE(0x140, 512 + 64);
    using dir = project({ name: "notes" }, { "windows-template": template });
    await bun(dir, ...args);
    expect(readFileSync(join(String(dir), file)).readUInt32LE(512 + 64 + 76)).toBe(flags << 16);
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

    test("the event targets of Bun are instances of the EventTarget of the window", async () => {
      using dir = project(
        { name: "notes", module: "app.ts", desktop: { name: "Memo", dom: true } },
        {
          "app.ts": `
            console.log(new AbortController().signal instanceof EventTarget, new MessageEvent("a") instanceof Event);
            process.exit(0);
          `,
        },
      );
      expect(await bun(dir, "compile", "--desktop", "--outfile=out")).toMatchObject({ exitCode: 0 });
      expect(await run([join(String(dir), "out" + extension, executable)], String(dir))).toMatchObject({
        stdout: "true true\n",
        exitCode: 0,
      });
    });

    test.skipIf(!canTrim)("--trim keeps bun:desktop", async () => {
      using dir = memo();
      expect(await bun(dir, "compile", "--desktop", "--trim", "--outfile=out")).toMatchObject({ exitCode: 0 });
      expect(await run([join(String(dir), "out" + extension, executable)], String(dir))).toMatchObject(started);
    });

    test.skipIf(!isLinux || isHardened)("--aot-record-order and --aot-order", async () => {
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

    test("imports at once of graphs whose files queue jobs or throw", async () => {
      using dir = project(
        { name: "notes", module: "app.mjs", desktop: { name: "Memo" } },
        {
          "app.mjs": `globalThis.log = [];
const all = await Promise.allSettled([import("./a.mjs"), import("./b.mjs"), import("./c.mjs"), import("./a.mjs")]);
console.log(all.map(one => one.value?.default ?? one.reason.message).join(), log.toSorted().join());`,
          "a.mjs": `import a from "./a.cjs";\nexport default a;`,
          "b.mjs": `import b from "./b.cjs";\nexport default b;`,
          "c.mjs": `import c from "./c.cjs";\nexport default c;`,
          "a.cjs": `Promise.resolve().then(() => log.push("a"));\nmodule.exports = "A";`,
          "b.cjs": `Promise.resolve().then(() => log.push("b"));\nmodule.exports = "B" + require("./a.cjs");`,
          "c.cjs": `Promise.resolve().then(() => log.push("c"));\nif (log) throw new Error("C");\nmodule.exports = 0;`,
        },
      );
      expect(await bun(dir, "compile", "--desktop", "--outfile=out")).toMatchObject({ exitCode: 0 });
      const { stdout, exitCode } = await run([join(String(dir), "out" + extension, executable)], String(dir));
      expect(stdout).toBe("A,BA,C,A a,b,c\n");
      expect(exitCode).toBe(0);
    });

    test.skipIf(!hasLibrary)("BUN_DESKTOP_JSC_ brings back nothing that BUN_JSC_ does not", async () => {
      using dir = project(
        { name: "notes", desktop: { name: "Memo" } },
        { "app.js": `console.log(typeof ShadowRealm, typeof WebAssembly);` },
      );
      expect(await run([bunExe(), "compile", "--desktop", "app.js", "--outfile=out"], String(dir))).toMatchObject({
        exitCode: 0,
      });
      const env = { BUN_DESKTOP_JSC_useShadowRealm: "1", BUN_DESKTOP_JSC_useWasm: "0" };
      expect(await run([join(String(dir), "out" + extension, executable)], String(dir), env)).toMatchObject({
        stdout: "undefined undefined\n",
        exitCode: 0,
      });
    });

    test.skipIf(!hasLibrary)("--aot-assume", async () => {
      using dir = project(
        { name: "notes", desktop: { name: "Memo" } },
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
import(self.origin + "/rare.js").then(rare => console.log([sizeOf(new Box(1)), sizeOf({ size: () => 7 }), call("a ", "trim"), replaced, rare.default, navigator.locks].join()));`,
        },
      );
      const outputs = [];
      for (const flags of [[], ["--aot-assume=separate-realms,locked-builtins"]]) {
        const files = ["app.js", "web/page.js", "web/box.js"];
        const built = await run([bunExe(), "compile", "--desktop", ...flags, ...files, "--outfile=out"], String(dir));
        expect(built).toMatchObject({ exitCode: 0 });
        const cmd = [join(String(dir), "out" + extension, executable)];
        for (const args of places) outputs.push((await run([...cmd, ...args], String(dir), withSandbox)).stdout);
      }
      expect(outputs).toEqual([
        ...places.map(() => "2,7,a0,replaced,5,[object LockManager]\n"),
        ...places.map(() => "2,7,a1,TypeError,5,[object LockManager]\n"),
      ]);
      const { stderr } = await bun(dir, "compile", "--aot-assume=anything", "app.js");
      expect(stderr).toContain("separate-realms, locked-builtins, complete-order");
    });

    test.skipIf(!hasLibrary)("a page cannot import the modules of Node.js or the rest of the program", async () => {
      const tries = `Promise.allSettled(names.map(it => import(it))).then(all => all.map(it => it.status).join())`;
      using dir = project(
        { name: "notes", desktop: { name: "Memo" } },
        {
          "app.js": `const { app, BrowserWindow, protocol } = require("bun:desktop/electron");
protocol.registerSchemesAsPrivileged([{ scheme: "app", privileges: { standard: true, secure: true } }]);
app.trustOrigins(["app://bundle"]);
app.setCompiledScripts({ "app://bundle/": "/$bunfs/root/web/" });
const names = ["node:fs", "node:child_process", "bun:sqlite", "/..%2Fsecret.js", "/..%5Csecret.js", "/fixed.js", "/own.js"];
const files = {
  "/": "<script>names = " + JSON.stringify(names) + "</script><script src=/text.js></script><script type=module src=node:process></script><script type=module src=/page.js></script>",
  "/text.js": ${JSON.stringify(`fromText = ${tries};`)},
  "/fixed.js": "import 'node:fs';",
  "/worker.js": ${JSON.stringify(`onmessage = ({ data: names }) => ${tries}.then(postMessage);`)},
};
app.whenReady().then(() => {
  protocol.handle("app", ({ url }) => {
    const file = files[new URL(url).pathname];
    return new Response(file, { status: file ? 200 : 404, headers: { "content-type": url.endsWith(".js") ? "text/javascript" : "text/html" } });
  });
  const { webContents } = new BrowserWindow();
  webContents.on("console-message", ({ level, message }) => level === "info" && (console.log(message), process.exit(0)));
  webContents.loadURL("app://bundle/");
});`,
          "secret.js": `export { readFileSync } from "node:fs";`,
          "web/own.js": `export default 1;`,
          "web/page.js": `const worker = new Worker(self.origin + "/worker.js");
worker.postMessage(names);
const fromWorker = new Promise(done => (worker.onmessage = event => done(event.data)));
console.log([await ${tries}, await fromText, await fromWorker].join("\\n"));`,
        },
      );
      const files = ["app.js", "secret.js", "web/page.js", "web/own.js"];
      const built = await run([bunExe(), "compile", "--desktop", ...files, "--outfile=out"], String(dir));
      expect(built).toMatchObject({ exitCode: 0 });
      for (const args of places) {
        const cmd = [join(String(dir), "out" + extension, executable), ...args];
        expect((await run(cmd, String(dir), withSandbox)).stdout).toBe(
          ("rejected,".repeat(6) + "fulfilled\n").repeat(3),
        );
      }
    });

    test.skipIf(!hasLibrary)("a page without compiled scripts can change its built-in objects", async () => {
      using dir = project(
        { name: "notes", desktop: { name: "Memo", resources: [{ from: "app", to: "app" }] } },
        {
          "app.js": `const { app, BrowserWindow, protocol } = require("electron");
protocol.registerSchemesAsPrivileged([{ scheme: "app", privileges: { standard: true, secure: true, corsEnabled: true } }]);
app.trustOrigins(["app://bundle", "app://bundle.other", "about:"], { inFrames: true, injectedScripts: true });
app.setCompiledScripts({ "app://bundle/web/": "/$bunfs/root/web/" });
if (process.env.PRELOADS) app.setCompiledScripts({ "file:///preloads/": "/$bunfs/root/preloads/" });
const tries = require("fs").readFileSync(app.getAppPath() + "/tries.js", "utf8");
const inFrame = more => "<iframe " + more + " srcdoc='<script src=app://bundle/tries.js></script><script>parent.postMessage(result, \\"*\\")</script>'></iframe>";
const pages = {
  "/page": "<script src=/tries.js></script><script src=app://bundle/web/kind.js></script><script>console.log(result, kind)</script>",
  "/worker": "<script>new Worker('/worker.js').onmessage = event => console.log(event.data)</script>",
  "/frame": "<script>onmessage = event => console.log(event.data)</script>" + inFrame(""),
  "/sandboxed": "<script>onmessage = event => console.log(event.data)</script>" + inFrame("sandbox=allow-scripts"),
  "/bridge": "<script src=/tries.js></script><script>bridge.later(new Map([[1, [2]]]), it => it + 1).then(it => console.log(result, bridge.twice([1, 2]).join(), it))</script>",
  "/tries.js": tries,
  "/worker.js": tries + ";postMessage(result)",
  "/web/kind.js": "self.kind = 'text'",
};
app.whenReady().then(async () => {
  protocol.handle("app", ({ url }) => new Response(pages[new URL(url).pathname], { headers: { "content-type": url.endsWith(".js") ? "text/javascript" : "text/html" } }));
  for (const [url, webPreferences] of JSON.parse(process.env.LOADS)) {
    const { webContents } = new BrowserWindow({ webPreferences });
    const logged = new Promise(done => webContents.once("console-message", event => done(event.message)));
    url.includes(":") ? webContents.loadURL(url) : webContents.loadFile(url);
    console.log(url, await logged);
  }
  console.log([3].map(it => it + 1).join(), String(function named() {}).includes("named"));
  process.exit(0);
});`,
          "app/tries.js": `var result = [[Function.prototype, "toString"], [Array.prototype, "map"], [Date, "now"], [self, "Promise"], [Date.prototype, "constructor"]]
  .reduce((all, [holder, name]) => {
    const original = holder[name], replacement = function (...given) { return Reflect.apply(original, this, given); };
    try { holder[name] = replacement; } catch {}
    const isReplaced = holder[name] === replacement;
    if (name === "Promise") holder[name] = original;
    return all + +isReplaced;
  }, "");`,
          "app/index.html": `<script src=tries.js></script><script>const escape = 1; console.log(result, escape)</script>`,
          "web/kind.js": `self.kind = "compiled";`,
          "preloads/bridge.js": `export default function (require) {
  require("electron").contextBridge.exposeInMainWorld("bridge", {
    twice: list => list.map(it => it * 2),
    later: async (map, more) => more(map.get(1)[0]),
  });
}`,
        },
      );
      const files = ["app.js", "web/kind.js", "preloads/bridge.js"];
      const built = await run([bunExe(), "compile", "--desktop", ...files, "--outfile=out"], String(dir));
      expect(built).toMatchObject({ exitCode: 0 });
      const show = async (loads: unknown[][], PRELOADS = "") => {
        const env = { BUN_DESKTOP_HEADLESS: "1", LOADS: JSON.stringify(loads), PRELOADS };
        return (await run([join(String(dir), "out" + extension, executable)], String(dir), env)).stdout.split("\n");
      };
      const paths = ["page", "worker", "frame", "sandboxed"];
      const urls = ["bundle", "bundle.other"].flatMap(host => paths.map(path => [`app://${host}/${path}`]));
      expect(await show([...urls, ["index.html"]])).toEqual([
        "app://bundle/page 00000 compiled",
        "app://bundle/worker 00000",
        "app://bundle/frame 00000",
        "app://bundle/sandboxed 11111",
        "app://bundle.other/page 11111 text",
        "app://bundle.other/worker 11111",
        "app://bundle.other/frame 11111",
        "app://bundle.other/sandboxed 11111",
        "index.html 11111 1",
        "4 true",
        "",
      ]);
      const preload = "/preloads/bridge.js";
      const withPreload = [
        ["app://bundle.other/bridge", { preload }],
        ["app://bundle.other/page", { nodeIntegration: true, contextIsolation: false }],
      ];
      if (!isWindows) {
        expect(await show(withPreload, "1")).toEqual([
          "app://bundle.other/bridge 11111 2,4 3",
          "app://bundle.other/page 00000 text",
          "4 true",
          "",
        ]);
      }
    });

    test.skipIf(!hasLibrary)("what a page has read from window or a collection follows the document", async () => {
      using dir = project(
        { name: "notes", desktop: { name: "Memo" } },
        {
          "app.js": `const { app, BrowserWindow, protocol } = require("bun:desktop/electron");
protocol.registerSchemesAsPrivileged([{ scheme: "app", privileges: { standard: true, secure: true } }]);
app.trustOrigins(["app://bundle"]);
app.setCompiledScripts({ "app://bundle/": "/$bunfs/root/web/" });
app.whenReady().then(() => {
  protocol.handle("app", () => new Response("<body><script type=module src=/page.js></script>", { headers: { "content-type": "text/html" } }));
  const { webContents } = new BrowserWindow();
  webContents.on("console-message", event => (console.log(event.message), process.exit(0)));
  webContents.loadURL("app://bundle/");
});`,
          "web/page.js": `const seen = [];
const show = it => (it === undefined ? "-" : (it.localName ?? it.name ?? String(it)));
const often = (read, from) => { let it; for (let i = 0; i < 200; i++) it = read(from); return show(it); };
const named = it => it.thing, keyed = it => it[self.name || "thing"], tested = it => "thing" in it;
const free = () => (typeof thing === "undefined" ? undefined : thing), global = () => globalThis.thing;
const look = () => seen.push([named, keyed, tested, free, global].map(it => often(it, window)).join(" "));
const add = html => (document.body.insertAdjacentHTML("beforeend", html), document.body.lastChild);
const steps = [
  () => add("<p id=thing>"),
  () => Object.assign(add("<b>"), { id: "thing" }),
  () => add("<form name=thing>"),
  () => Object.assign(add("<img>"), { name: "thing" }),
  () => add("<iframe name=thing></iframe>"),
  () => { const frame = add("<iframe></iframe>"); look(); frame.contentWindow.name = "thing"; return frame; },
];
look();
for (const step of steps) {
  const element = step();
  look();
  element.remove();
  look();
}
const event = it => it.event?.type;
addEventListener("one", () => seen.push(often(event, window)));
seen.push(often(event, window));
dispatchEvent(new Event("one"));
const width = it => it.innerWidth > 0;
seen.push(often(width, window));
window.innerWidth = 0;
seen.push(often(width, window));
const { children } = add("<p><i id=item></i></p>"), item = it => it.item, length = it => it.length;
seen.push(often(item, children), often(length, children));
children[0].remove();
seen.push(often(length, children));
localStorage.setItem("key", "stored");
const key = it => it.key;
seen.push(often(key, localStorage));
delete Storage.prototype.key;
seen.push(often(key, localStorage));
console.log(seen.join("\\n"));`,
        },
      );
      const flags = ["--aot-assume=separate-realms", "--outfile=out"];
      const built = await run([bunExe(), "compile", "--desktop", ...flags, "app.js", "web/page.js"], String(dir));
      expect(built).toMatchObject({ exitCode: 0 });
      const cmd = [join(String(dir), "out" + extension, executable)];
      const env = { BUN_DESKTOP_HEADLESS: "1", HOME: String(dir), XDG_CONFIG_HOME: String(dir), APPDATA: String(dir) };
      const { stdout, exitCode } = await run(cmd, String(dir), env);
      const absent = "- - false - -";
      const present = (it: string) => `${it} ${it} true ${it} ${it}`;
      expect(stdout.trimEnd().split("\n")).toEqual([
        absent,
        ...["p", "b", "form", "img", "thing"].flatMap(it => [present(it), absent]),
        ...[absent, present("thing"), absent],
        ...["-", "one", "true", "false", "item", "1", "0", "key", "stored"],
      ]);
      expect(exitCode).toBe(0);
    });

    test.skipIf(!hasLibrary || isWindows)("a program that imports nothing else starts the web engine", async () => {
      using dir = project(
        { name: "notes", desktop: { name: "Memo" } },
        {
          "engine": `#!/bin/sh\necho started\nkill $PPID\n`,
          "app.js": `import { Window, app } from "bun:desktop";
app.setWebEngine({ type: "chromium", path: process.cwd() + "/engine" });
new Window().document.body.innerHTML = "<iframe srcdoc=a></iframe>";`,
        },
      );
      chmodSync(join(String(dir), "engine"), 0o755);
      const built = await run([bunExe(), "compile", "--desktop", "app.js", "--outfile=out"], String(dir));
      expect(built).toMatchObject({ exitCode: 0 });
      const env = { BUN_DESKTOP_HEADLESS: "1", ELECTRON_ENABLE_LOGGING: "1" };
      const { stdout } = await run([join(String(dir), "out" + extension, executable)], String(dir), env);
      expect(stdout).toBe("started\n");
    });

    test("desktop.dom starts the program in a window", async () => {
      using dir = project(
        { name: "notes", desktop: { name: "Memo", dom: true } },
        {
          "app.js": `const heard = [];
document.body.addEventListener("a", event => heard.push(event.target.localName));
for (const event of [new Event("a"), new CustomEvent("a"), new ErrorEvent("a")]) document.body.dispatchEvent(event);
addEventListener("b", event => heard.push(event.target === self));
dispatchEvent(new Event("b"));
console.log(heard.join(), document.body instanceof EventTarget, new FormData(document.createElement("form")).has("a"));
console.log(typeof Bun, typeof process, Buffer.from("a").length, globalThis instanceof Window);`,
        },
      );
      expect(await bun(dir, "compile", "--desktop", "app.js", "--outfile=out")).toMatchObject({ exitCode: 0 });
      const cmd = [join(String(dir), "out" + extension, executable)];
      expect(await run(cmd, String(dir), { BUN_DESKTOP_HEADLESS: "1" })).toMatchObject({
        stdout: "body,body,body,true true false\nobject object 1 true\n",
        exitCode: 0,
      });
    });

    test.skipIf(!hasLibrary)("a compiled page gets nothing of its preload script", async () => {
      using dir = project(
        { name: "notes", desktop: { name: "Memo" } },
        {
          "app.js": `const { app, BrowserWindow, protocol } = require("bun:desktop/electron");
protocol.registerSchemesAsPrivileged([{ scheme: "app", privileges: { standard: true, secure: true } }]);
app.trustOrigins(["app://bundle"]);
app.setCompiledScripts({ "app://bundle/": "/$bunfs/root/web/" }, { exclusive: true });
app.whenReady().then(() => {
  protocol.handle("app", () => new Response("<script type=module src=/page.js></script>", { headers: { "content-type": "text/html" } }));
  const { webContents } = new BrowserWindow({ webPreferences: { preload: process.cwd() + "/preload.js" } });
  webContents.on("console-message", event => (console.log(event.message), process.exit(0)));
  webContents.loadURL("app://bundle/");
});`,
          "preload.js": `const { port1, port2 } = new MessageChannel();
const api = { take() {}, call: it => fetch("data:,").then(() => ((port1.onmessage = () => it()), port2.postMessage(1))) };
require("electron").contextBridge.exposeInMainWorld("api", api);`,
          "web/page.js": `const got = [];
Object.defineProperty(Response.prototype, "then", { get: () => void got.push("response") });
api.take(Object.assign(Promise.resolve(), { then: () => got.push("function") }));
api.call(() => console.log([...got, typeof self.event].join()));`,
        },
      );
      const built = await run(
        [bunExe(), "compile", "--desktop", "app.js", "web/page.js", "--outfile=out"],
        String(dir),
      );
      expect(built).toMatchObject({ exitCode: 0 });
      const cmd = [join(String(dir), "out" + extension, executable)];
      expect(await run(cmd, String(dir), { BUN_DESKTOP_HEADLESS: "1" })).toMatchObject({
        stdout: "undefined\n",
        exitCode: 0,
      });
    });

    test.skipIf(!hasLibrary)("a compiled page does not find the globals of Bun", async () => {
      using dir = project(
        { name: "notes", desktop: { name: "Memo" } },
        {
          "app.js": `const { app, BrowserWindow, protocol } = require("bun:desktop/electron");
protocol.registerSchemesAsPrivileged([{ scheme: "app", privileges: { standard: true, secure: true } }]);
app.trustOrigins(["app://bundle"]);
app.setCompiledScripts({ "app://bundle/": "/$bunfs/root/web/" }, { exclusive: true });
app.whenReady().then(() => {
  protocol.handle("app", () => new Response("<script type=module src=/page.js></script>", { headers: { "content-type": "text/html" } }));
  const { webContents } = new BrowserWindow();
  webContents.on("console-message", event => (console.log(event.message, typeof process.pid, typeof Bun.version), process.exit(0)));
  webContents.loadURL("app://bundle/");
});`,
          "web/page.js": `const root = typeof window === "object" ? window : globalThis;
const found = [typeof process, typeof Bun, typeof Buffer, typeof setImmediate, typeof global, typeof SharedArrayBuffer, root.process, globalThis.Bun];
root.process = { env: { A: "a" } };
new Response(new Blob(["b"]).stream()).text().then(text => console.log([...found, process.env.A, text, new URL("app://bundle/x").origin, console.write].join()));`,
        },
      );
      const built = await run(
        [bunExe(), "compile", "--desktop", "app.js", "web/page.js", "--outfile=out"],
        String(dir),
      );
      expect(built).toMatchObject({ exitCode: 0 });
      const cmd = [join(String(dir), "out" + extension, executable)];
      expect(await run(cmd, String(dir), { BUN_DESKTOP_HEADLESS: "1" })).toMatchObject({
        stdout: "undefined,undefined,undefined,undefined,undefined,undefined,,,a,b,app://bundle, number string\n",
        exitCode: 0,
      });
    });

    test
      .skipIf(!hasLibrary)
      .each<[false | { remove?: string[] }]>([
        [false],
        ...(canTrim
          ? [{}, { remove: ["inspector"] }, { remove: ["interpreter"] }, { remove: ["inspector", "interpreter"] }].map(
              it => [it] as [object],
            )
          : []),
      ])("a compiled app ignores --inspect, pauses no page and keeps no log, with trim: %j", async trim => {
      using dir = project(
        { name: "notes", desktop: { name: "Memo" } },
        {
          "app.js": `const { app, BrowserWindow, protocol } = require("bun:desktop/electron");
protocol.registerSchemesAsPrivileged([{ scheme: "app", privileges: { standard: true, secure: true } }]);
app.trustOrigins(["app://bundle"]);
app.setCompiledScripts({ "app://bundle/": "/$bunfs/root/web/" });
app.whenReady().then(async () => {
  protocol.handle("app", () => new Response("<script src=/a.js></script>", { headers: { "content-type": "text/html" } }));
  const { webContents } = new BrowserWindow();
  await webContents.loadURL("app://bundle/");
  webContents.debugger.attach();
  const logged = new Promise(resolve => webContents.debugger.on("message", (_, method, params) => method === "Runtime.consoleAPICalled" && resolve(params.args)));
  const outcome = method => webContents.debugger.sendCommand(method).then(() => "done", error => error.message);
  for (const method of ["Debugger.enable", "HeapProfiler.takeHeapSnapshot", "DOM.getDocument", "CSS.enable", "Runtime.compileScript", "Runtime.enable"]) console.log(await outcome(method));
  webContents.sendInputEvent({ type: "keyDown", keyCode: "a" });
  console.log((await logged).map(it => it.subtype ?? it.type).join());
  app.setWebEngine(null);
  webContents.openDevTools();
  await new Promise(setImmediate);
  process.exit(0);
});`,
          "build.js": `const { success, logs } = await Bun.build({
  entrypoints: ["./app.js", "./web/a.js"],
  compile: { aot: true, outfile: "out", trim: ${JSON.stringify(trim)}, desktop: { name: "Memo" } },
});
if (!success) throw new AggregateError(logs);`,
          "web/a.js": `console.log("early");
addEventListener("keydown", () => console.log(() => {}, class {}, /a/, new Map([[1, 2]]), new Error("a"), new Date(0), Promise.resolve(), new Uint8Array(1), document.body));`,
        },
      );
      expect(await run([bunExe(), "build.js"], String(dir))).toMatchObject({ exitCode: 0 });
      const cmd = [join(String(dir), "out" + extension, executable), "--inspect-brk=0"];
      const { stdout, stderr, exitCode } = await run(cmd, String(dir), { BUN_DESKTOP_HEADLESS: "1" });
      const lacks = (feature: string) => !!trim && !!trim.remove?.includes(feature);
      const [noDebugger, noParser] = lacks("interpreter")
        ? Array(2).fill("This program does not run code from strings")
        : ["This program has no debugger", "done"];
      expect(stdout.trim().split("\n")).toEqual([
        ...[noDebugger, "The page shares its heap with the app", "done", "done", noParser, "done"],
        "function,function,regexp,map,error,date,promise,typedarray,node",
      ]);
      expect([stderr.includes("ws://"), stderr.includes("has no developer tools"), exitCode]).toEqual([
        false,
        lacks("inspector"),
        0,
      ]);
    });

    test.skipIf(!hasLibrary || !canTrim).each([
      ["--trim", "true 1", ""],
      ["--trim-without=Inspector", "false 1", "has no developer tools"],
      ["--trim-without=Serve", "false 1", "--remote-debugging-port has failed"],
      ["--trim-without=RegExp", "true 0", ""],
    ])("--remote-debugging-port in an app that is compiled with %s", async (trim, expected, warning) => {
      using dir = project(
        { name: "notes", desktop: { name: "Memo" } },
        {
          "app.js": `const { app, BrowserWindow, protocol } = require("bun:desktop/electron");
protocol.registerSchemesAsPrivileged([{ scheme: "app", privileges: { standard: true, secure: true } }]);
app.trustOrigins(["app://bundle"]);
app.setPath("userData", process.cwd());
app.commandLine.appendSwitch("remote-debugging-port", "0");
app.whenReady().then(async () => {
  protocol.handle("app", () => new Response("aa", { headers: { "content-type": "text/html" } }));
  const { webContents } = new BrowserWindow();
  await webContents.loadURL("app://bundle/");
  webContents.debugger.attach();
  const { result } = await webContents.debugger.sendCommand("Page.searchInResource", { url: "app://bundle/", query: "a+", isRegex: true });
  console.log(require("fs").existsSync("DevToolsActivePort"), result.length);
  await new Promise(setImmediate);
  process.exit(0);
});`,
        },
      );
      expect(
        await run([bunExe(), "compile", "--desktop", trim, "app.js", "--outfile", "out"], String(dir)),
      ).toMatchObject({ exitCode: 0 });
      const cmd = [join(String(dir), "out" + extension, executable), "--remote-debugging-port=0"];
      const { stdout, stderr, exitCode } = await run(cmd, String(dir), { BUN_DESKTOP_HEADLESS: "1" });
      expect([stdout, stderr.includes(warning), exitCode]).toEqual([expected + "\n", true, 0]);
    });

    test.skipIf(!hasLibrary || !canTrim || !process.env.BUN_DESKTOP_TEST_ELECTRON)(
      "Electron shows no developer tools for an app without the inspector",
      async () => {
        using dir = project(
          { name: "notes", desktop: { name: "Memo" } },
          {
            "app.js": `const { app, BrowserWindow } = require("bun:desktop/electron");
app.setPath("userData", process.cwd());
app.setWebEngine({ type: "electron", path: process.env.BUN_DESKTOP_TEST_ELECTRON, args: process.getuid?.() === 0 ? ["--no-sandbox"] : [] });
app.whenReady().then(async () => {
  const { webContents } = new BrowserWindow({ webPreferences: { webEngine: true } });
  await webContents.loadURL("data:text/html,");
  process.on("warning", warning => (console.log(warning.message), app.exit(0)));
  webContents.on("devtools-opened", () => app.exit(1));
  webContents.openDevTools();
});`,
          },
        );
        expect(
          await run(
            [bunExe(), "compile", "--desktop", "--trim-without=Inspector", "app.js", "--outfile=out"],
            String(dir),
          ),
        ).toMatchObject({ exitCode: 0 });
        const cmd = [join(String(dir), "out" + extension, executable)];
        expect(await run(cmd, String(dir), { BUN_DESKTOP_HEADLESS: "1" })).toMatchObject({
          stdout: expect.stringContaining("has no developer tools"),
          exitCode: 0,
        });
      },
    );

    test.skipIf(!hasLibrary)("compiled scripts are subject to the policy of the page", async () => {
      using dir = project(
        { name: "notes", desktop: { name: "Memo" } },
        {
          "app.js": `const { app, BrowserWindow, protocol } = require("bun:desktop/electron");
protocol.registerSchemesAsPrivileged([{ scheme: "app", privileges: { standard: true, secure: true } }]);
app.trustOrigins(["app://bundle"]);
app.setCompiledScripts({ "app://bundle/": "/$bunfs/root/web/" });
const page = \`<script src=/a.js></script><script type=module src=/a.js></script><script type=module nonce=n src=/b.js></script>
<script nonce=n>
const worker = new Promise(done => Object.assign(new Worker("/a.js"), { onerror: () => done("refused"), onmessage: () => done("ran") }));
onload = async () => console.log([self.a, self.b, await worker, await import("/a.js").then(() => self.a, error => error.name)].join());
</script>\`;
const policies = ["script-src 'nonce-n'", "script-src 'unsafe-inline' app://bundle/b.js", "script-src 'unsafe-inline' 'self'"];
app.whenReady().then(async () => {
  let policy;
  protocol.handle("app", () => new Response(policy.includes("nonce") ? page : page.replaceAll(" nonce=n", ""), { headers: { "content-type": "text/html", "content-security-policy": policy } }));
  const { webContents } = new BrowserWindow();
  for (policy of policies) {
    const logged = new Promise(done => webContents.on("console-message", event => event.level === "info" && done(event.message)));
    webContents.loadURL("app://bundle/");
    console.log(await logged);
  }
  process.exit(0);
});`,
          "web/a.js": `self.a = "a"; if (!self.document) postMessage("ran");`,
          "web/b.js": `self.b = "b";`,
        },
      );
      const files = ["app.js", "web/a.js", "web/b.js"];
      const built = await run([bunExe(), "compile", "--desktop", ...files, "--outfile=out"], String(dir));
      expect(built).toMatchObject({ exitCode: 0 });
      const cmd = [join(String(dir), "out" + extension, executable)];
      for (const args of places)
        expect(await run([...cmd, ...args], String(dir), withSandbox)).toMatchObject({
          stdout: ",b,refused,a\n,b,refused,TypeError\na,b,ran,a\n",
          exitCode: 0,
        });
    });

    test.skipIf(!hasLibrary || !isLinux).each([[[]], ...(canTrim ? [[["--trim"]]] : [])])(
      "compiled pages run in a sandbox, without the rest of the program (%j)",
      async flags => {
        using dir = project(
          { name: "notes", desktop: { name: "Memo" } },
          {
            "app.js": `const { app, BrowserWindow, ipcMain, protocol } = require("bun:desktop/electron");
console.log("main");
protocol.registerSchemesAsPrivileged([{ scheme: "app", privileges: { standard: true, secure: true } }]);
app.trustOrigins(["app://bundle"]);
app.setCompiledScripts({ "app://bundle/": "/$bunfs/root/web/", "file:///app/": "/$bunfs/root/web/" }, { exclusive: true });
app.whenReady().then(() => {
  protocol.handle("app", () => new Response("<script type=module src=/page.js></script>", { headers: { "content-type": "text/html" } }));
  ipcMain.handle("twice", (event, value) => value * 2);
  const { webContents } = new BrowserWindow({ webPreferences: { sandbox: true, preload: "/app/preload.js" } });
  webContents.on("console-message", event => {
    const read = name => require("fs").readFileSync("/proc/" + webContents.getOSProcessId() + "/" + name, "latin1");
    console.log(event.message, /Seccomp:\\s2/.test(read("status")), /rwx/.test(read("maps")));
    webContents.send("crash");
  });
  webContents.on("render-process-gone", (event, { reason }) => (console.log(reason), process.exit(0)));
  webContents.loadURL("app://bundle/");
});`,
            "web/preload.js": `export default function (require, process) {
  const { contextBridge, ipcRenderer } = require("electron");
  contextBridge.exposeInMainWorld("twice", it => ipcRenderer.invoke("twice", it));
  ipcRenderer.on("crash", () => process.crash());
}`,
            "web/worker.js": `postMessage("worker");`,
            "web/page.js": `new Worker("/worker.js").onmessage = async ({ data }) => console.log(data, await twice(2));`,
          },
        );
        const files = ["app.js", "web/page.js", "web/worker.js", "web/preload.js"];
        const built = await run([bunExe(), "compile", "--desktop", ...flags, ...files, "--outfile=out"], String(dir));
        expect(built).toMatchObject({ exitCode: 0 });
        const cmd = [join(String(dir), "out" + extension, executable)];
        expect(await run(cmd, String(dir), withSandbox)).toMatchObject({
          stdout: "main\nworker 4 true false\ncrashed\n",
          exitCode: 0,
        });
      },
    );

    test
      .skipIf(!hasLibrary || !isLinux)
      .each([
        [true, [], true],
        [false, [], !canTrim],
        ...(canTrim ? [[true, ["--trim"], true] as const] : []),
      ] as const)("jit: %j %j for a page that was not compiled", async (jit, flags, generatesCode) => {
      using dir = project(
        { name: "notes", module: "app.js", desktop: { name: "Memo", jit } },
        {
          "app.js": `const { app, BrowserWindow, protocol } = require("bun:desktop/electron");
protocol.registerSchemesAsPrivileged([{ scheme: "app", privileges: { standard: true, secure: true } }]);
app.trustOrigins(["app://bundle"]);
app.whenReady().then(() => {
  const page = "<script>let sum = 0; for (let i = 0; i < 1e6; i++) sum += i & 1; console.log(sum);</script>";
  protocol.handle("app", () => new Response(page, { headers: { "content-type": "text/html" } }));
  const { webContents } = new BrowserWindow({ webPreferences: { sandbox: true } });
  webContents.on("console-message", event => {
    const read = name => require("fs").readFileSync("/proc/" + name + "/maps", "latin1");
    console.log(event.message, /rwx/.test(read(webContents.getOSProcessId())), /rwx/.test(read("self")));
    process.exit(0);
  });
  webContents.loadURL("app://bundle/");
});`,
        },
      );
      const built = await run([bunExe(), "compile", "--desktop", ...flags, "--outfile=out"], String(dir));
      expect(built).toMatchObject({ exitCode: 0 });
      const cmd = [join(String(dir), "out" + extension, executable)];
      expect(await run(cmd, String(dir), withSandbox)).toMatchObject({
        stdout: `500000 ${generatesCode} false\n`,
        exitCode: 0,
      });
    });

    test.skipIf(!hasLibrary || !canTrim).each([
      [{}, {}, ["Intl", "Temporal", "WebAssembly"]],
      [{ jit: true }, {}, []],
      [{ jit: true }, { remove: ["brotli", "spawn"] }, ["woff2"]],
      [{ jit: true }, { remove: ["fetch"] }, ["https", "wss"]],
    ])("with %j and trim: %j a page that the build has not seen lacks %j", async (desktop, trim, lacking) => {
      await using server = Bun.serve({
        port: 0,
        tls,
        fetch: (request, server) =>
          server.upgrade(request)
            ? undefined
            : new Response("served", { headers: { "access-control-allow-origin": "*" } }),
        websocket: { message: (socket, message) => void socket.send(message) },
      });
      const font = readFileSync(join(import.meta.dir, "../../packages/bun-desktop/fixtures/space-mono-subset.woff2"));
      using dir = project(undefined, {
        "build.js": `const { success, logs } = await Bun.build({
  entrypoints: ["./app.js"],
  compile: { aot: true, outfile: "out", trim: ${JSON.stringify(trim)}, desktop: ${JSON.stringify({ name: "Memo", resources: ["app"], ...desktop })} },
});
if (!success) throw new AggregateError(logs);`,
        "app.js": `const { app, BrowserWindow } = require("bun:desktop/electron");
app.commandLine.appendSwitch("ignore-certificate-errors");
app.whenReady().then(() => {
  const { webContents } = new BrowserWindow();
  webContents.on("console-message", ({ message }) => message.startsWith("[") && (console.log(message), app.exit(0)));
  webContents.loadFile("page.html");
});`,
        "app/font.woff2": font,
        "app/page.html": `<input pattern="\\p{L}+" value="1"><script>
const event = (target, name) => new Promise((resolve, reject) => (target.addEventListener(name, resolve), target.addEventListener("error", reject)));
const uses = {
  woff2: () => new FontFace("a", "url(font.woff2)").load(),
  https: () => fetch("https://localhost:${server.port}/").then(it => it.text()),
  wss: () => event(new WebSocket("wss://localhost:${server.port}/"), "open"),
  indexedDB: () => event(indexedDB.open("a"), "success"),
  localStorage: () => localStorage.setItem("a", "b"),
  streams: () => new Response(new Blob(["a"]).stream().pipeThrough(new CompressionStream("gzip")).pipeThrough(new DecompressionStream("gzip"))).text(),
  subtle: () => crypto.subtle.digest("SHA-256", new Uint8Array(1)),
  base64: () => atob(btoa("a")),
  png: () => new OffscreenCanvas(1, 1).convertToBlob(),
  pattern: () => document.querySelector("input:invalid").value,
  worker: () => event(new Worker(URL.createObjectURL(new Blob(["postMessage(1)"]))), "message"),
  Intl: () => new Intl.NumberFormat("de").format(1),
  Temporal: () => Temporal.Now.instant(),
  WebAssembly: () => WebAssembly.validate(new Uint8Array(8)),
};
Promise.all(Object.keys(uses).map(async name => { try { await uses[name](); } catch { return name; } })).then(all => console.log(JSON.stringify(all.filter(Boolean))));
</script>`,
      });
      expect(await run([bunExe(), "build.js"], String(dir))).toMatchObject({ exitCode: 0 });
      const cmd = [join(String(dir), "out" + extension, executable)];
      const env = { BUN_DESKTOP_HEADLESS: "1", XDG_CONFIG_HOME: String(dir) };
      expect(await run(cmd, String(dir), env)).toMatchObject({ stdout: JSON.stringify(lacking) + "\n", exitCode: 0 });
    });

    describe.skipIf(!hasLibrary)("pages", () => {
      /** Runs it without the files that it was made from. */
      async function compileAndRun(dir: { toString(): string }, sources: string[], ...args: string[]) {
        const built = await run([bunExe(), "compile", "--desktop", ...args, "--outfile=out"], String(dir));
        expect(built).toMatchObject({ exitCode: 0 });
        for (const it of sources) rmSync(join(String(dir), it), { recursive: true });
        const cmd = [join(String(dir), "out" + extension, executable)];
        const { stdout, exitCode } = await run(cmd, String(dir), { BUN_DESKTOP_HEADLESS: "1" });
        const inSandbox = async () => (await run([...cmd, ...places.at(-1)!], String(dir), withSandbox)).stdout;
        return { warnings: built.stderr.match(/(?<=warn: )TS\d+/g), stdout, exitCode, inSandbox };
      }

      test("scripts mean what they mean in a browser", async () => {
        using dir = project(
          { "name": "notes", "desktop": { "name": "Memo", "pages": ["web/index.html", "web/later/*.js"] } },
          {
            "app.js": String.raw`const { app, BrowserWindow, protocol } = require("bun:desktop/electron");
const fs = require("node:fs");
protocol.registerSchemesAsPrivileged([{ scheme: "app", privileges: { standard: true, secure: true } }]);
app.trustOrigins(["app://bundle"], { inFrames: true });
app.setCompiledScripts({ "app://bundle/": "/$bunfs/root/web/" });
app.whenReady().then(() => {
  protocol.handle("app", request => {
    const pathname = decodeURIComponent(new URL(request.url).pathname);
    const name = pathname.includes(".") ? pathname : "/index.html";
    return new Response(fs.readFileSync(__dirname + "/web" + name), { headers: { "content-type": name.endsWith("html") ? "text/html" : "text/javascript" } });
  });
  const { webContents } = new BrowserWindow();
  webContents.on("console-message", event => (event.message === "end" ? process.exit(0) : console.log(event.message)));
  webContents.loadURL("app://bundle/some/route");
});`,
            "web/declares.js": String.raw`function show(what, get) { let it; try { it = JSON.stringify(get()); } catch (error) { it = error.name + ": " + error.message; } console.log(what, it); }
show("hoisting", () => [typeof plain, hoisted(), "plain" in window, typeof inBlock, "inBlock" in window]);
show("dead zone", () => lexical);
var plain = 1, unset, { a, b = 2, ...rest } = { a: 1, x: 3 }, fn = function () {};
function hoisted() { return "first"; }
function hoisted() { return "second"; }
async function* generator() {}
let lexical = 2, empty, arrow = () => {}, [c, , d = class {}.name] = [3];
const constant = 3, { named = function () {} } = {};
class Klass { name = Klass.name; }
for (var i = 0, unused; i < 2; i++);
for (var key in { k: 1 });
for (var [item] of [[4]]);
for (var initialized = 5 in {});
for (let local = 0; local < 1; local++) { let inner; }
{ function inBlock() { return "block"; } }
if (true) function inIf() { return "if"; }
switch (1) { case 1: function inCase() { return "case"; } }
{ function lexical2() {} } let lexical3; { function lexical3() {} }
try { throw 6; } catch (caught) { var caught = 7, fromCatch = caught; }
with ({ target: 0 }) { var target = 8; }
label: function labeled() {}
show("properties", () => ["plain", "unset", "hoisted", "generator", "lexical", "constant", "Klass", "local", "inner", "inBlock", "inIf", "inCase", "lexical3", "caught", "target", "labeled", "initialized"].map(it => { const own = Object.getOwnPropertyDescriptor(window, it); return own ? it + +own.configurable + typeof own.value : "-"; }).join());
show("values", () => [inBlock(), inIf(), inCase(), typeof lexical3, caught, fromCatch, target, initialized, empty]);
show("names", () => [fn.name, hoisted.name, generator.name, arrow.name, named.name, Klass.name, String(hoisted), String(arrow)]);
show("constant", () => (constant = 0));
show("this", () => [this === window, (function () { return this === window; })(), typeof arguments]);
show("Node.js", () => [typeof require, typeof module, typeof exports, typeof __filename, typeof process, typeof global, typeof Bun]);
show("eval in a function", function () { var local = 1; return [eval("typeof require + typeof module + typeof __dirname + local + plain"), eval("(function () { return typeof require + typeof exports; })")(), new Function("return typeof module + eval('typeof require')")()]; });
show("as written", () => { let it; (it) = function () {}; return [it.name, String(() => 1 + 2)]; });
show("NODE_ENV", () => process.env.NODE_ENV);
show("replaced", () => { function call() { return hoisted(); } window.hoisted = () => "third"; return call(); });
show("pure", () => { let calls = 0; const f = () => calls++; /* @__PURE__ */ f(); return calls; });
show("current", () => document.currentScript.src);
show("first line", () => { try { show.a.b; } catch (error) { return error.message; } });
implicit = 10;
var count = 0, await = 11;
function caller() { return new Error().stack.split("\n").find(it => it.includes("@") ? !it.startsWith("caller") : /\bat (?!caller)/.test(it)).match(/:(\d+):(\d+)/).slice(1); }`,
            "web/evaluates.js": String.raw`var fromEvaluated = eval("1") && import("./module.js"); show("left to the engine", () => new Error().stack.match(/app:[^:]*:\d+/)[0]);`,
            "web/frame.html": String.raw`<script>var inFrame = 1; parent.fromFrame = [typeof plain, window.inFrame, parent.plain];</script>`,
            "web/index.html": String.raw`<!doctype html><base href="/"><body>
<script src="/declares.js?v=1"></script>
<script>
  show("from another script", () => [plain, hoisted(), lexical, constant, new Klass().name, a, b, rest, c, d, i, key, item]);
  show("position", () => caller());
  onerror = (message, url, line, column, error) => (console.log("error", error.name, error.message), true);
</script>
<script src="/strict.js"></script>
<script src="/umd.js"></script><script src="/evaluates.js"></script>
<script src="/with%20space.js"></script>
<script src="/twice.js"></script><script src="/twice.js"></script>
<script>let lexical;</script>
<script>var constant;</script>
<script>function untouched() {} let plain;</script>
<script>show("after errors", () => typeof untouched); throw new RangeError("thrown"); const never = 1;</script>
<script>show("never initialized", () => never);</script>
<script>this is no script</script>
<script>eval("var evaluated = 9"); { let local = 8; eval("var inBlockToo = local"); } show("eval", () => [window.evaluated, window.inBlockToo, eval("typeof arguments")]);</script>
<script>console.log("returns"); return;</script>
<script>console.log("new.target"); () => new.target;</script>
<script>console.log("import.meta"); import.meta;</script>
<script>}, function () {</script>
<script><!--
show("comments", () => 1);
--></script>
<script>class Range { static mine = 1 } const Map2 = Map; let name = "lexical name";</script>
<script>show("shadows", () => [Range.mine, typeof window.Range.mine, name, window.name]);</script>
<script type="text/template">this is no script either</script>
<script type="module">import { value } from "./module.js"; show("module", () => [value, this, typeof plain]);</script>
<script type="module" src="/umd-module.js?a"></script>
<script type="module">import { url } from "/module.js"; show("urls", () => [url, import.meta.url, import.meta.resolve("./x"), new Error().stack.match(/:(\d+):(\d+)/)[1]]);</script>
<script type="module">count++;</script><script type="module">count++;</script>
<iframe src="/frame.html"></iframe>
<script src="/last.js" defer></script>`,
            "web/last.js": String.raw`onload = () => {
  show("loaded", () => [count, fromFrame]);
  const script = document.createElement("script");
  script.src = "/later/chunk.js";
  script.onload = async () => {
    const [known, computed] = await chunk, evaluated = await fromEvaluated;
    show("import()", () => [known.value, known === computed, known === evaluated]);
    const worker = new Worker("/later/worker.js");
    worker.onmessage = event => (show("worker", () => event.data), console.log("end"));
    worker.onerror = event => (console.log("worker error", event.message), console.log("end"));
  };
  document.body.append(script);
};`,
            "web/module.js": String.raw`export const value = "m", url = import.meta.url;`,
            "web/strict.js": String.raw`"use strict"; var strictVar = 1; function strictFunction() { return this; } { function strictBlock() {} }
show("strict", () => [window.strictVar, strictFunction(), typeof strictBlock, this === window, implicit, await]);
show("undeclared", () => (undeclared = 1));`,
            "web/twice.js": String.raw`var runs = (self.runs || 0) + 1; show("twice", () => [runs, caller()]);`,
            "web/umd-module.js": String.raw`if (typeof module === "object" && module.id) module.exports = 1; else self.fromModule = 2;
show("module without exports", () => [self.fromModule, this === undefined, typeof __filename, require === self.require, import.meta.url, (function () { return this; })()]);`,
            "web/umd.js": String.raw`(function (root, factory) {
  if (typeof exports === "object" && typeof module !== "undefined") module.exports = factory(require("missing"));
  else root.Library = factory();
})(this, () => "umd");
var module = { exports: {} }, exports = module.exports;
function require(name) { return "required " + name; }
exports.a = require("fs");
show("umd", () => [Library, window.module.exports, require.name, { module }.module === window.module]);
show("message", () => module.b.c);`,
            "web/with space.js": String.raw`#!/usr/bin/env x
show("space", () => caller());`,
            "web/later/chunk.js": String.raw`var chunk = Promise.all([import("../module.js"), import(["..", "module.js"].reduce((a, b) => a + "/" + b))]);`,
            "web/later/imported.js": String.raw`const imported = 2; function fromImported() { return own; }`,
            "web/later/worker.js": String.raw`importScripts("imported.js"); var own = 1; function onmessage() {} postMessage([self.own, imported, fromImported(), typeof window]);`,
          },
        );
        const { warnings, stdout, exitCode, inSandbox } = await compileAndRun(dir, ["web"], "app.js");
        expect(await inSandbox()).toBe(stdout);
        expect(warnings).toEqual(["TS100064"]);
        expect(stdout).toMatchInlineSnapshot(`
"hoisting ["undefined","second",true,"undefined",true]
dead zone ReferenceError: Cannot access 'lexical' before initialization.
properties "plain0number,unset0undefined,hoisted0function,generator0function,-,-,-,-,-,inBlock0function,inIf0function,inCase0function,-,caught0undefined,target0undefined,labeled0function,initialized0number"
values ["block","if","case","undefined",null,7,null,5,null]
names ["fn","hoisted","generator","arrow","named","Klass","function hoisted() { return \\"second\\"; }","() => {}"]
constant TypeError: Attempted to assign to readonly property.
this [true,true,"undefined"]
Node.js ["undefined","undefined","undefined","undefined","undefined","undefined","undefined"]
eval in a function ["undefinedundefinedundefined11","undefinedundefined","undefinedundefined"]
as written ["","() => 1 + 2"]
NODE_ENV ReferenceError: process is not defined
replaced "third"
pure 1
current "app://bundle/declares.js?v=1"
first line "undefined is not an object (evaluating 'show.a.b')"
from another script [1,"third",2,3,"Klass",1,2,{"x":3},3,"",2,"k",4]
position ["5","26"]
strict [1,null,"undefined",true,10,11]
undeclared ReferenceError: undeclared is not defined
umd ["umd",{"a":"required fs"},"require",true]
message TypeError: undefined is not an object (evaluating 'module.b.c')
left to the engine "app://bundle/evaluates.js:1"
space ["2","21"]
twice [1,["1","61"]]
twice [2,["1","61"]]
error SyntaxError Can't create duplicate variable: 'lexical'
error SyntaxError Can't create duplicate variable: 'constant'
error SyntaxError Can't create duplicate variable that shadows a global property: 'plain'
after errors "undefined"
error RangeError thrown
never initialized ReferenceError: Cannot access 'never' before initialization.
error SyntaxError Unexpected identifier 'is'
eval [9,8,"undefined"]
error SyntaxError Return statements are only valid inside functions.
error SyntaxError new.target is not valid inside arrow functions in global code.
error SyntaxError import.meta is only valid inside modules.
error SyntaxError Parser error
comments 1
shadows [1,"undefined","lexical name",""]
module ["m",null,"number"]
module without exports [2,true,"undefined",true,"app://bundle/umd-module.js?a",null]
urls ["app://bundle/module.js","app://bundle/","app://bundle/x","31"]
loaded [2,["undefined",1,1]]
import() ["m",true,true]
worker [1,2,1,"undefined"]
"
`);
        expect(exitCode).toBe(0);
      });

      test("file: URLs find what pages load, and nothing of the main process", async () => {
        using dir = project(
          {
            "name": "notes",
            "main": "main.js",
            "desktop": { "name": "Memo", "preloads": "preload.js", "pages": ["ui/lazy/*.js"] },
          },
          {
            "main.js": String.raw`const { app, BrowserWindow, ipcMain } = require("electron");
const { join } = require("node:path");
require("./secret.js");
app.whenReady().then(async () => {
  ipcMain.handle("ping", () => "pong");
  const window = new BrowserWindow({ webPreferences: { preload: join(__dirname, "preload.js") } });
  window.webContents.on("preload-error", (event, path, error) => console.log("preload-error", error.message));
  for (const file of ["ui/index.html", join(__dirname, "ui/index.html")]) {
    await window.loadFile(file);
    console.log(JSON.stringify(await window.webContents.executeJavaScript("done")));
    const names = ["./lib/state.js", "./lazy/module.js", "../main.js", "../secret.js", "../preload.js", "../preload.js.preload.cjs", "./classic.js.script.cjs"];
    console.log(await window.webContents.executeJavaScript("Promise.all(" + JSON.stringify(names) + ".map(it => import(it).then(it => it.state === state, it => it.name))).then(String)"));
  }
  app.exit(0);
});`,
            "preload.js": String.raw`const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("api", { ping: () => ipcRenderer.invoke("ping") });`,
            "secret.js": String.raw`exports.read = require("node:fs").readFileSync;`,
            "real/file.js": String.raw`var linked = "linked";`,
            "real/module.js": String.raw`export default "linked module";`,
            "ui/a.svg": String.raw`<svg xmlns="http://www.w3.org/2000/svg" width="7" height="7"/>`,
            "ui/app.js": String.raw`import { state } from "./lib/state.js?v=1";
import pkg, { scoped as inner } from "pkg";
import other from "pkg/other.js";
import outer from "scoped";
import linkedModule from "./linked/module.js";
import data from "./data.json" with { type: "json" };
import sheet from "./sheet.css" with { type: "css" };
self.state = state;
const answer = worker => new Promise(done => Object.assign(worker, { onmessage: it => done(it.data), onerror: it => done("error " + it.message) }));
const below = url => url.slice(url.lastIndexOf("/ui/"));
finish({
  title: document.title,
  style: [getComputedStyle(document.body).color, getComputedStyle(document.body).backgroundColor, await document.images[0].decode().then(() => document.images[0].naturalWidth)],
  ping: await api.ping(),
  imports: [pkg, inner, other, outer, linked, linkedModule, data, sheet.cssRules.length],
  meta: [below(import.meta.url), below(import.meta.resolve("pkg")), Object.keys(import.meta).join()],
  text: await (await fetch(new URL("./text.txt", import.meta.url))).text(),
  workers: [await answer(new Worker(new URL("./sloppy.js", import.meta.url))), await answer(new Worker("worker.js")), await answer(new Worker(new URL("./module-worker.js", import.meta.url), { type: "module" }))],
  lazy: [(await import(["lazy", "module.js"].reduce((a, b) => a + "/" + b, "."))).state === state, await new Promise(done => document.body.append(Object.assign(document.createElement("script"), { src: "lazy/classic.js", onload: () => done(lazy), onerror: () => done("error") })))],
  node: [typeof require, typeof module, typeof process, typeof __dirname, this],
});`,
            "ui/classic.js": String.raw`var finish, done = new Promise(it => (finish = it));`,
            "ui/data.json": String.raw`{ "a": 1 }`,
            "ui/imported.js": String.raw`var imported = "imported ";`,
            "ui/index.html": String.raw`<!doctype html><title>Memo</title><link rel="stylesheet" href="style.css">
<script type="importmap">{ "imports": { "pkg": "./vendor/pkg/index.js", "pkg/": "./vendor/pkg/", "scoped": "./vendor/outer.js" }, "scopes": { "./vendor/pkg/": { "scoped": "./vendor/inner.js" } } }</script>
<img src="a.svg"><script src="classic.js"></script><script src="linked/file.js"></script>
<script type="module" src="app.js"></script>`,
            "ui/module-worker.js": String.raw`import { state } from "./lib/state.js"; postMessage(typeof state + typeof this);`,
            "ui/more.css": String.raw`body { background-color: rgb(4, 5, 6) }`,
            "ui/sheet.css": String.raw`p { color: red }`,
            "ui/sloppy.js": String.raw`with (self) postMessage(010);`,
            "ui/style.css": String.raw`@import "more.css"; body { color: rgb(1, 2, 3) }`,
            "ui/text.txt": String.raw`text`,
            "ui/worker.js": String.raw`with (self) importScripts("imported.js"); postMessage(imported + typeof this);`,
            "ui/lazy/classic.js": String.raw`var lazy = "lazy";`,
            "ui/lazy/module.js": String.raw`export { state } from "../lib/state.js";`,
            "ui/lib/state.js": String.raw`export const state = {};`,
            "ui/vendor/inner.js": String.raw`export default "inner";`,
            "ui/vendor/outer.js": String.raw`export default "outer";`,
            "ui/vendor/pkg/index.js": String.raw`export { default as scoped } from "scoped"; export default "pkg";`,
            "ui/vendor/pkg/other.js": String.raw`export default "other";`,
          },
        );
        symlinkSync("../real", join(String(dir), "ui/linked"), "dir");
        const sources = ["ui", "real", "main.js", "preload.js", "secret.js"];
        const { warnings, stdout, exitCode, inSandbox } = await compileAndRun(dir, sources, "main.js", "ui/index.html");
        expect(await inSandbox()).toBe(stdout);
        expect(warnings).toEqual(["TS100064"]);
        expect(stdout).toMatchInlineSnapshot(`
"{"title":"Memo","style":["rgb(1, 2, 3)","rgb(4, 5, 6)",7],"ping":"pong","imports":["pkg","inner","other","outer","linked","linked module",{"a":1},1],"meta":["/ui/app.js","/ui/vendor/pkg/index.js","url,resolve"],"text":"text","workers":[8,"imported object","objectundefined"],"lazy":[true,"lazy"],"node":["undefined","undefined","undefined","undefined",null]}
true,true,TypeError,TypeError,TypeError,TypeError,TypeError
{"title":"Memo","style":["rgb(1, 2, 3)","rgb(4, 5, 6)",7],"ping":"pong","imports":["pkg","inner","other","outer","linked","linked module",{"a":1},1],"meta":["/ui/app.js","/ui/vendor/pkg/index.js","url,resolve"],"text":"text","workers":[8,"imported object","objectundefined"],"lazy":[true,"lazy"],"node":["undefined","undefined","undefined","undefined",null]}
true,true,TypeError,TypeError,TypeError,TypeError,TypeError
"
`);
        expect(exitCode).toBe(0);
      });

      describe("files outside of the project", () => {
        const app = (page: string, files: Record<string, string> = {}) =>
          tempDir("compile-desktop-outside", {
            "outside.css": "p { color: rgb(1, 1, 1) }",
            "outside.js": "var outside = 1;",
            "outside.html": "",
            "outside.txt": "",
            "app/package.json": JSON.stringify({ name: "notes", main: "main.js", desktop: { name: "Memo" } }),
            "app/main.js": `const { app, BrowserWindow } = require("electron");
app.whenReady().then(async () => {
  const window = new BrowserWindow();
  await window.loadFile(__dirname + "/ui/index.html");
  console.log(await window.webContents.executeJavaScript("getComputedStyle(document.querySelector('p')).color + typeof outside"));
  app.exit(0);
});`,
            "app/ui/index.html": page,
            ...files,
          });
        const build = (dir: { toString(): string }, ...args: string[]) =>
          run([bunExe(), "compile", "--desktop", "main.js", ...args, "--outfile=out"], join(String(dir), "app"));
        function isInBundle(dir: { toString(): string }, text: string) {
          const bundle = join(String(dir), "app/out" + extension);
          return filesIn(bundle).some(it => readFileSync(join(bundle, it)).includes(text));
        }

        test.each([
          ["outside.css", "ui/index.html", `<link rel="stylesheet" href="../../outside.css">`],
          ["outside.txt", "ui/index.html", `<img src="..%2F..%2Foutside.txt">`],
          ["outside.txt", "ui/index.html", `<p style="background: url(../../outside.txt)">`],
          ["outside.html", "ui/index.html", `<a href="../../outside.html">`],
          ["outside.js", "ui/index.html", `<script src="../../outside.js"></script>`],
          ["outside.js", "ui/index.html", `<script type="module" src="../../outside.js"></script>`],
          ["outside.js", "ui/index.html", `<script>new Worker("../../outside.js")</script>`],
          ["outside.js", "ui/index.html", `<script style="color: red">new Worker("../../outside.js")</script>`],
          ["outside.txt", "ui/index.html", `<img srcset="a.png 1x, ../../outside.txt 2x">`],
          ["outside.css", "ui/index.html", `<base href="../../"><link rel="stylesheet" href="outside.css">`],
          ["outside.txt", "ui/index.html", `<img src="/../outside.txt">`],
          ["outside.txt", "node_modules/a/a.css", `<link rel="stylesheet" href="../node_modules/a/a.css">`],
          ["outside.txt", "ui/url.js", `<script type="module" src="url.js"></script>`],
          ["outside.css", "ui/import.js", `<script type="module" src="import.js"></script>`],
        ])("%s, named by %s: %s", async (file, namedBy, page) => {
          using dir = app(page, {
            "app/node_modules/a/a.css": "p { background: url(../../../outside.txt) }",
            "app/ui/url.js": `fetch(new URL("../../outside.txt", import.meta.url));`,
            "app/ui/import.js": `import "../../outside.css" with { type: "css" };`,
          });
          const { stderr, exitCode } = await build(dir, "ui/index.html");
          const [project, from, to] = ["app", join("app", namedBy), file].map(it => `"${join(String(dir), it)}"`);
          expect(stderr).toContain(`error: ${from} loads ${to}, which is outside of ${project}.`);
          expect(exitCode).toBe(1);
        });

        test.skipIf(isWindows).each([
          ["ui/link", "../..", "link/outside.css"],
          ["node_modules/a/link", "../../..", "../node_modules/a/link/outside.css"],
        ])("through the link %s", async (link, target, url) => {
          using dir = app(`<link rel="stylesheet" href="${url}">`, { "app/node_modules/a/index.js": "" });
          symlinkSync(target, join(String(dir), "app", link));
          const { stderr, exitCode } = await build(dir, "ui/index.html");
          expect(stderr).toContain(`loads "${join(String(dir), "app", link, "outside.css")}", which is outside of`);
          expect(exitCode).toBe(1);
        });

        test("/ is not looked for above the project, and a link to a document takes nothing", async () => {
          const page = `<link rel="stylesheet" href="/outside.css"><link rel="stylesheet" href="/inside.css"><script src="/outside.js"></script><a href="../../outside.txt">`;
          using dir = app(page, {
            "outside.css": "p { --found-above-the-project: 1 }",
            "app/inside.css": "p { --found-in-the-project: 1 }",
          });
          expect(await build(dir, "ui/index.html")).toMatchObject({ exitCode: 0 });
          expect(isInBundle(dir, "--found-in-the-project")).toBe(true);
          expect(isInBundle(dir, "--found-above-the-project")).toBe(false);
        });

        test("--root", async () => {
          using dir = app(
            `<link rel="stylesheet" href="../../outside.css"><script src="../../outside.js"></script><p>`,
          );
          expect(await build(dir, "ui/index.html", "--root=..")).toMatchObject({ exitCode: 0 });
          for (const it of ["app/ui", "outside.css", "outside.js"]) rmSync(join(String(dir), it), { recursive: true });
          const cmd = [join(String(dir), "app/out" + extension, executable)];
          expect(await run(cmd, String(dir), { BUN_DESKTOP_HEADLESS: "1" })).toMatchObject({
            stdout: "rgb(1, 1, 1)number\n",
            exitCode: 0,
          });
        });

        test.skipIf(isWindows)("packages, imports, and what is beside a page that is listed", async () => {
          const page = `<link rel="stylesheet" href="../../node_modules/@a/hoisted/a.css"><link rel="stylesheet" href="../node_modules/linked/a.css"><script type="module" src="a.js"></script>`;
          using dir = app(page, {
            "node_modules/@a/hoisted/a.css": "p { --is-hoisted: 1 }",
            "packages/linked/a.css": "p { --is-linked: 1 }",
            "shared/a.js": `export default "--is-imported";`,
            "web/index.html": `<link rel="stylesheet" href="a.css">`,
            "web/a.css": "p { --is-beside: 1 }",
            "app/node_modules/a/index.js": "",
            "app/ui/a.js": `import a from "../../shared/a.js"; document.title = a;`,
          });
          symlinkSync("../../packages/linked", join(String(dir), "app/node_modules/linked"));
          expect(await build(dir, "ui/index.html", "../web/index.html")).toMatchObject({ exitCode: 0 });
          const texts = ["--is-hoisted", "--is-linked", "--is-imported", "--is-beside"];
          expect(texts.filter(it => !isInBundle(dir, it))).toEqual([]);
        });
      });

      test("an app cannot be told to be a part of another", async () => {
        using dir = project({ name: "notes", main: "app.ts", desktop: { name: "Memo" } });
        expect(await run([bunExe(), "compile", "--desktop", "app.ts", "--outfile=out"], String(dir))).toMatchObject({
          exitCode: 0,
        });
        const as = async (role: string, env = {}) =>
          (
            await run(
              [join(String(dir), "out" + extension, executable), "--bun-desktop-child=" + role, "library"],
              String(dir),
              { BUN_DESKTOP_HEADLESS: "1", ...env },
            )
          ).stdout;
        expect(await Promise.all([as("page"), as("compiled-page"), as("gpu"), as("page", withSandbox)])).toEqual([
          "started\n",
          "started\n",
          "started\n",
          isLinux ? "" : "started\n",
        ]);
      });

      test.skipIf(!isLinux)("only the processes of pages that were compiled have the program", async () => {
        using dir = project(
          {
            "name": "notes",
            "main": "main.js",
            "desktop": { "name": "Memo", "preloads": "preload.js", "pages": ["ui/*.html"], "jit": true },
          },
          {
            "main.js": String.raw`const { app, BrowserWindow } = require("bun:desktop/electron");
const seen = [];
const server = require("http").createServer((request, response) => response.writeHead(200, { "content-type": "text/html" }).end("<script>console.log('served', self.bridge)</script>"));
app.whenReady().then(() => server.listen(0, "127.0.0.1", async () => {
  const url = "http://127.0.0.1:" + server.address().port + "/";
  app.trustOrigins([url.slice(0, -1)], { inFrames: true });
  const open = preload => {
    const window = new BrowserWindow({ webPreferences: { sandbox: true, preload } });
    window.webContents.on("console-message", ({ message, frame }) => {
      const read = name => require("fs").readFileSync("/proc/" + frame.osProcessId + "/" + name, "latin1");
      seen.push([message, read("cmdline").match(/child=([\w-]+)/)[1], /Seccomp:\s2/.test(read("status")), /rwx/.test(read("maps"))].join(" "));
    });
    return window;
  };
  await open().loadFile("ui/index.html", { hash: url });
  await open().loadURL(url);
  await open(__dirname + "/preload.js").loadURL(url);
  while (seen.length < 4) await new Promise(setImmediate);
  console.log(seen.join("\n"));
  app.exit(0);
}));`,
            "preload.js": `require("electron").contextBridge.exposeInMainWorld("bridge", String(() => 1).includes("native"));`,
            "ui/index.html": `<body><script>console.log("listed", String(() => 1).includes("native")); document.body.append(Object.assign(document.createElement("iframe"), { src: location.hash.slice(1) }));</script>`,
          },
        );
        const built = await run(
          [bunExe(), "compile", "--desktop", "--no-compile-function-source", "main.js", "--outfile=out"],
          String(dir),
        );
        expect(built).toMatchObject({ exitCode: 0 });
        for (const it of ["ui", "preload.js"]) rmSync(join(String(dir), it), { recursive: true });
        expect(await run([join(String(dir), "out" + extension, executable)], String(dir), withSandbox)).toMatchObject({
          stdout: [
            "listed true compiled-page true false",
            "served undefined page true true",
            "served undefined page true true",
            "served true compiled-page true false\n",
          ].join("\n"),
          exitCode: 0,
        });
      });

      test("what is compiled and what is interpreted", async () => {
        using dir = project(
          {
            "name": "notes",
            "main": "main.js",
            "type": "module",
            "desktop": { "name": "Memo", "preloads": "preload.js", "pages": ["ui/*.html"] },
          },
          {
            "main.js": String.raw`import { app, BrowserWindow } from "electron";
import { writeFileSync } from "node:fs";
app.whenReady().then(async () => {
  const seen = [];
  const open = async (file, webPreferences) => {
    const window = new BrowserWindow({ webPreferences });
    window.webContents.on("console-message", event => seen.push(event.message));
    await window.loadFile(file);
  };
  await open("ui/index.html", { preload: import.meta.dirname + "/preload.js" });
  await open("ui/node.html", { nodeIntegration: true, contextIsolation: false });
  const written = process.cwd() + "/written.html";
  writeFileSync(written, '<script src="file://' + import.meta.dirname + '/ui/classic.js" onerror="console.log(\'written without\')"></script><script>Math.max = null; console.log("written patches", !Math.max)</script>');
  await open(written);
  while (seen.length < 15) await new Promise(setImmediate);
  console.log(seen.sort().join("\n"));
  app.exit(0);
});`,
            "preload.js": String.raw`console.log("preload", String(() => 1).includes("native") ? "compiled" : "interpreted", typeof require("electron").ipcRenderer);`,
            "ui/classic.js": String.raw`function tell(what, it) { console.log(what, String(it).includes("native") ? "compiled" : "interpreted"); }
tell("classic", () => 1);
new Worker("worker.js").onmessage = event => event.data.forEach(it => console.log(it));`,
            "ui/imported.js": String.raw`tell("imported", () => 1);`,
            "ui/index.html": String.raw`<script src="classic.js"></script>
<script>tell("inline", () => 1);</script>
<script>try { eval("Math.max = null"); } catch {} console.log("patches", !Math.max); tell("eval outside of a function", () => 1);</script>
<script type="module">import "./imported.js"; tell("inline module", () => 1);</script>
<script type="module" src="module.js"></script>
<body onload="tell('attribute', () => 1)">`,
            "ui/module.js": String.raw`tell("module", () => 1);`,
            "ui/more.js": String.raw`var more = "importScripts() " + kind(() => 1);`,
            "ui/node.html": String.raw`<script>console.log("node", String(() => 1).includes("native") ? "compiled" : "interpreted", typeof require("fs").readFileSync, typeof require("electron").ipcRenderer, typeof process.pid, typeof module);</script>`,
            "ui/worker.js": String.raw`var kind = it => (String(it).includes("native") ? "compiled" : "interpreted"); importScripts("more.js"); with (self) postMessage(["worker " + kind(() => 1), more]);`,
          },
        );
        const args = ["--no-compile-function-source", "main.js"];
        const { warnings, stdout, exitCode } = await compileAndRun(dir, ["ui", "preload.js"], ...args);
        expect(warnings).toBeNull();
        expect(stdout).toMatchInlineSnapshot(`
"Failed to load resource: net::ERR_FILE_NOT_FOUND
attribute interpreted
classic compiled
eval outside of a function interpreted
importScripts() compiled
imported compiled
inline compiled
inline module compiled
module compiled
node compiled function object number object
patches false
preload compiled object
worker compiled
written patches true
written without
"
`);
        expect(exitCode).toBe(0);
      });
    });

    test("finds a missing library before it compiles", async () => {
      using dir = project({ name: "notes" }, { "app.ts": "syntax error" });
      const cmd = [bunExe(), "compile", "--desktop", "app.ts"];
      const { stderr, exitCode } = await run(cmd, String(dir), { BUN_DESKTOP_LIBRARY: "missing" });
      expect(stderr.trim()).toBe("error: BUN_DESKTOP_LIBRARY names a file that does not exist: missing");
      expect(exitCode).toBe(1);
    });
  });

  describe.skipIf(isMacOS || isMusl)("the modules of Electron are built in", () => {
    const app = isWindows ? "out/notes.exe" : "out.AppDir/AppRun";
    const api = (aot: boolean) =>
      `await Bun.build({ entrypoints: ["app.js"], compile: { aot: ${aot}, desktop: true, outfile: "out" } });`;
    const builds = [
      ["bun build", false, ["build", "--compile", "--desktop", "app.js", "--outfile=out"]],
      ["Bun.build", false, ["-e", api(false)]],
      ["bun compile", true, ["compile", "--desktop", "app.js", "--outfile=out"]],
      ["Bun.build with aot", true, ["-e", api(true)]],
    ] as const;
    const installed = {
      "node_modules/electron/package.json": JSON.stringify({ name: "electron", version: "1.0.0" }),
      "node_modules/electron/index.js": `module.exports = "the path of Electron";`,
    };

    for (const [name, isAot, args] of builds) {
      test.skipIf(isAot && (!!aotIsUnsupported || isDebug)).each([
        ["is not installed", {}],
        ["is installed", installed],
      ])(`${name}, when the package %s`, async (_, files) => {
        using dir = project(
          { name: "notes" },
          {
            ...files,
            "app.js": `
              import { createRequire } from "node:module";
              const made = createRequire(import.meta.url)(process.env.NAME);
              const { app } = require("electron");
              const { imported } = await import("./imports.js");
              console.log(app.name, made.app === app, imported.map(it => it === app).join());
              console.log(require("original-fs") === require("fs"), (await import("node:original-fs")).default === require("fs"));
              process.exit(0);
            `,
            "imports.js": `
              import electron, { app } from "electron";
              import * as main from "electron/main";
              import { app as own } from "bun:desktop/electron";
              export const imported = [electron.app, app, main.app, own, (await import("electron/common")).app,
                require("electron/renderer").app, require("electron/utility").app];
            `,
          },
        );
        expect(await bun(dir, ...args)).toMatchObject({ exitCode: 0 });
        const env = { NAME: "electron", BUN_DESKTOP_HEADLESS: "1" };
        expect(await run([join(String(dir), app)], "/", env)).toMatchObject({
          stdout: "notes true true,true,true,true,true,true,true\ntrue true\n",
          exitCode: 0,
        });
      });
    }

    test("not without --desktop", async () => {
      using dir = project({ name: "notes" }, { ...installed, "app.js": `console.log(require("electron"));` });
      expect(await bun(dir, "build", "--compile", "app.js", "--outfile=out")).toMatchObject({ exitCode: 0 });
      expect(await run([join(String(dir), isWindows ? "out.exe" : "out")], "/")).toMatchObject({
        stdout: "the path of Electron\n",
        exitCode: 0,
      });
    });

    describe.each([
      ["bun build --compile", false, ["build", "--compile"]],
      ["bun compile", true, ["compile"]],
    ])("%s without --desktop has no bun:desktop", (_, isAot, command) => {
      test.skipIf(isAot && (!!aotIsUnsupported || isDebug))("an import stops the build", async () => {
        using dir = project(undefined, { "app.js": `import { app } from "bun:desktop";\nconsole.log(typeof app);` });
        const { stderr, exitCode } = await bun(dir, ...command, "app.js", "--outfile=out");
        expect(stderr).toContain(`"bun:desktop" is only in an executable that is built with --desktop`);
        expect(exitCode).toBe(1);
      });

      test.skipIf(isAot && (!!aotIsUnsupported || isDebug))("a load under a name from outside throws", async () => {
        using dir = project(undefined, {
          "app.js": `const name = process.argv[2];
for (const load of [() => require(name), () => import(name), () => process.getBuiltinModule(name)]) {
  try {
    console.log(typeof (await load()));
  } catch (error) {
    console.log(error.message);
  }
}`,
        });
        expect(await bun(dir, ...command, "app.js", "--outfile=out")).toMatchObject({ exitCode: 0 });
        const out = join(String(dir), isWindows ? "out.exe" : "out");
        expect(await run([out, "bun:desktop/dom"], "/")).toMatchObject({
          stdout: "Cannot load 'bun:desktop/dom': it is only in an executable that is built with --desktop\n".repeat(3),
          exitCode: 0,
        });
        expect(await run([out, "node:path"], "/")).toMatchObject({ stdout: "object\n".repeat(3), exitCode: 0 });
      });
    });

    describe.skipIf(!!aotIsUnsupported || isDebug)("an import turns bun:desktop on for --aot in", () => {
      const imports = {
        "static.js": `import { document } from "bun:desktop/dom";\nconsole.log(document.createElement("p").tagName);`,
        "dynamic.js": `const { document } = await import("bun:desktop/dom");\nconsole.log(document.createElement("p").tagName);`,
        "guarded.cjs": `try {\n  console.log(require("bun:desktop/dom").document.createElement("p").tagName);\n} catch {}`,
        "further.js": `import "./static.js";`,
      };

      test.each(Object.keys(imports))("bun run %s", async file => {
        using dir = project(undefined, imports);
        expect(await bun(dir, "--aot", file)).toEqual({ stdout: "P\n", stderr: "", exitCode: 0 });
      });

      test.each([
        ["run", ["--aot"]],
        ["test", ["test", "--aot"]],
      ])("bun %s of a file whose package has the import statement", async (_, command) => {
        using dir = project(undefined, {
          "app.test.js": `import "pages";`,
          "node_modules/pages/index.js": imports["static.js"],
        });
        const { stdout, exitCode } = await bun(dir, ...command, "./app.test.js");
        expect(stdout).toEndWith("P\n");
        expect(exitCode).toBe(0);
      });

      test.each([
        ["a key", `Object.keys({ "bun:desktop": 1 });`],
        ["a text beside a loader", `const load = name => require(name);\nload("node:path"), String("bun:desktop");`],
        ["require.resolve()", `if (process.env.NEVER) require.resolve("bun:desktop");`],
        ["require() in a package", `require("tries");`],
        ["import() in a package", `require("tries/later");`],
        ["a list in a package", `require("tries/listed");`],
        ["a file of a package that is loaded later", `require("tries/lazily");`],
      ])("but not %s", async (_, code) => {
        using dir = project(undefined, {
          "app.test.cjs": `${code}
console.log(require("electron"));
if (${isLinux && !isMusl && !isHardened}) {
  const { prctl } = require("bun:ffi").dlopen(${JSON.stringify(isLinux ? libcPathForDlopen() : "")}, {
    prctl: { args: ["i32", "u64", "u64", "u64", "u64"], returns: "i32" },
  }).symbols;
  const PR_SET_MDWE = 65, PR_GET_MDWE = 66;
  const before = prctl(PR_GET_MDWE, 0, 0, 0, 0);
  prctl(PR_SET_MDWE, 3, 0, 0, 0);
  if (prctl(PR_GET_MDWE, 0, 0, 0, 0) !== before) console.log("Writable memory could be executed");
}`,
          "node_modules/electron/index.js": `module.exports = "the path of Electron";`,
          "node_modules/tries/index.js": `try {\n  require("bun:desktop");\n} catch {}`,
          "node_modules/tries/later.js": `import("bun:desktop").catch(() => {});`,
          "node_modules/tries/listed.js": `require(["bun:desktop", "node:path"][+!process.env.NEVER]);`,
          "node_modules/tries/lazily.js": `if (process.env.NEVER) import("./window.mjs");`,
          "node_modules/tries/window.mjs": `import "bun:desktop";`,
        });
        const { stdout, exitCode } = await bun(dir, "test", "--aot", "./app.test.cjs");
        expect(stdout).toEndWith("\nthe path of Electron\n");
        expect(exitCode).toBe(0);
      });

      test("bun test", async () => {
        using dir = project(undefined, {
          "page.test.js": `import { expect, test } from "bun:test";
import { document } from "bun:desktop/dom";
test("page", () => {
  document.body.append(document.createElement("p"));
  expect([...document.body.children].map(child => child.tagName)).toEqual(["P"]);
});`,
        });
        const { stderr, exitCode } = await bun(dir, "test", "--aot", "./page.test.js");
        expect(stderr).toContain(" 1 pass");
        expect(exitCode).toBe(0);
      });

      test.each([
        ["static.js", "kept"],
        ["app.ts", "removed"],
      ])("bun check %s", async (file, fate) => {
        using dir = project(undefined, imports);
        const { stdout, stderr, exitCode } = await bun(dir, "check", "--aot", "--no-pretty", "--explain=trim", file);
        expect(stdout + stderr).toContain(`aot: trim: ${fate} bun:desktop (desktop)`);
        expect(exitCode).toBe(0);
      });
    });

    test.skipIf(!hasLibrary || !!aotIsUnsupported || isDebug)("not for pages", async () => {
      using dir = project(
        { name: "notes" },
        {
          "app.js": `const { app, BrowserWindow, protocol } = require("electron");
protocol.registerSchemesAsPrivileged([{ scheme: "app", privileges: { standard: true, secure: true } }]);
app.trustOrigins(["app://bundle"]);
app.setCompiledScripts({ "app://bundle/web/": "/$bunfs/root/web/" });
const interpreted = 'import("electron").then(() => "imported", error => error.name).then(it => console.log(compiled, it))';
app.whenReady().then(() => {
  protocol.handle("app", ({ url }) => url.endsWith(".js")
    ? new Response(interpreted, { headers: { "content-type": "text/javascript" } })
    : new Response("<script type=module src=/web/page.js></script><script type=module src=/other.js></script>", { headers: { "content-type": "text/html" } }));
  const { webContents } = new BrowserWindow();
  webContents.on("console-message", event => (console.log(event.message), process.exit(0)));
  webContents.loadURL("app://bundle/");
});`,
          "web/page.js": `try { window.compiled = typeof require("electron"); } catch (error) { window.compiled = error instanceof Error && error.message; }`,
        },
      );
      const built = await run(
        [bunExe(), "compile", "--desktop", "app.js", "web/page.js", "--outfile=out"],
        String(dir),
      );
      expect(built).toMatchObject({ exitCode: 0 });
      const cmd = [join(String(dir), app)];
      expect(await run(cmd, "/", { BUN_DESKTOP_HEADLESS: "1" })).toMatchObject({
        stdout: "A page gets Electron's modules from its preload script TypeError\n",
        exitCode: 0,
      });
    });
  });

  test.skipIf(!!aotIsUnsupported || isMacOS || isMusl)("Bun.build with aot", async () => {
    using dir = project(
      { name: "notes" },
      { "build.ts": `await Bun.build({ entrypoints: ["app.ts"], compile: { aot: true, desktop: true } });` },
    );
    expect(await bun(dir, "build.ts")).toMatchObject({ stderr: "", exitCode: 0 });
    expect(await run([join(String(dir), isWindows ? "notes/notes.exe" : "notes.AppDir/AppRun")], "/")).toMatchObject({
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

  test("only an app takes the argument that installs its update", async () => {
    using dir = project(undefined, { "app.ts": `console.log(process.argv.slice(2).join());` });
    const flag = "--bun-desktop-install-update";
    expect(await bun(dir, flag, "app.ts", "b")).toMatchObject({ stdout: "b\n", exitCode: 0 });
    expect(await bun(dir, "build", "--compile", "app.ts", "--outfile=plain")).toMatchObject({ exitCode: 0 });
    expect(
      await run([join(String(dir), isWindows ? "plain.exe" : "plain"), flag, "a", "b"], String(dir)),
    ).toMatchObject({
      stdout: flag + ",a,b\n",
      exitCode: 0,
    });
  });

  test
    .skipIf(!hasLibrary || !isLinux)
    .each([["build", "--compile"], ...(aotIsUnsupported || isDebug ? [] : [["compile"]])])(
    "pages run in sandboxed processes after bun %s",
    async (...command) => {
      using dir = tempDir("compile-desktop", {
        "package.json": JSON.stringify({ name: "pages", version: "1.0.0" }),
        "app.js": `const { app, BrowserWindow, protocol } = require("electron");
protocol.registerSchemesAsPrivileged([{ scheme: "app", privileges: { standard: true } }]);
app.setWebEngine({ type: "bun" });
app.whenReady().then(async () => {
  protocol.handle("app", () => new Response("<script>document.title = eval('typeof Bun') + [1].map(it => it * 2)</script>", { headers: { "content-type": "text/html" } }));
  const window = new BrowserWindow(), page = window.webContents;
  await window.loadURL("app://other/");
  console.log(page.getTitle(), /Seccomp:\\s2/.test(require("fs").readFileSync("/proc/" + page.getOSProcessId() + "/status", "latin1")));
  app.quit();
});`,
      });
      const built = await run([bunExe(), ...command, "--desktop", "app.js", "--outfile=out"], String(dir));
      expect(built).toMatchObject({ exitCode: 0 });
      expect(
        await run([join(String(dir), "out.AppDir/AppRun"), "--no-sandbox"], String(dir), withSandbox),
      ).toMatchObject({ stdout: "undefined2 true\n", exitCode: 0 });
    },
  );

  test("a compiled program does not take the argument that makes a process for pages", async () => {
    using dir = project(undefined, { "app.ts": `console.log(process.argv.slice(2).join());` });
    expect(await bun(dir, "build", "--compile", "app.ts", "--outfile=plain")).toMatchObject({ exitCode: 0 });
    expect(
      await run([join(String(dir), isWindows ? "plain.exe" : "plain"), "--bun-desktop-child=page", "a"], String(dir)),
    ).toMatchObject({
      stdout: "--bun-desktop-child=page,a\n",
      exitCode: 0,
    });
  });

  test.skipIf(!isLinux || isMusl || isASAN || isHardened || !Bun.which("curl"))(
    "an app does not report its crashes to Bun",
    async () => {
      using dir = project({ name: "notes" }, { "app.ts": `import { read } from "bun:ffi"; read.u8(8);` });
      let reports = 0;
      using server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => (reports++, new Response()) });
      // What sends the report has the pipe for errors too.
      const crash = async (executable: string) => {
        const cmd = ["/bin/sh", "-c", 'ulimit -c 0 && exec "$0"', join(String(dir), executable)];
        const { stderr } = await run(cmd, String(dir), { BUN_CRASH_REPORT_URL: server.url.origin });
        return [stderr.includes("Segmentation fault"), reports];
      };
      expect(await bun(dir, "build", "--compile", "--desktop", "app.ts")).toMatchObject({ exitCode: 0 });
      expect(await crash("notes.AppDir/usr/bin/notes")).toEqual([true, 0]);
      expect(await bun(dir, "build", "--compile", "app.ts", "--outfile=plain")).toMatchObject({ exitCode: 0 });
      expect(await crash("plain")).toEqual([true, 1]);
    },
  );

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

  test("follows links in resources, and stops at a cycle", async () => {
    using dir = project({ name: "notes", desktop: { resources: ["data"] } }, { "data/a": "a", "outside/b": "b" });
    symlinkSync("../outside", join(String(dir), "data/linked"), "dir");
    const args = ["build", "--compile", "--desktop", ...forMac, "app.ts"];
    expect(await bun(dir, ...args)).toMatchObject({ exitCode: 0 });
    expect(filesIn(join(String(dir), "notes.app/Contents/Resources/data"))).toEqual(["a", "linked/b"]);

    symlinkSync("../data", join(String(dir), "outside/back"), "dir");
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
