import { file, spawn, write } from "bun";
import {
  bunExe,
  bunEnv as env,
  isLinux,
  isWindows,
  toBeValidBin,
  toHaveBins,
  writeShebangScript,
  tmpdirSync,
  toMatchNodeModulesAt,
  runBunInstall,
  runBunUpdate,
  tempDirWithFiles,
  randomPort,
  mergeWindowEnvs,
} from "harness";
import { join, sep, resolve } from "path";
import { mkdirSync, copyFileSync } from "fs";
import { rm, writeFile, mkdir, exists, cp, readlink } from "fs/promises";
import { readdirSorted } from "../dummy.registry";
import { fork, ChildProcess } from "child_process";
import { beforeAll, afterAll, beforeEach, test, expect, describe, it, setDefaultTimeout } from "bun:test";
import { install_test_helpers } from "bun:internal-for-testing";
const { parseLockfile } = install_test_helpers;
const { iniInternals } = require("bun:internal-for-testing");
const { loadNpmrc } = iniInternals;

expect.extend({
  toBeValidBin,
  toHaveBins,
  toMatchNodeModulesAt,
});

var verdaccioServer: ChildProcess;
var port: number = randomPort();
var packageDir: string;

let users: Record<string, string> = {};

beforeAll(async () => {
  console.log("STARTING VERDACCIO");
  setDefaultTimeout(1000 * 60 * 5);
  verdaccioServer = fork(
    require.resolve("verdaccio/bin/verdaccio"),
    ["-c", join(import.meta.dir, "verdaccio.yaml"), "-l", `${port}`],
    {
      silent: true,
      // Prefer using a release build of Bun since it's faster
      execPath: Bun.which("bun") || bunExe(),
    },
  );

  verdaccioServer.stderr?.on("data", data => {
    console.error(`Error: ${data}`);
  });

  verdaccioServer.on("error", error => {
    console.error(`Failed to start child process: ${error}`);
  });

  verdaccioServer.on("exit", (code, signal) => {
    if (code !== 0) {
      console.error(`Child process exited with code ${code} and signal ${signal}`);
    } else {
      console.log("Child process exited successfully");
    }
  });

  await new Promise<void>(done => {
    verdaccioServer.on("message", (msg: { verdaccio_started: boolean }) => {
      if (msg.verdaccio_started) {
        console.log("Verdaccio started");
        done();
      }
    });
  });
});

afterAll(async () => {
  await Bun.$`rm -f ${import.meta.dir}/htpasswd`.throws(false);
  if (verdaccioServer) verdaccioServer.kill();
});

beforeEach(async () => {
  packageDir = tmpdirSync();
  await Bun.$`rm -f ${import.meta.dir}/htpasswd`.throws(false);
  await Bun.$`rm -rf ${import.meta.dir}/packages/private-pkg-dont-touch`.throws(false);
  users = {};
  env.BUN_INSTALL_CACHE_DIR = join(packageDir, ".bun-cache");
  env.BUN_TMPDIR = env.TMPDIR = env.TEMP = join(packageDir, ".bun-tmp");
  await writeFile(
    join(packageDir, "bunfig.toml"),
    `
[install]
cache = false
registry = "http://localhost:${port}/"
`,
  );
});

/**
 * Returns auth token
 */
async function generateRegistryUser(username: string, password: string): Promise<string> {
  console.log("GENERATE REGISTRY USER");
  if (users[username]) {
    throw new Error("that user already exists");
  } else users[username] = password;

  const url = `http://localhost:${port}/-/user/org.couchdb.user:${username}`;
  const user = {
    name: username,
    password: password,
    email: `${username}@example.com`,
  };

  const response = await fetch(url, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(user),
  });

  if (response.ok) {
    const data = await response.json();
    console.log(`Token: ${data.token}`);
    return data.token;
  } else {
    throw new Error("Failed to create user:", response.statusText);
  }
}

describe("npmrc", async () => {
  const isBase64Encoded = (opt: string) => opt === "_auth" || opt === "_password";

  it("works with empty file", async () => {
    console.log("package dir", packageDir);
    await Bun.$`rm -rf ${packageDir}/bunfig.toml`;

    const ini = /* ini */ ``;

    await Bun.$`echo ${ini} > ${packageDir}/.npmrc`;
    await Bun.$`echo ${JSON.stringify({
      name: "foo",
      dependencies: {},
    })} > package.json`.cwd(packageDir);
    await Bun.$`${bunExe()} install`.cwd(packageDir).throws(true);
  });

  it("sets default registry", async () => {
    console.log("package dir", packageDir);
    await Bun.$`rm -rf ${packageDir}/bunfig.toml`;

    const ini = /* ini */ `
registry = http://localhost:${port}/
`;

    await Bun.$`echo ${ini} > ${packageDir}/.npmrc`;
    await Bun.$`echo ${JSON.stringify({
      name: "foo",
      dependencies: {
        "no-deps": "1.0.0",
      },
    })} > package.json`.cwd(packageDir);
    await Bun.$`${bunExe()} install`.cwd(packageDir).throws(true);
  });

  it("sets scoped registry", async () => {
    await Bun.$`rm -rf ${packageDir}/bunfig.toml`;

    const ini = /* ini */ `
  @types:registry=http://localhost:${port}/
  `;

    await Bun.$`echo ${ini} > ${packageDir}/.npmrc`;
    await Bun.$`echo ${JSON.stringify({
      name: "foo",
      dependencies: {
        "@types/no-deps": "1.0.0",
      },
    })} > package.json`.cwd(packageDir);
    await Bun.$`${bunExe()} install`.cwd(packageDir).throws(true);
  });

  it("default registry from env variable", async () => {
    const ini = /* ini */ `
registry=\${LOL}
  `;

    const result = loadNpmrc(ini, { LOL: `http://localhost:${port}/` });

    expect(result.default_registry_url).toBe(`http://localhost:${port}/`);
  });

  it("default registry from env variable 2", async () => {
    await Bun.$`rm -rf ${packageDir}/bunfig.toml`;

    const ini = /* ini */ `
registry=http://localhost:\${PORT}/
  `;

    const result = loadNpmrc(ini, { ...env, PORT: port });

    expect(result.default_registry_url).toEqual(`http://localhost:${port}/`);
  });

  async function makeTest(
    options: [option: string, value: string][],
    check: (result: {
      default_registry_url: string;
      default_registry_token: string;
      default_registry_username: string;
      default_registry_password: string;
    }) => void,
  ) {
    const optionName = await Promise.all(options.map(async ([name, val]) => `${name} = ${val}`));
    test(optionName.join(" "), async () => {
      await Bun.$`rm -rf ${packageDir}/bunfig.toml`;

      const iniInner = await Promise.all(
        options.map(async ([option, value]) => {
          let finalValue = value;
          finalValue = isBase64Encoded(option) ? Buffer.from(finalValue).toString("base64") : finalValue;
          return `//registry.npmjs.org/:${option}=${finalValue}`;
        }),
      );

      const ini = /* ini */ `
${iniInner.join("\n")}
`;

      await Bun.$`echo ${JSON.stringify({
        name: "hello",
        main: "index.js",
        version: "1.0.0",
        dependencies: {
          "is-even": "1.0.0",
        },
      })} > package.json`.cwd(packageDir);

      await Bun.$`echo ${ini} > ${packageDir}/.npmrc`;

      const result = loadNpmrc(ini);

      check(result);
    });
  }

  await makeTest([["_authToken", "skibidi"]], result => {
    expect(result.default_registry_url).toEqual("https://registry.npmjs.org/");
    expect(result.default_registry_token).toEqual("skibidi");
  });

  await makeTest(
    [
      ["username", "zorp"],
      ["_password", "skibidi"],
    ],
    result => {
      expect(result.default_registry_url).toEqual("https://registry.npmjs.org/");
      expect(result.default_registry_username).toEqual("zorp");
      expect(result.default_registry_password).toEqual("skibidi");
    },
  );

  it("authentication works", async () => {
    await Bun.$`rm -rf ${packageDir}/bunfig.toml`;

    const ini = /* ini */ `
registry = http://localhost:${port}/
//localhost:${port}/:_authToken=${await generateRegistryUser("bilbo_swaggins", "verysecure")}
`;

    await Bun.$`echo ${ini} > ${packageDir}/.npmrc`;
    await Bun.$`echo ${JSON.stringify({
      name: "hi",
      main: "index.js",
      version: "1.0.0",
      dependencies: {
        "@needs-auth/test-pkg": "1.0.0",
      },
      "publishConfig": {
        "registry": `http://localhost:${port}`,
      },
    })} > package.json`.cwd(packageDir);

    await Bun.$`${bunExe()} install`.env(env).cwd(packageDir).throws(true);
  });

  type EnvMap =
    | Omit<
        {
          [key: string]: string;
        },
        "dotEnv"
      >
    | { dotEnv?: Record<string, string> };

  function registryConfigOptionTest(
    name: string,
    _opts: Record<string, string> | (() => Promise<Record<string, string>>),
    _env?: EnvMap | (() => Promise<EnvMap>),
    check?: (stdout: string, stderr: string) => void,
  ) {
    it(`sets scoped registry option: ${name}`, async () => {
      console.log("PACKAGE DIR", packageDir);
      await Bun.$`rm -rf ${packageDir}/bunfig.toml`;

      const { dotEnv, ...restOfEnv } = _env
        ? typeof _env === "function"
          ? await _env()
          : _env
        : { dotEnv: undefined };
      const opts = _opts ? (typeof _opts === "function" ? await _opts() : _opts) : {};
      const dotEnvInner = dotEnv
        ? Object.entries(dotEnv)
            .map(([k, v]) => `${k}=${k.includes("SECRET_") ? Buffer.from(v).toString("base64") : v}`)
            .join("\n")
        : "";

      const ini = /* ini */ `
registry = http://localhost:${port}/
${Object.keys(opts)
  .map(
    k =>
      `//localhost:${port}/:${k}=${isBase64Encoded(k) && !opts[k].includes("${") ? Buffer.from(opts[k]).toString("base64") : opts[k]}`,
  )
  .join("\n")}
`;

      if (dotEnvInner.length > 0) await Bun.$`echo ${dotEnvInner} > ${packageDir}/.env`;
      await Bun.$`echo ${ini} > ${packageDir}/.npmrc`;
      await Bun.$`echo ${JSON.stringify({
        name: "hi",
        main: "index.js",
        version: "1.0.0",
        dependencies: {
          "@needs-auth/test-pkg": "1.0.0",
        },
        "publishConfig": {
          "registry": `http://localhost:${port}`,
        },
      })} > package.json`.cwd(packageDir);

      const { stdout, stderr } = await Bun.$`${bunExe()} install`
        .env({ ...env, ...restOfEnv })
        .cwd(packageDir)
        .throws(check === undefined);

      if (check) check(stdout.toString(), stderr.toString());
    });
  }

  registryConfigOptionTest("_authToken", async () => ({
    "_authToken": await generateRegistryUser("bilbo_baggins", "verysecure"),
  }));
  registryConfigOptionTest(
    "_authToken with env variable value",
    async () => ({ _authToken: "${SUPER_SECRET_TOKEN}" }),
    async () => ({ SUPER_SECRET_TOKEN: await generateRegistryUser("bilbo_baggins420", "verysecure") }),
  );
  registryConfigOptionTest("username and password", async () => {
    await generateRegistryUser("gandalf429", "verysecure");
    return { username: "gandalf429", _password: "verysecure" };
  });
  registryConfigOptionTest(
    "username and password with env variable password",
    async () => {
      await generateRegistryUser("gandalf422", "verysecure");
      return { username: "gandalf422", _password: "${SUPER_SECRET_PASSWORD}" };
    },
    {
      SUPER_SECRET_PASSWORD: Buffer.from("verysecure").toString("base64"),
    },
  );
  registryConfigOptionTest(
    "username and password with .env variable password",
    async () => {
      await generateRegistryUser("gandalf421", "verysecure");
      return { username: "gandalf421", _password: "${SUPER_SECRET_PASSWORD}" };
    },
    {
      dotEnv: { SUPER_SECRET_PASSWORD: "verysecure" },
    },
  );

  registryConfigOptionTest("_auth", async () => {
    await generateRegistryUser("linus", "verysecure");
    const _auth = "linus:verysecure";
    return { _auth };
  });

  registryConfigOptionTest(
    "_auth from .env variable",
    async () => {
      await generateRegistryUser("zack", "verysecure");
      return { _auth: "${SECRET_AUTH}" };
    },
    {
      dotEnv: { SECRET_AUTH: "zack:verysecure" },
    },
  );

  registryConfigOptionTest(
    "_auth from .env variable with no value",
    async () => {
      await generateRegistryUser("zack420", "verysecure");
      return { _auth: "${SECRET_AUTH}" };
    },
    {
      dotEnv: { SECRET_AUTH: "" },
    },
    (stdout: string, stderr: string) => {
      expect(stderr).toContain("got an empty string");
    },
  );
});

describe("package.json indentation", async () => {
  test("works for root and workspace packages", async () => {
    await Promise.all([
      // 5 space indentation
      write(join(packageDir, "package.json"), `\n{\n\n     "name": "foo",\n"workspaces": ["packages/*"]\n}`),
      // 1 tab indentation
      write(join(packageDir, "packages", "bar", "package.json"), `\n{\n\n\t"name": "bar",\n}`),
    ]);

    let { exited } = spawn({
      cmd: [bunExe(), "add", "no-deps"],
      cwd: packageDir,
      stdout: "ignore",
      stderr: "ignore",
      env,
    });

    expect(await exited).toBe(0);

    const rootPackageJson = await file(join(packageDir, "package.json")).text();

    expect(rootPackageJson).toBe(
      `{\n     "name": "foo",\n     "workspaces": ["packages/*"],\n     "dependencies": {\n          "no-deps": "^2.0.0"\n     }\n}`,
    );

    // now add to workspace. it should keep tab indentation
    ({ exited } = spawn({
      cmd: [bunExe(), "add", "no-deps"],
      cwd: join(packageDir, "packages", "bar"),
      stdout: "inherit",
      stderr: "inherit",
      env,
    }));

    expect(await exited).toBe(0);

    expect(await file(join(packageDir, "package.json")).text()).toBe(rootPackageJson);
    const workspacePackageJson = await file(join(packageDir, "packages", "bar", "package.json")).text();
    expect(workspacePackageJson).toBe(`{\n\t"name": "bar",\n\t"dependencies": {\n\t\t"no-deps": "^2.0.0"\n\t}\n}`);
  });
});

describe("optionalDependencies", () => {
  for (const optional of [true, false]) {
    test(`exit code is ${optional ? 0 : 1} when ${optional ? "optional" : ""} dependency tarball is missing`, async () => {
      await write(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "foo",
          [optional ? "optionalDependencies" : "dependencies"]: {
            "missing-tarball": "1.0.0",
            "uses-what-bin": "1.0.0",
          },
          "trustedDependencies": ["uses-what-bin"],
        }),
      );

      const { exited, err } = await runBunInstall(env, packageDir, {
        [optional ? "allowWarnings" : "allowErrors"]: true,
        expectedExitCode: optional ? 0 : 1,
        savesLockfile: false,
      });
      expect(err).toContain(
        `${optional ? "warn" : "error"}: GET http://localhost:${port}/missing-tarball/-/missing-tarball-1.0.0.tgz - `,
      );
      expect(await exited).toBe(optional ? 0 : 1);
      expect(await readdirSorted(join(packageDir, "node_modules"))).toEqual([
        ".bin",
        ".cache",
        "uses-what-bin",
        "what-bin",
      ]);
      expect(await exists(join(packageDir, "node_modules", "uses-what-bin", "what-bin.txt"))).toBeTrue();
    });
  }

  for (const rootOptional of [true, false]) {
    test(`exit code is 0 when ${rootOptional ? "root" : ""} optional dependency does not exist in registry`, async () => {
      await write(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "foo",
          [rootOptional ? "optionalDependencies" : "dependencies"]: {
            [rootOptional ? "this-package-does-not-exist-in-the-registry" : "has-missing-optional-dep"]: "||",
          },
        }),
      );

      const { err } = await runBunInstall(env, packageDir, {
        allowWarnings: true,
        savesLockfile: !rootOptional,
      });

      expect(err).toMatch(`warn: GET http://localhost:${port}/this-package-does-not-exist-in-the-registry - 404`);
    });
  }
});

test("tarball override does not crash", async () => {
  await write(
    join(packageDir, "package.json"),
    JSON.stringify({
      name: "foo",
      dependencies: {
        "two-range-deps": "||",
      },
      overrides: {
        "no-deps": `http://localhost:${port}/no-deps/-/no-deps-2.0.0.tgz`,
      },
    }),
  );

  await runBunInstall(env, packageDir);

  expect(await file(join(packageDir, "node_modules", "no-deps", "package.json")).json()).toMatchObject({
    name: "no-deps",
    version: "2.0.0",
  });
});

describe.each(["--production", "without --production"])("%s", flag => {
  const prod = flag === "--production";
  const order = ["devDependencies", "dependencies"];
  // const stdio = process.versions.bun.includes("debug") ? "inherit" : "ignore";
  const stdio = "ignore";

  if (prod) {
    test("modifying package.json with --production should not save lockfile", async () => {
      await writeFile(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "1.0.0",
          dependencies: {
            "bin-change-dir": "1.0.0",
          },
          devDependencies: {
            "bin-change-dir": "1.0.1",
            "basic-1": "1.0.0",
          },
        }),
      );

      var { exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: stdio,
        stdin: stdio,
        stderr: stdio,
        env,
      });

      expect(await exited).toBe(0);

      const initialHash = Bun.hash(await file(join(packageDir, "bun.lockb")).arrayBuffer());

      expect(await file(join(packageDir, "node_modules", "bin-change-dir", "package.json")).json()).toMatchObject({
        name: "bin-change-dir",
        version: "1.0.1",
      });

      var { exited } = spawn({
        cmd: [bunExe(), "install", "--production"],
        cwd: packageDir,
        stdout: stdio,
        stdin: stdio,
        stderr: stdio,
        env,
      });

      expect(await exited).toBe(0);

      expect(await file(join(packageDir, "node_modules", "bin-change-dir", "package.json")).json()).toMatchObject({
        name: "bin-change-dir",
        version: "1.0.0",
      });

      var { exited } = spawn({
        cmd: [bunExe(), "install", "--production", "bin-change-dir@1.0.1"],
        cwd: packageDir,
        stdout: stdio,
        stdin: stdio,
        stderr: stdio,
        env,
      });

      expect(await exited).toBe(1);

      // We should not have saved bun.lockb
      expect(Bun.hash(await file(join(packageDir, "bun.lockb")).arrayBuffer())).toBe(initialHash);

      // We should not have installed bin-change-dir@1.0.1
      expect(await file(join(packageDir, "node_modules", "bin-change-dir", "package.json")).json()).toMatchObject({
        name: "bin-change-dir",
        version: "1.0.0",
      });

      // This is a no-op. It should work.
      var { exited } = spawn({
        cmd: [bunExe(), "install", "--production", "bin-change-dir@1.0.0"],
        cwd: packageDir,
        stdout: stdio,
        stdin: stdio,
        stderr: stdio,
        env,
      });

      expect(await exited).toBe(0);

      // We should not have saved bun.lockb
      expect(Bun.hash(await file(join(packageDir, "bun.lockb")).arrayBuffer())).toBe(initialHash);

      // We should have installed bin-change-dir@1.0.0
      expect(await file(join(packageDir, "node_modules", "bin-change-dir", "package.json")).json()).toMatchObject({
        name: "bin-change-dir",
        version: "1.0.0",
      });
    });
  }

  test(`should prefer ${order[+prod % 2]} over ${order[1 - (+prod % 2)]}`, async () => {
    await writeFile(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "foo",
        version: "1.0.0",
        dependencies: {
          "bin-change-dir": "1.0.0",
        },
        devDependencies: {
          "bin-change-dir": "1.0.1",
          "basic-1": "1.0.0",
        },
      }),
    );

    let initialLockfileHash;
    async function saveWithoutProd() {
      var hash;
      // First install without --production
      // so that the lockfile is up to date
      var { exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: stdio,
        stdin: stdio,
        stderr: stdio,
        env,
      });
      expect(await exited).toBe(0);

      await Promise.all([
        (async () =>
          expect(await file(join(packageDir, "node_modules", "bin-change-dir", "package.json")).json()).toMatchObject({
            name: "bin-change-dir",
            version: "1.0.1",
          }))(),
        (async () =>
          expect(await file(join(packageDir, "node_modules", "basic-1", "package.json")).json()).toMatchObject({
            name: "basic-1",
            version: "1.0.0",
          }))().then(
          async () => await rm(join(packageDir, "node_modules", "basic-1"), { recursive: true, force: true }),
        ),

        (async () => (hash = Bun.hash(await file(join(packageDir, "bun.lockb")).arrayBuffer())))(),
      ]);

      return hash;
    }
    if (prod) {
      initialLockfileHash = await saveWithoutProd();
    }

    var { exited } = spawn({
      cmd: [bunExe(), "install", prod ? "--production" : ""].filter(Boolean),
      cwd: packageDir,
      stdout: stdio,
      stdin: stdio,
      stderr: stdio,
      env,
    });

    expect(await exited).toBe(0);
    expect(await file(join(packageDir, "node_modules", "bin-change-dir", "package.json")).json()).toMatchObject({
      name: "bin-change-dir",
      version: prod ? "1.0.0" : "1.0.1",
    });

    if (!prod) {
      expect(await file(join(packageDir, "node_modules", "basic-1", "package.json")).json()).toMatchObject({
        name: "basic-1",
        version: "1.0.0",
      });
    } else {
      // it should not install devDependencies
      expect(await exists(join(packageDir, "node_modules", "basic-1"))).toBeFalse();

      // it should not mutate the lockfile when there were no changes to begin with.
      const newHash = Bun.hash(await file(join(packageDir, "bun.lockb")).arrayBuffer());

      expect(newHash).toBe(initialLockfileHash!);
    }

    if (prod) {
      // lets now try to install again without --production
      const newHash = await saveWithoutProd();
      expect(newHash).toBe(initialLockfileHash);
    }
  });
});

test("hardlinks on windows dont fail with long paths", async () => {
  await mkdir(join(packageDir, "a-package"));
  await writeFile(
    join(packageDir, "a-package", "package.json"),
    JSON.stringify({
      name: "a-package",
      version: "1.0.0",
    }),
  );

  await writeFile(
    join(packageDir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "1.2.3",
      dependencies: {
        // 255 characters
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa":
          "file:./a-package",
      },
    }),
  );

  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: packageDir,
    stdout: "pipe",
    stderr: "pipe",
    env,
  });

  const err = await Bun.readableStreamToText(stderr);
  const out = await Bun.readableStreamToText(stdout);
  expect(err).toContain("Saved lockfile");
  expect(err).not.toContain("not found");
  expect(err).not.toContain("error:");
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    "",
    "+ aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa@a-package",
    "",
    "1 package installed",
  ]);
  expect(await exited).toBe(0);
});

test("basic 1", async () => {
  await writeFile(
    join(packageDir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "1.0.0",
      dependencies: {
        "basic-1": "1.0.0",
      },
    }),
  );
  var { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: packageDir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  var err = await new Response(stderr).text();
  var out = await new Response(stdout).text();
  expect(err).toContain("Saved lockfile");
  expect(err).not.toContain("not found");
  expect(err).not.toContain("error:");
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    "",
    "+ basic-1@1.0.0",
    "",
    "1 package installed",
  ]);
  expect(await file(join(packageDir, "node_modules", "basic-1", "package.json")).json()).toEqual({
    name: "basic-1",
    version: "1.0.0",
  } as any);
  expect(await exited).toBe(0);

  await rm(join(packageDir, "node_modules"), { recursive: true, force: true });

  ({ stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: packageDir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  }));

  err = await new Response(stderr).text();
  out = await new Response(stdout).text();
  expect(err).not.toContain("Saved lockfile");
  expect(err).not.toContain("not found");
  expect(err).not.toContain("error:");
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    "",
    "+ basic-1@1.0.0",
    "",
    "1 package installed",
  ]);
  expect(await exited).toBe(0);
});

test("manifest cache will invalidate when registry changes", async () => {
  const cacheDir = join(packageDir, ".bun-cache");
  await Promise.all([
    write(
      join(packageDir, "bunfig.toml"),
      `
[install]
cache = "${cacheDir}"
registry = "http://localhost:${port}"
      `,
    ),
    write(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "foo",
        dependencies: {
          // is-number exists in our custom registry and in npm. Switching the registry should invalidate
          // the manifest cache, the package could be a completely different package.
          "is-number": "2.0.0",
        },
      }),
    ),
  ]);

  // first install this package from verdaccio
  await runBunInstall(env, packageDir);
  const lockfile = await parseLockfile(packageDir);
  for (const pkg of Object.values(lockfile.packages) as any) {
    if (pkg.tag === "npm") {
      expect(pkg.resolution.resolved).toContain(`http://localhost:${port}`);
    }
  }

  // now use default registry
  await Promise.all([
    rm(join(packageDir, "node_modules"), { force: true, recursive: true }),
    rm(join(packageDir, "bun.lockb"), { force: true }),
    write(
      join(packageDir, "bunfig.toml"),
      `
[install]
cache = "${cacheDir}"
`,
    ),
  ]);

  await runBunInstall(env, packageDir);
  const npmLockfile = await parseLockfile(packageDir);
  for (const pkg of Object.values(npmLockfile.packages) as any) {
    if (pkg.tag === "npm") {
      expect(pkg.resolution.resolved).not.toContain(`http://localhost:${port}`);
    }
  }
});

test("dependency from root satisfies range from dependency", async () => {
  await writeFile(
    join(packageDir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "1.0.0",
      dependencies: {
        "one-range-dep": "1.0.0",
        "no-deps": "1.0.0",
      },
    }),
  );

  var { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: packageDir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  });

  var err = await new Response(stderr).text();
  var out = await new Response(stdout).text();
  expect(err).toContain("Saved lockfile");
  expect(err).not.toContain("not found");
  expect(err).not.toContain("error:");
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    "",
    "+ no-deps@1.0.0",
    "+ one-range-dep@1.0.0",
    "",
    "2 packages installed",
  ]);
  expect(await file(join(packageDir, "node_modules", "no-deps", "package.json")).json()).toEqual({
    name: "no-deps",
    version: "1.0.0",
  } as any);
  expect(await exited).toBe(0);

  await rm(join(packageDir, "node_modules"), { recursive: true, force: true });

  ({ stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: packageDir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  }));

  err = await new Response(stderr).text();
  out = await new Response(stdout).text();
  expect(err).not.toContain("Saved lockfile");
  expect(err).not.toContain("not found");
  expect(err).not.toContain("error:");
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    "",
    "+ no-deps@1.0.0",
    "+ one-range-dep@1.0.0",
    "",
    "2 packages installed",
  ]);
  expect(await exited).toBe(0);
});

test("duplicate names and versions in a manifest do not install incorrect packages", async () => {
  /**
   * `duplicate-name-and-version` has two versions:
   *   1.0.1:
   *   dependencies: {
   *       "no-deps": "a-dep"
   *   }
   *   1.0.2:
   *   dependencies: {
   *       "a-dep": "1.0.1"
   *   }
   * Note: version for `no-deps` is the same as second dependency name.
   *
   * When this manifest is parsed, the strings for dependency names and versions are stored
   * with different lists offset length pairs, but we were deduping with the same map. Since
   * the version of the first dependency is the same as the name as the second, it would try to
   * dedupe them, and doing so would give the wrong name for the deduped dependency.
   * (`a-dep@1.0.1` would become `no-deps@1.0.1`)
   */
  await write(
    join(packageDir, "package.json"),
    JSON.stringify({
      name: "foo",
      dependencies: {
        "duplicate-name-and-version": "1.0.2",
      },
    }),
  );

  await runBunInstall(env, packageDir);
  const lockfile = parseLockfile(packageDir);
  expect(lockfile).toMatchNodeModulesAt(packageDir);
  const results = await Promise.all([
    file(join(packageDir, "node_modules", "duplicate-name-and-version", "package.json")).json(),
    file(join(packageDir, "node_modules", "a-dep", "package.json")).json(),
    exists(join(packageDir, "node_modules", "no-deps")),
  ]);

  expect(results).toMatchObject([
    { name: "duplicate-name-and-version", version: "1.0.2" },
    { name: "a-dep", version: "1.0.1" },
    false,
  ]);
});

describe("peerDependency index out of bounds", async () => {
  // Test for "index of out bounds" errors with peer dependencies when adding/removing a package
  //
  // Repro:
  // - Install `1-peer-dep-a`. It depends on peer dep `no-deps@1.0.0`.
  // - Replace `1-peer-dep-a` with `1-peer-dep-b` (identical other than name), delete manifest cache and
  //   node_modules, then reinstall.
  // - `no-deps` will enqueue a dependency id that goes out of bounds

  const dependencies = ["1-peer-dep-a", "1-peer-dep-b", "2-peer-deps-c"];

  for (const firstDep of dependencies) {
    for (const secondDep of dependencies) {
      if (firstDep === secondDep) continue;
      test(`replacing ${firstDep} with ${secondDep}`, async () => {
        await write(
          join(packageDir, "package.json"),
          JSON.stringify({
            name: "foo",
            dependencies: {
              [firstDep]: "1.0.0",
            },
          }),
        );

        await runBunInstall(env, packageDir);
        const lockfile = parseLockfile(packageDir);
        expect(lockfile).toMatchNodeModulesAt(packageDir);
        const results = await Promise.all([
          file(join(packageDir, "node_modules", "no-deps", "package.json")).json(),
          file(join(packageDir, "node_modules", firstDep, "package.json")).json(),
          exists(join(packageDir, "node_modules", firstDep, "node_modules", "no-deps")),
        ]);

        expect(results).toMatchObject([
          { name: "no-deps", version: "1.0.0" },
          { name: firstDep, version: "1.0.0" },
          false,
        ]);

        await Promise.all([
          rm(join(packageDir, "node_modules"), { recursive: true, force: true }),
          write(
            join(packageDir, "package.json"),
            JSON.stringify({
              name: "foo",
              dependencies: {
                [secondDep]: "1.0.0",
              },
            }),
          ),
        ]);

        await runBunInstall(env, packageDir);
        const newLockfile = parseLockfile(packageDir);
        expect(newLockfile).toMatchNodeModulesAt(packageDir);
        const newResults = await Promise.all([
          file(join(packageDir, "node_modules", "no-deps", "package.json")).json(),
          file(join(packageDir, "node_modules", secondDep, "package.json")).json(),
          exists(join(packageDir, "node_modules", secondDep, "node_modules", "no-deps")),
        ]);

        expect(newResults).toMatchObject([
          { name: "no-deps", version: "1.0.0" },
          { name: secondDep, version: "1.0.0" },
          false,
        ]);
      });
    }
  }

  // Install 2 dependencies, one is a normal dependency, the other is a dependency with a optional
  // peer dependency on the first dependency. Delete node_modules and cache, then update the dependency
  // with the optional peer to a new version. Doing this will cause the peer dependency to get enqueued
  // internally, testing for index out of bounds. It's also important cache is deleted to ensure a tarball
  // task is created for it.
  test("optional", async () => {
    await write(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "foo",
        dependencies: {
          "optional-peer-deps": "1.0.0",
          "no-deps": "1.0.0",
        },
      }),
    );

    await runBunInstall(env, packageDir);

    // update version and delete node_modules and cache
    await Promise.all([
      write(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "foo",
          dependencies: {
            "optional-peer-deps": "1.0.1",
            "no-deps": "1.0.0",
          },
        }),
      ),
      rm(join(packageDir, "node_modules"), { recursive: true, force: true }),
    ]);

    // this install would trigger the index out of bounds error
    await runBunInstall(env, packageDir);
    const lockfile = parseLockfile(packageDir);
    expect(lockfile).toMatchNodeModulesAt(packageDir);
  });
});

