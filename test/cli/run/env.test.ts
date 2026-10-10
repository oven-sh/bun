import { beforeAll, describe, expect, test } from "bun:test";
import fs from "fs";
import {
  bunEnv,
  bunExe,
  bunRun,
  bunRunAsScript,
  bunTest,
  isASAN,
  isDebug,
  isLinux,
  isWindows,
  tempDir,
  tempDirWithFiles,
} from "harness";
import { mkfifo } from "mkfifo";
import { parseEnv } from "node:util";
import path from "path";

function bunRunWithoutTrim(file: string, env?: Record<string, string>) {
  const result = Bun.spawnSync([bunExe(), file], {
    cwd: path.dirname(file),
    env: {
      ...bunEnv,
      NODE_ENV: undefined,
      ...env,
    },
  });
  if (!result.success) throw new Error(result.stderr.toString("utf8"));
  return {
    stdout: result.stdout.toString("utf8"),
    stderr: result.stderr.toString("utf8").trim(),
  };
}

describe.concurrent(".env file is loaded", () => {
  test(".env", async () => {
    using dir = tempDir("dotenv", {
      ".env": "FOO=bar\n",
      "index.ts": "console.log(process.env.FOO);",
    });
    const { stdout } = await bunRun(`${dir}/index.ts`);
    expect(stdout).toBe("bar");
  });
  test(".env.local", async () => {
    using dir = tempDir("dotenv", {
      ".env": "FOO=fail\nBAR=baz\n",
      ".env.local": "FOO=bar\n",
      "index.ts": "console.log(process.env.FOO, process.env.BAR);",
    });
    const { stdout } = await bunRun(`${dir}/index.ts`);
    expect(stdout).toBe("bar baz");
  });
  test(".env.development (NODE_ENV=undefined)", async () => {
    using dir = tempDir("dotenv", {
      ".env": "FOO=fail\nBAR=baz\n",
      ".env.development": "FOO=bar\n",
      ".env.local": "LOCAL=true\n",
      "index.ts": "console.log(process.env.NODE_ENV, process.env.FOO, process.env.BAR, process.env.LOCAL);",
    });
    const { stdout } = await bunRun(`${dir}/index.ts`);
    expect(stdout).toBe("undefined bar baz true");
  });
  test(".env.development (NODE_ENV=development)", async () => {
    using dir = tempDir("dotenv", {
      ".env": "FOO=fail\nBAR=baz\n",
      ".env.development": "FOO=bar\n",
      ".env.local": "LOCAL=true\n",
      "index.ts": "console.log(process.env.FOO, process.env.BAR, process.env.LOCAL);",
    });
    const { stdout } = await bunRun(`${dir}/index.ts`);
    expect(stdout).toBe("bar baz true");
  });
  test(".env.production", async () => {
    using dir = tempDir("dotenv", {
      ".env": "FOO=fail\nBAR=baz\n",
      ".env.production": "FOO=bar\n",
      ".env.local": "LOCAL=true\n",
      "index.ts": "console.log(process.env.FOO, process.env.BAR, process.env.LOCAL);",
    });
    const { stdout } = await bunRun(`${dir}/index.ts`, { NODE_ENV: "production" });
    expect(stdout).toBe("bar baz true");
  });
  test(".env.development and .env.test ignored when NODE_ENV=production", async () => {
    using dir = tempDir("dotenv", {
      ".env": "FOO=bar\nBAR=baz\n",
      ".env.development": "FOO=development\n",
      ".env.development.local": "FOO=development.local\n",
      ".env.test": "FOO=test\n",
      ".env.test.local": "FOO=test.local\n",
      ".env.local": "LOCAL=true\n",
      "index.ts": "console.log(process.env.FOO, process.env.BAR, process.env.LOCAL);",
    });
    const { stdout } = await bunRun(`${dir}/index.ts`, { NODE_ENV: "production" });
    expect(stdout).toBe("bar baz true");
  });
  test(".env.production and .env.test ignored when NODE_ENV=development", async () => {
    using dir = tempDir("dotenv", {
      ".env": "FOO=bar\nBAR=baz\n",
      ".env.production": "FOO=production\n",
      ".env.production.local": "FOO=production.local\n",
      ".env.test": "FOO=test\n",
      ".env.test.local": "FOO=test.local\n",
      ".env.local": "LOCAL=true\n",
      "index.ts": "console.log(process.env.FOO, process.env.BAR, process.env.LOCAL);",
    });
    const { stdout } = await bunRun(`${dir}/index.ts`, {});
    expect(stdout).toBe("bar baz true");
  });
  test(".env and .env.test used in testing", () => {
    using dir = tempDir("dotenv", {
      ".env": "A=a\n",
      ".env.test.local": "B=b\n",
      ".env.test": "C=c\n",
      ".env.development": "FAIL=.env.development\n",
      ".env.development.local": "FAIL=.env.development.local\n",
      ".env.production": "FAIL=.env.production\n",
      ".env.production.local": "FAIL=.env.production.local\n",
      "index.test.ts": "console.log(process.env.A,process.env.B,process.env.C,process.env.FAIL);",
    });
    const { stdout } = bunTest(`${dir}/index.test.ts`, {});
    expect(stdout).toBe(`bun test ${Bun.version_with_sha}\n` + "a b c undefined");
  });
  test(".env.local ignored when bun test", () => {
    using dir = tempDir("dotenv", {
      ".env": "FAILED=false\n",
      ".env.local": "FAILED=true\n",
      "index.test.ts": "console.log(process.env.FAILED);",
    });
    const { stdout } = bunTest(`${dir}/index.test.ts`, {});
    expect(stdout).toBe(`bun test ${Bun.version_with_sha}\n` + "false");
  });
  test(".env.development and .env.production ignored when bun test", () => {
    using dir = tempDir("dotenv", {
      ".env": "FAILED=false\n",
      ".env.development": "FAILED=development\n",
      ".env.development.local": "FAILED=development.local\n",
      ".env.production": "FAILED=production\n",
      ".env.production.local": "FAILED=production.local\n",
      "index.test.ts": "console.log(process.env.FAILED);",
    });
    const { stdout } = bunTest(`${dir}/index.test.ts`);
    expect(stdout).toBe(`bun test ${Bun.version_with_sha}\n` + "false");
  });
  test("NODE_ENV is automatically set to test within bun test", () => {
    using dir = tempDir("dotenv", {
      "index.test.ts": "console.log(process.env.NODE_ENV);",
    });
    const { stdout } = bunTest(`${dir}/index.test.ts`);
    expect(stdout).toBe(`bun test ${Bun.version_with_sha}\n` + "test");
  });
});
describe.concurrent("dotenv priority", () => {
  test("process env overrides everything else", async () => {
    using dir = tempDir("dotenv", {
      ".env": "FOO=.env\n",
      ".env.development": "FOO=.env.development\n",
      ".env.development.local": "FOO=.env.development.local\n",
      ".env.production": "FOO=.env.production\n",
      ".env.production.local": "FOO=.env.production.local\n",
      ".env.test.local": "FOO=.env.test.local\n",
      ".env.test": "FOO=.env.test\n",
      ".env.local": "FOO=.env.local\n",
      "index.ts": "console.log(process.env.FOO);",
      "index.test.ts": "console.log(process.env.FOO);",
    });
    const { stdout } = await bunRun(`${dir}/index.ts`, { FOO: "override" });
    expect(stdout).toBe("override");

    const { stdout: stdout2 } = bunTest(`${dir}/index.test.ts`, { FOO: "override" });
    expect(stdout2).toBe(`bun test ${Bun.version_with_sha}\n` + "override");
  });
  test(".env.{NODE_ENV}.local overrides .env.local", async () => {
    using dir = tempDir("dotenv", {
      ".env": "FOO=.env\n",
      ".env.development": "FOO=.env.development\n",
      ".env.development.local": "FOO=.env.development.local\n",
      ".env.production": "FOO=.env.production\n",
      ".env.production.local": "FOO=.env.production.local\n",
      ".env.test.local": "FOO=.env.test.local\n",
      ".env.test": "FOO=.env.test\n",
      ".env.local": "FOO=.env.local\n",
      "index.ts": "console.log(process.env.FOO);",
      "index.test.ts": "console.log(process.env.FOO);",
    });
    const { stdout: stdout_dev } = await bunRun(`${dir}/index.ts`, { NODE_ENV: "development" });
    expect(stdout_dev).toBe(".env.development.local");
    const { stdout: stdout_prod } = await bunRun(`${dir}/index.ts`, { NODE_ENV: "production" });
    expect(stdout_prod).toBe(".env.production.local");
    const { stdout: stdout_test } = bunTest(`${dir}/index.test.ts`, {});
    expect(stdout_test).toBe(`bun test ${Bun.version_with_sha}\n` + ".env.test.local");
  });
  test(".env.local overrides .env.{NODE_ENV}", async () => {
    using dir = tempDir("dotenv", {
      ".env": "FOO=.env\n",
      ".env.development": "FOO=.env.development\n",
      ".env.production": "FOO=.env.production\n",
      ".env.test": "FOO=.env.test\n",
      ".env.local": "FOO=.env.local\n",
      "index.ts": "console.log(process.env.FOO);",
      "index.test.ts": "console.log(process.env.FOO);",
    });
    const { stdout: stdout_dev } = await bunRun(`${dir}/index.ts`, { NODE_ENV: "development" });
    expect(stdout_dev).toBe(".env.local");
    const { stdout: stdout_prod } = await bunRun(`${dir}/index.ts`, { NODE_ENV: "production" });
    expect(stdout_prod).toBe(".env.local");
    // .env.local is "not checked when `NODE_ENV` is `test`"
    const { stdout: stdout_test } = bunTest(`${dir}/index.test.ts`, {});
    expect(stdout_test).toBe(`bun test ${Bun.version_with_sha}\n` + ".env.test");
  });
  test(".env.{NODE_ENV} overrides .env", async () => {
    using dir = tempDir("dotenv", {
      ".env": "FOO=.env\n",
      ".env.development": "FOO=.env.development\n",
      ".env.production": "FOO=.env.production\n",
      ".env.test": "FOO=.env.test\n",
      "index.ts": "console.log(process.env.FOO);",
      "index.test.ts": "console.log(process.env.FOO);",
    });
    const { stdout: stdout_dev } = await bunRun(`${dir}/index.ts`, { NODE_ENV: "development" });
    expect(stdout_dev).toBe(".env.development");
    const { stdout: stdout_prod } = await bunRun(`${dir}/index.ts`, { NODE_ENV: "production" });
    expect(stdout_prod).toBe(".env.production");
    const { stdout: stdout_test } = bunTest(`${dir}/index.test.ts`, {});
    expect(stdout_test).toBe(`bun test ${Bun.version_with_sha}\n` + ".env.test");
  });
});

