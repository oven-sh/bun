import { write } from "bun";
import { afterAll, beforeAll, describe, expect, it, test } from "bun:test";
import { rm } from "fs/promises";
import { VerdaccioRegistry, bunExe, bunEnv as env, isIPv6, tempDir, tls } from "harness";
import { createServer as createTlsServer } from "node:tls";
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

  await makeTest(
    [
      ["username", "testuser"],
      ["_password", "testpass"],
    ],
    result => {
      expect(result.default_registry_url).toEqual("https://registry.npmjs.org/");
      expect(result.default_registry_username).toEqual("testuser");
      expect(result.default_registry_password).toEqual("testpass");
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
    // Keys and registry URLs are both parsed as URLs and compared on host and path, so
    // the bracketed authority has to survive both parses.
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
        default_registry_auth: "",
      });

      const auth = Buffer.from("v6-user:v6-password").toString("base64");
      expect(loadNpmrc(`registry=http://[::1]:4873/\n//[::1]:4873/:_auth=${auth}\n`)).toEqual({
        default_registry_url: "http://[::1]:4873/",
        default_registry_token: "",
        default_registry_username: "",
        default_registry_password: "",
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
  });

  describe("credentials that did not come from .npmrc survive resolution", () => {
    // A credential written into the registry URL is the weakest source: npm's
    // `getAuth` never reads it, so any complete `.npmrc` line for the key replaces it.
    test("an .npmrc _auth replaces the registry URL's token", () => {
      const result = loadNpmrc(`
registry=https://:TOK@somehost.com/
//somehost.com/:_auth=not-valid-base64
`);
      expect(result.default_registry_token).toBe("");
      expect(result.default_registry_auth).toBe("not-valid-base64");
    });

    test("an .npmrc username/_password replaces the registry URL's token", () => {
      const result = loadNpmrc(`
registry=https://:TOK@somehost.com/
//somehost.com/:username=gandalf
//somehost.com/:_password=${Buffer.from("verysecure").toString("base64")}
`);
      expect(result.default_registry_token).toBe("");
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
    expect(stderr).not.toMatch(/_auth/);
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
  test("an env registry on the same host keeps the .npmrc username and _password", async () => {
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
      ".npmrc": `registry=http://${host}/\n//${host}/:username=alice\n//${host}/:_password=${Buffer.from("hunter2").toString("base64")}\n`,
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
  test("an env registry on the same host keeps the registry URL's userinfo", async () => {
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
      ".npmrc": `registry=http://alice:hunter2@${host}/\n`,
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
  // A `.npmrc` key carries no scheme, so the line applies to the http registry too, as
  // in npm; only a credential carried over from another registry refuses a downgrade.
  test("an env registry that downgrades https to http still gets the .npmrc _auth", async () => {
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
      ".npmrc": `registry=https://${host}/\n//${host}/:_auth=${blob}\n`,
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

    // Answers `/-/whoami` with a fixed name and records the Authorization header, so a
    // request that goes out is visible even when Bun cannot derive a name locally.
    async function whoamiAgainstRegistry(authLine: (host: string) => string, userinfo = "") {
      const authorizations: (string | null)[] = [];
      await using registry = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        fetch(req) {
          authorizations.push(req.headers.get("authorization"));
          return Response.json({ username: "from-registry" });
        },
      });
      const host = `127.0.0.1:${registry.port}`;
      const result = await whoamiWith({
        ".npmrc": `registry=http://${userinfo}${host}/\n${authLine(host)}\n`,
      });
      return { ...result, authorizations };
    }

    test("a decodable _auth prints its username without a request", async () => {
      const blob = Buffer.from("alice:s3cret").toString("base64");
      const { stdout, exitCode, authorizations } = await whoamiAgainstRegistry(host => `//${host}/:_auth=${blob}`);
      expect({ stdout, authorizations }).toEqual({ stdout: "alice\n", authorizations: [] });
      expect(exitCode).toBe(0);
    });

    // No local identity in these values, so the credential goes to the registry as
    // written and the registry answers; main gave up with "missing authentication".
    test.each([
      ["opaque", "!!not-base64!!"],
      ["blank username", Buffer.from(":s3cret").toString("base64")],
      ["blank password", Buffer.from("tok:").toString("base64")],
    ])("an _auth without a local identity asks the registry (%s)", async (_name, authValue) => {
      const { stdout, exitCode, authorizations } = await whoamiAgainstRegistry(host => `//${host}/:_auth=${authValue}`);
      expect({ stdout, authorizations }).toEqual({ stdout: "from-registry\n", authorizations: [`Basic ${authValue}`] });
      expect(exitCode).toBe(0);
    });

    // The wire sends `Basic <_auth>` here (auth beats the username + password the
    // registry URL's userinfo stored), so whoami must not report that username: it
    // would be an identity from a credential never sent.
    test.each([
      ["opaque", "!!not-base64!!"],
      ["blank-password", Buffer.from("tok:").toString("base64")],
    ])("the registry URL's username/password do not leak an identity past _auth (%s)", async (_name, authValue) => {
      const { stdout, exitCode, authorizations } = await whoamiAgainstRegistry(
        host => `//${host}/:_auth=${authValue}`,
        "url-user:url-pass@",
      );
      expect({ stdout, authorizations }).toEqual({ stdout: "from-registry\n", authorizations: [`Basic ${authValue}`] });
      expect(exitCode).toBe(0);
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

  // npm compares a hand-written key as written: a port in it stays, so `//host:443/`
  // is the key of `http://host:443/` (a TLS-terminating proxy) and not of `https://host/`.
  // Bun's fast URL parser collapses a one-byte path (`/r/`) to `/`; the key must not.
  it("keeps a one-character registry path in the key", () => {
    expect(token(`registry=https://example.com/r/\n//example.com/r/:_authToken=T\n`)).toBe("T");
    expect(token(`registry=https://example.com/r/\n//example.com/:_authToken=T\n`)).toBe("T");
  });

  it("keeps a port written in a scheme-less key", () => {
    expect(token(`registry=http://example.com:443/api/\n//example.com:443/:_authToken=T\n`)).toBe("T");
    expect(token(`registry=https://example.com/api/\n//example.com:443/:_authToken=T\n`)).toBe("");
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
    expect(token(`registry=https://[::1]/\n//https://[::1]:443/:_authToken=T\n`)).toBe("T");
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
  async function stderrOf(npmrc: string, bunfig?: object, args: string[] = []) {
    using dir = tempDir("npmrc-diagnostics", {
      ".npmrc": npmrc,
      "package.json": JSON.stringify({ name: "x", version: "1.0.0" }),
      "home/.gitkeep": "",
      ...(bunfig ? { "bunfig.toml": Bun.TOML.stringify(bunfig) } : {}),
    });
    const home = join(String(dir), "home");
    await using proc = Bun.spawn({
      cmd: [bunExe(), "install", "--no-cache", ...args],
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

  it("names the file and line of an unknown option", async () => {
    const stderr = await stderrOf(`registry=https://example.com/\n\n//example.com/:_authtoken=SECRETTOKEN\n`);
    expect(stderr).toMatch(/_authtoken is not a known .npmrc option[^\n]*\n\s+at .npmrc:3:/);
    expect(stderr).not.toContain("SECRETTOKEN");
  });

  it("says nothing about an unknown option under --silent", async () => {
    const stderr = await stderrOf(`registry=https://example.com/\n//example.com/:_authtoken=SECRETTOKEN\n`, undefined, [
      "--silent",
    ]);
    expect(stderr).not.toMatch(/\b(warn|error):/);
    expect(stderr).not.toContain("SECRETTOKEN");
  });

  it("accepts per-registry options npm or pnpm know without a warning", async () => {
    const stderr = await stderrOf(
      [
        "registry=https://example.com/",
        "//example.com/:always-auth=true",
        "//example.com/:tokenHelper=/usr/local/bin/token",
        "//example.com/:cafile=/etc/ssl/ca.pem",
        "",
      ].join("\n"),
    );
    expect(stderr).toBe("No packages! Deleted empty lockfile\n");
  });

  it("says nothing about a key that matches once normalized", async () => {
    const stderr = await stderrOf(`registry=https://example.com/api/\n//Example.COM:443/:_authToken=SECRETTOKEN\n`);
    expect(stderr).toBe("No packages! Deleted empty lockfile\n");
  });

  it("a known option with a non-string value is ignored without a warning", async () => {
    const stderr = await stderrOf("registry=http://127.0.0.1:1/\n//127.0.0.1:1/:_authToken=true\n");
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
      expect(stderr).not.toMatch(/_auth/);
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

// `//host/path/:_authToken=` lines are keyed by URL, not by a registry declared
// in the same file. Like npm, they have to apply to whatever request ends up on
// that host: a registry that only exists on the command line or in the
// environment, or a tarball served from a different host than the registry.
describe.concurrent("//host/ credential lines are matched against the request URL", () => {
  const tgz = join(import.meta.dir, "registry", "packages", "no-deps", "no-deps-1.0.0.tgz");
  const basic = (user: string, password: string) => `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;
  const packageJson = JSON.stringify({ name: "app", version: "1.0.0", dependencies: { "no-deps": "1.0.0" } });

  type Req = { path: string; auth: string | null };

  type MockRegistryOptions = {
    /** Serve dist.tarball from another server instead of this one. */
    tarballOrigin?: () => string;
    /** Mount the registry under this path prefix instead of `/`. */
    registryPath?: string;
    /** Path of the tarball on its server. */
    tarballPath?: string;
    /** Let the manifest through without credentials; only the tarball is protected. */
    publicManifest?: boolean;
    /** Serve over https with the harness certificate (`install` passes it as `--ca`). */
    secure?: boolean;
    /** The package the manifest describes (default `no-deps`); a scoped name is served at `@scope%2fname`. */
    packageName?: string;
    /** A query string appended to the advertised `dist.tarball` URL. */
    tarballQuery?: string;
  };

  // Serves no-deps@1.0.0 and answers 401 to any request that does not carry
  // exactly `expectedAuth`.
  function mockRegistry(expectedAuth: string, options: MockRegistryOptions = {}) {
    const {
      tarballOrigin,
      registryPath = "",
      tarballPath = "/no-deps/-/no-deps-1.0.0.tgz",
      publicManifest,
      secure,
      packageName = "no-deps",
      tarballQuery = "",
    } = options;
    const requests: Req[] = [];
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      ...(secure ? { tls } : {}),
      fetch(req) {
        const url = new URL(req.url);
        const auth = req.headers.get("authorization");
        requests.push({ path: url.pathname, auth });
        const isManifest = url.pathname === `${registryPath}/${packageName.replace("/", "%2f")}`;
        if (auth !== expectedAuth && !(isManifest && publicManifest)) {
          return new Response("unauthorized", { status: 401 });
        }
        if (url.pathname === tarballPath) return new Response(Bun.file(tgz));
        if (isManifest) {
          const origin = tarballOrigin ? tarballOrigin() : `${secure ? "https" : "http"}://127.0.0.1:${server.port}`;
          return Response.json({
            name: packageName,
            "dist-tags": { latest: "1.0.0" },
            versions: {
              "1.0.0": {
                name: packageName,
                version: "1.0.0",
                dist: { tarball: `${origin}${tarballPath}${tarballQuery}` },
              },
            },
          });
        }
        return new Response("not found", { status: 404 });
      },
    });
    return {
      requests,
      host: `127.0.0.1:${server.port}`,
      origin: `${secure ? "https" : "http"}://127.0.0.1:${server.port}`,
      [Symbol.dispose]() {
        server.stop(true);
      },
    };
  }

  // Records each request line and Authorization header exactly as they arrive on the
  // wire (Bun.serve would hand the test a parsed URL), then answers 404.
  async function rawServer() {
    const requests: Req[] = [];
    const server = createTlsServer({ key: tls.key, cert: tls.cert }, (socket: any) => {
      let head = "";
      socket.on("data", (chunk: Buffer) => {
        head += chunk.toString("latin1");
        const end = head.indexOf("\r\n\r\n");
        if (end === -1) return;
        const lines = head.slice(0, end).split("\r\n");
        const auth = lines.find(l => l.toLowerCase().startsWith("authorization:"));
        requests.push({ path: lines[0].split(" ")[1], auth: auth ? auth.slice("authorization:".length).trim() : null });
        head = "";
        socket.end("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
      });
      socket.on("error", () => {});
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const port = server.address().port;
    return {
      requests,
      host: `127.0.0.1:${port}`,
      origin: `https://127.0.0.1:${port}`,
      [Symbol.dispose]() {
        server.close();
      },
    };
  }

  // A registry on its own origin that records the request line as it arrives on the
  // wire (Bun.serve would resolve `..` before the test sees the path) and serves the
  // manifest and the tarball whatever the credentials.
  async function rawRegistry(registryPath: string, tarballPath: string) {
    const requests: Req[] = [];
    const tgzBytes = await Bun.file(tgz).bytes();
    let origin = "";
    const respond = (socket: any, status: string, type: string, body: Uint8Array) => {
      socket.write(
        `HTTP/1.1 ${status}\r\nContent-Type: ${type}\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n`,
      );
      socket.end(body);
    };
    const server = createTlsServer({ key: tls.key, cert: tls.cert }, (socket: any) => {
      let head = "";
      socket.on("data", (chunk: Buffer) => {
        head += chunk.toString("latin1");
        const end = head.indexOf("\r\n\r\n");
        if (end === -1) return;
        const lines = head.slice(0, end).split("\r\n");
        const path = lines[0].split(" ")[1];
        const auth = lines.find(l => l.toLowerCase().startsWith("authorization:"));
        requests.push({ path, auth: auth ? auth.slice("authorization:".length).trim() : null });
        head = "";
        if (path === `${registryPath}/no-deps`) {
          const manifest = JSON.stringify({
            name: "no-deps",
            "dist-tags": { latest: "1.0.0" },
            versions: { "1.0.0": { name: "no-deps", version: "1.0.0", dist: { tarball: `${origin}${tarballPath}` } } },
          });
          respond(socket, "200 OK", "application/json", new TextEncoder().encode(manifest));
        } else {
          respond(socket, "200 OK", "application/octet-stream", tgzBytes);
        }
      });
      socket.on("error", () => {});
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const port = server.address().port;
    origin = `https://127.0.0.1:${port}`;
    return {
      requests,
      host: `127.0.0.1:${port}`,
      origin,
      [Symbol.dispose]() {
        server.close();
      },
    };
  }

  async function install(dir: string, args: string[] = [], extraEnv: Record<string, string> = {}) {
    // bunEnv spreads process.env; the user-level .npmrc of the machine running the
    // tests must not leak in, and the cache must be cold so the tarball is fetched.
    const spawnEnv: Record<string, string> = {
      ...(env as Record<string, string>),
      HOME: join(dir, "home"),
      USERPROFILE: join(dir, "home"),
      BUN_INSTALL_CACHE_DIR: join(dir, ".cache"),
      ...extraEnv,
    };
    delete spawnEnv.XDG_CONFIG_HOME;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "install", "--ca", tls.cert, ...args],
      cwd: dir,
      env: spawnEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  const manifestPath = "/no-deps";
  const tarballPath = "/no-deps/-/no-deps-1.0.0.tgz";

  test("--registry uses the token the user-level .npmrc has for that host", async () => {
    using registry = mockRegistry("Bearer user-npmrc-token");
    using dir = tempDir("npmrc-url-auth-cli-registry", {
      "package.json": packageJson,
      "home/.npmrc": `//${registry.host}/:_authToken=user-npmrc-token\n`,
    });

    const { stderr, exitCode } = await install(String(dir), ["--registry", `${registry.origin}/`]);

    expect({ requests: registry.requests, exitCode, stderr }).toEqual({
      requests: [
        { path: manifestPath, auth: "Bearer user-npmrc-token" },
        { path: tarballPath, auth: "Bearer user-npmrc-token" },
      ],
      exitCode: 0,
      stderr: expect.not.stringContaining("401"),
    });
  });

  // The default registry's token used to follow any `--registry`/env registry on the
  // same host, path ignored, so a sibling path got the wrong token and its own line
  // was never consulted. Only a registry at or under the old one inherits now.
  test.each([
    ["--registry", (origin: string) => [["--registry", `${origin}/npm/team-b/`], {}] as const],
    ["NPM_CONFIG_REGISTRY", (origin: string) => [[], { NPM_CONFIG_REGISTRY: `${origin}/npm/team-b/` }] as const],
  ])(
    "a registry from %s on a sibling path uses that path's own line, not the default registry's token",
    async (_source, overrideFor) => {
      using registry = mockRegistry("Bearer team-b-token", {
        registryPath: "/npm/team-b",
        tarballPath: "/npm/team-b/no-deps/-/no-deps-1.0.0.tgz",
      });
      using dir = tempDir("npmrc-url-auth-sibling-registry", {
        "package.json": packageJson,
        ".npmrc": [
          `registry=${registry.origin}/npm/team-a/`,
          `//${registry.host}/npm/team-a/:_authToken=team-a-token`,
          `//${registry.host}/npm/team-b/:_authToken=team-b-token`,
          "",
        ].join("\n"),
        "home/.gitkeep": "",
      });
      const [args, extraEnv] = overrideFor(registry.origin);

      const { stderr, exitCode } = await install(String(dir), [...args], { ...extraEnv });

      expect({ requests: registry.requests, exitCode, stderr }).toEqual({
        requests: [
          { path: "/npm/team-b/no-deps", auth: "Bearer team-b-token" },
          { path: "/npm/team-b/no-deps/-/no-deps-1.0.0.tgz", auth: "Bearer team-b-token" },
        ],
        exitCode: 0,
        stderr: expect.not.stringContaining("401"),
      });
    },
  );

  // A deeper line wins over inheritance, as npm resolves it from the request URL.
  test.each([
    ["--registry", (origin: string) => [["--registry", `${origin}/npm/team-a/sub/`], {}] as const],
    ["NPM_CONFIG_REGISTRY", (origin: string) => [[], { NPM_CONFIG_REGISTRY: `${origin}/npm/team-a/sub/` }] as const],
  ])("a registry from %s below the default registry uses its own deeper line", async (_source, overrideFor) => {
    using registry = mockRegistry("Bearer sub-token", {
      registryPath: "/npm/team-a/sub",
      tarballPath: "/npm/team-a/sub/no-deps/-/no-deps-1.0.0.tgz",
    });
    using dir = tempDir("npmrc-url-auth-deeper-line", {
      "package.json": packageJson,
      ".npmrc": [
        `registry=${registry.origin}/npm/team-a/`,
        `//${registry.host}/npm/team-a/:_authToken=team-a-token`,
        `//${registry.host}/npm/team-a/sub/:_authToken=sub-token`,
        "",
      ].join("\n"),
      "home/.gitkeep": "",
    });
    const [args, extraEnv] = overrideFor(registry.origin);

    const { stderr, exitCode } = await install(String(dir), [...args], { ...extraEnv });

    expect({ requests: registry.requests, exitCode, stderr }).toEqual({
      requests: [
        { path: "/npm/team-a/sub/no-deps", auth: "Bearer sub-token" },
        { path: "/npm/team-a/sub/no-deps/-/no-deps-1.0.0.tgz", auth: "Bearer sub-token" },
      ],
      exitCode: 0,
      stderr: expect.not.stringContaining("401"),
    });
  });

  test("--registry below the default registry keeps its token", async () => {
    using registry = mockRegistry("Bearer team-a-token", {
      registryPath: "/npm/team-a/sub",
      tarballPath: "/npm/team-a/sub/no-deps/-/no-deps-1.0.0.tgz",
    });
    using dir = tempDir("npmrc-url-auth-child-registry", {
      "package.json": packageJson,
      ".npmrc": `registry=${registry.origin}/npm/team-a/\n//${registry.host}/npm/team-a/:_authToken=team-a-token\n`,
      "home/.gitkeep": "",
    });

    const { stderr, exitCode } = await install(String(dir), ["--registry", `${registry.origin}/npm/team-a/sub/`]);

    expect({ requests: registry.requests, exitCode, stderr }).toEqual({
      requests: [
        { path: "/npm/team-a/sub/no-deps", auth: "Bearer team-a-token" },
        { path: "/npm/team-a/sub/no-deps/-/no-deps-1.0.0.tgz", auth: "Bearer team-a-token" },
      ],
      exitCode: 0,
      stderr: expect.not.stringContaining("401"),
    });
  });

  test.each(["NPM_CONFIG_REGISTRY", "BUN_CONFIG_REGISTRY"])(
    "a registry from %s uses the token the project .npmrc has for that host",
    async variable => {
      using registry = mockRegistry("Bearer env-registry-token");
      using dir = tempDir("npmrc-url-auth-env-registry", {
        "package.json": packageJson,
        ".npmrc": `//${registry.host}/:_authToken=env-registry-token\n`,
      });

      const { exitCode } = await install(String(dir), [], { [variable]: `${registry.origin}/` });

      expect({ requests: registry.requests, exitCode }).toEqual({
        requests: [
          { path: manifestPath, auth: "Bearer env-registry-token" },
          { path: tarballPath, auth: "Bearer env-registry-token" },
        ],
        exitCode: 0,
      });
    },
  );

  test("username and _password lines for the --registry host are sent as basic auth", async () => {
    using registry = mockRegistry(basic("alice", "open sesame"));
    using dir = tempDir("npmrc-url-auth-basic", {
      "package.json": packageJson,
      ".npmrc": [
        `//${registry.host}/:username=alice`,
        `//${registry.host}/:_password=${Buffer.from("open sesame").toString("base64")}`,
        "",
      ].join("\n"),
    });

    const { exitCode } = await install(String(dir), ["--registry", `${registry.origin}/`]);

    expect({ requests: registry.requests, exitCode }).toEqual({
      requests: [
        { path: manifestPath, auth: basic("alice", "open sesame") },
        { path: tarballPath, auth: basic("alice", "open sesame") },
      ],
      exitCode: 0,
    });
  });

  test("a line for the tarball host takes precedence over userinfo in the dist.tarball url", async () => {
    using cdn = mockRegistry("Bearer cdn-token", { secure: true });
    using registry = mockRegistry("Bearer registry-token", {
      tarballOrigin: () => `https://carol:s3cret@${cdn.host}`,
    });
    using dir = tempDir("npmrc-url-auth-line-over-userinfo", {
      "package.json": packageJson,
      ".npmrc": [
        `registry=${registry.origin}/`,
        `//${registry.host}/:_authToken=registry-token`,
        `//${cdn.host}/:_authToken=cdn-token`,
        "",
      ].join("\n"),
    });

    const { exitCode } = await install(String(dir));

    expect({ cdn: cdn.requests, exitCode }).toEqual({
      cdn: [{ path: tarballPath, auth: "Bearer cdn-token" }],
      exitCode: 0,
    });
  });

  test("a tarball on a different host than its registry gets that host's own line", async () => {
    using cdn = mockRegistry("Bearer cdn-token", { secure: true });
    using registry = mockRegistry("Bearer registry-token", { tarballOrigin: () => cdn.origin });
    using dir = tempDir("npmrc-url-auth-tarball-host", {
      "package.json": packageJson,
      ".npmrc": [
        `registry=${registry.origin}/`,
        `//${registry.host}/:_authToken=registry-token`,
        `//${cdn.host}/:_authToken=cdn-token`,
        "",
      ].join("\n"),
    });

    const { exitCode } = await install(String(dir));

    expect({ registry: registry.requests, cdn: cdn.requests, exitCode }).toEqual({
      registry: [{ path: manifestPath, auth: "Bearer registry-token" }],
      cdn: [{ path: tarballPath, auth: "Bearer cdn-token" }],
      exitCode: 0,
    });
  });

  test("username and _password lines for the tarball host are sent to it as basic auth", async () => {
    using cdn = mockRegistry(basic("cdn-user", "cdn-pass"), { secure: true });
    using registry = mockRegistry("Bearer registry-token", { tarballOrigin: () => cdn.origin });
    using dir = tempDir("npmrc-url-auth-tarball-host-basic", {
      "package.json": packageJson,
      ".npmrc": [
        `registry=${registry.origin}/`,
        `//${registry.host}/:_authToken=registry-token`,
        `//${cdn.host}/:username=cdn-user`,
        `//${cdn.host}/:_password=${Buffer.from("cdn-pass").toString("base64")}`,
        "",
      ].join("\n"),
    });

    const { exitCode } = await install(String(dir));

    expect({ registry: registry.requests, cdn: cdn.requests, exitCode }).toEqual({
      registry: [{ path: manifestPath, auth: "Bearer registry-token" }],
      cdn: [{ path: tarballPath, auth: basic("cdn-user", "cdn-pass") }],
      exitCode: 0,
    });
  });

  test("the line with the deepest path covering the tarball url wins; other paths on the host do not apply", async () => {
    using cdn = mockRegistry("Bearer deep-token", { secure: true });
    using registry = mockRegistry("Bearer registry-token", { tarballOrigin: () => cdn.origin });
    using dir = tempDir("npmrc-url-auth-tarball-path", {
      "package.json": packageJson,
      ".npmrc": [
        `registry=${registry.origin}/`,
        `//${registry.host}/:_authToken=registry-token`,
        `//${cdn.host}/no-deps-other/:_authToken=other-token`,
        `//${cdn.host}/:_authToken=shallow-token`,
        `//${cdn.host}/no-deps/:_authToken=deep-token`,
        "",
      ].join("\n"),
    });

    const { exitCode } = await install(String(dir));

    expect({ cdn: cdn.requests, exitCode }).toEqual({
      cdn: [{ path: tarballPath, auth: "Bearer deep-token" }],
      exitCode: 0,
    });
  });

  test("a line for another path on the tarball host does not authenticate it, even if it is a string prefix", async () => {
    // https, so the key walk is what decides, not the plaintext guard.
    using cdn = mockRegistry("Bearer other-token", { secure: true });
    using registry = mockRegistry("Bearer registry-token", { tarballOrigin: () => cdn.origin });
    using dir = tempDir("npmrc-url-auth-tarball-wrong-path", {
      "package.json": packageJson,
      ".npmrc": [
        `registry=${registry.origin}/`,
        `//${registry.host}/:_authToken=registry-token`,
        // "/no" is a prefix of "/no-deps/..." but not a parent directory of it.
        `//${cdn.host}/no/:_authToken=other-token`,
        "",
      ].join("\n"),
    });

    const { stderr, exitCode } = await install(String(dir));

    expect({ cdn: cdn.requests, exitCode }).toEqual({
      cdn: [{ path: tarballPath, auth: null }],
      exitCode: 1,
    });
    expect(stderr).toContain(`error: GET ${cdn.origin}${tarballPath} - 401`);
  });

  // https://github.com/oven-sh/bun/issues/30513: GitLab resolves packages through
  // an instance-level registry path but serves tarballs from (and keys tokens to)
  // a project-level path. The token line covers the tarball URL and nothing else.
  test("a line keyed to the tarball path authenticates the tarball when the registry itself has no credentials", async () => {
    const registryPath = "/api/v4/packages/npm";
    const tarballPath = "/api/v4/projects/123/packages/npm/no-deps/-/no-deps-1.0.0.tgz";
    using registry = mockRegistry("Bearer project-token", { registryPath, tarballPath, publicManifest: true });
    using dir = tempDir("npmrc-url-auth-divergent-path", {
      "package.json": packageJson,
      ".npmrc": [
        `registry=${registry.origin}${registryPath}/`,
        `//${registry.host}/api/v4/projects/123/packages/npm/:_authToken=project-token`,
        "",
      ].join("\n"),
    });

    const { exitCode } = await install(String(dir));

    expect({ requests: registry.requests, exitCode }).toEqual({
      requests: [
        { path: `${registryPath}/no-deps`, auth: null },
        { path: tarballPath, auth: "Bearer project-token" },
      ],
      exitCode: 0,
    });
  });

  test("a line keyed to a parent path of the registry url applies to the registry", async () => {
    const registryPath = "/api/v4/packages/npm";
    const tarballPath = `${registryPath}/no-deps/-/no-deps-1.0.0.tgz`;
    using registry = mockRegistry("Bearer host-token", { registryPath, tarballPath });
    using dir = tempDir("npmrc-url-auth-parent-path", {
      "package.json": packageJson,
      ".npmrc": [`registry=${registry.origin}${registryPath}/`, `//${registry.host}/:_authToken=host-token`, ""].join(
        "\n",
      ),
    });

    const { exitCode } = await install(String(dir));

    expect({ requests: registry.requests, exitCode }).toEqual({
      requests: [
        { path: `${registryPath}/no-deps`, auth: "Bearer host-token" },
        { path: tarballPath, auth: "Bearer host-token" },
      ],
      exitCode: 0,
    });
  });

  test("a lockfile recorded against a registry that has since moved still downloads from the old host", async () => {
    using oldRegistry = mockRegistry("Bearer old-token", { secure: true });
    using newRegistry = mockRegistry("Bearer new-token");
    using dir = tempDir("npmrc-url-auth-moved-registry", {
      "package.json": packageJson,
      ".npmrc": [`registry=${oldRegistry.origin}/`, `//${oldRegistry.host}/:_authToken=old-token`, ""].join("\n"),
    });

    const first = await install(String(dir));
    expect(first.exitCode).toBe(0);
    const lockfile = await Bun.file(join(String(dir), "bun.lock")).text();
    expect(lockfile).toContain(`${oldRegistry.origin}${tarballPath}`);
    oldRegistry.requests.length = 0;

    // The registry moves; the user keeps credentials for both hosts, as npm
    // needs them to for the same lockfile.
    await Bun.write(
      join(String(dir), ".npmrc"),
      [
        `registry=${newRegistry.origin}/`,
        `//${newRegistry.host}/:_authToken=new-token`,
        `//${oldRegistry.host}/:_authToken=old-token`,
        "",
      ].join("\n"),
    );
    await rm(join(String(dir), "node_modules"), { recursive: true, force: true });
    await rm(join(String(dir), ".cache"), { recursive: true, force: true });

    const second = await install(String(dir), ["--frozen-lockfile"]);

    expect({ old: oldRegistry.requests, new: newRegistry.requests, exitCode: second.exitCode }).toEqual({
      old: [{ path: tarballPath, auth: "Bearer old-token" }],
      new: [],
      exitCode: 0,
    });
  });

  // npm's fallback: a tarball with no `.npmrc` line of its own gets the registry's
  // credentials when it is on the registry's origin, whatever its path. GitLab's
  // instance-level registry serves tarballs under a project path, so this is the
  // documented setup (#30513).
  test("registry credentials follow a tarball on a sibling path of the same origin", async () => {
    const registryPath = "/npm/team-a";
    const tarballPath = "/npm/team-b/no-deps/-/no-deps-1.0.0.tgz";
    using registry = mockRegistry("Bearer team-a-token", { registryPath, tarballPath });
    using dir = tempDir("npmrc-url-auth-sibling-path", {
      "package.json": packageJson,
      ".npmrc": [
        `registry=${registry.origin}${registryPath}/`,
        `//${registry.host}${registryPath}/:_authToken=team-a-token`,
        "",
      ].join("\n"),
    });

    const { stderr, exitCode } = await install(String(dir));

    expect({ requests: registry.requests, exitCode, stderr }).toEqual({
      requests: [
        { path: `${registryPath}/no-deps`, auth: "Bearer team-a-token" },
        { path: tarballPath, auth: "Bearer team-a-token" },
      ],
      exitCode: 0,
      stderr: expect.not.stringContaining("401"),
    });
  });

  test("GitLab's instance-level registry: the project-path tarball gets the instance token", async () => {
    const registryPath = "/api/v4/packages/npm";
    const tarballPath = "/api/v4/projects/123/packages/npm/no-deps/-/no-deps-1.0.0.tgz";
    using registry = mockRegistry("Bearer instance-token", { registryPath, tarballPath });
    using dir = tempDir("npmrc-url-auth-gitlab-instance", {
      "package.json": packageJson,
      ".npmrc": [
        `registry=${registry.origin}${registryPath}/`,
        `//${registry.host}${registryPath}/:_authToken=instance-token`,
        "",
      ].join("\n"),
    });

    const { stderr, exitCode } = await install(String(dir));

    expect({ requests: registry.requests, exitCode, stderr }).toEqual({
      requests: [
        { path: `${registryPath}/no-deps`, auth: "Bearer instance-token" },
        { path: tarballPath, auth: "Bearer instance-token" },
      ],
      exitCode: 0,
      stderr: expect.not.stringContaining("401"),
    });
  });

  // A line specific to the tarball's path beats the registry's credentials, as in
  // npm; a line the registry itself resolves to does not (bunfig, env and CLI
  // credentials stay ahead of `.npmrc`, as they are for the manifest).
  test("a tarball path with its own .npmrc line uses that line, not the registry's token", async () => {
    const registryPath = "/npm/team-a";
    const tarballPath = "/npm/team-b/no-deps/-/no-deps-1.0.0.tgz";
    using registry = mockRegistry("Bearer team-b-token", { registryPath, tarballPath, publicManifest: true });
    using dir = tempDir("npmrc-url-auth-own-line", {
      "package.json": packageJson,
      ".npmrc": [
        `registry=${registry.origin}${registryPath}/`,
        `//${registry.host}${registryPath}/:_authToken=team-a-token`,
        `//${registry.host}/npm/team-b/:_authToken=team-b-token`,
        "",
      ].join("\n"),
    });

    const { stderr, exitCode } = await install(String(dir));

    expect({ requests: registry.requests, exitCode, stderr }).toEqual({
      requests: [
        { path: `${registryPath}/no-deps`, auth: "Bearer team-a-token" },
        { path: tarballPath, auth: "Bearer team-b-token" },
      ],
      exitCode: 0,
      stderr: expect.not.stringContaining("401"),
    });
  });

  // A shallower line the registry never reached is the tarball's own line, as in npm:
  // the registry stopped at its team key, the tarball outside that tree walks to root.
  test("a same-origin tarball outside the registry's tree uses the host-root line", async () => {
    const registryPath = "/npm/team-a";
    const tarballPath = "/cdn/no-deps/-/no-deps-1.0.0.tgz";
    using registry = mockRegistry("Bearer root-token", { registryPath, tarballPath, publicManifest: true });
    using dir = tempDir("npmrc-url-auth-root-line", {
      "package.json": packageJson,
      ".npmrc": [
        `registry=${registry.origin}${registryPath}/`,
        `//${registry.host}${registryPath}/:_authToken=team-a-token`,
        `//${registry.host}/:_authToken=root-token`,
        "",
      ].join("\n"),
    });

    const { stderr, exitCode } = await install(String(dir));

    expect({ requests: registry.requests, exitCode, stderr }).toEqual({
      requests: [
        { path: `${registryPath}/no-deps`, auth: "Bearer team-a-token" },
        { path: tarballPath, auth: "Bearer root-token" },
      ],
      exitCode: 0,
      stderr: expect.not.stringContaining("401"),
    });
  });

  // `.npmrc` keys carry no scheme. A registry-supplied `http://` tarball must not
  // receive a token the user wrote for an https host: the manifest is registry-controlled.
  test("an http tarball from an https registry gets no .npmrc credentials", async () => {
    const tarballRequests: (string | null)[] = [];
    using plain = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req) {
        tarballRequests.push(req.headers.get("authorization"));
        return new Response(Bun.file(tgz));
      },
    });
    using secure = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      tls,
      fetch() {
        return Response.json({
          name: "no-deps",
          "dist-tags": { latest: "1.0.0" },
          versions: {
            "1.0.0": {
              name: "no-deps",
              version: "1.0.0",
              dist: { tarball: `http://127.0.0.1:${plain.port}/no-deps/-/no-deps-1.0.0.tgz` },
            },
          },
        });
      },
    });
    using dir = tempDir("npmrc-url-auth-http-tarball", {
      "package.json": packageJson,
      ".npmrc": [
        `registry=https://127.0.0.1:${secure.port}/`,
        `//127.0.0.1:${secure.port}/:_authToken=registry-token`,
        `//127.0.0.1:${plain.port}/:_authToken=must-not-leak`,
        "",
      ].join("\n"),
    });

    await install(String(dir));

    expect(tarballRequests).toEqual([null]);
  });

  // The same holds when the registry itself is http: a plaintext registry (or anyone
  // on its path) must not be able to steer another host's token over plaintext.
  test("an http tarball on another host gets no .npmrc credentials even from an http registry", async () => {
    const tarballRequests: (string | null)[] = [];
    using other = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req) {
        tarballRequests.push(req.headers.get("authorization"));
        return new Response(Bun.file(tgz));
      },
    });
    using registry = mockRegistry("Bearer registry-token", {
      tarballOrigin: () => `http://127.0.0.1:${other.port}`,
      publicManifest: true,
    });
    using dir = tempDir("npmrc-url-auth-http-other-host", {
      "package.json": packageJson,
      ".npmrc": [
        `registry=${registry.origin}/`,
        `//${registry.host}/:_authToken=registry-token`,
        `//127.0.0.1:${other.port}/:_authToken=must-not-leak`,
        "",
      ].join("\n"),
    });

    await install(String(dir));

    expect(tarballRequests).toEqual([null]);
  });

  // On the registry's own origin the request goes to the resolved path and the line
  // for that path decides: a tarball resolving into team-b's tree carries team-b's
  // token, not the registry's, while one staying in team-a's tree keeps team-a's.
  test.each([
    ["/npm/team-a/../team-b/x.tgz", "/npm/team-b/x.tgz", "Bearer team-b-token"],
    ["/npm/team-a/%2e%2e/team-b/x.tgz", "/npm/team-b/x.tgz", "Bearer team-b-token"],
    ["/npm/team-a/./x.tgz", "/npm/team-a/x.tgz", "Bearer team-a-token"],
  ])(
    "a dist.tarball of %s on the registry's origin is requested at %s with that path's line",
    async (tarballPath, resolvedPath, auth) => {
      const registryPath = "/npm/team-a";
      using registry = await rawRegistry(registryPath, tarballPath);
      using dir = tempDir("npmrc-url-auth-dot-segments", {
        "package.json": packageJson,
        ".npmrc": [
          `registry=${registry.origin}${registryPath}/`,
          `//${registry.host}/npm/team-a/:_authToken=team-a-token`,
          `//${registry.host}/npm/team-b/:_authToken=team-b-token`,
          "",
        ].join("\n"),
      });

      const { exitCode } = await install(String(dir));

      expect(registry.requests[0]).toEqual({ path: `${registryPath}/no-deps`, auth: "Bearer team-a-token" });
      expect(registry.requests.length).toBeGreaterThan(1);
      expect(registry.requests.slice(1)).toEqual(registry.requests.slice(1).map(() => ({ path: resolvedPath, auth })));
      expect(exitCode).toBe(0);
    },
  );

  // `dist.tarball` is parsed once, by the WHATWG parser, as npm's `new URL()` does: the
  // path on the wire is the resolved path, and the `.npmrc` line is the one for that
  // path. No spelling of a dot segment can put one team's token on a request the server
  // could route to another team's tree, because the request names the tree the key names.
  test.each([
    "/npm/team-a/../team-b/x.tgz",
    "/npm/team-a/./x.tgz",
    "/npm/team-a/%2e%2e/team-b/x.tgz",
    "/npm/team-a/%2E%2E/team-b/x.tgz",
    "/npm/team-a/%2e./team-b/x.tgz",
    "/npm/team-a/.%2e/team-b/x.tgz",
    "/npm/team-b/..\\team-a/x.tgz",
    "/npm/team-b\\..\\team-a/x.tgz",
    "/npm/@scope%2fpkg/-/team-a/x.tgz",
  ])("a dist.tarball at %s is requested at its resolved path with that path's line", async tarballPath => {
    using cdn = await rawServer();
    using registry = mockRegistry("Bearer registry-token", { tarballOrigin: () => cdn.origin, tarballPath });
    using dir = tempDir("npmrc-url-auth-cdn-dot-segments", {
      "package.json": packageJson,
      ".npmrc": [
        `registry=${registry.origin}/`,
        `//${registry.host}/:_authToken=registry-token`,
        `//${cdn.host}/npm/team-a/:_authToken=cdn-a`,
        `//${cdn.host}/npm/team-b/:_authToken=cdn-b`,
        "",
      ].join("\n"),
    });

    await install(String(dir));

    const resolved = new URL(cdn.origin + tarballPath).pathname;
    const lineFor = (path: string) =>
      path.startsWith("/npm/team-a/") ? "Bearer cdn-a" : path.startsWith("/npm/team-b/") ? "Bearer cdn-b" : null;
    expect(registry.requests[0]).toEqual({ path: "/no-deps", auth: "Bearer registry-token" });
    expect(cdn.requests.length).toBeGreaterThan(0);
    expect(cdn.requests).toEqual(cdn.requests.map(() => ({ path: resolved, auth: lineFor(resolved) })));
  });

  // The one spelling a single parse cannot settle: a dot segment behind an encoded `/` or
  // `\`, which WHATWG keeps opaque and a decoding server re-routes. Requested as written,
  // with no `.npmrc` line of its own.
  test.each([
    "/npm/team-a/..%2Fteam-b/x.tgz",
    "/npm/team-a/%2f../team-b/x.tgz",
    "/npm/team-a/a%2f..%2fteam-b/x.tgz",
    "/npm/team-a/%5c..%5cteam-b/x.tgz",
    "/npm/team-a/%2e%2e%5Cteam-b/x.tgz",
  ])("a dist.tarball at %s is requested as written with no line", async tarballPath => {
    using cdn = await rawServer();
    using registry = mockRegistry("Bearer registry-token", { tarballOrigin: () => cdn.origin, tarballPath });
    using dir = tempDir("npmrc-url-auth-cdn-encoded-separator", {
      "package.json": packageJson,
      ".npmrc": [
        `registry=${registry.origin}/`,
        `//${registry.host}/:_authToken=registry-token`,
        `//${cdn.host}/npm/team-a/:_authToken=cdn-a`,
        "",
      ].join("\n"),
    });

    await install(String(dir));

    expect(cdn.requests.length).toBeGreaterThan(0);
    expect(cdn.requests).toEqual(cdn.requests.map(() => ({ path: tarballPath, auth: null })));
  });

  // On the registry's own origin such a tarball carries the registry's credentials:
  // the encoded separator is never read as `/`, so team-a's line, which a decoding
  // server would route the request to, is not selected.
  test("a dist.tarball with an encoded separator on the registry's origin carries the registry's credentials", async () => {
    const registryPath = "/npm/team-b";
    const tarballPath = "/npm/team-b/..%2fteam-a/x.tgz";
    using registry = mockRegistry("Bearer team-b-token", { registryPath, tarballPath });
    using dir = tempDir("npmrc-url-auth-encoded-separator-same-origin", {
      "package.json": packageJson,
      ".npmrc": [
        `registry=${registry.origin}${registryPath}/`,
        `//${registry.host}/npm/team-a/:_authToken=team-a-token`,
        `//${registry.host}/npm/team-b/:_authToken=team-b-token`,
        "",
      ].join("\n"),
    });

    await install(String(dir));

    expect(registry.requests.length).toBeGreaterThan(1);
    expect(registry.requests.slice(1)).toEqual(
      registry.requests.slice(1).map(() => ({ path: tarballPath, auth: "Bearer team-b-token" })),
    );
  });

  // A tab or another control byte never reaches the wire: the HTTP client refuses the URL, as before.
  test.each(["/npm/team-a/.\t./team-b/x.tgz", "/npm/team-a/%2e\t%2e/team-b/x.tgz"])(
    "a dist.tarball at %s is not requested at all",
    async tarballPath => {
      using cdn = await rawServer();
      using registry = mockRegistry("Bearer registry-token", { tarballOrigin: () => cdn.origin, tarballPath });
      using dir = tempDir("npmrc-url-auth-cdn-control-byte", {
        "package.json": packageJson,
        ".npmrc": [
          `registry=${registry.origin}/`,
          `//${registry.host}/:_authToken=registry-token`,
          `//${cdn.host}/npm/team-a/:_authToken=cdn-a`,
          "",
        ].join("\n"),
      });

      const { exitCode } = await install(String(dir));

      expect(cdn.requests).toEqual([]);
      expect(exitCode).toBe(1);
    },
  );

  // `https://<registry>#@<cdn>/x.tgz`: everything after `#` is a fragment, so the
  // request goes to the registry's root and the cdn is never contacted, let alone
  // handed the registry's token.
  test("a dist.tarball with `#@host` in it is requested from the authority before the #", async () => {
    using cdn = await rawServer();
    using registry = mockRegistry("Bearer registry-token", {
      secure: true,
      tarballPath: "/x.tgz",
      tarballOrigin: () => `${registry.origin}#@${cdn.host}`,
    });
    using dir = tempDir("npmrc-url-auth-parser-split", {
      "package.json": packageJson,
      ".npmrc": [`registry=${registry.origin}/`, `//${registry.host}/:_authToken=registry-token`, ""].join("\n"),
    });

    await install(String(dir));

    expect(registry.requests.slice(0, 2)).toEqual([
      { path: "/no-deps", auth: "Bearer registry-token" },
      { path: "/", auth: "Bearer registry-token" },
    ]);
    expect(cdn.requests).toEqual([]);
  });

  // The `..` in the new URL resolves to a sibling of the default registry, so the
  // default's token must not follow it.
  test.each([
    ["--registry", (origin: string) => [["--registry", `${origin}/npm/team-a/../team-b/`], {}] as const],
    [
      "NPM_CONFIG_REGISTRY",
      (origin: string) => [[], { NPM_CONFIG_REGISTRY: `${origin}/npm/team-a/../team-b/` }] as const,
    ],
  ])(
    "a registry from %s that dot-segments to a sibling path does not inherit the default's token",
    async (_source, overrideFor) => {
      using registry = mockRegistry("Bearer team-a-token", { registryPath: "/npm/team-b" });
      using dir = tempDir("npmrc-url-auth-dot-segment-registry", {
        "package.json": packageJson,
        ".npmrc": [
          `registry=${registry.origin}/npm/team-a/`,
          `//${registry.host}/npm/team-a/:_authToken=team-a-token`,
          "",
        ].join("\n"),
        "home/.gitkeep": "",
      });
      const [args, extraEnv] = overrideFor(registry.origin);

      const { exitCode } = await install(String(dir), [...args], { ...extraEnv });

      expect(registry.requests[0]).toEqual({ path: "/npm/team-b/no-deps", auth: null });
      expect(exitCode).toBe(1);
    },
  );

  // A bare `$VAR` registry URL is expanded only when the scope is built, so its
  // `.npmrc` line can only be found by the walk that runs after every source.
  test("a scoped registry written as $VAR picks up its .npmrc line", async () => {
    using registry = mockRegistry("Bearer corp-token", { registryPath: "/npm", packageName: "@corp/no-deps" });
    using dir = tempDir("npmrc-url-auth-env-var-scope", {
      "package.json": JSON.stringify({ name: "foo", version: "1.0.0", dependencies: { "@corp/no-deps": "1.0.0" } }),
      ".npmrc": [`@corp:registry=$CORP_REG`, `//${registry.host}/npm/:_authToken=corp-token`, ""].join("\n"),
      "home/.gitkeep": "",
    });

    const { exitCode } = await install(String(dir), [], { CORP_REG: `${registry.origin}/npm/` });

    expect(registry.requests.map(r => r.auth)).toEqual(["Bearer corp-token", "Bearer corp-token"]);
    expect(exitCode).toBe(0);
  });

  test("a bunfig registry written as $VAR picks up its .npmrc line", async () => {
    using registry = mockRegistry("Bearer corp-token", { registryPath: "/npm" });
    using dir = tempDir("npmrc-url-auth-env-var-bunfig", {
      "package.json": packageJson,
      "bunfig.toml": `[install]\nregistry = "$MY_REG"\n`,
      ".npmrc": [`//${registry.host}/npm/:_authToken=corp-token`, ""].join("\n"),
      "home/.gitkeep": "",
    });

    const { exitCode } = await install(String(dir), [], { MY_REG: `${registry.origin}/npm/` });

    expect(registry.requests.map(r => r.auth)).toEqual(["Bearer corp-token", "Bearer corp-token"]);
    expect(exitCode).toBe(0);
  });

  // `_auth` goes out as `Basic <value>` verbatim at request time too.
  test("an _auth line applies to a --registry registry and its tarball", async () => {
    const blob = "opaque-blob";
    using registry = mockRegistry(`Basic ${blob}`);
    using dir = tempDir("npmrc-url-auth-basic-cli", {
      "package.json": packageJson,
      ".npmrc": [`//${registry.host}/:_auth=${blob}`, ""].join("\n"),
      "home/.gitkeep": "",
    });

    const { exitCode } = await install(String(dir), ["--registry", `${registry.origin}/`]);

    expect(registry.requests.map(r => r.auth)).toEqual([`Basic ${blob}`, `Basic ${blob}`]);
    expect(exitCode).toBe(0);
  });

  test("an _auth line keyed to the tarball host applies to the tarball", async () => {
    const blob = "opaque-blob";
    using cdn = mockRegistry(`Basic ${blob}`, { secure: true });
    using registry = mockRegistry("Bearer registry-token", { tarballOrigin: () => cdn.origin });
    using dir = tempDir("npmrc-url-auth-basic-cdn", {
      "package.json": packageJson,
      ".npmrc": [
        `registry=${registry.origin}/`,
        `//${registry.host}/:_authToken=registry-token`,
        `//${cdn.host}/:_auth=${blob}`,
        "",
      ].join("\n"),
    });

    const { exitCode } = await install(String(dir));

    expect(cdn.requests).toEqual([{ path: "/no-deps/-/no-deps-1.0.0.tgz", auth: `Basic ${blob}` }]);
    expect(exitCode).toBe(0);
  });

  test("a query on a cross-host dist.tarball still resolves the deeper line", async () => {
    using cdn = mockRegistry("Bearer cdn-token", { secure: true, tarballPath: "/npm/x.tgz" });
    using registry = mockRegistry("Bearer registry-token", {
      tarballOrigin: () => cdn.origin,
      tarballPath: "/npm/x.tgz",
      tarballQuery: "?sig=abc",
    });
    using dir = tempDir("npmrc-url-auth-query-cdn", {
      "package.json": packageJson,
      ".npmrc": [
        `registry=${registry.origin}/`,
        `//${registry.host}/:_authToken=registry-token`,
        `//${cdn.host}/npm/:_authToken=cdn-token`,
        "",
      ].join("\n"),
    });

    const { exitCode } = await install(String(dir));

    expect(cdn.requests).toEqual([{ path: "/npm/x.tgz", auth: "Bearer cdn-token" }]);
    expect(exitCode).toBe(0);
  });

  // Bun's docs long showed the key with a scheme; npm never writes one, but it must keep
  // working. The scheme is dropped when the line is read.
  test("a key written with a scheme, as Bun's docs showed it, still applies", async () => {
    using registry = mockRegistry("Bearer docs-token");
    using dir = tempDir("npmrc-url-auth-scheme-key", {
      "package.json": packageJson,
      ".npmrc": [`registry=${registry.origin}/`, `//http://${registry.host}/:_authToken=docs-token`, ""].join("\n"),
    });

    const { exitCode } = await install(String(dir));

    expect({ requests: registry.requests, exitCode }).toEqual({
      requests: [
        { path: manifestPath, auth: "Bearer docs-token" },
        { path: tarballPath, auth: "Bearer docs-token" },
      ],
      exitCode: 0,
    });
  });

  // Rule 3: the registry's own key is already reflected in its credentials, behind a
  // bunfig, env or CLI credential, so a tarball resolving to that same key carries the
  // bunfig token, not the line's.
  test("a same-key dist.tarball carries the registry's bunfig token over the .npmrc line", async () => {
    using registry = mockRegistry("Bearer bunfig-token");
    using dir = tempDir("npmrc-url-auth-rule-3-bunfig", {
      "package.json": packageJson,
      "bunfig.toml": `[install]
registry = { url = "${registry.origin}/", token = "bunfig-token" }
`,
      ".npmrc": [`//${registry.host}/:_authToken=line-token`, ""].join("\n"),
    });

    const { exitCode } = await install(String(dir));

    expect(registry.requests.map(r => r.auth)).toEqual(["Bearer bunfig-token", "Bearer bunfig-token"]);
    expect(exitCode).toBe(0);
  });

  // A credential carried over to an env registry never goes from https to http.
  test("an env registry that downgrades the bunfig registry from https to http gets no carried-over token", async () => {
    const seen: Array<string | null> = [];
    using plain = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req) {
        seen.push(req.headers.get("authorization"));
        return new Response("not found", { status: 404 });
      },
    });
    const host = `127.0.0.1:${plain.port}`;
    using dir = tempDir("npmrc-url-auth-env-downgrade", {
      "package.json": packageJson,
      "bunfig.toml": `[install]
registry = { url = "https://${host}/", token = "https-only" }
`,
    });

    await install(String(dir), [], { NPM_CONFIG_REGISTRY: `http://${host}/` });

    expect(seen).toEqual([null]);
  });

  // `_authtoken` used to match `_auth` as a substring and go out as `Basic <token>`.
  test("a misspelt option sends nothing and warns, without printing the value", async () => {
    using registry = mockRegistry("Bearer typo-token");
    using dir = tempDir("npmrc-url-auth-typo", {
      "package.json": packageJson,
      ".npmrc": [`registry=${registry.origin}/`, `//${registry.host}/:_authtoken=typo-token`, ""].join("\n"),
    });

    const { stderr, exitCode } = await install(String(dir));

    expect(registry.requests).toEqual([{ path: manifestPath, auth: null }]);
    expect(stderr).toContain("_authtoken is not a known .npmrc option");
    expect(stderr).not.toContain("typo-token");
    expect(exitCode).toBe(1);
  });
});