test("peerDependency in child npm dependency should not maintain old version when package is upgraded", async () => {
  await writeFile(
    join(packageDir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "1.0.0",
      dependencies: {
        "peer-deps-fixed": "1.0.0",
        "no-deps": "1.0.0",
      },
    }),
  );

  var { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: packageDir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  });

  var err = await new Response(stderr).text();
  var out = await new Response(stdout).text();
  expect(err).toContain("Saved lockfile");
  expect(err).not.toContain("not found");
  expect(err).not.toContain("error:");
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    "",
    "+ no-deps@1.0.0",
    "+ peer-deps-fixed@1.0.0",
    "",
    "2 packages installed",
  ]);
  expect(await file(join(packageDir, "node_modules", "no-deps", "package.json")).json()).toEqual({
    name: "no-deps",
    version: "1.0.0",
  } as any);
  expect(await exited).toBe(0);

  await writeFile(
    join(packageDir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "1.0.0",
      dependencies: {
        "peer-deps-fixed": "1.0.0",
        "no-deps": "1.0.1", // upgrade the package
      },
    }),
  );

  ({ stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: packageDir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  }));

  err = await new Response(stderr).text();
  out = await new Response(stdout).text();
  expect(err).not.toContain("not found");
  expect(err).not.toContain("error:");
  expect(await file(join(packageDir, "node_modules", "no-deps", "package.json")).json()).toEqual({
    name: "no-deps",
    version: "1.0.1",
  } as any);
  expect(await exists(join(packageDir, "node_modules", "peer-deps-fixed", "node_modules"))).toBeFalse();
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    "",
    "+ no-deps@1.0.1",
    "",
    "1 package installed",
  ]);
  expect(await exited).toBe(0);
});

test("package added after install", async () => {
  await writeFile(
    join(packageDir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "1.0.0",
      dependencies: {
        "one-range-dep": "1.0.0",
      },
    }),
  );

  var { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: packageDir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  });

  var err = await new Response(stderr).text();
  var out = await new Response(stdout).text();
  expect(err).toContain("Saved lockfile");
  expect(err).not.toContain("not found");
  expect(err).not.toContain("error:");
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    "",
    "+ one-range-dep@1.0.0",
    "",
    "2 packages installed",
  ]);
  expect(await file(join(packageDir, "node_modules", "no-deps", "package.json")).json()).toEqual({
    name: "no-deps",
    version: "1.1.0",
  } as any);
  expect(await exited).toBe(0);

  // add `no-deps` to root package.json with a smaller but still compatible
  // version for `one-range-dep`.
  await writeFile(
    join(packageDir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "1.0.0",
      dependencies: {
        "one-range-dep": "1.0.0",
        "no-deps": "1.0.0",
      },
    }),
  );

  ({ stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: packageDir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  }));

  err = await new Response(stderr).text();
  out = await new Response(stdout).text();
  expect(err).toContain("Saved lockfile");
  expect(err).not.toContain("not found");
  expect(err).not.toContain("error:");
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    "",
    "+ no-deps@1.0.0",
    "",
    "2 packages installed",
  ]);
  expect(await file(join(packageDir, "node_modules", "no-deps", "package.json")).json()).toEqual({
    name: "no-deps",
    version: "1.0.0",
  } as any);
  expect(
    await file(join(packageDir, "node_modules", "one-range-dep", "node_modules", "no-deps", "package.json")).json(),
  ).toEqual({
    name: "no-deps",
    version: "1.1.0",
  } as any);
  expect(await exited).toBe(0);

  await rm(join(packageDir, "node_modules"), { recursive: true, force: true });

  ({ stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: packageDir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  }));

  err = await new Response(stderr).text();
  out = await new Response(stdout).text();
  expect(err).not.toContain("Saved lockfile");
  expect(err).not.toContain("not found");
  expect(err).not.toContain("error:");
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    "",
    "+ no-deps@1.0.0",
    "+ one-range-dep@1.0.0",
    "",
    "3 packages installed",
  ]);
  expect(await exited).toBe(0);
});

test("--production excludes devDependencies in workspaces", async () => {
  await Promise.all([
    write(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "foo",
        workspaces: ["packages/*"],
        dependencies: {
          "no-deps": "1.0.0",
        },
        devDependencies: {
          "a1": "npm:no-deps@1.0.0",
        },
      }),
    ),
    write(
      join(packageDir, "packages", "pkg1", "package.json"),
      JSON.stringify({
        name: "pkg1",
        dependencies: {
          "a-dep": "1.0.2",
        },
        devDependencies: {
          "a2": "npm:a-dep@1.0.2",
        },
      }),
    ),
    write(
      join(packageDir, "packages", "pkg2", "package.json"),
      JSON.stringify({
        name: "pkg2",
        devDependencies: {
          "a3": "npm:a-dep@1.0.3",
          "a4": "npm:a-dep@1.0.4",
          "a5": "npm:a-dep@1.0.5",
        },
      }),
    ),
  ]);

  // without lockfile
  const expectedResults = [
    [".cache", "a-dep", "no-deps", "pkg1", "pkg2"],
    { name: "no-deps", version: "1.0.0" },
    { name: "a-dep", version: "1.0.2" },
  ];
  let { out } = await runBunInstall(env, packageDir, { production: true });
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    "",
    "+ no-deps@1.0.0",
    "",
    "4 packages installed",
  ]);
  let results = await Promise.all([
    readdirSorted(join(packageDir, "node_modules")),
    file(join(packageDir, "node_modules", "no-deps", "package.json")).json(),
    file(join(packageDir, "node_modules", "a-dep", "package.json")).json(),
  ]);

  expect(results).toMatchObject(expectedResults);

  // create non-production lockfile, then install with --production
  await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
  ({ out } = await runBunInstall(env, packageDir));
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    "",
    "+ a1@1.0.0",
    "+ no-deps@1.0.0",
    "",
    "7 packages installed",
  ]);
  await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
  ({ out } = await runBunInstall(env, packageDir, { production: true }));
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    "",
    "+ no-deps@1.0.0",
    "",
    "4 packages installed",
  ]);
  results = await Promise.all([
    readdirSorted(join(packageDir, "node_modules")),
    file(join(packageDir, "node_modules", "no-deps", "package.json")).json(),
    file(join(packageDir, "node_modules", "a-dep", "package.json")).json(),
  ]);
  expect(results).toMatchObject(expectedResults);
});

test("--production without a lockfile will install and not save lockfile", async () => {
  await writeFile(
    join(packageDir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "1.2.3",
      dependencies: {
        "no-deps": "1.0.0",
      },
    }),
  );

  var { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install", "--production"],
    cwd: packageDir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  });

  const out = await Bun.readableStreamToText(stdout);
  const err = await Bun.readableStreamToText(stderr);
  expect(err).not.toContain("Saved lockfile");
  expect(err).not.toContain("not found");
  expect(err).not.toContain("error:");
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    "",
    "+ no-deps@1.0.0",
    "",
    "1 package installed",
  ]);
  expect(await exited).toBe(0);

  expect(await exists(join(packageDir, "node_modules", "no-deps", "index.js"))).toBeTrue();
});

describe("binaries", () => {
  for (const global of [false, true]) {
    describe(`existing destinations${global ? " (global)" : ""}`, () => {
      test("existing non-symlink", async () => {
        await Promise.all([
          write(
            join(packageDir, "package.json"),
            JSON.stringify({
              name: "foo",
              dependencies: {
                "what-bin": "1.0.0",
              },
            }),
          ),
          write(join(packageDir, "node_modules", ".bin", "what-bin"), "hi"),
        ]);

        await runBunInstall(env, packageDir);
        expect(join(packageDir, "node_modules", ".bin", "what-bin")).toBeValidBin(
          join("..", "what-bin", "what-bin.js"),
        );
      });
    });
  }
  test("it should correctly link binaries after deleting node_modules", async () => {
    const json: any = {
      name: "foo",
      version: "1.0.0",
      dependencies: {
        "what-bin": "1.0.0",
        "uses-what-bin": "1.5.0",
      },
    };
    await writeFile(join(packageDir, "package.json"), JSON.stringify(json));

    var { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    });

    var err = await new Response(stderr).text();
    var out = await new Response(stdout).text();
    expect(err).toContain("Saved lockfile");
    expect(err).not.toContain("not found");
    expect(err).not.toContain("error:");
    expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
      "",
      "+ uses-what-bin@1.5.0",
      "+ what-bin@1.0.0",
      "",
      expect.stringContaining("3 packages installed"),
      "",
      "Blocked 1 postinstall. Run `bun pm untrusted` for details.",
      "",
    ]);
    expect(await exited).toBe(0);

    await rm(join(packageDir, "node_modules"), { recursive: true, force: true });

    ({ stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    }));

    err = await new Response(stderr).text();
    out = await new Response(stdout).text();
    expect(err).not.toContain("Saved lockfile");
    expect(err).not.toContain("not found");
    expect(err).not.toContain("error:");
    expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
      "",
      "+ uses-what-bin@1.5.0",
      "+ what-bin@1.0.0",
      "",
      expect.stringContaining("3 packages installed"),
      "",
      "Blocked 1 postinstall. Run `bun pm untrusted` for details.",
      "",
    ]);
    expect(await exited).toBe(0);
  });

  test("will link binaries for packages installed multiple times", async () => {
    await Promise.all([
      write(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "1.0.0",
          dependencies: {
            "uses-what-bin": "1.5.0",
          },
          workspaces: ["packages/*"],
          trustedDependencies: ["uses-what-bin"],
        }),
      ),
      write(
        join(packageDir, "packages", "pkg1", "package.json"),
        JSON.stringify({
          name: "pkg1",
          dependencies: {
            "uses-what-bin": "1.0.0",
          },
        }),
      ),
      write(
        join(packageDir, "packages", "pkg2", "package.json"),
        JSON.stringify({
          name: "pkg2",
          dependencies: {
            "uses-what-bin": "1.0.0",
          },
        }),
      ),
    ]);

    // Root dependends on `uses-what-bin@1.5.0` and both packages depend on `uses-what-bin@1.0.0`.
    // This test makes sure the binaries used by `pkg1` and `pkg2` are the correct version (`1.0.0`)
    // instead of using the root version (`1.5.0`).

    await runBunInstall(env, packageDir);
    const results = await Promise.all([
      file(join(packageDir, "node_modules", "uses-what-bin", "what-bin.txt")).text(),
      file(join(packageDir, "packages", "pkg1", "node_modules", "uses-what-bin", "what-bin.txt")).text(),
      file(join(packageDir, "packages", "pkg2", "node_modules", "uses-what-bin", "what-bin.txt")).text(),
    ]);

    expect(results).toEqual(["what-bin@1.5.0", "what-bin@1.0.0", "what-bin@1.0.0"]);
  });

  test("it should re-symlink binaries that become invalid when updating package versions", async () => {
    await writeFile(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "foo",
        version: "1.0.0",
        dependencies: {
          "bin-change-dir": "1.0.0",
        },
        scripts: {
          postinstall: "bin-change-dir",
        },
      }),
    );

    var { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    });

    var err = await new Response(stderr).text();
    var out = await new Response(stdout).text();
    expect(err).toContain("Saved lockfile");
    expect(err).not.toContain("not found");
    expect(err).not.toContain("error:");
    expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
      "",
      "+ bin-change-dir@1.0.0",
      "",
      "1 package installed",
    ]);
    expect(await exited).toBe(0);
    expect(await file(join(packageDir, "bin-1.0.0.txt")).text()).toEqual("success!");
    expect(await exists(join(packageDir, "bin-1.0.1.txt"))).toBeFalse();

    await writeFile(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "foo",
        version: "1.0.0",
        dependencies: {
          "bin-change-dir": "1.0.1",
        },
        scripts: {
          postinstall: "bin-change-dir",
        },
      }),
    );

    ({ stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    }));

    err = await new Response(stderr).text();
    out = await new Response(stdout).text();
    expect(err).toContain("Saved lockfile");
    expect(err).not.toContain("not found");
    expect(err).not.toContain("error:");
    expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
      "",
      "+ bin-change-dir@1.0.1",
      "",
      "1 package installed",
    ]);
    expect(await exited).toBe(0);
    expect(await file(join(packageDir, "bin-1.0.0.txt")).text()).toEqual("success!");
    expect(await file(join(packageDir, "bin-1.0.1.txt")).text()).toEqual("success!");
  });
  for (const global of [false, true]) {
    test(`bin types${global ? " (global)" : ""}`, async () => {
      if (global) {
        await write(
          join(packageDir, "bunfig.toml"),
          `
          [install]
          cache = false
          registry = "http://localhost:${port}/"
          globalBinDir = "${join(packageDir, "global-bin-dir").replace(/\\/g, "\\\\")}"
          `,
        );
      } else {
        await write(
          join(packageDir, "package.json"),
          JSON.stringify({
            name: "foo",
          }),
        );
      }

      const args = [
        bunExe(),
        "install",
        ...(global ? ["-g"] : []),
        ...(global ? [`--config=${join(packageDir, "bunfig.toml")}`] : []),
        "dep-with-file-bin",
        "dep-with-single-entry-map-bin",
        "dep-with-directory-bins",
        "dep-with-map-bins",
      ];
      const { stdout, stderr, exited } = spawn({
        cmd: args,
        cwd: packageDir,
        stdout: "pipe",
        stderr: "pipe",
        env: global ? { ...env, BUN_INSTALL: join(packageDir, "global-install-dir") } : env,
      });

      const err = await Bun.readableStreamToText(stderr);
      expect(err).not.toContain("error:");

      const out = await Bun.readableStreamToText(stdout);
      expect(await exited).toBe(0);

      const cwd = global ? join(packageDir, "global-bin-dir") : packageDir;

      await runBin("dep-with-file-bin", "file-bin\n", cwd, global);
      await runBin("single-entry-map-bin", "single-entry-map-bin\n", cwd, global);
      await runBin("directory-bin-1", "directory-bin-1\n", cwd, global);
      await runBin("directory-bin-2", "directory-bin-2\n", cwd, global);
      await runBin("map-bin-1", "map-bin-1\n", cwd, global);
      await runBin("map-bin-2", "map-bin-2\n", cwd, global);
    });
  }

  async function runBin(binName: string, expected: string, cwd: string, global: boolean) {
    const args = [bunExe(), ...(global ? ["run"] : []), `${!isWindows && global ? "./" : ""}${binName}`];
    const result = Bun.spawn({
      cmd: args,
      stdout: "pipe",
      stderr: "pipe",
      cwd,
      env,
    });

    const out = await Bun.readableStreamToText(result.stdout);
    expect(out).toEqual(expected);
    const err = await Bun.readableStreamToText(result.stderr);
    expect(err).toBeEmpty();
    expect(await result.exited).toBe(0);
  }
});

test("it should install with missing bun.lockb, node_modules, and/or cache", async () => {
  // first clean install
  await writeFile(
    join(packageDir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "1.0.0",
      dependencies: {
        "what-bin": "1.0.0",
        "uses-what-bin": "1.5.0",
        "optional-native": "1.0.0",
        "peer-deps-too": "1.0.0",
        "two-range-deps": "1.0.0",
        "one-fixed-dep": "2.0.0",
        "no-deps-bins": "2.0.0",
        "left-pad": "1.0.0",
        "native": "1.0.0",
        "dep-loop-entry": "1.0.0",
        "dep-with-tags": "3.0.0",
        "dev-deps": "1.0.0",
      },
    }),
  );

  var { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: packageDir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  });

  var err = await new Response(stderr).text();
  var out = await new Response(stdout).text();
  expect(err).toContain("Saved lockfile");
  expect(err).not.toContain("not found");
  expect(err).not.toContain("error:");
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    "",
    "+ dep-loop-entry@1.0.0",
    "+ dep-with-tags@3.0.0",
    "+ dev-deps@1.0.0",
    "+ left-pad@1.0.0",
    "+ native@1.0.0",
    "+ no-deps-bins@2.0.0",
    "+ one-fixed-dep@2.0.0",
    "+ optional-native@1.0.0",
    "+ peer-deps-too@1.0.0",
    "+ two-range-deps@1.0.0",
    "+ uses-what-bin@1.5.0",
    "+ what-bin@1.0.0",
    "",
    expect.stringContaining("19 packages installed"),
    "",
    "Blocked 1 postinstall. Run `bun pm untrusted` for details.",
    "",
  ]);
  expect(await exited).toBe(0);

  let lockfile = parseLockfile(packageDir);
  expect(lockfile).toMatchNodeModulesAt(packageDir);

  // delete node_modules
  await rm(join(packageDir, "node_modules"), { recursive: true, force: true });

  ({ stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: packageDir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  }));

  [err, out] = await Promise.all([new Response(stderr).text(), new Response(stdout).text()]);

  expect(err).not.toContain("Saved lockfile");
  expect(err).not.toContain("not found");
  expect(err).not.toContain("error:");
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    "",
    "+ dep-loop-entry@1.0.0",
    "+ dep-with-tags@3.0.0",
    "+ dev-deps@1.0.0",
    "+ left-pad@1.0.0",
    "+ native@1.0.0",
    "+ no-deps-bins@2.0.0",
    "+ one-fixed-dep@2.0.0",
    "+ optional-native@1.0.0",
    "+ peer-deps-too@1.0.0",
    "+ two-range-deps@1.0.0",
    "+ uses-what-bin@1.5.0",
    "+ what-bin@1.0.0",
    "",
    expect.stringContaining("19 packages installed"),
    "",
    "Blocked 1 postinstall. Run `bun pm untrusted` for details.",
    "",
  ]);
  expect(await exited).toBe(0);

  lockfile = parseLockfile(packageDir);
  expect(lockfile).toMatchNodeModulesAt(packageDir);

  for (var i = 0; i < 100; i++) {
    // Situation:
    //
    // Root package has a dependency on one-fixed-dep, peer-deps-too and two-range-deps.
    // Each of these dependencies depends on no-deps.
    //
    // - one-fixed-dep: no-deps@2.0.0
    // - two-range-deps: no-deps@^1.0.0 (will choose 1.1.0)
    // - peer-deps-too: peer no-deps@*
    //
    // We want peer-deps-too to choose the version of no-deps from one-fixed-dep because
    // it's the highest version. It should hoist to the root.

    // delete bun.lockb
    await rm(join(packageDir, "bun.lockb"), { recursive: true, force: true });

    ({ stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    }));

    [err, out] = await Promise.all([new Response(stderr).text(), new Response(stdout).text()]);

    expect(err).toContain("Saved lockfile");
    expect(err).not.toContain("not found");
    expect(err).not.toContain("error:");
    expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
      "",
      expect.stringContaining("Checked 19 installs across 23 packages (no changes)"),
    ]);

    expect(await exited).toBe(0);
  }

  // delete cache
  await rm(join(packageDir, "node_modules", ".cache"), { recursive: true, force: true });

  ({ stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: packageDir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  }));

  [err, out] = await Promise.all([new Response(stderr).text(), new Response(stdout).text()]);

  expect(err).not.toContain("Saved lockfile");
  expect(err).not.toContain("not found");
  expect(err).not.toContain("error:");
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    "",
    expect.stringContaining("Checked 19 installs across 23 packages (no changes)"),
  ]);
  expect(await exited).toBe(0);

  // delete bun.lockb and cache
  await rm(join(packageDir, "bun.lockb"), { recursive: true, force: true });
  await rm(join(packageDir, "node_modules", ".cache"), { recursive: true, force: true });

  ({ stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: packageDir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  }));

  expect(await exited).toBe(0);

  [err, out] = await Promise.all([new Response(stderr).text(), new Response(stdout).text()]);

  expect(err).toContain("Saved lockfile");
  expect(err).not.toContain("not found");
  expect(err).not.toContain("error:");
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    "",
    expect.stringContaining("Checked 19 installs across 23 packages (no changes)"),
  ]);
});

describe("hoisting", async () => {
  var tests: any = [
    {
      situation: "1.0.0 - 1.0.10 is in order",
      dependencies: {
        "uses-a-dep-1": "1.0.0",
        "uses-a-dep-2": "1.0.0",
        "uses-a-dep-3": "1.0.0",
        "uses-a-dep-4": "1.0.0",
        "uses-a-dep-5": "1.0.0",
        "uses-a-dep-6": "1.0.0",
        "uses-a-dep-7": "1.0.0",
        "uses-a-dep-8": "1.0.0",
        "uses-a-dep-9": "1.0.0",
        "uses-a-dep-10": "1.0.0",
      },
      expected: "1.0.1",
    },
    {
      situation: "1.0.1 in the middle",
      dependencies: {
        "uses-a-dep-2": "1.0.0",
        "uses-a-dep-3": "1.0.0",
        "uses-a-dep-4": "1.0.0",
        "uses-a-dep-5": "1.0.0",
        "uses-a-dep-6": "1.0.0",
        "uses-a-dep-7": "1.0.0",
        "uses-a-dep-1": "1.0.0",
        "uses-a-dep-8": "1.0.0",
        "uses-a-dep-9": "1.0.0",
        "uses-a-dep-10": "1.0.0",
      },
      expected: "1.0.1",
    },
    {
      situation: "1.0.1 is missing",
      dependencies: {
        "uses-a-dep-2": "1.0.0",
        "uses-a-dep-3": "1.0.0",
        "uses-a-dep-4": "1.0.0",
        "uses-a-dep-5": "1.0.0",
        "uses-a-dep-6": "1.0.0",
        "uses-a-dep-7": "1.0.0",
        "uses-a-dep-8": "1.0.0",
        "uses-a-dep-9": "1.0.0",
        "uses-a-dep-10": "1.0.0",
      },
      expected: "1.0.10",
    },
    {
      situation: "1.0.10 and 1.0.1 are missing",
      dependencies: {
        "uses-a-dep-2": "1.0.0",
        "uses-a-dep-3": "1.0.0",
        "uses-a-dep-4": "1.0.0",
        "uses-a-dep-5": "1.0.0",
        "uses-a-dep-6": "1.0.0",
        "uses-a-dep-7": "1.0.0",
        "uses-a-dep-8": "1.0.0",
        "uses-a-dep-9": "1.0.0",
      },
      expected: "1.0.2",
    },
    {
      situation: "1.0.10 is missing and 1.0.1 is last",
      dependencies: {
        "uses-a-dep-2": "1.0.0",
        "uses-a-dep-3": "1.0.0",
        "uses-a-dep-4": "1.0.0",
        "uses-a-dep-5": "1.0.0",
        "uses-a-dep-6": "1.0.0",
        "uses-a-dep-7": "1.0.0",
        "uses-a-dep-8": "1.0.0",
        "uses-a-dep-9": "1.0.0",
        "uses-a-dep-1": "1.0.0",
      },
      expected: "1.0.1",
    },
  ];

  for (const { dependencies, expected, situation } of tests) {
    test(`it should hoist ${expected} when ${situation}`, async () => {
      await writeFile(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "foo",
          dependencies,
        }),
      );

      var { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });

      var err = await new Response(stderr).text();
      var out = await new Response(stdout).text();
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      for (const dep of Object.keys(dependencies)) {
        expect(out).toContain(`+ ${dep}@${dependencies[dep]}`);
      }
      expect(await exited).toBe(0);
      expect(await file(join(packageDir, "node_modules", "a-dep", "package.json")).text()).toContain(expected);

      await rm(join(packageDir, "bun.lockb"));

      ({ stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      }));

      err = await new Response(stderr).text();
      out = await new Response(stdout).text();
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      expect(out).not.toContain("package installed");
      expect(out).toContain(`Checked ${Object.keys(dependencies).length * 2} installs across`);
      expect(await exited).toBe(0);
    });
  }

  describe("peers", async () => {
    var peerTests: any = [
      {
        situation: "peer 1.0.2",
        dependencies: {
          "uses-a-dep-1": "1.0.0",
          "uses-a-dep-2": "1.0.0",
          "uses-a-dep-3": "1.0.0",
          "uses-a-dep-4": "1.0.0",
          "uses-a-dep-5": "1.0.0",
          "uses-a-dep-6": "1.0.0",
          "uses-a-dep-7": "1.0.0",
          "uses-a-dep-8": "1.0.0",
          "uses-a-dep-9": "1.0.0",
          "uses-a-dep-10": "1.0.0",
          "peer-a-dep-1-0-2": "1.0.0",
        },
        expected: "1.0.2",
      },
      {
        situation: "peer >= 1.0.2",
        dependencies: {
          "uses-a-dep-1": "1.0.0",
          "uses-a-dep-2": "1.0.0",
          "uses-a-dep-3": "1.0.0",
          "uses-a-dep-4": "1.0.0",
          "uses-a-dep-5": "1.0.0",
          "uses-a-dep-6": "1.0.0",
          "uses-a-dep-7": "1.0.0",
          "uses-a-dep-8": "1.0.0",
          "uses-a-dep-9": "1.0.0",
          "uses-a-dep-10": "1.0.0",
          "peer-a-dep-gte-1-0-2": "1.0.0",
        },
        expected: "1.0.10",
      },
      {
        situation: "peer ^1.0.2",
        dependencies: {
          "uses-a-dep-1": "1.0.0",
          "uses-a-dep-2": "1.0.0",
          "uses-a-dep-3": "1.0.0",
          "uses-a-dep-4": "1.0.0",
          "uses-a-dep-5": "1.0.0",
          "uses-a-dep-6": "1.0.0",
          "uses-a-dep-7": "1.0.0",
          "uses-a-dep-8": "1.0.0",
          "uses-a-dep-9": "1.0.0",
          "uses-a-dep-10": "1.0.0",
          "peer-a-dep-caret-1-0-2": "1.0.0",
        },
        expected: "1.0.10",
      },
      {
        situation: "peer ~1.0.2",
        dependencies: {
          "uses-a-dep-1": "1.0.0",
          "uses-a-dep-2": "1.0.0",
          "uses-a-dep-3": "1.0.0",
          "uses-a-dep-4": "1.0.0",
          "uses-a-dep-5": "1.0.0",
          "uses-a-dep-6": "1.0.0",
          "uses-a-dep-7": "1.0.0",
          "uses-a-dep-8": "1.0.0",
          "uses-a-dep-9": "1.0.0",
          "uses-a-dep-10": "1.0.0",
          "peer-a-dep-tilde-1-0-2": "1.0.0",
        },
        expected: "1.0.10",
      },
      {
        situation: "peer *",
        dependencies: {
          "uses-a-dep-1": "1.0.0",
          "uses-a-dep-2": "1.0.0",
          "uses-a-dep-3": "1.0.0",
          "uses-a-dep-4": "1.0.0",
          "uses-a-dep-5": "1.0.0",
          "uses-a-dep-6": "1.0.0",
          "uses-a-dep-7": "1.0.0",
          "uses-a-dep-8": "1.0.0",
          "uses-a-dep-9": "1.0.0",
          "uses-a-dep-10": "1.0.0",
          "peer-a-dep-star": "1.0.0",
        },
        expected: "1.0.1",
      },
      {
        situation: "peer * and peer 1.0.2",
        dependencies: {
          "uses-a-dep-1": "1.0.0",
          "uses-a-dep-2": "1.0.0",
          "uses-a-dep-3": "1.0.0",
          "uses-a-dep-4": "1.0.0",
          "uses-a-dep-5": "1.0.0",
          "uses-a-dep-6": "1.0.0",
          "uses-a-dep-7": "1.0.0",
          "uses-a-dep-8": "1.0.0",
          "uses-a-dep-9": "1.0.0",
          "uses-a-dep-10": "1.0.0",
          "peer-a-dep-1-0-2": "1.0.0",
          "peer-a-dep-star": "1.0.0",
        },
        expected: "1.0.2",
      },
    ];
    for (const { dependencies, expected, situation } of peerTests) {
      test(`it should hoist ${expected} when ${situation}`, async () => {
        await writeFile(
          join(packageDir, "package.json"),
          JSON.stringify({
            name: "foo",
            dependencies,
          }),
        );

        var { stdout, stderr, exited } = spawn({
          cmd: [bunExe(), "install"],
          cwd: packageDir,
          stdout: "pipe",
          stdin: "pipe",
          stderr: "pipe",
          env,
        });

        var err = await new Response(stderr).text();
        var out = await new Response(stdout).text();
        expect(err).toContain("Saved lockfile");
        expect(err).not.toContain("not found");
        expect(err).not.toContain("error:");
        for (const dep of Object.keys(dependencies)) {
          expect(out).toContain(`+ ${dep}@${dependencies[dep]}`);
        }
        expect(await exited).toBe(0);
        expect(await file(join(packageDir, "node_modules", "a-dep", "package.json")).text()).toContain(expected);

        await rm(join(packageDir, "bun.lockb"));

        ({ stdout, stderr, exited } = spawn({
          cmd: [bunExe(), "install"],
          cwd: packageDir,
          stdout: "pipe",
          stdin: "pipe",
          stderr: "pipe",
          env,
        }));

        err = await new Response(stderr).text();
        out = await new Response(stdout).text();
        expect(err).toContain("Saved lockfile");
        expect(err).not.toContain("not found");
        expect(err).not.toContain("error:");
        if (out.includes("installed")) {
          console.log("stdout:", out);
        }
        expect(out).not.toContain("package installed");
        expect(await exited).toBe(0);
        expect(await file(join(packageDir, "node_modules", "a-dep", "package.json")).text()).toContain(expected);

        await rm(join(packageDir, "node_modules"), { recursive: true, force: true });

        ({ stdout, stderr, exited } = spawn({
          cmd: [bunExe(), "install"],
          cwd: packageDir,
          stdout: "pipe",
          stdin: "pipe",
          stderr: "pipe",
          env,
        }));

        err = await new Response(stderr).text();
        out = await new Response(stdout).text();
        expect(err).not.toContain("Saved lockfile");
        expect(err).not.toContain("not found");
        expect(err).not.toContain("error:");
        expect(out).not.toContain("package installed");
        expect(await exited).toBe(0);
        expect(await file(join(packageDir, "node_modules", "a-dep", "package.json")).text()).toContain(expected);
      });
    }
  });

  test("hoisting/using incorrect peer dep after install", async () => {
    await writeFile(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "foo",
        dependencies: {
          "peer-deps-fixed": "1.0.0",
          "no-deps": "1.0.0",
        },
      }),
    );

    var { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    });

    var err = await new Response(stderr).text();
    var out = await new Response(stdout).text();
    expect(err).toContain("Saved lockfile");
    expect(err).not.toContain("not found");
    expect(err).not.toContain("error:");
    expect(err).not.toContain("incorrect peer dependency");

    expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
      "",
      "+ no-deps@1.0.0",
      "+ peer-deps-fixed@1.0.0",
      "",
      "2 packages installed",
    ]);

    expect(await exited).toBe(0);
    expect(await file(join(packageDir, "node_modules", "no-deps", "package.json")).json()).toEqual({
      name: "no-deps",
      version: "1.0.0",
    } as any);
    expect(await file(join(packageDir, "node_modules", "peer-deps-fixed", "package.json")).json()).toEqual({
      name: "peer-deps-fixed",
      version: "1.0.0",
      peerDependencies: {
        "no-deps": "^1.0.0",
      },
    } as any);
    expect(await exists(join(packageDir, "node_modules", "peer-deps-fixed", "node_modules"))).toBeFalse();

    await writeFile(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "foo",
        dependencies: {
          "peer-deps-fixed": "1.0.0",
          "no-deps": "2.0.0",
        },
      }),
    );

    ({ stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    }));

    err = await new Response(stderr).text();
    out = await new Response(stdout).text();
    expect(err).toContain("Saved lockfile");
    expect(err).not.toContain("not found");
    expect(err).not.toContain("error:");

    expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
      "",
      "+ no-deps@2.0.0",
      "",
      "1 package installed",
    ]);

    expect(await exited).toBe(0);
    expect(await file(join(packageDir, "node_modules", "no-deps", "package.json")).json()).toEqual({
      name: "no-deps",
      version: "2.0.0",
    } as any);
    expect(await file(join(packageDir, "node_modules", "peer-deps-fixed", "package.json")).json()).toEqual({
      name: "peer-deps-fixed",
      version: "1.0.0",
      peerDependencies: {
        "no-deps": "^1.0.0",
      },
    } as any);
    expect(await exists(join(packageDir, "node_modules", "peer-deps-fixed", "node_modules"))).toBeFalse();
  });

  test("root workspace (other than root) dependency will not hoist incorrect peer", async () => {
    await Promise.all([
      write(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "foo",
          workspaces: ["bar"],
        }),
      ),
      write(
        join(packageDir, "bar", "package.json"),
        JSON.stringify({
          name: "bar",
          dependencies: {
            "peer-deps-fixed": "1.0.0",
            "no-deps": "1.0.0",
          },
        }),
      ),
    ]);

    let { exited, stdout } = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      stderr: "ignore",
      stdout: "pipe",
      env,
    });

    let out = await Bun.readableStreamToText(stdout);
    expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual(["", "3 packages installed"]);
    expect(await exited).toBe(0);

    // now run the install again but from the workspace and with `no-deps@2.0.0`
    await write(
      join(packageDir, "bar", "package.json"),
      JSON.stringify({
        name: "bar",
        dependencies: {
          "peer-deps-fixed": "1.0.0",
          "no-deps": "2.0.0",
        },
      }),
    );

    ({ exited, stdout } = spawn({
      cmd: [bunExe(), "install"],
      cwd: join(packageDir, "bar"),
      stderr: "ignore",
      stdout: "pipe",
      env,
    }));

    out = await Bun.readableStreamToText(stdout);
    expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
      "",
      "+ no-deps@2.0.0",
      "",
      "2 packages installed",
    ]);
    expect(await file(join(packageDir, "node_modules", "no-deps", "package.json")).json()).toMatchObject({
      version: "2.0.0",
    });
    expect(await exited).toBe(0);
  });

  test("hoisting/using incorrect peer dep on initial install", async () => {
    await writeFile(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "foo",
        dependencies: {
          "peer-deps-fixed": "1.0.0",
          "no-deps": "2.0.0",
        },
      }),
    );

    var { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    });

    var err = await new Response(stderr).text();
    var out = await new Response(stdout).text();
    expect(err).toContain("Saved lockfile");
    expect(err).not.toContain("not found");
    expect(err).not.toContain("error:");
    expect(err).toContain("incorrect peer dependency");

    expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
      "",
      "+ no-deps@2.0.0",
      "+ peer-deps-fixed@1.0.0",
      "",
      "2 packages installed",
    ]);

    expect(await exited).toBe(0);
    expect(await file(join(packageDir, "node_modules", "no-deps", "package.json")).json()).toEqual({
      name: "no-deps",
      version: "2.0.0",
    } as any);
    expect(await file(join(packageDir, "node_modules", "peer-deps-fixed", "package.json")).json()).toEqual({
      name: "peer-deps-fixed",
      version: "1.0.0",
      peerDependencies: {
        "no-deps": "^1.0.0",
      },
    } as any);
    expect(await exists(join(packageDir, "node_modules", "peer-deps-fixed", "node_modules"))).toBeFalse();

    await writeFile(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "foo",
        dependencies: {
          "peer-deps-fixed": "1.0.0",
          "no-deps": "1.0.0",
        },
      }),
    );

    ({ stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    }));

    err = await new Response(stderr).text();
    out = await new Response(stdout).text();
    expect(err).toContain("Saved lockfile");
    expect(err).not.toContain("not found");
    expect(err).not.toContain("error:");

    expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
      "",
      "+ no-deps@1.0.0",
      "",
      "1 package installed",
    ]);

    expect(await exited).toBe(0);
    expect(await file(join(packageDir, "node_modules", "no-deps", "package.json")).json()).toEqual({
      name: "no-deps",
      version: "1.0.0",
    } as any);
    expect(await file(join(packageDir, "node_modules", "peer-deps-fixed", "package.json")).json()).toEqual({
      name: "peer-deps-fixed",
      version: "1.0.0",
      peerDependencies: {
        "no-deps": "^1.0.0",
      },
    } as any);
    expect(await exists(join(packageDir, "node_modules", "peer-deps-fixed", "node_modules"))).toBeFalse();
  });

  describe("devDependencies", () => {
    test("from normal dependency", async () => {
      // Root package should choose no-deps@1.0.1.
      //
      // `normal-dep-and-dev-dep` should install `no-deps@1.0.0` and `normal-dep@1.0.1`.
      // It should not hoist (skip) `no-deps` for `normal-dep-and-dev-dep`.
      await writeFile(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "1.0.0",
          dependencies: {
            "no-deps": "1.0.0",
            "normal-dep-and-dev-dep": "1.0.2",
          },
          devDependencies: {
            "no-deps": "1.0.1",
          },
        }),
      );

      const { stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "ignore",
        stderr: "pipe",
        stdin: "ignore",
        env,
      });

      const err = await Bun.readableStreamToText(stderr);
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      expect(await exited).toBe(0);

      expect(await file(join(packageDir, "node_modules", "no-deps", "package.json")).json()).toEqual({
        name: "no-deps",
        version: "1.0.1",
      });

      expect(
        await file(
          join(packageDir, "node_modules", "normal-dep-and-dev-dep", "node_modules", "no-deps", "package.json"),
        ).json(),
      ).toEqual({
        name: "no-deps",
        version: "1.0.0",
      });
    });

    test("from workspace", async () => {
      await writeFile(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "1.0.0",
          workspaces: ["packages/*"],
          dependencies: {
            "no-deps": "1.0.0",
          },
          devDependencies: {
            "no-deps": "1.0.1",
          },
        }),
      );

      await mkdir(join(packageDir, "packages", "moo"), { recursive: true });
      await writeFile(
        join(packageDir, "packages", "moo", "package.json"),
        JSON.stringify({
          name: "moo",
          version: "1.2.3",
          dependencies: {
            "no-deps": "2.0.0",
            "normal-dep-and-dev-dep": "1.0.0",
          },
          devDependencies: {
            "no-deps": "1.1.0",
          },
        }),
      );

      const { stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stderr: "pipe",
        stdout: "ignore",
        stdin: "ignore",
        env,
      });

      const err = await Bun.readableStreamToText(stderr);
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      expect(await exited).toBe(0);

      expect(await file(join(packageDir, "node_modules", "no-deps", "package.json")).json()).toEqual({
        name: "no-deps",
        version: "1.0.1",
      });

      expect(
        await file(join(packageDir, "node_modules", "moo", "node_modules", "no-deps", "package.json")).json(),
      ).toEqual({
        name: "no-deps",
        version: "1.1.0",
      });
    });

    test("from linked package", async () => {
      await writeFile(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "1.0.0",
          dependencies: {
            "no-deps": "1.1.0",
            "folder-dep": "file:./folder-dep",
          },
          devDependencies: {
            "no-deps": "2.0.0",
          },
        }),
      );

      await mkdir(join(packageDir, "folder-dep"));
      await writeFile(
        join(packageDir, "folder-dep", "package.json"),
        JSON.stringify({
          name: "folder-dep",
          version: "1.2.3",
          dependencies: {
            "no-deps": "1.0.0",
            "normal-dep-and-dev-dep": "1.0.1",
          },
          devDependencies: {
            "no-deps": "1.0.1",
          },
        }),
      );

      const { stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stderr: "pipe",
        stdout: "ignore",
        stdin: "ignore",
        env,
      });

      const err = await Bun.readableStreamToText(stderr);
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      expect(await exited).toBe(0);

      expect(await file(join(packageDir, "node_modules", "no-deps", "package.json")).json()).toEqual({
        name: "no-deps",
        version: "2.0.0",
      });
      expect(
        await file(
          join(packageDir, "node_modules", "normal-dep-and-dev-dep", "node_modules", "no-deps", "package.json"),
        ).json(),
      ).toEqual({
        "name": "no-deps",
        "version": "1.1.0",
      });
      expect(
        await file(join(packageDir, "node_modules", "folder-dep", "node_modules", "no-deps", "package.json")).json(),
      ).toEqual({
        name: "no-deps",
        version: "1.0.1",
      });
    });

    test("dependency with normal dependency same as root", async () => {
      await writeFile(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "1.0.0",
          dependencies: {
            "no-deps": "1.0.0",
            "one-dep": "1.0.0",
          },
          devDependencies: {
            "no-deps": "2.0.0",
          },
        }),
      );

      const { stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stderr: "pipe",
        stdout: "ignore",
        stdin: "ignore",
        env,
      });

      const err = await Bun.readableStreamToText(stderr);
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      expect(await exited).toBe(0);

      expect(await file(join(packageDir, "node_modules", "no-deps", "package.json")).json()).toEqual({
        name: "no-deps",
        version: "2.0.0",
      });
      expect(
        await file(join(packageDir, "node_modules", "one-dep", "node_modules", "no-deps", "package.json")).json(),
      ).toEqual({
        name: "no-deps",
        version: "1.0.1",
      });
    });
  });
});