test.concurrent(".env colon assign", async () => {
  using dir = tempDir("dotenv-colon", {
    ".env": "FOO: foo",
    "index.ts": "console.log(process.env.FOO);",
  });
  const { stdout } = await bunRun(`${dir}/index.ts`);
  expect(stdout).toBe("foo");
});

test.concurrent(".env export assign", async () => {
  using dir = tempDir("dotenv-export", {
    ".env": "export FOO = foo\nexport = bar",
    "index.ts": "console.log(process.env.FOO, process.env.export);",
  });
  const { stdout } = await bunRun(`${dir}/index.ts`);
  expect(stdout).toBe("foo bar");
});

test.concurrent(".env value expansion", async () => {
  using dir = tempDir("dotenv-expand", {
    ".env": "FOO=foo\nBAR=$FOO bar\nMOO=${FOO} ${BAR:-fail} ${MOZ:-moo}",
    "index.ts": "console.log([process.env.FOO, process.env.BAR, process.env.MOO].join('|'));",
  });
  const { stdout } = await bunRun(`${dir}/index.ts`);
  expect(stdout).toBe("foo|foo bar|foo foo bar moo");
});

test(".env ${VAR:-default} with nested references (issue #32411)", async () => {
  // https://github.com/oven-sh/bun/issues/32411
  // `${` pairs with its matching `}` by depth and the `:-` default is expanded
  // recursively; malformed forms (unterminated, non-`:-`) fall through as literals.
  using dir = tempDir("dotenv-expand-nested", {
    ".env": [
      "NSTD_FALLBACK=localhost",
      "NSTD_SET=hi",
      "NSTD_HOST=${NSTD_UNSET:-${NSTD_FALLBACK}}",
      "NSTD_EMPTY=${NSTD_UNSET:-${NSTD_ALSO_UNSET}}",
      "NSTD_DEEP=${NSTD_UNSET:-${NSTD_ALSO_UNSET:-c}}",
      "NSTD_PREFIX=${NSTD_UNSET:-x${NSTD_ALSO_UNSET}}",
      'NSTD_QUOTED="${NSTD_UNSET:-${NSTD_ALSO_UNSET:-${NSTD_FALLBACK}}}suffix"',
      "NSTD_SET_WINS=${NSTD_SET:-${NSTD_ALSO_UNSET}}",
      "NSTD_BARE=${NSTD_UNSET:-$NSTD_FALLBACK}",
      "NSTD_DOLLAR=${NSTD_UNSET:-$}",
      "NSTD_DUBL=$${NSTD_UNSET:-${NSTD_FALLBACK}}",
      "NSTD_NOKEY=${:-${NSTD_FALLBACK}}",
      "NSTD_AROUND=pre${NSTD_UNSET:-$NSTD_FALLBACK}post",
      "NSTD_TWO=${NSTD_FALLBACK}${NSTD_UNSET:-$NSTD_FALLBACK}",
      "NSTD_PATH=$NSTD_FALLBACK/${NSTD_UNSET:-$NSTD_FALLBACK}/x",
      "NSTD_UNTERM=${NSTD_UNSET:-${",
      "NSTD_UNTERM2=${NSTD_UNSET",
      "NSTD_BSLASH=${NSTD_UNSET:-a\\b}",
      "NSTD_DASH=${NSTD_UNSET-${NSTD_FALLBACK}}",
    ].join("\n"),
    "index.ts":
      "const keys = process.argv.slice(2);" +
      "const out = {};" +
      "for (const k of keys) out[k] = process.env[k];" +
      "console.log(JSON.stringify(out));",
  });
  const keys = [
    "NSTD_HOST",
    "NSTD_EMPTY",
    "NSTD_DEEP",
    "NSTD_PREFIX",
    "NSTD_QUOTED",
    "NSTD_SET_WINS",
    "NSTD_BARE",
    "NSTD_DOLLAR",
    "NSTD_DUBL",
    "NSTD_NOKEY",
    "NSTD_AROUND",
    "NSTD_TWO",
    "NSTD_PATH",
    "NSTD_UNTERM",
    "NSTD_UNTERM2",
    "NSTD_BSLASH",
    "NSTD_DASH",
  ];
  const result = Bun.spawnSync([bunExe(), `${dir}/index.ts`, ...keys], {
    cwd: String(dir),
    env: { ...bunEnv, NODE_ENV: undefined },
  });
  const stdout = result.stdout.toString("utf8").trim();
  expect(stdout).toStartWith("{");
  expect(JSON.parse(stdout)).toEqual({
    NSTD_HOST: "localhost",
    NSTD_EMPTY: "",
    NSTD_DEEP: "c",
    NSTD_PREFIX: "x",
    NSTD_QUOTED: "localhostsuffix",
    NSTD_SET_WINS: "hi",
    NSTD_BARE: "localhost",
    NSTD_DOLLAR: "$",
    NSTD_DUBL: "$localhost",
    NSTD_NOKEY: "localhost",
    NSTD_AROUND: "prelocalhostpost",
    NSTD_TWO: "localhostlocalhost",
    NSTD_PATH: "localhost/localhost/x",
    NSTD_UNTERM: "${NSTD_UNSET:-${",
    NSTD_UNTERM2: "${NSTD_UNSET",
    NSTD_BSLASH: "a\\b",
    NSTD_DASH: "${NSTD_UNSET-${NSTD_FALLBACK}}",
  });
  expect(result.exitCode).toBe(0);
});

