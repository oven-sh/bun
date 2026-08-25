import { write } from "bun";
import { afterAll, beforeAll, describe, expect, it, test } from "bun:test";
import { rm } from "fs/promises";
import { VerdaccioRegistry, bunExe, bunEnv as env, isIPv6, tempDir } from "harness";
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
    const err = await stderr.text();
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

  describe("user .npmrc lookup", () => {
    const npmrc = (port: number) => `registry=http://localhost:${port}/\n//localhost:${port}/:_authToken=token\n`;
    const pkg = { "pkg/package.json": JSON.stringify({ name: "npmrc-lookup", version: "0.0.1" }) };

    // `publish --dry-run` never contacts the registry, but it still requires a token
    // for it and prints which registry it picked up, so it shows which .npmrc was read.
    // bunEnv spreads process.env and CI runners commonly export XDG_CONFIG_HOME, so it
    // is removed here and each case passes back exactly the value it is testing.
    async function publishDryRun(dir: string, envOverride: Record<string, string>) {
      const spawnEnv = { ...env, HOME: join(dir, "home"), USERPROFILE: join(dir, "home") };
      delete spawnEnv.XDG_CONFIG_HOME;

      await using proc = Bun.spawn({
        cmd: [bunExe(), "publish", "--dry-run"],
        cwd: join(dir, "pkg"),
        env: { ...spawnEnv, ...envOverride },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stdout, stderr, exitCode };
    }

    const usesRegistry = (port: number) => ({
      stdout: expect.stringContaining(`Registry: http://localhost:${port}/\n`),
      stderr: expect.not.stringContaining("missing authentication"),
      exitCode: 0,
    });

    it.concurrent("uses $XDG_CONFIG_HOME/.npmrc when it exists", async () => {
      using dir = tempDir("npmrc-xdg", { ...pkg, "home/.npmrc": npmrc(1), "xdg/.npmrc": npmrc(2) });
      const result = await publishDryRun(String(dir), { XDG_CONFIG_HOME: join(String(dir), "xdg") });
      expect(result).toEqual(usesRegistry(2));
    });

    // https://github.com/oven-sh/bun/issues/24124: GitHub Actions exports
    // XDG_CONFIG_HOME=~/.config, while `npm login` writes ~/.npmrc.
    it.concurrent("falls back to $HOME/.npmrc when $XDG_CONFIG_HOME has no .npmrc", async () => {
      using dir = tempDir("npmrc-xdg-without-npmrc", { ...pkg, "home/.npmrc": npmrc(1), "xdg/.keep": "" });
      const result = await publishDryRun(String(dir), { XDG_CONFIG_HOME: join(String(dir), "xdg") });
      expect(result).toEqual(usesRegistry(1));
    });

    it.concurrent("uses $HOME/.npmrc when $XDG_CONFIG_HOME is unset", async () => {
      using dir = tempDir("npmrc-xdg-unset", { ...pkg, "home/.npmrc": npmrc(1) });
      const result = await publishDryRun(String(dir), {});
      expect(result).toEqual(usesRegistry(1));
    });

    it.concurrent("uses $HOME/.npmrc when $XDG_CONFIG_HOME is empty", async () => {
      using dir = tempDir("npmrc-xdg-empty", { ...pkg, "home/.npmrc": npmrc(1) });
      const result = await publishDryRun(String(dir), { XDG_CONFIG_HOME: "" });
      expect(result).toEqual(usesRegistry(1));
    });
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

  describe("empty _auth across the home and project .npmrc", () => {
    const blob = Buffer.from("alice:s3cret").toString("base64");

    // Returns whether the empty-`_auth` diagnostic was printed; the install itself
    // must still succeed either way.
    async function diagnosed(homeNpmrc: string, projectNpmrc: string) {
      using dir = tempDir("npmrc-empty-auth-two-files", {
        "home/.npmrc": homeNpmrc,
        ".npmrc": projectNpmrc,
        "package.json": JSON.stringify({ name: "foo", version: "1.0.0" }),
      });
      const homeDir = join(String(dir), "home");

      await using proc = Bun.spawn({
        cmd: [bunExe(), "install", "--dry-run"],
        cwd: String(dir),
        env: { ...env, HOME: homeDir, USERPROFILE: homeDir, XDG_CONFIG_HOME: homeDir },
        stdout: "pipe",
        stderr: "pipe",
      });

      const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(exitCode).toBe(0);
      return stderr.includes("supplies no credentials");
    }

    test("a home line is diagnosed against a registry the project declares", async () => {
      expect(await diagnosed(`//somehost.com/:_auth=\n`, `registry=http://somehost.com/\n`)).toBe(true);
    });

    test("a line that only matches a registry's path ancestor is not diagnosed", async () => {
      expect(
        await diagnosed(`//somehost.com/:_auth=\n`, `@myorg:registry=https://somehost.com/api/v4/packages/npm/\n`),
      ).toBe(false);
    });

    // The key collapses to the project's value, so the home line supplies nothing
    // either way and the credential is sent.
    test("a home line the project overrides with a value is not diagnosed", async () => {
      expect(
        await diagnosed(`//somehost.com/:_auth=\n`, `registry=http://somehost.com/\n//somehost.com/:_auth=${blob}\n`),
      ).toBe(false);
    });

    test("a project line that clears the home file's value is diagnosed", async () => {
      expect(
        await diagnosed(`//somehost.com/:_auth=${blob}\n`, `registry=http://somehost.com/\n//somehost.com/:_auth=\n`),
      ).toBe(true);
    });
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

  describe("credentials keyed to a bracketed IPv6 host", () => {
    // Config keys are matched literally against the keys walked up from the registry
    // URL, so the bracketed authority only has to survive the registry side's parse.
    test.each([
      ["loopback with a port", "http://[::1]:4873/", "//[::1]:4873/"],
      ["loopback without a port", "http://[::1]/", "//[::1]/"],
      ["full address with a path", "http://[2001:db8::1]:4873/npm/registry/", "//[2001:db8::1]:4873/npm/registry/"],
      ["key without the trailing slash", "http://[::1]:4873/", "//[::1]:4873"],
      ["host-root key for a registry under a path", "http://[::1]:4873/npm/registry/", "//[::1]:4873/"],
      // The address ends in the scheme's default port digits; they are not a port.
      ["address whose last group spells the default port", "http://[::80]/", "//[::80]/"],
    ])("_authToken is applied: %s", (_, registryUrl, key) => {
      const result = loadNpmrc(`registry=${registryUrl}\n${key}:_authToken=v6-token\n`);
      expect(result).toEqual({
        default_registry_url: registryUrl,
        default_registry_token: "v6-token",
        default_registry_username: "",
        default_registry_password: "",
        default_registry_email: "",
        default_registry_auth: "",
      });
    });

    test("username, _password and _auth are applied", () => {
      const password = Buffer.from("v6-password").toString("base64");
      expect(
        loadNpmrc(`registry=http://[::1]:4873/\n//[::1]:4873/:username=v6-user\n//[::1]:4873/:_password=${password}\n`),
      ).toEqual({
        default_registry_url: "http://[::1]:4873/",
        default_registry_token: "",
        default_registry_username: "v6-user",
        default_registry_password: "v6-password",
        default_registry_email: "",
        default_registry_auth: "",
      });

      const auth = Buffer.from("v6-user:v6-password").toString("base64");
      expect(loadNpmrc(`registry=http://[::1]:4873/\n//[::1]:4873/:_auth=${auth}\n`)).toEqual({
        default_registry_url: "http://[::1]:4873/",
        default_registry_token: "",
        default_registry_username: "",
        default_registry_password: "",
        default_registry_email: "",
        default_registry_auth: auth,
      });
    });

    test.each([
      ["a different port", "//[::1]:4874/"],
      ["a different address", "//[::2]:4873/"],
      ["a different path", "//[::1]:4873/other/"],
    ])("a key for %s is not applied", (_, key) => {
      const result = loadNpmrc(`registry=http://[::1]:4873/\n${key}:_authToken=v6-token\n`);
      expect(result.default_registry_url).toBe("http://[::1]:4873/");
      expect(result.default_registry_token).toBe("");
    });
  });

  // `$npm_config_registry` pointing at the host `.npmrc` already configured rebuilds the
  // scope; the `.npmrc` `_auth` must survive that the way `_authToken` does.
  test("an env registry on the same host keeps the .npmrc _auth", async () => {
    const blob = Buffer.from("alice:hunter2").toString("base64");
    const authorizations: (string | null)[] = [];
    await using registry = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req) {
        authorizations.push(req.headers.get("authorization"));
        return Response.json({
          name: "pkg",
          "dist-tags": { latest: "1.0.0" },
          versions: { "1.0.0": { name: "pkg", version: "1.0.0" } },
        });
      },
    });
    const host = `127.0.0.1:${registry.port}`;
    using dir = tempDir("npmrc-env-registry-auth", {
      "home/.gitkeep": "",
      "package.json": JSON.stringify({ name: "probe", version: "0.0.0" }),
      ".npmrc": `registry=http://${host}/\n//${host}/:_auth=${blob}\n`,
    });
    const homeDir = join(String(dir), "home");
    await using proc = Bun.spawn({
      cmd: [bunExe(), "pm", "view", "pkg", "version"],
      cwd: String(dir),
      env: {
        ...env,
        HOME: homeDir,
        USERPROFILE: homeDir,
        XDG_CONFIG_HOME: homeDir,
        npm_config_registry: `http://${host}/`,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ authorizations, stdout }).toEqual({ authorizations: [`Basic ${blob}`], stdout: "1.0.0\n" });
    expect(exitCode).toBe(0);
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
      "home/.gitkeep": "",
    });
    const home = join(String(dir), "home");

    await using proc = Bun.spawn({
      cmd: [bunExe(), "install", "--no-save"],
      cwd: String(dir),
      env: { ...env, HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: home },
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
      "home/.gitkeep": "",
    });
    const home = join(String(dir), "home");

    await using proc = Bun.spawn({
      cmd: [bunExe(), "install", "--no-save"],
      cwd: String(dir),
      env: { ...env, HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: home },
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
        ".npmrc": `registry=https://registry.invalid/\n//registry.invalid/:_auth=${authValue}\n`,
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

    // The wire sends `Basic <_auth>` here (auth beats the username + password the
    // registry URL's userinfo stored), so whoami must not report that username: it
    // would be an identity from a credential never sent.
    test.each([
      ["opaque", "!!not-base64!!"],
      ["blank-password", Buffer.from("tok:").toString("base64")],
    ])("the registry URL's username/password do not leak an identity past _auth (%s)", async (_name, authValue) => {
      const { stdout, stderr, exitCode } = await whoamiWith({
        ".npmrc": `registry=https://url-user:url-pass@registry.invalid/\n//registry.invalid/:_auth=${authValue}\n`,
      });
      expect(stdout).toBe("");
      expect(stderr).toContain("missing authentication");
      expect(exitCode).toBe(1);
    });

    // Credentials declared in bunfig.toml beat every .npmrc line for that registry,
    // so whoami reports the bunfig identity and the _auth line is never consulted.
    test("bunfig.toml username/password are the identity when bunfig declares the registry", async () => {
      const { stdout, exitCode } = await whoamiWith({
        "bunfig.toml": `[install.registry]\nurl = "https://registry.invalid/"\nusername = "bunfig-user"\npassword = "bunfig-pass"\n`,
        ".npmrc": `//registry.invalid/:_auth=!!not-base64!!\n`,
      });
      expect(stdout).toBe("bunfig-user\n");
      expect(exitCode).toBe(0);
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
});

// npm keys on a WHATWG URL's `host`, which is lowercased and drops a default port.
// The config key's path stays case-sensitive; only its authority is folded.
describe("the config key's authority is normalized like a WHATWG URL", () => {
  const token = (ini: string) => loadNpmrc(ini).default_registry_token;

  it("matches a lowercase key against an uppercase registry host", () => {
    expect(token(`registry=https://Registry.Example.COM/api/\n//registry.example.com/:_authToken=T\n`)).toBe("T");
  });

  // npm's `nerfDart` lowercases the keys it writes; a hand-written key is folded the
  // same way when read, so an uppercase host still applies.
  it("lowercases the key's host, so an uppercase key matches", () => {
    expect(token(`registry=https://Registry.Example.COM/api/\n//Registry.Example.COM/:_authToken=T\n`)).toBe("T");
    expect(token(`registry=https://registry.example.com/api/\n//Registry.Example.COM/:_authToken=T\n`)).toBe("T");
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

  // npm's key never spells out a default port; a hand-written `:443` is dropped when
  // read, so the key still matches (released Bun matched it too).
  it("drops :443 from a key, so it matches an https registry", () => {
    expect(token(`registry=https://example.com:443/api/\n//example.com:443/:_authToken=T\n`)).toBe("T");
    expect(token(`registry=https://example.com/api/\n//example.com:443/:_authToken=T\n`)).toBe("T");
  });

  // Bun's docs long showed keys with a scheme (`//http://localhost:4873/:_authToken=`);
  // npm never writes one. The scheme is dropped when read, and names the default port.
  it("drops a leading scheme from a key", () => {
    expect(token(`registry=http://localhost:4873/\n//http://localhost:4873/:_authToken=T\n`)).toBe("T");
    expect(token(`registry=https://example.com/api/\n//https://example.com/:_authToken=T\n`)).toBe("T");
    expect(token(`registry=http://example.com/api/\n//http://example.com:80/:_authToken=T\n`)).toBe("T");
    expect(token(`registry=http://example.com/api/\n//HTTP://Example.COM/:_authToken=T\n`)).toBe("T");
  });

  it("drops a default port after a bracketed IPv6 host, not inside it", () => {
    expect(token(`registry=https://[::1]/\n//[::1]:443/:_authToken=T\n`)).toBe("T");
    expect(token(`registry=http://[::80]/\n//[::80]/:_authToken=T\n`)).toBe("T");
  });

  // The option name must end the key. `_authtoken` (lowercase t) used to match `_auth`
  // as a substring and go out as `Basic <token>`; now it is an unknown option.
  it("does not read a misspelt option as a shorter one it contains", () => {
    expect(token(`registry=https://example.com/\n//example.com/:_authtoken=T\n`)).toBe("");
    expect(loadNpmrc(`registry=https://example.com/\n//example.com/:_authtoken=T\n`).default_registry_auth).toBe("");
  });
});

// Diagnostics printed while reading .npmrc must never echo a credential.
describe(".npmrc diagnostics", () => {
  async function stderrOf(npmrc: string, bunfig?: object) {
    using dir = tempDir("npmrc-diagnostics", {
      ".npmrc": npmrc,
      "package.json": JSON.stringify({ name: "x", version: "1.0.0" }),
      "home/.gitkeep": "",
      ...(bunfig ? { "bunfig.toml": Bun.TOML.stringify(bunfig) } : {}),
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

  it("warns about an unknown option name without printing its value", async () => {
    const stderr = await stderrOf(`registry=https://example.com/\n//example.com/:_authtoken=SECRETTOKEN\n`);
    expect(stderr).toContain("_authtoken is not a known .npmrc option");
    expect(stderr).not.toContain("SECRETTOKEN");
  });

  it("says nothing about a key that matches once normalized", async () => {
    const stderr = await stderrOf(`registry=https://example.com/api/\n//Example.COM:443/:_authToken=SECRETTOKEN\n`);
    expect(stderr).toBe("No packages! Deleted empty lockfile\n");
  });

  it("an empty _auth naming a bunfig.toml scope is an error", async () => {
    const stderr = await stderrOf(`//example.com/api/:_auth=\n`, {
      install: { scopes: { myorg: { url: "https://example.com/api/" } } },
    });
    expect(stderr).toContain("empty _auth value");
  });

  // A credential can be arbitrary bytes. `bun pm view` panicked on non-UTF-8 (lossy
  // Display expanded U+FFFD past the reserved byte count) until the header append went
  // raw. A JS `\xff` escape lands as valid UTF-8, so the bytes are written raw here.
  for (const [opt, scheme] of [
    ["_auth", "Basic"],
    ["_authToken", "Bearer"],
  ] as const) {
    it(`a non-UTF-8 ${opt} reaches the registry verbatim from bun pm view`, async () => {
      const seen: Buffer[] = [];
      await using registry = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        fetch(req) {
          seen.push(Buffer.from(req.headers.get("authorization") ?? "", "binary"));
          return Response.json({
            "name": "pkg",
            "dist-tags": { latest: "1.0.0" },
            "versions": { "1.0.0": { name: "pkg", version: "1.0.0" } },
          });
        },
      });
      const host = `127.0.0.1:${registry.port}`;
      using dir = tempDir("npmrc-raw-bytes", {
        "package.json": JSON.stringify({ name: "x", version: "1.0.0" }),
        "home/.gitkeep": "",
      });
      const prefix = Buffer.from(`registry=http://${host}/\n//${host}/:${opt}=`);
      await write(join(String(dir), ".npmrc"), Buffer.concat([prefix, Buffer.from([0xff, 0xfe, 0xfd, 0x0a])]));
      const home = join(String(dir), "home");
      await using proc = Bun.spawn({
        cmd: [bunExe(), "pm", "view", "pkg", "version"],
        cwd: String(dir),
        env: { ...env, HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: home },
        stdout: "pipe",
        stderr: "pipe",
        stdin: "ignore",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(seen).toEqual([Buffer.concat([Buffer.from(`${scheme} `), Buffer.from([0xff, 0xfe, 0xfd])])]);
      expect(stderr).not.toContain("invalid _auth");
      expect({ stdout, exitCode, signalCode: proc.signalCode }).toEqual({
        stdout: "1.0.0\n",
        exitCode: 0,
        signalCode: null,
      });
    });
  }
});

describe("--registry override", () => {
  test("does not send the token configured for the previous registry host to the --registry host", async () => {
    const tgz = join(import.meta.dir, "registry", "packages", "no-deps", "no-deps-1.0.0.tgz");

    type Req = { path: string; auth: string | null };
    const reqsA: Req[] = [];
    const reqsB: Req[] = [];

    await using serverA = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req) {
        reqsA.push({ path: new URL(req.url).pathname, auth: req.headers.get("authorization") });
        return new Response("not found", { status: 404 });
      },
    });
    await using serverB = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req) {
        const url = new URL(req.url);
        reqsB.push({ path: url.pathname, auth: req.headers.get("authorization") });
        if (url.pathname.endsWith(".tgz")) return new Response(Bun.file(tgz));
        if (url.pathname === "/no-deps") {
          return Response.json({
            name: "no-deps",
            "dist-tags": { latest: "1.0.0" },
            versions: {
              "1.0.0": {
                name: "no-deps",
                version: "1.0.0",
                dist: { tarball: `http://127.0.0.1:${serverB.port}/no-deps/-/no-deps-1.0.0.tgz` },
              },
            },
          });
        }
        return new Response("not found", { status: 404 });
      },
    });

    using dir = tempDir("npmrc-registry-override", {
      ".npmrc":
        `registry=http://127.0.0.1:${serverA.port}/\n` +
        `//127.0.0.1:${serverA.port}/:_authToken=first-host-SECRET-token\n`,
      "package.json": JSON.stringify({
        name: "app",
        version: "1.0.0",
        dependencies: { "no-deps": "1.0.0" },
      }),
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "install", "--registry", `http://127.0.0.1:${serverB.port}/`],
      cwd: String(dir),
      env: { ...env, BUN_INSTALL_CACHE_DIR: join(String(dir), ".cache") },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(reqsA).toEqual([]);
    expect(reqsB.length).toBeGreaterThan(0);
    expect(reqsB.map(r => r.auth)).toEqual(reqsB.map(() => null));
    expect(stdout).toContain("+ no-deps@1.0.0");
    expect(exitCode).toBe(0);
  });
});

describe.skipIf(!isIPv6())("registry on a bracketed IPv6 host", () => {
  test("sends the token keyed to //[::1]:port/ to the default and the scoped registry", async () => {
    type Req = { path: string; auth: string | null };
    const reqs: Req[] = [];
    await using server = Bun.serve({
      port: 0,
      hostname: "::1",
      fetch(req) {
        reqs.push({ path: new URL(req.url).pathname, auth: req.headers.get("authorization") });
        return new Response("not found", { status: 404 });
      },
    });
    const url = `http://[::1]:${server.port}/`;

    using dir = tempDir("npmrc-ipv6-registry", {
      ".npmrc": `registry=${url}\n@v6:registry=${url}\n//[::1]:${server.port}/:_authToken=v6-SECRET-token\n`,
      "package.json": JSON.stringify({
        name: "app",
        version: "1.0.0",
        dependencies: { "no-deps": "1.0.0", "@v6/no-deps": "1.0.0" },
      }),
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "install", "--no-cache"],
      cwd: String(dir),
      // An ambient proxy would intercept the requests to the local registry.
      env: { ...env, http_proxy: "", https_proxy: "", HTTP_PROXY: "", HTTPS_PROXY: "" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(reqs.toSorted((a, b) => a.path.localeCompare(b.path))).toEqual([
      { path: "/@v6%2fno-deps", auth: "Bearer v6-SECRET-token" },
      { path: "/no-deps", auth: "Bearer v6-SECRET-token" },
    ]);
    // The registry answers 404 to both manifest requests, so the install itself fails.
    expect(exitCode).not.toBe(0);
  });
});
