import { write } from "bun";
import { afterAll, beforeAll, describe, expect, it, test } from "bun:test";
import { rm } from "fs/promises";
import { VerdaccioRegistry, bunExe, bunEnv as env, stderrForInstall, tempDir } from "harness";
import { join } from "path";
const { iniInternals } = require("bun:internal-for-testing");
const { loadNpmrc } = iniInternals;

var registry = new VerdaccioRegistry();

beforeAll(async () => {
  await registry.start();
});

afterAll(() => {
  registry.stop();
});

describe("npmrc", async () => {
  const isBase64Encoded = (opt: string) => opt === "_auth" || opt === "_password";

  it("should convert to utf8 if BOM", async () => {
    const { packageDir, packageJson } = await registry.createTestDir();

    await Promise.all([
      write(join(packageDir, ".npmrc"), Buffer.from(`\ufeff\ncache=hi!`, "utf16le")),
      write(packageJson, JSON.stringify({ name: "foo", version: "1.0.0" })),
      rm(join(packageDir, "bunfig.toml"), { force: true }),
    ]);

    const originalCacheDir = env.BUN_INSTALL_CACHE_DIR;
    delete env.BUN_INSTALL_CACHE_DIR;
    const { stdout, stderr, exited } = Bun.spawn({
      cmd: [bunExe(), "pm", "cache"],
      cwd: packageDir,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    env.BUN_INSTALL_CACHE_DIR = originalCacheDir;

    const out = await stdout.text();
    const err = stderrForInstall(await stderr.text());
    console.log({ out, err });
    expect(err).toBeEmpty();
    expect(out.endsWith("hi!")).toBeTrue();

    expect(await exited).toBe(0);
  });

  it("works with empty file", async () => {
    const { packageDir, packageJson } = await registry.createTestDir();

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
    const { packageDir, packageJson } = await registry.createTestDir();

    console.log("package dir", packageDir);
    await Bun.$`rm -rf ${packageDir}/bunfig.toml`;

    const ini = /* ini */ `
registry = http://localhost:${registry.port}/
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
    const { packageDir, packageJson } = await registry.createTestDir();

    await Bun.$`rm -rf ${packageDir}/bunfig.toml`;

    const ini = /* ini */ `
  @types:registry=http://localhost:${registry.port}/
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

  it("works with home config", async () => {
    const { packageDir, packageJson } = await registry.createTestDir();

    console.log("package dir", packageDir);
    await Bun.$`rm -rf ${packageDir}/bunfig.toml`;

    const homeDir = `${packageDir}/home_dir`;
    await Bun.$`mkdir -p ${homeDir}`;
    console.log("home dir", homeDir);

    const ini = /* ini */ `
  registry=http://localhost:${registry.port}/
  `;

    await Bun.$`echo ${ini} > ${homeDir}/.npmrc`;
    await Bun.$`echo ${JSON.stringify({
      name: "foo",
      dependencies: {
        "no-deps": "1.0.0",
      },
    })} > package.json`.cwd(packageDir);
    await Bun.$`${bunExe()} install`
      .env({
        ...process.env,
        XDG_CONFIG_HOME: `${homeDir}`,
      })
      .cwd(packageDir)
      .throws(true);
  });

  it("works with two configs", async () => {
    const { packageDir, packageJson } = await registry.createTestDir();

    await Bun.$`rm -rf ${packageDir}/bunfig.toml`;

    console.log("package dir", packageDir);
    const packageIni = /* ini */ `
  @types:registry=http://localhost:${registry.port}/
  `;
    await Bun.$`echo ${packageIni} > ${packageDir}/.npmrc`;

    const homeDir = `${packageDir}/home_dir`;
    await Bun.$`mkdir -p ${homeDir}`;
    console.log("home dir", homeDir);
    const homeIni = /* ini */ `
    registry = http://localhost:${registry.port}/
    `;
    await Bun.$`echo ${homeIni} > ${homeDir}/.npmrc`;

    await Bun.$`echo ${JSON.stringify({
      name: "foo",
      dependencies: {
        "no-deps": "1.0.0",
        "@types/no-deps": "1.0.0",
      },
    })} > package.json`.cwd(packageDir);
    await Bun.$`${bunExe()} install`
      .env({
        ...process.env,
        XDG_CONFIG_HOME: `${homeDir}`,
      })
      .cwd(packageDir)
      .throws(true);
  });

  it("package config overrides home config", async () => {
    const { packageDir, packageJson } = await registry.createTestDir();

    await Bun.$`rm -rf ${packageDir}/bunfig.toml`;

    console.log("package dir", packageDir);
    const packageIni = /* ini */ `
  @types:registry=http://localhost:${registry.port}/
  `;
    await Bun.$`echo ${packageIni} > ${packageDir}/.npmrc`;

    const homeDir = `${packageDir}/home_dir`;
    await Bun.$`mkdir -p ${homeDir}`;
    console.log("home dir", homeDir);
    const homeIni = /* ini */ "@types:registry=https://registry.npmjs.org/";
    await Bun.$`echo ${homeIni} > ${homeDir}/.npmrc`;

    await Bun.$`echo ${JSON.stringify({
      name: "foo",
      dependencies: {
        "@types/no-deps": "1.0.0",
      },
    })} > package.json`.cwd(packageDir);
    await Bun.$`${bunExe()} install`
      .env({
        ...process.env,
        XDG_CONFIG_HOME: `${homeDir}`,
      })
      .cwd(packageDir)
      .throws(true);
  });

  it("default registry from env variable", async () => {
    const { packageDir, packageJson } = await registry.createTestDir();

    const ini = /* ini */ `
registry=\${LOL}
  `;

    const result = loadNpmrc(ini, { LOL: `http://localhost:${registry.port}/` });

    expect(result.default_registry_url).toBe(`http://localhost:${registry.port}/`);
  });

  it("default registry from env variable 2", async () => {
    const { packageDir, packageJson } = await registry.createTestDir();

    await Bun.$`rm -rf ${packageDir}/bunfig.toml`;

    const ini = /* ini */ `
registry=http://localhost:\${PORT}/
  `;

    const result = loadNpmrc(ini, { ...env, PORT: registry.port });

    expect(result.default_registry_url).toEqual(`http://localhost:${registry.port}/`);
  });

  async function makeTest(
    options: [option: string, value: string][],
    check: (result: {
      default_registry_url: string;
      default_registry_token: string;
      default_registry_username: string;
      default_registry_password: string;
      default_registry_email: string;
    }) => void,
  ) {
    const optionName = await Promise.all(options.map(async ([name, val]) => `${name} = ${val}`));
    test(optionName.join(" "), async () => {
      const { packageDir, packageJson } = await registry.createTestDir();

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
    const { packageDir, packageJson } = await registry.createTestDir();

    await Bun.$`rm -rf ${packageDir}/bunfig.toml`;

    const ini = /* ini */ `
registry = http://localhost:${registry.port}/
@needs-auth:registry=http://localhost:${registry.port}/
//localhost:${registry.port}/:_authToken=${await registry.generateUser("bilbo_swaggins", "verysecure")}
`;

    await Bun.$`echo ${ini} > ${packageDir}/.npmrc`;
    await Bun.$`echo ${JSON.stringify({
      name: "hi",
      main: "index.js",
      version: "1.0.0",
      dependencies: {
        "no-deps": "1.0.0",
        "@needs-auth/test-pkg": "1.0.0",
      },
      "publishConfig": {
        "registry": `http://localhost:${registry.port}`,
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
      const { packageDir, packageJson } = await registry.createTestDir();

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

      const ini = `
registry = http://localhost:${registry.port}/
${Object.keys(opts)
  .map(
    k =>
      `//localhost:${registry.port}/:${k}=${isBase64Encoded(k) && !opts[k].includes("${") ? Buffer.from(opts[k]).toString("base64") : opts[k]}`,
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
          "registry": `http://localhost:${registry.port}`,
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
    "_authToken": await registry.generateUser("bilbo_baggins", "verysecure"),
  }));
  registryConfigOptionTest(
    "_authToken with env variable value",
    async () => ({ _authToken: "${SUPER_SECRET_TOKEN}" }),
    async () => ({ SUPER_SECRET_TOKEN: await registry.generateUser("bilbo_baggins420", "verysecure") }),
  );
  registryConfigOptionTest("username and password", async () => {
    await registry.generateUser("gandalf429", "verysecure");
    return { username: "gandalf429", _password: "verysecure" };
  });
  registryConfigOptionTest(
    "username and password with env variable password",
    async () => {
      await registry.generateUser("gandalf422", "verysecure");
      return { username: "gandalf422", _password: "${SUPER_SECRET_PASSWORD}" };
    },
    {
      SUPER_SECRET_PASSWORD: Buffer.from("verysecure").toString("base64"),
    },
  );
  registryConfigOptionTest(
    "username and password with .env variable password",
    async () => {
      await registry.generateUser("gandalf421", "verysecure");
      return { username: "gandalf421", _password: "${SUPER_SECRET_PASSWORD}" };
    },
    {
      dotEnv: { SUPER_SECRET_PASSWORD: "verysecure" },
    },
  );

  registryConfigOptionTest("_auth", async () => {
    await registry.generateUser("linus", "verysecure");
    const _auth = "linus:verysecure";
    return { _auth };
  });

  registryConfigOptionTest(
    "_auth from .env variable",
    async () => {
      await registry.generateUser("zack", "verysecure");
      return { _auth: "${SECRET_AUTH}" };
    },
    {
      dotEnv: { SECRET_AUTH: "zack:verysecure" },
    },
  );

  registryConfigOptionTest(
    "_auth from .env variable with no value",
    async () => {
      await registry.generateUser("zack420", "verysecure");
      return { _auth: "${SECRET_AUTH}" };
    },
    {
      dotEnv: { SECRET_AUTH: "" },
    },
    (stdout: string, stderr: string) => {
      expect(stderr).toContain("supplies no credentials");
    },
  );

  test("empty _auth in the home .npmrc is diagnosed against a registry from the project .npmrc", async () => {
    using dir = tempDir("npmrc-empty-auth-two-files", {
      "home/.npmrc": `//somehost.com/:_auth=\n`,
      ".npmrc": `registry=http://somehost.com/\n`,
      "package.json": JSON.stringify({ name: "foo", version: "1.0.0" }),
    });
    const homeDir = join(String(dir), "home");

    await using proc = Bun.spawn({
      cmd: [bunExe(), "install", "--dry-run"],
      cwd: String(dir),
      env: { ...env, HOME: homeDir, XDG_CONFIG_HOME: homeDir },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toContain("supplies no credentials");
    expect(exitCode).toBe(0);
  });

  test("empty _auth that only matches a registry's path ancestor is not diagnosed", async () => {
    using dir = tempDir("npmrc-empty-auth-ancestor", {
      "home/.npmrc": `//somehost.com/:_auth=\n`,
      ".npmrc": `@myorg:registry=https://somehost.com/api/v4/packages/npm/\n`,
      "package.json": JSON.stringify({ name: "foo", version: "1.0.0" }),
    });
    const homeDir = join(String(dir), "home");

    await using proc = Bun.spawn({
      cmd: [bunExe(), "install", "--dry-run"],
      cwd: String(dir),
      env: { ...env, HOME: homeDir, XDG_CONFIG_HOME: homeDir },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).not.toContain("supplies no credentials");
    expect(exitCode).toBe(0);
  });

  await makeTest([["email", "user@example.com"]], result => {
    expect(result.default_registry_url).toEqual("https://registry.npmjs.org/");
    expect(result.default_registry_email).toEqual("user@example.com");
  });

  await makeTest(
    [
      ["username", "testuser"],
      ["_password", "testpass"],
      ["email", "test@example.com"],
    ],
    result => {
      expect(result.default_registry_url).toEqual("https://registry.npmjs.org/");
      expect(result.default_registry_username).toEqual("testuser");
      expect(result.default_registry_password).toEqual("testpass");
      expect(result.default_registry_email).toEqual("test@example.com");
    },
  );

  test("applies auth tokens to default registry correctly - same host different paths", () => {
    // Regression test for https://github.com/oven-sh/bun/issues/26350
    // When multiple auth tokens exist for the same host but different paths,
    // Bun should match the token by both host AND path, not just host.
    const ini = `
registry=https://somehost.com/org1/npm/registry/
//somehost.com/org1/npm/registry/:_authToken=jwt1
//somehost.com/org2/npm/registry/:_authToken=jwt2
//somehost.com/org3/npm/registry/:_authToken=jwt3
`;
    const result = loadNpmrc(ini);
    expect(result.default_registry_url).toEqual("https://somehost.com/org1/npm/registry/");
    expect(result.default_registry_token).toBe("jwt1");
  });

  test("auth token not applied when paths don't match - same host", () => {
    // Regression test for https://github.com/oven-sh/bun/issues/26350
    // When auth tokens exist for a different path on the same host,
    // they should not be applied to the default registry.
    const ini = `
registry=https://somehost.com/org1/npm/registry/
//somehost.com/org2/npm/registry/:_authToken=jwt2
`;
    const result = loadNpmrc(ini);
    expect(result.default_registry_url).toEqual("https://somehost.com/org1/npm/registry/");
    // Should be empty since there's no matching token for /org1/npm/registry/
    expect(result.default_registry_token).toBe("");
  });

  describe("default registry resolves auth by path-segment ancestor", () => {
    // https://github.com/oven-sh/bun/issues/30311
    test("host-root auth applies to a deep default registry", () => {
      const result = loadNpmrc(`
registry=https://somehost.com/org1/npm/registry/
//somehost.com/:_authToken=root
`);
      expect(result.default_registry_url).toEqual("https://somehost.com/org1/npm/registry/");
      expect(result.default_registry_token).toBe("root");
    });

    test("mid-path ancestor auth applies to a deep default registry", () => {
      const result = loadNpmrc(`
registry=https://somehost.com/org1/npm/registry/
//somehost.com/org1/:_authToken=mid
`);
      expect(result.default_registry_token).toBe("mid");
    });

    test.each([
      [
        "shallow first",
        `
registry=https://somehost.com/org1/npm/registry/
//somehost.com/:_authToken=root
//somehost.com/org1/:_authToken=mid
//somehost.com/org1/npm/registry/:_authToken=exact
`,
      ],
      [
        "deep first",
        `
registry=https://somehost.com/org1/npm/registry/
//somehost.com/org1/npm/registry/:_authToken=exact
//somehost.com/org1/:_authToken=mid
//somehost.com/:_authToken=root
`,
      ],
    ])("longest matching ancestor wins (%s)", (_name, ini) => {
      expect(loadNpmrc(ini).default_registry_token).toBe("exact");
    });

    test.each([
      ["trailing slash", "//somehost.com/api/v4/projects/12/:_authToken=attacker"],
      ["no trailing slash", "//somehost.com/api/v4/projects/12:_authToken=attacker"],
    ])("a path prefix that is not a segment ancestor never matches (%s)", (_name, line) => {
      const result = loadNpmrc(`
registry=https://somehost.com/api/v4/projects/123/packages/npm/
${line}
`);
      expect(result.default_registry_url).toEqual("https://somehost.com/api/v4/projects/123/packages/npm/");
      expect(result.default_registry_token).toBe("");
    });

    test("host-root _auth applies to a deep default registry", () => {
      const result = loadNpmrc(`
registry=https://somehost.com/org1/npm/registry/
//somehost.com/:_auth=${Buffer.from("bilbo:verysecure").toString("base64")}
`);
      // `_auth` is forwarded verbatim; the config layer never decodes it into
      // username/password (whoami derives the username in `Scope::from_api`).
      expect(result.default_registry_auth).toBe(Buffer.from("bilbo:verysecure").toString("base64"));
      expect(result.default_registry_username).toBe("");
      expect(result.default_registry_password).toBe("");
    });

    test("host-root username + _password apply to a deep default registry", () => {
      const result = loadNpmrc(`
registry=https://somehost.com/org1/npm/registry/
//somehost.com/:username=bilbo
//somehost.com/:_password=${Buffer.from("verysecure").toString("base64")}
`);
      expect(result.default_registry_username).toBe("bilbo");
      expect(result.default_registry_password).toBe("verysecure");
    });

    // `email` is not part of npm's auth (`npm-registry-fetch`'s `getAuth` never reads
    // it), so it does not walk: only a line naming the registry's own path applies.
    test("an ancestor's email does not apply to a deeper registry", () => {
      const result = loadNpmrc(`
registry=https://somehost.com/org1/npm/registry/
//somehost.com/:email=bilbo@example.com
`);
      expect(result.default_registry_email).toBe("");
    });

    test("the registry's own email applies", () => {
      const result = loadNpmrc(`
registry=https://somehost.com/org1/npm/registry/
//somehost.com/:email=gandalf@example.com
//somehost.com/org1/npm/registry/:email=bilbo@example.com
`);
      expect(result.default_registry_email).toBe("bilbo@example.com");
    });
  });

  describe("credentials that did not come from .npmrc survive resolution", () => {
    test("an invalid _auth does not discard the registry URL's token", () => {
      const result = loadNpmrc(`
registry=https://:TOK@somehost.com/
//somehost.com/:_auth=not-valid-base64
`);
      expect(result.default_registry_token).toBe("TOK");
    });

    test("an .npmrc username/_password does not discard the registry URL's token", () => {
      const result = loadNpmrc(`
registry=https://:TOK@somehost.com/
//somehost.com/:username=gandalf
//somehost.com/:_password=${Buffer.from("verysecure").toString("base64")}
`);
      expect(result.default_registry_token).toBe("TOK");
      expect(result.default_registry_username).toBe("gandalf");
      expect(result.default_registry_password).toBe("verysecure");
    });
  });

  test("an empty _auth for an ancestor path of a registry is not an error", async () => {
    using server = Bun.serve({ port: 0, fetch: () => new Response("{}") });
    const host = `127.0.0.1:${server.port}`;
    using dir = tempDir("npmrc-empty-auth-ancestor-2", {
      "package.json": JSON.stringify({ name: "foo", version: "1.0.0" }),
      ".npmrc": `@myorg:registry=http://${host}/deep/\n//${host}/:_auth=\n`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "install", "--no-save"],
      cwd: String(dir),
      env,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).not.toContain("supplies no credentials");
    expect({ stdout, stderr, exitCode }).toMatchObject({ exitCode: 0 });
  });

  test("an empty _auth naming a registry's own path is still an error", async () => {
    using server = Bun.serve({ port: 0, fetch: () => new Response("{}") });
    const host = `127.0.0.1:${server.port}`;
    using dir = tempDir("npmrc-empty-auth-exact", {
      "package.json": JSON.stringify({ name: "foo", version: "1.0.0" }),
      ".npmrc": `@myorg:registry=http://${host}/deep/\n//${host}/deep/:_auth=\n`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "install", "--no-save"],
      cwd: String(dir),
      env,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toContain("supplies no credentials");
    expect(exitCode).toBe(0);
  });

  // `Scope::from_api` decodes `_auth` solely to derive the identity `bun pm whoami`
  // prints; the credential itself is always forwarded verbatim.
  describe("bun pm whoami derives the username from _auth", () => {
    async function whoamiWith(files: Record<string, string>) {
      using dir = tempDir("npmrc-whoami-auth", {
        "home/.gitkeep": "",
        "package.json": JSON.stringify({ name: "foo", version: "1.0.0" }),
        ...files,
      });
      const homeDir = join(String(dir), "home");

      await using proc = Bun.spawn({
        cmd: [bunExe(), "pm", "whoami"],
        cwd: String(dir),
        env: { ...env, HOME: homeDir, USERPROFILE: homeDir, XDG_CONFIG_HOME: homeDir },
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stdout, stderr, exitCode };
    }

    function whoami(authValue: string) {
      return whoamiWith({
        ".npmrc": `registry=https://somehost.com/\n//somehost.com/:_auth=${authValue}\n`,
      });
    }

    test("a decodable _auth prints its username", async () => {
      const { stdout, exitCode } = await whoami(Buffer.from("alice:s3cret").toString("base64"));
      expect(stdout).toBe("alice\n");
      expect(exitCode).toBe(0);
    });

    test("a non-decodable _auth carries no identity", async () => {
      const { stdout, stderr, exitCode } = await whoami("!!not-base64!!");
      expect(stdout).toBe("");
      expect(stderr).toContain("missing authentication");
      expect(exitCode).toBe(1);
    });

    test("an _auth with a blank username carries no identity", async () => {
      const { stdout, stderr, exitCode } = await whoami(Buffer.from(":s3cret").toString("base64"));
      expect(stdout).toBe("");
      expect(stderr).toContain("missing authentication");
      expect(exitCode).toBe(1);
    });

    test("an _auth with a blank password carries no identity", async () => {
      const { stdout, stderr, exitCode } = await whoami(Buffer.from("tok:").toString("base64"));
      expect(stdout).toBe("");
      expect(stderr).toContain("missing authentication");
      expect(exitCode).toBe(1);
    });

    // The wire sends `Basic <_auth>` here (auth beats username+password), so whoami
    // must not report the bunfig username — an identity from a credential never sent.
    test.each([
      ["opaque", "!!not-base64!!"],
      ["blank-password", Buffer.from("tok:").toString("base64")],
    ])("bunfig username/password does not leak an identity past _auth (%s)", async (_name, authValue) => {
      const { stdout, stderr, exitCode } = await whoamiWith({
        "bunfig.toml": `[install.registry]\nurl = "https://somehost.com/"\nusername = "bunfig-user"\npassword = "bunfig-pass"\n`,
        ".npmrc": `//somehost.com/:_auth=${authValue}\n`,
      });
      expect(stdout).toBe("");
      expect(stderr).toContain("missing authentication");
      expect(exitCode).toBe(1);
    });
  });
});

describe("scoped registry routing", () => {
  // A request for a @scope package must be sent only to that scope's configured
  // registry with that scope's token. The registry map was keyed by a bare
  // Wyhash11 hash of the scope name, so a different scope whose name hashed to
  // the same value would overwrite it and silently inherit its registry + token.
  // https://github.com/oven-sh/bun/issues/32741
  test("does not route to a hash-colliding scope's registry or token", async () => {
    // scopeA and scopeB collide under Bun's internal scope-name hash
    // (Wyhash11(0) == 0xd2c80616f46b9bf2) but are distinct strings.
    const scopeA = "cuxk74rj1jlebf5o-cigmevrqk5-74swpkgcollapkgcollbaaaaaaaa8k0b-p2s";
    const scopeB = "cuxk74rj1jlebf5o-cigmevrqk5-74swpkgcollapkgcollbbbbbbbbb8k0b-p2s";

    type Req = { path: string; auth: string | null };
    const reqsA: Req[] = [];
    const reqsB: Req[] = [];
    const notFound = () =>
      new Response(JSON.stringify({ error: "not found" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });

    await using serverA = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req) {
        reqsA.push({ path: new URL(req.url).pathname, auth: req.headers.get("authorization") });
        return notFound();
      },
    });
    await using serverB = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req) {
        reqsB.push({ path: new URL(req.url).pathname, auth: req.headers.get("authorization") });
        return notFound();
      },
    });

    const portA = serverA.port;
    const portB = serverB.port;
    const urlA = `http://127.0.0.1:${portA}/`;
    const urlB = `http://127.0.0.1:${portB}/`;

    // scopeA is declared first, so scopeB's colliding entry overwrites it in the
    // hash-keyed registry map. The default registry also points at A so that a
    // correct fallback stays offline instead of reaching the public registry.
    using dir = tempDir("npmrc-scope-collision", {
      ".npmrc":
        `registry=${urlA}\n` +
        `@${scopeA}:registry=${urlA}\n` +
        `//127.0.0.1:${portA}/:_authToken=scope-A-SECRET-token\n` +
        `@${scopeB}:registry=${urlB}\n` +
        `//127.0.0.1:${portB}/:_authToken=scope-B-SECRET-token\n`,
      "package.json": JSON.stringify({
        name: "victim",
        version: "0.0.0",
        dependencies: { [`@${scopeA}/probe`]: "^1.0.0" },
      }),
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "install", "--no-cache"],
      cwd: String(dir),
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    // The install fails (probe does not exist); we only care where it asked.
    const [, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(exitCode).not.toBe(0);

    // scopeB's registry must never see the @scopeA/probe request, and must
    // never be handed scopeB's secret token for it.
    expect(reqsB).toEqual([]);
    // The request must have been attempted against scopeA's own registry.
    expect(reqsA.some(r => r.path.includes("probe"))).toBe(true);
  });

  // npm keys on a WHATWG URL's `host`, which is lowercased and drops a default port.
  // The config key's path stays case-sensitive; only its authority is folded.
});

describe("the config key's authority is normalized like a WHATWG URL", () => {
  const token = (ini: string) => loadNpmrc(ini).default_registry_token;

  it("matches a lowercase key against an uppercase registry host", () => {
    expect(token(`registry=https://Registry.Example.COM/api/\n//registry.example.com/:_authToken=T\n`)).toBe("T");
  });

  // npm compares config keys literally, and its own `nerfDart` lowercases the keys it
  // writes, so a hand-written uppercase host applies to nothing. Matched, plus a warning.
  it("does not match an uppercase key, even against an uppercase registry host", () => {
    expect(token(`registry=https://Registry.Example.COM/api/\n//Registry.Example.COM/:_authToken=T\n`)).toBe("");
  });

  it("keeps the key's path case-sensitive", () => {
    expect(token(`registry=https://example.com/API/\n//example.com/api/:_authToken=T\n`)).toBe("");
  });

  it("drops a default https port from the registry host", () => {
    expect(token(`registry=https://example.com:443/api/\n//example.com/:_authToken=T\n`)).toBe("T");
  });

  it("drops a default http port from the registry host", () => {
    expect(token(`registry=http://example.com:80/api/\n//example.com/:_authToken=T\n`)).toBe("T");
  });

  it("keeps a non-default port in the registry host", () => {
    expect(token(`registry=https://example.com:8443/api/\n//example.com:8443/:_authToken=T\n`)).toBe("T");
    expect(token(`registry=https://example.com:8443/api/\n//example.com/:_authToken=T\n`)).toBe("");
  });

  it("drops a default port from an uppercase scheme too", () => {
    expect(token(`registry=HTTPS://example.com:443/api/\n//example.com/:_authToken=T\n`)).toBe("T");
  });

  // npm's key never spells out a default port, so neither does ours: a key written
  // as `//host:443/` matches nothing. Released Bun matched it.
  it("does not match a key that spells out the default port", () => {
    expect(token(`registry=https://example.com:443/api/\n//example.com:443/:_authToken=T\n`)).toBe("");
  });
});

// A key that would have matched but for its host's case is almost always a mistake.
// Dropping the credential silently is how #30311 went unnoticed, so say something —
// without echoing the secret into the log.
describe("a config key that differs from the registry only by host case", () => {
  async function stderrOf(npmrc: string) {
    using dir = tempDir("npmrc-case-warning", {
      ".npmrc": npmrc,
      "package.json": JSON.stringify({ name: "x", version: "1.0.0" }),
      "home/.gitkeep": "",
    });
    const home = join(String(dir), "home");
    await using proc = Bun.spawn({
      cmd: [bunExe(), "install", "--no-cache"],
      cwd: String(dir),
      env: { ...env, HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: home },
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
    });
    const [, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return stderr;
  }

  it("warns, and redacts the credential", async () => {
    const stderr = await stderrOf(
      `registry=https://Registry.Example.COM/api/\n//Registry.Example.COM/:_authToken=SECRETTOKEN\n`,
    );
    expect(stderr).toContain('the .npmrc key "//Registry.Example.COM/" matches no registry');
    expect(stderr).toContain('npm writes this key as "//registry.example.com/"');
    expect(stderr).not.toContain("SECRETTOKEN");
  });

  it("says nothing when the key already matches", async () => {
    const stderr = await stderrOf(
      `registry=https://Registry.Example.COM/api/\n//registry.example.com/:_authToken=SECRETTOKEN\n`,
    );
    expect(stderr).not.toContain("matches no registry");
  });

  it("says nothing about an uppercase key for an unrelated host", async () => {
    const stderr = await stderrOf(`registry=https://example.com/api/\n//Other.Example.COM/:_authToken=X\n`);
    expect(stderr).not.toContain("matches no registry");
  });

  it("warns about a key that spells out the default port", async () => {
    const stderr = await stderrOf(`registry=https://example.com/api/\n//example.com:443/:_authToken=SECRETTOKEN\n`);
    expect(stderr).toContain('the .npmrc key "//example.com:443/" matches no registry');
    expect(stderr).toContain('npm writes this key as "//example.com/"');
    expect(stderr).not.toContain("SECRETTOKEN");
  });

  it("says nothing about a non-default port spelled out", async () => {
    const stderr = await stderrOf(`registry=https://example.com:8443/api/\n//example.com:8443/:_authToken=S\n`);
    expect(stderr).not.toContain("matches no registry");
  });

  // The warning promises that respelling the key changes something. These are the shapes
  // where it would not, so it must stay quiet or the advice is a lie.
  it("says nothing when a deeper lowercase key already wins", async () => {
    const stderr = await stderrOf(
      `registry=https://example.com/api/\n//example.com/api/:_authToken=GOOD\n//Example.COM/:_authToken=BAD\n`,
    );
    expect(stderr).not.toContain("matches no registry");
  });

  it("says nothing about an ancestor email, which never walks", async () => {
    const stderr = await stderrOf(`registry=https://example.com/api/\n//Example.COM/:email=me@x.com\n`);
    expect(stderr).not.toContain("matches no registry");
  });

  it("says nothing about an ancestor's lone username, which never applies", async () => {
    const stderr = await stderrOf(`registry=https://example.com/api/\n//Example.COM/:username=bob\n`);
    expect(stderr).not.toContain("matches no registry");
  });

  it("says nothing about an empty value", async () => {
    const stderr = await stderrOf(`registry=https://example.com/api/\n//Example.COM/:_authToken=\n`);
    expect(stderr).not.toContain("matches no registry");
  });

  it("says nothing when the path case differs, since paths are case-sensitive", async () => {
    const stderr = await stderrOf(`registry=https://example.com/api/\n//example.com/API/:_authToken=X\n`);
    expect(stderr).not.toContain("matches no registry");
  });

  // A default port is a property of the scheme, so a key is only dead if it supplies
  // nothing to EVERY registry. `:443` is not http's default port.
  it("says nothing about a :443 key that is legitimate for an http registry", async () => {
    const npmrc =
      `registry=http://example.com:443/api/\n` +
      `@s:registry=https://example.com/api/\n` +
      `//example.com:443/api/:_authToken=SECRETTOKEN\n`;
    expect(await stderrOf(npmrc)).not.toContain("matches no registry");
    expect(loadNpmrc(npmrc).default_registry_token).toBe("SECRETTOKEN");
  });

  // Respelling only matters when it would change which credential is chosen. `lookup`
  // takes the last duplicate, so an uppercase twin is only live when it comes last.
  it("says nothing about an uppercase twin that a lowercase key already outranks", async () => {
    const stderr = await stderrOf(
      `registry=https://example.com/\n//Example.COM/:_authToken=A\n//example.com/:_authToken=B\n`,
    );
    expect(stderr).not.toContain("matches no registry");
  });

  // A credential can be arbitrary bytes. `bun pm view` panicked on non-UTF-8 (lossy
  // Display expanded U+FFFD past the reserved byte count) until the header append went
  // raw. A JS `\xff` escape lands as valid UTF-8, so the bytes are written raw here.
  for (const opt of ["_auth", "_authToken"]) {
    it(`a non-UTF-8 ${opt} does not panic bun pm view`, async () => {
      using dir = tempDir("npmrc-raw-bytes", {
        "package.json": JSON.stringify({ name: "x", version: "1.0.0" }),
        "home/.gitkeep": "",
      });
      const prefix = Buffer.from(`registry=https://example.com/\n//example.com/:${opt}=`);
      await write(join(String(dir), ".npmrc"), Buffer.concat([prefix, Buffer.from([0xff, 0xfe, 0xfd, 0x0a])]));
      const home = join(String(dir), "home");
      await using proc = Bun.spawn({
        cmd: [bunExe(), "pm", "view", "left-pad"],
        cwd: String(dir),
        env: { ...env, HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: home },
        stdout: "pipe",
        stderr: "pipe",
        stdin: "ignore",
      });
      const [, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).not.toContain("panic");
      expect(stderr).not.toContain("invalid _auth");
    });
  }

  it("warns about an uppercase twin that would outrank the lowercase key", async () => {
    const stderr = await stderrOf(
      `registry=https://example.com/\n//example.com/:_authToken=B\n//Example.COM/:_authToken=A\n`,
    );
    expect(stderr).toContain('the .npmrc key "//Example.COM/" matches no registry');
    expect(stderr).toContain('npm writes this key as "//example.com/"');
  });
});
