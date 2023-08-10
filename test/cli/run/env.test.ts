import { describe, expect, test } from "bun:test";
import { bunRun, bunTest, tempDirWithFiles, bunExe, bunEnv, bunRunAsScript } from "harness";
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

describe(".env file is loaded", () => {
  test(".env", () => {
    const dir = tempDirWithFiles("dotenv", {
      ".env": "FOO=bar\n",
      "index.ts": "console.log(process.env.FOO);",
    });
    const { stdout } = bunRun(`${dir}/index.ts`);
    expect(stdout).toBe("bar");
  });
  test(".env.local", () => {
    const dir = tempDirWithFiles("dotenv", {
      ".env": "FOO=fail\nBAR=baz\n",
      ".env.local": "FOO=bar\n",
      "index.ts": "console.log(process.env.FOO, process.env.BAR);",
    });
    const { stdout } = bunRun(`${dir}/index.ts`);
    expect(stdout).toBe("bar baz");
  });
  test(".env.development (NODE_ENV=undefined)", () => {
    const dir = tempDirWithFiles("dotenv", {
      ".env": "FOO=fail\nBAR=baz\n",
      ".env.development": "FOO=bar\n",
      ".env.local": "LOCAL=true\n",
      "index.ts": "console.log(process.env.FOO, process.env.BAR, process.env.LOCAL);",
    });
    const { stdout } = bunRun(`${dir}/index.ts`);
    expect(stdout).toBe("bar baz true");
  });
  test(".env.development (NODE_ENV=development)", () => {
    const dir = tempDirWithFiles("dotenv", {
      ".env": "FOO=fail\nBAR=baz\n",
      ".env.development": "FOO=bar\n",
      ".env.local": "LOCAL=true\n",
      "index.ts": "console.log(process.env.FOO, process.env.BAR, process.env.LOCAL);",
    });
    const { stdout } = bunRun(`${dir}/index.ts`);
    expect(stdout).toBe("bar baz true");
  });
  test(".env.production", () => {
    const dir = tempDirWithFiles("dotenv", {
      ".env": "FOO=fail\nBAR=baz\n",
      ".env.production": "FOO=bar\n",
      ".env.local": "LOCAL=true\n",
      "index.ts": "console.log(process.env.FOO, process.env.BAR, process.env.LOCAL);",
    });
    const { stdout } = bunRun(`${dir}/index.ts`, { NODE_ENV: "production" });
    expect(stdout).toBe("bar baz true");
  });
  test(".env.development and .env.test ignored when NODE_ENV=production", () => {
    const dir = tempDirWithFiles("dotenv", {
      ".env": "FOO=bar\nBAR=baz\n",
      ".env.development": "FOO=development\n",
      ".env.development.local": "FOO=development.local\n",
      ".env.test": "FOO=test\n",
      ".env.test.local": "FOO=test.local\n",
      ".env.local": "LOCAL=true\n",
      "index.ts": "console.log(process.env.FOO, process.env.BAR, process.env.LOCAL);",
    });
    const { stdout } = bunRun(`${dir}/index.ts`, { NODE_ENV: "production" });
    expect(stdout).toBe("bar baz true");
  });
  test(".env.production and .env.test ignored when NODE_ENV=development", () => {
    const dir = tempDirWithFiles("dotenv", {
      ".env": "FOO=bar\nBAR=baz\n",
      ".env.production": "FOO=production\n",
      ".env.production.local": "FOO=production.local\n",
      ".env.test": "FOO=test\n",
      ".env.test.local": "FOO=test.local\n",
      ".env.local": "LOCAL=true\n",
      "index.ts": "console.log(process.env.FOO, process.env.BAR, process.env.LOCAL);",
    });
    const { stdout } = bunRun(`${dir}/index.ts`, {});
    expect(stdout).toBe("bar baz true");
  });
  test(".env and .env.test used in testing", () => {
    const dir = tempDirWithFiles("dotenv", {
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
    expect(stdout).toBe("a b c undefined");
  });
  test(".env.local ignored when bun test", () => {
    const dir = tempDirWithFiles("dotenv", {
      ".env": "FAILED=false\n",
      ".env.local": "FAILED=true\n",
      "index.test.ts": "console.log(process.env.FAILED);",
    });
    const { stdout } = bunTest(`${dir}/index.test.ts`, {});
    expect(stdout).toBe("false");
  });
  test(".env.development and .env.production ignored when bun test", () => {
    const dir = tempDirWithFiles("dotenv", {
      ".env": "FAILED=false\n",
      ".env.development": "FAILED=development\n",
      ".env.development.local": "FAILED=development.local\n",
      ".env.production": "FAILED=production\n",
      ".env.production.local": "FAILED=production.local\n",
      "index.test.ts": "console.log(process.env.FAILED);",
    });
    const { stdout } = bunTest(`${dir}/index.test.ts`);
    expect(stdout).toBe("false");
  });
  test.todo("NODE_ENV is automatically set to test within bun test", () => {
    const dir = tempDirWithFiles("dotenv", {
      "index.test.ts": "console.log(process.env.NODE_ENV);",
    });
    const { stdout } = bunTest(`${dir}/index.test.ts`);
    expect(stdout).toBe("test");
  });
});
describe("dotenv priority", () => {
  test("process env overrides everything else", () => {
    const dir = tempDirWithFiles("dotenv", {
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
    const { stdout } = bunRun(`${dir}/index.ts`, { FOO: "override" });
    expect(stdout).toBe("override");

    const { stdout: stdout2 } = bunTest(`${dir}/index.test.ts`, { FOO: "override" });
    expect(stdout2).toBe("override");
  });
  test(".env.{NODE_ENV}.local overrides .env.local", () => {
    const dir = tempDirWithFiles("dotenv", {
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
    const { stdout: stdout_dev } = bunRun(`${dir}/index.ts`, { NODE_ENV: "development" });
    expect(stdout_dev).toBe(".env.development.local");
    const { stdout: stdout_prod } = bunRun(`${dir}/index.ts`, { NODE_ENV: "production" });
    expect(stdout_prod).toBe(".env.production.local");
    const { stdout: stdout_test } = bunTest(`${dir}/index.test.ts`, {});
    expect(stdout_test).toBe(".env.test.local");
  });
  test(".env.local overrides .env.{NODE_ENV}", () => {
    const dir = tempDirWithFiles("dotenv", {
      ".env": "FOO=.env\n",
      ".env.development": "FOO=.env.development\n",
      ".env.production": "FOO=.env.production\n",
      ".env.test": "FOO=.env.test\n",
      ".env.local": "FOO=.env.local\n",
      "index.ts": "console.log(process.env.FOO);",
      "index.test.ts": "console.log(process.env.FOO);",
    });
    const { stdout: stdout_dev } = bunRun(`${dir}/index.ts`, { NODE_ENV: "development" });
    expect(stdout_dev).toBe(".env.local");
    const { stdout: stdout_prod } = bunRun(`${dir}/index.ts`, { NODE_ENV: "production" });
    expect(stdout_prod).toBe(".env.local");
    // .env.local is "not checked when `NODE_ENV` is `test`"
    const { stdout: stdout_test } = bunTest(`${dir}/index.test.ts`, {});
    expect(stdout_test).toBe(".env.test");
  });
  test(".env.{NODE_ENV} overrides .env", () => {
    const dir = tempDirWithFiles("dotenv", {
      ".env": "FOO=.env\n",
      ".env.development": "FOO=.env.development\n",
      ".env.production": "FOO=.env.production\n",
      ".env.test": "FOO=.env.test\n",
      "index.ts": "console.log(process.env.FOO);",
      "index.test.ts": "console.log(process.env.FOO);",
    });
    const { stdout: stdout_dev } = bunRun(`${dir}/index.ts`, { NODE_ENV: "development" });
    expect(stdout_dev).toBe(".env.development");
    const { stdout: stdout_prod } = bunRun(`${dir}/index.ts`, { NODE_ENV: "production" });
    expect(stdout_prod).toBe(".env.production");
    const { stdout: stdout_test } = bunTest(`${dir}/index.test.ts`, {});
    expect(stdout_test).toBe(".env.test");
  });
});

test(".env colon assign", () => {
  const dir = tempDirWithFiles("dotenv-colon", {
    ".env": "FOO: foo",
    "index.ts": "console.log(process.env.FOO);",
  });
  const { stdout } = bunRun(`${dir}/index.ts`);
  expect(stdout).toBe("foo");
});

test(".env export assign", () => {
  const dir = tempDirWithFiles("dotenv-export", {
    ".env": "export FOO = foo\nexport = bar",
    "index.ts": "console.log(process.env.FOO, process.env.export);",
  });
  const { stdout } = bunRun(`${dir}/index.ts`);
  expect(stdout).toBe("foo bar");
});

test(".env value expansion", () => {
  const dir = tempDirWithFiles("dotenv-expand", {
    ".env": "FOO=foo\nBAR=$FOO bar\nMOO=${FOO} ${BAR:-fail} ${MOZ:-moo}",
    "index.ts": "console.log([process.env.FOO, process.env.BAR, process.env.MOO].join('|'));",
  });
  const { stdout } = bunRun(`${dir}/index.ts`);
  expect(stdout).toBe("foo|foo bar|foo foo bar moo");
});

test(".env comments", () => {
  const dir = tempDirWithFiles("dotenv-comments", {
    ".env": "#FOZ\nFOO = foo#FAIL\nBAR='bar' #BAZ",
    "index.ts": "console.log(process.env.FOO, process.env.BAR);",
  });
  const { stdout } = bunRun(`${dir}/index.ts`);
  expect(stdout).toBe("foo bar");
});

test(".env process variables no comments", () => {
  const dir = tempDirWithFiles("env-no-comments", {
    "index.ts": "console.log(process.env.TEST1, process.env.TEST2);",
  });
  const { stdout } = bunRun(`${dir}/index.ts`, { TEST1: "test#1", TEST2: '"test#2"' });
  expect(stdout).toBe('test#1 "test#2"');
});

test(".env escaped dollar sign", () => {
  const dir = tempDirWithFiles("dotenv-dollar", {
    ".env": "FOO=foo\nBAR=\\$FOO",
    "index.ts": "console.log(process.env.FOO, process.env.BAR);",
  });
  const { stdout } = bunRun(`${dir}/index.ts`);
  expect(stdout).toBe("foo $FOO");
});

test(".env doesnt crash with 159 bytes", () => {
  const dir = tempDirWithFiles("dotenv-159", {
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

  const { stdout } = bunRun(`${dir}/index.ts`);
  expect(stdout.trim()).toBe(
    `1234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678`,
  );
});

test(".env with >768 entries", () => {
  const dir = tempDirWithFiles("dotenv-many-entries", {
    ".env": new Array(2000)
      .fill(null)
      .map((_, i) => `TEST_VAR${i}=TEST_VAL${i}`)
      .join("\n"),
    "index.ts": "console.log(process.env.TEST_VAR47);",
  });
  const { stdout } = bunRun(`${dir}/index.ts`);
  expect(stdout).toBe("TEST_VAL47");
});

test(".env space edgecase (issue #411)", () => {
  const dir = tempDirWithFiles("dotenv-issue-411", {
    ".env": "VARNAME=A B",
    "index.ts": "console.log('[' + process.env.VARNAME + ']');",
  });
  const { stdout } = bunRun(`${dir}/index.ts`);
  expect(stdout).toBe("[A B]");
});

test(".env special characters 1 (issue #2823)", () => {
  const dir = tempDirWithFiles("dotenv-issue-2823", {
    ".env": 'A="a$t"\nC=`c\\$v`',
    "index.ts": "console.log('[' + process.env.A + ']', '[' + process.env.C + ']');",
  });
  const { stdout } = bunRun(`${dir}/index.ts`);
  expect(stdout).toBe("[a] [c$v]");
});

test.todo("env escaped quote (issue #2484)", () => {
  const dir = tempDirWithFiles("env-issue-2484", {
    "index.ts": "console.log(process.env.VALUE, process.env.VALUE2);",
  });
  const { stdout } = bunRun(`${dir}/index.ts`, { VALUE: `\\"`, VALUE2: `\\\\"` });
  expect(stdout).toBe('\\" \\\\"');
});

test(".env Windows-style newline (issue #3042)", () => {
  const dir = tempDirWithFiles("dotenv-issue-3042", {
    ".env": "FOO=\rBAR='bar\r\rbaz'\r\nMOO=moo\r",
    "index.ts": "console.log([process.env.FOO, process.env.BAR, process.env.MOO].join('|'));",
  });
  const { stdout } = bunRun(`${dir}/index.ts`);
  expect(stdout).toBe("|bar\n\nbaz|moo");
});

test(".env with zero length strings", () => {
  const dir = tempDirWithFiles("dotenv-issue-zerolength", {
    ".env": "FOO=''\n",
    "index.ts":
      "function i(a){return a}\nconsole.log([process.env.FOO,i(process.env).FOO,process.env.FOO.length,i(process.env).FOO.length].join('|'));",
  });
  const { stdout } = bunRun(`${dir}/index.ts`);
  expect(stdout).toBe("||0|0");
});

test(".env in a folder doesn't throw an error", () => {
  const dir = tempDirWithFiles("dotenv-issue-3670", {
    ".env": {
      ".env.local": "FOO=''\n",
    },
    "index.ts": "console.write('hey')",
    "package.json": '{ "name": ' + '"test"' + " }",
  });
  const { stdout } = bunRun(`${dir}/index.ts`);
  expect(stdout).toBe("hey");
});

test("#3911", () => {
  const dir = tempDirWithFiles("dotenv", {
    ".env": 'KEY="a\\nb"',
    "index.ts": "console.log(process.env.KEY);",
  });
  const { stdout } = bunRun(`${dir}/index.ts`);
  expect(stdout).toBe("a\nb");
});

describe("boundary tests", () => {
  test("src boundary", () => {
    const dir = tempDirWithFiles("dotenv", {
      ".env": 'KEY="a\\n"',
      "index.ts": "console.log(process.env.KEY);",
    });
    const { stdout } = bunRunWithoutTrim(`${dir}/index.ts`);
    // should be "a\n" but console.log adds a newline
    expect(stdout).toBe("a\n\n");

    const dir2 = tempDirWithFiles("dotenv", {
      ".env": 'KEY="a\\n',
      "index.ts": "console.log(process.env.KEY);",
    });
    const { stdout: stdout2 } = bunRunWithoutTrim(`${dir2}/index.ts`);
    // should be "a\n but console.log adds a newline
    expect(stdout2).toBe('"a\n\n');
  });

  test("buffer boundary", () => {
    const expected = "a".repeat(4094);
    let content = expected + "a";
    const dir = tempDirWithFiles("dotenv", {
      ".env": `KEY="${content}"`,
      "index.ts": "console.log(process.env.KEY);",
    });
    const { stdout } = bunRun(`${dir}/index.ts`);

    content = expected + "\\n";
    const dir2 = tempDirWithFiles("dotenv", {
      ".env": `KEY="${content}"`,
      "index.ts": "console.log(process.env.KEY);",
    });
    const { stdout: stdout2 } = bunRun(`${dir2}/index.ts`);
    // should be truncated
    expect(stdout).toBe(expected);
    expect(stdout2).toBe(expected);
  });
});

test("npm_package_config", () => {
  const vals = {
    "port": 8000,
    "password": "hello world",
    "isDev": true,
    "isProd": false,
    "piNum": 3.14,
    "emptyStr": "",
    "emptyStr2": " ",
    "why": 0,
    "none": null,
    "emoji": "🍕"
  };

  const dir = tempDirWithFiles("npmpkgcfg", {
    "package.json": JSON.stringify({
      config: vals,
      "scripts": {
        "dev": bunExe() + " run index.js"
      }
    }),
    "index.js": "console.log(JSON.stringify(process.env))"
  });

  const { stdout } = bunRunAsScript(dir, "dev");
  const jsStd = JSON.parse(stdout.toString())

  for (const [key, val] of Object.entries(vals)) {
    const jsVl = jsStd[`npm_package_config_${key}`];

    expect(jsVl).toBeTypeOf("string");

    if (val === false || val === null || val === "") {
      expect(jsVl).toEqual("\"\"");
      continue;
    }

    expect(jsVl).toEqual(val.toString());
  }

  // Now deep objects
  const deepDir = tempDirWithFiles("npmpkgcfg2", {
    "package.json": JSON.stringify({
      config: {
        "test": 1,
        "foo": {
          "bar": "baz",
          "buzz": {
            "fizz": "fuzz",
            "dave": "🕶️",
            "something": 1
          }
        }
      },
      "scripts": {
        "dev": bunExe() + " run index.js"
      }
    }),
    "index.js": "console.log(JSON.stringify(process.env))"
  });

  const { stdout: deepStdout } = bunRunAsScript(deepDir, "dev");
  const deepJsStd = JSON.parse(deepStdout.toString())

  expect(deepJsStd.npm_package_config_test).toEqual("1")
  expect(deepJsStd.npm_package_config_foo_bar).toEqual("baz");
  expect(deepJsStd.npm_package_config_foo_buzz_fizz).toEqual("fuzz");
  expect(deepJsStd.npm_package_config_foo_buzz_dave).toEqual("🕶️");
  expect(deepJsStd.npm_package_config_foo_buzz_something).toEqual("1");
});