describe("workspaces", async () => {
  test("adding packages in a subdirectory of a workspace", async () => {
    await writeFile(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "root",
        workspaces: ["foo"],
      }),
    );

    await mkdir(join(packageDir, "folder1"));
    await mkdir(join(packageDir, "foo", "folder2"), { recursive: true });
    await writeFile(
      join(packageDir, "foo", "package.json"),
      JSON.stringify({
        name: "foo",
      }),
    );

    // add package to root workspace from `folder1`
    let { stdout, exited } = spawn({
      cmd: [bunExe(), "add", "no-deps"],
      cwd: join(packageDir, "folder1"),
      stdout: "pipe",
      stderr: "inherit",
      env,
    });
    let out = await Bun.readableStreamToText(stdout);
    expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
      "",
      "installed no-deps@2.0.0",
      "",
      "2 packages installed",
    ]);
    expect(await exited).toBe(0);
    expect(await file(join(packageDir, "package.json")).json()).toEqual({
      name: "root",
      workspaces: ["foo"],
      dependencies: {
        "no-deps": "^2.0.0",
      },
    });

    // add package to foo from `folder2`
    ({ stdout, exited } = spawn({
      cmd: [bunExe(), "add", "what-bin"],
      cwd: join(packageDir, "foo", "folder2"),
      stdout: "pipe",
      stderr: "inherit",
      env,
    }));
    out = await Bun.readableStreamToText(stdout);
    expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
      "",
      "installed what-bin@1.5.0 with binaries:",
      " - what-bin",
      "",
      "1 package installed",
    ]);
    expect(await exited).toBe(0);
    expect(await file(join(packageDir, "foo", "package.json")).json()).toEqual({
      name: "foo",
      dependencies: {
        "what-bin": "^1.5.0",
      },
    });

    // now delete node_modules and bun.lockb and install
    await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
    await rm(join(packageDir, "bun.lockb"));

    ({ stdout, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: join(packageDir, "folder1"),
      stdout: "pipe",
      stderr: "inherit",
      env,
    }));
    out = await Bun.readableStreamToText(stdout);
    expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
      "",
      "+ no-deps@2.0.0",
      "",
      "3 packages installed",
    ]);
    expect(await exited).toBe(0);
    expect(await readdirSorted(join(packageDir, "node_modules"))).toEqual([
      ".bin",
      ".cache",
      "foo",
      "no-deps",
      "what-bin",
    ]);

    await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
    await rm(join(packageDir, "bun.lockb"));

    ({ stdout, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: join(packageDir, "foo", "folder2"),
      stdout: "pipe",
      stderr: "inherit",
      env,
    }));
    out = await Bun.readableStreamToText(stdout);
    expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
      "",
      "+ what-bin@1.5.0",
      "",
      "3 packages installed",
    ]);
    expect(await exited).toBe(0);
    expect(await readdirSorted(join(packageDir, "node_modules"))).toEqual([
      ".bin",
      ".cache",
      "foo",
      "no-deps",
      "what-bin",
    ]);
  });
  test("adding packages in workspaces", async () => {
    await writeFile(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "foo",
        workspaces: ["packages/*"],
        dependencies: {
          "bar": "workspace:*",
        },
      }),
    );

    await mkdir(join(packageDir, "packages", "bar"), { recursive: true });
    await mkdir(join(packageDir, "packages", "boba"));
    await mkdir(join(packageDir, "packages", "pkg5"));

    await writeFile(join(packageDir, "packages", "bar", "package.json"), JSON.stringify({ name: "bar" }));
    await writeFile(
      join(packageDir, "packages", "boba", "package.json"),
      JSON.stringify({ name: "boba", version: "1.0.0", dependencies: { "pkg5": "*" } }),
    );
    await writeFile(
      join(packageDir, "packages", "pkg5", "package.json"),
      JSON.stringify({
        name: "pkg5",
        version: "1.2.3",
        dependencies: {
          "bar": "workspace:*",
        },
      }),
    );

    let { stdout, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      stdout: "pipe",
      stderr: "inherit",
      env,
    });

    let out = await Bun.readableStreamToText(stdout);
    expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
      "",
      "+ bar@workspace:packages/bar",
      "",
      "3 packages installed",
    ]);
    expect(await exited).toBe(0);
    expect(await exists(join(packageDir, "node_modules", "bar"))).toBeTrue();
    expect(await exists(join(packageDir, "node_modules", "boba"))).toBeTrue();
    expect(await exists(join(packageDir, "node_modules", "pkg5"))).toBeTrue();

    // add a package to the root workspace
    ({ stdout, exited } = spawn({
      cmd: [bunExe(), "add", "no-deps"],
      cwd: packageDir,
      stdout: "pipe",
      stderr: "inherit",
      env,
    }));

    out = await Bun.readableStreamToText(stdout);
    expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
      "",
      "installed no-deps@2.0.0",
      "",
      "1 package installed",
    ]);
    expect(await exited).toBe(0);
    expect(await file(join(packageDir, "package.json")).json()).toEqual({
      name: "foo",
      workspaces: ["packages/*"],
      dependencies: {
        bar: "workspace:*",
        "no-deps": "^2.0.0",
      },
    });

    // add a package in a workspace
    ({ stdout, exited } = spawn({
      cmd: [bunExe(), "add", "two-range-deps"],
      cwd: join(packageDir, "packages", "boba"),
      stdout: "pipe",
      stderr: "inherit",
      env,
    }));

    out = await Bun.readableStreamToText(stdout);
    expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
      "",
      "installed two-range-deps@1.0.0",
      "",
      "3 packages installed",
    ]);
    expect(await exited).toBe(0);
    expect(await file(join(packageDir, "packages", "boba", "package.json")).json()).toEqual({
      name: "boba",
      version: "1.0.0",
      dependencies: {
        "pkg5": "*",
        "two-range-deps": "^1.0.0",
      },
    });
    expect(await readdirSorted(join(packageDir, "node_modules"))).toEqual([
      ".cache",
      "@types",
      "bar",
      "boba",
      "no-deps",
      "pkg5",
      "two-range-deps",
    ]);

    // add a dependency to a workspace with the same name as another workspace
    ({ stdout, exited } = spawn({
      cmd: [bunExe(), "add", "bar@0.0.7"],
      cwd: join(packageDir, "packages", "boba"),
      stdout: "pipe",
      stderr: "inherit",
      env,
    }));

    out = await Bun.readableStreamToText(stdout);
    expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
      "",
      "installed bar@0.0.7",
      "",
      "1 package installed",
    ]);
    expect(await exited).toBe(0);
    expect(await file(join(packageDir, "packages", "boba", "package.json")).json()).toEqual({
      name: "boba",
      version: "1.0.0",
      dependencies: {
        "pkg5": "*",
        "two-range-deps": "^1.0.0",
        "bar": "0.0.7",
      },
    });
    expect(await readdirSorted(join(packageDir, "node_modules"))).toEqual([
      ".cache",
      "@types",
      "bar",
      "boba",
      "no-deps",
      "pkg5",
      "two-range-deps",
    ]);
    expect(await file(join(packageDir, "node_modules", "boba", "node_modules", "bar", "package.json")).json()).toEqual({
      name: "bar",
      version: "0.0.7",
      description: "not a workspace",
    });
  });
  test("it should detect duplicate workspace dependencies", async () => {
    await writeFile(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "foo",
        workspaces: ["packages/*"],
      }),
    );

    await mkdir(join(packageDir, "packages", "pkg1"), { recursive: true });
    await writeFile(join(packageDir, "packages", "pkg1", "package.json"), JSON.stringify({ name: "pkg1" }));
    await mkdir(join(packageDir, "packages", "pkg2"), { recursive: true });
    await writeFile(join(packageDir, "packages", "pkg2", "package.json"), JSON.stringify({ name: "pkg1" }));

    var { stderr, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    });

    var err = await new Response(stderr).text();
    expect(err).toContain('Workspace name "pkg1" already exists');
    expect(await exited).toBe(1);

    await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
    await rm(join(packageDir, "bun.lockb"), { force: true });

    ({ stderr, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: join(packageDir, "packages", "pkg1"),
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    }));

    err = await new Response(stderr).text();
    expect(err).toContain('Workspace name "pkg1" already exists');
    expect(await exited).toBe(1);
  });

  const versions = ["workspace:1.0.0", "workspace:*", "workspace:^1.0.0", "1.0.0", "*"];

  for (const rootVersion of versions) {
    for (const packageVersion of versions) {
      test(`it should allow duplicates, root@${rootVersion}, package@${packageVersion}`, async () => {
        await writeFile(
          join(packageDir, "package.json"),
          JSON.stringify({
            name: "foo",
            version: "1.0.0",
            workspaces: ["packages/*"],
            dependencies: {
              pkg2: rootVersion,
            },
          }),
        );

        await mkdir(join(packageDir, "packages", "pkg1"), { recursive: true });
        await writeFile(
          join(packageDir, "packages", "pkg1", "package.json"),
          JSON.stringify({
            name: "pkg1",
            version: "1.0.0",
            dependencies: {
              pkg2: packageVersion,
            },
          }),
        );

        await mkdir(join(packageDir, "packages", "pkg2"), { recursive: true });
        await writeFile(
          join(packageDir, "packages", "pkg2", "package.json"),
          JSON.stringify({ name: "pkg2", version: "1.0.0" }),
        );

        var { stdout, stderr, exited } = spawn({
          cmd: [bunExe(), "install"],
          cwd: packageDir,
          stdout: "pipe",
          stdin: "pipe",
          stderr: "pipe",
          env,
        });

        var err = await new Response(stderr).text();
        var out = await new Response(stdout).text();
        expect(err).toContain("Saved lockfile");
        expect(err).not.toContain("not found");
        expect(err).not.toContain("error:");
        expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
          "",
          `+ pkg2@workspace:packages/pkg2`,
          "",
          "2 packages installed",
        ]);
        expect(await exited).toBe(0);

        ({ stdout, stderr, exited } = spawn({
          cmd: [bunExe(), "install"],
          cwd: join(packageDir, "packages", "pkg1"),
          stdout: "pipe",
          stdin: "pipe",
          stderr: "pipe",
          env,
        }));

        err = await new Response(stderr).text();
        out = await new Response(stdout).text();
        expect(err).not.toContain("Saved lockfile");
        expect(err).not.toContain("not found");
        expect(err).not.toContain("error:");
        expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
          "",
          "Checked 2 installs across 3 packages (no changes)",
        ]);
        expect(await exited).toBe(0);

        await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
        await rm(join(packageDir, "bun.lockb"), { recursive: true, force: true });

        ({ stdout, stderr, exited } = spawn({
          cmd: [bunExe(), "install"],
          cwd: join(packageDir, "packages", "pkg1"),
          stdout: "pipe",
          stdin: "pipe",
          stderr: "pipe",
          env,
        }));

        err = await new Response(stderr).text();
        out = await new Response(stdout).text();
        expect(err).toContain("Saved lockfile");
        expect(err).not.toContain("not found");
        expect(err).not.toContain("error:");
        expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
          "",
          `+ pkg2@workspace:packages/pkg2`,
          "",
          "2 packages installed",
        ]);
        expect(await exited).toBe(0);

        ({ stdout, stderr, exited } = spawn({
          cmd: [bunExe(), "install"],
          cwd: packageDir,
          stdout: "pipe",
          stdin: "pipe",
          stderr: "pipe",
          env,
        }));

        err = await new Response(stderr).text();
        out = await new Response(stdout).text();
        expect(err).not.toContain("Saved lockfile");
        expect(err).not.toContain("not found");
        expect(err).not.toContain("error:");
        expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
          "",
          "Checked 2 installs across 3 packages (no changes)",
        ]);
        expect(await exited).toBe(0);
      });
    }
  }

  for (const version of versions) {
    test(`it should allow listing workspace as dependency of the root package version ${version}`, async () => {
      await writeFile(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "foo",
          workspaces: ["packages/*"],
          dependencies: {
            "workspace-1": version,
          },
        }),
      );

      await mkdir(join(packageDir, "packages", "workspace-1"), { recursive: true });
      await writeFile(
        join(packageDir, "packages", "workspace-1", "package.json"),
        JSON.stringify({
          name: "workspace-1",
          version: "1.0.0",
        }),
      );
      // install first from the root, the workspace package
      var { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });

      var err = await new Response(stderr).text();
      var out = await new Response(stdout).text();
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("already exists");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("Duplicate dependency");
      expect(err).not.toContain('workspace dependency "workspace-1" not found');
      expect(err).not.toContain("error:");
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        "",
        `+ workspace-1@workspace:packages/workspace-1`,
        "",
        "1 package installed",
      ]);
      expect(await exited).toBe(0);
      expect(await file(join(packageDir, "node_modules", "workspace-1", "package.json")).json()).toEqual({
        name: "workspace-1",
        version: "1.0.0",
      });

      ({ stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: join(packageDir, "packages", "workspace-1"),
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      }));

      err = await new Response(stderr).text();
      out = await new Response(stdout).text();
      expect(err).not.toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("already exists");
      expect(err).not.toContain("Duplicate dependency");
      expect(err).not.toContain('workspace dependency "workspace-1" not found');
      expect(err).not.toContain("error:");
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        "",
        "Checked 1 install across 2 packages (no changes)",
      ]);
      expect(await exited).toBe(0);
      expect(await file(join(packageDir, "node_modules", "workspace-1", "package.json")).json()).toEqual({
        name: "workspace-1",
        version: "1.0.0",
      });

      await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
      await rm(join(packageDir, "bun.lockb"), { recursive: true, force: true });

      // install from workspace package then from root
      ({ stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: join(packageDir, "packages", "workspace-1"),
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      }));

      err = await new Response(stderr).text();
      out = await new Response(stdout).text();
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("already exists");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("Duplicate dependency");
      expect(err).not.toContain('workspace dependency "workspace-1" not found');
      expect(err).not.toContain("error:");
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual(["", "1 package installed"]);
      expect(await exited).toBe(0);
      expect(await file(join(packageDir, "node_modules", "workspace-1", "package.json")).json()).toEqual({
        name: "workspace-1",
        version: "1.0.0",
      });

      ({ stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      }));

      err = await new Response(stderr).text();
      out = await new Response(stdout).text();
      expect(err).not.toContain("Saved lockfile");
      expect(err).not.toContain("already exists");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("Duplicate dependency");
      expect(err).not.toContain('workspace dependency "workspace-1" not found');
      expect(err).not.toContain("error:");
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        "",
        "Checked 1 install across 2 packages (no changes)",
      ]);
      expect(await exited).toBe(0);
      expect(await file(join(packageDir, "node_modules", "workspace-1", "package.json")).json()).toEqual({
        name: "workspace-1",
        version: "1.0.0",
      });
    });
  }
});

describe("transitive file dependencies", () => {
  async function checkHoistedFiles() {
    const aliasedFileDepFilesPackageJson = join(
      packageDir,
      "node_modules",
      "aliased-file-dep",
      "node_modules",
      "files",
      "the-files",
      "package.json",
    );
    const results = await Promise.all([
      exists(join(packageDir, "node_modules", "file-dep", "node_modules", "files", "package.json")),
      readdirSorted(join(packageDir, "node_modules", "missing-file-dep", "node_modules")),
      exists(join(packageDir, "node_modules", "aliased-file-dep", "package.json")),
      isWindows
        ? file(await readlink(aliasedFileDepFilesPackageJson)).json()
        : file(aliasedFileDepFilesPackageJson).json(),
      exists(
        join(packageDir, "node_modules", "@scoped", "file-dep", "node_modules", "@scoped", "files", "package.json"),
      ),
      exists(
        join(
          packageDir,
          "node_modules",
          "@another-scope",
          "file-dep",
          "node_modules",
          "@scoped",
          "files",
          "package.json",
        ),
      ),
      exists(join(packageDir, "node_modules", "self-file-dep", "node_modules", "self-file-dep", "package.json")),
    ]);

    expect(results).toEqual([
      true,
      [],
      true,
      {
        "name": "files",
        "version": "1.1.1",
        "dependencies": {
          "no-deps": "2.0.0",
        },
      },
      true,
      true,
      true,
    ]);
  }

  async function checkUnhoistedFiles() {
    const results = await Promise.all([
      file(join(packageDir, "node_modules", "dep-file-dep", "package.json")).json(),
      file(join(packageDir, "node_modules", "file-dep", "package.json")).json(),
      file(join(packageDir, "node_modules", "missing-file-dep", "package.json")).json(),
      file(join(packageDir, "node_modules", "aliased-file-dep", "package.json")).json(),
      file(join(packageDir, "node_modules", "@scoped", "file-dep", "package.json")).json(),
      file(join(packageDir, "node_modules", "@another-scope", "file-dep", "package.json")).json(),
      file(join(packageDir, "node_modules", "self-file-dep", "package.json")).json(),

      exists(join(packageDir, "pkg1", "node_modules", "file-dep", "node_modules", "files", "package.json")), // true
      readdirSorted(join(packageDir, "pkg1", "node_modules", "missing-file-dep", "node_modules")), // []
      exists(join(packageDir, "pkg1", "node_modules", "aliased-file-dep")), // false
      exists(
        join(
          packageDir,
          "pkg1",
          "node_modules",
          "@scoped",
          "file-dep",
          "node_modules",
          "@scoped",
          "files",
          "package.json",
        ),
      ),
      exists(
        join(
          packageDir,
          "pkg1",
          "node_modules",
          "@another-scope",
          "file-dep",
          "node_modules",
          "@scoped",
          "files",
          "package.json",
        ),
      ),
      exists(
        join(packageDir, "pkg1", "node_modules", "self-file-dep", "node_modules", "self-file-dep", "package.json"),
      ),
      readdirSorted(join(packageDir, "pkg1", "node_modules")),
    ]);

    const expected = [
      ...(Array(7).fill({ name: "a-dep", version: "1.0.1" }) as any),
      true,
      [] as string[],
      false,
      true,
      true,
      true,
      ["@another-scope", "@scoped", "dep-file-dep", "file-dep", "missing-file-dep", "self-file-dep"],
    ];

    // @ts-ignore
    expect(results).toEqual(expected);
  }

  test("from hoisted workspace dependencies", async () => {
    await Promise.all([
      write(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "foo",
          workspaces: ["pkg1"],
        }),
      ),
      write(
        join(packageDir, "pkg1", "package.json"),
        JSON.stringify({
          name: "pkg1",
          dependencies: {
            // hoisted
            "dep-file-dep": "1.0.0",
            // root
            "file-dep": "1.0.0",
            // dangling symlink
            "missing-file-dep": "1.0.0",
            // aliased. has `"file-dep": "file:."`
            "aliased-file-dep": "npm:file-dep@1.0.1",
            // scoped
            "@scoped/file-dep": "1.0.0",
            // scoped with different names
            "@another-scope/file-dep": "1.0.0",
            // file dependency on itself
            "self-file-dep": "1.0.0",
          },
        }),
      ),
    ]);

    var { out } = await runBunInstall(env, packageDir);
    expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual(["", "14 packages installed"]);

    await checkHoistedFiles();
    expect(await exists(join(packageDir, "pkg1", "node_modules"))).toBeFalse();

    await rm(join(packageDir, "node_modules"), { recursive: true, force: true });

    // reinstall
    ({ out } = await runBunInstall(env, packageDir, { savesLockfile: false }));
    expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual(["", "14 packages installed"]);

    await checkHoistedFiles();

    ({ out } = await runBunInstall(env, packageDir, { savesLockfile: false }));
    expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual(["", "1 package installed"]);

    await checkHoistedFiles();

    await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
    await rm(join(packageDir, "bun.lockb"), { force: true });

    // install from workspace
    ({ out } = await runBunInstall(env, join(packageDir, "pkg1")));
    expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
      "",
      "+ @another-scope/file-dep@1.0.0",
      "+ @scoped/file-dep@1.0.0",
      "+ aliased-file-dep@1.0.1",
      "+ dep-file-dep@1.0.0",
      "+ file-dep@1.0.0",
      "+ missing-file-dep@1.0.0",
      "+ self-file-dep@1.0.0",
      "",
      "14 packages installed",
    ]);

    await checkHoistedFiles();
    expect(await exists(join(packageDir, "pkg1", "node_modules"))).toBeFalse();

    ({ out } = await runBunInstall(env, join(packageDir, "pkg1"), { savesLockfile: false }));
    expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual(["", "1 package installed"]);

    await rm(join(packageDir, "node_modules"), { recursive: true, force: true });

    ({ out } = await runBunInstall(env, join(packageDir, "pkg1"), { savesLockfile: false }));
    expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
      "",
      "+ @another-scope/file-dep@1.0.0",
      "+ @scoped/file-dep@1.0.0",
      "+ aliased-file-dep@1.0.1",
      "+ dep-file-dep@1.0.0",
      "+ file-dep@1.0.0",
      "+ missing-file-dep@1.0.0",
      "+ self-file-dep@1.0.0",
      "",
      "14 packages installed",
    ]);
  });

  test("from non-hoisted workspace dependencies", async () => {
    await Promise.all([
      write(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "foo",
          workspaces: ["pkg1"],
          // these dependencies exist to make the workspace
          // dependencies non-hoisted
          dependencies: {
            "dep-file-dep": "npm:a-dep@1.0.1",
            "file-dep": "npm:a-dep@1.0.1",
            "missing-file-dep": "npm:a-dep@1.0.1",
            "aliased-file-dep": "npm:a-dep@1.0.1",
            "@scoped/file-dep": "npm:a-dep@1.0.1",
            "@another-scope/file-dep": "npm:a-dep@1.0.1",
            "self-file-dep": "npm:a-dep@1.0.1",
          },
        }),
      ),
      write(
        join(packageDir, "pkg1", "package.json"),
        JSON.stringify({
          name: "pkg1",
          dependencies: {
            // hoisted
            "dep-file-dep": "1.0.0",
            // root
            "file-dep": "1.0.0",
            // dangling symlink
            "missing-file-dep": "1.0.0",
            // aliased. has `"file-dep": "file:."`
            "aliased-file-dep": "npm:file-dep@1.0.1",
            // scoped
            "@scoped/file-dep": "1.0.0",
            // scoped with different names
            "@another-scope/file-dep": "1.0.0",
            // file dependency on itself
            "self-file-dep": "1.0.0",
          },
        }),
      ),
    ]);

    var { out } = await runBunInstall(env, packageDir);
    expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
      "",
      "+ @another-scope/file-dep@1.0.1",
      "+ @scoped/file-dep@1.0.1",
      "+ aliased-file-dep@1.0.1",
      "+ dep-file-dep@1.0.1",
      "+ file-dep@1.0.1",
      "+ missing-file-dep@1.0.1",
      "+ self-file-dep@1.0.1",
      "",
      "13 packages installed",
    ]);

    await checkUnhoistedFiles();

    await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
    await rm(join(packageDir, "pkg1", "node_modules"), { recursive: true, force: true });

    // reinstall
    ({ out } = await runBunInstall(env, packageDir, { savesLockfile: false }));
    expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
      "",
      "+ @another-scope/file-dep@1.0.1",
      "+ @scoped/file-dep@1.0.1",
      "+ aliased-file-dep@1.0.1",
      "+ dep-file-dep@1.0.1",
      "+ file-dep@1.0.1",
      "+ missing-file-dep@1.0.1",
      "+ self-file-dep@1.0.1",
      "",
      "13 packages installed",
    ]);

    await checkUnhoistedFiles();

    ({ out } = await runBunInstall(env, packageDir, { savesLockfile: false }));
    expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual(["", "1 package installed"]);

    await checkUnhoistedFiles();

    await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
    await rm(join(packageDir, "pkg1", "node_modules"), { recursive: true, force: true });
    await rm(join(packageDir, "bun.lockb"), { force: true });

    // install from workspace
    ({ out } = await runBunInstall(env, join(packageDir, "pkg1")));
    expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
      "",
      "+ @another-scope/file-dep@1.0.0",
      "+ @scoped/file-dep@1.0.0",
      "+ aliased-file-dep@1.0.1",
      "+ dep-file-dep@1.0.0",
      "+ file-dep@1.0.0",
      "+ missing-file-dep@1.0.0",
      "+ self-file-dep@1.0.0",
      "",
      "13 packages installed",
    ]);

    await checkUnhoistedFiles();

    ({ out } = await runBunInstall(env, join(packageDir, "pkg1"), { savesLockfile: false }));
    expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual(["", "1 package installed"]);

    await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
    await rm(join(packageDir, "pkg1", "node_modules"), { recursive: true, force: true });

    ({ out } = await runBunInstall(env, join(packageDir, "pkg1"), { savesLockfile: false }));
    expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
      "",
      "+ @another-scope/file-dep@1.0.0",
      "+ @scoped/file-dep@1.0.0",
      "+ aliased-file-dep@1.0.1",
      "+ dep-file-dep@1.0.0",
      "+ file-dep@1.0.0",
      "+ missing-file-dep@1.0.0",
      "+ self-file-dep@1.0.0",
      "",
      "13 packages installed",
    ]);
  });

  test("from root dependencies", async () => {
    await writeFile(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "foo",
        version: "1.0.0",
        dependencies: {
          // hoisted
          "dep-file-dep": "1.0.0",
          // root
          "file-dep": "1.0.0",
          // dangling symlink
          "missing-file-dep": "1.0.0",
          // aliased. has `"file-dep": "file:."`
          "aliased-file-dep": "npm:file-dep@1.0.1",
          // scoped
          "@scoped/file-dep": "1.0.0",
          // scoped with different names
          "@another-scope/file-dep": "1.0.0",
          // file dependency on itself
          "self-file-dep": "1.0.0",
        },
      }),
    );

    var { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    });

    var err = await Bun.readableStreamToText(stderr);
    var out = await Bun.readableStreamToText(stdout);
    expect(err).toContain("Saved lockfile");
    expect(err).not.toContain("not found");
    expect(err).not.toContain("error:");
    expect(err).not.toContain("panic:");
    expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
      "",
      "+ @another-scope/file-dep@1.0.0",
      "+ @scoped/file-dep@1.0.0",
      "+ aliased-file-dep@1.0.1",
      "+ dep-file-dep@1.0.0",
      "+ file-dep@1.0.0",
      "+ missing-file-dep@1.0.0",
      "+ self-file-dep@1.0.0",
      "",
      "13 packages installed",
    ]);
    expect(await exited).toBe(0);
    expect(await readdirSorted(join(packageDir, "node_modules"))).toEqual([
      ".cache",
      "@another-scope",
      "@scoped",
      "aliased-file-dep",
      "dep-file-dep",
      "file-dep",
      "missing-file-dep",
      "self-file-dep",
    ]);

    await checkHoistedFiles();

    ({ stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    }));

    err = await Bun.readableStreamToText(stderr);
    out = await Bun.readableStreamToText(stdout);
    expect(err).not.toContain("Saved lockfile");
    expect(err).not.toContain("not found");
    expect(err).not.toContain("error:");
    expect(err).not.toContain("panic:");
    expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual(["", "1 package installed"]);
    expect(await exited).toBe(0);

    await checkHoistedFiles();

    await rm(join(packageDir, "node_modules"), { recursive: true, force: true });

    ({ stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    }));

    err = await Bun.readableStreamToText(stderr);
    out = await Bun.readableStreamToText(stdout);
    expect(err).not.toContain("Saved lockfile");
    expect(err).not.toContain("not found");
    expect(err).not.toContain("error:");
    expect(err).not.toContain("panic:");
    expect(await readdirSorted(join(packageDir, "node_modules"))).toEqual([
      ".cache",
      "@another-scope",
      "@scoped",
      "aliased-file-dep",
      "dep-file-dep",
      "file-dep",
      "missing-file-dep",
      "self-file-dep",
    ]);
    expect(await exited).toBe(0);

    await checkHoistedFiles();
  });
  test("it should install folder dependencies with absolute paths", async () => {
    async function writePackages(num: number) {
      await rm(join(packageDir, `pkg0`), { recursive: true, force: true });
      for (let i = 0; i < num; i++) {
        await mkdir(join(packageDir, `pkg${i}`));
        await writeFile(
          join(packageDir, `pkg${i}`, "package.json"),
          JSON.stringify({
            name: `pkg${i}`,
            version: "1.1.1",
          }),
        );
      }
    }

    await writePackages(2);

    await writeFile(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "foo",
        version: "1.0.0",
        dependencies: {
          // without and without file protocol
          "pkg0": `file:${resolve(packageDir, "pkg0").replace(/\\/g, "\\\\")}`,
          "pkg1": `${resolve(packageDir, "pkg1").replace(/\\/g, "\\\\")}`,
        },
      }),
    );

    var { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      stdout: "pipe",
      stderr: "pipe",
      stdin: "pipe",
      env,
    });

    var err = await Bun.readableStreamToText(stderr);
    var out = await Bun.readableStreamToText(stdout);
    expect(err).toContain("Saved lockfile");
    expect(err).not.toContain("not found");
    expect(err).not.toContain("error:");
    expect(err).not.toContain("panic:");
    expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
      "",
      "+ pkg0@pkg0",
      "+ pkg1@pkg1",
      "",
      "2 packages installed",
    ]);
    expect(await exited).toBe(0);
    expect(await readdirSorted(join(packageDir, "node_modules"))).toEqual([".cache", "pkg0", "pkg1"]);
    expect(await file(join(packageDir, "node_modules", "pkg0", "package.json")).json()).toEqual({
      name: "pkg0",
      version: "1.1.1",
    });
    expect(await file(join(packageDir, "node_modules", "pkg1", "package.json")).json()).toEqual({
      name: "pkg1",
      version: "1.1.1",
    });
  });
});