test.concurrent(".env comments", async () => {
  using dir = tempDir("dotenv-comments", {
    ".env": "#FOZ\nFOO = foo#FAIL\nBAR='bar' #BAZ",
    "index.ts": "console.log(process.env.FOO, process.env.BAR);",
  });
  const { stdout } = await bunRun(`${dir}/index.ts`);
  expect(stdout).toBe("foo bar");
});

test.concurrent(".env process variables no comments", async () => {
  using dir = tempDir("env-no-comments", {
    "index.ts": "console.log(process.env.TEST1, process.env.TEST2);",
  });
  const { stdout } = await bunRun(`${dir}/index.ts`, { TEST1: "test#1", TEST2: '"test#2"' });
  expect(stdout).toBe('test#1 "test#2"');
});

describe("package scripts load from .env.production and .env.development", () => {
  test("NODE_ENV=production", () => {
    const pkgjson = {
      "name": "foo",
      "version": "2.0",
      "scripts": {
        "test": `'${bunExe()}' run index.ts`,
      },
    };
    using dir = tempDir("dotenv-package-script-prod", {
      "index.ts": "console.log(process.env.TEST);",
      "package.json": JSON.stringify(pkgjson),
      ".env.production": "TEST=prod",
      ".env.development": "TEST=dev",
    });

    const { stdout } = bunRunAsScript(dir, "test", { "NODE_ENV": "production" });
    expect(stdout).toBe("prod");
  });
  test("NODE_ENV=development", () => {
    const pkgjson = {
      "name": "foo",
      "version": "2.0",
      "scripts": {
        "test": `'${bunExe()}' run index.ts`,
      },
    };
    using dir = tempDir("dotenv-package-script-prod", {
      "index.ts": "console.log(process.env.TEST);",
      "package.json": JSON.stringify(pkgjson),
      ".env.production": "TEST=prod",
      ".env.development": "TEST=dev",
    });

    const { stdout } = bunRunAsScript(dir, "test", { "NODE_ENV": "development" });
    expect(stdout).toBe("dev");
  });
});

test.concurrent(".env escaped dollar sign", async () => {
  using dir = tempDir("dotenv-dollar", {
    ".env": "FOO=foo\nBAR=\\$FOO",
    "index.ts": "console.log(process.env.FOO, process.env.BAR);",
  });
  const { stdout } = await bunRun(`${dir}/index.ts`);
  expect(stdout).toBe("foo $FOO");
});

test.concurrent(".env leaves $ literal when not followed by an identifier (issue #4994)", async () => {
  // https://github.com/oven-sh/bun/issues/4994
  // Expansion only fires on `$IDENT` (letter or underscore start) or `${...}`.
  // A `$` followed by a digit, another `$`, `(`, `-`, or the end of the value
  // stays literal, inside and outside quotes and inside a `:-` default.
  const expected = {
    ISSUE: "123$567",
    P1: "price$5.00",
    P2: "a$(b)c",
    P3: "cost$-1",
    P4: "$1abc",
    P5: "end$",
    P6: "pa$$",
    P7: "$5.00",
    P8: "hit$5",
    P9: "hit$5",
    P10: "$5",
    P11: "123$567",
    P12: "123$567",
  };
  using dir = tempDir("dotenv-literal-dollar", {
    ".env": [
      "ISSUE=123$567",
      "P1=price$5.00",
      "P2=a$(b)c",
      "P3=cost$-1",
      "P4=$1abc",
      "P5=end$",
      "P6=pa$$",
      "P7=\\$5.00",
      "SET=hit",
      "P8=$SET$5",
      "P9=${SET}$5",
      "P10=${UNSET:-$5}",
      'P11="123$567"',
      "P12='123$567'",
    ].join("\n"),
    "index.ts":
      `const keys = ${JSON.stringify(Object.keys(expected))};` +
      "const out = {};" +
      "for (const k of keys) out[k] = process.env[k];" +
      "console.log(JSON.stringify(out));",
  });
  const { stdout } = await bunRun(`${dir}/index.ts`);
  expect(JSON.parse(stdout)).toEqual(expected);
});

test.concurrent(".env doesnt crash with 159 bytes", async () => {
  using dir = tempDir("dotenv-159", {
    ".env":
      "123456789=1234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678" +
      "\n",
    "index.ts": "console.log(process.env['123456789']);",
    "package.json": `{
      "name": "foo",
      "devDependencies": {
        "conditional-type-checks": "1.0.6",
        "prettier": "2.8.8",
        "tsd": "0.22.0",
        "typescript": "5.0.4"
      }
    }`,
  });

  const { stdout } = await bunRun(`${dir}/index.ts`);
  expect(stdout.trim()).toBe(
    `1234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678`,
  );
});

test.concurrent(
  ".env with 50000 entries",
  async () => {
    using dir = tempDir("dotenv-many-entries", {
      ".env": new Array(50000)
        .fill(null)
        .map((_, i) => `TEST_VAR${i}=TEST_VAL${i}`)
        .join("\n"),
      "index.ts": /* ts */ `
      for (let i = 0; i < 50000; i++) {
        if(process.env['TEST_VAR' + i] !== 'TEST_VAL' + i) {
          throw new Error('TEST_VAR' + i + ' !== TEST_VAL' + i);
        }
      }
      console.log('OK');
    `,
    });
    const { stdout } = await bunRun(`${dir}/index.ts`);
    expect(stdout).toBe("OK");
  },
  // The spawned debug+ASAN child alone needs ~8s for this; the default 5s
  // budget only fits release-ish builds.
  isDebug ? 90_000 : 5_000,
);

test.concurrent(".env space edgecase (issue #411)", async () => {
  using dir = tempDir("dotenv-issue-411", {
    ".env": "VARNAME=A B",
    "index.ts": "console.log('[' + process.env.VARNAME + ']');",
  });
  const { stdout } = await bunRun(`${dir}/index.ts`);
  expect(stdout).toBe("[A B]");
});

test.concurrent(".env does not byte-trim 0xA0 out of UTF-8 values", async () => {
  // U+0920 DEVANAGARI LETTER TTHA encodes as E0 A4 A0 (trailing 0xA0)
  // U+00A0 NO-BREAK SPACE encodes as C2 A0; Node.js preserves it verbatim.
  expect(parseEnv("A=x\u0920\nB=\u00A0x\u00A0\nC=\u00A0\nD=  x  \n")).toEqual({
    A: "x\u0920",
    B: "\u00A0x\u00A0",
    C: "\u00A0",
    D: "x",
  });

  using dir = tempDir("dotenv-utf8-nbsp", {
    ".env": "A=x\u0920\nB=\u00A0x\u00A0\n",
    "index.ts": "console.log(JSON.stringify({ A: process.env.A, B: process.env.B }));",
  });
  const { stdout } = await bunRun(`${dir}/index.ts`);
  expect(JSON.parse(stdout)).toEqual({ A: "x\u0920", B: "\u00A0x\u00A0" });
});

test.concurrent(".env special characters 1 (issue #2823)", async () => {
  using dir = tempDir("dotenv-issue-2823", {
    ".env": 'A="a$t"\nC=`c\\$v`',
    "index.ts": "console.log('[' + process.env.A + ']', '[' + process.env.C + ']');",
  });
  const { stdout } = await bunRun(`${dir}/index.ts`);
  expect(stdout).toBe("[a] [c$v]");
});

test.concurrent("env escaped quote (issue #2484)", async () => {
  using dir = tempDir("env-issue-2484", {
    "index.ts": "console.log(process.env.VALUE, process.env.VALUE2);",
  });
  const { stdout } = await bunRun(`${dir}/index.ts`, { VALUE: `\\"`, VALUE2: `\\\\"` });
  expect(stdout).toBe('\\" \\\\"');
});

