import { write } from "bun";
import { afterAll, beforeAll, describe, expect, it, test } from "bun:test";
import { chmodSync, mkdirSync, readdirSync, writeFileSync } from "fs";
import { rm } from "fs/promises";
import { bunEnv, bunExe, isIPv6, isLinux, isWindows, tempDir, tls, unprivilegedSpawnOptions } from "harness";
import { createServer as createTlsServer } from "node:tls";
import { dirname, join } from "path";
import { TestRegistry } from "registry";
const { iniInternals } = require("bun:internal-for-testing");
const { loadNpmrc } = iniInternals;

// It replaces `$HOME/.npmrc` (actions/setup-node exports it), so pointing HOME at a directory of the test would isolate nothing.
const { NPM_CONFIG_USERCONFIG, npm_config_userconfig, ...env } = bunEnv;

var registry = new TestRegistry();

beforeAll(async () => {
  await registry.start();
});

afterAll(() => {
  registry.stop();
});

describe.concurrent("npmrc", async () => {
  const isBase64Encoded = (opt: string) => opt === "_auth" || opt === "_password";

  // Each install gets its own cache and user config directory (`<packageDir>/home_dir`, which doesn't exist unless the
  // case creates it). These cases delete the bunfig.toml that configures a cache, so they would share
  // $BUN_INSTALL_CACHE_DIR, and an install whose credentials the registry refuses would succeed with what an earlier
  // case downloaded.
  function installEnv(packageDir: string, extra: Record<string, string> = {}) {
    const home = join(packageDir, "home_dir");
    return {
      ...env,
      BUN_INSTALL_CACHE_DIR: join(packageDir, ".bun-cache"),
      HOME: home,
      USERPROFILE: home,
      XDG_CONFIG_HOME: home,
      ...extra,
    };
  }

  it("should convert to utf8 if BOM", async () => {
    const { packageDir, packageJson } = await registry.createTestDir();

    await Promise.all([
      write(join(packageDir, ".npmrc"), Buffer.from(`\ufeff\ncache=hi!`, "utf16le")),
      write(packageJson, JSON.stringify({ name: "foo", version: "1.0.0" })),
      rm(join(packageDir, "bunfig.toml"), { force: true }),
    ]);

    // It would win over `cache`.
    const { BUN_INSTALL_CACHE_DIR, ...withoutCacheDir } = installEnv(packageDir);
    const { stdout, stderr, exited } = Bun.spawn({
      cmd: [bunExe(), "pm", "cache"],
      cwd: packageDir,
      env: withoutCacheDir,
      stdout: "pipe",
      stderr: "pipe",
    });

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
    await Bun.$`${bunExe()} install`.env(installEnv(packageDir)).cwd(packageDir).throws(true);
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
    await Bun.$`${bunExe()} install`.env(installEnv(packageDir)).cwd(packageDir).throws(true);
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
    await Bun.$`${bunExe()} install`.env(installEnv(packageDir)).cwd(packageDir).throws(true);
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
    await Bun.$`${bunExe()} install`.env(installEnv(packageDir)).cwd(packageDir).throws(true);
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
    await Bun.$`${bunExe()} install`.env(installEnv(packageDir)).cwd(packageDir).throws(true);
  });

  describe("user .npmrc lookup", () => {
    const npmrc = (port: number) => `registry=http://localhost:${port}/\n//localhost:${port}/:_authToken=token\n`;
    const pkg = { "pkg/package.json": JSON.stringify({ name: "npmrc-lookup", version: "0.0.1" }) };

    // bunEnv spreads process.env, and CI runners commonly export XDG_CONFIG_HOME or
    // (via actions/setup-node) NPM_CONFIG_USERCONFIG, so both are removed here and each
    // case passes back exactly the variables it is testing.
    async function bun(dir: string, envOverride: Record<string, string>, ...cmd: string[]) {
      const spawnEnv: typeof env = { ...env, HOME: join(dir, "home"), USERPROFILE: join(dir, "home") };
      delete spawnEnv.XDG_CONFIG_HOME;
      delete spawnEnv.NPM_CONFIG_USERCONFIG;
      delete spawnEnv.npm_config_userconfig;

      await using proc = Bun.spawn({
        cmd: [bunExe(), ...cmd],
        cwd: join(dir, "pkg"),
        env: { ...spawnEnv, ...envOverride },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stdout, stderr, exitCode };
    }
    const publish = (dir: string, envOverride: Record<string, string>, ...args: string[]) =>
      bun(dir, envOverride, "publish", ...args);

    // `publish --dry-run` never contacts the registry, but it still requires a token
    // for it and prints which registry it picked up, so it shows which .npmrc was read.
    const publishDryRun = (dir: string, envOverride: Record<string, string>) => publish(dir, envOverride, "--dry-run");

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

    it.concurrent("fails without a user .npmrc, which is what makes the cases above meaningful", async () => {
      using dir = tempDir("npmrc-xdg-none", { ...pkg, "home/.keep": "", "xdg/.keep": "" });
      const result = await publishDryRun(String(dir), { XDG_CONFIG_HOME: join(String(dir), "xdg") });
      expect(result.stderr).toContain("missing authentication");
      expect(result.exitCode).toBe(1);
    });

    // npm's `userconfig` option: the path of the per-user .npmrc, settable through
    // NPM_CONFIG_USERCONFIG like any other npm config option.
    it.concurrent("uses $NPM_CONFIG_USERCONFIG instead of $XDG_CONFIG_HOME/.npmrc and $HOME/.npmrc", async () => {
      using dir = tempDir("npmrc-userconfig", {
        ...pkg,
        "home/.npmrc": npmrc(1),
        "xdg/.npmrc": npmrc(2),
        "elsewhere/ci.npmrc": npmrc(3),
      });
      const result = await publishDryRun(String(dir), {
        XDG_CONFIG_HOME: join(String(dir), "xdg"),
        NPM_CONFIG_USERCONFIG: join(String(dir), "elsewhere", "ci.npmrc"),
      });
      expect(result).toEqual(usesRegistry(3));
    });

    it.concurrent("accepts lowercase $npm_config_userconfig", async () => {
      using dir = tempDir("npmrc-userconfig-lowercase", {
        ...pkg,
        "home/.npmrc": npmrc(1),
        "elsewhere/ci.npmrc": npmrc(2),
      });
      const result = await publishDryRun(String(dir), {
        npm_config_userconfig: join(String(dir), "elsewhere", "ci.npmrc"),
      });
      expect(result).toEqual(usesRegistry(2));
    });

    it.concurrent("uses $HOME/.npmrc when $NPM_CONFIG_USERCONFIG is empty", async () => {
      using dir = tempDir("npmrc-userconfig-empty", { ...pkg, "home/.npmrc": npmrc(1) });
      const result = await publishDryRun(String(dir), { NPM_CONFIG_USERCONFIG: "" });
      expect(result).toEqual(usesRegistry(1));
    });

    // npm has no user config at all if `userconfig` points to a missing file. It doesn't fall back to ~/.npmrc.
    it.concurrent("does not fall back to $HOME/.npmrc when $NPM_CONFIG_USERCONFIG does not exist", async () => {
      using dir = tempDir("npmrc-userconfig-missing", { ...pkg, "home/.npmrc": npmrc(1) });
      const result = await publishDryRun(String(dir), {
        NPM_CONFIG_USERCONFIG: join(String(dir), "elsewhere", "missing.npmrc"),
      });
      expect(result.stderr).toContain("missing authentication");
      expect(result.exitCode).toBe(1);
    });

    // Dotfiles often point it at $XDG_CONFIG_HOME/npm/npmrc, which need not be there.
    it.concurrent("bun install prints nothing when $NPM_CONFIG_USERCONFIG does not exist", async () => {
      using dir = tempDir("npmrc-userconfig-missing-install", { ...pkg, "home/.keep": "" });
      const missing = join(String(dir), "elsewhere", "missing.npmrc");
      const result = await bun(String(dir), { NPM_CONFIG_USERCONFIG: missing }, "install");
      expect(result.stderr).not.toContain("warn:");
      expect(result.stderr).not.toContain("error:");
      expect(result.exitCode).toBe(0);
    });

    it.skipIf(isWindows)("bun install prints nothing when $NPM_CONFIG_USERCONFIG is a directory", async () => {
      using dir = tempDir("npmrc-userconfig-directory", { ...pkg, "home/.keep": "", "elsewhere/ci.npmrc/.keep": "" });
      const directory = join(String(dir), "elsewhere", "ci.npmrc");
      const result = await bun(String(dir), { NPM_CONFIG_USERCONFIG: directory }, "install");
      expect(result.stderr).not.toContain("warn:");
      expect(result.stderr).not.toContain("error:");
      expect(result.exitCode).toBe(0);
    });

    it.concurrent.each(["NPM_CONFIG_USERCONFIG", "npm_config_userconfig"])(
      "a leading ~/ in $%s is the home directory",
      async name => {
        using dir = tempDir("npmrc-userconfig-home", { ...pkg, "home/.npmrc": npmrc(1), "home/ci.npmrc": npmrc(2) });
        const result = await publishDryRun(String(dir), { [name]: "~/ci.npmrc" });
        expect(result).toEqual(usesRegistry(2));
      },
    );

    it.concurrent("resolves a relative $NPM_CONFIG_USERCONFIG against the directory bun was started in", async () => {
      using dir = tempDir("npmrc-userconfig-relative", {
        "package.json": JSON.stringify({ name: "root", private: true, workspaces: ["pkg"] }),
        ...pkg,
        "ci.npmrc": npmrc(1),
        "pkg/ci.npmrc": npmrc(2),
        "home/.npmrc": npmrc(3),
      });
      // `publish` runs from the workspace member `pkg/`.
      const result = await publishDryRun(String(dir), { NPM_CONFIG_USERCONFIG: "ci.npmrc" });
      expect(result).toEqual(usesRegistry(2));
    });

    it.concurrent("the project .npmrc still overrides $NPM_CONFIG_USERCONFIG", async () => {
      using dir = tempDir("npmrc-userconfig-project", {
        ...pkg,
        "elsewhere/ci.npmrc": npmrc(1),
        "pkg/.npmrc": npmrc(2),
      });
      const result = await publishDryRun(String(dir), {
        NPM_CONFIG_USERCONFIG: join(String(dir), "elsewhere", "ci.npmrc"),
      });
      expect(result).toEqual(usesRegistry(2));
    });

    // https://github.com/oven-sh/bun/issues/14824: actions/setup-node with `registry-url`
    // writes $RUNNER_TEMP/.npmrc with the contents below and exports NPM_CONFIG_USERCONFIG
    // pointing at it; the token itself is only present as $NODE_AUTH_TOKEN.
    it.concurrent("reads the .npmrc written by actions/setup-node, expanding ${NODE_AUTH_TOKEN}", async () => {
      const { promise: authorization, resolve } = Promise.withResolvers<string | null>();
      using mockRegistry = Bun.serve({
        port: 0,
        fetch(req) {
          resolve(req.headers.get("authorization"));
          return new Response("{}");
        },
      });
      const { port } = mockRegistry;
      using dir = tempDir("npmrc-setup-node", {
        ...pkg,
        "runner-temp/.npmrc": `//localhost:${port}/:_authToken=\${NODE_AUTH_TOKEN}\nregistry=http://localhost:${port}/\nalways-auth=true\n`,
      });
      const result = await publish(String(dir), {
        NPM_CONFIG_USERCONFIG: join(String(dir), "runner-temp", ".npmrc"),
        NODE_AUTH_TOKEN: "npm_token-from-the-workflow-env",
      });
      expect(result).toEqual({
        stdout: expect.stringContaining(" + npmrc-lookup@0.0.1\n"),
        stderr: "",
        exitCode: 0,
      });
      expect(await authorization).toBe("Bearer npm_token-from-the-workflow-env");
    });

    // The candidate paths are built in a buffer of MAX_PATH_BYTES (4096 on Linux, 1024 on the
    // other POSIX platforms; on Windows it is larger than any environment variable can be), so
    // the longest directory whose "/.npmrc" and NUL terminator still fit is MAX_PATH_BYTES - 8
    // bytes. A longer directory cannot contain an openable .npmrc and counts as having none.
    describe.skipIf(isWindows)("$HOME longer than the path buffer", () => {
      const MAX_PATH_BYTES = isLinux ? 4096 : 1024;
      const LONGEST_HOME = MAX_PATH_BYTES - 8;

      // xdg/ has no .npmrc, so the lookup falls through to $HOME. The global bunfig.toml lookup
      // starts at $XDG_CONFIG_HOME too; the bunfig there keeps it away from the oversized $HOME,
      // which is not what is under test here.
      const xdg = { "xdg/.bunfig.toml": "" };
      const envWith = (dir: string, home: string) => ({ XDG_CONFIG_HOME: join(dir, "xdg"), HOME: home });

      // An absolute path of exactly `length` bytes. Nothing exists there.
      const missingHome = (length: number) => "/" + Buffer.alloc(length - 1, "a").toString();

      it.concurrent("reads $HOME/.npmrc from the longest $HOME that fits", async () => {
        using dir = tempDir("npmrc-home-longest", { ...pkg, ...xdg });
        // Pad `<dir>/home/` out to exactly LONGEST_HOME bytes with nested directories of 200
        // bytes each (NAME_MAX is 255); the last byte is never a separator.
        const prefix = join(String(dir), "home") + "/";
        const padding = Buffer.alloc(LONGEST_HOME - Buffer.byteLength(prefix), "a");
        for (let i = 200; i < padding.length - 1; i += 201) padding[i] = "/".charCodeAt(0);
        const home = prefix + padding.toString();
        expect(Buffer.byteLength(home)).toBe(LONGEST_HOME);
        mkdirSync(home, { recursive: true });
        writeFileSync(join(home, ".npmrc"), npmrc(1));

        const result = await publishDryRun(String(dir), envWith(String(dir), home));
        expect(result).toEqual(usesRegistry(1));
      });

      // The project .npmrc is the only one left, and shows the command still ran normally.
      it.concurrent("skips a $HOME one byte longer than fits", async () => {
        using dir = tempDir("npmrc-home-one-too-long", { ...pkg, ...xdg, "pkg/.npmrc": npmrc(3) });
        const result = await publishDryRun(String(dir), envWith(String(dir), missingHome(LONGEST_HOME + 1)));
        expect(result).toEqual(usesRegistry(3));
      });

      it.concurrent("skips a $HOME longer than the whole buffer", async () => {
        using dir = tempDir("npmrc-home-too-long", { ...pkg, ...xdg, "pkg/.npmrc": npmrc(3) });
        const result = await publishDryRun(String(dir), envWith(String(dir), missingHome(MAX_PATH_BYTES + 1000)));
        expect(result).toEqual(usesRegistry(3));
      });
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
    const homeIni = /* ini */ "@types:registry=http://localhost:1/";
    await Bun.$`echo ${homeIni} > ${homeDir}/.npmrc`;

    await Bun.$`echo ${JSON.stringify({
      name: "foo",
      dependencies: {
        "@types/no-deps": "1.0.0",
      },
    })} > package.json`.cwd(packageDir);
    await Bun.$`${bunExe()} install`.env(installEnv(packageDir)).cwd(packageDir).throws(true);
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

    await Bun.$`${bunExe()} install`.env(installEnv(packageDir)).cwd(packageDir).throws(true);
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
    check?: (stdout: string, stderr: string, exitCode: number) => void,
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

      const { stdout, stderr, exitCode } = await Bun.$`${bunExe()} install`
        .env(installEnv(packageDir, restOfEnv))
        .cwd(packageDir)
        .throws(check === undefined);

      if (check) check(stdout.toString(), stderr.toString(), exitCode);
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
    (stdout: string, stderr: string, exitCode: number) => {
      expect(stderr).toContain("ignoring empty _auth value");
      // The empty `_auth` is dropped, so the request carries no credentials and the registry refuses it.
      expect(stderr).toContain("error: @needs-auth/test-pkg@1.0.0 failed to resolve");
      expect(exitCode).toBe(1);
    },
  );

  describe("empty _auth across the home and project .npmrc", () => {
    const blob = Buffer.from("alice:s3cret").toString("base64");

    // Returns true if the empty-`_auth` diagnostic was printed. The install itself has to succeed either way.
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
      return stderr.includes("ignoring empty _auth value");
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
      // The address ends in the digits of the scheme's default port, but they aren't a port.
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

  describe("protocol-relative registry value", () => {
    // `registry=//host/path/` is kept as written and matched against the credential
    // keys by host and pathname. It used to parse with an empty host and `/host/path/`
    // as its pathname, so no key could match it.
    test.each([
      ["host only", "//registry.example.com/", "//registry.example.com/"],
      ["host with a port and a path", "//registry.example.com:8080/npm/", "//registry.example.com:8080/npm/"],
      ["key without the trailing slash", "//registry.example.com:8080/npm/", "//registry.example.com:8080/npm"],
      ["host-root key for a registry under a path", "//registry.example.com:8080/npm/", "//registry.example.com:8080/"],
    ])("_authToken is applied: %s", (_, registryUrl, key) => {
      expect(loadNpmrc(`registry=${registryUrl}\n${key}:_authToken=rel-token\n`)).toEqual({
        default_registry_url: registryUrl,
        default_registry_token: "rel-token",
        default_registry_username: "",
        default_registry_password: "",
        default_registry_auth: "",
      });
    });

    test.each([
      ["a different port", "//registry.example.com:9090/npm/"],
      ["a different host", "//other.example.com:8080/npm/"],
      ["a sibling path", "//registry.example.com:8080/other/"],
    ])("a key for %s is not applied", (_, key) => {
      const result = loadNpmrc(`registry=//registry.example.com:8080/npm/\n${key}:_authToken=rel-token\n`);
      expect(result.default_registry_url).toBe("//registry.example.com:8080/npm/");
      expect(result.default_registry_token).toBe("");
    });

    // No scheme is made up for `//`. Bun never requests such a URL, so the credential isn't sent anywhere.
    test.each([
      ["http://", "http://registry.example.com/npm/"],
      ["//", "registry.example.com/npm/"],
    ])("credentials embedded in a %sregistry value are split out of the URL", (prefix, url) => {
      expect(loadNpmrc(`registry=${prefix}:embedded-token@registry.example.com/npm/\n`)).toEqual({
        default_registry_url: url,
        default_registry_token: "embedded-token",
        default_registry_username: "",
        default_registry_password: "",
        default_registry_auth: "",
      });

      expect(loadNpmrc(`registry=${prefix}embedded-user:embedded-password@registry.example.com/npm/\n`)).toEqual({
        default_registry_url: url,
        default_registry_token: "",
        default_registry_username: "embedded-user",
        default_registry_password: "embedded-password",
        default_registry_auth: "",
      });
    });
  });

  test.each(["a", "ab"])("a credential key for the host %j is applied to registry=http://<host>/", host => {
    // The `//a/` key is stripped to `a/` before it is parsed. A second byte of `/` used to
    // be taken as the start of a protocol-relative URL, leaving the key with an empty host.
    expect(loadNpmrc(`registry=http://${host}/\n//${host}/:_authToken=${host}-token\n`)).toEqual({
      default_registry_url: `http://${host}/`,
      default_registry_token: `${host}-token`,
      default_registry_username: "",
      default_registry_password: "",
      default_registry_auth: "",
    });
  });

  describe("credentials written into the registry= URL", () => {
    // `http://user@host/` is `user` with an empty password (what `new URL()` reports and what npm
    // authenticates with). A `username` on its own means nothing, so it is kept as the `_auth` it amounts to.
    const carol = Buffer.from("carol:").toString("base64");
    test.each([
      [
        "user:pass@ is split into a username and a password",
        "http://carol:s3cret@example.com/npm/",
        "carol",
        "s3cret",
        "",
      ],
      ["user@ is a username with an empty password", "http://carol@example.com/npm/", "", "", carol],
      ["user:@ is a username with an empty password", "http://carol:@example.com/npm/", "", "", carol],
    ])("%s", (_, registryUrl, username, password, auth) => {
      expect(loadNpmrc(`registry=${registryUrl}\n`)).toEqual({
        default_registry_url: "http://example.com/npm/",
        default_registry_token: "",
        default_registry_username: username,
        default_registry_password: password,
        default_registry_auth: auth,
      });
    });

    test("a password without a username is a token", () => {
      expect(loadNpmrc(`registry=http://:s3cret@example.com/npm/\n`)).toEqual({
        default_registry_url: "http://example.com/npm/",
        default_registry_token: "s3cret",
        default_registry_username: "",
        default_registry_password: "",
        default_registry_auth: "",
      });
    });

    test("a URL without credentials is kept as written", () => {
      expect(loadNpmrc(`registry=http://example.com/npm\n`).default_registry_url).toBe("http://example.com/npm");
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
    expect(stderr).toContain("ignoring empty _auth value");
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

    // These values contain no local identity, so the credential is sent to the registry as written, and the registry
    // responds. It used to give up with "missing authentication".
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

describe.concurrent("registry URL with embedded credentials", () => {
  // Credentials written into the registry URL are split off and the URL is
  // stored without them. The stored URL is what requests are built from and
  // what error messages print, so a registry at the root of its host has to
  // come back as "http://host/", not "http://host//".
  test.each([
    ["http://alice:s3cret@registry.example.com/", "http://registry.example.com/"],
    ["http://alice:s3cret@registry.example.com", "http://registry.example.com/"],
    ["http://alice:s3cret@registry.example.com:8080", "http://registry.example.com:8080/"],
    ["http://alice:s3cret@registry.example.com/npm/", "http://registry.example.com/npm/"],
    ["http://alice:s3cret@registry.example.com/npm", "http://registry.example.com/npm/"],
  ])("registry=%s is stored as %s", (registry, url) => {
    expect(loadNpmrc(`registry=${registry}\n`)).toMatchObject({
      default_registry_url: url,
      default_registry_username: "alice",
      default_registry_password: "s3cret",
    });
  });

  test.each([
    ["http://:tok@registry.example.com/", "http://registry.example.com/"],
    ["http://:tok@registry.example.com:8080", "http://registry.example.com:8080/"],
    ["http://:tok@registry.example.com:8080/a/b/", "http://registry.example.com:8080/a/b/"],
  ])("registry=%s is stored as %s", (registry, url) => {
    expect(loadNpmrc(`registry=${registry}\n`)).toMatchObject({
      default_registry_url: url,
      default_registry_token: "tok",
    });
  });

  type Req = { path: string; auth: string | null };

  function mockRegistry(reqs: Req[], respond: () => Response) {
    return Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req) {
        reqs.push({ path: new URL(req.url).pathname, auth: req.headers.get("authorization") });
        return respond();
      },
    });
  }

  async function run(dir: string, ...args: string[]) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...args],
      cwd: dir,
      env: { ...env, BUN_INSTALL_CACHE_DIR: join(dir, ".cache") },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stderr, exitCode };
  }

  // The documented bunfig form for a token: the token rides on the end of the
  // URL's path. `bun pm whoami` prints the stored URL verbatim when the
  // registry does not return a username.
  test.each([
    ["/", "/-/whoami"],
    ["/npm/", "/npm/-/whoami"],
  ])("_authToken= appended to a bunfig.toml registry URL with path %s", async (path, whoami) => {
    const reqs: Req[] = [];
    await using server = mockRegistry(reqs, () => Response.json({}));
    const base = `http://127.0.0.1:${server.port}${path}`;
    using dir = tempDir("bunfig-authtoken-suffix", {
      "bunfig.toml": `[install.registry]\nurl = "${base}_authToken=tok"\n`,
      "package.json": JSON.stringify({ name: "app" }),
    });

    const { stderr, exitCode } = await run(String(dir), "pm", "whoami");

    expect(stderr).toBe(`error: failed to authenticate with registry '${base}'\n`);
    expect(reqs).toEqual([{ path: whoami, auth: "Bearer tok" }]);
    expect(exitCode).toBe(1);
  });

  test("username:password in the .npmrc registry URL", async () => {
    const reqs: Req[] = [];
    await using server = mockRegistry(reqs, () => new Response("unauthorized", { status: 401 }));
    using dir = tempDir("npmrc-userinfo", {
      ".npmrc": `registry=http://alice:s3cret@127.0.0.1:${server.port}/\n`,
      "package.json": JSON.stringify({ name: "app", dependencies: { "needs-creds": "1.0.0" } }),
    });

    const { stderr, exitCode } = await run(String(dir), "install");

    expect(stderr.split(/\r?\n/)).toContain(`error: GET http://127.0.0.1:${server.port}/needs-creds - 401`);
    expect(reqs).toEqual([{ path: "/needs-creds", auth: `Basic ${Buffer.from("alice:s3cret").toString("base64")}` }]);
    expect(exitCode).toBe(1);
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
    // The install fails, because probe doesn't exist. Only the host that was asked matters.
    const [, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(exitCode).not.toBe(0);

    // scopeB's registry must never see the @scopeA/probe request, and must
    // never be handed scopeB's secret token for it.
    expect(reqsB).toEqual([]);
    // The request must have been attempted against scopeA's own registry.
    expect(reqsA.some(r => r.path.includes("probe"))).toBe(true);
  });
});

// https://github.com/oven-sh/bun/issues/30311
// npm resolves `.npmrc` credentials by walking UP the registry URL's path
// segments and applying the LONGEST matching ancestor. A bare string prefix
// (`/projects/12` for `/projects/123/...`) is NOT an ancestor and must not match.
describe.concurrent(".npmrc auth resolves by path-segment ancestor", () => {
  const scope = "myorg";
  const registryPath = "/api/v4/projects/123/packages/npm/";

  type ProbeOptions = {
    /** `@myorg:registry=` (the default) or the unscoped `registry=` line. */
    registry?: "scoped" | "default";
    /** Userinfo embedded in the registry URL, e.g. `"user:pass@"`. */
    userinfo?: string;
    /** Declare the registry in `bunfig.toml` with this token instead of in `.npmrc`. */
    bunfigToken?: string;
    /** Declare the registry in `bunfig.toml` with these credentials instead of in `.npmrc`. */
    bunfigBasic?: { username: string; password: string };
    /** Declare the registry in `bunfig.toml` with no credentials, leaving them to `.npmrc`. */
    bunfigBare?: true;
    /** Lines for `$HOME/.npmrc`, which npm/Bun read before the project's `.npmrc`. */
    homeNpmrc?: (host: string) => string;
    /** The registry's path. Both the registry line and the manifest request use it. */
    path?: string;
  };

  // Runs `bun install` against a local registry mounted at `registryPath` and
  // returns the `Authorization` header it received (or null).
  async function probeAuthorization(
    authLines: (host: string) => string,
    {
      registry: registryKind = "scoped",
      userinfo = "",
      bunfigToken,
      bunfigBasic,
      bunfigBare,
      homeNpmrc,
      path: regPath = registryPath,
    }: ProbeOptions = {},
  ): Promise<string | null> {
    const scoped = registryKind === "scoped";
    const depName = scoped ? `@${scope}/pkg` : "pkg";
    const manifestPath = `${regPath}${scoped ? `@${scope}%2fpkg` : "pkg"}`;
    const authorizations: (string | null)[] = [];
    const paths: string[] = [];

    await using registry = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req) {
        paths.push(new URL(req.url).pathname);
        authorizations.push(req.headers.get("authorization"));
        return new Response("not found", { status: 404 });
      },
    });

    const host = `127.0.0.1:${registry.port}`;
    const registryUrl = `http://${userinfo}${host}${regPath}`;
    const registryLine = scoped ? `@${scope}:registry=${registryUrl}` : `registry=${registryUrl}`;

    // A `registry=` line in `.npmrc` replaces the registry it names, discarding the
    // credentials `bunfig.toml` gave it, so the two spellings are exclusive.
    const inBunfig = bunfigToken !== undefined || bunfigBasic !== undefined || bunfigBare === true;
    const files: Record<string, string> = {
      ".npmrc": `${inBunfig ? "" : `${registryLine}\n`}${authLines(host)}\n`,
      "package.json": JSON.stringify({
        name: "probe",
        version: "0.0.0",
        dependencies: { [depName]: "1.0.0" },
      }),
      // `HOME` points here, not at the project dir: pointing it at the project would
      // load the same `.npmrc` twice and hide cross-file resolution bugs.
      ...(homeNpmrc ? { "home/.npmrc": `${homeNpmrc(host)}\n` } : { "home/.gitkeep": "" }),
    };
    if (inBunfig) {
      const creds =
        bunfigToken !== undefined
          ? { token: bunfigToken }
          : bunfigBasic !== undefined
            ? { username: bunfigBasic.username, password: bunfigBasic.password }
            : {};
      const registryEntry = { url: registryUrl, ...creds };
      files["bunfig.toml"] = Bun.TOML.stringify(
        scoped ? { install: { scopes: { [scope]: registryEntry } } } : { install: { registry: registryEntry } },
      );
    }

    using dir = tempDir("npmrc-auth-ancestor", files);
    const home = join(String(dir), "home");

    await using proc = Bun.spawn({
      cmd: [bunExe(), "install", "--no-cache"],
      cwd: String(dir),
      // Uses an empty home directory, because the developer's own `.npmrc` may have a `registry=` that would replace
      // the one being tested.
      env: { ...env, HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: home },
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // The manifest request must actually have reached our registry, otherwise
    // the assertions below would be vacuous.
    expect({ paths, saw404: stderr.includes("404"), startedInstall: stdout.includes("bun install") }).toEqual({
      paths: [manifestPath],
      saw404: true,
      startedInstall: true,
    });
    expect(exitCode).not.toBe(0);

    return authorizations[0]!;
  }

  const token = "walkup-secret-token";
  const b64 = (s: string) => Buffer.from(s).toString("base64");

  // Matrix measured against npm 10.9.3 / 11.15.0 for registry pathname
  // `/api/v4/projects/123/packages/npm/`.
  const matrix: Array<[name: string, confPath: string, expected: string | null]> = [
    ["host root", "/", `Bearer ${token}`],
    ["shallow ancestor", "/api/", `Bearer ${token}`],
    ["mid ancestor", "/api/v4/projects/", `Bearer ${token}`],
    ["exact match with trailing slash", registryPath, `Bearer ${token}`],
    ["exact match without trailing slash", registryPath.slice(0, -1), `Bearer ${token}`],
    // SECURITY: `/api/v4/projects/12` is a string prefix of the registry path
    // but not a path-segment ancestor. A `startsWith` implementation leaks
    // project 123's credentials to whoever controls project 12.
    ["string prefix, not an ancestor (trailing slash)", "/api/v4/projects/12/", null],
    ["string prefix, not an ancestor (no trailing slash)", "/api/v4/projects/12", null],
    ["unrelated sibling path", "/api/v4/projects/123/packages/other/", null],
    ["deeper than the registry path", `${registryPath}deeper/`, null],
  ];

  it.each(matrix)("%s", async (_name, confPath, expected) => {
    const auth = await probeAuthorization(host => `//${host}${confPath}:_authToken=${token}`);
    expect(auth).toBe(expected);
  });

  // Longest ancestor wins, independent of the order the lines appear in.
  it("longest match wins: root then deep", async () => {
    const auth = await probeAuthorization(
      host => `//${host}/:_authToken=ROOT\n//${host}${registryPath}:_authToken=DEEP`,
    );
    expect(auth).toBe("Bearer DEEP");
  });

  it("longest match wins: deep then root", async () => {
    const auth = await probeAuthorization(
      host => `//${host}${registryPath}:_authToken=DEEP\n//${host}/:_authToken=ROOT`,
    );
    expect(auth).toBe("Bearer DEEP");
  });

  it("longest match wins: mid ancestor beats root", async () => {
    const auth = await probeAuthorization(host => `//${host}/api/v4/:_authToken=MID\n//${host}/:_authToken=ROOT`);
    expect(auth).toBe("Bearer MID");
  });

  it("longest match wins: non-ancestor deeper line does not shadow the root line", async () => {
    const auth = await probeAuthorization(
      host => `//${host}/:_authToken=ROOT\n//${host}/api/v4/projects/12/:_authToken=ATTACKER`,
    );
    expect(auth).toBe("Bearer ROOT");
  });

  // Ancestor matching governs the whole config item, not just `_authToken`.
  it("walks up for _auth", async () => {
    const basic = Buffer.from("linus:verysecure").toString("base64");
    const auth = await probeAuthorization(host => `//${host}/:_auth=${basic}`);
    expect(auth).toBe(`Basic ${basic}`);
  });

  it("walks up for username + _password", async () => {
    const password = Buffer.from("verysecure").toString("base64");
    const auth = await probeAuthorization(host => `//${host}/:username=gandalf\n//${host}/:_password=${password}`);
    expect(auth).toBe(`Basic ${Buffer.from("gandalf:verysecure").toString("base64")}`);
  });

  it("sends no Authorization header when no config item matches the host", async () => {
    const auth = await probeAuthorization(() => `//other.example.com/:_authToken=${token}`);
    expect(auth).toBe(null);
  });

  // Measured against npm 10.9.3 and 11.15.0: npm picks ONE config path per
  // registry — the deepest ancestor carrying `_authToken`, `_auth`, or a complete
  // `username` + `_password` pair — and reads every credential from that path
  // alone. Options are never resolved independently of each other. Within that one
  // path npm's `Auth` ctor picks by precedence, not file order:
  // `_authToken` > `_auth` > `username` + `_password`.
  describe("credentials resolve per config path, not per option", () => {
    const password = Buffer.from("verysecure").toString("base64");
    const basic = Buffer.from("gandalf:verysecure").toString("base64");
    const frodo = Buffer.from("frodo:onering").toString("base64");

    it("a split username/_password pair authenticates with neither", async () => {
      const auth = await probeAuthorization(
        host => `//${host}/:username=gandalf\n//${host}${registryPath}:_password=${password}`,
      );
      expect(auth).toBe(null);
    });

    it("a split _password/username pair authenticates with neither", async () => {
      const auth = await probeAuthorization(
        host => `//${host}${registryPath}:username=gandalf\n//${host}/:_password=${password}`,
      );
      expect(auth).toBe(null);
    });

    it("a deeper username + _password shadows a shallower _authToken", async () => {
      const auth = await probeAuthorization(
        host =>
          `//${host}/:_authToken=ROOT\n//${host}${registryPath}:username=gandalf\n//${host}${registryPath}:_password=${password}`,
      );
      expect(auth).toBe(`Basic ${basic}`);
    });

    it("a deeper _authToken shadows a shallower username + _password", async () => {
      const auth = await probeAuthorization(
        host =>
          `//${host}${registryPath}:_authToken=DEEP\n//${host}/:username=gandalf\n//${host}/:_password=${password}`,
      );
      expect(auth).toBe("Bearer DEEP");
    });

    it("a deeper _auth shadows a shallower _authToken", async () => {
      const auth = await probeAuthorization(
        host => `//${host}/:_authToken=ROOT\n//${host}${registryPath}:_auth=${basic}`,
      );
      expect(auth).toBe(`Basic ${basic}`);
    });

    // Same path, both credentials: npm's `Auth` ctor is
    // `if (token) … else if (auth) … else if (username && password)`, so `_auth`
    // wins no matter which line the file lists first.
    it("_auth beats username + _password at the same path: _auth first", async () => {
      const auth = await probeAuthorization(
        host => `//${host}/:_auth=${frodo}\n//${host}/:username=gandalf\n//${host}/:_password=${password}`,
      );
      expect(auth).toBe(`Basic ${frodo}`);
    });

    it("_auth beats username + _password at the same path: username first", async () => {
      const auth = await probeAuthorization(
        host => `//${host}/:username=gandalf\n//${host}/:_password=${password}\n//${host}/:_auth=${frodo}`,
      );
      expect(auth).toBe(`Basic ${frodo}`);
    });

    // `if (token)` comes before `else if (auth)`, so `_authToken` wins over
    // `_auth` at the same path regardless of line order.
    it("_authToken beats _auth at the same path: _authToken first", async () => {
      const auth = await probeAuthorization(host => `//${host}/:_authToken=TOKEN\n//${host}/:_auth=${frodo}`);
      expect(auth).toBe("Bearer TOKEN");
    });

    it("_authToken beats _auth at the same path: _auth first", async () => {
      const auth = await probeAuthorization(host => `//${host}/:_auth=${frodo}\n//${host}/:_authToken=TOKEN`);
      expect(auth).toBe("Bearer TOKEN");
    });

    it("_authToken beats username + _password at the same path: _authToken first", async () => {
      const auth = await probeAuthorization(
        host => `//${host}/:_authToken=TOKEN\n//${host}/:username=gandalf\n//${host}/:_password=${password}`,
      );
      expect(auth).toBe("Bearer TOKEN");
    });

    it("_authToken beats username + _password at the same path: username first", async () => {
      const auth = await probeAuthorization(
        host => `//${host}/:username=gandalf\n//${host}/:_password=${password}\n//${host}/:_authToken=TOKEN`,
      );
      expect(auth).toBe("Bearer TOKEN");
    });

    it("a deeper email is not a credential and does not shadow a shallower _authToken", async () => {
      const auth = await probeAuthorization(
        host => `//${host}/:_authToken=ROOT\n//${host}${registryPath}:email=gandalf@example.com`,
      );
      expect(auth).toBe("Bearer ROOT");
    });

    it("a deeper username without a _password does not shadow a shallower _authToken", async () => {
      const auth = await probeAuthorization(
        host => `//${host}/:_authToken=ROOT\n//${host}${registryPath}:username=gandalf`,
      );
      expect(auth).toBe("Bearer ROOT");
    });

    it("a deeper username without a _password does not shadow a shallower username + _password", async () => {
      const auth = await probeAuthorization(
        host =>
          `//${host}/:username=gandalf\n//${host}/:_password=${password}\n//${host}${registryPath}:username=saruman`,
      );
      expect(auth).toBe(`Basic ${basic}`);
    });
  });

  // npm's walk strips a trailing `/` and the segment before it in separate steps,
  // so `//host/api/v4/` and `//host/api/v4` are two different config paths (the
  // slashed one checked first), as are `//host/` and `//host`.
  describe("a trailing slash makes a distinct config path", () => {
    const password = Buffer.from("verysecure").toString("base64");

    // The line with the slash comes first, so file order can't be the reason that it's picked.
    it("the slashed path is deeper than its unslashed twin", async () => {
      const auth = await probeAuthorization(
        host => `//${host}/api/v4/:_authToken=SLASH\n//${host}/api/v4:_authToken=NOSLASH`,
      );
      expect(auth).toBe("Bearer SLASH");
    });

    it("the slashed host root is deeper than the bare host", async () => {
      const auth = await probeAuthorization(host => `//${host}/:_authToken=SLASH\n//${host}:_authToken=BARE`);
      expect(auth).toBe("Bearer SLASH");
    });

    it("the bare host still matches when nothing deeper does", async () => {
      const auth = await probeAuthorization(host => `//${host}:_authToken=BARE`);
      expect(auth).toBe("Bearer BARE");
    });

    // `//host:username` and `//host/:_password` are two config keys, neither of which
    // is a complete credential. npm composes nothing from them, and neither may Bun —
    // including when the registry sits at the host root, so both keys are its own.
    it("a username and a _password split across the two host-root spellings authenticate with neither", async () => {
      const auth = await probeAuthorization(host => `//${host}:username=gandalf\n//${host}/:_password=${password}`);
      expect(auth).toBe(null);
    });

    it("the same split, with the registry at the host root, still authenticates with neither", async () => {
      const auth = await probeAuthorization(host => `//${host}:username=gandalf\n//${host}/:_password=${password}`, {
        path: "/",
      });
      expect(auth).toBe(null);
    });
  });

  // Bun does not implement certificate auth: it warns and ignores `certfile`/`keyfile`.
  // An unsupported option must never suppress credentials Bun can actually send.
  describe("certfile + keyfile are ignored", () => {
    it("a complete pair does not stop a shallower _authToken", async () => {
      const auth = await probeAuthorization(
        host =>
          `//${host}/:_authToken=${token}\n//${host}${registryPath}:certfile=a.pem\n//${host}${registryPath}:keyfile=b.key`,
      );
      expect(auth).toBe(`Bearer ${token}`);
    });

    it("a lone certfile does not stop a shallower _authToken", async () => {
      const auth = await probeAuthorization(
        host => `//${host}/:_authToken=${token}\n//${host}${registryPath}:certfile=a.pem`,
      );
      expect(auth).toBe(`Bearer ${token}`);
    });

    it("a lone keyfile does not stop a shallower _authToken", async () => {
      const auth = await probeAuthorization(
        host => `//${host}/:_authToken=${token}\n//${host}${registryPath}:keyfile=b.key`,
      );
      expect(auth).toBe(`Bearer ${token}`);
    });

    it("a deeper _authToken still beats a shallower complete pair", async () => {
      const auth = await probeAuthorization(
        host => `//${host}/:certfile=a.pem\n//${host}/:keyfile=b.key\n//${host}${registryPath}:_authToken=${token}`,
      );
      expect(auth).toBe(`Bearer ${token}`);
    });

    // `bunfig.toml` and registry-URL userinfo are Bun's second credential layer.
    it("a complete pair leaves a bunfig.toml token intact on a scoped registry", async () => {
      const auth = await probeAuthorization(
        host => `//${host}${registryPath}:certfile=a.pem\n//${host}${registryPath}:keyfile=b.key`,
        { bunfigToken: token },
      );
      expect(auth).toBe(`Bearer ${token}`);
    });

    it("a complete pair leaves a bunfig.toml token intact on the default registry", async () => {
      const auth = await probeAuthorization(
        host => `//${host}${registryPath}:certfile=a.pem\n//${host}${registryPath}:keyfile=b.key`,
        { registry: "default", bunfigToken: token },
      );
      expect(auth).toBe(`Bearer ${token}`);
    });

    it("a complete pair leaves the registry URL's userinfo intact", async () => {
      const auth = await probeAuthorization(
        host => `//${host}${registryPath}:certfile=a.pem\n//${host}${registryPath}:keyfile=b.key`,
        { registry: "default", userinfo: "user:pass@" },
      );
      expect(auth).toBe(`Basic ${Buffer.from("user:pass").toString("base64")}`);
    });

    it("a complete pair on a shallower path leaves a bunfig.toml token intact", async () => {
      const auth = await probeAuthorization(host => `//${host}/:certfile=a.pem\n//${host}/:keyfile=b.key`, {
        bunfigToken: token,
      });
      expect(auth).toBe(`Bearer ${token}`);
    });

    it("a lone certfile leaves a bunfig.toml token intact", async () => {
      const auth = await probeAuthorization(host => `//${host}${registryPath}:certfile=a.pem`, {
        bunfigToken: token,
      });
      expect(auth).toBe(`Bearer ${token}`);
    });

    it("a lone keyfile leaves the registry URL's userinfo intact", async () => {
      const auth = await probeAuthorization(host => `//${host}${registryPath}:keyfile=b.key`, {
        registry: "default",
        userinfo: "user:pass@",
      });
      expect(auth).toBe(`Basic ${Buffer.from("user:pass").toString("base64")}`);
    });

    it("a bunfig.toml token with no matching .npmrc line is sent", async () => {
      const auth = await probeAuthorization(() => `//other.example.com/:_authToken=OTHER`, { bunfigToken: token });
      expect(auth).toBe(`Bearer ${token}`);
    });
  });

  // npm merges every `.npmrc` into ONE flat config map before it resolves anything,
  // so a key repeated across files collapses last-write-wins *before* `hasAuth` runs.
  // Resolving per-file instead makes the home file's `_authToken` win and the
  // project's `_auth` unreachable.
  describe("keys collapse across .npmrc files before resolution", () => {
    const path = "/api/v4/";
    const basic = Buffer.from("alice:s3cret").toString("base64");

    // Measured against npm 10.9.3: `Basic <alice:s3cret>`.
    it("the project's empty _authToken falsifies the home file's token, so _auth wins", async () => {
      const auth = await probeAuthorization(host => `//${host}${path}:_authToken=\n//${host}${path}:_auth=${basic}`, {
        path,
        homeNpmrc: host => `//${host}${path}:_authToken=HOMETOKEN`,
      });
      expect(auth).toBe(`Basic ${basic}`);
    });

    it("a project token overrides the home file's token at the same key", async () => {
      const auth = await probeAuthorization(host => `//${host}${path}:_authToken=PROJECT`, {
        path,
        homeNpmrc: host => `//${host}${path}:_authToken=HOMETOKEN`,
      });
      expect(auth).toBe("Bearer PROJECT");
    });

    it("the home file's token applies when the project declares nothing", async () => {
      const auth = await probeAuthorization(() => "", {
        path,
        homeNpmrc: host => `//${host}${path}:_authToken=HOMETOKEN`,
      });
      expect(auth).toBe("Bearer HOMETOKEN");
    });

    // The home file's key is a strict ancestor, so it is never even consulted:
    // `hasAuth` stops at the deeper key the project file supplies.
    it("a deeper project token beats a shallower home token", async () => {
      const auth = await probeAuthorization(host => `//${host}${path}:_authToken=PROJECT`, {
        path,
        homeNpmrc: host => `//${host}/:_authToken=HOMETOKEN`,
      });
      expect(auth).toBe("Bearer PROJECT");
    });

    // The emptiness test happens AFTER the collapse, so a later empty value clears an
    // earlier one instead of losing to it. npm 10.9.3 sends no header for both.
    const homeBasic = (host: string) =>
      `//${host}${path}:username=alice\n//${host}${path}:_password=${Buffer.from("s3cret").toString("base64")}`;

    it("the project's empty username clears the home file's username and password pair", async () => {
      const auth = await probeAuthorization(host => `//${host}${path}:username=`, { path, homeNpmrc: homeBasic });
      expect(auth).toBe(null);
    });

    it("the project's empty _password clears the home file's username and password pair", async () => {
      const auth = await probeAuthorization(host => `//${host}${path}:_password=`, { path, homeNpmrc: homeBasic });
      expect(auth).toBe(null);
    });

    it("a project username overrides the home file's at the same key", async () => {
      const auth = await probeAuthorization(host => `//${host}${path}:username=bob`, { path, homeNpmrc: homeBasic });
      expect(auth).toBe(`Basic ${Buffer.from("bob:s3cret").toString("base64")}`);
    });
  });

  // npm never decodes `_auth`; it forwards the value as `Basic <value>`. An opaque
  // blob and a blank password are credentials, not errors.
  describe("_auth is forwarded verbatim", () => {
    it("sends an opaque _auth blob that does not decode to user:pass", async () => {
      const blob = b64("opaquetokenblob");
      const auth = await probeAuthorization(host => `//${host}${registryPath}:_auth=${blob}`);
      expect(auth).toBe(`Basic ${blob}`);
    });

    it("sends an _auth that is not even valid base64", async () => {
      const blob = "!!not-base64!!";
      const auth = await probeAuthorization(host => `//${host}${registryPath}:_auth=${blob}`);
      expect(auth).toBe(`Basic ${blob}`);
    });

    it("sends an _auth with a blank password", async () => {
      const value = b64("tok:");
      const auth = await probeAuthorization(host => `//${host}${registryPath}:_auth=${value}`);
      expect(auth).toBe(`Basic ${value}`);
    });

    it("prefers an opaque _auth over username and _password at the same key", async () => {
      const blob = b64("opaquetokenblob");
      const auth = await probeAuthorization(
        host =>
          `//${host}${registryPath}:_auth=${blob}\n` +
          `//${host}${registryPath}:username=x\n` +
          `//${host}${registryPath}:_password=${b64("y")}`,
      );
      expect(auth).toBe(`Basic ${blob}`);
    });

    it("sends a decodable _auth verbatim rather than re-encoding it", async () => {
      // Unpadded, so that decoding and re-encoding it would add the `=`.
      const value = "YWI6Y2Q";
      const auth = await probeAuthorization(host => `//${host}${registryPath}:_auth=${value}`);
      expect(auth).toBe(`Basic ${value}`);
    });

    // Which credential wins must not depend on whether `_auth` decodes: with a
    // username + password also stored on the registry (here from the URL's
    // userinfo), all three blobs go out verbatim.
    const userinfo = { registry: "default", userinfo: "url-user:url-pass@" } as const;

    it("a non-decodable _auth wins over the registry's username + password", async () => {
      const blob = "!!not-base64!!";
      const auth = await probeAuthorization(host => `//${host}${registryPath}:_auth=${blob}`, userinfo);
      expect(auth).toBe(`Basic ${blob}`);
    });

    it("a colon-less _auth wins over the registry's username + password", async () => {
      const blob = b64("opaquetokenblob");
      const auth = await probeAuthorization(host => `//${host}${registryPath}:_auth=${blob}`, userinfo);
      expect(auth).toBe(`Basic ${blob}`);
    });

    it("a decodable _auth wins over the registry's username + password, verbatim", async () => {
      const value = b64("alice:s3cret");
      const auth = await probeAuthorization(host => `//${host}${registryPath}:_auth=${value}`, userinfo);
      expect(auth).toBe(`Basic ${value}`);
    });
  });

  // A yarn-style credential inside the registry URL is stripped from the path before
  // the request goes out, whether or not `.npmrc` also supplies one. Otherwise the
  // secret ships in the request path, where proxies and logs can see it.
  describe("credentials embedded in the registry URL", () => {
    // Returns the Authorization header and the request path the registry saw.
    async function probeEmbedded(
      registryPath: string,
      authLines: (host: string) => string,
      userinfo = "",
      { cli = false, source = "scoped" }: { cli?: boolean; source?: "scoped" | "default" | "env" | "bunfig" } = {},
    ) {
      const seen: Array<{ path: string; auth: string | null }> = [];
      await using registry = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        fetch(req) {
          seen.push({ path: new URL(req.url).pathname, auth: req.headers.get("authorization") });
          return new Response("not found", { status: 404 });
        },
      });
      const host = `127.0.0.1:${registry.port}`;
      const registryUrl = `http://${userinfo}${host}${registryPath}`;
      const npmrcRegistryLine =
        cli || source === "env" || source === "bunfig"
          ? ""
          : source === "default"
            ? `registry=${registryUrl}\n`
            : `@myorg:registry=${registryUrl}\n`;
      using dir = tempDir("npmrc-embedded-auth", {
        ".npmrc": `${npmrcRegistryLine}${authLines(host)}\n`,
        "package.json": JSON.stringify({ name: "probe", version: "0.0.0", dependencies: { "@myorg/pkg": "1.0.0" } }),
        "home/.gitkeep": "",
        ...(source === "bunfig" ? { "bunfig.toml": `[install]\nregistry = "${registryUrl}"\n` } : {}),
      });
      const home = join(String(dir), "home");
      await using proc = Bun.spawn({
        cmd: [bunExe(), "install", "--no-cache", ...(cli ? ["--registry", registryUrl] : [])],
        cwd: String(dir),
        env: {
          ...env,
          HOME: home,
          USERPROFILE: home,
          XDG_CONFIG_HOME: home,
          ...(source === "env" ? { NPM_CONFIG_REGISTRY: registryUrl } : {}),
        },
        stdout: "pipe",
        stderr: "pipe",
        stdin: "ignore",
      });
      const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ requests: seen.length, exitCode, stderr }).toEqual({
        requests: 1,
        exitCode: 1,
        stderr: expect.any(String),
      });
      return seen[0]!;
    }

    // The bunfig object form is the one way into the scope builder with a token already
    // set, so it pins that the strip does not depend on the credential being adopted.
    async function probeBunfig(registryPath: string, token: string) {
      const seen: Array<{ path: string; auth: string | null }> = [];
      await using registry = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        fetch(req) {
          seen.push({ path: new URL(req.url).pathname, auth: req.headers.get("authorization") });
          return new Response("not found", { status: 404 });
        },
      });
      const host = `127.0.0.1:${registry.port}`;
      using dir = tempDir("bunfig-embedded-auth", {
        "bunfig.toml": `[install.scopes]\nmyorg = { url = "http://${host}${registryPath}", token = "${token}" }\n`,
        "package.json": JSON.stringify({ name: "probe", version: "0.0.0", dependencies: { "@myorg/pkg": "1.0.0" } }),
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
      const [, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ requests: seen.length, exitCode }).toEqual({ requests: 1, exitCode: 1 });
      return seen[0]!;
    }

    // Bun's JFrog guide writes the credential as a path segment, `/npm/_auth=<base64>`.
    // Base64 holds `/`, so the marker, not the last slash, must anchor the strip.
    it("strips a slash-form _auth whose base64 value contains a slash", async () => {
      const seen = await probeEmbedded("/api/npm/_auth=YWJj/ZGVm", () => "");
      expect(seen).toEqual({ path: "/api/npm/@myorg%2fpkg", auth: "Basic YWJj/ZGVm" });
    });

    it("strips a slash-form _authToken whose value contains a slash", async () => {
      const seen = await probeEmbedded("/api/_authToken=a/b", () => "");
      expect(seen).toEqual({ path: "/api/@myorg%2fpkg", auth: "Bearer a/b" });
    });

    it("strips slash-form username and _password segments", async () => {
      const seen = await probeEmbedded("/api/username=u/_password=p/q", () => "");
      expect(seen).toEqual({ path: "/api/@myorg%2fpkg", auth: `Basic ${Buffer.from("u:p/q").toString("base64")}` });
    });

    it("leaves a plain `=` in a path segment alone", async () => {
      const seen = await probeEmbedded("/a=b/c/", () => "");
      expect(seen).toEqual({ path: "/a=b/c/@myorg%2fpkg", auth: null });
    });

    it("leaves a plain `=` in a trailing path segment alone", async () => {
      const seen = await probeEmbedded("/api/npm=1/", () => "");
      expect(seen).toEqual({ path: "/api/npm=1/@myorg%2fpkg", auth: null });
    });

    // A marker has to match exactly, like a `.npmrc` line. A different case is a misspelling, which is stripped from
    // the path and never used.
    it("strips an embedded _AuthToken spelled with a capital without adopting it", async () => {
      const seen = await probeEmbedded("/api/:_AuthToken=T", () => "");
      expect(seen).toEqual({ path: "/api/@myorg%2fpkg", auth: null });
    });

    // A `:word=` at the very end of the path is the one place where Yarn writes a credential. A misspelled name there
    // is still a credential, so it's stripped and never used.
    it.each(["/api/:_passwd=SECRET", "/api/:authtoken=SECRET"])(
      "strips a misspelt credential segment %s at the end of the path without adopting it",
      async registryPath => {
        const seen = await probeEmbedded(registryPath, () => "");
        expect(seen).toEqual({ path: "/api/@myorg%2fpkg", auth: null });
      },
    );

    // A `:word=` or `_word=` segment anywhere else is an ordinary path segment. npm has no heuristic for it, and
    // stripping it used to lose the rest of the registry path.
    it.each([
      ["/a:b=c/npm/", "/a:b=c/npm/@myorg%2fpkg"],
      ["/api/_v=1/npm/", "/api/_v=1/npm/@myorg%2fpkg"],
      ["/api/_secret=x/", "/api/_secret=x/@myorg%2fpkg"],
    ])("leaves a `=` segment inside the registry path alone: %s", async (registryPath, expectedPath) => {
      const seen = await probeEmbedded(registryPath, () => "");
      expect(seen).toEqual({ path: expectedPath, auth: null });
    });

    it("leaves a `:word=` segment inside a --registry path alone", async () => {
      const seen = await probeEmbedded("/a:b=c/npm/", () => "", "", { cli: true });
      expect(seen).toEqual({ path: "/a:b=c/npm/@myorg%2fpkg", auth: null });
    });

    // The default registry can also come from a `registry=` line in `.npmrc`, from `$NPM_CONFIG_REGISTRY`, or from
    // bunfig's string form. The credential is stripped the same way.
    it.each(["default", "env", "bunfig"] as const)(
      "strips an embedded _authToken from a %s registry URL",
      async source => {
        const seen = await probeEmbedded("/api/:_authToken=S", () => "", "", { source });
        expect(seen).toEqual({ path: "/api/@myorg%2fpkg", auth: "Bearer S" });
      },
    );

    // `--registry` used to bypass the scope builder. With a trailing slash after the marker, the token was sent in
    // every request path.
    it("strips an embedded _authToken from a --registry URL with a trailing slash", async () => {
      const seen = await probeEmbedded("/api/:_authToken=S/", () => "", "", { cli: true });
      expect(seen).toEqual({ path: "/api/@myorg%2fpkg", auth: "Bearer S" });
    });

    it("keeps the .npmrc token of the same host over a --registry URL's embedded one", async () => {
      const seen = await probeEmbedded(
        "/api/:_authToken=S/",
        host => `registry=http://${host}/\n//${host}/:_authToken=T`,
        "",
        { cli: true },
      );
      expect(seen).toEqual({ path: "/api/@myorg%2fpkg", auth: "Bearer T" });
    });

    it("strips an embedded _auth when bunfig already supplies a token", async () => {
      const seen = await probeBunfig("/api/:_auth=opaque-blob", "T");
      expect(seen).toEqual({ path: "/api/@myorg%2fpkg", auth: "Bearer T" });
    });

    it("keeps bunfig's token over an embedded _authToken", async () => {
      const seen = await probeBunfig("/api/:_authToken=EMBEDDED", "T");
      expect(seen).toEqual({ path: "/api/@myorg%2fpkg", auth: "Bearer T" });
    });

    it("strips an embedded _authToken from the path and uses it when .npmrc has none", async () => {
      const seen = await probeEmbedded("/api/:_authToken=EMBEDDED", () => "");
      expect(seen).toEqual({ path: "/api/@myorg%2fpkg", auth: "Bearer EMBEDDED" });
    });

    it("strips an embedded _authToken from the path even when an .npmrc ancestor wins", async () => {
      const seen = await probeEmbedded("/api/:_authToken=EMBEDDED", host => `//${host}/:_authToken=FROM_NPMRC`);
      expect(seen).toEqual({ path: "/api/@myorg%2fpkg", auth: "Bearer FROM_NPMRC" });
    });

    // The marker used to be stripped only while looking for a credential to use. With userinfo already in the URL, the
    // scan was skipped and the token was sent in the path.
    it("strips an embedded _authToken from the path when the URL also carries userinfo", async () => {
      const seen = await probeEmbedded("/api/:_authToken=EMBEDDED", () => "", "u:p@");
      expect(seen).toEqual({ path: "/api/@myorg%2fpkg", auth: `Basic ${btoa("u:p")}` });
    });

    // A bare `:` belongs to the path. Only `name=value` segments naming a credential
    // are stripped, so a registry mounted under `/a:b/c/` keeps its path.
    it("leaves a plain colon in the registry path alone", async () => {
      const seen = await probeEmbedded("/a:b/c/", host => `//${host}/a:b/c/:_authToken=TOK`);
      expect(seen).toEqual({ path: "/a:b/c/@myorg%2fpkg", auth: "Bearer TOK" });
    });

    it("leaves a plain colon in the registry path alone when no credential is configured", async () => {
      const seen = await probeEmbedded("/a:b/c/", () => "");
      expect(seen).toEqual({ path: "/a:b/c/@myorg%2fpkg", auth: null });
    });

    // An empty marker supplies no credential. It's stripped from the path, but it must not end the scan or hide the
    // credential from .npmrc.
    it("an empty embedded _auth does not discard the .npmrc credential", async () => {
      const seen = await probeEmbedded("/api/:_auth=", host => `//${host}/:_auth=b3BhcXVlYmxvYg`);
      expect(seen).toEqual({ path: "/api/@myorg%2fpkg", auth: "Basic b3BhcXVlYmxvYg" });
    });

    it("an empty embedded _authToken does not discard the .npmrc credential", async () => {
      const seen = await probeEmbedded("/api/:_authToken=", host => `//${host}/:_auth=b3BhcXVlYmxvYg`);
      expect(seen).toEqual({ path: "/api/@myorg%2fpkg", auth: "Basic b3BhcXVlYmxvYg" });
    });

    // An `.npmrc` `_auth` supersedes URL-embedded credentials outright, so `bun pm
    // whoami` can never report an identity the registry did not authenticate.
    it("an .npmrc _auth wins over embedded username and _password", async () => {
      const seen = await probeEmbedded(
        "/api/:username=embeddeduser/:_password=embeddedpass",
        host => `//${host}/:_auth=T1BBUVVFQkxPQg==`,
      );
      expect(seen).toEqual({ path: "/api/@myorg%2fpkg", auth: "Basic T1BBUVVFQkxPQg==" });
    });

    // The scan anchors on the `:<name>=` marker, not on any `:`, so a colon inside the
    // value neither ends it nor splits it.
    it("strips an embedded _authToken whose value contains a colon", async () => {
      const seen = await probeEmbedded("/api/:_authToken=aa:bb", () => "");
      expect(seen).toEqual({ path: "/api/@myorg%2fpkg", auth: "Bearer aa:bb" });
    });

    // An embedded `_password` is used verbatim, unlike an `.npmrc` one, which is base64.
    it("strips an embedded username and _password whose value contains a colon", async () => {
      const seen = await probeEmbedded("/api/:username=u/:_password=p:q", () => "");
      expect(seen).toEqual({ path: "/api/@myorg%2fpkg", auth: `Basic ${Buffer.from("u:p:q").toString("base64")}` });
    });

    // `_authToken` ends what's read, but not what's stripped. A segment to its left is still a secret, and leaving it
    // there would put it in the request path.
    it("strips a _password written to the left of the _authToken it loses to", async () => {
      const seen = await probeEmbedded("/api/:_password=cA==:_authToken=T", () => "");
      expect(seen).toEqual({ path: "/api/@myorg%2fpkg", auth: "Bearer T" });
    });

    it("strips a username written to the left of the _authToken it loses to", async () => {
      const seen = await probeEmbedded("/api/:username=u:_authToken=T", () => "");
      expect(seen).toEqual({ path: "/api/@myorg%2fpkg", auth: "Bearer T" });
    });

    // Only the rightmost terminal marker is read. A second one to its left is stripped but never recorded, so it can't
    // take precedence over the first. A base64 round trip would change these `_auth` values, so the header proves that
    // the value was sent as written.
    it.each([
      ["an opaque value", "opaque-blob"],
      ["a blank password", btoa("u:")],
    ])("reads the rightmost terminal marker, not the leftmost (%s)", async (_name, value) => {
      const seen = await probeEmbedded(`/api/:_authToken=T:_auth=${value}`, () => "");
      expect(seen).toEqual({ path: "/api/@myorg%2fpkg", auth: `Basic ${value}` });
    });

    it("reads the leftmost of two duplicate non-terminal markers", async () => {
      const seen = await probeEmbedded("/api/:username=a:username=b:_password=p", () => "");
      expect(seen).toEqual({ path: "/api/@myorg%2fpkg", auth: `Basic ${Buffer.from("a:p").toString("base64")}` });
    });
  });

  // npm's walk decides which ancestor supplies auth. Layering a half credential over
  // one the registry already stores (from its URL's userinfo) is Bun-only and stays
  // exact-path: an ancestor's stray `username=` must not rebind a deeper registry's
  // stored password to a new identity.
  describe("a lone username or _password supplies nothing, as in npm's hasAuth", () => {
    const stored = { registry: "default", userinfo: "url-user:url-pass@" } as const;
    const storedBasic = `Basic ${Buffer.from("url-user:url-pass").toString("base64")}`;

    it("an ancestor's lone username does not rebind the stored password", async () => {
      const auth = await probeAuthorization(host => `//${host}/:username=attacker`, stored);
      expect(auth).toBe(storedBasic);
    });

    it("an ancestor's lone _password does not rebind the stored username", async () => {
      const auth = await probeAuthorization(
        host => `//${host}/:_password=${Buffer.from("other").toString("base64")}`,
        stored,
      );
      expect(auth).toBe(storedBasic);
    });

    it("an ancestor's empty _authToken does not clear the stored token", async () => {
      const auth = await probeAuthorization(host => `//${host}/:username=u\n//${host}/:_authToken=`, {
        registry: "default",
        userinfo: `:${token}@`,
      });
      expect(auth).toBe(`Bearer ${token}`);
    });
  });

  // A registry declared in `bunfig.toml` resolves through the same walk, unless
  // `bunfig.toml` itself gave it credentials: project config beats `.npmrc`.
  describe("registries declared in bunfig.toml", () => {
    it.each([
      ["scoped", { bunfigBare: true }],
      ["default", { registry: "default", bunfigBare: true }],
    ] as const)("a host-root _authToken applies to a credential-less %s registry", async (_name, opts) => {
      const auth = await probeAuthorization(host => `//${host}/:_authToken=${token}`, opts);
      expect(auth).toBe(`Bearer ${token}`);
    });

    it("a string prefix of the path is still not an ancestor", async () => {
      const auth = await probeAuthorization(host => `//${host}/api/v4/projects/12/:_authToken=${token}`, {
        bunfigBare: true,
      });
      expect(auth).toBeNull();
    });

    it("walks up for _auth", async () => {
      const blob = b64("alice:s3cret");
      const auth = await probeAuthorization(host => `//${host}/api/:_auth=${blob}`, { bunfigBare: true });
      expect(auth).toBe(`Basic ${blob}`);
    });

    it("a bunfig.toml token is kept even when an ancestor key would supply another", async () => {
      const auth = await probeAuthorization(host => `//${host}/:_authToken=FROM_NPMRC`, { bunfigToken: token });
      expect(auth).toBe(`Bearer ${token}`);
    });

    it("bunfig.toml username + password are kept even when the registry's own key supplies _auth", async () => {
      const basic = { username: "bunfig-user", password: "bunfig-pass" };
      const auth = await probeAuthorization(host => `//${host}${registryPath}:_auth=${b64("x:y")}`, {
        bunfigBasic: basic,
      });
      expect(auth).toBe(`Basic ${b64(`${basic.username}:${basic.password}`)}`);
    });
  });

  // The unscoped `registry=` line resolves credentials through the same walk. It is
  // a separate branch in `src/ini/lib.rs`, and it is the only one that can carry
  // credentials from `bunfig.toml` or from userinfo in the registry URL.
  describe("the default registry walks up too", () => {
    const asDefault = { registry: "default" } as const;

    it("host root", async () => {
      const auth = await probeAuthorization(host => `//${host}/:_authToken=${token}`, asDefault);
      expect(auth).toBe(`Bearer ${token}`);
    });

    it("string prefix, not an ancestor (trailing slash)", async () => {
      const auth = await probeAuthorization(host => `//${host}/api/v4/projects/12/:_authToken=${token}`, asDefault);
      expect(auth).toBe(null);
    });

    it("string prefix, not an ancestor (no trailing slash)", async () => {
      const auth = await probeAuthorization(host => `//${host}/api/v4/projects/12:_authToken=${token}`, asDefault);
      expect(auth).toBe(null);
    });

    it("longest match wins: root then deep", async () => {
      const auth = await probeAuthorization(
        host => `//${host}/:_authToken=ROOT\n//${host}${registryPath}:_authToken=DEEP`,
        asDefault,
      );
      expect(auth).toBe("Bearer DEEP");
    });

    it("longest match wins: deep then root", async () => {
      const auth = await probeAuthorization(
        host => `//${host}${registryPath}:_authToken=DEEP\n//${host}/:_authToken=ROOT`,
        asDefault,
      );
      expect(auth).toBe("Bearer DEEP");
    });

    // Userinfo in the registry URL is the registry's pre-`.npmrc` credential. No
    // config path matches, so nothing may overwrite or clear it.
    it("userinfo in the registry URL survives a non-matching auth line", async () => {
      const auth = await probeAuthorization(() => `//other.example.com/:_authToken=${token}`, {
        ...asDefault,
        userinfo: "user:pass@",
      });
      expect(auth).toBe(`Basic ${Buffer.from("user:pass").toString("base64")}`);
    });

    it("a matching auth line replaces the registry URL's userinfo", async () => {
      const auth = await probeAuthorization(host => `//${host}/:_authToken=${token}`, {
        ...asDefault,
        userinfo: "user:pass@",
      });
      expect(auth).toBe(`Bearer ${token}`);
    });
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

  // Bun's fast URL parser collapses a one-byte path (`/r/`) to `/`; the key must not.
  it("keeps a one-character registry path in the key", () => {
    expect(token(`registry=https://example.com/r/\n//example.com/r/:_authToken=T\n`)).toBe("T");
    expect(token(`registry=https://example.com/r/\n//example.com/:_authToken=T\n`)).toBe("T");
  });

  // A port in a hand-written key stays, so `//host:443/` is the key of `http://host:443/` (a TLS-terminating proxy).
  it("keeps a port written in a scheme-less key", () => {
    expect(token(`registry=http://example.com:443/api/\n//example.com:443/:_authToken=T\n`)).toBe("T");
    expect(token(`registry=http://example.com:8080/api/\n//example.com/:_authToken=T\n`)).toBe("");
  });

  // npm stops there. Bun matched ports by number before it walked keys, so a key that spells out the
  // default port of the registry's own scheme keeps working; the other scheme's default port does not.
  it.each([
    ["https://example.com:443/api/", "//example.com:443/api/", "T"],
    ["https://example.com:443/api/", "//example.com:443/", "T"],
    ["https://example.com/api/", "//example.com:443/", "T"],
    ["https://example.com/api/", "//example.com:443", "T"],
    ["http://example.com:80/api/", "//example.com:80/api/", "T"],
    ["http://example.com/api/", "//example.com:80/", "T"],
    ["https://[::1]/api/", "//[::1]:443/", "T"],
    ["http://example.com/api/", "//example.com:443/", ""],
    ["https://example.com/api/", "//example.com:80/", ""],
    ["https://example.com:8443/api/", "//example.com:443/", ""],
    ["https://example.com/api/", "//example.com:4430/", ""],
    ["https://example.com/api/", "//example.com:443/other/", ""],
  ])("registry=%s with a token keyed to %s", (registry, key, expected) => {
    expect(token(`registry=${registry}\n${key}:_authToken=T\n`)).toBe(expected);
  });

  it("prefers the deeper key, and at one depth the key without the port", () => {
    const registry = "registry=https://example.com/a/b/\n";
    expect(token(`${registry}//example.com/a/:_authToken=plain\n//example.com:443/a/b/:_authToken=port\n`)).toBe(
      "port",
    );
    expect(token(`${registry}//example.com/a/b/:_authToken=plain\n//example.com:443/a/:_authToken=port\n`)).toBe(
      "plain",
    );
    expect(token(`${registry}//example.com:443/a/:_authToken=port\n//example.com/a/:_authToken=plain\n`)).toBe("plain");
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
    expect(stderr).toContain("ignoring unknown .npmrc option _authtoken");
    expect(stderr).not.toContain("SECRETTOKEN");
  });

  it("names the file and line of an unknown option", async () => {
    const stderr = await stderrOf(`registry=https://example.com/\n\n//example.com/:_authtoken=SECRETTOKEN\n`);
    expect(stderr).toMatch(/ignoring unknown .npmrc option _authtoken[^\n]*\n\s+at \S+[\\/]\.npmrc:3:/);
    expect(stderr).not.toContain("SECRETTOKEN");
  });

  it("prints nothing about an unknown option with --silent", async () => {
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

  it("prints nothing about a key that matches once it's normalized", async () => {
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

describe.concurrent("a registry URL whose host is easy to misread", () => {
  // The requests go to the URL as `new URL()` reads it, so the credentials have to be chosen for
  // the host `new URL()` reads. A loopback proxy records the requests and answers them itself:
  // no name is resolved and nothing leaves the machine.
  type Config = { files?: Record<string, string>; args?: string[]; env?: Record<string, string> };

  async function install({ files, args = [], env: extraEnv }: Config) {
    const requests: { host: string; auth: string | null }[] = [];
    await using proxy = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req) {
        requests.push({ host: new URL(req.url).host, auth: req.headers.get("authorization") });
        return new Response("not found", { status: 404 });
      },
    });
    const proxyUrl = `http://127.0.0.1:${proxy.port}`;
    using dir = tempDir("npmrc-backslash-registry", {
      "package.json": JSON.stringify({ name: "app", version: "1.0.0", dependencies: { "no-deps": "1.0.0" } }),
      ...files,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "install", "--no-cache", ...args],
      cwd: String(dir),
      env: { ...env, http_proxy: proxyUrl, HTTP_PROXY: proxyUrl, no_proxy: "", NO_PROXY: "", ...extraEnv },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // The proxy answers 404 to the manifest request, so the install itself fails.
    return { requests, exitCode };
  }

  test.each<[string, (url: string) => Config]>([
    ["--registry", url => ({ args: [`--registry=${url}`] })],
    [".npmrc", url => ({ files: { ".npmrc": `registry=${url}\n` } })],
    ["bunfig.toml", url => ({ files: { "bunfig.toml": `[install]\nregistry = '${url}'\n` } })],
    ["BUN_CONFIG_REGISTRY", url => ({ env: { BUN_CONFIG_REGISTRY: url } })],
  ])("the credentials of the URL go to the host in front of the backslash: %s", async (_, configure) => {
    expect(await install(configure(String.raw`http://u:p@first.example\x@second.example/`))).toEqual({
      requests: [{ host: "first.example", auth: `Basic ${btoa("u:p")}` }],
      exitCode: 1,
    });
  });

  test("the token keyed to the host behind the backslash is not sent", async () => {
    expect(
      await install({
        files: {
          ".npmrc":
            String.raw`registry=http://first.example\@second.example/` +
            "\n//second.example/:_authToken=second-host-SECRET-token\n",
        },
      }),
    ).toEqual({ requests: [{ host: "first.example", auth: null }], exitCode: 1 });
  });

  test("--registry does not inherit the token of the host behind the backslash", async () => {
    expect(
      await install({
        files: {
          ".npmrc": "registry=http://second.example/\n//second.example/:_authToken=second-host-SECRET-token\n",
        },
        args: [String.raw`--registry=http://first.example\@second.example/`],
      }),
    ).toEqual({ requests: [{ host: "first.example", auth: null }], exitCode: 1 });
  });

  test("a second scheme inside the registry URL does not claim the token of the host after it", async () => {
    // `new URL("http:first.example://second.example/")` reads `first.example` as the host: a scheme
    // ends at the first `:`. The token keyed to `second.example` must not go to `first.example`.
    expect(
      await install({
        files: {
          ".npmrc":
            "registry=http:first.example://second.example/\n" +
            "//second.example/:_authToken=second-host-SECRET-token\n",
        },
      }),
    ).toEqual({ requests: [{ host: "first.example", auth: null }], exitCode: 1 });
  });
});

describe("protocol-relative registry", () => {
  test("bun install rejects registry=//host:port/path/ instead of requesting http://localhost/host/", async () => {
    // The `:port` used to be taken for a `:option=value` suffix of the pathname and the
    // value rewritten to http://localhost/127.0.0.1/, so the manifest was requested from
    // a different host on port 80. A scheme-less registry is not usable either way; the
    // server only exists to show that the host actually named in the value is not hit.
    let hits = 0;
    await using named = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch() {
        hits++;
        return new Response("not found", { status: 404 });
      },
    });
    const registryUrl = `//127.0.0.1:${named.port}/npm/`;

    using dir = tempDir("npmrc-protocol-relative-registry", {
      ".npmrc": `registry=${registryUrl}\n`,
      "package.json": JSON.stringify({
        name: "app",
        version: "1.0.0",
        dependencies: { "no-deps": "1.0.0" },
      }),
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "install", "--no-cache"],
      cwd: String(dir),
      env: { ...env, http_proxy: "", https_proxy: "", HTTP_PROXY: "", HTTPS_PROXY: "" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toContain(`Failed to join registry "${registryUrl}" and package "no-deps" URLs`);
    expect(hits).toBe(0);
    expect(exitCode).toBe(1);
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
    using registry = mockRegistry("Bearer project-token", {
      registryPath,
      tarballPath,
      publicManifest: true,
      secure: true,
    });
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

    // The registry moves, and the user keeps credentials for both hosts, which npm also needs for the same lockfile.
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
    using registry = mockRegistry("Bearer team-b-token", {
      registryPath,
      tarballPath,
      publicManifest: true,
      secure: true,
    });
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
    using registry = mockRegistry("Bearer root-token", {
      registryPath,
      tarballPath,
      publicManifest: true,
      secure: true,
    });
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

  // Over http the manifest can be rewritten on the way, and `//host/npm/team-b/` is also the key of
  // `https://host/npm/team-b/`: whoever rewrites it must not be able to pull that line into cleartext.
  // The tarball carries what the registry's own requests already show.
  test("an http tarball on the registry's origin carries the registry's token, not the line for its path", async () => {
    const registryPath = "/npm/team-a";
    const tarballPath = "/npm/team-b/no-deps/-/no-deps-1.0.0.tgz";
    using registry = mockRegistry("Bearer team-a-token", { registryPath, tarballPath });
    using dir = tempDir("npmrc-url-auth-own-line-http", {
      "package.json": packageJson,
      ".npmrc": [
        `registry=${registry.origin}${registryPath}/`,
        `//${registry.host}${registryPath}/:_authToken=team-a-token`,
        `//${registry.host}/npm/team-b/:_authToken=must-not-leak`,
        "",
      ].join("\n"),
    });

    const { exitCode } = await install(String(dir));

    expect({ requests: registry.requests, exitCode }).toEqual({
      requests: [
        { path: `${registryPath}/no-deps`, auth: "Bearer team-a-token" },
        { path: tarballPath, auth: "Bearer team-a-token" },
      ],
      exitCode: 0,
    });
  });

  test("an http tarball on the origin of a registry without credentials gets no line", async () => {
    const registryPath = "/npm/public";
    const tarballPath = "/npm/team-b/no-deps/-/no-deps-1.0.0.tgz";
    using registry = mockRegistry("Bearer must-not-leak", { registryPath, tarballPath, publicManifest: true });
    using dir = tempDir("npmrc-url-auth-own-line-http-public", {
      "package.json": packageJson,
      ".npmrc": [
        `registry=${registry.origin}${registryPath}/`,
        `//${registry.host}/npm/team-b/:_authToken=must-not-leak`,
        "",
      ].join("\n"),
    });

    const { exitCode } = await install(String(dir));

    expect({ requests: registry.requests, exitCode }).toEqual({
      requests: [
        { path: `${registryPath}/no-deps`, auth: null },
        { path: tarballPath, auth: null },
      ],
      exitCode: 1,
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

  // The spellings a single parse cannot settle: a dot segment behind an encoded `/` or `\`, or in
  // front of `;params` (Tomcat and Jetty drop them before they resolve the path). WHATWG keeps these
  // opaque and the server re-routes. Requested as written, with no `.npmrc` line of its own.
  test.each([
    "/npm/team-a/..;/team-b/x.tgz",
    "/npm/team-a/..;v=1/team-b/x.tgz",
    "/npm/team-a/%2e%2e;/team-b/x.tgz",
    "/npm/team-a/.;/x.tgz",
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

  // A tab or another control byte is never sent, because the HTTP client refuses the URL, as before.
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

  // At request time, `_auth` is also sent verbatim as `Basic <value>`.
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

  // Bun's docs showed the key with a scheme for a long time. npm never writes one, but it has to keep working. The
  // scheme is dropped when the line is read.
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

  test("percent-encoded userinfo of the registry URL is sent decoded, to the manifest and to a same-origin tarball", async () => {
    using registry = mockRegistry(basic("carol", "p@ss:w"));
    using dir = tempDir("npmrc-url-auth-decoded-userinfo", {
      "package.json": packageJson,
      "bunfig.toml": `[install]\nregistry = "http://carol:p%40ss%3Aw@${registry.host}/"\n`,
      // Rule 3 below: the credential in bunfig.toml takes precedence over the line for the registry's own key.
      ".npmrc": `//${registry.host}/:_authToken=line-token\n`,
    });

    const { exitCode } = await install(String(dir));

    expect({ requests: registry.requests, exitCode }).toEqual({
      requests: [
        { path: manifestPath, auth: basic("carol", "p@ss:w") },
        { path: tarballPath, auth: basic("carol", "p@ss:w") },
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

  // A credential that's carried over to a registry from the environment never goes from https to http.
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
    expect(stderr).toContain("ignoring unknown .npmrc option _authtoken");
    expect(stderr).not.toContain("typo-token");
    expect(exitCode).toBe(1);
  });

  // A lockfile entry is data, like a manifest. It can send Bun to any URL, and Bun only sends what the user configured
  // for that URL, and only over https.
  describe.each(["hoisted", "isolated"])("a bun.lock row names the tarball URL (--linker %s)", linker => {
    const lockfile = (url: string) =>
      JSON.stringify({
        lockfileVersion: 1,
        workspaces: { "": { name: "app", dependencies: { "no-deps": "1.0.0" } } },
        packages: { "no-deps": ["no-deps@1.0.0", url, {}, ""] },
      });

    test.each([
      ["another https host that has no line", true, false, null],
      ["another https host that has a line", true, true, "Bearer other-token"],
      ["another http host that has a line", false, true, null],
    ])("%s", async (_, secure, hasLine, auth) => {
      const seen: (string | null)[] = [];
      using other = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        ...(secure ? { tls } : {}),
        fetch(req) {
          seen.push(req.headers.get("authorization"));
          return new Response(Bun.file(tgz));
        },
      });
      using registry = mockRegistry("Bearer registry-token", { secure: true });
      const otherHost = `127.0.0.1:${other.port}`;
      using dir = tempDir("npmrc-url-auth-lockfile-row", {
        "package.json": packageJson,
        "bun.lock": lockfile(`${secure ? "https" : "http"}://${otherHost}/any/no-deps-1.0.0.tgz`),
        ".npmrc": [
          `registry=${registry.origin}/`,
          `//${registry.host}/:_authToken=registry-token`,
          ...(hasLine ? [`//${otherHost}/:_authToken=other-token`] : []),
          "",
        ].join("\n"),
      });

      const { exitCode } = await install(String(dir), ["--frozen-lockfile", "--linker", linker]);

      expect({ seen, registry: registry.requests, exitCode }).toEqual({ seen: [auth], registry: [], exitCode: 0 });
    });

    test("another path on the registry's origin gets the registry's token", async () => {
      const tarballPath = "/elsewhere/no-deps-1.0.0.tgz";
      using registry = mockRegistry("Bearer registry-token", { secure: true, registryPath: "/reg", tarballPath });
      using dir = tempDir("npmrc-url-auth-lockfile-row-same-origin", {
        "package.json": packageJson,
        "bun.lock": lockfile(`${registry.origin}${tarballPath}`),
        ".npmrc": [`registry=${registry.origin}/reg/`, `//${registry.host}/reg/:_authToken=registry-token`, ""].join(
          "\n",
        ),
      });

      const { exitCode } = await install(String(dir), ["--frozen-lockfile", "--linker", linker]);

      expect({ requests: registry.requests, exitCode }).toEqual({
        requests: [{ path: tarballPath, auth: "Bearer registry-token" }],
        exitCode: 0,
      });
    });
  });

  test("a retried download from another host carries that host's line again, and only it", async () => {
    const seen: (string | null)[] = [];
    using cdn = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      tls,
      fetch(req) {
        seen.push(req.headers.get("authorization"));
        return seen.length === 1 ? new Response("busy", { status: 503 }) : new Response(Bun.file(tgz));
      },
    });
    using registry = mockRegistry("Bearer registry-token", { tarballOrigin: () => `https://127.0.0.1:${cdn.port}` });
    using dir = tempDir("npmrc-url-auth-retry", {
      "package.json": packageJson,
      ".npmrc": [
        `registry=${registry.origin}/`,
        `//${registry.host}/:_authToken=registry-token`,
        `//127.0.0.1:${cdn.port}/:_authToken=cdn-token`,
        "",
      ].join("\n"),
    });

    const { exitCode } = await install(String(dir));

    expect({ seen, exitCode }).toEqual({ seen: ["Bearer cdn-token", "Bearer cdn-token"], exitCode: 0 });
  });

  // A line that was chosen for the tarball's URL is held to the same redirect rule as a registry's token.
  test.each([
    ["another path on the same origin keeps it", true, "Bearer cdn-token"],
    ["another port drops it", false, null],
  ])("a redirect of a tarball on another host to %s", async (_, sameOrigin, auth) => {
    const moved: (string | null)[] = [];
    const serveMoved = (req: Request) => {
      moved.push(req.headers.get("authorization"));
      return new Response(Bun.file(tgz));
    };
    using elsewhere = Bun.serve({ port: 0, hostname: "127.0.0.1", tls, fetch: serveMoved });
    using cdn = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      tls,
      fetch(req) {
        if (new URL(req.url).pathname === "/moved.tgz") return serveMoved(req);
        return Response.redirect(`https://127.0.0.1:${(sameOrigin ? cdn : elsewhere).port}/moved.tgz`, 302);
      },
    });
    using registry = mockRegistry("Bearer registry-token", { tarballOrigin: () => `https://127.0.0.1:${cdn.port}` });
    using dir = tempDir("npmrc-url-auth-redirect", {
      "package.json": packageJson,
      ".npmrc": [
        `registry=${registry.origin}/`,
        `//${registry.host}/:_authToken=registry-token`,
        `//127.0.0.1:${cdn.port}/:_authToken=cdn-token`,
        "",
      ].join("\n"),
    });

    const { exitCode } = await install(String(dir));

    expect({ moved, exitCode }).toEqual({ moved: [auth], exitCode: 0 });
  });

  // The message has the URL that was requested, without any form of the credential.
  test("the 401 line of a tarball prints the resolved URL without its userinfo", async () => {
    using cdn = mockRegistry("Bearer nobody-has-this", { secure: true, tarballPath: "/npm/b/x.tgz" });
    using registry = mockRegistry("Bearer registry-token", {
      tarballOrigin: () => `https://carol:SECRETPASSWORD@${cdn.host}`,
      tarballPath: "/npm/a/../b/x.tgz",
    });
    using dir = tempDir("npmrc-url-auth-401-line", {
      "package.json": packageJson,
      ".npmrc": [`registry=${registry.origin}/`, `//${registry.host}/:_authToken=registry-token`, ""].join("\n"),
    });

    const { stdout, stderr, exitCode } = await install(String(dir));

    expect(stderr.split(/\r?\n/)).toContain(`error: GET ${cdn.origin}/npm/b/x.tgz - 401`);
    expect(stdout + stderr).not.toContain("SECRETPASSWORD");
    expect(cdn.requests).toEqual([{ path: "/npm/b/x.tgz", auth: basic("carol", "SECRETPASSWORD") }]);
    expect(exitCode).toBe(1);
  });
});

describe.concurrent("which credential a registry gets", () => {
  type Config = { files?: Record<string, string>; args?: string[]; env?: Record<string, string> };

  // The `Authorization` of the one request `bun pm view` sends to a registry mounted at `/reg/`.
  async function authorizationOf(configure: (host: string) => Config) {
    const seen: (string | null)[] = [];
    await using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req) {
        seen.push(req.headers.get("authorization"));
        return Response.json({
          name: "pkg",
          "dist-tags": { latest: "1.0.0" },
          versions: { "1.0.0": { name: "pkg", version: "1.0.0" } },
        });
      },
    });
    const { files = {}, args = [], env: extraEnv = {} } = configure(`127.0.0.1:${server.port}`);
    using dir = tempDir("npmrc-which-credential", {
      "package.json": JSON.stringify({ name: "probe", version: "0.0.0" }),
      "home/.gitkeep": "",
      ...files,
    });
    const home = join(String(dir), "home");
    await using proc = Bun.spawn({
      cmd: [bunExe(), "pm", "view", "pkg", "version", ...args],
      cwd: String(dir),
      env: { ...env, HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: home, ...extraEnv },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, exitCode }).toEqual({ stdout: "1.0.0\n", exitCode: 0 });
    return seen;
  }

  // A credential that's written into a registry URL is used, no matter who wrote the URL, except in a `registry=` line
  // in `.npmrc`. npm doesn't read credentials there, so any line for the URL replaces it.
  const inUrl: [string, string][] = [
    ["u:p@", `Basic ${btoa("u:p")}`],
    ["u@", `Basic ${btoa("u:")}`],
    [":tok@", "Bearer tok"],
  ];
  const sources: [string, (url: string) => Config][] = [
    [".npmrc registry=", url => ({ files: { ".npmrc": `registry=${url}\n` } })],
    ["a bunfig.toml string", url => ({ files: { "bunfig.toml": `[install]\nregistry = "${url}"\n` } })],
    ["the bunfig.toml url key", url => ({ files: { "bunfig.toml": `[install.registry]\nurl = "${url}"\n` } })],
    [
      'a bunfig.toml "$VAR"',
      url => ({ files: { "bunfig.toml": `[install]\nregistry = "$MY_REGISTRY"\n` }, env: { MY_REGISTRY: url } }),
    ],
    ["$BUN_CONFIG_REGISTRY", url => ({ env: { BUN_CONFIG_REGISTRY: url } })],
    ["--registry", url => ({ args: ["--registry", url] })],
  ];
  const lines: [string, (host: string) => string][] = [
    ["no line", () => ""],
    ["a line on the registry's own key", host => `//${host}/reg/:_authToken=line\n`],
    ["a line on an ancestor key", host => `//${host}/:_authToken=line\n`],
  ];
  const table = inUrl.flatMap(([userinfo, header]) =>
    sources.flatMap(([source, configure]) =>
      lines.map(([line, lineFor]) => [userinfo, source, line, header, configure, lineFor] as const),
    ),
  );

  test.each(table)("%s in %s with %s", async (userinfo, source, line, header, configure, lineFor) => {
    const seen = await authorizationOf(host => {
      const config = configure(`http://${userinfo}${host}/reg/`);
      return { ...config, files: { ...config.files, ".npmrc": (config.files?.[".npmrc"] ?? "") + lineFor(host) } };
    });
    expect(seen).toEqual([source === ".npmrc registry=" && line !== "no line" ? "Bearer line" : header]);
  });

  // npm collapses its config files into one map before it reads a credential from it.
  test.each([
    ["the project's line replaces the one in $NPM_CONFIG_USERCONFIG", "project-token", "Bearer project-token"],
    ["an empty line in the project clears the one in $NPM_CONFIG_USERCONFIG", "", null],
  ])("%s", async (_, value, header) => {
    const seen = await authorizationOf(host => ({
      files: {
        "user/npmrc": `//${host}/reg/:_authToken=user-token\n`,
        ".npmrc": `registry=http://${host}/reg/\n//${host}/reg/:_authToken=${value}\n`,
      },
      env: { NPM_CONFIG_USERCONFIG: "user/npmrc" },
    }));
    expect(seen).toEqual([header]);
  });

  test("a line in $NPM_CONFIG_USERCONFIG on an ancestor key applies to the project's registry", async () => {
    const seen = await authorizationOf(host => ({
      files: { "user/npmrc": `//${host}/:_authToken=user-token\n`, ".npmrc": `registry=http://${host}/reg/\n` },
      env: { NPM_CONFIG_USERCONFIG: "user/npmrc" },
    }));
    expect(seen).toEqual(["Bearer user-token"]);
  });

  // It used to be dropped unless it started with a lowercase `http://` or `https://`, and the next layer's registry
  // (nothing listens on it here) silently served the install.
  test.each(["HTTP://", "Http://", " http://"])("$BUN_CONFIG_REGISTRY=%shost/reg/ is the registry", async scheme => {
    const seen = await authorizationOf(host => ({
      files: {
        ".npmrc": `//${host}/reg/:_authToken=line\n`,
        "bunfig.toml": `[install]\nregistry = "http://127.0.0.1:1/"\n`,
      },
      env: { BUN_CONFIG_REGISTRY: `${scheme}${host}/reg/` },
    }));
    expect(seen).toEqual(["Bearer line"]);
  });
});

// A configured credential is written into `Authorization` as it is. A CR or LF in it would end the header line, and
// whatever follows would be sent as more header lines or as a second request.
describe.concurrent("a credential that holds a CR, LF or NUL", () => {
  const injected = "abc\r\nX-Injected: 1";
  type Config = { files: Record<string, string>; args?: string[]; env?: Record<string, string> };

  async function install(configure: (host: string) => Config) {
    const seen: string[] = [];
    await using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req) {
        seen.push(new URL(req.url).pathname);
        return new Response("not found", { status: 404 });
      },
    });
    const { files, args = [], env: extraEnv = {} } = configure(`127.0.0.1:${server.port}`);
    using dir = tempDir("npmrc-credential-crlf", {
      "package.json": JSON.stringify({ name: "app", version: "1.0.0", dependencies: { "no-deps": "1.0.0" } }),
      "home/.gitkeep": "",
      ...files,
    });
    const home = join(String(dir), "home");
    await using proc = Bun.spawn({
      cmd: [bunExe(), "install", ...args],
      cwd: String(dir),
      env: {
        ...env,
        HOME: home,
        USERPROFILE: home,
        XDG_CONFIG_HOME: home,
        BUN_INSTALL_CACHE_DIR: join(String(dir), ".cache"),
        ...extraEnv,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { seen, output: stdout + stderr, stderr, exitCode };
  }

  const password = Buffer.from("pass").toString("base64");
  const options: [string, (key: string) => string][] = [
    ["_authToken", key => `${key}:_authToken=\${SECRET}\n`],
    ["_auth", key => `${key}:_auth=\${SECRET}\n`],
    ["username", key => `${key}:username=\${SECRET}\n${key}:_password=${password}\n`],
    ["_password", key => `${key}:username=user\n${key}:_password=\${SECRET}\n`],
  ];
  const keys: [string, (host: string) => string][] = [
    ["the registry's own key", host => `//${host}/npm/`],
    ["an ancestor of the registry's key", host => `//${host}/`],
    // Only a tarball could use it, and none does. The command fails anyway.
    ["the key of a host that is never contacted", () => "//unrelated.invalid/files/"],
  ];
  const table = options.flatMap(([option, linesFor]) =>
    keys.map(([where, keyFor]) => [option, where, linesFor, keyFor] as const),
  );

  test.each(table)(".npmrc %s on %s", async (option, _, linesFor, keyFor) => {
    let key = "";
    const { seen, output, stderr, exitCode } = await install(host => {
      key = keyFor(host);
      return { files: { ".npmrc": `registry=http://${host}/npm/\n${linesFor(key)}` }, env: { SECRET: injected } };
    });
    expect(seen).toEqual([]);
    expect(stderr).toContain(`error: ${key}:${option} in .npmrc contains a newline or NUL byte\n`);
    expect(output).not.toContain("X-Injected");
    expect(exitCode).toBe(1);
  });

  test.each<[string, (host: string) => Config, string]>([
    [
      "$NPM_CONFIG_TOKEN",
      host => ({ files: { ".npmrc": `registry=http://${host}/\n` }, env: { NPM_CONFIG_TOKEN: injected } }),
      "$NPM_CONFIG_TOKEN",
    ],
    [
      "$BUN_CONFIG_TOKEN",
      host => ({ files: { ".npmrc": `registry=http://${host}/\n` }, env: { BUN_CONFIG_TOKEN: injected } }),
      "$BUN_CONFIG_TOKEN",
    ],
    [
      'bunfig.toml token = "$VAR"',
      host => ({
        files: { "bunfig.toml": `[install]\nregistry = { url = "http://${host}/", token = "$SECRET" }\n` },
        env: { SECRET: injected },
      }),
      "the token of the default registry",
    ],
    [
      'bunfig.toml username = "$VAR"',
      host => ({
        files: {
          "bunfig.toml": `[install]\nregistry = { url = "http://${host}/", username = "$SECRET", password = "p" }\n`,
        },
        env: { SECRET: injected },
      }),
      "the username of the default registry",
    ],
    [
      'bunfig.toml password = "$VAR"',
      host => ({
        files: {
          "bunfig.toml": `[install]\nregistry = { url = "http://${host}/", username = "u", password = "$SECRET" }\n`,
        },
        env: { SECRET: injected },
      }),
      "the password of the default registry",
    ],
    [
      "the token of a bunfig.toml scope no dependency is in",
      host => ({
        files: {
          "bunfig.toml": `[install]\nregistry = "http://${host}/"\n[install.scopes]\nacme = { url = "http://${host}/acme/", token = "$SECRET" }\n`,
        },
        env: { SECRET: injected },
      }),
      "the token of the @acme registry",
    ],
    [
      "a token embedded in --registry",
      host => ({ files: {}, args: ["--registry", `http://${host}/:_authToken=${injected}/`] }),
      "the token of the default registry",
    ],
    [
      "an _auth embedded in $BUN_CONFIG_REGISTRY",
      host => ({ files: {}, env: { BUN_CONFIG_REGISTRY: `http://${host}/:_auth=${injected}/` } }),
      "the _auth of the default registry",
    ],
  ])("%s", async (_, configure, what) => {
    const { seen, output, stderr, exitCode } = await install(configure);
    expect(seen).toEqual([]);
    expect(stderr).toContain(`error: ${what} contains a newline or NUL byte\n`);
    expect(output).not.toContain("X-Injected");
    expect(exitCode).toBe(1);
  });

  test.each([
    ["a trailing newline", '"abc\\n"'],
    ["a carriage return", '"abc\\rdef"'],
    ["a NUL byte", '"abc\\u0000def"'],
  ])("a bunfig.toml token with %s", async (_, token) => {
    const { seen, stderr, exitCode } = await install(host => ({
      files: { "bunfig.toml": `[install]\nregistry = { url = "http://${host}/", token = ${token} }\n` },
    }));
    expect(seen).toEqual([]);
    expect(stderr).toContain("error: the token of the default registry contains a newline or NUL byte\n");
    expect(exitCode).toBe(1);
  });

  // The userinfo of a URL is percent-decoded, so the bytes can hide there too.
  test.each([
    ["a token", ":a%0d%0aX-Injected:1@", "token"],
    ["a password", "u:p%0ax@", "password"],
    ["a username", "u%0dx:p@", "username"],
    ["a username without a password", "u%00x@", "username"],
  ])("%s in the userinfo of a registry URL, percent-encoded", async (_, userinfo, what) => {
    const { seen, stderr, exitCode } = await install(host => ({
      files: { ".npmrc": `registry=http://${userinfo}${host}/\n` },
    }));
    expect(seen).toEqual([]);
    expect(stderr).toContain(`error: the ${what} of the default registry contains a newline or NUL byte\n`);
    expect(exitCode).toBe(1);
  });

  // `echo user:pass | base64`: the newline is inside the base64, not in the header. It's sent as written, as always.
  test("an _auth that decodes to text with a newline is not refused", async () => {
    const { seen, exitCode } = await install(host => ({
      files: {
        ".npmrc": `registry=http://${host}/\n//${host}/:_auth=${Buffer.from("user:pass\n").toString("base64")}\n`,
      },
    }));
    expect(seen).toEqual(["/no-deps"]);
    expect(exitCode).toBe(1);
  });
});

// The HTTP client speaks plain HTTP to whatever host it reads out of a URL with any other scheme, or with none.
describe.concurrent("a registry URL that is neither http nor https gets no request and no credential", () => {
  const dependencies = { "no-deps": "1.0.0" };
  const lockfile = (url: string) =>
    JSON.stringify({
      lockfileVersion: 1,
      workspaces: { "": { name: "app", dependencies } },
      packages: { "no-deps": ["no-deps@1.0.0", url, {}, ""] },
    });

  type Route = { cmd: string[]; files?: (registry: string) => Record<string, string> };
  const routes: [string, Route][] = [
    ["bun install: the manifest", { cmd: ["install"] }],
    [
      "bun install: a tarball URL built from the registry URL",
      { cmd: ["install", "--frozen-lockfile"], files: () => ({ "bun.lock": lockfile("") }) },
    ],
    [
      "bun install: a tarball URL from the lockfile",
      {
        cmd: ["install", "--frozen-lockfile"],
        files: registry => ({ "bun.lock": lockfile(`${registry}no-deps/-/no-deps-1.0.0.tgz`) }),
      },
    ],
    ["bun pm view", { cmd: ["pm", "view", "no-deps"] }],
    ["bun pm whoami", { cmd: ["pm", "whoami"] }],
    ["bun publish", { cmd: ["publish"] }],
    ["bun publish --tolerate-republish", { cmd: ["publish", "--tolerate-republish"] }],
    ["bun audit", { cmd: ["audit"], files: () => ({ "bun.lock": lockfile("") }) }],
    ["bun pm diff", { cmd: ["pm", "diff", "no-deps@1.0.0", "2.0.0"] }],
    ["auto-install at run time", { cmd: ["--install=fallback", "entry.mjs"] }],
  ];
  const spellings: [string, (host: string) => string][] = [
    ["htps://host/reg/", host => `htps://${host}/reg/`],
    ["host/reg/", host => `${host}/reg/`],
  ];
  const table = spellings.flatMap(([spelling, registryFor]) =>
    routes.map(([name, route]) => [name, spelling, route, registryFor] as const),
  );

  async function run(
    cmd: string[],
    files: (host: string) => Record<string, string>,
    extraEnv: (host: string) => Record<string, string> = () => ({}),
  ) {
    const received: string[] = [];
    let connections = 0;
    using listener = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        open() {
          connections++;
        },
        data(socket, chunk) {
          received.push(chunk.toString("latin1"));
          socket.end("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
        },
      },
    });
    using dir = tempDir("npmrc-not-http", {
      "package.json": JSON.stringify({ name: "app", version: "1.0.0", dependencies }),
      "entry.mjs": `import "no-deps";`,
      "home/.gitkeep": "",
      ...files(`127.0.0.1:${listener.port}`),
    });
    const home = join(String(dir), "home");
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...cmd],
      cwd: String(dir),
      env: {
        ...env,
        HOME: home,
        USERPROFILE: home,
        XDG_CONFIG_HOME: home,
        BUN_INSTALL_CACHE_DIR: join(String(dir), ".cache"),
        BUN_CONFIG_TOKEN: "env-token",
        ...extraEnv(`127.0.0.1:${listener.port}`),
      },
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
    });
    const [, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { connections, received, exitCode };
  }

  test.each(table)("%s, registry = %s", async (_, __, route, registryFor) => {
    const result = await run(route.cmd, host => ({
      "bunfig.toml": `[install]\nregistry = "${registryFor(host)}"\n`,
      // A key for an ancestor path, which the walk finds for every path on the host.
      ".npmrc": `//${host}/:_authToken=line-token\n`,
      ...route.files?.(registryFor(host)),
    }));
    expect(result).toEqual({ connections: 0, received: [], exitCode: 1 });
  });

  // The value is the registry, even though it's unusable. The request must not go to the registry in bunfig.toml
  // instead.
  test.each(routes)("%s, $BUN_CONFIG_REGISTRY = htp://host/reg/", async (_, route) => {
    const result = await run(
      route.cmd,
      host => ({
        "bunfig.toml": `[install]\nregistry = "http://${host}/fallback/"\n`,
        ".npmrc": `//${host}/:_authToken=line-token\n`,
        ...route.files?.(`htp://${host}/reg/`),
      }),
      host => ({ BUN_CONFIG_REGISTRY: `htp://${host}/reg/` }),
    );
    expect(result).toEqual({ connections: 0, received: [], exitCode: 1 });
  });

  // `bun audit` skips a scoped registry that has no audit endpoint. This one has no usable URL.
  test("bun audit fails for a scoped registry too", async () => {
    await using defaultRegistry = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => Response.json({}) });
    const result = await run(["audit"], host => ({
      "package.json": JSON.stringify({ name: "app", version: "1.0.0", dependencies: { "@corp/no-deps": "1.0.0" } }),
      "bun.lock": JSON.stringify({
        lockfileVersion: 1,
        workspaces: { "": { name: "app", dependencies: { "@corp/no-deps": "1.0.0" } } },
        packages: { "@corp/no-deps": ["@corp/no-deps@1.0.0", "", {}, ""] },
      }),
      "bunfig.toml": `[install]\nregistry = "http://127.0.0.1:${defaultRegistry.port}/"\n[install.scopes]\ncorp = { url = "htps://${host}/reg/", token = "scope-token" }\n`,
    }));
    expect(result).toEqual({ connections: 0, received: [], exitCode: 1 });
  });

  // No scheme is invented for the URL once a credential was cut out of it.
  test.each([
    ["a token after the path", (host: string) => `${host}/reg/:_authToken=embedded-token`],
    ["userinfo", (host: string) => `//:embedded-token@${host}/reg/`],
  ])("a registry without a scheme that carries %s", async (_, registryFor) => {
    const result = await run(["install"], host => ({
      "bunfig.toml": `[install]\nregistry = "${registryFor(host)}"\n`,
    }));
    expect(result).toEqual({ connections: 0, received: [], exitCode: 1 });
  });
});

// https://github.com/oven-sh/bun/issues/41044
describe.concurrent("registry credentials from $VAR env references", () => {
  function authLoggingRegistry(auths: (string | null)[]) {
    return Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req) {
        auths.push(req.headers.get("authorization"));
        return new Response("unauthorized", { status: 401 });
      },
    });
  }

  function scopeFiles(port: number, creds: string, withNpmrc: boolean) {
    return {
      "package.json": JSON.stringify({
        name: "app",
        version: "1.0.0",
        dependencies: { "@myscope/no-deps": "1.0.0" },
      }),
      "bunfig.toml": `[install.scopes]\nmyscope = { url = "http://127.0.0.1:${port}/", ${creds} }\n`,
      ...(withNpmrc ? { ".npmrc": `//127.0.0.1:${port}/:_authToken=npmrc-token\n` } : {}),
    };
  }

  function defaultRegistryFiles(port: number, creds: string) {
    return {
      "package.json": JSON.stringify({
        name: "app",
        version: "1.0.0",
        dependencies: { "no-deps": "1.0.0" },
      }),
      "bunfig.toml": `[install]\nregistry = { url = "http://127.0.0.1:${port}/", ${creds} }\n`,
    };
  }

  // The registry answers 401, so the install itself always fails. Assert the
  // returned exit code last, after the Authorization assertions.
  async function install(dir: string, extraEnv: Record<string, string>, cliArgs: string[] = []) {
    const testEnv: Record<string, string | undefined> = {
      ...env,
      // An ambient proxy would intercept the requests to the local registry.
      http_proxy: "",
      https_proxy: "",
      HTTP_PROXY: "",
      HTTPS_PROXY: "",
    };
    delete testEnv.UNSET_TOKEN_41044;
    Object.assign(testEnv, extraEnv);
    await using proc = Bun.spawn({
      cmd: [bunExe(), "install", "--no-cache", "--ignore-scripts", ...cliArgs],
      cwd: dir,
      env: testEnv as Record<string, string>,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stderr, exitCode };
  }

  test("an unset $VAR token sends no Authorization header and warns", async () => {
    const auths: (string | null)[] = [];
    await using server = authLoggingRegistry(auths);
    using dir = tempDir("bunfig-unset-token", scopeFiles(server.port!, `token = "$UNSET_TOKEN_41044"`, false));
    const { stderr, exitCode } = await install(String(dir), {});
    expect(auths).toEqual([null]);
    expect(stderr).toContain("$UNSET_TOKEN_41044");
    expect(stderr).toContain("references unset variable");
    expect(exitCode).not.toBe(0);
  });

  test("--silent hides the warning about an unset $VAR token", async () => {
    const auths: (string | null)[] = [];
    await using server = authLoggingRegistry(auths);
    using dir = tempDir("bunfig-unset-token-silent", scopeFiles(server.port!, `token = "$UNSET_TOKEN_41044"`, false));
    const { stderr, exitCode } = await install(String(dir), {}, ["--silent"]);
    expect(auths).toEqual([null]);
    expect(stderr).not.toContain("UNSET_TOKEN_41044");
    expect(exitCode).not.toBe(0);
  });

  test("a password that only starts with $ is sent as it is and never printed", async () => {
    const auths: (string | null)[] = [];
    await using server = authLoggingRegistry(auths);
    using dir = tempDir(
      "bunfig-dollar-password",
      scopeFiles(server.port!, `username = "carol", password = "$ecr3t!x"`, false),
    );
    const { stderr, exitCode } = await install(String(dir), {});
    expect(auths).toEqual(["Basic " + Buffer.from("carol:$ecr3t!x").toString("base64")]);
    expect(stderr).not.toContain("ecr3t");
    expect(exitCode).not.toBe(0);
  });

  test("an unset $VAR token falls back to the .npmrc credential", async () => {
    const auths: (string | null)[] = [];
    await using server = authLoggingRegistry(auths);
    using dir = tempDir("bunfig-unset-token-npmrc", scopeFiles(server.port!, `token = "$UNSET_TOKEN_41044"`, true));
    const { exitCode } = await install(String(dir), {});
    expect(auths).toEqual(["Bearer npmrc-token"]);
    expect(exitCode).not.toBe(0);
  });

  test("a set $VAR token wins over the .npmrc credential", async () => {
    const auths: (string | null)[] = [];
    await using server = authLoggingRegistry(auths);
    using dir = tempDir("bunfig-set-token-npmrc", scopeFiles(server.port!, `token = "$UNSET_TOKEN_41044"`, true));
    const { exitCode } = await install(String(dir), { UNSET_TOKEN_41044: "bunfig-token" });
    expect(auths).toEqual(["Bearer bunfig-token"]);
    expect(exitCode).not.toBe(0);
  });

  // A lone password can never produce an Authorization header, so it must
  // not block the .npmrc fallback either.
  test("an unset $VAR username with a literal password falls back to the .npmrc credential", async () => {
    const auths: (string | null)[] = [];
    await using server = authLoggingRegistry(auths);
    using dir = tempDir(
      "bunfig-half-pair-npmrc",
      scopeFiles(server.port!, `username = "$UNSET_TOKEN_41044", password = "literalpass"`, true),
    );
    const { exitCode } = await install(String(dir), {});
    expect(auths).toEqual(["Bearer npmrc-token"]);
    expect(exitCode).not.toBe(0);
  });

  // The runtime auto-install path feeds the raw bunfig config to the
  // package manager and must resolve $VAR references too.
  test("runtime auto-install does not send an unset $VAR token", async () => {
    const auths: (string | null)[] = [];
    await using server = authLoggingRegistry(auths);
    using dir = tempDir("bunfig-auto-install-unset", {
      "index.ts": `import "@myscope/no-deps";`,
      "bunfig.toml": `[install.scopes]\nmyscope = { url = "http://127.0.0.1:${server.port}/", token = "$UNSET_TOKEN_41044" }\n`,
    });
    const testEnv: Record<string, string | undefined> = {
      ...env,
      http_proxy: "",
      https_proxy: "",
      HTTP_PROXY: "",
      HTTPS_PROXY: "",
      BUN_INSTALL_CACHE_DIR: join(String(dir), ".cache"),
    };
    delete testEnv.UNSET_TOKEN_41044;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "index.ts"],
      cwd: String(dir),
      env: testEnv as Record<string, string>,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(auths).toEqual([null]);
    // The registry answers 401, so the run fails to resolve the import.
    expect(exitCode).not.toBe(0);
  });

  // .npmrc values never go through $VAR substitution, so a decoded _password that happens to start with "$" is a
  // literal.
  test("a .npmrc _password that decodes to a $-prefixed value is sent verbatim", async () => {
    const auths: (string | null)[] = [];
    await using server = authLoggingRegistry(auths);
    using dir = tempDir("npmrc-dollar-password", {
      "package.json": JSON.stringify({
        name: "app",
        version: "1.0.0",
        dependencies: { "@myscope/no-deps": "1.0.0" },
      }),
      "bunfig.toml": `[install.scopes]\nmyscope = { url = "http://127.0.0.1:${server.port}/" }\n`,
      ".npmrc":
        `//127.0.0.1:${server.port}/:username=alice\n` +
        `//127.0.0.1:${server.port}/:_password=${btoa("$uperSecret")}\n`,
    });
    const { exitCode } = await install(String(dir), {});
    expect(auths).toEqual([`Basic ${btoa("alice:$uperSecret")}`]);
    expect(exitCode).not.toBe(0);
  });

  // An unresolvable token must not shadow the scope's own username/password pair.
  test("an unset $VAR token next to a resolved username/password pair sends Basic auth", async () => {
    const auths: (string | null)[] = [];
    await using server = authLoggingRegistry(auths);
    using dir = tempDir(
      "bunfig-unset-token-own-pair",
      scopeFiles(server.port!, `token = "$UNSET_TOKEN_41044", username = "alice", password = "s3cret"`, false),
    );
    const { exitCode } = await install(String(dir), {});
    expect(auths).toEqual([`Basic ${btoa("alice:s3cret")}`]);
    expect(exitCode).not.toBe(0);
  });

  // The stale "$UNSET" token must not block from_api's username/password
  // branch once .npmrc supplies the pair.
  test("an unset $VAR token falls back to a .npmrc username/_password pair", async () => {
    const auths: (string | null)[] = [];
    await using server = authLoggingRegistry(auths);
    using dir = tempDir("bunfig-unset-token-npmrc-pair", {
      ...scopeFiles(server.port!, `token = "$UNSET_TOKEN_41044"`, false),
      ".npmrc":
        `//127.0.0.1:${server.port}/:username=bob\n` + `//127.0.0.1:${server.port}/:_password=${btoa("s3cret")}\n`,
    });
    const { exitCode } = await install(String(dir), {});
    expect(auths).toEqual([`Basic ${btoa("bob:s3cret")}`]);
    expect(exitCode).not.toBe(0);
  });

  test("a resolved $VAR username and password pair wins over the .npmrc credential", async () => {
    const auths: (string | null)[] = [];
    await using server = authLoggingRegistry(auths);
    using dir = tempDir(
      "bunfig-pair-npmrc",
      scopeFiles(server.port!, `username = "$USER_41044", password = "$PASS_41044"`, true),
    );
    const { exitCode } = await install(String(dir), { USER_41044: "alice", PASS_41044: "s3cret" });
    expect(auths).toEqual([`Basic ${btoa("alice:s3cret")}`]);
    expect(exitCode).not.toBe(0);
  });

  test("BUN_CONFIG_REGISTRY with an unset $VAR credential keeps the same-host bunfig token", async () => {
    const auths: (string | null)[] = [];
    await using server = authLoggingRegistry(auths);
    using dir = tempDir("bunfig-env-registry-unset", defaultRegistryFiles(server.port!, `token = "realtoken"`));
    const { exitCode } = await install(String(dir), {
      BUN_CONFIG_REGISTRY: `http://:$UNSET_TOKEN_41044@127.0.0.1:${server.port}/`,
    });
    expect(auths).toEqual(["Bearer realtoken"]);
    expect(exitCode).not.toBe(0);
  });

  test("--registry with an unset $VAR credential keeps the same-origin bunfig token", async () => {
    const auths: (string | null)[] = [];
    await using server = authLoggingRegistry(auths);
    using dir = tempDir("bunfig-cli-registry-unset", defaultRegistryFiles(server.port!, `token = "realtoken"`));
    const { exitCode } = await install(String(dir), {}, [
      `--registry=http://:$UNSET_TOKEN_41044@127.0.0.1:${server.port}/`,
    ]);
    expect(auths).toEqual(["Bearer realtoken"]);
    expect(exitCode).not.toBe(0);
  });

  // The BUN_CONFIG_REGISTRY same-host path carries the already-resolved
  // credentials into the new scope. A token value that itself starts with
  // "$" must not go through $VAR resolution a second time.
  test("a token value that starts with $ survives the BUN_CONFIG_REGISTRY same-host carry", async () => {
    const auths: (string | null)[] = [];
    await using server = authLoggingRegistry(auths);
    using dir = tempDir("bunfig-env-registry-dollar", defaultRegistryFiles(server.port!, `token = "$TOK_41044"`));
    const { exitCode } = await install(String(dir), {
      TOK_41044: "$ecret123",
      BUN_CONFIG_REGISTRY: `http://127.0.0.1:${server.port}/`,
    });
    expect(auths).toEqual(["Bearer $ecret123"]);
    expect(exitCode).not.toBe(0);
  });

  test("BUN_CONFIG_REGISTRY with no credentials keeps the same-host bunfig Basic credentials", async () => {
    const auths: (string | null)[] = [];
    await using server = authLoggingRegistry(auths);
    using dir = tempDir(
      "bunfig-env-registry-basic",
      defaultRegistryFiles(server.port!, `username = "$USER_41044", password = "$PASS_41044"`),
    );
    const { exitCode } = await install(String(dir), {
      USER_41044: "alice",
      PASS_41044: "s3cret",
      BUN_CONFIG_REGISTRY: `http://127.0.0.1:${server.port}/`,
    });
    expect(auths).toEqual([`Basic ${btoa("alice:s3cret")}`]);
    expect(exitCode).not.toBe(0);
  });

  test("a credential in the BUN_CONFIG_REGISTRY URL wins over the bunfig credential", async () => {
    const auths: (string | null)[] = [];
    await using server = authLoggingRegistry(auths);
    using dir = tempDir(
      "bunfig-env-registry-url-auth",
      defaultRegistryFiles(server.port!, `username = "alice", password = "s3cret"`),
    );
    const { exitCode } = await install(String(dir), {
      BUN_CONFIG_REGISTRY: `http://127.0.0.1:${server.port}/:_auth=${btoa("urluser:urlpass")}`,
    });
    expect(auths).toEqual([`Basic ${btoa("urluser:urlpass")}`]);
    expect(exitCode).not.toBe(0);
  });

  test("an unset $VAR token falls back to a .npmrc line on an ancestor key", async () => {
    const auths: (string | null)[] = [];
    await using server = authLoggingRegistry(auths);
    using dir = tempDir("bunfig-unset-token-ancestor", {
      "package.json": JSON.stringify({ name: "app", version: "1.0.0", dependencies: { "@myscope/no-deps": "1.0.0" } }),
      "bunfig.toml": `[install.scopes]\nmyscope = { url = "http://127.0.0.1:${server.port}/npm/team/", token = "$UNSET_TOKEN_41044" }\n`,
      ".npmrc": `//127.0.0.1:${server.port}/:_authToken=npmrc-token\n`,
    });
    const { exitCode } = await install(String(dir), {});
    expect(auths).toEqual(["Bearer npmrc-token"]);
    expect(exitCode).not.toBe(0);
  });

  test("a .npmrc _authToken that starts with $ and names no variable is sent verbatim, without a warning", async () => {
    const auths: (string | null)[] = [];
    await using server = authLoggingRegistry(auths);
    using dir = tempDir("npmrc-dollar-token", {
      "package.json": JSON.stringify({ name: "app", version: "1.0.0", dependencies: { "no-deps": "1.0.0" } }),
      ".npmrc": `registry=http://127.0.0.1:${server.port}/\n//127.0.0.1:${server.port}/:_authToken=$UNSET_TOKEN_41044\n`,
    });
    const { stderr, exitCode } = await install(String(dir), {});
    expect(auths).toEqual(["Bearer $UNSET_TOKEN_41044"]);
    expect(stderr).not.toContain("unset variable");
    expect(exitCode).not.toBe(0);
  });
});