test("name from manifest is scoped and url encoded", async () => {
  await write(
    join(packageDir, "package.json"),
    JSON.stringify({
      name: "foo",
      dependencies: {
        // `name` in the manifest for these packages is manually changed
        // to use `%40` and `%2f`
        "@url/encoding.2": "1.0.1",
        "@url/encoding.3": "1.0.1",
      },
    }),
  );

  await runBunInstall(env, packageDir);

  const files = await Promise.all([
    file(join(packageDir, "node_modules", "@url", "encoding.2", "package.json")).json(),
    file(join(packageDir, "node_modules", "@url", "encoding.3", "package.json")).json(),
  ]);

  expect(files).toEqual([
    { name: "@url/encoding.2", version: "1.0.1" },
    { name: "@url/encoding.3", version: "1.0.1" },
  ]);
});

describe("update", () => {
  test("duplicate peer dependency (one package is invalid_package_id)", async () => {
    await write(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "foo",
        dependencies: {
          "no-deps": "^1.0.0",
        },
        peerDependencies: {
          "no-deps": "^1.0.0",
        },
      }),
    );

    await runBunUpdate(env, packageDir);
    expect(await file(join(packageDir, "package.json")).json()).toEqual({
      name: "foo",
      dependencies: {
        "no-deps": "^1.1.0",
      },
      peerDependencies: {
        "no-deps": "^1.0.0",
      },
    });

    expect(await file(join(packageDir, "node_modules", "no-deps", "package.json")).json()).toMatchObject({
      version: "1.1.0",
    });
  });
  test("dist-tags", async () => {
    await write(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "foo",
        dependencies: {
          "a-dep": "latest",
        },
      }),
    );

    await runBunInstall(env, packageDir);
    expect(await file(join(packageDir, "node_modules", "a-dep", "package.json")).json()).toMatchObject({
      name: "a-dep",
      version: "1.0.10",
    });

    // Update without args, `latest` should stay
    await runBunUpdate(env, packageDir);
    expect(await file(join(packageDir, "package.json")).json()).toEqual({
      name: "foo",
      dependencies: {
        "a-dep": "latest",
      },
    });

    // Update with `a-dep` and `--latest`, `latest` should be replaced with the installed version
    await runBunUpdate(env, packageDir, ["a-dep"]);
    expect(await file(join(packageDir, "package.json")).json()).toEqual({
      name: "foo",
      dependencies: {
        "a-dep": "^1.0.10",
      },
    });
    await runBunUpdate(env, packageDir, ["--latest"]);
    expect(await file(join(packageDir, "package.json")).json()).toEqual({
      name: "foo",
      dependencies: {
        "a-dep": "^1.0.10",
      },
    });
  });
  test("exact versions stay exact", async () => {
    const runs = [
      { version: "1.0.1", dependency: "a-dep" },
      { version: "npm:a-dep@1.0.1", dependency: "aliased" },
    ];
    for (const { version, dependency } of runs) {
      await write(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "foo",
          dependencies: {
            [dependency]: version,
          },
        }),
      );
      async function check(version: string) {
        expect(await file(join(packageDir, "node_modules", dependency, "package.json")).json()).toMatchObject({
          name: "a-dep",
          version: version.replace(/.*@/, ""),
        });

        expect(await file(join(packageDir, "package.json")).json()).toMatchObject({
          dependencies: {
            [dependency]: version,
          },
        });
      }
      await runBunInstall(env, packageDir);
      await check(version);

      await runBunUpdate(env, packageDir);
      await check(version);

      await runBunUpdate(env, packageDir, [dependency]);
      await check(version);

      // this will actually update the package, but the version should remain exact
      await runBunUpdate(env, packageDir, ["--latest"]);
      await check(dependency === "aliased" ? "npm:a-dep@1.0.10" : "1.0.10");

      await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
      await rm(join(packageDir, "bun.lockb"));
    }
  });
  describe("tilde", () => {
    test("without args", async () => {
      await write(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "foo",
          dependencies: {
            "no-deps": "~1.0.0",
          },
        }),
      );

      await runBunInstall(env, packageDir);
      expect(await file(join(packageDir, "node_modules", "no-deps", "package.json")).json()).toMatchObject({
        name: "no-deps",
        version: "1.0.1",
      });

      let { out } = await runBunUpdate(env, packageDir);
      expect(out).toEqual(["", "Checked 1 install across 2 packages (no changes)"]);
      expect(await file(join(packageDir, "package.json")).json()).toEqual({
        name: "foo",
        dependencies: {
          "no-deps": "~1.0.1",
        },
      });

      // another update does not change anything (previously the version would update because it was changed to `^1.0.1`)
      ({ out } = await runBunUpdate(env, packageDir));
      expect(out).toEqual(["", "Checked 1 install across 2 packages (no changes)"]);
      expect(await file(join(packageDir, "package.json")).json()).toEqual({
        name: "foo",
        dependencies: {
          "no-deps": "~1.0.1",
        },
      });
    });

    for (const latest of [true, false]) {
      test(`update no args${latest ? " --latest" : ""}`, async () => {
        await write(
          join(packageDir, "package.json"),
          JSON.stringify({
            name: "foo",
            dependencies: {
              "a1": "npm:no-deps@1",
              "a10": "npm:no-deps@~1.0",
              "a11": "npm:no-deps@^1.0",
              "a12": "npm:no-deps@~1.0.1",
              "a13": "npm:no-deps@^1.0.1",
              "a14": "npm:no-deps@~1.1.0",
              "a15": "npm:no-deps@^1.1.0",
              "a2": "npm:no-deps@1.0",
              "a3": "npm:no-deps@1.1",
              "a4": "npm:no-deps@1.0.1",
              "a5": "npm:no-deps@1.1.0",
              "a6": "npm:no-deps@~1",
              "a7": "npm:no-deps@^1",
              "a8": "npm:no-deps@~1.1",
              "a9": "npm:no-deps@^1.1",
            },
          }),
        );

        if (latest) {
          await runBunUpdate(env, packageDir, ["--latest"]);
          expect(await file(join(packageDir, "package.json")).json()).toEqual({
            name: "foo",
            dependencies: {
              "a1": "npm:no-deps@^2.0.0",
              "a10": "npm:no-deps@~2.0.0",
              "a11": "npm:no-deps@^2.0.0",
              "a12": "npm:no-deps@~2.0.0",
              "a13": "npm:no-deps@^2.0.0",
              "a14": "npm:no-deps@~2.0.0",
              "a15": "npm:no-deps@^2.0.0",
              "a2": "npm:no-deps@~2.0.0",
              "a3": "npm:no-deps@~2.0.0",
              "a4": "npm:no-deps@2.0.0",
              "a5": "npm:no-deps@2.0.0",
              "a6": "npm:no-deps@~2.0.0",
              "a7": "npm:no-deps@^2.0.0",
              "a8": "npm:no-deps@~2.0.0",
              "a9": "npm:no-deps@^2.0.0",
            },
          });
        } else {
          await runBunUpdate(env, packageDir);
          expect(await file(join(packageDir, "package.json")).json()).toEqual({
            name: "foo",
            dependencies: {
              "a1": "npm:no-deps@^1.1.0",
              "a10": "npm:no-deps@~1.0.1",
              "a11": "npm:no-deps@^1.1.0",
              "a12": "npm:no-deps@~1.0.1",
              "a13": "npm:no-deps@^1.1.0",
              "a14": "npm:no-deps@~1.1.0",
              "a15": "npm:no-deps@^1.1.0",
              "a2": "npm:no-deps@~1.0.1",
              "a3": "npm:no-deps@~1.1.0",
              "a4": "npm:no-deps@1.0.1",
              "a5": "npm:no-deps@1.1.0",
              "a6": "npm:no-deps@~1.1.0",
              "a7": "npm:no-deps@^1.1.0",
              "a8": "npm:no-deps@~1.1.0",
              "a9": "npm:no-deps@^1.1.0",
            },
          });
        }
        const files = await Promise.all(
          ["a1", "a10", "a11", "a12", "a13", "a14", "a15", "a2", "a3", "a4", "a5", "a6", "a7", "a8", "a9"].map(alias =>
            file(join(packageDir, "node_modules", alias, "package.json")).json(),
          ),
        );

        if (latest) {
          // each version should be "2.0.0"
          expect(files).toMatchObject(Array(15).fill({ version: "2.0.0" }));
        } else {
          expect(files).toMatchObject([
            { version: "1.1.0" },
            { version: "1.0.1" },
            { version: "1.1.0" },
            { version: "1.0.1" },
            { version: "1.1.0" },
            { version: "1.1.0" },
            { version: "1.1.0" },
            { version: "1.0.1" },
            { version: "1.1.0" },
            { version: "1.0.1" },
            { version: "1.1.0" },
            { version: "1.1.0" },
            { version: "1.1.0" },
            { version: "1.1.0" },
            { version: "1.1.0" },
          ]);
        }
      });
    }

    test("with package name in args", async () => {
      await write(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "foo",
          dependencies: {
            "a-dep": "1.0.3",
            "no-deps": "~1.0.0",
          },
        }),
      );

      await runBunInstall(env, packageDir);
      expect(await file(join(packageDir, "node_modules", "no-deps", "package.json")).json()).toMatchObject({
        name: "no-deps",
        version: "1.0.1",
      });

      let { out } = await runBunUpdate(env, packageDir, ["no-deps"]);
      expect(out).toEqual(["", "installed no-deps@1.0.1", "", expect.stringContaining("done"), ""]);
      expect(await file(join(packageDir, "package.json")).json()).toEqual({
        name: "foo",
        dependencies: {
          "a-dep": "1.0.3",
          "no-deps": "~1.0.1",
        },
      });

      // update with --latest should only change the update request and keep `~`
      ({ out } = await runBunUpdate(env, packageDir, ["no-deps", "--latest"]));
      expect(out).toEqual(["", "installed no-deps@2.0.0", "", "1 package installed"]);
      expect(await file(join(packageDir, "package.json")).json()).toEqual({
        name: "foo",
        dependencies: {
          "a-dep": "1.0.3",
          "no-deps": "~2.0.0",
        },
      });
    });
  });
  describe("alises", () => {
    test("update all", async () => {
      await write(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "foo",
          dependencies: {
            "aliased-dep": "npm:no-deps@^1.0.0",
          },
        }),
      );

      await runBunUpdate(env, packageDir);
      expect(await file(join(packageDir, "package.json")).json()).toEqual({
        name: "foo",
        dependencies: {
          "aliased-dep": "npm:no-deps@^1.1.0",
        },
      });
      expect(await file(join(packageDir, "node_modules", "aliased-dep", "package.json")).json()).toMatchObject({
        name: "no-deps",
        version: "1.1.0",
      });
    });
    test("update specific aliased package", async () => {
      await write(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "foo",
          dependencies: {
            "aliased-dep": "npm:no-deps@^1.0.0",
          },
        }),
      );

      await runBunUpdate(env, packageDir, ["aliased-dep"]);
      expect(await file(join(packageDir, "package.json")).json()).toEqual({
        name: "foo",
        dependencies: {
          "aliased-dep": "npm:no-deps@^1.1.0",
        },
      });
      expect(await file(join(packageDir, "node_modules", "aliased-dep", "package.json")).json()).toMatchObject({
        name: "no-deps",
        version: "1.1.0",
      });
    });
    test("with pre and build tags", async () => {
      await write(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "foo",
          dependencies: {
            "aliased-dep": "npm:prereleases-3@5.0.0-alpha.150",
          },
        }),
      );

      await runBunUpdate(env, packageDir);

      expect(await file(join(packageDir, "package.json")).json()).toMatchObject({
        name: "foo",
        dependencies: {
          "aliased-dep": "npm:prereleases-3@5.0.0-alpha.150",
        },
      });

      expect(await file(join(packageDir, "node_modules", "aliased-dep", "package.json")).json()).toMatchObject({
        name: "prereleases-3",
        version: "5.0.0-alpha.150",
      });

      const { out } = await runBunUpdate(env, packageDir, ["--latest"]);
      expect(out).toEqual(["", "^ aliased-dep 5.0.0-alpha.150 -> 5.0.0-alpha.153", "", "1 package installed"]);
      expect(await file(join(packageDir, "package.json")).json()).toMatchObject({
        name: "foo",
        dependencies: {
          "aliased-dep": "npm:prereleases-3@5.0.0-alpha.153",
        },
      });
    });
  });
  test("--no-save will update packages in node_modules and not save to package.json", async () => {
    await write(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "foo",
        dependencies: {
          "a-dep": "1.0.1",
        },
      }),
    );

    let { out } = await runBunUpdate(env, packageDir, ["--no-save"]);
    expect(out).toEqual(["", "+ a-dep@1.0.1", "", "1 package installed"]);
    expect(await file(join(packageDir, "package.json")).json()).toEqual({
      name: "foo",
      dependencies: {
        "a-dep": "1.0.1",
      },
    });

    await write(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "foo",
        dependencies: {
          "a-dep": "^1.0.1",
        },
      }),
    );

    ({ out } = await runBunUpdate(env, packageDir, ["--no-save"]));
    expect(out).toEqual(["", "+ a-dep@1.0.10", "", "1 package installed"]);
    expect(await file(join(packageDir, "package.json")).json()).toEqual({
      name: "foo",
      dependencies: {
        "a-dep": "^1.0.1",
      },
    });

    // now save
    ({ out } = await runBunUpdate(env, packageDir));
    expect(out).toEqual(["", "Checked 1 install across 2 packages (no changes)"]);
    expect(await file(join(packageDir, "package.json")).json()).toEqual({
      name: "foo",
      dependencies: {
        "a-dep": "^1.0.10",
      },
    });
  });
  test("update won't update beyond version range unless the specified version allows it", async () => {
    await write(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "foo",
        dependencies: {
          "dep-with-tags": "^1.0.0",
        },
      }),
    );

    await runBunUpdate(env, packageDir);
    expect(await file(join(packageDir, "package.json")).json()).toEqual({
      name: "foo",
      dependencies: {
        "dep-with-tags": "^1.0.1",
      },
    });
    expect(await file(join(packageDir, "node_modules", "dep-with-tags", "package.json")).json()).toMatchObject({
      version: "1.0.1",
    });
    // update with package name does not update beyond version range
    await runBunUpdate(env, packageDir, ["dep-with-tags"]);
    expect(await file(join(packageDir, "package.json")).json()).toEqual({
      name: "foo",
      dependencies: {
        "dep-with-tags": "^1.0.1",
      },
    });
    expect(await file(join(packageDir, "node_modules", "dep-with-tags", "package.json")).json()).toMatchObject({
      version: "1.0.1",
    });

    // now update with a higher version range
    await runBunUpdate(env, packageDir, ["dep-with-tags@^2.0.0"]);
    expect(await file(join(packageDir, "package.json")).json()).toEqual({
      name: "foo",
      dependencies: {
        "dep-with-tags": "^2.0.1",
      },
    });
    expect(await file(join(packageDir, "node_modules", "dep-with-tags", "package.json")).json()).toMatchObject({
      version: "2.0.1",
    });
  });
  test("update should update all packages in the current workspace", async () => {
    await write(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "foo",
        workspaces: ["packages/*"],
        dependencies: {
          "what-bin": "^1.0.0",
          "uses-what-bin": "^1.0.0",
          "optional-native": "^1.0.0",
          "peer-deps-too": "^1.0.0",
          "two-range-deps": "^1.0.0",
          "one-fixed-dep": "^1.0.0",
          "no-deps-bins": "^2.0.0",
          "left-pad": "^1.0.0",
          "native": "1.0.0",
          "dep-loop-entry": "1.0.0",
          "dep-with-tags": "^2.0.0",
          "dev-deps": "1.0.0",
          "a-dep": "^1.0.0",
        },
      }),
    );

    const originalWorkspaceJSON = {
      name: "pkg1",
      version: "1.0.0",
      dependencies: {
        "what-bin": "^1.0.0",
        "uses-what-bin": "^1.0.0",
        "optional-native": "^1.0.0",
        "peer-deps-too": "^1.0.0",
        "two-range-deps": "^1.0.0",
        "one-fixed-dep": "^1.0.0",
        "no-deps-bins": "^2.0.0",
        "left-pad": "^1.0.0",
        "native": "1.0.0",
        "dep-loop-entry": "1.0.0",
        "dep-with-tags": "^2.0.0",
        "dev-deps": "1.0.0",
        "a-dep": "^1.0.0",
      },
    };

    await write(join(packageDir, "packages", "pkg1", "package.json"), JSON.stringify(originalWorkspaceJSON));

    // initial install, update root
    let { out } = await runBunUpdate(env, packageDir);
    expect(out).toEqual([
      "",
      "+ a-dep@1.0.10",
      "+ dep-loop-entry@1.0.0",
      "+ dep-with-tags@2.0.1",
      "+ dev-deps@1.0.0",
      "+ left-pad@1.0.0",
      "+ native@1.0.0",
      "+ no-deps-bins@2.0.0",
      "+ one-fixed-dep@1.0.0",
      "+ optional-native@1.0.0",
      "+ peer-deps-too@1.0.0",
      "+ two-range-deps@1.0.0",
      "+ uses-what-bin@1.5.0",
      "+ what-bin@1.5.0",
      "",
      // Due to optional-native dependency, this can be either 20 or 19 packages
      expect.stringMatching(/(?:20|19) packages installed/),
      "",
      "Blocked 1 postinstall. Run `bun pm untrusted` for details.",
      "",
    ]);

    let lockfile = parseLockfile(packageDir);
    // make sure this is valid
    expect(lockfile).toMatchNodeModulesAt(packageDir);
    expect(await file(join(packageDir, "package.json")).json()).toEqual({
      name: "foo",
      workspaces: ["packages/*"],
      dependencies: {
        "what-bin": "^1.5.0",
        "uses-what-bin": "^1.5.0",
        "optional-native": "^1.0.0",
        "peer-deps-too": "^1.0.0",
        "two-range-deps": "^1.0.0",
        "one-fixed-dep": "^1.0.0",
        "no-deps-bins": "^2.0.0",
        "left-pad": "^1.0.0",
        "native": "1.0.0",
        "dep-loop-entry": "1.0.0",
        "dep-with-tags": "^2.0.1",
        "dev-deps": "1.0.0",
        "a-dep": "^1.0.10",
      },
    });
    // workspace hasn't changed
    expect(await file(join(packageDir, "packages", "pkg1", "package.json")).json()).toEqual(originalWorkspaceJSON);

    // now update the workspace, first a couple packages, then all
    ({ out } = await runBunUpdate(env, join(packageDir, "packages", "pkg1"), [
      "what-bin",
      "uses-what-bin",
      "a-dep@1.0.5",
    ]));
    expect(out).toEqual([
      "",
      "installed what-bin@1.5.0 with binaries:",
      " - what-bin",
      "installed uses-what-bin@1.5.0",
      "installed a-dep@1.0.5",
      "",
      "3 packages installed",
    ]);
    // lockfile = parseLockfile(packageDir);
    // expect(lockfile).toMatchNodeModulesAt(packageDir);
    expect(await file(join(packageDir, "packages", "pkg1", "package.json")).json()).toMatchObject({
      dependencies: {
        "what-bin": "^1.5.0",
        "uses-what-bin": "^1.5.0",
        "optional-native": "^1.0.0",
        "peer-deps-too": "^1.0.0",
        "two-range-deps": "^1.0.0",
        "one-fixed-dep": "^1.0.0",
        "no-deps-bins": "^2.0.0",
        "left-pad": "^1.0.0",
        "native": "1.0.0",
        "dep-loop-entry": "1.0.0",
        "dep-with-tags": "^2.0.0",
        "dev-deps": "1.0.0",

        // a-dep should keep caret
        "a-dep": "^1.0.5",
      },
    });

    expect(await file(join(packageDir, "node_modules", "a-dep", "package.json")).json()).toMatchObject({
      name: "a-dep",
      version: "1.0.10",
    });

    expect(
      await file(join(packageDir, "packages", "pkg1", "node_modules", "a-dep", "package.json")).json(),
    ).toMatchObject({
      name: "a-dep",
      version: "1.0.5",
    });

    ({ out } = await runBunUpdate(env, join(packageDir, "packages", "pkg1"), ["a-dep@^1.0.5"]));
    expect(out).toEqual(["", "installed a-dep@1.0.10", "", expect.stringMatching(/(\[\d+\.\d+m?s\])/), ""]);
    expect(await file(join(packageDir, "node_modules", "a-dep", "package.json")).json()).toMatchObject({
      name: "a-dep",
      version: "1.0.10",
    });
    expect(await file(join(packageDir, "packages", "pkg1", "package.json")).json()).toMatchObject({
      dependencies: {
        "what-bin": "^1.5.0",
        "uses-what-bin": "^1.5.0",
        "optional-native": "^1.0.0",
        "peer-deps-too": "^1.0.0",
        "two-range-deps": "^1.0.0",
        "one-fixed-dep": "^1.0.0",
        "no-deps-bins": "^2.0.0",
        "left-pad": "^1.0.0",
        "native": "1.0.0",
        "dep-loop-entry": "1.0.0",
        "dep-with-tags": "^2.0.0",
        "dev-deps": "1.0.0",
        "a-dep": "^1.0.10",
      },
    });
  });
  test("update different dependency groups", async () => {
    for (const args of [true, false]) {
      for (const group of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
        await write(
          join(packageDir, "package.json"),
          JSON.stringify({
            name: "foo",
            [group]: {
              "a-dep": "^1.0.0",
            },
          }),
        );

        const { out } = args ? await runBunUpdate(env, packageDir, ["a-dep"]) : await runBunUpdate(env, packageDir);
        expect(out).toEqual(["", args ? "installed a-dep@1.0.10" : "+ a-dep@1.0.10", "", "1 package installed"]);
        expect(await file(join(packageDir, "package.json")).json()).toEqual({
          name: "foo",
          [group]: {
            "a-dep": "^1.0.10",
          },
        });

        await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
        await rm(join(packageDir, "bun.lockb"));
      }
    }
  });
  test("it should update packages from update requests", async () => {
    await write(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "foo",
        dependencies: {
          "no-deps": "1.0.0",
        },
        workspaces: ["packages/*"],
      }),
    );

    await write(
      join(packageDir, "packages", "pkg1", "package.json"),
      JSON.stringify({
        name: "pkg1",
        version: "1.0.0",
        dependencies: {
          "a-dep": "^1.0.0",
        },
      }),
    );

    await write(
      join(packageDir, "packages", "pkg2", "package.json"),
      JSON.stringify({
        name: "pkg2",
        dependencies: {
          "pkg1": "*",
          "is-number": "*",
        },
      }),
    );

    await runBunInstall(env, packageDir);

    expect(await file(join(packageDir, "node_modules", "no-deps", "package.json")).json()).toMatchObject({
      version: "1.0.0",
    });
    expect(await file(join(packageDir, "node_modules", "a-dep", "package.json")).json()).toMatchObject({
      version: "1.0.10",
    });
    expect(await file(join(packageDir, "node_modules", "pkg1", "package.json")).json()).toMatchObject({
      version: "1.0.0",
    });

    // update no-deps, no range, no change
    let { out } = await runBunUpdate(env, packageDir, ["no-deps"]);
    expect(out).toEqual(["", "installed no-deps@1.0.0", "", expect.stringMatching(/(\[\d+\.\d+m?s\])/), ""]);
    expect(await file(join(packageDir, "node_modules", "no-deps", "package.json")).json()).toMatchObject({
      version: "1.0.0",
    });

    // update package that doesn't exist to workspace, should add to package.json
    ({ out } = await runBunUpdate(env, join(packageDir, "packages", "pkg1"), ["no-deps"]));
    expect(out).toEqual(["", "installed no-deps@2.0.0", "", "1 package installed"]);
    expect(await file(join(packageDir, "node_modules", "no-deps", "package.json")).json()).toMatchObject({
      version: "1.0.0",
    });
    expect(await file(join(packageDir, "packages", "pkg1", "package.json")).json()).toMatchObject({
      name: "pkg1",
      version: "1.0.0",
      dependencies: {
        "a-dep": "^1.0.0",
        "no-deps": "^2.0.0",
      },
    });

    // update root package.json no-deps to ^1.0.0 and update it
    await write(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "foo",
        dependencies: {
          "no-deps": "^1.0.0",
        },
        workspaces: ["packages/*"],
      }),
    );

    ({ out } = await runBunUpdate(env, packageDir, ["no-deps"]));
    expect(out).toEqual(["", "installed no-deps@1.1.0", "", "1 package installed"]);
    expect(await file(join(packageDir, "node_modules", "no-deps", "package.json")).json()).toMatchObject({
      version: "1.1.0",
    });
  });

  test("--latest works with packages from arguments", async () => {
    await write(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "foo",
        dependencies: {
          "no-deps": "1.0.0",
        },
      }),
    );

    await runBunUpdate(env, packageDir, ["no-deps", "--latest"]);

    const files = await Promise.all([
      file(join(packageDir, "node_modules", "no-deps", "package.json")).json(),
      file(join(packageDir, "package.json")).json(),
    ]);

    expect(files).toMatchObject([{ version: "2.0.0" }, { dependencies: { "no-deps": "2.0.0" } }]);
  });
});

test("packages dependening on each other with aliases does not infinitely loop", async () => {
  await write(
    join(packageDir, "package.json"),
    JSON.stringify({
      name: "foo",
      dependencies: {
        "alias-loop-1": "1.0.0",
        "alias-loop-2": "1.0.0",
      },
    }),
  );

  await runBunInstall(env, packageDir);
  const files = await Promise.all([
    file(join(packageDir, "node_modules", "alias-loop-1", "package.json")).json(),
    file(join(packageDir, "node_modules", "alias-loop-2", "package.json")).json(),
    file(join(packageDir, "node_modules", "alias1", "package.json")).json(),
    file(join(packageDir, "node_modules", "alias2", "package.json")).json(),
  ]);
  expect(files).toMatchObject([
    { name: "alias-loop-1", version: "1.0.0" },
    { name: "alias-loop-2", version: "1.0.0" },
    { name: "alias-loop-2", version: "1.0.0" },
    { name: "alias-loop-1", version: "1.0.0" },
  ]);
});

