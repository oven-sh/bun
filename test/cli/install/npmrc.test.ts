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
      expect(stderr).toContain("received an empty string");
    },
  );

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
    // The `//` is stripped off the key before it is parsed as a URL, leaving
    // `[::1]:4873/`. A leading `[` used to parse to an empty host, so these keys
    // never matched the registry they were written for.
    test.each([
      ["loopback with a port", "http://[::1]:4873/", "//[::1]:4873/"],
      ["loopback without a port", "http://[::1]/", "//[::1]/"],
      ["full address with a path", "http://[2001:db8::1]:4873/npm/registry/", "//[2001:db8::1]:4873/npm/registry/"],
      ["key without the trailing slash", "http://[::1]:4873/", "//[::1]:4873"],
    ])("_authToken is applied: %s", (_, registryUrl, key) => {
      const result = loadNpmrc(`registry=${registryUrl}\n${key}:_authToken=v6-token\n`);
      expect(result).toEqual({
        default_registry_url: registryUrl,
        default_registry_token: "v6-token",
        default_registry_username: "",
        default_registry_password: "",
        default_registry_email: "",
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
      });

      const auth = Buffer.from("v6-user:v6-password").toString("base64");
      expect(loadNpmrc(`registry=http://[::1]:4873/\n//[::1]:4873/:_auth=${auth}\n`)).toEqual({
        default_registry_url: "http://[::1]:4873/",
        default_registry_token: "",
        default_registry_username: "v6-user",
        default_registry_password: "v6-password",
        default_registry_email: "",
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

  it("does not print an undecodable _password value", async () => {
    const secret = "s!ecret!pass";
    using dir = tempDir("npmrc-password-decode", {
      ".npmrc": `//registry.npmjs.org/:_password=${secret}\n`,
      "package.json": JSON.stringify({ name: "foo", version: "1.0.0" }),
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: String(dir),
      env: { ...env, NO_COLOR: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toContain("_password is not valid base64");
    expect(stderr).toContain("_password=" + Buffer.alloc(secret.length, "*").toString());
    expect(stderr).not.toContain(secret);
    expect(exitCode).toBe(0);
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
  };

  // Serves no-deps@1.0.0 and answers 401 to any request that does not carry
  // exactly `expectedAuth`.
  function mockRegistry(expectedAuth: string, options: MockRegistryOptions = {}) {
    const { tarballOrigin, registryPath = "", tarballPath = "/no-deps/-/no-deps-1.0.0.tgz", publicManifest } = options;
    const requests: Req[] = [];
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req) {
        const url = new URL(req.url);
        const auth = req.headers.get("authorization");
        requests.push({ path: url.pathname, auth });
        const isManifest = url.pathname === `${registryPath}/no-deps`;
        if (auth !== expectedAuth && !(isManifest && publicManifest)) {
          return new Response("unauthorized", { status: 401 });
        }
        if (url.pathname === tarballPath) return new Response(Bun.file(tgz));
        if (isManifest) {
          const origin = tarballOrigin ? tarballOrigin() : `http://127.0.0.1:${server.port}`;
          return Response.json({
            name: "no-deps",
            "dist-tags": { latest: "1.0.0" },
            versions: {
              "1.0.0": {
                name: "no-deps",
                version: "1.0.0",
                dist: { tarball: `${origin}${tarballPath}` },
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
      origin: `http://127.0.0.1:${server.port}`,
      [Symbol.dispose]() {
        server.stop(true);
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
      cmd: [bunExe(), "install", ...args],
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

  test("a 401 for credentials that were sent is reported without a suggestion", async () => {
    using registry = mockRegistry("Bearer the-token-the-registry-wants");
    using dir = tempDir("npmrc-url-auth-rejected", {
      "package.json": packageJson,
      ".npmrc": `//${registry.host}/:_authToken=revoked-token\n`,
    });

    const { stderr, exitCode } = await install(String(dir), ["--registry", `${registry.origin}/`]);

    expect({ requests: registry.requests, exitCode }).toEqual({
      requests: [{ path: manifestPath, auth: "Bearer revoked-token" }],
      exitCode: 1,
    });
    expect(stderr).toContain(`error: GET ${registry.origin}${manifestPath} - 401\nerror:`);
    expect(stderr).not.toContain(".npmrc");
  });

  // Tarball dependencies written as a URL never carry registry credentials, so
  // there is no .npmrc line to suggest for them.
  test("a 401 for a tarball dependency given by URL is reported without a suggestion", async () => {
    using host = mockRegistry("Bearer something");
    using dir = tempDir("npmrc-url-auth-url-dependency", {
      "package.json": JSON.stringify({
        name: "app",
        version: "1.0.0",
        dependencies: { "no-deps": `${host.origin}${tarballPath}` },
      }),
    });

    const { stderr, exitCode } = await install(String(dir));

    expect({ requests: host.requests, exitCode }).toEqual({
      requests: [{ path: tarballPath, auth: null }],
      exitCode: 1,
    });
    expect(stderr).toContain(`error: GET ${host.origin}${tarballPath} - 401\n`);
    expect(stderr).not.toContain(".npmrc");
  });

  test("a tarball on a different host than its registry gets that host's own line", async () => {
    using cdn = mockRegistry("Bearer cdn-token");
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

  test("the line with the deepest path covering the tarball url wins; other paths on the host do not apply", async () => {
    using cdn = mockRegistry("Bearer deep-token");
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
    using cdn = mockRegistry("Bearer other-token");
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
    expect(stderr).toContain(
      `error: GET ${cdn.origin}${tarballPath} - 401\n` +
        `  the credentials configured for ${registry.host} are not sent to ${cdn.host}; ` +
        `add //${cdn.host}/:_authToken=<token> to .npmrc if this host needs them\n`,
    );
  });

  test("a 401 from a registry nothing is configured for says which .npmrc line would authenticate it", async () => {
    using registry = mockRegistry("Bearer some-token");
    using dir = tempDir("npmrc-url-auth-missing-note", { "package.json": packageJson });

    const { stderr, exitCode } = await install(String(dir), ["--registry", `${registry.origin}/`]);

    expect(registry.requests).toEqual([{ path: manifestPath, auth: null }]);
    expect(stderr).toContain(
      `error: GET ${registry.origin}${manifestPath} - 401\n` +
        `  no credentials are configured for this registry; add //${registry.host}/:_authToken=<token> to .npmrc\n`,
    );
    expect(exitCode).toBe(1);
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
    using oldRegistry = mockRegistry("Bearer old-token");
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
});