// npm's `ini` trims keys and values with `String.prototype.trim`, so Unicode whitespace (NBSP from a copy-paste, FF / VT,
// a BOM in the middle of the file) around a key or a value is not part of it.
describe("trims Unicode whitespace like npm", () => {
  const url = "http://127.0.0.1:4873/";
  it.each([
    ["NBSP after the registry key", `registry = ${url}\n//127.0.0.1:4873/:_authToken=SECRET\n`],
    ["NBSP after the registry value", `registry=${url} \n//127.0.0.1:4873/:_authToken=SECRET\n`],
    ["NBSP around the token", `registry=${url}\n//127.0.0.1:4873/:_authToken = SECRET \n`],
    ["FF and VT around the token", `registry=${url}\n//127.0.0.1:4873/:_authToken\u000c=\u000bSECRET\u000c\n`],
    ["BOM before a key", `registry=${url}\n﻿//127.0.0.1:4873/:_authToken=SECRET\n`],
    ["other Zs spaces", `registry　= ${url} \n//127.0.0.1:4873/:_authToken=SECRET\n`],
  ])("%s", (_, ini) => {
    expect(loadNpmrc(ini)).toEqual({
      default_registry_url: url,
      default_registry_token: "SECRET",
      default_registry_username: "",
      default_registry_password: "",
      default_registry_auth: "",
    });
  });
});

