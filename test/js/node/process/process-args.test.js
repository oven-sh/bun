import { spawn } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, withoutAggressiveGC } from "harness";
import { spawn as nodeSpawn } from "node:child_process";
import { join } from "path";
import { splitWindowsCommandLine } from "./windows-command-line";

const arg0 = process.argv[0];
const arg1 = join(import.meta.dir, "print-process-args.js");

async function run(args, isRun) {
  const exe = bunExe();

  const { stdout } = spawn([exe, ...(isRun ? ["run"] : []), arg1, ...args], {
    cwd: import.meta.dir,
    stderr: "inherit",
    stdin: "ignore",
    env: bunEnv,
  });
  return await new Response(stdout).json();
}
test("args exclude run", async () => {
  const fixture = [["-"], ["a"], ["a", "b"], ["a", "b", "c"], []];

  for (let i = 0; i < 10; i++) {
    const withRun = fixture.map(args => run(args, true));
    const withoutRun = fixture.map(args => run(args, false));

    const all = await Promise.all([...withRun, ...withoutRun]);
    withoutAggressiveGC(() => {
      for (let i = 0; i < fixture.length; i++) {
        expect(all[i]).toEqual([arg0, arg1, ...fixture[i]]);
      }
    });
    console.count("Run");
  }
});

// Whatever goes into Bun.spawn's argv array must come out of the child's
// process.argv unchanged: this exercises the parent's Windows command-line
// quoting and the child's splitting together (and plain execve elsewhere).
// https://github.com/oven-sh/bun/issues/11610 was the non-ASCII case.
describe("argv round-trips through spawn", () => {
  const cases = {
    "non-ASCII": ["🌊 测试", "äöü", "日本語", "Ω≈ç√", "עברית", "e\u0301", "a\u00a0b", "x\u3000y", "\ufeffbom"],
    "quotes and backslashes": [
      'q"uote',
      '"quoted"',
      '""',
      'a""b',
      "back\\slash",
      "trail\\",
      "trail\\\\",
      '\\"',
      '\\\\"',
      "C:\\Program Files\\x\\",
      "\\\\server\\share\\",
    ],
    "whitespace and empties": ["", " ", "  two  spaces  ", "tab\there", "new\nline", "cr\r\nlf", "", "last"],
    // (a `--` directly after the script is consumed by the CLI, so it is not first here)
    "things that look like flags after the script": [
      "-e",
      "console.log(1)",
      "--inspect",
      "--",
      "-p",
      "run",
      "-",
      "--version",
    ],
    "nothing is expanded": ["%PATH%", "$HOME", "~", "*.*", "`echo x`", "$(echo x)", "!VAR!", "^&|<>()", "a;b", "%"],
  };
  for (const [name, args] of Object.entries(cases)) {
    test(name, async () => {
      const [plain, withRun] = await Promise.all([run(args, false), run(args, true)]);
      expect(plain).toEqual([arg0, arg1, ...args]);
      expect(withRun).toEqual([arg0, arg1, ...args]);
    });
  }
  test("long and many", async () => {
    const long = Buffer.alloc(8192, "L").toString() + '" \\';
    const many = Array.from({ length: 300 }, (_, i) => (i % 3 === 0 ? `a${i}` : i % 3 === 1 ? `"${i}"` : `${i}\\`));
    expect(await run([long, ...many], false)).toEqual([arg0, arg1, long, ...many]);
  });
});