test.concurrent(".env Windows-style newline (issue #3042)", async () => {
  using dir = tempDir("dotenv-issue-3042", {
    ".env": "FOO=\rBAR='bar\r\rbaz'\r\nMOO=moo\r",
    "index.ts": "console.log([process.env.FOO, process.env.BAR, process.env.MOO].join('|'));",
  });
  const { stdout } = await bunRun(`${dir}/index.ts`);
  expect(stdout).toBe("|bar\n\nbaz|moo");
});

test.concurrent(".env with zero length strings", async () => {
  using dir = tempDir("dotenv-issue-zerolength", {
    ".env": "FOO=''\n",
    "index.ts":
      "function i(a){return a}\nconsole.log([process.env.FOO,i(process.env).FOO,process.env.FOO.length,i(process.env).FOO.length].join('|'));",
  });
  const { stdout } = await bunRun(`${dir}/index.ts`);
  expect(stdout).toBe("||0|0");
});

test.concurrent("process with zero length environment variable", async () => {
  using dir = tempDir("process-issue-zerolength", {
    "index.ts": "console.log(`'${process.env.TEST_ENV_VAR}'`);",
  });
  const { stdout } = await bunRun(`${dir}/index.ts`, {
    TEST_ENV_VAR: "",
  });
  expect(stdout).toBe("''");
});

test.concurrent(".env in a folder doesn't throw an error", async () => {
  using dir = tempDir("dotenv-issue-3670", {
    ".env": {
      ".env.local": "FOO=''\n",
    },
    "index.ts": "console.write('hey')",
    "package.json": '{ "name": ' + '"test"' + " }",
  });
  const { stdout } = await bunRun(`${dir}/index.ts`);
  expect(stdout).toBe("hey");
});

test.concurrent("#3911", async () => {
  using dir = tempDir("dotenv", {
    ".env": 'KEY="a\\nb"',
    "index.ts": "console.log(process.env.KEY);",
  });
  const { stdout } = await bunRun(`${dir}/index.ts`);
  expect(stdout).toBe("a\nb");
});

describe.concurrent(".env quoted value with trailing junk does not swallow following lines", () => {
  describe.each([
    ["double", `"`],
    ["single", `'`],
    ["backtick", "`"],
  ])("%s quotes", (_, q) => {
    test("util.parseEnv", () => {
      expect(parseEnv(`A=${q}hello${q} junk\nB=${q}x${q}\nC=3\n`)).toEqual({
        A: "hello",
        B: "x",
        C: "3",
      });
      expect(parseEnv(`A=${q}hello${q} junk\r\nB=${q}x${q}\r\nC=3\r\n`)).toEqual({
        A: "hello",
        B: "x",
        C: "3",
      });
      expect(parseEnv(`A=${q}${q} junk\nB=2\n`)).toEqual({ A: "", B: "2" });
      expect(parseEnv(`A=${q}hello\nworld${q} junk\nB=2\n`)).toEqual({
        A: "hello\nworld",
        B: "2",
      });
      expect(parseEnv(`A=${q}hello${q} # comment\nB=2\n`)).toEqual({ A: "hello", B: "2" });
      expect(parseEnv(`A=${q}hello${q}junk\nB=2\n`)).toEqual({ A: "hello", B: "2" });
    });

    test(".env file", async () => {
      using dir = tempDir("dotenv-trailing-junk", {
        ".env": `A=${q}hello${q} junk\nB=${q}x${q}\nC=3\n`,
        "index.ts": "console.log(JSON.stringify({A: process.env.A, B: process.env.B, C: process.env.C}));",
      });
      const { stdout } = await bunRun(`${dir}/index.ts`);
      expect(JSON.parse(stdout)).toEqual({ A: "hello", B: "x", C: "3" });
    });
  });
});

describe.concurrent("boundary tests", () => {
  // TODO: this is a regression in bun ~1.0.15 ish
  test.todo("src boundary", () => {
    using dir = tempDir("dotenv", {
      ".env": 'KEY="a\\n"',
      "index.ts": "console.log(process.env.KEY);",
    });
    const { stdout } = bunRunWithoutTrim(`${dir}/index.ts`);
    // should be "a\n" but console.log adds a newline
    expect(stdout).toBe("a\n\n");

    using dir2 = tempDir("dotenv", {
      ".env": 'KEY="a\\n',
      "index.ts": "console.log(process.env.KEY);",
    });
    const { stdout: stdout2 } = bunRunWithoutTrim(`${dir2}/index.ts`);
    // should be "a\n but console.log adds a newline
    expect(stdout2).toBe('"a\n\n');
  });

  test("buffer boundary", async () => {
    const expected = "a".repeat(4094);
    using dir = tempDir("dotenv", {
      ".env": `KEY="${expected + "a"}"`,
      "index.ts": "console.log(process.env.KEY);",
    });
    const { stdout } = await bunRun(`${dir}/index.ts`);

    using dir2 = tempDir("dotenv", {
      ".env": `KEY="${expected + "\\n"}"`,
      "index.ts": "console.log(process.env.KEY);",
    });
    const { stdout: stdout2 } = await bunRun(`${dir2}/index.ts`);
    // should be truncated
    expect(stdout).toBe(expected + "a");
    expect(stdout2).toBe(expected);
  });
});

describe.concurrent("access from different apis", () => {
  let dir = "";
  beforeAll(() => {
    dir = tempDirWithFiles("dotenv", {
      ".env": "FOO=1\n",
      "index1.ts": "console.log(Bun.env.FOO);",
      "index2.ts": "console.log(process.env.FOO); ",
      "index3.ts": "console.log(import.meta.env.FOO);",
      "index4.ts": "console.log(import.meta.env.FOO + Bun.env.FOO);",
      "index5.ts": "console.log(Bun.env.FOO + import.meta.env.FOO);",
    });
  });

  test("only Bun.env", async () => expect((await bunRun(`${dir}/index1.ts`)).stdout).toBe("1"));
  test("only process.env", async () => expect((await bunRun(`${dir}/index2.ts`)).stdout).toBe("1"));
  test("only import.meta.env", async () => expect((await bunRun(`${dir}/index3.ts`)).stdout).toBe("1"));
  test("import.meta.env as 1st access", async () => expect((await bunRun(`${dir}/index4.ts`)).stdout).toBe("11"));
  test("import.meta.env as 2nd access", async () => expect((await bunRun(`${dir}/index5.ts`)).stdout).toBe("11"));
});