describe("inline comments and boolean options", () => {
  test("an inline comment is not part of the registry url or the auth token", () => {
    // ini cuts an unquoted value at the first unescaped `;` or `#`. With the
    // comment left in, the registry URL no longer matched its `//host/` credential.
    expect(
      loadNpmrc(`
registry=http://127.0.0.1:4873/ ; default registry
//127.0.0.1:4873/:_authToken=SECRET # token
`),
    ).toEqual({
      default_registry_url: "http://127.0.0.1:4873/",
      default_registry_token: "SECRET",
      default_registry_username: "",
      default_registry_password: "",
      default_registry_auth: "",
    });
  });

  // npm (nopt Boolean): a bare key or an empty value is true, `false`, `null`,
  // `undefined` and a numeric zero are false, and every other string is true
  test.each([
    ["ignore-scripts", true],
    ["ignore-scripts=", true],
    ["ignore-scripts=true", true],
    ["ignore-scripts='true'", true],
    ["ignore-scripts=1", true],
    ["ignore-scripts=2", true],
    ["ignore-scripts=True", true],
    ["ignore-scripts=TRUE", true],
    ["ignore-scripts=yes", true],
    ["ignore-scripts=on", true],
    ["ignore-scripts=no", true],
    ["ignore-scripts=off", true],
    ["ignore-scripts=False", true],
    ["ignore-scripts=false", false],
    ['ignore-scripts="false"', false],
    ["ignore-scripts=null", false],
    ["ignore-scripts=0", false],
    ["ignore-scripts=00", false],
    ["ignore-scripts=0.0", false],
    ["ignore-scripts=-0", false],
    // a numeric string is `!!Number(value)`
    ["ignore-scripts=0x0", false],
    ["ignore-scripts=0o0", false],
    ["ignore-scripts=0b0", false],
    ["ignore-scripts=0e5", false],
    ["ignore-scripts=0x1", true],
    ["ignore-scripts=-0x0", true],
    ["ignore-scripts=Infinity", true],
    ["ignore-scripts=undefined", false],
    ["ignore-scripts= 0 ", false],
    ["ignore-scripts= 1 ", true],
    ['ignore-scripts=" 0x0 "', false],
    // ini JSON-parses a single-quoted value, so these reach the loader as numbers
    ["ignore-scripts='1'", true],
    ["ignore-scripts='0'", false],
    ['ignore-scripts="1"', true],
    ['ignore-scripts="0"', false],
    ["ignore-scripts='null'", false],
    ["ignore-scripts='{}'", true],
    ["ignore-scripts='[]'", undefined],
    // npm trims the value first
    ['ignore-scripts=" false "', false],
    ['ignore-scripts=" null "', false],
    ['ignore-scripts="\\u000b"', true],
    // the inline comment is cut before the value is coerced
    ["ignore-scripts=false ; allow scripts", false],
    ["ignore-scripts=0 # allow scripts", false],
    ["ignore-scripts=true ; no scripts", true],
    ["ignore-scripts = ; bare", true],
  ])("boolean option: %s", (line, expected) => {
    expect(loadNpmrc(line + "\n").ignore_scripts).toBe(expected);
  });

  // The text a variable expands to is read like the same text in the file. npm differs in two spellings, which it reads
  // before it expands `${VAR}`: there an empty variable is false and one that holds `undefined` is true. For
  // `ignore-scripts` an empty variable is on the safe side here: the scripts do not run.
  test.each([
    ["ignore-scripts=${EMPTY}", true],
    ["ignore-scripts=${EMPTY?}", true],
    ['ignore-scripts="${EMPTY}"', true],
    ["ignore-scripts=${EMPTY} ; comment", true],
    ["ignore-scripts=${UNSET?}", true],
    ["ignore-scripts=${BLANK}", true],
    ["ignore-scripts=${PADDED_FALSE}", false],
    ["ignore-scripts=${UNDEFINED}", false],
    ["ignore-scripts=${UNSET}", true],
    ["ignore-scripts=${FALSE}", false],
    ["ignore-scripts=${NULL}", false],
    ["ignore-scripts=${ZERO}", false],
    ["ignore-scripts=${HEX_ZERO}", false],
    ["ignore-scripts=${ONE}", true],
    ["ignore-scripts=${TRUE}", true],
    // the reference is in the comment
    ["ignore-scripts= ; ${FALSE}", true],
    ["ignore-scripts=undefined ; ${TRUE}", false],
  ])("boolean option from the environment: %s", (line, expected) => {
    const env = {
      EMPTY: "",
      BLANK: " ",
      PADDED_FALSE: " false ",
      UNDEFINED: "undefined",
      FALSE: "false",
      NULL: "null",
      ZERO: "0",
      HEX_ZERO: "0x0",
      ONE: "1",
      TRUE: "true",
    };
    expect(loadNpmrc(line + "\n", env).ignore_scripts).toBe(expected);
  });

  test("every boolean option uses the same coercion", () => {
    expect(loadNpmrc("save-exact=1\nlink-workspace-packages=0\nhoist=TRUE\n")).toMatchObject({
      save_exact: true,
      link_workspace_packages: false,
      hoist: true,
    });
    expect(loadNpmrc("registry=https://somehost.com/\n")).toMatchObject({
      ignore_scripts: undefined,
      save_exact: undefined,
      link_workspace_packages: undefined,
      hoist: undefined,
    });
  });

  // A CI .npmrc written for npm must skip scripts here too.
  test.concurrent.each(["ignore-scripts=1", "ignore-scripts=True", "ignore-scripts=", "ignore-scripts=true # CI"])(
    "%s: bun install doesn't run any script",
    async line => {
      using dir = tempDir("npmrc-ignore-scripts", {
        "package.json": JSON.stringify({
          name: "foo",
          version: "1.2.3",
          scripts: { postinstall: `${bunExe()} -e 'await Bun.write("postinstall.txt", "ran")'` },
        }),
        ".npmrc": line + "\n",
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "install"],
        cwd: String(dir),
        env: { ...env, HOME: String(dir), USERPROFILE: String(dir), XDG_CONFIG_HOME: undefined },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
      expect(stderr).not.toContain("error:");
      expect(readdirSync(String(dir))).not.toContain("postinstall.txt");
      expect(exitCode).toBe(0);
    },
  );
});

// Where both are set only `cafile` is used, so a `cafile` left over from a lower layer used to shadow the `ca` of a higher
// one. In each row the server's certificate is only in the higher layer's `ca`; the lower `cafile` holds an unrelated CA.
describe.concurrent("`ca` and `cafile` are one setting: a layer that sets either replaces both", () => {
  const unrelatedCa = join(import.meta.dir, "..", "..", "js", "node", "tls", "fixtures", "ca1-cert.pem");
  const npmrcCa = `ca=${JSON.stringify(tls.cert)}\n`;
  const bunfigCa = Bun.TOML.stringify({ install: { ca: tls.cert } });
  const bunfigCafile = Bun.TOML.stringify({ install: { cafile: unrelatedCa } });

  test.each([
    ["--ca over the cafile of bunfig.toml", { "project/bunfig.toml": bunfigCafile }, ["--ca", tls.cert]],
    ["--ca over the cafile of .npmrc", { "project/.npmrc": `cafile=${unrelatedCa}\n` }, ["--ca", tls.cert]],
    [
      "bunfig.toml ca over the cafile of .npmrc",
      { "project/bunfig.toml": bunfigCa, "project/.npmrc": `cafile=${unrelatedCa}\n` },
      [],
    ],
    [
      "./.npmrc ca over the cafile of ~/.npmrc",
      { "project/.npmrc": npmrcCa, "home/.npmrc": `cafile=${unrelatedCa}\n` },
      [],
    ],
    [
      "./bunfig.toml ca over the cafile of ~/.bunfig.toml",
      { "project/bunfig.toml": bunfigCa, "home/.bunfig.toml": bunfigCafile },
      [],
    ],
  ] as [string, Record<string, string>, string[]][])("%s", async (_, files, args) => {
    const tarball = await new Bun.Archive({
      "package/package.json": JSON.stringify({ name: "no-deps", version: "1.0.0" }),
    }).bytes("gzip");
    await using server = Bun.serve({ port: 0, tls, fetch: () => new Response(tarball) });
    using dir = tempDir("npmrc-ca-layers", {
      "home/.keep": "",
      "project/package.json": JSON.stringify({
        name: "foo",
        version: "1.1.1",
        dependencies: { "no-deps": `https://localhost:${server.port}/no-deps-1.0.0.tgz` },
      }),
      ...files,
    });
    const home = join(String(dir), "home");
    await using proc = Bun.spawn({
      cmd: [bunExe(), "install", ...args],
      cwd: join(String(dir), "project"),
      env: {
        ...env,
        HOME: home,
        USERPROFILE: home,
        XDG_CONFIG_HOME: undefined,
        BUN_INSTALL_CACHE_DIR: join(String(dir), "cache"),
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).not.toContain("error:");
    expect(stdout).toContain("+ no-deps@");
    expect(exitCode).toBe(0);
  });
});

// Like npm, Bun skips a config file that it can't read, e.g. a root-owned ~/.npmrc in a Docker image that runs as another
// user. Not concurrent: `unprivilegedSpawnOptions` may change and restore the modes of directories above the test's own.
describe.skipIf(isWindows)("unreadable config files are skipped", () => {
  /** Runs bun in `<dir>/project` with `<dir>/home` as the home directory, as a user that file modes apply to. */
  async function run(
    cmd: string[],
    prepare: (dir: string, lock: (path: string) => void) => void,
    xdg = false,
    registry?: string,
    extra: Record<string, string> = {},
  ) {
    using dir = tempDir("npmrc-unreadable", {
      // No dependencies, so no network.
      "project/package.json": JSON.stringify({ name: "app", version: "1.0.0" }),
      "home/.keep": "",
      "xdg/.keep": "",
      "cache/.keep": "",
    });
    const locked: string[] = [];
    // Only root can start a process in a directory it cannot search, so the child locks its cwd from the inside.
    let lockCwd = false;
    prepare(String(dir), path => {
      if (path === "project") lockCwd = true;
      else chmodSync(join(String(dir), path), 0o000);
      locked.push(join(String(dir), path));
    });
    using unprivileged = unprivilegedSpawnOptions(String(dir));
    try {
      await using proc = Bun.spawn({
        cmd: lockCwd ? ["sh", "-c", 'chmod 000 . && exec "$@"', "sh", bunExe(), ...cmd] : [bunExe(), ...cmd],
        cwd: join(String(dir), "project"),
        env: {
          ...env,
          HOME: join(String(dir), "home"),
          XDG_CONFIG_HOME: xdg ? join(String(dir), "xdg") : undefined,
          BUN_INSTALL_CACHE_DIR: join(String(dir), "cache"),
          BUN_CONFIG_REGISTRY: registry,
          ...extra,
        },
        stdout: "pipe",
        stderr: "pipe",
        ...unprivileged,
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stdout, stderr, exitCode };
    } finally {
      // So that the directory can be removed.
      for (const path of locked) chmodSync(path, 0o755);
    }
  }

  const files: [name: string, path: string][] = [
    ["./.npmrc", "project/.npmrc"],
    ["~/.npmrc", "home/.npmrc"],
    ["./bunfig.toml", "project/bunfig.toml"],
    ["~/.bunfig.toml", "home/.bunfig.toml"],
    ["$XDG_CONFIG_HOME/.bunfig.toml", "xdg/.bunfig.toml"],
  ];

  /** `prepare` for a file that exists but can't be read. */
  const mode000 = (path: string) => (dir: string, lock: (path: string) => void) => {
    writeFileSync(join(dir, path), "");
    lock(path);
  };

  function withDependency(dir: string) {
    mkdirSync(join(dir, "project/dep"));
    writeFileSync(join(dir, "project/dep/package.json"), JSON.stringify({ name: "dep", version: "1.0.0" }));
    writeFileSync(
      join(dir, "project/package.json"),
      JSON.stringify({ name: "app", dependencies: { dep: "file:./dep" } }),
    );
  }

  function expectInstalled({ stdout, stderr, exitCode }: Awaited<ReturnType<typeof run>>) {
    expect(stderr).not.toContain("warn:");
    expect(stderr).not.toContain("error:");
    expect(stdout).toContain("1 package installed");
    expect(exitCode).toBe(0);
  }

  test.each(files)("bun install works when %s has mode 000", async (_, path) => {
    const prepare = (dir: string, lock: (path: string) => void) => {
      withDependency(dir);
      mode000(path)(dir, lock);
    };
    expectInstalled(await run(["install"], prepare, path.startsWith("xdg")));
  });

  // Docker creates a directory for a `-v` mount of `~/.npmrc` if the host doesn't have the file.
  test.each(files)("bun install works when %s is a directory", async (_, path) => {
    const prepare = (dir: string) => {
      withDependency(dir);
      mkdirSync(join(dir, path));
    };
    expectInstalled(await run(["install"], prepare, path.startsWith("xdg")));
  });

  test("bun install works when $NPM_CONFIG_USERCONFIG has mode 000", async () => {
    const prepare = (dir: string, lock: (path: string) => void) => {
      withDependency(dir);
      mode000("home/ci.npmrc")(dir, lock);
    };
    expectInstalled(await run(["install"], prepare, false, undefined, { NPM_CONFIG_USERCONFIG: "../home/ci.npmrc" }));
  });

  test.each(["a.js", "run a.js", "run s", "-e console.log('ran')"])(
    "bun %s prints nothing about ./bunfig.toml with mode 000",
    async cmd => {
      const result = await run(cmd.split(" "), (dir, lock) => {
        writeFileSync(join(dir, "project/a.js"), "console.log('ran')");
        writeFileSync(join(dir, "project/package.json"), JSON.stringify({ scripts: { s: "echo ran" } }));
        mode000("project/bunfig.toml")(dir, lock);
      });
      expect({ ...result, stderr: result.stderr.replace("$ echo ran\n", "") }).toEqual({
        stdout: "ran\n",
        stderr: "",
        exitCode: 0,
      });
    },
  );

  // `sudo -u nobody bun ...` with the caller's HOME, or `USER nobody` in a container with HOME=/root. EACCES comes from
  // the directory, so there's no way to know whether the file exists. It does exist in these tests, which makes no
  // difference.
  test.each([
    ["~/.npmrc", "home/.npmrc"],
    ["~/.bunfig.toml", "home/.bunfig.toml"],
    ["$XDG_CONFIG_HOME/.bunfig.toml", "xdg/.bunfig.toml"],
  ])("nothing is said about %s in a directory that cannot be searched", async (_, path) => {
    const { stderr, exitCode } = await run(
      ["install"],
      (dir, lock) => {
        writeFileSync(join(dir, path), "");
        lock(dirname(path));
      },
      path.startsWith("xdg"),
    );
    expect(stderr).not.toContain("warn:");
    expect(stderr).not.toContain("EACCES");
    expect(exitCode).toBe(0);
  });

  // Linux only. macOS has no getcwd system call, and its libc can't find the path of such a directory.
  test.skipIf(!isLinux)("nothing is printed about ./bunfig.toml in a directory that cannot be searched", async () => {
    const result = await run(["-e", "console.log(1)"], (dir, lock) => {
      writeFileSync(join(dir, "project/bunfig.toml"), "");
      lock("project");
    });
    expect(result).toEqual({ stdout: "1\n", stderr: "", exitCode: 0 });
  });

  // The package.json beside it is refused first, so this is the one message.
  test.skipIf(!isLinux)("nothing is printed about ./.npmrc in a directory that cannot be searched", async () => {
    const { stderr, exitCode } = await run(["install"], (dir, lock) => {
      writeFileSync(join(dir, "project/.npmrc"), "");
      lock("project");
    });
    expect(stderr).toContain("package.json");
    expect(stderr).not.toContain(".npmrc");
    expect(exitCode).toBe(1);
  });

  test("nothing is printed when no config file exists", async () => {
    const { stderr, exitCode } = await run(["install"], () => {});
    expect(stderr).not.toContain("warn:");
    expect(exitCode).toBe(0);
  });
});

// Env files and CI matrices shared between platforms hand such values to every one of them.
describe.concurrent("a config path that can't contain a file counts as a missing file", () => {
  /** `bun install` in `<dir>/project`, with `<dir>/home` as the home directory unless `extra` says otherwise. */
  async function install(extra: Record<string, string>, files: Record<string, string> = {}) {
    using dir = tempDir("config-folder", {
      "project/package.json": JSON.stringify({ name: "app", version: "1.0.0", dependencies: { dep: "file:./dep" } }),
      "project/dep/package.json": JSON.stringify({ name: "dep", version: "1.0.0" }),
      "home/.keep": "",
      ...files,
    });
    const home = join(String(dir), "home");
    await using proc = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: join(String(dir), "project"),
      env: {
        ...env,
        HOME: home,
        USERPROFILE: home,
        XDG_CONFIG_HOME: undefined,
        BUN_INSTALL_CACHE_DIR: join(String(dir), "cache"),
        ...extra,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    return {
      complaints: stderr.split("\n").filter(line => /^(warn|error):/.test(line)),
      lockfile: readdirSync(join(String(dir), "project")).filter(name => name.startsWith("bun.lock")),
      exitCode,
    };
  }

  const binaryLockfile = { "home/.bunfig.toml": "[install]\nsaveTextLockfile = false\n" };

  test.each(["", "relative/folder"])(
    "XDG_CONFIG_HOME=%j: the home directory's .bunfig.toml is read",
    async XDG_CONFIG_HOME => {
      expect(await install({ XDG_CONFIG_HOME }, binaryLockfile)).toEqual({
        complaints: [],
        lockfile: ["bun.lockb"],
        exitCode: 0,
      });
    },
  );

  const share = "\\\\127.0.0.1\\nope\\x";
  test
    .skipIf(!isWindows)
    .each([
      { XDG_CONFIG_HOME: "/home/u/.config" },
      { USERPROFILE: "/home/u" },
      { XDG_CONFIG_HOME: share },
      { USERPROFILE: share },
      { NPM_CONFIG_USERCONFIG: share },
    ])("%j", async extra => {
    expect(await install(extra)).toEqual({ complaints: [], lockfile: ["bun.lock"], exitCode: 0 });
  });
});

// A WHATWG parse reads such bytes as U+FFFD and serialises that as %EF%BF%BD: a request for something else than was named.
describe.concurrent("bytes that are not valid UTF-8 are not read as U+FFFD", () => {
  // Latin-1 text with a stray continuation byte and a lone 0x9B.
  const bad = Buffer.from([0x82, 0x41, 0x9b, 0x41]);
  const bytes = (...parts: (string | Buffer)[]) => Buffer.concat(parts.map(part => Buffer.from(part as string)));
  const packageJson = (...dependencies: (string | Buffer)[]) =>
    bytes(`{"name":"app","version":"1.0.0","dependencies":{`, ...dependencies, `}}`);

  /** Records request lines byte for byte (as Latin-1). Answers 404, or `manifest` to what is not a tarball. */
  function rawServer({
    secure = false,
    manifest,
  }: { secure?: boolean; manifest?: (host: string, line: string) => Buffer } = {}) {
    const requests: { line: string; authorization: string | null }[] = [];
    const listener = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      ...(secure ? { tls } : {}),
      socket: {
        data(socket, chunk) {
          const head = chunk.toString("latin1");
          const line = head.slice(0, head.indexOf("\r\n"));
          requests.push({ line, authorization: /\r\nauthorization: ([^\r]*)/i.exec(head)?.[1] ?? null });
          const body = manifest && !line.includes(".tgz") ? manifest(host, line) : Buffer.alloc(0);
          const status = body.length ? "200 OK" : "404 Not Found";
          socket.end(
            bytes(
              `HTTP/1.1 ${status}\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n`,
              body,
            ),
          );
        },
      },
    });
    const host = `127.0.0.1:${listener.port}`;
    return {
      host,
      requests,
      [Symbol.dispose]() {
        listener.stop(true);
      },
    };
  }

  async function install(files: Record<string, string | Buffer>, ...args: string[]) {
    using dir = tempDir("npmrc-not-utf8", { "home/.keep": "", ...files });
    const home = join(String(dir), "home");
    await using proc = Bun.spawn({
      cmd: [bunExe(), "install", ...args],
      cwd: String(dir),
      env: {
        ...env,
        HOME: home,
        USERPROFILE: home,
        XDG_CONFIG_HOME: undefined,
        BUN_INSTALL_CACHE_DIR: join(String(dir), ".cache"),
        BUN_CONFIG_HTTP_RETRY_COUNT: "0",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.bytes(), proc.exited]);
    return { stderr: Buffer.from(stderr).toString("latin1"), exitCode };
  }

  test("a tarball URL is requested as written", async () => {
    using server = rawServer();
    const { exitCode } = await install({
      "package.json": packageJson(`"bad":"http://${server.host}/f/bad-`, bad, `.tgz"`),
    });
    expect(server.requests.map(request => request.line)).toEqual(["GET /f/bad-\x82A\x9bA.tgz HTTP/1.1"]);
    expect(exitCode).toBe(1);
  });

  // No key is computed for it, because the key would come from the parsed URL and the request from the bytes as
  // written.
  test("such a tarball URL doesn't get its own .npmrc line", async () => {
    using cdn = rawServer({ secure: true });
    using registry = rawServer({
      manifest(_, line) {
        const name = line.includes("/good") ? "good" : "bad";
        return bytes(
          `{"name":"${name}","dist-tags":{"latest":"1.0.0"},"versions":{"1.0.0":{"name":"${name}","version":"1.0.0","dist":{"tarball":"https://${cdn.host}/f/${name}-`,
          name === "bad" ? bad : "1.0.0",
          `.tgz"}}}}`,
        );
      },
    });
    const { exitCode } = await install(
      {
        "package.json": packageJson(`"bad":"1.0.0","good":"1.0.0"`),
        ".npmrc": `registry=http://${registry.host}/\n//${cdn.host}/:_authToken=line-token\n`,
      },
      "--ca",
      tls.cert,
    );
    expect(cdn.requests.sort((a, b) => a.line.localeCompare(b.line))).toEqual([
      { line: "GET /f/bad-\x82A\x9bA.tgz HTTP/1.1", authorization: null },
      { line: "GET /f/good-1.0.0.tgz HTTP/1.1", authorization: "Bearer line-token" },
    ]);
    expect(exitCode).toBe(1);
  });

  test("on the origin of its registry it gets the registry's credentials", async () => {
    using server = rawServer({
      manifest: host =>
        bytes(
          `{"name":"pkg","dist-tags":{"latest":"1.0.0"},"versions":{"1.0.0":{"name":"pkg","version":"1.0.0","dist":{"tarball":"http://${host}/f/pkg-`,
          bad,
          `.tgz"}}}}`,
        ),
    });
    const { exitCode } = await install({
      "package.json": packageJson(`"pkg":"1.0.0"`),
      ".npmrc": `registry=http://${server.host}/reg/\n//${server.host}/reg/:_authToken=registry-token\n`,
    });
    expect(server.requests).toEqual([
      { line: "GET /reg/pkg HTTP/1.1", authorization: "Bearer registry-token" },
      { line: "GET /f/pkg-\x82A\x9bA.tgz HTTP/1.1", authorization: "Bearer registry-token" },
    ]);
    expect(exitCode).toBe(1);
  });

  test.each([
    ["a dependency name", [`"n-`, bad, `":"1.0.0"`]],
    ["the name an alias points to", [`"alias":"npm:n-`, bad, `@1.0.0"`]],
  ])("%s is refused before any request", async (_, dependencies) => {
    using server = rawServer();
    const { stderr, exitCode } = await install({
      "package.json": packageJson(...dependencies),
      ".npmrc": `registry=http://${server.host}/reg/\n//${server.host}/reg/:_authToken=registry-token\n`,
    });
    expect(server.requests).toEqual([]);
    expect(stderr).toContain(`error: Failed to join registry "http://${server.host}/reg/" and package "n-`);
    expect(exitCode).toBe(1);
  });

  // The one case in which the URL is built at request time, from the registry URL and the name, and is not parsed again.
  test("a manifest without dist.tarball: the URL is built from the registry URL", async () => {
    using server = rawServer({
      manifest: () =>
        bytes(`{"name":"pkg","dist-tags":{"latest":"1.0.0"},"versions":{"1.0.0":{"name":"pkg","version":"1.0.0"}}}`),
    });
    const { exitCode } = await install({
      "package.json": packageJson(`"pkg":"1.0.0"`),
      ".npmrc": `registry=http://${server.host}/reg/\n//${server.host}/reg/:_authToken=registry-token\n`,
    });
    expect(server.requests).toEqual([
      { line: "GET /reg/pkg HTTP/1.1", authorization: "Bearer registry-token" },
      { line: "GET /reg/pkg/-/pkg-1.0.0.tgz HTTP/1.1", authorization: "Bearer registry-token" },
    ]);
    expect(exitCode).toBe(1);
  });
});