test("it should re-populate .bin folder if package is reinstalled", async () => {
  await writeFile(
    join(packageDir, "package.json"),
    JSON.stringify({
      name: "foo",
      dependencies: {
        "what-bin": "1.5.0",
      },
    }),
  );

  var { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: packageDir,
    stderr: "pipe",
    stdout: "pipe",
    stdin: "pipe",
    env,
  });

  var err = await new Response(stderr).text();
  var out = await new Response(stdout).text();
  expect(err).toContain("Saved lockfile");
  expect(err).not.toContain("not found");
  expect(err).not.toContain("error:");
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    "",
    "+ what-bin@1.5.0",
    "",
    "1 package installed",
  ]);
  expect(await exited).toBe(0);
  const bin = process.platform === "win32" ? "what-bin.exe" : "what-bin";
  expect(Bun.which("what-bin", { PATH: join(packageDir, "node_modules", ".bin") })).toBe(
    join(packageDir, "node_modules", ".bin", bin),
  );
  if (process.platform === "win32") {
    expect(join(packageDir, "node_modules", ".bin", "what-bin")).toBeValidBin(join("..", "what-bin", "what-bin.js"));
  } else {
    expect(await file(join(packageDir, "node_modules", ".bin", bin)).text()).toContain("what-bin@1.5.0");
  }

  await rm(join(packageDir, "node_modules", ".bin"), { recursive: true, force: true });
  await rm(join(packageDir, "node_modules", "what-bin", "package.json"), { recursive: true, force: true });

  ({ stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: packageDir,
    stderr: "pipe",
    stdout: "pipe",
    stdin: "pipe",
    env,
  }));

  err = await new Response(stderr).text();
  out = await new Response(stdout).text();
  expect(err).not.toContain("Saved lockfile");
  expect(err).not.toContain("not found");
  expect(err).not.toContain("error:");
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    "",
    "+ what-bin@1.5.0",
    "",
    expect.stringContaining("1 package installed"),
  ]);
  expect(await exited).toBe(0);
  expect(Bun.which("what-bin", { PATH: join(packageDir, "node_modules", ".bin") })).toBe(
    join(packageDir, "node_modules", ".bin", bin),
  );
  if (process.platform === "win32") {
    expect(join(packageDir, "node_modules", ".bin", "what-bin")).toBeValidBin(join("..", "what-bin", "what-bin.js"));
  } else {
    expect(await file(join(packageDir, "node_modules", ".bin", "what-bin")).text()).toContain("what-bin@1.5.0");
  }
});

test("one version with binary map", async () => {
  await writeFile(
    join(packageDir, "package.json"),
    JSON.stringify({
      name: "foo",
      dependencies: {
        "map-bin": "1.0.2",
      },
    }),
  );

  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: packageDir,
    stderr: "pipe",
    stdout: "pipe",
    env,
  });

  const err = await Bun.readableStreamToText(stderr);
  const out = await Bun.readableStreamToText(stdout);
  expect(err).toContain("Saved lockfile");
  expect(err).not.toContain("not found");
  expect(err).not.toContain("error:");
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    "",
    "+ map-bin@1.0.2",
    "",
    "1 package installed",
  ]);
  expect(await exited).toBe(0);

  expect(await readdirSorted(join(packageDir, "node_modules", ".bin"))).toHaveBins(["map-bin", "map_bin"]);
  expect(join(packageDir, "node_modules", ".bin", "map-bin")).toBeValidBin(join("..", "map-bin", "bin", "map-bin"));
  expect(join(packageDir, "node_modules", ".bin", "map_bin")).toBeValidBin(join("..", "map-bin", "bin", "map-bin"));
});

test("multiple versions with binary map", async () => {
  await writeFile(
    join(packageDir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "1.2.3",
      dependencies: {
        "map-bin-multiple": "1.0.2",
      },
    }),
  );

  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: packageDir,
    stderr: "pipe",
    stdout: "pipe",
    env,
  });

  const err = await Bun.readableStreamToText(stderr);
  const out = await Bun.readableStreamToText(stdout);
  expect(err).toContain("Saved lockfile");
  expect(err).not.toContain("not found");
  expect(err).not.toContain("error:");
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    "",
    "+ map-bin-multiple@1.0.2",
    "",
    "1 package installed",
  ]);
  expect(await exited).toBe(0);

  expect(await readdirSorted(join(packageDir, "node_modules", ".bin"))).toHaveBins(["map-bin", "map_bin"]);
  expect(join(packageDir, "node_modules", ".bin", "map-bin")).toBeValidBin(
    join("..", "map-bin-multiple", "bin", "map-bin"),
  );
  expect(join(packageDir, "node_modules", ".bin", "map_bin")).toBeValidBin(
    join("..", "map-bin-multiple", "bin", "map-bin"),
  );
});

test("duplicate dependency in optionalDependencies maintains sort order", async () => {
  await write(
    join(packageDir, "package.json"),
    JSON.stringify({
      name: "foo",
      dependencies: {
        // `duplicate-optional` has `no-deps` as a normal dependency (1.0.0) and as an
        // optional dependency (1.0.1). The optional dependency version should be installed and
        // the sort order should remain the same (tested by `bun-debug bun.lockb`).
        "duplicate-optional": "1.0.1",
      },
    }),
  );

  await runBunInstall(env, packageDir);

  const lockfile = parseLockfile(packageDir);
  expect(lockfile).toMatchNodeModulesAt(packageDir);

  expect(await file(join(packageDir, "node_modules", "no-deps", "package.json")).json()).toMatchObject({
    version: "1.0.1",
  });

  const { stdout, exited } = spawn({
    cmd: [bunExe(), "bun.lockb"],
    cwd: packageDir,
    stderr: "inherit",
    stdout: "pipe",
    env,
  });

  const out = await Bun.readableStreamToText(stdout);
  expect(out.replaceAll(`${port}`, "4873")).toMatchSnapshot();
  expect(await exited).toBe(0);
});

test("missing package on reinstall, some with binaries", async () => {
  await writeFile(
    join(packageDir, "package.json"),
    JSON.stringify({
      name: "fooooo",
      dependencies: {
        "what-bin": "1.0.0",
        "uses-what-bin": "1.5.0",
        "optional-native": "1.0.0",
        "peer-deps-too": "1.0.0",
        "two-range-deps": "1.0.0",
        "one-fixed-dep": "2.0.0",
        "no-deps-bins": "2.0.0",
        "left-pad": "1.0.0",
        "native": "1.0.0",
        "dep-loop-entry": "1.0.0",
        "dep-with-tags": "3.0.0",
        "dev-deps": "1.0.0",
      },
    }),
  );

  var { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: packageDir,
    stderr: "pipe",
    stdout: "pipe",
    stdin: "pipe",
    env,
  });

  var err = await new Response(stderr).text();
  var out = await new Response(stdout).text();
  expect(err).toContain("Saved lockfile");
  expect(err).not.toContain("not found");
  expect(err).not.toContain("error:");
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    "",
    "+ dep-loop-entry@1.0.0",
    "+ dep-with-tags@3.0.0",
    "+ dev-deps@1.0.0",
    "+ left-pad@1.0.0",
    "+ native@1.0.0",
    "+ no-deps-bins@2.0.0",
    "+ one-fixed-dep@2.0.0",
    "+ optional-native@1.0.0",
    "+ peer-deps-too@1.0.0",
    "+ two-range-deps@1.0.0",
    "+ uses-what-bin@1.5.0",
    "+ what-bin@1.0.0",
    "",
    expect.stringContaining("19 packages installed"),
    "",
    "Blocked 1 postinstall. Run `bun pm untrusted` for details.",
    "",
  ]);
  expect(await exited).toBe(0);

  await rm(join(packageDir, "node_modules", "native"), { recursive: true, force: true });
  await rm(join(packageDir, "node_modules", "left-pad"), { recursive: true, force: true });
  await rm(join(packageDir, "node_modules", "dep-loop-entry"), { recursive: true, force: true });
  await rm(join(packageDir, "node_modules", "one-fixed-dep"), { recursive: true, force: true });
  await rm(join(packageDir, "node_modules", "peer-deps-too"), { recursive: true, force: true });
  await rm(join(packageDir, "node_modules", "two-range-deps", "node_modules", "no-deps"), {
    recursive: true,
    force: true,
  });
  await rm(join(packageDir, "node_modules", "one-fixed-dep"), { recursive: true, force: true });
  await rm(join(packageDir, "node_modules", "uses-what-bin", "node_modules", ".bin"), { recursive: true, force: true });
  await rm(join(packageDir, "node_modules", "uses-what-bin", "node_modules", "what-bin"), {
    recursive: true,
    force: true,
  });

  ({ stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: packageDir,
    stderr: "pipe",
    stdout: "pipe",
    stdin: "pipe",
    env,
  }));

  err = await new Response(stderr).text();
  out = await new Response(stdout).text();
  expect(err).not.toContain("Saved lockfile");
  expect(err).not.toContain("not found");
  expect(err).not.toContain("error:");
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    "",
    "+ dep-loop-entry@1.0.0",
    "+ left-pad@1.0.0",
    "+ native@1.0.0",
    "+ one-fixed-dep@2.0.0",
    "+ peer-deps-too@1.0.0",
    "",
    expect.stringContaining("7 packages installed"),
  ]);
  expect(await exited).toBe(0);

  expect(await exists(join(packageDir, "node_modules", "native", "package.json"))).toBe(true);
  expect(await exists(join(packageDir, "node_modules", "left-pad", "package.json"))).toBe(true);
  expect(await exists(join(packageDir, "node_modules", "dep-loop-entry", "package.json"))).toBe(true);
  expect(await exists(join(packageDir, "node_modules", "one-fixed-dep", "package.json"))).toBe(true);
  expect(await exists(join(packageDir, "node_modules", "peer-deps-too", "package.json"))).toBe(true);
  expect(await exists(join(packageDir, "node_modules", "two-range-deps", "node_modules", "no-deps"))).toBe(true);
  expect(await exists(join(packageDir, "node_modules", "one-fixed-dep", "package.json"))).toBe(true);
  expect(await exists(join(packageDir, "node_modules", "uses-what-bin", "node_modules", ".bin"))).toBe(true);
  expect(await exists(join(packageDir, "node_modules", "uses-what-bin", "node_modules", "what-bin"))).toBe(true);
  const bin = process.platform === "win32" ? "what-bin.exe" : "what-bin";
  expect(Bun.which("what-bin", { PATH: join(packageDir, "node_modules", ".bin") })).toBe(
    join(packageDir, "node_modules", ".bin", bin),
  );
  expect(
    Bun.which("what-bin", { PATH: join(packageDir, "node_modules", "uses-what-bin", "node_modules", ".bin") }),
  ).toBe(join(packageDir, "node_modules", "uses-what-bin", "node_modules", ".bin", bin));
});