describe.concurrent("--env-file", () => {
  let dir = "";
  beforeAll(() => {
    dir = tempDirWithFiles("dotenv-arg", {
      ".env": "BUNTEST_DOTENV=1",
      ".env.a": "BUNTEST_A=1",
      ".env.b": "BUNTEST_B=1",
      ".env.c": "BUNTEST_C=1",
      ".env.a2": "BUNTEST_A=2",
      ".env.invalid":
        "BUNTEST_A=1\nBUNTEST_B =1\n BUNTEST_C =  1 \n...BUNTEST_invalid1\nBUNTEST_invalid2\nBUNTEST_D=\nBUNTEST_E=1",
      "subdir/.env.s": "BUNTEST_S=1",
      "index.ts":
        "console.log(Object.entries(process.env).flatMap(([k, v]) => k.startsWith('BUNTEST_') ? [`${k}=${v}`] : []).sort().join(','));",
    });
  });

  async function runEnvFile(bunArgs: string[], envOverride?: Record<string, string>) {
    const file = `${dir}/index.ts`;
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...bunArgs, file],
      cwd: path.dirname(file),
      env: {
        ...bunEnv,
        NODE_ENV: undefined,
        ...envOverride,
      },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    if (exitCode !== 0) throw new Error(stderr);
    return {
      stdout: stdout.trim(),
      stderr: stderr.trim(),
    };
  }

  test("single arg", async () => {
    expect((await runEnvFile(["--env-file", ".env.a"])).stdout).toBe("BUNTEST_A=1");
    expect((await runEnvFile(["--env-file=.env.a"])).stdout).toBe("BUNTEST_A=1");
  });

  test("multiple args", async () => {
    expect((await runEnvFile(["--env-file", ".env.a", "--env-file=.env.b"])).stdout).toBe("BUNTEST_A=1,BUNTEST_B=1");
  });

  test("single arg with multiple files", async () => {
    expect((await runEnvFile(["--env-file", ".env.a,.env.b,.env.c"])).stdout).toBe(
      "BUNTEST_A=1,BUNTEST_B=1,BUNTEST_C=1",
    );
  });

  test("priority on multi-file single arg", async () => {
    expect((await runEnvFile(["--env-file", ".env.a,.env.a2"])).stdout).toBe("BUNTEST_A=2");
  });

  test("priority on multiple args", async () => {
    expect((await runEnvFile(["--env-file", ".env.a", "--env-file", ".env.a2"])).stdout).toBe("BUNTEST_A=2");
  });

  test("priority on process env", async () => {
    expect(
      (
        await runEnvFile(["--env-file=.env.a", "--env-file=.env.b"], {
          BUNTEST_PROCESS: "P",
          BUNTEST_A: "P",
        })
      ).stdout,
    ).toBe("BUNTEST_A=P,BUNTEST_B=1,BUNTEST_PROCESS=P");
  });

  test("absolute filepath", async () => {
    expect((await runEnvFile(["--env-file", `${dir}/.env.a`])).stdout).toBe("BUNTEST_A=1");
  });

  test("explicit relative filepath", async () => {
    expect((await runEnvFile(["--env-file", "./.env.a"])).stdout).toBe("BUNTEST_A=1");
  });

  test("subdirectory filepath", async () => {
    expect((await runEnvFile(["--env-file", "subdir/.env.s"])).stdout).toBe("BUNTEST_S=1");
    expect((await runEnvFile(["--env-file", "./subdir/.env.s"])).stdout).toBe("BUNTEST_S=1");
  });

  test("when arg missing, fallback to default dotenv behavior", async () => {
    // if --env-file missing, it should fallback to the default builtin behavior (.env, .env.production, etc.)
    expect((await runEnvFile([])).stdout).toBe("BUNTEST_DOTENV=1");
  });

  test("empty string disables default dotenv behavior", async () => {
    expect((await runEnvFile(["--env-file=''"])).stdout).toBe("");
  });

  test("should correctly ignore invalid values and parse the rest", async () => {
    const res = await runEnvFile(["--env-file=.env.invalid"]);
    expect(res.stdout).toBe("BUNTEST_A=1,BUNTEST_B=1,BUNTEST_C=1,BUNTEST_D=,BUNTEST_E=1");
  });

  test("should ignore a file that doesn't exist", async () => {
    const res = await runEnvFile(["--env-file=.env.nonexisting"]);
    expect(res.stdout).toBe("");
  });
});

// A `.env` entry that is a directory, a FIFO, or a unix socket is not an env
// file. The loader skips it without a message and without blocking, and still
// loads the sibling `.env.local`.
describe.concurrent(".env that is not a regular file", () => {
  const files = {
    "package.json": JSON.stringify({ name: "dotenv-not-a-file" }),
    ".env.local": "BUNTEST_LOCAL=1\n",
    "index.ts": "console.log(process.env.BUNTEST_LOCAL);",
  };

  async function run(cwd: string, ...args: string[]) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...args],
      cwd,
      env: { ...bunEnv, NODE_ENV: undefined },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout: stdout.trim(), stderr, exitCode };
  }

  test("directory", async () => {
    using dir = tempDir("dotenv-dir", { ...files, ".env/keep": "" });

    const install = await run(String(dir), "install");
    expect(install.stderr).not.toContain("error loading .env file");
    expect(install.exitCode).toBe(0);

    const script = await run(String(dir), "index.ts");
    expect(script.stderr).toBe("");
    expect(script.stdout).toBe("1");
    expect(script.exitCode).toBe(0);
  });

  // The resolver's directory listing drops a FIFO entry, so the loader only
  // sees one through a symlink. Without O_NONBLOCK the open blocks until a
  // writer appears.
  test.skipIf(isWindows)("FIFO behind a symlink", async () => {
    using dir = tempDir("dotenv-fifo", files);
    mkfifo(path.join(String(dir), "fifo"));
    fs.symlinkSync("fifo", path.join(String(dir), ".env"));

    const install = await run(String(dir), "install");
    expect(install.stderr).not.toContain("error loading .env file");
    expect(install.exitCode).toBe(0);

    const script = await run(String(dir), "index.ts");
    expect(script.stderr).toBe("");
    expect(script.stdout).toBe("1");
    expect(script.exitCode).toBe(0);
  });

  test.skipIf(isWindows)("unix socket behind a symlink", async () => {
    using dir = tempDir("dotenv-sock", files);
    using listener = Bun.listen({
      unix: path.join(String(dir), "sock"),
      socket: { data() {} },
    });
    fs.symlinkSync("sock", path.join(String(dir), ".env"));

    const install = await run(String(dir), "install");
    expect(install.stderr).not.toContain("ENXIO");
    expect(install.exitCode).toBe(0);

    const script = await run(String(dir), "index.ts");
    expect(script.stderr).toBe("");
    expect(script.stdout).toBe("1");
    expect(script.exitCode).toBe(0);
  });
});