// On Windows the child receives one UTF-16 string and splits it itself. Bun
// follows the C runtime's rules (what `wmain`, and therefore node, sees). These
// launch raw command lines — no re-quoting by the parent — and compare against
// both spelled-out expectations and a reference implementation of those rules.
describe.skipIf(!isWindows)("Windows command line splitting follows the C runtime", () => {
  // Verbatim mode joins argv0 and the args with single spaces and no quoting, so
  // quote the exe path ourselves (via argv0) the same way the script path is.
  function runVerbatim(tail) {
    return new Promise((resolve, reject) => {
      const child = nodeSpawn(bunExe(), [`"${arg1}"${tail}`], {
        argv0: `"${bunExe()}"`,
        env: bunEnv,
        stdio: ["ignore", "pipe", "inherit"],
        windowsVerbatimArguments: true,
      });
      let out = "";
      child.stdout.setEncoding("utf8").on("data", d => (out += d));
      child.on("error", reject);
      child.on("close", code => {
        let argv;
        try {
          argv = JSON.parse(out).slice(2);
        } catch {
          return reject(
            new Error(`child exited ${code} and printed ${JSON.stringify(out)} for tail ${JSON.stringify(tail)}`),
          );
        }
        if (code !== 0) return reject(new Error(`child exited ${code} for tail ${JSON.stringify(tail)}`));
        resolve(argv);
      });
    });
  }
  const expected = tail => splitWindowsCommandLine(`bun.exe "${arg1}"${tail}`).slice(2);

  // [raw tail appended after `"<script>"`, expected argv]
  const table = [
    [` a b  c`, ["a", "b", "c"]],
    [`\ta\t\tb \t c\t`, ["a", "b", "c"]],
    [` "a b" c`, ["a b", "c"]],
    [` "a b"c d`, ["a bc", "d"]],
    [` a"b c"d e`, ["ab cd", "e"]],
    [` "" a`, ["", "a"]],
    [` """" a`, ['"', "a"]],
    [` "a"" b" c`, ['a" b', "c"]],
    [` "a""" b`, ['a"', "b"]],
    [` f""g h`, ["fg", "h"]],
    [` a\\b c`, ["a\\b", "c"]],
    [` a\\"b c`, ['a"b', "c"]],
    [` a\\\\"b c" d`, ["a\\b c", "d"]],
    [` a\\\\\\"b c`, ['a\\"b', "c"]],
    [` "a\\" b" c`, ['a" b', "c"]],
    [` "C:\\dir\\" next`, ['C:\\dir" next']],
    [` "C:\\dir\\\\" next`, ["C:\\dir\\", "next"]],
    [` C:\\dir\\ next`, ["C:\\dir\\", "next"]],
    [` \\\\server\\share\\ x`, ["\\\\server\\share\\", "x"]],
    [` \\ "\\\\" \\\\\\`, ["\\", "\\", "\\\\\\"]],
    [` "unterminated`, ["unterminated"]],
    [` "unterminated \\"`, ['unterminated "']],
    [` "new\nline" x`, ["new\nline", "x"]],
    [` a\nb`, ["a\nb"]],
    [` a\u00a0b x\u3000y`, ["a\u00a0b", "x\u3000y"]],
    [` 🌊 "測 試" ä`, ["🌊", "測 試", "ä"]],
    [` --flag="with spaces" -e "a \\"q\\""`, ["--flag=with spaces", "-e", 'a "q"']],
    [` %PATH% $HOME ^& "|"`, ["%PATH%", "$HOME", "^&", "|"]],
    [` `, []],
    [``, []],
    [` "`, [""]],
    [` \\"`, ['"']],
  ];

  test("curated command lines", async () => {
    for (const [tail, want] of table) expect(expected(tail)).toEqual(want); // pins the reference itself
    const got = await Promise.all(table.map(([tail]) => runVerbatim(tail)));
    for (let i = 0; i < table.length; i++) expect(got[i], `tail ${JSON.stringify(table[i][0])}`).toEqual(table[i][1]);
  });

  test("generated command lines", async () => {
    // Deterministic generator over the characters the rules care about.
    let seed = 0x9e3779b9;
    const next = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
    const pick = s => s[Math.floor(next() * s.length)];
    const alphabet = [
      '"',
      '"',
      "\\",
      "\\",
      " ",
      "\t",
      "a",
      "b",
      "Z",
      "9",
      "=",
      "-",
      ".",
      "ä",
      "測",
      "🌊",
      "\u00a0",
      "\n",
    ];
    const tails = [];
    for (let c = 0; c < 40; c++) {
      let tail = "";
      const parts = 1 + Math.floor(next() * 5);
      for (let p = 0; p < parts; p++) {
        tail += pick([" ", "  ", "\t", " \t"]);
        const len = Math.floor(next() * 10);
        let tok = "";
        for (let k = 0; k < len; k++) tok += pick(alphabet);
        tail += next() < 0.3 ? `"${tok}${next() < 0.8 ? '"' : ""}` : tok;
      }
      tails.push(tail);
    }
    const got = await Promise.all(tails.map(runVerbatim));
    for (let i = 0; i < tails.length; i++)
      expect(got[i], `tail ${JSON.stringify(tails[i])}`).toEqual(expected(tails[i]));
  });
});