// waiter thread is only a thing on Linux.
for (const forceWaiterThread of isLinux ? [false, true] : [false]) {
  const testEnv = forceWaiterThread ? { ...env, BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1" } : env;
  describe("lifecycle scripts" + (forceWaiterThread ? " (waiter thread)" : ""), async () => {
    test("root package with all lifecycle scripts", async () => {
      const writeScript = async (name: string) => {
        const contents = `
      import { writeFileSync, existsSync, rmSync } from "fs";
      import { join } from "path";

      const file = join(import.meta.dir, "${name}.txt");

      if (existsSync(file)) {
        rmSync(file);
        writeFileSync(file, "${name} exists!");
      } else {
        writeFileSync(file, "${name}!");
      }
      `;
        await writeFile(join(packageDir, `${name}.js`), contents);
      };

      await writeFile(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "1.0.0",
          scripts: {
            preinstall: `${bunExe()} preinstall.js`,
            install: `${bunExe()} install.js`,
            postinstall: `${bunExe()} postinstall.js`,
            preprepare: `${bunExe()} preprepare.js`,
            prepare: `${bunExe()} prepare.js`,
            postprepare: `${bunExe()} postprepare.js`,
          },
        }),
      );

      await writeScript("preinstall");
      await writeScript("install");
      await writeScript("postinstall");
      await writeScript("preprepare");
      await writeScript("prepare");
      await writeScript("postprepare");

      var { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env: testEnv,
      });
      var err = await new Response(stderr).text();
      var out = await new Response(stdout).text();
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      expect(await exited).toBe(0);
      expect(await exists(join(packageDir, "preinstall.txt"))).toBeTrue();
      expect(await exists(join(packageDir, "install.txt"))).toBeTrue();
      expect(await exists(join(packageDir, "postinstall.txt"))).toBeTrue();
      expect(await exists(join(packageDir, "preprepare.txt"))).toBeTrue();
      expect(await exists(join(packageDir, "prepare.txt"))).toBeTrue();
      expect(await exists(join(packageDir, "postprepare.txt"))).toBeTrue();
      expect(await file(join(packageDir, "preinstall.txt")).text()).toBe("preinstall!");
      expect(await file(join(packageDir, "install.txt")).text()).toBe("install!");
      expect(await file(join(packageDir, "postinstall.txt")).text()).toBe("postinstall!");
      expect(await file(join(packageDir, "preprepare.txt")).text()).toBe("preprepare!");
      expect(await file(join(packageDir, "prepare.txt")).text()).toBe("prepare!");
      expect(await file(join(packageDir, "postprepare.txt")).text()).toBe("postprepare!");

      // add a dependency with all lifecycle scripts
      await writeFile(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "1.0.0",
          scripts: {
            preinstall: `${bunExe()} preinstall.js`,
            install: `${bunExe()} install.js`,
            postinstall: `${bunExe()} postinstall.js`,
            preprepare: `${bunExe()} preprepare.js`,
            prepare: `${bunExe()} prepare.js`,
            postprepare: `${bunExe()} postprepare.js`,
          },
          dependencies: {
            "all-lifecycle-scripts": "1.0.0",
          },
          trustedDependencies: ["all-lifecycle-scripts"],
        }),
      );

      ({ stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env: testEnv,
      }));

      err = await new Response(stderr).text();
      out = await new Response(stdout).text();
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        "",
        "+ all-lifecycle-scripts@1.0.0",
        "",
        expect.stringContaining("1 package installed"),
      ]);
      expect(await exited).toBe(0);
      expect(await file(join(packageDir, "preinstall.txt")).text()).toBe("preinstall exists!");
      expect(await file(join(packageDir, "install.txt")).text()).toBe("install exists!");
      expect(await file(join(packageDir, "postinstall.txt")).text()).toBe("postinstall exists!");
      expect(await file(join(packageDir, "preprepare.txt")).text()).toBe("preprepare exists!");
      expect(await file(join(packageDir, "prepare.txt")).text()).toBe("prepare exists!");
      expect(await file(join(packageDir, "postprepare.txt")).text()).toBe("postprepare exists!");

      const depDir = join(packageDir, "node_modules", "all-lifecycle-scripts");

      expect(await exists(join(depDir, "preinstall.txt"))).toBeTrue();
      expect(await exists(join(depDir, "install.txt"))).toBeTrue();
      expect(await exists(join(depDir, "postinstall.txt"))).toBeTrue();
      expect(await exists(join(depDir, "preprepare.txt"))).toBeFalse();
      expect(await exists(join(depDir, "prepare.txt"))).toBeTrue();
      expect(await exists(join(depDir, "postprepare.txt"))).toBeFalse();

      expect(await file(join(depDir, "preinstall.txt")).text()).toBe("preinstall!");
      expect(await file(join(depDir, "install.txt")).text()).toBe("install!");
      expect(await file(join(depDir, "postinstall.txt")).text()).toBe("postinstall!");
      expect(await file(join(depDir, "prepare.txt")).text()).toBe("prepare!");

      await rm(join(packageDir, "preinstall.txt"));
      await rm(join(packageDir, "install.txt"));
      await rm(join(packageDir, "postinstall.txt"));
      await rm(join(packageDir, "preprepare.txt"));
      await rm(join(packageDir, "prepare.txt"));
      await rm(join(packageDir, "postprepare.txt"));
      await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
      await rm(join(packageDir, "bun.lockb"));

      // all at once
      ({ stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env: testEnv,
      }));
      expect(await exited).toBe(0);
      err = await new Response(stderr).text();
      out = await new Response(stdout).text();
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        "",
        "+ all-lifecycle-scripts@1.0.0",
        "",
        expect.stringContaining("1 package installed"),
      ]);

      expect(await file(join(packageDir, "preinstall.txt")).text()).toBe("preinstall!");
      expect(await file(join(packageDir, "install.txt")).text()).toBe("install!");
      expect(await file(join(packageDir, "postinstall.txt")).text()).toBe("postinstall!");
      expect(await file(join(packageDir, "preprepare.txt")).text()).toBe("preprepare!");
      expect(await file(join(packageDir, "prepare.txt")).text()).toBe("prepare!");
      expect(await file(join(packageDir, "postprepare.txt")).text()).toBe("postprepare!");

      expect(await file(join(depDir, "preinstall.txt")).text()).toBe("preinstall!");
      expect(await file(join(depDir, "install.txt")).text()).toBe("install!");
      expect(await file(join(depDir, "postinstall.txt")).text()).toBe("postinstall!");
      expect(await file(join(depDir, "prepare.txt")).text()).toBe("prepare!");
    });

    test("workspace lifecycle scripts", async () => {
      await writeFile(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "1.0.0",
          workspaces: ["packages/*"],
          scripts: {
            preinstall: `touch preinstall.txt`,
            install: `touch install.txt`,
            postinstall: `touch postinstall.txt`,
            preprepare: `touch preprepare.txt`,
            prepare: `touch prepare.txt`,
            postprepare: `touch postprepare.txt`,
          },
        }),
      );

      await mkdir(join(packageDir, "packages", "pkg1"), { recursive: true });
      await writeFile(
        join(packageDir, "packages", "pkg1", "package.json"),
        JSON.stringify({
          name: "pkg1",
          version: "1.0.0",
          scripts: {
            preinstall: `touch preinstall.txt`,
            install: `touch install.txt`,
            postinstall: `touch postinstall.txt`,
            preprepare: `touch preprepare.txt`,
            prepare: `touch prepare.txt`,
            postprepare: `touch postprepare.txt`,
          },
        }),
      );

      await mkdir(join(packageDir, "packages", "pkg2"), { recursive: true });
      await writeFile(
        join(packageDir, "packages", "pkg2", "package.json"),
        JSON.stringify({
          name: "pkg2",
          version: "1.0.0",
          scripts: {
            preinstall: `touch preinstall.txt`,
            install: `touch install.txt`,
            postinstall: `touch postinstall.txt`,
            preprepare: `touch preprepare.txt`,
            prepare: `touch prepare.txt`,
            postprepare: `touch postprepare.txt`,
          },
        }),
      );

      var { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env: testEnv,
      });

      var err = await new Response(stderr).text();
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      expect(err).toContain("Saved lockfile");
      var out = await new Response(stdout).text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual(["", "2 packages installed"]);
      expect(await exited).toBe(0);

      expect(await exists(join(packageDir, "preinstall.txt"))).toBeTrue();
      expect(await exists(join(packageDir, "install.txt"))).toBeTrue();
      expect(await exists(join(packageDir, "postinstall.txt"))).toBeTrue();
      expect(await exists(join(packageDir, "preprepare.txt"))).toBeTrue();
      expect(await exists(join(packageDir, "prepare.txt"))).toBeTrue();
      expect(await exists(join(packageDir, "postprepare.txt"))).toBeTrue();
      expect(await exists(join(packageDir, "packages", "pkg1", "preinstall.txt"))).toBeTrue();
      expect(await exists(join(packageDir, "packages", "pkg1", "install.txt"))).toBeTrue();
      expect(await exists(join(packageDir, "packages", "pkg1", "postinstall.txt"))).toBeTrue();
      expect(await exists(join(packageDir, "packages", "pkg1", "preprepare.txt"))).toBeFalse();
      expect(await exists(join(packageDir, "packages", "pkg1", "prepare.txt"))).toBeTrue();
      expect(await exists(join(packageDir, "packages", "pkg1", "postprepare.txt"))).toBeFalse();
      expect(await exists(join(packageDir, "packages", "pkg2", "preinstall.txt"))).toBeTrue();
      expect(await exists(join(packageDir, "packages", "pkg2", "install.txt"))).toBeTrue();
      expect(await exists(join(packageDir, "packages", "pkg2", "postinstall.txt"))).toBeTrue();
      expect(await exists(join(packageDir, "packages", "pkg2", "preprepare.txt"))).toBeFalse();
      expect(await exists(join(packageDir, "packages", "pkg2", "prepare.txt"))).toBeTrue();
      expect(await exists(join(packageDir, "packages", "pkg2", "postprepare.txt"))).toBeFalse();
    });

    test("dependency lifecycle scripts run before root lifecycle scripts", async () => {
      const script = '[[ -f "./node_modules/uses-what-bin-slow/what-bin.txt" ]]';
      await writeFile(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "1.0.0",
          dependencies: {
            "uses-what-bin-slow": "1.0.0",
          },
          trustedDependencies: ["uses-what-bin-slow"],
          scripts: {
            install: script,
            postinstall: script,
            preinstall: script,
            prepare: script,
            postprepare: script,
            preprepare: script,
          },
        }),
      );

      // uses-what-bin-slow will wait one second then write a file to disk. The root package should wait for
      // for this to happen before running its lifecycle scripts.

      var { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env: testEnv,
      });

      var err = await new Response(stderr).text();
      var out = await new Response(stdout).text();
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      expect(await exited).toBe(0);
    });

    test("install a dependency with lifecycle scripts, then add to trusted dependencies and install again", async () => {
      await writeFile(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "1.0.0",
          dependencies: {
            "all-lifecycle-scripts": "1.0.0",
          },
          trustedDependencies: [],
        }),
      );

      var { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env: testEnv,
      });

      var err = await new Response(stderr).text();
      var out = await new Response(stdout).text();
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        "",
        "+ all-lifecycle-scripts@1.0.0",
        "",
        expect.stringContaining("1 package installed"),
        "",
        "Blocked 3 postinstalls. Run `bun pm untrusted` for details.",
        "",
      ]);
      expect(await exited).toBe(0);

      const depDir = join(packageDir, "node_modules", "all-lifecycle-scripts");
      expect(await exists(join(depDir, "preinstall.txt"))).toBeFalse();
      expect(await exists(join(depDir, "install.txt"))).toBeFalse();
      expect(await exists(join(depDir, "postinstall.txt"))).toBeFalse();
      expect(await exists(join(depDir, "preprepare.txt"))).toBeFalse();
      expect(await exists(join(depDir, "prepare.txt"))).toBeTrue();
      expect(await exists(join(depDir, "postprepare.txt"))).toBeFalse();
      expect(await file(join(depDir, "prepare.txt")).text()).toBe("prepare!");

      // add to trusted dependencies
      await writeFile(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "1.0.0",
          dependencies: {
            "all-lifecycle-scripts": "1.0.0",
          },
          trustedDependencies: ["all-lifecycle-scripts"],
        }),
      );

      ({ stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env: testEnv,
      }));

      err = await new Response(stderr).text();
      out = await new Response(stdout).text();
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        "",
        expect.stringContaining("Checked 1 install across 2 packages (no changes)"),
      ]);
      expect(await exited).toBe(0);

      expect(await file(join(depDir, "preinstall.txt")).text()).toBe("preinstall!");
      expect(await file(join(depDir, "install.txt")).text()).toBe("install!");
      expect(await file(join(depDir, "postinstall.txt")).text()).toBe("postinstall!");
      expect(await file(join(depDir, "prepare.txt")).text()).toBe("prepare!");
      expect(await exists(join(depDir, "preprepare.txt"))).toBeFalse();
      expect(await exists(join(depDir, "postprepare.txt"))).toBeFalse();
    });

    test("adding a package without scripts to trustedDependencies", async () => {
      await writeFile(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "1.0.0",
          dependencies: {
            "what-bin": "1.0.0",
          },
          trustedDependencies: ["what-bin"],
        }),
      );

      var { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env: testEnv,
      });

      var err = await new Response(stderr).text();
      var out = await new Response(stdout).text();
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        "",
        "+ what-bin@1.0.0",
        "",
        "1 package installed",
      ]);
      expect(await exited).toBe(0);
      expect(await readdirSorted(join(packageDir, "node_modules"))).toEqual([".bin", ".cache", "what-bin"]);
      const isWindows = process.platform === "win32";
      const what_bin_bins = !isWindows ? ["what-bin"] : ["what-bin.bunx", "what-bin.exe"];
      // prettier-ignore
      expect(await readdirSorted(join(packageDir, "node_modules", ".bin"))).toEqual(what_bin_bins);

      ({ stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env: testEnv,
      }));

      err = await new Response(stderr).text();
      out = await new Response(stdout).text();
      expect(err).not.toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        "",
        "Checked 1 install across 2 packages (no changes)",
      ]);
      expect(await exited).toBe(0);

      await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
      await rm(join(packageDir, "bun.lockb"));

      await writeFile(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "1.0.0",
          dependencies: { "what-bin": "1.0.0" },
        }),
      );

      ({ stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env: testEnv,
      }));

      err = await new Response(stderr).text();
      out = await new Response(stdout).text();
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        "",
        "+ what-bin@1.0.0",
        "",
        "1 package installed",
      ]);
      expect(await exited).toBe(0);
      expect(await readdirSorted(join(packageDir, "node_modules"))).toEqual([".bin", ".cache", "what-bin"]);
      expect(await readdirSorted(join(packageDir, "node_modules", ".bin"))).toEqual(what_bin_bins);

      ({ stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env: testEnv,
      }));

      err = await new Response(stderr).text();
      out = await new Response(stdout).text();
      expect(err).not.toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        "",
        "Checked 1 install across 2 packages (no changes)",
      ]);
      expect(await exited).toBe(0);
      expect(await readdirSorted(join(packageDir, "node_modules"))).toEqual([".bin", ".cache", "what-bin"]);
      expect(await readdirSorted(join(packageDir, "node_modules", ".bin"))).toEqual(what_bin_bins);

      // add it to trusted dependencies
      await writeFile(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "1.0.0",
          dependencies: {
            "what-bin": "1.0.0",
          },
          trustedDependencies: ["what-bin"],
        }),
      );

      ({ stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env: testEnv,
      }));

      err = await new Response(stderr).text();
      out = await new Response(stdout).text();
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        "",
        "Checked 1 install across 2 packages (no changes)",
      ]);
      expect(await exited).toBe(0);
      expect(await readdirSorted(join(packageDir, "node_modules"))).toEqual([".bin", ".cache", "what-bin"]);
      expect(await readdirSorted(join(packageDir, "node_modules", ".bin"))).toEqual(what_bin_bins);
    });

    test("lifecycle scripts run if node_modules is deleted", async () => {
      await writeFile(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "1.0.0",
          dependencies: {
            "lifecycle-postinstall": "1.0.0",
          },
          trustedDependencies: ["lifecycle-postinstall"],
        }),
      );
      var { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env: testEnv,
      });
      var err = await new Response(stderr).text();
      var out = await new Response(stdout).text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        "",
        "+ lifecycle-postinstall@1.0.0",
        "",
        // @ts-ignore
        expect.stringContaining("1 package installed"),
      ]);
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      expect(await exists(join(packageDir, "node_modules", "lifecycle-postinstall", "postinstall.txt"))).toBeTrue();
      expect(await exited).toBe(0);
      await rm(join(packageDir, "node_modules"), { force: true, recursive: true });
      ({ stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env: testEnv,
      }));
      err = await new Response(stderr).text();
      out = await new Response(stdout).text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        "",
        "+ lifecycle-postinstall@1.0.0",
        "",
        expect.stringContaining("1 package installed"),
      ]);
      expect(err).not.toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      expect(await exists(join(packageDir, "node_modules", "lifecycle-postinstall", "postinstall.txt"))).toBeTrue();
      expect(await exited).toBe(0);
    });

    test("INIT_CWD is set to the correct directory", async () => {
      await writeFile(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "1.0.0",
          scripts: {
            install: "bun install.js",
          },
          dependencies: {
            "lifecycle-init-cwd": "1.0.0",
            "another-init-cwd": "npm:lifecycle-init-cwd@1.0.0",
          },
          trustedDependencies: ["lifecycle-init-cwd", "another-init-cwd"],
        }),
      );

      await writeFile(
        join(packageDir, "install.js"),
        `
      const fs = require("fs");
      const path = require("path");

      fs.writeFileSync(
      path.join(__dirname, "test.txt"),
      process.env.INIT_CWD || "does not exist"
      );
      `,
      );

      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env: testEnv,
      });

      const err = await new Response(stderr).text();
      const out = await new Response(stdout).text();
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        "",
        "+ another-init-cwd@1.0.0",
        "+ lifecycle-init-cwd@1.0.0",
        "",
        expect.stringContaining("1 package installed"),
      ]);
      expect(await exited).toBe(0);
      expect(await file(join(packageDir, "test.txt")).text()).toBe(packageDir);
      expect(await file(join(packageDir, "node_modules/lifecycle-init-cwd/test.txt")).text()).toBe(packageDir);
      expect(await file(join(packageDir, "node_modules/another-init-cwd/test.txt")).text()).toBe(packageDir);
    });

    test("failing lifecycle script should print output", async () => {
      await writeFile(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "1.0.0",
          dependencies: {
            "lifecycle-failing-postinstall": "1.0.0",
          },
          trustedDependencies: ["lifecycle-failing-postinstall"],
        }),
      );

      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env: testEnv,
      });

      const err = await new Response(stderr).text();
      expect(err).toContain("hello");
      expect(await exited).toBe(1);
      const out = await new Response(stdout).text();
      expect(out).toBeEmpty();
    });

    test("failing root lifecycle script should print output correctly", async () => {
      await writeFile(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "fooooooooo",
          version: "1.0.0",
          scripts: {
            preinstall: `${bunExe()} -e "throw new Error('Oops!')"`,
          },
        }),
      );

      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stderr: "pipe",
        env: testEnv,
      });

      expect(await exited).toBe(1);
      expect(await Bun.readableStreamToText(stdout)).toBeEmpty();
      const err = await Bun.readableStreamToText(stderr);
      expect(err).toContain("error: Oops!");
      expect(err).toContain('error: preinstall script from "fooooooooo" exited with 1');
    });

    test("exit 0 in lifecycle scripts works", async () => {
      await writeFile(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "1.0.0",
          scripts: {
            postinstall: "exit 0",
            prepare: "exit 0",
            postprepare: "exit 0",
          },
        }),
      );

      var { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env: testEnv,
      });

      const err = await new Response(stderr).text();
      expect(err).toContain("No packages! Deleted empty lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      const out = await new Response(stdout).text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        "",
        expect.stringContaining("done"),
        "",
      ]);
      expect(await exited).toBe(0);
    });

    test("--ignore-scripts should skip lifecycle scripts", async () => {
      await writeFile(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "foo",
          dependencies: {
            "lifecycle-failing-postinstall": "1.0.0",
          },
          trustedDependencies: ["lifecycle-failing-postinstall"],
        }),
      );

      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install", "--ignore-scripts"],
        cwd: packageDir,
        stdout: "pipe",
        stderr: "pipe",
        stdin: "pipe",
        env: testEnv,
      });

      const err = await new Response(stderr).text();
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("error:");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("hello");
      const out = await new Response(stdout).text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        "",
        "+ lifecycle-failing-postinstall@1.0.0",
        "",
        "1 package installed",
      ]);
      expect(await exited).toBe(0);
    });

    test("it should add `node-gyp rebuild` as the `install` script when `install` and `postinstall` don't exist and `binding.gyp` exists in the root of the package", async () => {
      await writeFile(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "1.0.0",
          dependencies: {
            "binding-gyp-scripts": "1.5.0",
          },
          trustedDependencies: ["binding-gyp-scripts"],
        }),
      );

      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env: testEnv,
      });

      const err = await new Response(stderr).text();
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      const out = await new Response(stdout).text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        "",
        "+ binding-gyp-scripts@1.5.0",
        "",
        expect.stringContaining("2 packages installed"),
      ]);
      expect(await exited).toBe(0);
      expect(await exists(join(packageDir, "node_modules/binding-gyp-scripts/build.node"))).toBeTrue();
    });

    test("automatic node-gyp scripts should not run for untrusted dependencies, and should run after adding to `trustedDependencies`", async () => {
      const packageJSON: any = {
        name: "foo",
        version: "1.0.0",
        dependencies: {
          "binding-gyp-scripts": "1.5.0",
        },
      };
      await writeFile(join(packageDir, "package.json"), JSON.stringify(packageJSON));

      var { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env: testEnv,
      });

      let err = await new Response(stderr).text();
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      const out = await new Response(stdout).text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        "",
        "+ binding-gyp-scripts@1.5.0",
        "",
        expect.stringContaining("2 packages installed"),
        "",
        "Blocked 1 postinstall. Run `bun pm untrusted` for details.",
        "",
      ]);
      expect(await exited).toBe(0);
      expect(await exists(join(packageDir, "node_modules", "binding-gyp-scripts", "build.node"))).toBeFalse();

      packageJSON.trustedDependencies = ["binding-gyp-scripts"];
      await writeFile(join(packageDir, "package.json"), JSON.stringify(packageJSON));

      ({ stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env: testEnv,
      }));

      err = await Bun.readableStreamToText(stderr);
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      expect(err).not.toContain("warn:");

      expect(await exited).toBe(0);
      expect(await exists(join(packageDir, "node_modules", "binding-gyp-scripts", "build.node"))).toBeTrue();
    });

    test("automatic node-gyp scripts work in package root", async () => {
      await writeFile(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "1.0.0",
          dependencies: {
            "node-gyp": "1.5.0",
          },
        }),
      );

      await writeFile(join(packageDir, "binding.gyp"), "");

      var { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env: testEnv,
      });

      const err = await new Response(stderr).text();
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      const out = await new Response(stdout).text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        "",
        "+ node-gyp@1.5.0",
        "",
        expect.stringContaining("1 package installed"),
      ]);
      expect(await exited).toBe(0);
      expect(await exists(join(packageDir, "build.node"))).toBeTrue();

      await rm(join(packageDir, "build.node"));

      ({ stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env: testEnv,
      }));

      expect(await exited).toBe(0);
      expect(await exists(join(packageDir, "build.node"))).toBeTrue();
    });

    test("auto node-gyp scripts work when scripts exists other than `install` and `preinstall`", async () => {
      await writeFile(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "1.0.0",
          dependencies: {
            "node-gyp": "1.5.0",
          },
          scripts: {
            postinstall: "exit 0",
            prepare: "exit 0",
            postprepare: "exit 0",
          },
        }),
      );

      await writeFile(join(packageDir, "binding.gyp"), "");

      var { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env: testEnv,
      });

      const err = await new Response(stderr).text();
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      const out = await new Response(stdout).text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        "",
        "+ node-gyp@1.5.0",
        "",
        expect.stringContaining("1 package installed"),
      ]);
      expect(await exited).toBe(0);
      expect(await exists(join(packageDir, "build.node"))).toBeTrue();
    });

    for (const script of ["install", "preinstall"]) {
      test(`does not add auto node-gyp script when ${script} script exists`, async () => {
        const packageJSON: any = {
          name: "foo",
          version: "1.0.0",
          dependencies: {
            "node-gyp": "1.5.0",
          },
          scripts: {
            [script]: "exit 0",
          },
        };
        await writeFile(join(packageDir, "package.json"), JSON.stringify(packageJSON));
        await writeFile(join(packageDir, "binding.gyp"), "");

        const { stdout, stderr, exited } = spawn({
          cmd: [bunExe(), "install"],
          cwd: packageDir,
          stdout: "pipe",
          stdin: "pipe",
          stderr: "pipe",
          env: testEnv,
        });

        const err = await new Response(stderr).text();
        expect(err).toContain("Saved lockfile");
        expect(err).not.toContain("not found");
        expect(err).not.toContain("error:");
        const out = await new Response(stdout).text();
        expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
          "",
          "+ node-gyp@1.5.0",
          "",
          expect.stringContaining("1 package installed"),
        ]);
        expect(await exited).toBe(0);
        expect(await exists(join(packageDir, "build.node"))).toBeFalse();
      });
    }

    test("git dependencies also run `preprepare`, `prepare`, and `postprepare` scripts", async () => {
      await writeFile(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "1.0.0",
          dependencies: {
            "lifecycle-install-test": "dylan-conway/lifecycle-install-test#3ba6af5b64f2d27456e08df21d750072dffd3eee",
          },
        }),
      );

      var { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env: testEnv,
      });

      let err = await new Response(stderr).text();
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      const out = await new Response(stdout).text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        "",
        "+ lifecycle-install-test@github:dylan-conway/lifecycle-install-test#3ba6af5",
        "",
        expect.stringContaining("1 package installed"),
        "",
        "Blocked 6 postinstalls. Run `bun pm untrusted` for details.",
        "",
      ]);
      expect(await exited).toBe(0);
      expect(await exists(join(packageDir, "node_modules", "lifecycle-install-test", "preprepare.txt"))).toBeFalse();
      expect(await exists(join(packageDir, "node_modules", "lifecycle-install-test", "prepare.txt"))).toBeFalse();
      expect(await exists(join(packageDir, "node_modules", "lifecycle-install-test", "postprepare.txt"))).toBeFalse();
      expect(await exists(join(packageDir, "node_modules", "lifecycle-install-test", "preinstall.txt"))).toBeFalse();
      expect(await exists(join(packageDir, "node_modules", "lifecycle-install-test", "install.txt"))).toBeFalse();
      expect(await exists(join(packageDir, "node_modules", "lifecycle-install-test", "postinstall.txt"))).toBeFalse();

      await writeFile(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "1.0.0",
          dependencies: {
            "lifecycle-install-test": "dylan-conway/lifecycle-install-test#3ba6af5b64f2d27456e08df21d750072dffd3eee",
          },
          trustedDependencies: ["lifecycle-install-test"],
        }),
      );

      ({ stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env: testEnv,
      }));

      err = await Bun.readableStreamToText(stderr);
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      expect(err).not.toContain("warn:");

      expect(await exited).toBe(0);
      expect(await exists(join(packageDir, "node_modules", "lifecycle-install-test", "preprepare.txt"))).toBeTrue();
      expect(await exists(join(packageDir, "node_modules", "lifecycle-install-test", "prepare.txt"))).toBeTrue();
      expect(await exists(join(packageDir, "node_modules", "lifecycle-install-test", "postprepare.txt"))).toBeTrue();
      expect(await exists(join(packageDir, "node_modules", "lifecycle-install-test", "preinstall.txt"))).toBeTrue();
      expect(await exists(join(packageDir, "node_modules", "lifecycle-install-test", "install.txt"))).toBeTrue();
      expect(await exists(join(packageDir, "node_modules", "lifecycle-install-test", "postinstall.txt"))).toBeTrue();
    });

    test("root lifecycle scripts should wait for dependency lifecycle scripts", async () => {
      await writeFile(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "1.0.0",
          dependencies: {
            "uses-what-bin-slow": "1.0.0",
          },
          trustedDependencies: ["uses-what-bin-slow"],
          scripts: {
            install: '[[ -f "./node_modules/uses-what-bin-slow/what-bin.txt" ]]',
          },
        }),
      );

      // Package `uses-what-bin-slow` has an install script that will sleep for 1 second
      // before writing `what-bin.txt` to disk. The root package has an install script that
      // checks if this file exists. If the root package install script does not wait for
      // the other to finish, it will fail.

      var { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env: testEnv,
      });

      const err = await new Response(stderr).text();
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      const out = await new Response(stdout).text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        "",
        "+ uses-what-bin-slow@1.0.0",
        "",
        "2 packages installed",
      ]);
      expect(await exited).toBe(0);
    });

    async function createPackagesWithScripts(
      packagesCount: number,
      scripts: Record<string, string>,
    ): Promise<string[]> {
      const dependencies: Record<string, string> = {};
      const dependenciesList = [];

      for (let i = 0; i < packagesCount; i++) {
        const packageName: string = "stress-test-package-" + i;
        const packageVersion = "1.0." + i;

        dependencies[packageName] = "file:./" + packageName;
        dependenciesList[i] = packageName;

        const packagePath = join(packageDir, packageName);
        await mkdir(packagePath);
        await writeFile(
          join(packagePath, "package.json"),
          JSON.stringify({
            name: packageName,
            version: packageVersion,
            scripts,
          }),
        );
      }

      await writeFile(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "stress-test",
          version: "1.0.0",
          dependencies,
          trustedDependencies: dependenciesList,
        }),
      );

      return dependenciesList;
    }

    test("reach max concurrent scripts", async () => {
      const scripts = {
        "preinstall": `${bunExe()} -e 'Bun.sleepSync(500)'`,
      };

      const dependenciesList = await createPackagesWithScripts(4, scripts);

      var { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install", "--concurrent-scripts=2"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env: testEnv,
      });

      const err = await Bun.readableStreamToText(stderr);
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      const out = await Bun.readableStreamToText(stdout);
      expect(out).not.toContain("Blocked");
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        "",
        ...dependenciesList.map(dep => `+ ${dep}@${dep}`),
        "",
        "4 packages installed",
      ]);
      expect(await exited).toBe(0);
    });

    test("stress test", async () => {
      const dependenciesList = await createPackagesWithScripts(500, {
        "postinstall": `${bunExe()} --version`,
      });

      // the script is quick, default number for max concurrent scripts
      var { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env: testEnv,
      });

      const err = await Bun.readableStreamToText(stderr);
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      const out = await Bun.readableStreamToText(stdout);
      expect(out).not.toContain("Blocked");
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        "",
        ...dependenciesList.map(dep => `+ ${dep}@${dep}`).sort((a, b) => a.localeCompare(b)),
        "",
        "500 packages installed",
      ]);

      expect(await exited).toBe(0);
    });

    test("it should install and use correct binary version", async () => {
      // this should install `what-bin` in two places:
      //
      // - node_modules/.bin/what-bin@1.5.0
      // - node_modules/uses-what-bin/node_modules/.bin/what-bin@1.0.0

      await writeFile(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "1.0.0",
          dependencies: {
            "uses-what-bin": "1.0.0",
            "what-bin": "1.5.0",
          },
        }),
      );

      var { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env: testEnv,
      });

      var err = await new Response(stderr).text();
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      var out = await new Response(stdout).text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        "",
        "+ uses-what-bin@1.0.0",
        "+ what-bin@1.5.0",
        "",
        expect.stringContaining("3 packages installed"),
        "",
        "Blocked 1 postinstall. Run `bun pm untrusted` for details.",
        "",
      ]);
      expect(await exited).toBe(0);
      expect(await file(join(packageDir, "node_modules", "what-bin", "what-bin.js")).text()).toContain(
        "what-bin@1.5.0",
      );
      expect(
        await file(join(packageDir, "node_modules", "uses-what-bin", "node_modules", "what-bin", "what-bin.js")).text(),
      ).toContain("what-bin@1.0.0");

      await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
      await rm(join(packageDir, "bun.lockb"));

      await writeFile(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "1.0.0",
          dependencies: {
            "uses-what-bin": "1.5.0",
            "what-bin": "1.0.0",
          },
          scripts: {
            install: "what-bin",
          },
          trustedDependencies: ["uses-what-bin"],
        }),
      );

      ({ stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env: testEnv,
      }));

      err = await Bun.readableStreamToText(stderr);
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      expect(err).not.toContain("warn:");

      expect(await exited).toBe(0);
      expect(await file(join(packageDir, "node_modules", "what-bin", "what-bin.js")).text()).toContain(
        "what-bin@1.0.0",
      );
      expect(
        await file(join(packageDir, "node_modules", "uses-what-bin", "node_modules", "what-bin", "what-bin.js")).text(),
      ).toContain("what-bin@1.5.0");

      await rm(join(packageDir, "node_modules"), { recursive: true, force: true });

      ({ stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env: testEnv,
      }));

      out = await new Response(stdout).text();
      err = await new Response(stderr).text();
      expect(err).not.toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        "",
        "+ uses-what-bin@1.5.0",
        "+ what-bin@1.0.0",
        "",
        expect.stringContaining("3 packages installed"),
      ]);
      expect(await exited).toBe(0);
    });

    test("node-gyp should always be available for lifecycle scripts", async () => {
      await writeFile(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "1.0.0",
          scripts: {
            install: "node-gyp --version",
          },
        }),
      );

      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env: testEnv,
      });

      const err = await new Response(stderr).text();
      expect(err).not.toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      const out = await new Response(stdout).text();

      // if node-gyp isn't available, it would return a non-zero exit code
      expect(await exited).toBe(0);
    });

    // if this test fails, `electron` might be removed from the default list
    test("default trusted dependencies should work", async () => {
      await writeFile(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "1.2.3",
          dependencies: {
            "electron": "1.0.0",
          },
        }),
      );

      var { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });

      const err = await new Response(stderr).text();
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      const out = await new Response(stdout).text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        "",
        "+ electron@1.0.0",
        "",
        expect.stringContaining("1 package installed"),
      ]);
      expect(out).not.toContain("Blocked");
      expect(await exists(join(packageDir, "node_modules", "electron", "preinstall.txt"))).toBeTrue();
      expect(await exited).toBe(0);
    });

    test("default trusted dependencies should not be used of trustedDependencies is populated", async () => {
      await writeFile(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "1.2.3",
          dependencies: {
            "uses-what-bin": "1.0.0",
            // fake electron package because it's in the default trustedDependencies list
            "electron": "1.0.0",
          },
        }),
      );

      var { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env: testEnv,
      });

      // electron lifecycle scripts should run, uses-what-bin scripts should not run
      var err = await new Response(stderr).text();
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      var out = await new Response(stdout).text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        "",
        "+ electron@1.0.0",
        "+ uses-what-bin@1.0.0",
        "",
        expect.stringContaining("3 packages installed"),
        "",
        "Blocked 1 postinstall. Run `bun pm untrusted` for details.",
        "",
      ]);
      expect(await exited).toBe(0);
      expect(await exists(join(packageDir, "node_modules", "uses-what-bin", "what-bin.txt"))).toBeFalse();
      expect(await exists(join(packageDir, "node_modules", "electron", "preinstall.txt"))).toBeTrue();

      await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
      await rm(join(packageDir, "bun.lockb"));

      await writeFile(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "1.2.3",
          dependencies: {
            "uses-what-bin": "1.0.0",
            "electron": "1.0.0",
          },
          trustedDependencies: ["uses-what-bin"],
        }),
      );

      // now uses-what-bin scripts should run and electron scripts should not run.

      ({ stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env: testEnv,
      }));

      err = await Bun.readableStreamToText(stderr);
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      out = await Bun.readableStreamToText(stdout);
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        "",
        "+ electron@1.0.0",
        "+ uses-what-bin@1.0.0",
        "",
        expect.stringContaining("3 packages installed"),
        "",
        "Blocked 1 postinstall. Run `bun pm untrusted` for details.",
        "",
      ]);
      expect(await exited).toBe(0);

      expect(await exists(join(packageDir, "node_modules", "uses-what-bin", "what-bin.txt"))).toBeTrue();
      expect(await exists(join(packageDir, "node_modules", "electron", "preinstall.txt"))).toBeFalse();
    });

    test("does not run any scripts if trustedDependencies is an empty list", async () => {
      await writeFile(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "1.2.3",
          dependencies: {
            "uses-what-bin": "1.0.0",
            "electron": "1.0.0",
          },
          trustedDependencies: [],
        }),
      );

      var { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env: testEnv,
      });

      const err = await Bun.readableStreamToText(stderr);
      const out = await Bun.readableStreamToText(stdout);
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        "",
        "+ electron@1.0.0",
        "+ uses-what-bin@1.0.0",
        "",
        expect.stringContaining("3 packages installed"),
        "",
        "Blocked 2 postinstalls. Run `bun pm untrusted` for details.",
        "",
      ]);
      expect(await exited).toBe(0);
      expect(await exists(join(packageDir, "node_modules", "uses-what-bin", "what-bin.txt"))).toBeFalse();
      expect(await exists(join(packageDir, "node_modules", "electron", "preinstall.txt"))).toBeFalse();
    });

    test("will run default trustedDependencies after install that didn't include them", async () => {
      await writeFile(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "1.2.3",
          dependencies: {
            electron: "1.0.0",
          },
          trustedDependencies: ["blah"],
        }),
      );

      // first install does not run electron scripts

      var { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env: testEnv,
      });

      var err = await Bun.readableStreamToText(stderr);
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      var out = await Bun.readableStreamToText(stdout);
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        "",
        "+ electron@1.0.0",
        "",
        expect.stringContaining("1 package installed"),
        "",
        "Blocked 1 postinstall. Run `bun pm untrusted` for details.",
        "",
      ]);
      expect(await exited).toBe(0);
      expect(await exists(join(packageDir, "node_modules", "electron", "preinstall.txt"))).toBeFalse();

      await writeFile(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "1.2.3",
          dependencies: {
            electron: "1.0.0",
          },
        }),
      );

      // The electron scripts should run now because it's in default trusted dependencies.

      ({ stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env: testEnv,
      }));

      err = await Bun.readableStreamToText(stderr);
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      out = await Bun.readableStreamToText(stdout);
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        "",
        "Checked 1 install across 2 packages (no changes)",
      ]);
      expect(await exited).toBe(0);
      expect(await exists(join(packageDir, "node_modules", "electron", "preinstall.txt"))).toBeTrue();
    });

    describe("--trust", async () => {
      test("unhoisted untrusted scripts, none at root node_modules", async () => {
        await Promise.all([
          write(
            join(packageDir, "package.json"),
            JSON.stringify({
              name: "foo",
              dependencies: {
                // prevents real `uses-what-bin` from hoisting to root
                "uses-what-bin": "npm:a-dep@1.0.3",
              },
              workspaces: ["pkg1"],
            }),
          ),
          write(
            join(packageDir, "pkg1", "package.json"),
            JSON.stringify({
              name: "pkg1",
              dependencies: {
                "uses-what-bin": "1.0.0",
              },
            }),
          ),
        ]);

        await runBunInstall(testEnv, packageDir);

        const results = await Promise.all([
          exists(join(packageDir, "node_modules", "pkg1", "node_modules", "uses-what-bin")),
          exists(join(packageDir, "node_modules", "pkg1", "node_modules", "uses-what-bin", "what-bin.txt")),
        ]);

        expect(results).toEqual([true, false]);

        const { stderr, exited } = spawn({
          cmd: [bunExe(), "pm", "trust", "--all"],
          cwd: packageDir,
          stdout: "ignore",
          stderr: "pipe",
          env: testEnv,
        });

        const err = await Bun.readableStreamToText(stderr);
        expect(err).not.toContain("error:");

        expect(await exited).toBe(0);

        expect(
          await exists(join(packageDir, "node_modules", "pkg1", "node_modules", "uses-what-bin", "what-bin.txt")),
        ).toBeTrue();
      });
      const trustTests = [
        {
          label: "only name",
          packageJson: {
            name: "foo",
          },
        },
        {
          label: "empty dependencies",
          packageJson: {
            name: "foo",
            dependencies: {},
          },
        },
        {
          label: "populated dependencies",
          packageJson: {
            name: "foo",
            dependencies: {
              "uses-what-bin": "1.0.0",
            },
          },
        },

        {
          label: "empty trustedDependencies",
          packageJson: {
            name: "foo",
            trustedDependencies: [],
          },
        },

        {
          label: "populated dependencies, empty trustedDependencies",
          packageJson: {
            name: "foo",
            dependencies: {
              "uses-what-bin": "1.0.0",
            },
            trustedDependencies: [],
          },
        },

        {
          label: "populated dependencies and trustedDependencies",
          packageJson: {
            name: "foo",
            dependencies: {
              "uses-what-bin": "1.0.0",
            },
            trustedDependencies: ["uses-what-bin"],
          },
        },

        {
          label: "empty dependencies and trustedDependencies",
          packageJson: {
            name: "foo",
            dependencies: {},
            trustedDependencies: [],
          },
        },
      ];
      for (const { label, packageJson } of trustTests) {
        test(label, async () => {
          await writeFile(join(packageDir, "package.json"), JSON.stringify(packageJson));

          let { stdout, stderr, exited } = spawn({
            cmd: [bunExe(), "i", "--trust", "uses-what-bin@1.0.0"],
            cwd: packageDir,
            stdout: "pipe",
            stderr: "pipe",
            stdin: "pipe",
            env: testEnv,
          });

          let err = await Bun.readableStreamToText(stderr);
          expect(err).toContain("Saved lockfile");
          expect(err).not.toContain("not found");
          expect(err).not.toContain("error:");
          expect(err).not.toContain("warn:");
          let out = await Bun.readableStreamToText(stdout);
          expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
            "",
            "installed uses-what-bin@1.0.0",
            "",
            "2 packages installed",
          ]);
          expect(await exited).toBe(0);
          expect(await exists(join(packageDir, "node_modules", "uses-what-bin", "what-bin.txt"))).toBeTrue();
          expect(await file(join(packageDir, "package.json")).json()).toEqual({
            name: "foo",
            dependencies: {
              "uses-what-bin": "1.0.0",
            },
            trustedDependencies: ["uses-what-bin"],
          });

          // another install should not error with json SyntaxError
          ({ stdout, stderr, exited } = spawn({
            cmd: [bunExe(), "i"],
            cwd: packageDir,
            stdout: "pipe",
            stderr: "pipe",
            stdin: "pipe",
            env: testEnv,
          }));

          err = await Bun.readableStreamToText(stderr);
          expect(err).not.toContain("Saved lockfile");
          expect(err).not.toContain("not found");
          expect(err).not.toContain("error:");
          expect(err).not.toContain("warn:");
          out = await Bun.readableStreamToText(stdout);
          expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
            "",
            "Checked 2 installs across 3 packages (no changes)",
          ]);
          expect(await exited).toBe(0);
        });
      }
      describe("packages without lifecycle scripts", async () => {
        test("initial install", async () => {
          await writeFile(
            join(packageDir, "package.json"),
            JSON.stringify({
              name: "foo",
            }),
          );

          const { stdout, stderr, exited } = spawn({
            cmd: [bunExe(), "i", "--trust", "no-deps@1.0.0"],
            cwd: packageDir,
            stdout: "pipe",
            stderr: "pipe",
            stdin: "pipe",
            env: testEnv,
          });

          const err = await Bun.readableStreamToText(stderr);
          expect(err).toContain("Saved lockfile");
          expect(err).not.toContain("not found");
          expect(err).not.toContain("error:");
          expect(err).not.toContain("warn:");
          const out = await Bun.readableStreamToText(stdout);
          expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
            "",
            "installed no-deps@1.0.0",
            "",
            expect.stringContaining("1 package installed"),
          ]);
          expect(await exited).toBe(0);
          expect(await exists(join(packageDir, "node_modules", "no-deps"))).toBeTrue();
          expect(await file(join(packageDir, "package.json")).json()).toEqual({
            name: "foo",
            dependencies: {
              "no-deps": "1.0.0",
            },
          });
        });
        test("already installed", async () => {
          await writeFile(
            join(packageDir, "package.json"),
            JSON.stringify({
              name: "foo",
            }),
          );
          let { stdout, stderr, exited } = spawn({
            cmd: [bunExe(), "i", "no-deps"],
            cwd: packageDir,
            stdout: "pipe",
            stderr: "pipe",
            stdin: "pipe",
            env: testEnv,
          });

          let err = await Bun.readableStreamToText(stderr);
          expect(err).toContain("Saved lockfile");
          expect(err).not.toContain("not found");
          expect(err).not.toContain("error:");
          expect(err).not.toContain("warn:");
          let out = await Bun.readableStreamToText(stdout);
          expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
            "",
            "installed no-deps@2.0.0",
            "",
            expect.stringContaining("1 package installed"),
          ]);
          expect(await exited).toBe(0);
          expect(await exists(join(packageDir, "node_modules", "no-deps"))).toBeTrue();
          expect(await file(join(packageDir, "package.json")).json()).toEqual({
            name: "foo",
            dependencies: {
              "no-deps": "^2.0.0",
            },
          });

          // oops, I wanted to run the lifecycle scripts for no-deps, I'll install
          // again with --trust.

          ({ stdout, stderr, exited } = spawn({
            cmd: [bunExe(), "i", "--trust", "no-deps"],
            cwd: packageDir,
            stdout: "pipe",
            stderr: "pipe",
            stdin: "pipe",
            env: testEnv,
          }));

          // oh, I didn't realize no-deps doesn't have
          // any lifecycle scripts. It shouldn't automatically add to
          // trustedDependencies.

          err = await Bun.readableStreamToText(stderr);
          expect(err).toContain("Saved lockfile");
          expect(err).not.toContain("not found");
          expect(err).not.toContain("error:");
          out = await Bun.readableStreamToText(stdout);
          expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
            "",
            "installed no-deps@2.0.0",
            "",
            expect.stringContaining("done"),
            "",
          ]);
          expect(await exited).toBe(0);
          expect(await exists(join(packageDir, "node_modules", "no-deps"))).toBeTrue();
          expect(await file(join(packageDir, "package.json")).json()).toEqual({
            name: "foo",
            dependencies: {
              "no-deps": "^2.0.0",
            },
          });
        });
      });
    });

    describe("updating trustedDependencies", async () => {
      test("existing trustedDependencies, unchanged trustedDependencies", async () => {
        await writeFile(
          join(packageDir, "package.json"),
          JSON.stringify({
            name: "foo",
            trustedDependencies: ["uses-what-bin"],
            dependencies: {
              "uses-what-bin": "1.0.0",
            },
          }),
        );

        let { stdout, stderr, exited } = spawn({
          cmd: [bunExe(), "i"],
          cwd: packageDir,
          stdout: "pipe",
          stderr: "pipe",
          stdin: "pipe",
          env: testEnv,
        });

        let err = await Bun.readableStreamToText(stderr);
        expect(err).toContain("Saved lockfile");
        expect(err).not.toContain("not found");
        expect(err).not.toContain("error:");
        expect(err).not.toContain("warn:");
        let out = await Bun.readableStreamToText(stdout);
        expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
          "",
          "+ uses-what-bin@1.0.0",
          "",
          expect.stringContaining("2 packages installed"),
        ]);
        expect(await exited).toBe(0);
        expect(await exists(join(packageDir, "node_modules", "uses-what-bin", "what-bin.txt"))).toBeTrue();
        expect(await file(join(packageDir, "package.json")).json()).toEqual({
          name: "foo",
          dependencies: {
            "uses-what-bin": "1.0.0",
          },
          trustedDependencies: ["uses-what-bin"],
        });

        // no changes, lockfile shouldn't be saved
        ({ stdout, stderr, exited } = spawn({
          cmd: [bunExe(), "i"],
          cwd: packageDir,
          stdout: "pipe",
          stderr: "pipe",
          stdin: "pipe",
          env: testEnv,
        }));

        err = await Bun.readableStreamToText(stderr);
        expect(err).not.toContain("Saved lockfile");
        expect(err).not.toContain("not found");
        expect(err).not.toContain("error:");
        expect(err).not.toContain("warn:");
        out = await Bun.readableStreamToText(stdout);
        expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
          "",
          "Checked 2 installs across 3 packages (no changes)",
        ]);
        expect(await exited).toBe(0);
      });

      test("existing trustedDependencies, removing trustedDependencies", async () => {
        await writeFile(
          join(packageDir, "package.json"),
          JSON.stringify({
            name: "foo",
            trustedDependencies: ["uses-what-bin"],
            dependencies: {
              "uses-what-bin": "1.0.0",
            },
          }),
        );

        let { stdout, stderr, exited } = spawn({
          cmd: [bunExe(), "i"],
          cwd: packageDir,
          stdout: "pipe",
          stderr: "pipe",
          stdin: "pipe",
          env: testEnv,
        });

        let err = await Bun.readableStreamToText(stderr);
        expect(err).toContain("Saved lockfile");
        expect(err).not.toContain("not found");
        expect(err).not.toContain("error:");
        expect(err).not.toContain("warn:");
        let out = await Bun.readableStreamToText(stdout);
        expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
          "",
          "+ uses-what-bin@1.0.0",
          "",
          expect.stringContaining("2 packages installed"),
        ]);
        expect(await exited).toBe(0);
        expect(await exists(join(packageDir, "node_modules", "uses-what-bin", "what-bin.txt"))).toBeTrue();
        expect(await file(join(packageDir, "package.json")).json()).toEqual({
          name: "foo",
          dependencies: {
            "uses-what-bin": "1.0.0",
          },
          trustedDependencies: ["uses-what-bin"],
        });

        await writeFile(
          join(packageDir, "package.json"),
          JSON.stringify({
            name: "foo",
            dependencies: {
              "uses-what-bin": "1.0.0",
            },
          }),
        );

        // this script should not run because uses-what-bin is no longer in trustedDependencies
        await rm(join(packageDir, "node_modules", "uses-what-bin", "what-bin.txt"), { force: true });

        ({ stdout, stderr, exited } = spawn({
          cmd: [bunExe(), "i"],
          cwd: packageDir,
          stdout: "pipe",
          stderr: "pipe",
          stdin: "pipe",
          env: testEnv,
        }));

        err = await Bun.readableStreamToText(stderr);
        expect(err).toContain("Saved lockfile");
        expect(err).not.toContain("not found");
        expect(err).not.toContain("error:");
        expect(err).not.toContain("warn:");
        out = await Bun.readableStreamToText(stdout);
        expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
          "",
          "Checked 2 installs across 3 packages (no changes)",
        ]);
        expect(await exited).toBe(0);
        expect(await file(join(packageDir, "package.json")).json()).toEqual({
          name: "foo",
          dependencies: {
            "uses-what-bin": "1.0.0",
          },
        });
        expect(await exists(join(packageDir, "node_modules", "uses-what-bin", "what-bin.txt"))).toBeFalse();
      });

      test("non-existent trustedDependencies, then adding it", async () => {
        await writeFile(
          join(packageDir, "package.json"),
          JSON.stringify({
            name: "foo",
            dependencies: {
              "electron": "1.0.0",
            },
          }),
        );

        let { stdout, stderr, exited } = spawn({
          cmd: [bunExe(), "i"],
          cwd: packageDir,
          stdout: "pipe",
          stderr: "pipe",
          stdin: "pipe",
          env: testEnv,
        });

        let err = await Bun.readableStreamToText(stderr);
        expect(err).toContain("Saved lockfile");
        expect(err).not.toContain("not found");
        expect(err).not.toContain("error:");
        expect(err).not.toContain("warn:");
        let out = await Bun.readableStreamToText(stdout);
        expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
          "",
          "+ electron@1.0.0",
          "",
          expect.stringContaining("1 package installed"),
        ]);
        expect(await exited).toBe(0);
        expect(await exists(join(packageDir, "node_modules", "electron", "preinstall.txt"))).toBeTrue();
        expect(await file(join(packageDir, "package.json")).json()).toEqual({
          name: "foo",
          dependencies: {
            "electron": "1.0.0",
          },
        });

        await writeFile(
          join(packageDir, "package.json"),
          JSON.stringify({
            name: "foo",
            trustedDependencies: ["electron"],
            dependencies: {
              "electron": "1.0.0",
            },
          }),
        );

        await rm(join(packageDir, "node_modules", "electron", "preinstall.txt"), { force: true });

        // lockfile should save evenn though there are no changes to trustedDependencies due to
        // the default list

        ({ stdout, stderr, exited } = spawn({
          cmd: [bunExe(), "i"],
          cwd: packageDir,
          stdout: "pipe",
          stderr: "pipe",
          stdin: "pipe",
          env: testEnv,
        }));

        err = await Bun.readableStreamToText(stderr);
        expect(err).toContain("Saved lockfile");
        expect(err).not.toContain("not found");
        expect(err).not.toContain("error:");
        expect(err).not.toContain("warn:");
        out = await Bun.readableStreamToText(stdout);
        expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
          "",
          "Checked 1 install across 2 packages (no changes)",
        ]);
        expect(await exited).toBe(0);
        expect(await exists(join(packageDir, "node_modules", "electron", "preinstall.txt"))).toBeTrue();
      });
    });

    test("node -p should work in postinstall scripts", async () => {
      await writeFile(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "1.0.0",
          scripts: {
            postinstall: `node -p "require('fs').writeFileSync('postinstall.txt', 'postinstall')"`,
          },
        }),
      );

      const originalPath = env.PATH;
      env.PATH = "";

      let { stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env: testEnv,
      });

      env.PATH = originalPath;

      let err = await Bun.readableStreamToText(stderr);
      expect(err).toContain("No packages! Deleted empty lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      expect(err).not.toContain("warn:");
      expect(await exited).toBe(0);

      expect(await exists(join(packageDir, "postinstall.txt"))).toBeTrue();
    });

    test("ensureTempNodeGypScript works", async () => {
      await writeFile(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "1.0.0",
          scripts: {
            preinstall: "node-gyp --version",
          },
        }),
      );

      const originalPath = env.PATH;
      env.PATH = "";

      let { stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stderr: "pipe",
        stdin: "ignore",
        env,
      });

      env.PATH = originalPath;

      let err = await Bun.readableStreamToText(stderr);
      expect(err).toContain("No packages! Deleted empty lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      expect(err).not.toContain("warn:");
      expect(await exited).toBe(0);
    });

    test("bun pm trust and untrusted on missing package", async () => {
      await writeFile(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "foo",
          dependencies: {
            "uses-what-bin": "1.5.0",
          },
        }),
      );

      let { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "i"],
        cwd: packageDir,
        stdout: "pipe",
        stderr: "pipe",
        env: testEnv,
      });

      let err = await Bun.readableStreamToText(stderr);
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("error:");
      expect(err).not.toContain("warn:");
      let out = await Bun.readableStreamToText(stdout);
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        "",
        "+ uses-what-bin@1.5.0",
        "",
        expect.stringContaining("2 packages installed"),
        "",
        "Blocked 1 postinstall. Run `bun pm untrusted` for details.",
        "",
      ]);
      expect(await exists(join(packageDir, "node_modules", "uses-what-bin", "what-bin.txt"))).toBeFalse();
      expect(await exited).toBe(0);

      // remove uses-what-bin from node_modules, bun pm trust and untrusted should handle missing package
      await rm(join(packageDir, "node_modules", "uses-what-bin"), { recursive: true, force: true });

      ({ stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "pm", "untrusted"],
        cwd: packageDir,
        stdout: "pipe",
        stderr: "pipe",
        env: testEnv,
      }));

      err = await Bun.readableStreamToText(stderr);
      expect(err).toContain("bun pm untrusted");
      expect(err).not.toContain("error:");
      expect(err).not.toContain("warn:");
      out = await Bun.readableStreamToText(stdout);
      expect(out).toContain("Found 0 untrusted dependencies with scripts");
      expect(await exited).toBe(0);

      ({ stderr, exited } = spawn({
        cmd: [bunExe(), "pm", "trust", "uses-what-bin"],
        cwd: packageDir,
        stdout: "pipe",
        stderr: "pipe",
        env: testEnv,
      }));

      expect(await exited).toBe(1);

      err = await Bun.readableStreamToText(stderr);
      expect(err).toContain("bun pm trust");
      expect(err).toContain("0 scripts ran");
      expect(err).toContain("uses-what-bin");
    });

    describe("add trusted, delete, then add again", async () => {
      // when we change bun install to delete dependencies from node_modules
      // for both cases, we need to update this test
      for (const withRm of [true, false]) {
        test(withRm ? "withRm" : "withoutRm", async () => {
          await writeFile(
            join(packageDir, "package.json"),
            JSON.stringify({
              name: "foo",
              dependencies: {
                "no-deps": "1.0.0",
                "uses-what-bin": "1.0.0",
              },
            }),
          );

          let { stdout, stderr, exited } = spawn({
            cmd: [bunExe(), "install"],
            cwd: packageDir,
            stdout: "pipe",
            stderr: "pipe",
            env: testEnv,
          });

          let err = await Bun.readableStreamToText(stderr);
          expect(err).toContain("Saved lockfile");
          expect(err).not.toContain("not found");
          expect(err).not.toContain("error:");
          expect(err).not.toContain("warn:");
          let out = await Bun.readableStreamToText(stdout);
          expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
            "",
            "+ no-deps@1.0.0",
            "+ uses-what-bin@1.0.0",
            "",
            expect.stringContaining("3 packages installed"),
            "",
            "Blocked 1 postinstall. Run `bun pm untrusted` for details.",
            "",
          ]);
          expect(await exited).toBe(0);
          expect(await exists(join(packageDir, "node_modules", "uses-what-bin", "what-bin.txt"))).toBeFalse();

          ({ stdout, stderr, exited } = spawn({
            cmd: [bunExe(), "pm", "trust", "uses-what-bin"],
            cwd: packageDir,
            stdout: "pipe",
            stderr: "pipe",
            env: testEnv,
          }));

          err = await Bun.readableStreamToText(stderr);
          expect(err).not.toContain("error:");
          expect(err).not.toContain("warn:");
          out = await Bun.readableStreamToText(stdout);
          expect(out).toContain("1 script ran across 1 package");
          expect(await exited).toBe(0);

          expect(await exists(join(packageDir, "node_modules", "uses-what-bin", "what-bin.txt"))).toBeTrue();
          expect(await file(join(packageDir, "package.json")).json()).toEqual({
            name: "foo",
            dependencies: {
              "no-deps": "1.0.0",
              "uses-what-bin": "1.0.0",
            },
            trustedDependencies: ["uses-what-bin"],
          });

          // now remove and install again
          if (withRm) {
            ({ stdout, stderr, exited } = spawn({
              cmd: [bunExe(), "rm", "uses-what-bin"],
              cwd: packageDir,
              stdout: "pipe",
              stderr: "pipe",
              env: testEnv,
            }));

            err = await Bun.readableStreamToText(stderr);
            expect(err).toContain("Saved lockfile");
            expect(err).not.toContain("not found");
            expect(err).not.toContain("error:");
            expect(err).not.toContain("warn:");
            out = await Bun.readableStreamToText(stdout);
            expect(out).toContain("1 package removed");
            expect(out).toContain("uses-what-bin");
            expect(await exited).toBe(0);
          }
          await writeFile(
            join(packageDir, "package.json"),
            JSON.stringify({
              name: "foo",
              dependencies: {
                "no-deps": "1.0.0",
              },
            }),
          );

          ({ stdout, stderr, exited } = spawn({
            cmd: [bunExe(), "install"],
            cwd: packageDir,
            stdout: "pipe",
            stderr: "pipe",
            env: testEnv,
          }));

          err = await Bun.readableStreamToText(stderr);
          expect(err).toContain("Saved lockfile");
          expect(err).not.toContain("not found");
          expect(err).not.toContain("error:");
          expect(err).not.toContain("warn:");
          out = await Bun.readableStreamToText(stdout);
          let expected = withRm
            ? ["", "Checked 1 install across 2 packages (no changes)"]
            : ["", expect.stringContaining("1 package removed")];
          expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual(expected);
          expect(await exited).toBe(0);
          expect(await exists(join(packageDir, "node_modules", "uses-what-bin"))).toBe(!withRm);

          // add again, bun pm untrusted should report it as untrusted

          await writeFile(
            join(packageDir, "package.json"),
            JSON.stringify({
              name: "foo",
              dependencies: {
                "no-deps": "1.0.0",
                "uses-what-bin": "1.0.0",
              },
            }),
          );

          ({ stdout, stderr, exited } = spawn({
            cmd: [bunExe(), "i"],
            cwd: packageDir,
            stdout: "pipe",
            stderr: "pipe",
            env: testEnv,
          }));

          err = await Bun.readableStreamToText(stderr);
          expect(err).toContain("Saved lockfile");
          expect(err).not.toContain("not found");
          expect(err).not.toContain("error:");
          expect(err).not.toContain("warn:");
          out = await Bun.readableStreamToText(stdout);
          expected = withRm
            ? [
                "",
                "+ uses-what-bin@1.0.0",
                "",
                expect.stringContaining("1 package installed"),
                "",
                "Blocked 1 postinstall. Run `bun pm untrusted` for details.",
                "",
              ]
            : ["", expect.stringContaining("Checked 3 installs across 4 packages (no changes)")];
          expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual(expected);

          ({ stdout, stderr, exited } = spawn({
            cmd: [bunExe(), "pm", "untrusted"],
            cwd: packageDir,
            stdout: "pipe",
            stderr: "pipe",
            env: testEnv,
          }));

          err = await Bun.readableStreamToText(stderr);
          expect(err).not.toContain("error:");
          expect(err).not.toContain("warn:");
          out = await Bun.readableStreamToText(stdout);
          expect(out).toContain("./node_modules/uses-what-bin @1.0.0".replaceAll("/", sep));
          expect(await exited).toBe(0);
        });
      }
    });

    describe.if(!forceWaiterThread || process.platform === "linux")("does not use 100% cpu", async () => {
      test("install", async () => {
        await writeFile(
          join(packageDir, "package.json"),
          JSON.stringify({
            name: "foo",
            version: "1.0.0",
            scripts: {
              preinstall: `${bunExe()} -e 'Bun.sleepSync(1000)'`,
            },
          }),
        );

        const proc = spawn({
          cmd: [bunExe(), "install"],
          cwd: packageDir,
          stdout: "ignore",
          stderr: "ignore",
          stdin: "ignore",
          env: testEnv,
        });

        expect(await proc.exited).toBe(0);

        expect(proc.resourceUsage()?.cpuTime.total).toBeLessThan(750_000);
      });

      // https://github.com/oven-sh/bun/issues/11252
      test.todoIf(isWindows)("bun pm trust", async () => {
        const dep = isWindows ? "uses-what-bin-slow-window" : "uses-what-bin-slow";
        await writeFile(
          join(packageDir, "package.json"),
          JSON.stringify({
            name: "foo",
            version: "1.0.0",
            dependencies: {
              [dep]: "1.0.0",
            },
          }),
        );

        var { exited } = spawn({
          cmd: [bunExe(), "install"],
          cwd: packageDir,
          stdout: "ignore",
          stderr: "ignore",
          env: testEnv,
        });

        expect(await exited).toBe(0);

        expect(await exists(join(packageDir, "node_modules", dep, "what-bin.txt"))).toBeFalse();

        const proc = spawn({
          cmd: [bunExe(), "pm", "trust", "--all"],
          cwd: packageDir,
          stdout: "ignore",
          stderr: "ignore",
          env: testEnv,
        });

        expect(await proc.exited).toBe(0);

        expect(await exists(join(packageDir, "node_modules", dep, "what-bin.txt"))).toBeTrue();

        expect(proc.resourceUsage()?.cpuTime.total).toBeLessThan(750_000 * (isWindows ? 5 : 1));
      });
    });
  });

  describe("stdout/stderr is inherited from root scripts during install", async () => {
    test("without packages", async () => {
      const exe = bunExe().replace(/\\/g, "\\\\");
      await writeFile(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "1.2.3",
          scripts: {
            "preinstall": `${exe} -e 'process.stderr.write("preinstall stderr 🍦\\n")'`,
            "install": `${exe} -e 'process.stdout.write("install stdout 🚀\\n")'`,
            "prepare": `${exe} -e 'Bun.sleepSync(200); process.stdout.write("prepare stdout done ✅\\n")'`,
          },
        }),
      );

      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stderr: "pipe",
        env: testEnv,
      });

      const err = await Bun.readableStreamToText(stderr);
      expect(err).not.toContain("error:");
      expect(err).not.toContain("warn:");
      expect(err.split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install"),
        "No packages! Deleted empty lockfile",
        "",
        `$ ${exe} -e 'process.stderr.write("preinstall stderr 🍦\\n")'`,
        "preinstall stderr 🍦",
        `$ ${exe} -e 'process.stdout.write("install stdout 🚀\\n")'`,
        `$ ${exe} -e 'Bun.sleepSync(200); process.stdout.write("prepare stdout done ✅\\n")'`,
        "",
      ]);
      const out = await Bun.readableStreamToText(stdout);
      expect(out.split(/\r?\n/)).toEqual([
        "install stdout 🚀",
        "prepare stdout done ✅",
        "",
        expect.stringContaining("done"),
        "",
      ]);
      expect(await exited).toBe(0);
    });

    test("with a package", async () => {
      const exe = bunExe().replace(/\\/g, "\\\\");
      await writeFile(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "1.2.3",
          scripts: {
            "preinstall": `${exe} -e 'process.stderr.write("preinstall stderr 🍦\\n")'`,
            "install": `${exe} -e 'process.stdout.write("install stdout 🚀\\n")'`,
            "prepare": `${exe} -e 'Bun.sleepSync(200); process.stdout.write("prepare stdout done ✅\\n")'`,
          },
          dependencies: {
            "no-deps": "1.0.0",
          },
        }),
      );

      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stderr: "pipe",
        env: testEnv,
      });

      const err = await Bun.readableStreamToText(stderr);
      expect(err).not.toContain("error:");
      expect(err).not.toContain("warn:");
      expect(err.split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install"),
        "Resolving dependencies",
        expect.stringContaining("Resolved, downloaded and extracted "),
        "Saved lockfile",
        "",
        `$ ${exe} -e 'process.stderr.write("preinstall stderr 🍦\\n")'`,
        "preinstall stderr 🍦",
        `$ ${exe} -e 'process.stdout.write("install stdout 🚀\\n")'`,
        `$ ${exe} -e 'Bun.sleepSync(200); process.stdout.write("prepare stdout done ✅\\n")'`,
        "",
      ]);
      const out = await Bun.readableStreamToText(stdout);
      expect(out.split(/\r?\n/)).toEqual([
        "install stdout 🚀",
        "prepare stdout done ✅",
        "",
        "+ no-deps@1.0.0",
        "",
        expect.stringContaining("1 package installed"),
        "",
      ]);
      expect(await exited).toBe(0);
    });
  });
}

