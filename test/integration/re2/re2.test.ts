import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";

// node-re2 1.27.1 publishes prebuilds for linux-{x64,arm64} (glibc and musl),
// darwin-{x64,arm64} and win32-{x64,arm64} at ABI 147, the ABI Bun reports. Its
// install script downloads the one for this platform, or builds from source if
// the download fails. The addon is a NAN module over the V8 C++ API.
// https://github.com/oven-sh/bun/issues/48600
describe("re2", () => {
  test("the npm re2 addon loads and matches Node", async () => {
    using dir = tempDir("re2", {
      "package.json": JSON.stringify({
        name: "re2-fixture",
        version: "0.0.0",
        dependencies: { re2: "1.27.1" },
        trustedDependencies: ["re2"],
      }),
      "index.js": /* js */ `
        const RE2 = require("re2");
        const out = [];
        const log = (...args) => out.push(JSON.stringify(args));

        log(new RE2("(\\\\d+)").exec("abc 123"));
        const dated = new RE2("(?<y>\\\\d{4})-(?<m>\\\\d{2})", "g");
        log("2024-05 and 1999-12".replace(dated, "$2/$1"), dated.test("x 2020-01"), dated.lastIndex);
        dated.lastIndex = 0;
        log([..."2024-05 1999-12".matchAll(dated)].map(m => m.groups.y));
        log(new RE2(/a+/gi).flags, new RE2(/a\\/b/).source, new RE2(/x/dsmuy).flags, new RE2(new RegExp("")).source);
        try {
          new RE2("(a");
        } catch (e) {
          log(e.constructor.name, e.message);
        }
        log(RE2.unicodeWarningLevel);
        RE2.unicodeWarningLevel = "throw";
        log(RE2.unicodeWarningLevel);
        try {
          new RE2("a");
        } catch (e) {
          log(e.constructor.name);
        }
        RE2.unicodeWarningLevel = "nothing";
        const set = new RE2.Set(["^/users/\\\\d+$", "^/posts/\\\\d+$"]);
        log(set.match("/posts/42"), set.test("/nope"), set.size);
        log(
          new RE2("é+", "u").exec(Buffer.from("aééb")),
          new RE2("b").test(new Uint8Array([97, 98])),
          new RE2("b").test(new Uint8Array([97, 98]).buffer),
          new RE2("b").test(new SharedArrayBuffer(2)),
        );
        log(new RE2("1").test(1.5), new RE2("undefined").test(undefined), String(new RE2("x", "g")));
        log("aXbXc".split(new RE2("X")), "abc".search(new RE2("c")), "a1b22".replace(new RE2("\\\\d+", "g"), (m, i) => "[" + m + "@" + i + "]"));
        log(new RE2("(\\\\w)(\\\\d)?").exec("a").length, new RE2("(?<n>x)").exec("x").groups, Object.getPrototypeOf(new RE2("(?<n>x)").exec("x").groups));
        const big = "x".repeat(100000) + "needle";
        log(new RE2("needle").test(big), new RE2("needle").exec(big).index);
        log(RE2.getUtf8Length("héllo"), RE2.getUtf16Length(Buffer.from("héllo")));
        try {
          "a".replace(new RE2("a"), "b".repeat(2 ** 29));
        } catch (e) {
          log(e.constructor.name, e.message);
        }
        log(new RE2(new RE2("q", "i")).flags, new RE2("a", "g") instanceof RE2);
        // The same input twice: the addon caches its last input in two v8::Globals.
        const re = new RE2("b");
        const input = "abc";
        log(re.test(input), re.test(input), re.exec(input).index);
        console.log(out.join("\\n"));
      `,
    });

    {
      await using install = Bun.spawn({
        cmd: [bunExe(), "install"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([
        install.stdout.text(),
        install.stderr.text(),
        install.exited,
      ]);
      if (exitCode !== 0) {
        throw new Error(`bun install failed (exit ${exitCode})\nstdout:\n${stdout}\nstderr:\n${stderr}`);
      }
    }

    await using proc = Bun.spawn({
      cmd: [bunExe(), join(String(dir), "index.js")],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    // What Node 26.3.0 prints for the same script with the same prebuild.
    expect(stdout.trim().split("\n")).toEqual([
      '[["123","123"]]',
      '["05/2024 and 12/1999",true,9]',
      '[["2024","1999"]]',
      '["giu","a\\\\/b","dmsuy","(?:)"]',
      '["SyntaxError","missing ): (a"]',
      '["nothing"]',
      '["throw"]',
      '["SyntaxError"]',
      "[[1],false,2]",
      '[[{"type":"Buffer","data":[195,169,195,169]}],true,true,false]',
      '[true,true,"/x/gu"]',
      '[["a","b","c"],2,"a[1@1]b[22@3]"]',
      '[3,{"n":"x"},null]',
      "[true,100000]",
      "[6,5]",
      '["RangeError","Invalid string length"]',
      '["iu",true]',
      "[true,true,1]",
    ]);
    expect(exitCode).toBe(0);
  }, 600_000);
});