// An explicit `--env-file` is read whatever kind of file it is, as in Node.
// `--env-file=<(cmd)` and `--env-file=/dev/stdin` pass secrets without a file
// on disk. The default `.env` discovery above still skips such files.
describe.concurrent("--env-file that is not a regular file", () => {
  const files = {
    "package.json": JSON.stringify({ name: "dotenv-arg-not-a-file" }),
    ".env": "BUNTEST_DOTENV=1\n",
    ".env.a": "BUNTEST_A=1\n",
    "index.ts":
      "console.log(Object.entries(process.env).flatMap(([k, v]) => k.startsWith('BUNTEST_') ? [`${k}=${v}`] : []).sort().join(','));",
  };

  async function run(cwd: string, cmd: string[], env: Record<string, string | undefined> = {}) {
    await using proc = Bun.spawn({
      cmd,
      cwd,
      env: { ...bunEnv, NODE_ENV: undefined, ...env },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout: stdout.trim(), stderr, exitCode };
  }

  // `sh` makes a real pipe. `Bun.spawn({ stdin: "pipe" })` is a socket pair,
  // which `/dev/stdin` cannot reopen on Linux.
  test.skipIf(isWindows)("a pipe through /dev/stdin", async () => {
    using dir = tempDir("dotenv-arg-stdin", files);

    const script = await run(String(dir), [
      "sh",
      "-c",
      'echo BUNTEST_PIPE=1 | "$0" --env-file=/dev/stdin index.ts',
      bunExe(),
    ]);
    expect(script.stderr).toBe("");
    expect(script.stdout).toBe("BUNTEST_PIPE=1");
    expect(script.exitCode).toBe(0);
  });

  test.skipIf(isWindows)("a pipe in a comma list, and the process env still wins", async () => {
    using dir = tempDir("dotenv-arg-stdin-list", files);

    const script = await run(
      String(dir),
      [
        "sh",
        "-c",
        'printf "BUNTEST_PIPE=1\\nBUNTEST_PROCESS=1\\n" | "$0" --env-file=.env.a,/dev/stdin index.ts',
        bunExe(),
      ],
      { BUNTEST_PROCESS: "P" },
    );
    expect(script.stderr).toBe("");
    expect(script.stdout).toBe("BUNTEST_A=1,BUNTEST_PIPE=1,BUNTEST_PROCESS=P");
    expect(script.exitCode).toBe(0);
  });

  test.skipIf(isWindows)("process substitution", async () => {
    using dir = tempDir("dotenv-arg-procsub", files);

    const script = await run(String(dir), ["bash", "-c", '"$0" --env-file=<(echo BUNTEST_SUBST=1) index.ts', bunExe()]);
    expect(script.stderr).toBe("");
    expect(script.stdout).toBe("BUNTEST_SUBST=1");
    expect(script.exitCode).toBe(0);
  });

  // The writer blocks in open(2) until bun opens the FIFO for reading, and bun
  // blocks in open(2) until a writer arrives. Either order works, as with `cat`.
  test.skipIf(isWindows)("a FIFO", async () => {
    using dir = tempDir("dotenv-arg-fifo", files);
    mkfifo(path.join(String(dir), "fifo"));
    await using writer = Bun.spawn({
      cmd: ["sh", "-c", "echo BUNTEST_FIFO=1 > fifo"],
      cwd: String(dir),
      env: bunEnv,
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    });

    const script = await run(String(dir), [bunExe(), "--env-file=fifo", "index.ts"]);
    expect(script.stderr).toBe("");
    expect(script.stdout).toBe("BUNTEST_FIFO=1");
    expect(script.exitCode).toBe(0);
    expect(await writer.exited).toBe(0);
  });

  // A pipe can be read once, so a worker must not open the `--env-file` entries
  // again. It gets the values from the parent's env map, like `process.env` in
  // a Node worker. A key added to the file after startup proves it did not read
  // the file, and `.env` stays unloaded.
  test("a worker inherits the values without opening the files again", async () => {
    using dir = tempDir("dotenv-arg-worker", {
      ...files,
      "index.ts": `
        await Bun.write(new URL("./.env.a", import.meta.url), "BUNTEST_A=1\\nBUNTEST_AFTER_START=1\\n");
        const worker = new Worker(new URL("./worker.ts", import.meta.url));
        worker.onmessage = ({ data }) => {
          console.log(data);
          worker.terminate();
        };
      `,
      "worker.ts": `
        postMessage(Object.entries(process.env).flatMap(([k, v]) => k.startsWith("BUNTEST_") ? [k + "=" + v] : []).sort().join(","));
      `,
    });

    const script = await run(String(dir), [bunExe(), "--env-file=.env.a", "index.ts"]);
    expect(script.stderr).toBe("");
    expect(script.stdout).toBe("BUNTEST_A=1");
    expect(script.exitCode).toBe(0);
  });

  // A compiled executable replaces the worker's env options with the standalone
  // graph's flags after the worker copied them from the parent. The worker must
  // still leave `.env` alone when `--env-file` came from BUN_OPTIONS.
  test("a worker in a compiled executable", async () => {
    const buntestVars = `Object.entries(process.env).flatMap(([k, v]) => k.startsWith("BUNTEST_") ? [k + "=" + v] : []).sort().join(",")`;
    using dir = tempDir("dotenv-arg-compile-worker", {
      ...files,
      "index.js": `
        const worker = new Worker(new URL("./worker.js", import.meta.url));
        worker.onmessage = ({ data }) => {
          console.log("worker " + data);
          worker.terminate();
        };
        console.log("main " + ${buntestVars});
      `,
      "worker.js": `postMessage(${buntestVars});`,
    });

    const build = await run(String(dir), [
      bunExe(),
      "build",
      "--compile",
      "./index.js",
      "./worker.js",
      "--outfile",
      "app",
    ]);
    expect(build.stderr).not.toContain("error:");
    expect(build.exitCode).toBe(0);

    const exe = path.join(String(dir), isWindows ? "app.exe" : "app");
    const app = await run(String(dir), [exe], { BUN_OPTIONS: "--env-file=.env.a" });
    expect(app.stdout).toBe("main BUNTEST_A=1\nworker BUNTEST_A=1");
    expect(app.exitCode).toBe(0);
  });
});

describe.concurrent(".env with a UTF-8 BOM", () => {
  // Notepad and some PowerShell redirects write EF BB BF before the first byte.
  // Previously the BOM failed the key grammar and skip_line() silently dropped line 1.
  const bom = "\uFEFF";

  test("automatic .env load keeps the first variable", async () => {
    using dir = tempDir("dotenv-bom", {
      ".env": `${bom}BUNTEST_BOM_A=1\r\nBUNTEST_BOM_B=2\r\n`,
      "index.ts": "console.log(JSON.stringify({A: process.env.BUNTEST_BOM_A, B: process.env.BUNTEST_BOM_B}));",
    });
    const { stdout } = await bunRun(`${dir}/index.ts`);
    expect(stdout).toBe(JSON.stringify({ A: "1", B: "2" }));
  });

  test("--env-file keeps the first variable", () => {
    using dir = tempDir("dotenv-bom-envfile", {
      "with-bom.env": `${bom}BUNTEST_BOM_A=1\nBUNTEST_BOM_B=2\n`,
      "index.ts": "console.log(JSON.stringify({A: process.env.BUNTEST_BOM_A, B: process.env.BUNTEST_BOM_B}));",
    });
    const result = Bun.spawnSync([bunExe(), "--env-file", "with-bom.env", "index.ts"], {
      cwd: dir,
      env: { ...bunEnv, NODE_ENV: undefined },
    });
    if (!result.success) throw new Error(result.stderr.toString("utf8"));
    expect(result.stdout.toString("utf8").trim()).toBe(JSON.stringify({ A: "1", B: "2" }));
  });

  test("util.parseEnv strips the BOM", () => {
    expect(parseEnv(`${bom}A=1\nB=2\n`)).toEqual({ A: "1", B: "2" });
    expect(parseEnv(`${bom}export FOO=bar\n`)).toEqual({ FOO: "bar" });
    expect(parseEnv(bom)).toEqual({});
  });
});

test.if(isWindows)("environment variables are case-insensitive on Windows", async () => {
  using dir = tempDir("dotenv", {
    ".env": "FOO=bar\n",
    "index.ts": "console.log(process.env.FOO, process.env.foo, process.env.fOo);",
  });
  const { stdout } = await bunRun(`${dir}/index.ts`);
  expect(stdout).toBe("bar bar bar");
});

describe.concurrent("process.env is not inlined", () => {
  test("basic case", async () => {
    using tmp = tempDir("env-inlining", {
      "index.ts": `process.env.NODE_ENV = "production";
process.env.YOLO = "woo!";
console.log(process.env.NODE_ENV, process.env.YOLO);`,
    });
    expect(
      (
        await bunRun(path.join(tmp, "index.ts"), {
          NODE_ENV: undefined,
          YOLO: "boo",
        })
      ).stdout,
    ).toBe("production woo!");
  });
  test("pass explicit NODE_ENV case", async () => {
    using tmp = tempDir("env-inlining", {
      "index.ts": `console.log(process.env.NODE_ENV);
process.env.NODE_ENV = "development";
process.env.YOLO = "woo!";
console.log(process.env.NODE_ENV, process.env.YOLO);`,
    });
    expect(
      (
        await bunRun(path.join(tmp, "index.ts"), {
          NODE_ENV: "production",
          YOLO: "boo",
        })
      ).stdout,
    ).toBe("production\ndevelopment woo!");
  });
  test("pass weird NODE_ENV case", async () => {
    using tmp = tempDir("env-inlining", {
      "index.ts": `console.log(process.env.NODE_ENV);
process.env.NODE_ENV = "development";
process.env.YOLO = "woo!";
console.log(process.env.NODE_ENV, process.env.YOLO);`,
    });
    expect(
      (
        await bunRun(path.join(tmp, "index.ts"), {
          NODE_ENV: "buh",
          YOLO: "boo",
        })
      ).stdout,
    ).toBe("buh\ndevelopment woo!");
  });
  test("in bun test", () => {
    using tmp = tempDir("env-inlining", {
      "index.test.ts": `test("my test", () => {
  console.log(process.env.NODE_ENV);
  process.env.NODE_ENV = "development";
  process.env.YOLO = "woo!";
  console.log(process.env.NODE_ENV, process.env.YOLO);
});`,
    });
    expect(
      bunTest(path.join(tmp, "index.test.ts"), {
        YOLO: "boo",
      }).stdout,
    ).toBe(`bun test ${Bun.version_with_sha}\n` + "test\ndevelopment woo!");
  });
  test("in bun test with explicit setting", () => {
    using tmp = tempDir("env-inlining", {
      "index.test.ts": `test("my test", () => {
  console.log(process.env.NODE_ENV);
  process.env.NODE_ENV = "development";
  process.env.YOLO = "woo!";
  console.log(process.env.NODE_ENV, process.env.YOLO);
});`,
    });
    expect(
      bunTest(path.join(tmp, "index.test.ts"), {
        YOLO: "boo",
        NODE_ENV: "production",
      }).stdout,
    ).toBe(`bun test ${Bun.version_with_sha}\n` + "production\ndevelopment woo!");
  });
  test("in bun test with dynamic access", () => {
    using tmp = tempDir("env-inlining", {
      "index.test.ts": `const dynamic = () => require('process')['e' + String('nv')];
test("my test", () => {
  console.log(dynamic().NODE_ENV);
  process.env.NODE_ENV = "production";
  console.log(dynamic().NODE_ENV);
});`,
    });
    expect(bunTest(path.join(tmp, "index.test.ts"), {}).stdout).toBe(
      `bun test ${Bun.version_with_sha}\n` + "test\nproduction",
    );
  });
  test("in bun test with dynamic access + explicit set", () => {
    using tmp = tempDir("env-inlining", {
      "index.test.ts": `const dynamic = () => require('process')['e' + String('nv')];
test("my test", () => {
  console.log(dynamic().NODE_ENV);
  process.env.NODE_ENV = "production";
  console.log(dynamic().NODE_ENV);
});`,
    });
    expect(bunTest(path.join(tmp, "index.test.ts"), { NODE_ENV: "development" }).stdout).toBe(
      `bun test ${Bun.version_with_sha}\n` + "development\nproduction",
    );
  });
});

test.concurrent("NODE_ENV has a default value", async () => {
  using tmp = tempDir("default-node-env", {
    "index.ts": `const dynamic = () => require('process')['e' + String('nv')];
console.log(process.env.NODE_ENV);
console.log(dynamic().NODE_ENV);
process.env.NODE_ENV = "production";
console.log(dynamic().NODE_ENV);
`,
  });
  expect((await bunRun(path.join(tmp, "index.ts"), {})).stdout).toBe("undefined\nundefined\nproduction");
});

test("NODE_ENV default is not propogated in bun run", () => {
  const getenv =
    process.platform !== "win32"
      ? "env | grep -v npm_lifecycle_script | grep NODE_ENV && exit 1 || true"
      : "node -e 'if(process.env.NODE_ENV)throw(1)'";
  using tmp = tempDir("default-node-env", {
    "package.json": '{"scripts":{"show-env":' + JSON.stringify(getenv) + "}}",
  });
  expect(bunRunAsScript(tmp, "show-env", {}).stdout).toBe("");
});

for (const shell of ["system", "bun"]) {
  const isWindowsCMD = isWindows && shell === "system";

  const env = {
    ENV_FILE_NAME: "N/A",
  };

  const show_env_script = isWindowsCMD //
    ? "echo ENV_FILE_NAME=%ENV_FILE_NAME%, NODE_ENV=%NODE_ENV%"
    : "echo ENV_FILE_NAME=$ENV_FILE_NAME, NODE_ENV=$NODE_ENV";

  describe(`script runner with ${shell} shell`, () => {
    test("does not pass variables from .env files into scripts", () => {
      using tmp = tempDir("script-runner-env", {
        "package.json": '{"scripts":{"show-env":"' + show_env_script + '"}}',

        ".env.development": "ENV_FILE_NAME=.env.development",
        ".env.production": "ENV_FILE_NAME=.env.production",
        ".env.test": "ENV_FILE_NAME=.env.test",
        ".env": "ENV_FILE_NAME=.env",
      });

      expect(bunRunAsScript(tmp, "show-env", { ...env }, ["--shell=" + shell]).stdout).toBe(
        "ENV_FILE_NAME=N/A, NODE_ENV=" + (isWindowsCMD ? "%NODE_ENV%" : ""),
      );
    });

    for (const { NODE_ENV, expected, env_file } of [
      {
        NODE_ENV: "production",
        expected: "production",
        env_file: ".env.production",
      },
      {
        NODE_ENV: "development",
        expected: "development",
        env_file: ".env.development",
      },
      {
        NODE_ENV: undefined,
        expected: isWindowsCMD ? "%NODE_ENV%" : "",
        env_file: ".env.development",
      },
    ]) {
      test("explicit NODE_ENV=" + NODE_ENV, () => {
        using tmp = tempDir("script-runner-env", {
          "package.json": '{"scripts":{"show-env":"' + show_env_script + '"}}',

          ".env.development": "ENV_FILE_NAME=.env.development",
          ".env.production": "ENV_FILE_NAME=.env.production",
          ".env.test": "ENV_FILE_NAME=.env.test",
          ".env": "ENV_FILE_NAME=.env",
        });

        expect(bunRunAsScript(tmp, "show-env", { ...env, NODE_ENV }, ["--shell=" + shell]).stdout).toBe(
          "ENV_FILE_NAME=N/A, NODE_ENV=" + expected,
        );
      });

      // This is already covered in isolation by the '.env file is loaded' describe
      // but it is nice to have just a couple e2e tests combining script runner AND the runtime.
      test.skipIf(isWindowsCMD)("e2e NODE_ENV=" + NODE_ENV, () => {
        // TODO: couldnt get a working thing for this on windows
        const run_index_script = `NODE_ENV=${NODE_ENV} bun run index.ts`;

        using tmp = tempDir("script-runner-env", {
          "package.json": '{"scripts":{"start":"' + run_index_script + '"}}',
          "index.ts": "console.log(`ENV_FILE_NAME=${process.env.ENV_FILE_NAME}, NODE_ENV=${process.env.NODE_ENV}`);",

          ".env.development": "ENV_FILE_NAME=.env.development",
          ".env.production": "ENV_FILE_NAME=.env.production",
          ".env.test": "ENV_FILE_NAME=.env.test",
          ".env": "ENV_FILE_NAME=.env",
        });

        expect(bunRunAsScript(tmp, "start", {}, ["--shell=" + shell]).stdout).toBe(
          "ENV_FILE_NAME=" + env_file + ", NODE_ENV=" + NODE_ENV,
        );
      });
    }
  });
}

const todoOnPosix = process.platform !== "win32" ? test.todo : test;
todoOnPosix("setting process.env coerces the value to a string", () => {
  // @ts-expect-error
  process.env.SET_TO_TRUE = true;
  let did_call = 0;
  // @ts-expect-error
  process.env.SET_TO_BUN = {
    toString() {
      did_call++;
      return "bun!";
    },
  };
  expect(process.env.SET_TO_TRUE).toBe("true");
  expect(process.env.SET_TO_BUN).toBe("bun!");
  expect(did_call).toBe(1);
});

test.concurrent("NODE_ENV=test loads .env.test even when .env.production exists", async () => {
  using dir = tempDir("dotenv", {
    "index.ts": "console.log(process.env.AWESOME);",
    ".env.production": "AWESOME=production",
    ".env.test": "AWESOME=test",
  });
  const { stdout } = await bunRun(`${dir}/index.ts`, { NODE_ENV: "test" });
  expect(stdout).toBe("test");
});

describe.concurrent("env loader buffer handling", () => {
  test("handles large quoted values with escape sequences", async () => {
    // This test ensures the env loader properly handles large values that exceed the initial buffer size
    // The env loader doesn't process escape sequences, so \\\\ remains as \\\\
    using dir = tempDir("dotenv-buffer-overflow", {
      ".env": `OVERFLOW_VAR="${"\\\\".repeat(2049)}"`, // 2049 * 2 = 4098 characters
      "index.ts": "console.log(process.env.OVERFLOW_VAR?.length || 0);",
    });
    const { stdout } = await bunRun(`${dir}/index.ts`);
    expect(stdout).toBe("4098"); // Each \\\\ is 2 characters
  });

  test("handles multiple large values in same file", async () => {
    using dir = tempDir("dotenv-multiple-large", {
      ".env": `
LARGE1="${"a".repeat(3000)}"
LARGE2="${"b".repeat(3000)}"
LARGE3="${"c".repeat(3000)}"
`,
      "index.ts":
        "console.log([process.env.LARGE1?.length, process.env.LARGE2?.length, process.env.LARGE3?.length].join(','));",
    });
    const { stdout } = await bunRun(`${dir}/index.ts`);
    expect(stdout).toBe("3000,3000,3000");
  });

  test("handles escape sequences at buffer boundaries", async () => {
    // Test that values with content near the old 4096-byte buffer boundary work correctly
    const prefix = "x".repeat(4090);
    using dir = tempDir("dotenv-boundary-escape", {
      ".env": `BOUNDARY="${prefix}suffix"`, // Total length would exceed 4096
      "index.ts": "console.log(process.env.BOUNDARY?.length || 0);",
    });
    const { stdout } = await bunRun(`${dir}/index.ts`);
    expect(stdout).toBe("4096");
  });
});

function hasNobodyUser(): boolean {
  try {
    // /etc/passwd format: "name:x:uid:gid:gecos:home:shell"
    return /^nobody:/m.test(fs.readFileSync("/etc/passwd", "utf8"));
  } catch {
    return false;
  }
}

const canUseRunuser =
  isLinux &&
  typeof process.getuid === "function" &&
  process.getuid() === 0 &&
  !!Bun.which("runuser") &&
  hasNobodyUser();

test.skipIf(!canUseRunuser)("process.env is preserved when cwd lacks read permission", () => {
  using dir = tempDir("env-eacces", {
    // Script lives in the readable root; the cwd will be a separate
    // execute-only directory.
    "script.ts": "console.log(JSON.stringify(!!process.env.MY_VAR));",
    "noread/.keep": "",
  });

  const noreadDir = path.join(dir, "noread");
  const scriptPath = path.join(dir, "script.ts");

  // Allow "nobody" to traverse the temp dir and read the script. Under
  // restrictive umasks the temp files can default to 0o640 which nobody
  // can't read, so set them explicitly.
  fs.chmodSync(dir, 0o755);
  fs.chmodSync(scriptPath, 0o644);

  // Make noread execute-only (0111). A process can cd into it, but
  // Bun's resolver cannot list it (opendir → EACCES). This causes
  // readDirInfo to return null, which previously skipped loadProcess()
  // and left process.env completely empty.
  fs.chmodSync(noreadDir, 0o111);

  // Use runuser -m to drop to "nobody" while preserving the environment
  // (root bypasses DAC checks, so we need a non-root user). -m preserves
  // env vars across the PAM user switch, so MY_VAR set in env: below
  // reaches the spawned bun.
  try {
    // Run via sh so that `cd` happens as the target user.
    const result = Bun.spawnSync({
      cmd: [
        "runuser",
        "-m",
        "-u",
        "nobody",
        "--",
        "/bin/sh",
        "-c",
        `cd '${noreadDir}' && exec '${bunExe()}' '${scriptPath}'`,
      ],
      env: {
        ...bunEnv,
        MY_VAR: "visible",
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(result.stdout.toString().trim()).toBe("true");
    expect(result.exitCode).toBe(0);
  } finally {
    // Restore permissions so tempDir cleanup can remove the directory.
    fs.chmodSync(noreadDir, 0o755);
  }
});

// `st_size` is only a hint (sparse file, writer racing the loader): the env
// loader's whole-file read used to `reserve_exact` it and abort the process in
// `handle_alloc_error` before any user code ran. It must surface as a
// recoverable error. ASAN-only: ASAN rejects the 1 TiB request deterministically.
test.skipIf(!isASAN || isWindows)(".env with a huge lying st_size does not abort the process", async () => {
  await using dir = tempDir("dotenv-huge-sparse", {
    ".env": "",
    "app.js": `console.log("reached user code");`,
  });
  // 1 TiB sparse `.env`: fstat reports 2**40 bytes, nothing is actually stored.
  fs.truncateSync(path.join(dir, ".env"), 2 ** 40);

  await using proc = Bun.spawn({
    cmd: [bunExe(), "app.js"],
    cwd: dir,
    env: {
      ...bunEnv,
      // Let ASAN return null for the oversized request (instead of hard-erroring
      // itself) so Bun's own allocation-failure path is what gets exercised.
      ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "allocator_may_return_null=1"].filter(Boolean).join(":"),
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Unfixed, startup died in `handle_alloc_error` ("memory allocation of
  // 1099511627792 bytes failed", SIGABRT) without ever reaching app.js.
  expect({ stdout, exitCode }).toEqual({ stdout: "reached user code\n", exitCode: 0 });
});

// https://github.com/oven-sh/bun/issues/6338
// Node.js does not auto-load .env files, so bun invoked as `node` (via `--bun`)
// must not either. Tools like Vite re-read `.env.{mode}` themselves and treat
// anything already in process.env as a higher-priority shell override.
describe("node shim (argv0=node) does not auto-load .env files", () => {
  const files = {
    ".env": "PUBLICPATH=/\nVITE_PUBLIC_PATH=/dev\n",
    ".env.production": "PUBLICPATH=/app\nVITE_PUBLIC_PATH=/app\n",
    "check.js": `console.log(JSON.stringify({
      PUBLICPATH: process.env.PUBLICPATH ?? null,
      VITE_PUBLIC_PATH: process.env.VITE_PUBLIC_PATH ?? null,
    }));`,
    "package.json": JSON.stringify({ name: "p", scripts: { check: "node ./check.js" } }),
  };
  const testEnv = {
    ...bunEnv,
    NODE_ENV: undefined,
    PUBLICPATH: undefined,
    VITE_PUBLIC_PATH: undefined,
  };

  test.concurrent("argv0=node leaves .env keys unset", async () => {
    using dir = tempDir("dotenv-as-node", files);
    await using proc = Bun.spawn({
      cmd: [bunExe(), "check.js"],
      argv0: "node",
      cwd: String(dir),
      env: testEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ PUBLICPATH: null, VITE_PUBLIC_PATH: null });
    expect(exitCode).toBe(0);
  });

  test.concurrent("argv0=node still honors explicit --env-file", async () => {
    using dir = tempDir("dotenv-as-node-explicit", files);
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--env-file=.env.production", "check.js"],
      argv0: "node",
      cwd: String(dir),
      env: testEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ PUBLICPATH: "/app", VITE_PUBLIC_PATH: "/app" });
    expect(exitCode).toBe(0);
  });

  test.concurrent("`bun --bun run <script>` does not leak .env into the node-shimmed child", async () => {
    using dir = tempDir("dotenv-bun-run", files);
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--bun", "run", "--silent", "check"],
      cwd: String(dir),
      env: testEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ PUBLICPATH: null, VITE_PUBLIC_PATH: null });
    expect(exitCode).toBe(0);
  });

  test.concurrent("`bun check.js` (not node shim) still auto-loads .env", async () => {
    using dir = tempDir("dotenv-direct", files);
    await using proc = Bun.spawn({
      cmd: [bunExe(), "check.js"],
      cwd: String(dir),
      env: testEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ PUBLICPATH: "/", VITE_PUBLIC_PATH: "/dev" });
    expect(exitCode).toBe(0);
  });
});

// JSC options come from BUN_JSC_<option>; JSC's own JSC_<option> environment
// pass is disabled (JSC::Config::disableEnvironmentOptions in JSCInitialize).
describe("JSC option environment variables", () => {
  async function dumpOptions(env: Record<string, string>) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", "1"],
      env: { ...bunEnv, ...env },
      stdout: "ignore",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    return { stderr, exitCode };
  }
  test.concurrent("BUN_JSC_<option> applies", async () => {
    // level 1 lists overridden options only
    const { stderr, exitCode } = await dumpOptions({
      BUN_JSC_dumpOptions: "1",
      BUN_JSC_thresholdForJITAfterWarmUp: "77",
    });
    expect(stderr).toContain("thresholdForJITAfterWarmUp=77");
    expect(exitCode).toBe(0);
  });
  test.concurrent("JSC_<option> is ignored", async () => {
    // level 2 lists every option with its current value, however it was set
    const { stderr, exitCode } = await dumpOptions({ BUN_JSC_dumpOptions: "2", JSC_thresholdForJITAfterWarmUp: "77" });
    expect(stderr).toContain("thresholdForJITAfterWarmUp=");
    expect(stderr).not.toContain("thresholdForJITAfterWarmUp=77");
    expect(exitCode).toBe(0);
  });
});