describe("pm trust", async () => {
  test("--default", async () => {
    await writeFile(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "foo",
      }),
    );

    let { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "pm", "default-trusted"],
      cwd: packageDir,
      stdout: "pipe",
      stderr: "pipe",
      env,
    });

    let err = await Bun.readableStreamToText(stderr);
    expect(err).not.toContain("Saved lockfile");
    expect(err).not.toContain("not found");
    expect(err).not.toContain("error:");
    expect(err).not.toContain("warn:");
    let out = await Bun.readableStreamToText(stdout);
    expect(out).toContain("Default trusted dependencies");
    expect(await exited).toBe(0);
  });

  describe("--all", async () => {
    test("no dependencies", async () => {
      await writeFile(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "foo",
        }),
      );

      let { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "pm", "trust", "--all"],
        cwd: packageDir,
        stdout: "pipe",
        stderr: "pipe",
        env,
      });

      let err = await Bun.readableStreamToText(stderr);
      expect(err).toContain("error: Lockfile not found");
      let out = await Bun.readableStreamToText(stdout);
      expect(out).toBeEmpty();
      expect(await exited).toBe(1);
    });

    test("some dependencies, non with scripts", async () => {
      await writeFile(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "foo",
          dependencies: {
            "uses-what-bin": "1.0.0",
          },
        }),
      );

      let { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "i"],
        cwd: packageDir,
        stdout: "pipe",
        stderr: "pipe",
        env,
      });

      let err = await Bun.readableStreamToText(stderr);
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      expect(err).not.toContain("warn:");
      let out = await Bun.readableStreamToText(stdout);
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        "",
        "+ uses-what-bin@1.0.0",
        "",
        expect.stringContaining("2 packages installed"),
        "",
        "Blocked 1 postinstall. Run `bun pm untrusted` for details.",
        "",
      ]);
      expect(await exited).toBe(0);

      expect(await exists(join(packageDir, "node_modules", "uses-what-bin", "what-bin.txt"))).toBeFalse();

      ({ stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "pm", "trust", "uses-what-bin"],
        cwd: packageDir,
        stdout: "pipe",
        stderr: "pipe",
        env,
      }));

      err = await Bun.readableStreamToText(stderr);
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      expect(err).not.toContain("warn:");

      out = await Bun.readableStreamToText(stdout);
      expect(out).toContain("1 script ran across 1 package");
      expect(await exited).toBe(0);

      expect(await exists(join(packageDir, "node_modules", "uses-what-bin", "what-bin.txt"))).toBeTrue();
    });
  });
});

test("it should be able to find binary in node_modules/.bin from parent directory of root package", async () => {
  await mkdir(join(packageDir, "node_modules", ".bin"), { recursive: true });
  await mkdir(join(packageDir, "morePackageDir"));
  await writeFile(
    join(packageDir, "morePackageDir", "package.json"),
    JSON.stringify({
      name: "foo",
      version: "1.0.0",
      scripts: {
        install: "missing-bin",
      },
      dependencies: {
        "what-bin": "1.0.0",
      },
    }),
  );

  await cp(join(packageDir, "bunfig.toml"), join(packageDir, "morePackageDir", "bunfig.toml"));

  await writeShebangScript(
    join(packageDir, "node_modules", ".bin", "missing-bin"),
    "node",
    `require("fs").writeFileSync("missing-bin.txt", "missing-bin@WHAT");`,
  );

  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: join(packageDir, "morePackageDir"),
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  });

  const err = await new Response(stderr).text();
  expect(err).toContain("Saved lockfile");
  expect(err).not.toContain("not found");
  expect(err).not.toContain("error:");
  const out = await new Response(stdout).text();
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    "",
    "+ what-bin@1.0.0",
    "",
    expect.stringContaining("1 package installed"),
  ]);
  expect(await exited).toBe(0);
  expect(await file(join(packageDir, "morePackageDir", "missing-bin.txt")).text()).toBe("missing-bin@WHAT");
});

describe("semver", () => {
  const taggedVersionTests = [
    {
      title: "tagged version last in range",
      depVersion: "1 || 2 || pre-3",
      expected: "2.0.1",
    },
    {
      title: "tagged version in middle of range",
      depVersion: "1 || pre-3 || 2",
      expected: "2.0.1",
    },
    {
      title: "tagged version first in range",
      depVersion: "pre-3 || 2 || 1",
      expected: "2.0.1",
    },
    {
      title: "multiple tagged versions in range",
      depVersion: "pre-3 || 2 || pre-1 || 1 || 3 || pre-3",
      expected: "3.0.0",
    },
    {
      title: "start with ||",
      depVersion: "|| 1",
      expected: "1.0.1",
    },
    {
      title: "start with || no space",
      depVersion: "||2",
      expected: "2.0.1",
    },
    {
      title: "|| with no space on both sides",
      depVersion: "1||2",
      expected: "2.0.1",
    },
    {
      title: "no version is latest",
      depVersion: "",
      expected: "3.0.0",
    },
    {
      title: "tagged version works",
      depVersion: "pre-2",
      expected: "2.0.1",
    },
    {
      title: "tagged above latest",
      depVersion: "pre-3",
      expected: "3.0.1",
    },
    {
      title: "'||'",
      depVersion: "||",
      expected: "3.0.0",
    },
    {
      title: "'|'",
      depVersion: "|",
      expected: "3.0.0",
    },
    {
      title: "'|||'",
      depVersion: "|||",
      expected: "3.0.0",
    },
    {
      title: "'|| ||'",
      depVersion: "|| ||",
      expected: "3.0.0",
    },
    {
      title: "'|| 1 ||'",
      depVersion: "|| 1 ||",
      expected: "1.0.1",
    },
    {
      title: "'| | |'",
      depVersion: "| | |",
      expected: "3.0.0",
    },
    {
      title: "'|||||||||||||||||||||||||'",
      depVersion: "|||||||||||||||||||||||||",
      expected: "3.0.0",
    },
    {
      title: "'2 ||| 1'",
      depVersion: "2 ||| 1",
      expected: "2.0.1",
    },
    {
      title: "'2 |||| 1'",
      depVersion: "2 |||| 1",
      expected: "2.0.1",
    },
  ];

  for (const { title, depVersion, expected } of taggedVersionTests) {
    test(title, async () => {
      await writeFile(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "1.0.0",
          dependencies: {
            "dep-with-tags": depVersion,
          },
        }),
      );

      var { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });

      var err = await new Response(stderr).text();
      var out = await new Response(stdout).text();
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        "",
        `+ dep-with-tags@${expected}`,
        "",
        "1 package installed",
      ]);
      expect(await exited).toBe(0);
    });
  }

  test.todo("only tagged versions in range errors", async () => {
    await writeFile(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "foo",
        version: "1.0.0",
        dependencies: {
          "dep-with-tags": "pre-1 || pre-2",
        },
      }),
    );

    var { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    });

    var err = await new Response(stderr).text();
    var out = await new Response(stdout).text();
    expect(err).toContain('InvalidDependencyVersion parsing version "pre-1 || pre-2"');
    expect(await exited).toBe(1);
    expect(out).toBeEmpty();
  });
});

test("doesn't error when the migration is out of sync", async () => {
  const cwd = tempDirWithFiles("out-of-sync-1", {
    "package.json": JSON.stringify({
      "devDependencies": {
        "no-deps": "1.0.0",
      },
    }),
    "package-lock.json": JSON.stringify({
      "name": "reproo",
      "lockfileVersion": 3,
      "requires": true,
      "packages": {
        "": {
          "name": "reproo",
          "dependencies": {
            "no-deps": "2.0.0",
          },
          "devDependencies": {
            "no-deps": "1.0.0",
          },
        },
        "node_modules/no-deps": {
          "version": "1.0.0",
          "resolved": `http://localhost:${port}/no-deps/-/no-deps-1.0.0.tgz`,
          "integrity":
            "sha512-v4w12JRjUGvfHDUP8vFDwu0gUWu04j0cv9hLb1Abf9VdaXu4XcrddYFTMVBVvmldKViGWH7jrb6xPJRF0wq6gw==",
          "dev": true,
        },
      },
    }),
  });

  const subprocess = Bun.spawn([bunExe(), "install"], {
    env,
    cwd,
    stdio: ["ignore", "ignore", "inherit"],
  });

  await subprocess.exited;

  expect(subprocess.exitCode).toBe(0);

  let { stdout, exitCode } = Bun.spawnSync({
    cmd: [bunExe(), "pm", "ls"],
    env,
    cwd,
    stdio: ["ignore", "pipe", "inherit"],
  });
  let out = stdout.toString().trim();
  expect(out).toContain("no-deps@1.0.0");
  // only one no-deps is installed
  expect(out.lastIndexOf("no-deps")).toEqual(out.indexOf("no-deps"));
  expect(exitCode).toBe(0);

  expect(await file(join(cwd, "node_modules/no-deps/package.json")).json()).toMatchObject({
    version: "1.0.0",
    name: "no-deps",
  });
});

const prereleaseTests = [
  [
    { title: "specific", depVersion: "1.0.0-future.1", expected: "1.0.0-future.1" },
    { title: "latest", depVersion: "latest", expected: "1.0.0-future.4" },
    { title: "range starting with latest", depVersion: "^1.0.0-future.4", expected: "1.0.0-future.4" },
    { title: "range above latest", depVersion: "^1.0.0-future.5", expected: "1.0.0-future.7" },
  ],
  [
    { title: "#6683", depVersion: "^1.0.0-next.23", expected: "1.0.0-next.23" },
    {
      title: "greater than or equal to",
      depVersion: ">=1.0.0-next.23",
      expected: "1.0.0-next.23",
    },
    { title: "latest", depVersion: "latest", expected: "0.5.0" },
    { title: "greater than or equal to latest", depVersion: ">=0.5.0", expected: "0.5.0" },
  ],

  // package "prereleases-3" has four versions, all with prerelease tags:
  // - 5.0.0-alpha.150
  // - 5.0.0-alpha.151
  // - 5.0.0-alpha.152
  // - 5.0.0-alpha.153
  [
    { title: "#6956", depVersion: "^5.0.0-alpha.153", expected: "5.0.0-alpha.153" },
    { title: "range matches highest possible", depVersion: "^5.0.0-alpha.152", expected: "5.0.0-alpha.153" },
    { title: "exact", depVersion: "5.0.0-alpha.152", expected: "5.0.0-alpha.152" },
    { title: "exact latest", depVersion: "5.0.0-alpha.153", expected: "5.0.0-alpha.153" },
    { title: "latest", depVersion: "latest", expected: "5.0.0-alpha.153" },
    { title: "~ lower than latest", depVersion: "~5.0.0-alpha.151", expected: "5.0.0-alpha.153" },
    {
      title: "~ equal semver and lower non-existant prerelease",
      depVersion: "~5.0.0-alpha.100",
      expected: "5.0.0-alpha.153",
    },
    {
      title: "^ equal semver and lower non-existant prerelease",
      depVersion: "^5.0.0-alpha.100",
      expected: "5.0.0-alpha.153",
    },
    {
      title: "~ and ^ latest prerelease",
      depVersion: "~5.0.0-alpha.153 || ^5.0.0-alpha.153",
      expected: "5.0.0-alpha.153",
    },
    {
      title: "< latest prerelease",
      depVersion: "<5.0.0-alpha.153",
      expected: "5.0.0-alpha.152",
    },
    {
      title: "< lower than latest prerelease",
      depVersion: "<5.0.0-alpha.152",
      expected: "5.0.0-alpha.151",
    },
    {
      title: "< higher than latest prerelease",
      depVersion: "<5.0.0-alpha.22343423",
      expected: "5.0.0-alpha.153",
    },
    {
      title: "< at lowest possible version",
      depVersion: "<5.0.0-alpha.151",
      expected: "5.0.0-alpha.150",
    },
    {
      title: "<= latest prerelease",
      depVersion: "<=5.0.0-alpha.153",
      expected: "5.0.0-alpha.153",
    },
    {
      title: "<= lower than latest prerelease",
      depVersion: "<=5.0.0-alpha.152",
      expected: "5.0.0-alpha.152",
    },
    {
      title: "<= lowest possible version",
      depVersion: "<=5.0.0-alpha.150",
      expected: "5.0.0-alpha.150",
    },
    {
      title: "<= higher than latest prerelease",
      depVersion: "<=5.0.0-alpha.153261345",
      expected: "5.0.0-alpha.153",
    },
    {
      title: "> latest prerelease",
      depVersion: ">=5.0.0-alpha.153",
      expected: "5.0.0-alpha.153",
    },
  ],
];
for (let i = 0; i < prereleaseTests.length; i++) {
  const tests = prereleaseTests[i];
  const depName = `prereleases-${i + 1}`;
  describe(`${depName} should pass`, () => {
    for (const { title, depVersion, expected } of tests) {
      test(title, async () => {
        await writeFile(
          join(packageDir, "package.json"),
          JSON.stringify({
            name: "foo",
            version: "1.0.0",
            dependencies: {
              [`${depName}`]: depVersion,
            },
          }),
        );

        const { stdout, stderr, exited } = spawn({
          cmd: [bunExe(), "install"],
          cwd: packageDir,
          stdout: "pipe",
          stdin: "pipe",
          stderr: "pipe",
          env,
        });

        const err = await new Response(stderr).text();
        const out = await new Response(stdout).text();
        expect(err).toContain("Saved lockfile");
        expect(err).not.toContain("not found");
        expect(err).not.toContain("error:");
        expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
          "",
          `+ ${depName}@${expected}`,
          "",
          "1 package installed",
        ]);
        expect(await file(join(packageDir, "node_modules", depName, "package.json")).json()).toEqual({
          name: depName,
          version: expected,
        } as any);
        expect(await exited).toBe(0);
      });
    }
  });
}
const prereleaseFailTests = [
  [
    // { title: "specific", depVersion: "1.0.0-future.1", expected: "1.0.0-future.1" },
    // { title: "latest", depVersion: "latest", expected: "1.0.0-future.4" },
    // { title: "range starting with latest", depVersion: "^1.0.0-future.4", expected: "1.0.0-future.4" },
    // { title: "range above latest", depVersion: "^1.0.0-future.5", expected: "1.0.0-future.7" },
  ],
  [
    // { title: "#6683", depVersion: "^1.0.0-next.23", expected: "1.0.0-next.23" },
    // {
    //   title: "greater than or equal to",
    //   depVersion: ">=1.0.0-next.23",
    //   expected: "1.0.0-next.23",
    // },
    // { title: "latest", depVersion: "latest", expected: "0.5.0" },
    // { title: "greater than or equal to latest", depVersion: ">=0.5.0", expected: "0.5.0" },
  ],

  // package "prereleases-3" has four versions, all with prerelease tags:
  // - 5.0.0-alpha.150
  // - 5.0.0-alpha.151
  // - 5.0.0-alpha.152
  // - 5.0.0-alpha.153
  [
    {
      title: "^ with higher non-existant prerelease",
      depVersion: "^5.0.0-alpha.1000",
    },
    {
      title: "~ with higher non-existant prerelease",
      depVersion: "~5.0.0-alpha.1000",
    },
    {
      title: "> with higher non-existant prerelease",
      depVersion: ">5.0.0-alpha.1000",
    },
    {
      title: ">= with higher non-existant prerelease",
      depVersion: ">=5.0.0-alpha.1000",
    },
    {
      title: "^4.3.0",
      depVersion: "^4.3.0",
    },
    {
      title: "~4.3.0",
      depVersion: "~4.3.0",
    },
    {
      title: ">4.3.0",
      depVersion: ">4.3.0",
    },
    {
      title: ">=4.3.0",
      depVersion: ">=4.3.0",
    },
    {
      title: "<5.0.0-alpha.150",
      depVersion: "<5.0.0-alpha.150",
    },
    {
      title: "<=5.0.0-alpha.149",
      depVersion: "<=5.0.0-alpha.149",
    },
    {
      title: "greater than highest prerelease",
      depVersion: ">5.0.0-alpha.153",
    },
    {
      title: "greater than or equal to highest prerelease + 1",
      depVersion: ">=5.0.0-alpha.154",
    },
    {
      title: "`.` instead of `-` should fail",
      depVersion: "5.0.0.alpha.150",
    },
  ],
  // prereleases-4 has one version
  // - 2.0.0-pre.0
  [
    {
      title: "wildcard should not match prerelease",
      depVersion: "x",
    },
    {
      title: "major wildcard should not match prerelease",
      depVersion: "x.0.0",
    },
    {
      title: "minor wildcard should not match prerelease",
      depVersion: "2.x",
    },
    {
      title: "patch wildcard should not match prerelease",
      depVersion: "2.0.x",
    },
  ],
];
for (let i = 0; i < prereleaseFailTests.length; i++) {
  const tests = prereleaseFailTests[i];
  const depName = `prereleases-${i + 1}`;
  describe(`${depName} should fail`, () => {
    for (const { title, depVersion } of tests) {
      test(title, async () => {
        await writeFile(
          join(packageDir, "package.json"),
          JSON.stringify({
            name: "foo",
            version: "1.0.0",
            dependencies: {
              [`${depName}`]: depVersion,
            },
          }),
        );

        const { stdout, stderr, exited } = spawn({
          cmd: [bunExe(), "install"],
          cwd: packageDir,
          stdout: "pipe",
          stdin: "pipe",
          stderr: "pipe",
          env,
        });

        const err = await new Response(stderr).text();
        const out = await new Response(stdout).text();
        expect(out).toBeEmpty();
        expect(err).toContain(`No version matching "${depVersion}" found for specifier "${depName}"`);
        expect(await exited).toBe(1);
      });
    }
  });
}

