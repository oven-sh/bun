/**
 * A file: URL whose percent-decoded path is not UTF-8. "50%deposit.txt" is a file name. In a URL its
 * "%de" is an escape, and the byte DE alone is not UTF-8. Node converts the URL with
 * decodeURIComponent(), so each API that takes such a URL throws the error of that function:
 * https://github.com/nodejs/node/blob/v26.3.0/lib/internal/url.js#L1580-L1598
 *
 * This file uses node:test and node:assert, and nothing of Bun, so that `node --test` runs the same
 * file. The expected values are what Node v26.3.0 gives.
 */
import assert from "node:assert";
import cp, { ChildProcess } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import url, { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";

const isWindows = process.platform === "win32";
const requireHere = createRequire(import.meta.url);
// Bun on Windows: WTF decodes such a path with U+FFFD in it (oven-sh/WebKit#789), so the native
// conversion does not throw there. Node throws on each platform.
const nativeDecodeIsLenient = isWindows && typeof process.versions.bun === "string";

function isURIMalformed(err: any) {
  assert.strictEqual(err.name, "URIError");
  assert.strictEqual(err.message, "URI malformed");
  assert.strictEqual(err.code, undefined);
  assert.ok(err instanceof URIError);
  return true;
}

describe("url.fileURLToPath, a path that does not percent-decode to UTF-8", () => {
  // With no `windows` option the native conversion of the host runs.
  const optionsThatThrow = nativeDecodeIsLenient
    ? [{ windows: false }, { windows: true }]
    : [undefined, {}, { windows: false }, { windows: true }];

  const names: [string, string][] = [
    ["a lead byte and then an ASCII character", "50%deposit.db"],
    ["a Latin-1 byte", "caf%E9.db"],
    ["a sequence that ends too soon", "%c3"],
    ["a wrong continuation byte", "%c3%28"],
    ["a continuation byte alone", "%80"],
    ["a byte that UTF-8 never has", "%ff"],
    ["an overlong form", "%C0%80"],
    ["a surrogate", "%ED%A0%80"],
    ["a code point above U+10FFFF", "%F4%90%80%80"],
  ];
  for (const [what, name] of names) {
    test(`${what} throws URIError: ${name}`, () => {
      // A drive letter, so that the win32 rules reach the decode step too.
      const fileURL = "file:///C:/dir/" + name;
      for (const options of optionsThatThrow) {
        assert.throws(() => url.fileURLToPath(fileURL, options as any), isURIMalformed);
        assert.throws(() => url.fileURLToPath(new URL(fileURL), options as any), isURIMalformed);
      }
    });
  }

  test("the scheme, host and encoded separator checks come first", () => {
    assert.throws(() => url.fileURLToPath("https://example.com/%80"), { code: "ERR_INVALID_URL_SCHEME" });
    assert.throws(() => url.fileURLToPath("file:///C:/%80%2F"), { code: "ERR_INVALID_FILE_URL_PATH" });
    assert.throws(() => url.fileURLToPath("file://host/%80", { windows: false }), {
      code: "ERR_INVALID_FILE_URL_HOST",
    });
    // A UNC path: the host is not an error, so the decode step is reached.
    assert.throws(() => url.fileURLToPath("file://host/share/%80", { windows: true }), isURIMalformed);
    if (!isWindows) {
      assert.throws(() => url.fileURLToPath("file://host/%80"), { code: "ERR_INVALID_FILE_URL_HOST" });
    }
  });

  test("the state of the URL at the time of the call decides", { skip: nativeDecodeIsLenient }, () => {
    const fileURL = new URL("file:///C:/dir/ok.txt");
    const before = url.fileURLToPath(fileURL);
    fileURL.pathname = "/C:/dir/50%deposit.db";
    assert.throws(() => url.fileURLToPath(fileURL), isURIMalformed);
    fileURL.pathname = "/C:/dir/ok.txt";
    assert.strictEqual(url.fileURLToPath(fileURL), before);
  });

  test("escapes that are UTF-8 decode", () => {
    const decoded = [
      ["caf%C3%A9", "café"],
      ["%F0%9F%98%80", "😀"],
      ["%EF%BF%BD", "\uFFFD"],
      ["50%25deposit.db", "50%deposit.db"],
      ["a%20b", "a b"],
    ];
    for (const [escaped, name] of decoded) {
      assert.strictEqual(url.fileURLToPath("file:///C:/dir/" + escaped, { windows: false }), "/C:/dir/" + name);
      assert.strictEqual(url.fileURLToPath("file:///C:/dir/" + escaped, { windows: true }), "C:\\dir\\" + name);
      assert.strictEqual(
        url.fileURLToPath("file:///C:/dir/" + escaped),
        isWindows ? "C:\\dir\\" + name : "/C:/dir/" + name,
      );
    }
  });
});

describe("a file URL whose path does not percent-decode to UTF-8", { skip: nativeDecodeIsLenient }, () => {
  // A directory for each case, so that a call that does act on a path changes nothing else.
  // Not tempDir() of "harness": Node cannot import it.
  function fixture() {
    const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "undecodable-file-url-"));
    const other = path.join(root, "other.txt");
    fs.writeFileSync(other, "other");
    return {
      root,
      other,
      url: new URL("50%deposit.txt", pathToFileURL(root + path.sep)),
      dirURL: new URL("50%deposit/", pathToFileURL(root + path.sep)),
      expectUntouched() {
        assert.deepStrictEqual(fs.readdirSync(root), ["other.txt"]);
        assert.strictEqual(fs.readFileSync(other, "utf8"), "other");
      },
      remove: () => fs.rmSync(root, { recursive: true, force: true }),
    };
  }

  // What a call returns when it does not throw. The test fails then, and the handle must not outlive it:
  // a stream that opens "" emits its error into a later test.
  async function release(returned: any) {
    if (typeof returned === "number") fs.closeSync(returned);
    else if (returned instanceof fs.Dir) returned.closeSync();
    else if (returned instanceof ChildProcess) returned.kill();
    else if (typeof returned?.destroy === "function") returned.on("error", () => {}).destroy();
    else if (typeof returned?.stop === "function") returned.stop();
    else if (typeof returned?.terminate === "function") await returned.terminate();
    else if (typeof returned?.close === "function") await returned.close();
  }

  const sync: [string, (url: URL, other: string) => unknown][] = [
    ["fs.readFileSync", url => fs.readFileSync(url)],
    ["fs.writeFileSync", url => fs.writeFileSync(url, "")],
    ["fs.appendFileSync", url => fs.appendFileSync(url, "")],
    ["fs.statSync", url => fs.statSync(url)],
    ["fs.lstatSync", url => fs.lstatSync(url)],
    ["fs.accessSync", url => fs.accessSync(url)],
    ["fs.openSync", url => fs.openSync(url, "r")],
    ["fs.readdirSync", url => fs.readdirSync(url)],
    ["fs.opendirSync", url => fs.opendirSync(url)],
    ["fs.mkdirSync", url => fs.mkdirSync(url)],
    ["fs.rmSync", url => fs.rmSync(url)],
    ["fs.unlinkSync", url => fs.unlinkSync(url)],
    ["fs.realpathSync", url => fs.realpathSync(url)],
    ["fs.renameSync, the old path", (url, other) => fs.renameSync(url, other)],
    ["fs.renameSync, the new path", (url, other) => fs.renameSync(other, url)],
    ["fs.copyFileSync", (url, other) => fs.copyFileSync(url, other)],
    ["fs.cpSync, the source", (url, other) => fs.cpSync(url, other)],
    ["fs.cpSync, the destination", (url, other) => fs.cpSync(other, url)],
    ["fs.globSync, the cwd", url => fs.globSync("*", { cwd: url })],
    ["fs.createReadStream", url => fs.createReadStream(url)],
    ["fs.createWriteStream", url => fs.createWriteStream(url)],
    ["fs.watch", url => fs.watch(url)],
    ["fs.watchFile", url => fs.watchFile(url, () => {})],
    ["fs.unwatchFile", url => fs.unwatchFile(url)],
    ["fs.readFile with a callback", url => fs.readFile(url, () => {})],
    ["fs.stat with a callback", url => fs.stat(url, () => {})],
    ["fs.cp with a callback", (url, other) => fs.cp(url, other, () => {})],
    ["fs.glob with a callback", url => fs.glob("*", { cwd: url }, () => {})],
  ];
  for (const [name, call] of sync) {
    test(`${name} throws the URIError`, async () => {
      const files = fixture();
      let returned: unknown;
      try {
        assert.throws(() => {
          returned = call(files.url, files.other);
        }, isURIMalformed);
        files.expectUntouched();
      } finally {
        await release(returned);
        files.remove();
      }
    });
  }

  const asyncCalls: [string, (url: URL, other: string) => Promise<unknown>][] = [
    ["fs.promises.readFile", url => fs.promises.readFile(url)],
    ["fs.promises.writeFile", url => fs.promises.writeFile(url, "")],
    ["fs.promises.stat", url => fs.promises.stat(url)],
    ["fs.promises.open", url => fs.promises.open(url)],
    ["fs.promises.cp", (url, other) => fs.promises.cp(url, other)],
    ["fs.promises.glob, the cwd", url => Array.fromAsync(fs.promises.glob("*", { cwd: url }))],
  ];
  for (const [name, call] of asyncCalls) {
    test(`${name} rejects with the URIError`, async () => {
      const files = fixture();
      const returned = call(files.url, files.other);
      try {
        await assert.rejects(returned, isURIMalformed);
        files.expectUntouched();
      } finally {
        await release(await returned.catch(() => {}));
        files.remove();
      }
    });
  }

  test("fs.existsSync and fs.exists say false", async () => {
    const files = fixture();
    try {
      assert.strictEqual(fs.existsSync(files.url), false);
      const exists = await new Promise(resolve => fs.exists(files.url, resolve));
      assert.strictEqual(exists, false);
    } finally {
      files.remove();
    }
  });

  // With the path "" for it, the child runs in the directory of the parent. Node throws before it starts a child.
  const exe = process.execPath;
  const children: [string, (url: URL) => unknown][] = [
    ["child_process.spawn, the cwd", cwd => cp.spawn(exe, ["-e", "0"], { cwd })],
    ["child_process.spawnSync, the cwd", cwd => cp.spawnSync(exe, ["-e", "0"], { cwd })],
    ["child_process.exec, the cwd", cwd => cp.exec(`"${exe}" -e 0`, { cwd })],
    ["child_process.execSync, the cwd", cwd => cp.execSync(`"${exe}" -e 0`, { cwd, stdio: "ignore" })],
    ["child_process.execFile, the cwd", cwd => cp.execFile(exe, ["-e", "0"], { cwd })],
    ["child_process.execFileSync, the cwd", cwd => cp.execFileSync(exe, ["-e", "0"], { cwd, stdio: "ignore" })],
    ["child_process.fork, the cwd", cwd => cp.fork(path.join(os.tmpdir(), "never.js"), [], { cwd, stdio: "ignore" })],
    ["child_process.fork, the module", url => cp.fork(url, [], { stdio: "ignore" })],
    ["worker_threads.Worker", url => new Worker(url)],
  ];
  for (const [name, call] of children) {
    test(`${name} throws the URIError`, async () => {
      const files = fixture();
      let returned: unknown;
      try {
        assert.throws(() => {
          returned = call(name.endsWith("the cwd") ? files.dirURL : files.url);
        }, isURIMalformed);
      } finally {
        await release(returned);
        files.remove();
      }
    });
  }

  test("module.createRequire throws ERR_INVALID_ARG_VALUE", () => {
    const files = fixture();
    try {
      for (const filename of [files.url, files.url.href]) {
        assert.throws(
          () => createRequire(filename),
          (err: any) => {
            assert.strictEqual(err.name, "TypeError");
            assert.strictEqual(err.code, "ERR_INVALID_ARG_VALUE");
            assert.strictEqual(
              err.message.split(" Received")[0],
              "The argument 'filename' must be a file URL object, file URL string, or absolute path string.",
            );
            return true;
          },
        );
      }
    } finally {
      files.remove();
    }
  });

  test("import() rejects with the URIError, and the href and the importer are on it", async () => {
    const files = fixture();
    fs.writeFileSync(path.join(files.root, "50%deposit.txt"), "export {}");
    const { href } = files.url;
    // The same file, written with a host, with ".." and with a query.
    const spellings: [string, string][] = [
      [href, href],
      [href + "?v=1", href + "?v=1"],
      [href.replace("file:///", "file://localhost/").replace("50%deposit.txt", "a/../50%deposit.txt"), href],
    ];
    try {
      for (const [specifier, input] of spellings) {
        await assert.rejects(import(specifier), (err: any) => {
          isURIMalformed(err);
          assert.strictEqual(err.input, input);
          assert.strictEqual(err.module, import.meta.url);
          return true;
        });
      }
    } finally {
      files.remove();
    }
  });

  test("a static import rejects with the URIError, and the href and the importer are on it", async () => {
    const files = fixture();
    const importer = path.join(files.root, "importer.mjs");
    fs.writeFileSync(importer, `import ${JSON.stringify(files.url.href)};\n`);
    const importerURL = pathToFileURL(importer).href;
    try {
      await assert.rejects(import(importerURL), (err: any) => {
        isURIMalformed(err);
        assert.strictEqual(err.input, files.url.href);
        assert.strictEqual(err.module, importerURL);
        return true;
      });
    } finally {
      files.remove();
    }
  });

  test("require() and require.resolve() name the URL as it is written", () => {
    const files = fixture();
    fs.writeFileSync(path.join(files.root, "50%deposit.txt"), "");
    try {
      for (const load of [() => requireHere(files.url.href), () => requireHere.resolve(files.url.href)]) {
        assert.throws(load, (err: any) => {
          assert.strictEqual(err.code, "MODULE_NOT_FOUND");
          assert.strictEqual(err.message.split("\n")[0], `Cannot find module '${files.url.href}'`);
          return true;
        });
      }
    } finally {
      files.remove();
    }
  });
});