describe("yarn tests", () => {
  test("dragon test 1", async () => {
    await writeFile(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "dragon-test-1",
        version: "1.0.0",
        dependencies: {
          "dragon-test-1-d": "1.0.0",
          "dragon-test-1-e": "1.0.0",
        },
      }),
    );

    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    });

    const err = await new Response(stderr).text();
    const out = await new Response(stdout).text();
    expect(err).toContain("Saved lockfile");
    expect(err).not.toContain("not found");
    expect(err).not.toContain("error:");
    expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
      "",
      "+ dragon-test-1-d@1.0.0",
      "+ dragon-test-1-e@1.0.0",
      "",
      "6 packages installed",
    ]);
    expect(await readdirSorted(join(packageDir, "node_modules"))).toEqual([
      ".cache",
      "dragon-test-1-a",
      "dragon-test-1-b",
      "dragon-test-1-c",
      "dragon-test-1-d",
      "dragon-test-1-e",
    ]);
    expect(await file(join(packageDir, "node_modules", "dragon-test-1-b", "package.json")).json()).toEqual({
      name: "dragon-test-1-b",
      version: "2.0.0",
    } as any);
    expect(await readdirSorted(join(packageDir, "node_modules", "dragon-test-1-c", "node_modules"))).toEqual([
      "dragon-test-1-b",
    ]);
    expect(
      await file(
        join(packageDir, "node_modules", "dragon-test-1-c", "node_modules", "dragon-test-1-b", "package.json"),
      ).json(),
    ).toEqual({
      name: "dragon-test-1-b",
      version: "1.0.0",
      dependencies: {
        "dragon-test-1-a": "1.0.0",
      },
    } as any);
    expect(await exited).toBe(0);
  });

  test("dragon test 2", async () => {
    await writeFile(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "dragon-test-2",
        version: "1.0.0",
        workspaces: ["dragon-test-2-a", "dragon-test-2-b"],
        dependencies: {
          "dragon-test-2-a": "1.0.0",
        },
      }),
    );

    await mkdir(join(packageDir, "dragon-test-2-a"));
    await mkdir(join(packageDir, "dragon-test-2-b"));

    await writeFile(
      join(packageDir, "dragon-test-2-a", "package.json"),
      JSON.stringify({
        name: "dragon-test-2-a",
        version: "1.0.0",
        dependencies: {
          "dragon-test-2-b": "1.0.0",
          "no-deps": "1.0.0",
        },
      }),
    );

    await writeFile(
      join(packageDir, "dragon-test-2-b", "package.json"),
      JSON.stringify({
        name: "dragon-test-2-b",
        version: "1.0.0",
        dependencies: {
          "no-deps": "*",
        },
      }),
    );

    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    });

    const err = await new Response(stderr).text();
    const out = await new Response(stdout).text();
    expect(err).toContain("Saved lockfile");
    expect(err).not.toContain("not found");
    expect(err).not.toContain("error:");
    expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
      "",
      "+ dragon-test-2-a@workspace:dragon-test-2-a",
      "",
      "3 packages installed",
    ]);
    expect(await readdirSorted(join(packageDir, "node_modules"))).toEqual([
      ".cache",
      "dragon-test-2-a",
      "dragon-test-2-b",
      "no-deps",
    ]);
    expect(await file(join(packageDir, "node_modules", "no-deps", "package.json")).json()).toEqual({
      name: "no-deps",
      version: "1.0.0",
    });
    expect(await exists(join(packageDir, "dragon-test-2-a", "node_modules"))).toBeFalse();
    expect(await exited).toBe(0);
  });

  test("dragon test 3", async () => {
    await writeFile(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "dragon-test-3",
        version: "1.0.0",
        dependencies: {
          "dragon-test-3-a": "1.0.0",
        },
      }),
    );

    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    });

    const err = await new Response(stderr).text();
    const out = await new Response(stdout).text();
    expect(err).toContain("Saved lockfile");
    expect(err).not.toContain("not found");
    expect(err).not.toContain("error:");
    expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
      "",
      "+ dragon-test-3-a@1.0.0",
      "",
      "3 packages installed",
    ]);
    expect(await readdirSorted(join(packageDir, "node_modules"))).toEqual([
      ".cache",
      "dragon-test-3-a",
      "dragon-test-3-b",
      "no-deps",
    ]);
    expect(await file(join(packageDir, "node_modules", "dragon-test-3-a", "package.json")).json()).toEqual({
      name: "dragon-test-3-a",
      version: "1.0.0",
      dependencies: {
        "dragon-test-3-b": "1.0.0",
      },
      peerDependencies: {
        "no-deps": "*",
      },
    } as any);
    expect(await exited).toBe(0);
  });

  test("dragon test 4", async () => {
    await writeFile(
      join(packageDir, "package.json"),
      JSON.stringify({
        "name": "dragon-test-4",
        "version": "1.0.0",
        "workspaces": ["my-workspace"],
      }),
    );

    await mkdir(join(packageDir, "my-workspace"));
    await writeFile(
      join(packageDir, "my-workspace", "package.json"),
      JSON.stringify({
        "name": "my-workspace",
        "version": "1.0.0",
        "peerDependencies": {
          "no-deps": "*",
          "peer-deps": "*",
        },
        "devDependencies": {
          "no-deps": "1.0.0",
          "peer-deps": "1.0.0",
        },
      }),
    );

    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    });

    const err = await new Response(stderr).text();
    const out = await new Response(stdout).text();
    expect(err).toContain("Saved lockfile");
    expect(err).not.toContain("not found");
    expect(err).not.toContain("error:");
    expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual(["", "3 packages installed"]);
    expect(await readdirSorted(join(packageDir, "node_modules"))).toEqual([
      ".cache",
      "my-workspace",
      "no-deps",
      "peer-deps",
    ]);
    expect(await file(join(packageDir, "node_modules", "no-deps", "package.json")).json()).toEqual({
      name: "no-deps",
      version: "1.0.0",
    } as any);
    expect(await file(join(packageDir, "node_modules", "peer-deps", "package.json")).json()).toEqual({
      name: "peer-deps",
      version: "1.0.0",
      peerDependencies: {
        "no-deps": "*",
      },
    } as any);
    expect(await exited).toBe(0);
  });

  test("dragon test 5", async () => {
    await writeFile(
      join(packageDir, "package.json"),
      JSON.stringify({
        "name": "dragon-test-5",
        "version": "1.0.0",
        "workspaces": ["packages/*"],
      }),
    );

    await mkdir(join(packageDir, "packages", "a"), { recursive: true });
    await mkdir(join(packageDir, "packages", "b"), { recursive: true });

    await writeFile(
      join(packageDir, "packages", "a", "package.json"),
      JSON.stringify({
        "name": "a",
        "peerDependencies": {
          "various-requires": "*",
        },
        "devDependencies": {
          "no-deps": "1.0.0",
          "peer-deps": "1.0.0",
        },
      }),
    );

    await writeFile(
      join(packageDir, "packages", "b", "package.json"),
      JSON.stringify({
        "name": "b",
        "devDependencies": {
          "a": "workspace:*",
          "various-requires": "1.0.0",
        },
      }),
    );

    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    });

    const err = await new Response(stderr).text();
    const out = await new Response(stdout).text();
    expect(err).toContain("Saved lockfile");
    expect(err).not.toContain("not found");
    expect(err).not.toContain("error:");
    expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual(["", "5 packages installed"]);
    expect(await readdirSorted(join(packageDir, "node_modules"))).toEqual([
      ".cache",
      "a",
      "b",
      "no-deps",
      "peer-deps",
      "various-requires",
    ]);
    expect(await file(join(packageDir, "node_modules", "no-deps", "package.json")).json()).toEqual({
      name: "no-deps",
      version: "1.0.0",
    } as any);
    expect(await file(join(packageDir, "node_modules", "peer-deps", "package.json")).json()).toEqual({
      name: "peer-deps",
      version: "1.0.0",
      peerDependencies: {
        "no-deps": "*",
      },
    } as any);
    expect(await file(join(packageDir, "node_modules", "various-requires", "package.json")).json()).toEqual({
      name: "various-requires",
      version: "1.0.0",
    } as any);
    expect(await exited).toBe(0);
  });

  test.todo("dragon test 6", async () => {
    await writeFile(
      join(packageDir, "package.json"),
      JSON.stringify({
        "name": "dragon-test-6",
        "version": "1.0.0",
        "workspaces": ["packages/*"],
      }),
    );

    await mkdir(join(packageDir, "packages", "a"), { recursive: true });
    await mkdir(join(packageDir, "packages", "b"), { recursive: true });
    await mkdir(join(packageDir, "packages", "c"), { recursive: true });
    await mkdir(join(packageDir, "packages", "u"), { recursive: true });
    await mkdir(join(packageDir, "packages", "v"), { recursive: true });
    await mkdir(join(packageDir, "packages", "y"), { recursive: true });
    await mkdir(join(packageDir, "packages", "z"), { recursive: true });

    await writeFile(
      join(packageDir, "packages", "a", "package.json"),
      JSON.stringify({
        name: `a`,
        dependencies: {
          [`z`]: `workspace:*`,
        },
      }),
    );
    await writeFile(
      join(packageDir, "packages", "b", "package.json"),
      JSON.stringify({
        name: `b`,
        dependencies: {
          [`u`]: `workspace:*`,
          [`v`]: `workspace:*`,
        },
      }),
    );
    await writeFile(
      join(packageDir, "packages", "c", "package.json"),
      JSON.stringify({
        name: `c`,
        dependencies: {
          [`u`]: `workspace:*`,
          [`v`]: `workspace:*`,
          [`y`]: `workspace:*`,
          [`z`]: `workspace:*`,
        },
      }),
    );
    await writeFile(
      join(packageDir, "packages", "u", "package.json"),
      JSON.stringify({
        name: `u`,
      }),
    );
    await writeFile(
      join(packageDir, "packages", "v", "package.json"),
      JSON.stringify({
        name: `v`,
        peerDependencies: {
          [`u`]: `*`,
        },
      }),
    );
    await writeFile(
      join(packageDir, "packages", "y", "package.json"),
      JSON.stringify({
        name: `y`,
        peerDependencies: {
          [`v`]: `*`,
        },
      }),
    );
    await writeFile(
      join(packageDir, "packages", "z", "package.json"),
      JSON.stringify({
        name: `z`,
        dependencies: {
          [`y`]: `workspace:*`,
        },
        peerDependencies: {
          [`v`]: `*`,
        },
      }),
    );

    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    });

    const err = await new Response(stderr).text();
    const out = await new Response(stdout).text();
    expect(err).toContain("Saved lockfile");
    expect(err).not.toContain("not found");
    expect(err).not.toContain("error:");
    expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
      "",
      "+ a@workspace:packages/a",
      "+ b@workspace:packages/b",
      "+ c@workspace:packages/c",
      "+ u@workspace:packages/u",
      "+ v@workspace:packages/v",
      "+ y@workspace:packages/y",
      "+ z@workspace:packages/z",
      "",
      "7 packages installed",
    ]);
    expect(await exited).toBe(0);
  });

  test.todo("dragon test 7", async () => {
    await writeFile(
      join(packageDir, "package.json"),
      JSON.stringify({
        "name": "dragon-test-7",
        "version": "1.0.0",
        "dependencies": {
          "dragon-test-7-a": "1.0.0",
          "dragon-test-7-d": "1.0.0",
          "dragon-test-7-b": "2.0.0",
          "dragon-test-7-c": "3.0.0",
        },
      }),
    );

    var { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    });

    var err = await new Response(stderr).text();
    var out = await new Response(stdout).text();
    expect(err).toContain("Saved lockfile");
    expect(err).not.toContain("not found");
    expect(err).not.toContain("error:");
    expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
      "",
      "+ dragon-test-7-a@1.0.0",
      "+ dragon-test-7-b@2.0.0",
      "+ dragon-test-7-c@3.0.0",
      "+ dragon-test-7-d@1.0.0",
      "",
      "7 packages installed",
    ]);
    expect(await exited).toBe(0);

    await writeFile(
      join(packageDir, "test.js"),
      `console.log(require("dragon-test-7-a"), require("dragon-test-7-d"));`,
    );

    ({ stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "test.js"],
      cwd: packageDir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    }));

    err = await new Response(stderr).text();
    out = await new Response(stdout).text();
    expect(err).toBeEmpty();
    expect(out).toBe("1.0.0 1.0.0\n");

    expect(
      await exists(
        join(
          packageDir,
          "node_modules",
          "dragon-test-7-a",
          "node_modules",
          "dragon-test-7-b",
          "node_modules",
          "dragon-test-7-c",
        ),
      ),
    ).toBeTrue();
    expect(
      await exists(
        join(packageDir, "node_modules", "dragon-test-7-d", "node_modules", "dragon-test-7-b", "node_modules"),
      ),
    ).toBeFalse();
    expect(await exited).toBe(0);
  });

  test("dragon test 8", async () => {
    await writeFile(
      join(packageDir, "package.json"),
      JSON.stringify({
        "name": "dragon-test-8",
        version: "1.0.0",
        dependencies: {
          "dragon-test-8-a": "1.0.0",
          "dragon-test-8-b": "1.0.0",
          "dragon-test-8-c": "1.0.0",
          "dragon-test-8-d": "1.0.0",
        },
      }),
    );

    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    });

    const err = await new Response(stderr).text();
    const out = await new Response(stdout).text();
    expect(err).toContain("Saved lockfile");
    expect(err).not.toContain("not found");
    expect(err).not.toContain("error:");
    expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
      "",
      "+ dragon-test-8-a@1.0.0",
      "+ dragon-test-8-b@1.0.0",
      "+ dragon-test-8-c@1.0.0",
      "+ dragon-test-8-d@1.0.0",
      "",
      "4 packages installed",
    ]);
    expect(await exited).toBe(0);
  });

  test("dragon test 9", async () => {
    await writeFile(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "dragon-test-9",
        version: "1.0.0",
        dependencies: {
          [`first`]: `npm:peer-deps@1.0.0`,
          [`second`]: `npm:peer-deps@1.0.0`,
          [`no-deps`]: `1.0.0`,
        },
      }),
    );
    var { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    });

    var err = await new Response(stderr).text();
    var out = await new Response(stdout).text();
    expect(err).toContain("Saved lockfile");
    expect(err).not.toContain("not found");
    expect(err).not.toContain("error:");
    expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
      "",
      "+ first@1.0.0",
      "+ no-deps@1.0.0",
      "+ second@1.0.0",
      "",
      "2 packages installed",
    ]);
    expect(await file(join(packageDir, "node_modules", "first", "package.json")).json()).toEqual(
      await file(join(packageDir, "node_modules", "second", "package.json")).json(),
    );
    expect(await exited).toBe(0);
  });

  test.todo("dragon test 10", async () => {
    await writeFile(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "dragon-test-10",
        version: "1.0.0",
        workspaces: ["packages/*"],
      }),
    );

    await mkdir(join(packageDir, "packages", "a"), { recursive: true });
    await mkdir(join(packageDir, "packages", "b"), { recursive: true });
    await mkdir(join(packageDir, "packages", "c"), { recursive: true });

    await writeFile(
      join(packageDir, "packages", "a", "package.json"),
      JSON.stringify({
        name: "a",
        devDependencies: {
          b: "workspace:*",
        },
      }),
    );
    await writeFile(
      join(packageDir, "packages", "b", "package.json"),
      JSON.stringify({
        name: "b",
        peerDependencies: {
          c: "*",
        },
        devDependencies: {
          c: "workspace:*",
        },
      }),
    );
    await writeFile(
      join(packageDir, "packages", "c", "package.json"),
      JSON.stringify({
        name: "c",
        peerDependencies: {
          "no-deps": "*",
        },
        depedencies: {
          b: "workspace:*",
        },
      }),
    );

    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install", "--dev"],
      cwd: packageDir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    });

    const out = await new Response(stdout).text();
    const err = await new Response(stderr).text();
    expect(err).toContain("Saved lockfile");
    expect(err).not.toContain("error:");
    expect(err).not.toContain("not found");
    expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
      "",
      "+ a@workspace:packages/a",
      "+ b@workspace:packages/b",
      "+ c@workspace:packages/c",
      "",
      "  packages installed",
    ]);
    expect(await exited).toBe(0);
  });

  test("dragon test 12", async () => {
    await writeFile(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "dragon-test-12",
        version: "1.0.0",
        workspaces: ["pkg-a", "pkg-b"],
      }),
    );

    await mkdir(join(packageDir, "pkg-a"), { recursive: true });
    await mkdir(join(packageDir, "pkg-b"), { recursive: true });

    await writeFile(
      join(packageDir, "pkg-a", "package.json"),
      JSON.stringify({
        name: "pkg-a",
        dependencies: {
          "pkg-b": "workspace:*",
        },
      }),
    );
    await writeFile(
      join(packageDir, "pkg-b", "package.json"),
      JSON.stringify({
        name: "pkg-b",
        dependencies: {
          "peer-deps": "1.0.0",
          "fake-peer-deps": "npm:peer-deps@1.0.0",
        },
        peerDependencies: {
          "no-deps": "1.0.0",
        },
      }),
    );

    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    });

    const out = await new Response(stdout).text();
    const err = await new Response(stderr).text();
    expect(err).toContain("Saved lockfile");
    expect(err).not.toContain("error:");
    expect(err).not.toContain("not found");
    expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual(["", "4 packages installed"]);
    expect(await readdirSorted(join(packageDir, "node_modules"))).toEqual([
      ".cache",
      "fake-peer-deps",
      "no-deps",
      "peer-deps",
      "pkg-a",
      "pkg-b",
    ]);
    expect(await file(join(packageDir, "node_modules", "fake-peer-deps", "package.json")).json()).toEqual({
      name: "peer-deps",
      version: "1.0.0",
      peerDependencies: {
        "no-deps": "*",
      },
    } as any);
    expect(await exited).toBe(0);
  });

  test("it should not warn when the peer dependency resolution is compatible", async () => {
    await writeFile(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "compatible-peer-deps",
        version: "1.0.0",
        dependencies: {
          "peer-deps-fixed": "1.0.0",
          "no-deps": "1.0.0",
        },
      }),
    );

    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install", "--dev"],
      cwd: packageDir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    });

    const out = await new Response(stdout).text();
    const err = await new Response(stderr).text();
    expect(err).toContain("Saved lockfile");
    expect(err).not.toContain("error:");
    expect(err).not.toContain("not found");
    expect(err).not.toContain("incorrect peer dependency");
    expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
      "",
      "+ no-deps@1.0.0",
      "+ peer-deps-fixed@1.0.0",
      "",
      "2 packages installed",
    ]);
    expect(await readdirSorted(join(packageDir, "node_modules"))).toEqual([".cache", "no-deps", "peer-deps-fixed"]);
    expect(await exited).toBe(0);
  });

  test("it should warn when the peer dependency resolution is incompatible", async () => {
    await writeFile(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "incompatible-peer-deps",
        version: "1.0.0",
        dependencies: {
          "peer-deps-fixed": "1.0.0",
          "no-deps": "2.0.0",
        },
      }),
    );

    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install", "--dev"],
      cwd: packageDir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    });

    const out = await new Response(stdout).text();
    const err = await new Response(stderr).text();
    expect(err).toContain("Saved lockfile");
    expect(err).not.toContain("error:");
    expect(err).not.toContain("not found");
    expect(err).toContain("incorrect peer dependency");
    expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
      "",
      "+ no-deps@2.0.0",
      "+ peer-deps-fixed@1.0.0",
      "",
      "2 packages installed",
    ]);
    expect(await readdirSorted(join(packageDir, "node_modules"))).toEqual([".cache", "no-deps", "peer-deps-fixed"]);
    expect(await exited).toBe(0);
  });

  test("it should install in such a way that two identical packages with different peer dependencies are different instances", async () => {
    await writeFile(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "foo",
        version: "1.0.0",
        dependencies: {
          "provides-peer-deps-1-0-0": "1.0.0",
          "provides-peer-deps-2-0-0": "1.0.0",
        },
      }),
    );

    var { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    });

    var err = await new Response(stderr).text();
    var out = await new Response(stdout).text();
    expect(err).toContain("Saved lockfile");
    expect(err).not.toContain("error:");
    expect(err).not.toContain("not found");
    expect(err).not.toContain("incorrect peer dependency");
    expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
      "",
      "+ provides-peer-deps-1-0-0@1.0.0",
      "+ provides-peer-deps-2-0-0@1.0.0",
      "",
      "5 packages installed",
    ]);
    expect(await exited).toBe(0);

    await writeFile(
      join(packageDir, "test.js"),
      `console.log(
        require("provides-peer-deps-1-0-0").dependencies["peer-deps"] ===
          require("provides-peer-deps-2-0-0").dependencies["peer-deps"]
      );
      console.log(
        Bun.deepEquals(require("provides-peer-deps-1-0-0"), {
          name: "provides-peer-deps-1-0-0",
          version: "1.0.0",
          dependencies: {
            "peer-deps": {
              name: "peer-deps",
              version: "1.0.0",
              peerDependencies: {
                "no-deps": {
                  name: "no-deps",
                  version: "1.0.0",
                },
              },
            },
            "no-deps": {
              name: "no-deps",
              version: "1.0.0",
            },
          },
        })
      );
      console.log(
        Bun.deepEquals(require("provides-peer-deps-2-0-0"), {
          name: "provides-peer-deps-2-0-0",
          version: "1.0.0",
          dependencies: {
            "peer-deps": {
              name: "peer-deps",
              version: "1.0.0",
              peerDependencies: {
                "no-deps": {
                  name: "no-deps",
                  version: "2.0.0",
                },
              },
            },
            "no-deps": {
              name: "no-deps",
              version: "2.0.0",
            },
          },
        })
      );`,
    );

    ({ stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "test.js"],
      cwd: packageDir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    }));

    err = await new Response(stderr).text();
    out = await new Response(stdout).text();
    expect(out).toBe("true\ntrue\nfalse\n");
    expect(err).toBeEmpty();
    expect(await exited).toBe(0);
  });

  test("it should install in such a way that two identical packages with the same peer dependencies are the same instances (simple)", async () => {
    await writeFile(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "foo",
        version: "1.0.0",
        dependencies: {
          "provides-peer-deps-1-0-0": "1.0.0",
          "provides-peer-deps-1-0-0-too": "1.0.0",
        },
      }),
    );

    var { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    });

    var err = await new Response(stderr).text();
    var out = await new Response(stdout).text();
    expect(err).toContain("Saved lockfile");
    expect(err).not.toContain("error:");
    expect(err).not.toContain("not found");
    expect(err).not.toContain("incorrect peer dependency");
    expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
      "",
      "+ provides-peer-deps-1-0-0@1.0.0",
      "+ provides-peer-deps-1-0-0-too@1.0.0",
      "",
      "4 packages installed",
    ]);
    expect(await exited).toBe(0);

    await writeFile(
      join(packageDir, "test.js"),
      `console.log(
        require("provides-peer-deps-1-0-0").dependencies["peer-deps"] ===
          require("provides-peer-deps-1-0-0-too").dependencies["peer-deps"]
      );`,
    );

    ({ stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "test.js"],
      cwd: packageDir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    }));

    err = await new Response(stderr).text();
    out = await new Response(stdout).text();
    expect(out).toBe("true\n");
    expect(err).toBeEmpty();
    expect(await exited).toBe(0);
  });

  test("it should install in such a way that two identical packages with the same peer dependencies are the same instances (complex)", async () => {
    await writeFile(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "foo",
        version: "1.0.0",
        dependencies: {
          "forward-peer-deps": "1.0.0",
          "forward-peer-deps-too": "1.0.0",
          "no-deps": "1.0.0",
        },
      }),
    );

    var { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    });

    var err = await new Response(stderr).text();
    var out = await new Response(stdout).text();
    expect(err).toContain("Saved lockfile");
    expect(err).not.toContain("error:");
    expect(err).not.toContain("not found");
    expect(err).not.toContain("incorrect peer dependency");
    expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
      "",
      "+ forward-peer-deps@1.0.0",
      "+ forward-peer-deps-too@1.0.0",
      "+ no-deps@1.0.0",
      "",
      "4 packages installed",
    ]);
    expect(await exited).toBe(0);

    await writeFile(
      join(packageDir, "test.js"),
      `console.log(
        require("forward-peer-deps").dependencies["peer-deps"] ===
          require("forward-peer-deps-too").dependencies["peer-deps"]
      );`,
    );

    ({ stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "test.js"],
      cwd: packageDir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    }));

    err = await new Response(stderr).text();
    out = await new Response(stdout).text();
    expect(out).toBe("true\n");
    expect(err).toBeEmpty();
    expect(await exited).toBe(0);
  });

  test("it shouldn't deduplicate two packages with similar peer dependencies but different names", async () => {
    await writeFile(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "foo",
        version: "1.0.0",
        dependencies: {
          "peer-deps": "1.0.0",
          "peer-deps-too": "1.0.0",
          "no-deps": "1.0.0",
        },
      }),
    );

    var { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    });

    var err = await new Response(stderr).text();
    var out = await new Response(stdout).text();
    expect(err).toContain("Saved lockfile");
    expect(err).not.toContain("error:");
    expect(err).not.toContain("not found");
    expect(err).not.toContain("incorrect peer dependency");
    expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
      "",
      "+ no-deps@1.0.0",
      "+ peer-deps@1.0.0",
      "+ peer-deps-too@1.0.0",
      "",
      "3 packages installed",
    ]);
    expect(await exited).toBe(0);

    await writeFile(join(packageDir, "test.js"), `console.log(require('peer-deps') === require('peer-deps-too'));`);

    ({ stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "test.js"],
      cwd: packageDir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    }));

    err = await new Response(stderr).text();
    out = await new Response(stdout).text();
    expect(out).toBe("false\n");
    expect(err).toBeEmpty();
    expect(await exited).toBe(0);
  });

  test("it should reinstall and rebuild dependencies deleted by the user on the next install", async () => {
    await writeFile(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "foo",
        version: "1.0.0",
        dependencies: {
          "no-deps-scripted": "1.0.0",
          "one-dep-scripted": "1.5.0",
        },
        trustedDependencies: ["no-deps-scripted", "one-dep-scripted"],
      }),
    );

    var { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install", "--dev"],
      cwd: packageDir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    });

    var err = await new Response(stderr).text();
    var out = await new Response(stdout).text();
    expect(err).toContain("Saved lockfile");
    expect(err).not.toContain("error:");
    expect(err).not.toContain("not found");
    expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
      "",
      "+ no-deps-scripted@1.0.0",
      "+ one-dep-scripted@1.5.0",
      "",
      expect.stringContaining("4 packages installed"),
    ]);
    expect(await exists(join(packageDir, "node_modules/one-dep-scripted/success.txt"))).toBeTrue();
    expect(await exited).toBe(0);

    await rm(join(packageDir, "node_modules/one-dep-scripted"), { recursive: true, force: true });

    ({ stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install", "--dev"],
      cwd: packageDir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    }));

    err = await new Response(stderr).text();
    out = await new Response(stdout).text();
    expect(err).not.toContain("Saved lockfile");
    expect(err).not.toContain("error:");
    expect(err).not.toContain("not found");
    expect(await exists(join(packageDir, "node_modules/one-dep-scripted/success.txt"))).toBeTrue();
    expect(await exited).toBe(0);
  });
});

test("tarball `./` prefix, duplicate directory with file, and empty directory", async () => {
  await write(
    join(packageDir, "package.json"),
    JSON.stringify({
      name: "foo",
      dependencies: {
        "tarball-without-package-prefix": "1.0.0",
      },
    }),
  );

  // Entries in this tarball:
  //
  //  ./
  //  ./package1000.js
  //  ./package2/
  //  ./package3/
  //  ./package4/
  //  ./package.json
  //  ./package/
  //  ./package1000/
  //  ./package/index.js
  //  ./package4/package5/
  //  ./package4/package.json
  //  ./package3/package6/
  //  ./package3/package6/index.js
  //  ./package2/index.js
  //  package3/
  //  package3/package6/
  //  package3/package6/index.js
  //
  // The directory `package3` is added twice, but because one doesn't start
  // with `./`, it is stripped from the path and a copy of `package6` is placed
  // at the root of the output directory. Also `package1000` is not included in
  // the output because it is an empty directory.

  await runBunInstall(env, packageDir);
  const prefix = join(packageDir, "node_modules", "tarball-without-package-prefix");
  const results = await Promise.all([
    file(join(prefix, "package.json")).json(),
    file(join(prefix, "package1000.js")).text(),
    file(join(prefix, "package", "index.js")).text(),
    file(join(prefix, "package2", "index.js")).text(),
    file(join(prefix, "package3", "package6", "index.js")).text(),
    file(join(prefix, "package4", "package.json")).json(),
    exists(join(prefix, "package4", "package5")),
    exists(join(prefix, "package1000")),
    file(join(prefix, "package6", "index.js")).text(),
  ]);
  expect(results).toEqual([
    {
      name: "tarball-without-package-prefix",
      version: "1.0.0",
    },
    "hi",
    "ooops",
    "ooooops",
    "oooooops",
    {
      "name": "tarball-without-package-prefix",
      "version": "2.0.0",
    },
    false,
    false,
    "oooooops",
  ]);
  expect(await file(join(packageDir, "node_modules", "tarball-without-package-prefix", "package.json")).json()).toEqual(
    {
      name: "tarball-without-package-prefix",
      version: "1.0.0",
    },
  );
});

// TODO: setup verdaccio to run across multiple test files, then move this and a few other describe
// scopes (update, hoisting, ...) to other files
//
// test/cli/install/registry/bun-install-windowsshim.test.ts:
//
// This test is to verify that BinLinkingShim.zig creates correct shim files as
// well as bun_shim_impl.exe works in various edge cases. There are many fast
// paths for many many cases.
describe("windows bin linking shim should work", async () => {
  if (!isWindows) return;

  const packageDir = tmpdirSync();

  await writeFile(
    join(packageDir, "bunfig.toml"),
    `
[install]
cache = false
registry = "http://localhost:${port}/"
`,
  );

  await writeFile(
    join(packageDir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "1.0.0",
      dependencies: {
        "bunx-bins": "*",
      },
    }),
  );
  console.log(packageDir);

  var { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install", "--dev"],
    cwd: packageDir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  });

  var err = await new Response(stderr).text();
  var out = await new Response(stdout).text();
  console.log(err);
  expect(err).toContain("Saved lockfile");
  expect(err).not.toContain("error:");
  expect(err).not.toContain("panic:");
  expect(err).not.toContain("not found");
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    "",
    "+ bunx-bins@1.0.0",
    "",
    expect.stringContaining("1 package installed"),
  ]);
  expect(await exited).toBe(0);

  const temp_bin_dir = join(packageDir, "temp");
  mkdirSync(temp_bin_dir);

  for (let i = 1; i <= 7; i++) {
    const target = join(temp_bin_dir, "a".repeat(i) + ".exe");
    copyFileSync(bunExe(), target);
  }

  copyFileSync(join(packageDir, "node_modules\\bunx-bins\\native.exe"), join(temp_bin_dir, "native.exe"));

  const PATH = process.env.PATH + ";" + temp_bin_dir;

  const bins = [
    { bin: "bin1", name: "bin1" },
    { bin: "bin2", name: "bin2" },
    { bin: "bin3", name: "bin3" },
    { bin: "bin4", name: "bin4" },
    { bin: "bin5", name: "bin5" },
    { bin: "bin6", name: "bin6" },
    { bin: "bin7", name: "bin7" },
    { bin: "bin-node", name: "bin-node" },
    { bin: "bin-bun", name: "bin-bun" },
    { bin: "native", name: "exe" },
    { bin: "uses-native", name: `exe ${packageDir}\\node_modules\\bunx-bins\\uses-native.ts` },
  ];

  for (const { bin, name } of bins) {
    test(`bun run ${bin} arg1 arg2`, async () => {
      var { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "run", bin, "arg1", "arg2"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env: mergeWindowEnvs([env, { PATH: PATH }]),
      });
      expect(stderr).toBeDefined();
      const err = await new Response(stderr).text();
      expect(err.trim()).toBe("");
      const out = await new Response(stdout).text();
      expect(out.trim()).toBe(`i am ${name} arg1 arg2`);
      expect(await exited).toBe(0);
    });
  }

  for (const { bin, name } of bins) {
    test(`bun --bun run ${bin} arg1 arg2`, async () => {
      var { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "--bun", "run", bin, "arg1", "arg2"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env: mergeWindowEnvs([env, { PATH: PATH }]),
      });
      expect(stderr).toBeDefined();
      const err = await new Response(stderr).text();
      expect(err.trim()).toBe("");
      const out = await new Response(stdout).text();
      expect(out.trim()).toBe(`i am ${name} arg1 arg2`);
      expect(await exited).toBe(0);
    });
  }

  for (const { bin, name } of bins) {
    test(`bun --bun x ${bin} arg1 arg2`, async () => {
      var { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "--bun", "x", bin, "arg1", "arg2"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env: mergeWindowEnvs([env, { PATH: PATH }]),
      });
      expect(stderr).toBeDefined();
      const err = await new Response(stderr).text();
      expect(err.trim()).toBe("");
      const out = await new Response(stdout).text();
      expect(out.trim()).toBe(`i am ${name} arg1 arg2`);
      expect(await exited).toBe(0);
    });
  }

  for (const { bin, name } of bins) {
    test(`${bin} arg1 arg2`, async () => {
      var { stdout, stderr, exited } = spawn({
        cmd: [join(packageDir, "node_modules", ".bin", bin + ".exe"), "arg1", "arg2"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env: mergeWindowEnvs([env, { PATH: PATH }]),
      });
      expect(stderr).toBeDefined();
      const err = await new Response(stderr).text();
      expect(err.trim()).toBe("");
      const out = await new Response(stdout).text();
      expect(out.trim()).toBe(`i am ${name} arg1 arg2`);
      expect(await exited).toBe(0);
    });
  }
});
