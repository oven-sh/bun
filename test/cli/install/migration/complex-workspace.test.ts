// Migrates a package-lock.json spanning every resolution shape the npm migrator handles in one
// workspace: workspace packages, a `file:` folder and `file:` tarball, a remote tarball URL, `npm:`
// aliases (including a self-named alias inside a linked folder), a scoped transitive, and per-
// workspace version conflicts that force nested installs. Every tarball is served locally.
import { afterAll, beforeAll, expect, test } from "bun:test";
import fs from "fs";
import { VerdaccioRegistry, bunEnv, bunExe, pack, tmpdirSync } from "harness";
import path from "path";

const registry = new VerdaccioRegistry();
let tarballServer: ReturnType<typeof Bun.serve>;
let cwd: string | undefined = tmpdirSync();

function validate(packagePath: string, version: string, realPackageName?: string) {
  test(`${packagePath} is ${realPackageName ? `${realPackageName}@${version}` : version}`, () => {
    if (!cwd) throw new Error("install failed");
    const pkg = JSON.parse(fs.readFileSync(path.join(cwd, packagePath, "package.json"), "utf8"));
    expect(pkg.version).toBe(version);
    if (realPackageName) {
      expect(pkg.name).toBe(realPackageName);
    }
  });
}

function mustExist(filePath: string) {
  test(`${filePath} exists`, () => {
    if (!cwd) throw new Error("install failed");
    if (!fs.existsSync(path.join(cwd, filePath))) {
      throw new Error(`File ${filePath} was not found`);
    }
  });
}

function mustNotExist(filePath: string) {
  test(`${filePath} does not exist`, () => {
    if (!cwd) throw new Error("install failed");
    if (fs.existsSync(path.join(cwd, filePath))) {
      throw new Error(`File ${filePath} was found`);
    }
  });
}

// Verdaccio's checked-in packages have stable integrity hashes, so the generated package-lock.json
// carries real SRI values without any network round-trip.
const integrity = {
  "a-dep@1.0.2": "sha512-786lp/Wqdz6jY9NOPFnU2OZAl/7wW/CWCHNn4I+0Or9NtA0F9I1TXtisuy8hMFw/6u6CYXwlzdwySiOdpJ94oQ==",
  "a-dep@1.0.5": "sha512-eKtFd4hOTiMNvOOCpwRCkRvkUB6DU6HmDF/AFCUw28s6nhNLzX62xh/ETLWMhOmeEH8JnKx3/3IY/QMhdju1jw==",
  "a-dep@1.0.10": "sha512-NeQ6Ql9jRW8V+VOiVb+PSQAYOvVoSimW+tXaR0CoJk4kM9RIk/XlAUGCsNtn5XqjlDO4hcH8NcyaL507InevEg==",
  "no-deps@1.0.0": "sha512-v4w12JRjUGvfHDUP8vFDwu0gUWu04j0cv9hLb1Abf9VdaXu4XcrddYFTMVBVvmldKViGWH7jrb6xPJRF0wq6gw==",
  "no-deps@1.1.0": "sha512-ebG2pipYAKINcNI3YxdsiAgFvNGp2gdRwxAKN2LYBm9+YxuH/lHH2sl+GKQTuGiNfCfNZRMHUyyLPEJD6HWm7w==",
  "no-deps@2.0.0": "sha512-W3duJKZPcMIG5rA1io5cSK/bhW9rWFz+jFxZsKS/3suK4qHDkQNxUTEXee9/hTaAoDCeHWQqogukWYKzfr6X4g==",
  "is-number@1.0.0": "sha512-PWbU1PO3loy/91zx8zOoQ37b8UWuu64eJONVIObQSlUUrYag+zy562vmZuRwRcv2hDhgK1Dc9qkJVS954CB1Nw==",
  "@types/is-number@2.0.0":
    "sha512-GEeIxCB+NpM1NrDBqmkYPeU8bI//i+xPzdOY4E1YHet51IcFmz4js6k57m69fLl/cbn7sOR7wj9RNNw53X8AiA==",
  "two-range-deps@1.0.0":
    "sha512-N+6kPy/GxuMncNz/EKuIrwdoYbh1qmvHDnw1UbM3sQE184kBn+6qAQgtf1wgT9dJnt6X+tWcTzSmfDvtJikVBA==",
};

beforeAll(async () => {
  await registry.start();

  // Remote tarball dependency: serve bar-0.0.2.tgz over loopback instead of github.com.
  const barTgz = fs.readFileSync(path.join(import.meta.dir, "..", "bar-0.0.2.tgz"));
  tarballServer = Bun.serve({
    port: 0,
    fetch: () => new Response(barTgz),
  });
  const barUrl = `http://localhost:${tarballServer.port}/bar-0.0.2.tgz`;
  const barIntegrity = "sha512-" + Buffer.from(await crypto.subtle.digest("SHA-512", barTgz)).toString("base64");

  const registryUrl = registry.registryUrl().replace(/\/$/, "");
  const reg = (name: string, version: string) => `${registryUrl}/${name}/-/${name.split("/").pop()}-${version}.tgz`;

  const write = (rel: string, content: string) => {
    const full = path.join(cwd!, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  };

  write(
    "package.json",
    JSON.stringify({
      name: "root",
      version: "0.0.0",
      dependencies: {
        "a-dep": "1.0.10",
        "bar": barUrl,
        "bun-types": "file:bun-types",
        "hello": "file:hello-0.3.2.tgz",
        "is-number": "^1.0.0",
      },
      workspaces: ["packages/*"],
    }),
  );

  write(
    "bun-types/package.json",
    JSON.stringify({
      name: "bun-types",
      version: "1.0.0",
      dependencies: { "bun-types": "npm:no-deps@^1.0.0" },
    }),
  );
  write("bun-types/isfake.txt", "");

  write("packages/body-parser/package.json", JSON.stringify({ name: "body-parser", version: "200.0.0" }));
  write("packages/lol-package/package.json", JSON.stringify({ name: "lol", dependencies: { "no-deps": "^2.0.0" } }));
  write(
    "packages/second/package.json",
    JSON.stringify({
      name: "second",
      version: "3.0.0",
      dependencies: {
        "a-dep": "1.0.5",
        "body-parser": "npm:two-range-deps@1.0.0",
        "express": "npm:a-dep@*",
        "lol": "*",
        "not-body-parser": "*",
      },
    }),
  );
  write(
    "packages/with-postinstall/package.json",
    JSON.stringify({
      name: "with-postinstall",
      version: "1.0.0",
      dependencies: { "a-dep": "1.0.2" },
      scripts: { postinstall: `${JSON.stringify(bunExe())} postinstall.js` },
    }),
  );
  write(
    "packages/with-postinstall/postinstall.js",
    `require("fs").writeFileSync(require("path").join(__dirname, "postinstall.txt"), "i ran!");\n`,
  );

  // `file:` tarball dependency with a transitive dep that resolves against the local registry.
  const helloSrc = tmpdirSync();
  fs.writeFileSync(
    path.join(helloSrc, "package.json"),
    JSON.stringify({ name: "hello", version: "0.3.2", dependencies: { "a-dep": "^1.0.0" } }),
  );
  fs.writeFileSync(path.join(helloSrc, "version.txt"), "0.3.2\n");
  await pack(helloSrc, bunEnv, "--destination", cwd!);
  if (!fs.existsSync(path.join(cwd!, "hello-0.3.2.tgz"))) throw new Error("failed to pack hello");
  const helloIntegrity =
    "sha512-" +
    Buffer.from(await crypto.subtle.digest("SHA-512", fs.readFileSync(path.join(cwd!, "hello-0.3.2.tgz")))).toString(
      "base64",
    );

  write(
    "package-lock.json",
    JSON.stringify(
      {
        name: "root",
        version: "0.0.0",
        lockfileVersion: 3,
        requires: true,
        packages: {
          "": {
            name: "root",
            version: "0.0.0",
            workspaces: ["packages/*"],
            dependencies: {
              "a-dep": "1.0.10",
              "bar": barUrl,
              "bun-types": "file:bun-types",
              "hello": "file:hello-0.3.2.tgz",
              "is-number": "^1.0.0",
            },
          },
          "bun-types": {
            version: "1.0.0",
            dependencies: { "bun-types": "npm:no-deps@^1.0.0" },
          },
          "bun-types/node_modules/bun-types": {
            name: "no-deps",
            version: "1.0.0",
            resolved: reg("no-deps", "1.0.0"),
            integrity: integrity["no-deps@1.0.0"],
          },
          "node_modules/@types/is-number": {
            version: "2.0.0",
            resolved: reg("@types/is-number", "2.0.0"),
            integrity: integrity["@types/is-number@2.0.0"],
          },
          "node_modules/a-dep": {
            version: "1.0.10",
            resolved: reg("a-dep", "1.0.10"),
            integrity: integrity["a-dep@1.0.10"],
          },
          "node_modules/bar": {
            version: "0.0.2",
            resolved: barUrl,
            integrity: barIntegrity,
          },
          "node_modules/body-parser": { resolved: "packages/body-parser", link: true },
          "node_modules/bun-types": { resolved: "bun-types", link: true },
          "node_modules/express": {
            name: "a-dep",
            version: "1.0.10",
            resolved: reg("a-dep", "1.0.10"),
            integrity: integrity["a-dep@1.0.10"],
          },
          "node_modules/hello": {
            version: "0.3.2",
            resolved: "file:hello-0.3.2.tgz",
            integrity: helloIntegrity,
            dependencies: { "a-dep": "^1.0.0" },
          },
          "node_modules/is-number": {
            version: "1.0.0",
            resolved: reg("is-number", "1.0.0"),
            integrity: integrity["is-number@1.0.0"],
          },
          "node_modules/lol": { resolved: "packages/lol-package", link: true },
          "node_modules/no-deps": {
            version: "1.1.0",
            resolved: reg("no-deps", "1.1.0"),
            integrity: integrity["no-deps@1.1.0"],
          },
          "node_modules/not-body-parser": { resolved: "packages/body-parser", link: true },
          "node_modules/second": { resolved: "packages/second", link: true },
          "node_modules/with-postinstall": { resolved: "packages/with-postinstall", link: true },
          "packages/body-parser": { version: "200.0.0" },
          "packages/lol-package": { name: "lol", dependencies: { "no-deps": "^2.0.0" } },
          "packages/lol-package/node_modules/no-deps": {
            version: "2.0.0",
            resolved: reg("no-deps", "2.0.0"),
            integrity: integrity["no-deps@2.0.0"],
          },
          "packages/second": {
            version: "3.0.0",
            dependencies: {
              "a-dep": "1.0.5",
              "body-parser": "npm:two-range-deps@1.0.0",
              "express": "npm:a-dep@*",
              "lol": "*",
              "not-body-parser": "*",
            },
          },
          "packages/second/node_modules/a-dep": {
            version: "1.0.5",
            resolved: reg("a-dep", "1.0.5"),
            integrity: integrity["a-dep@1.0.5"],
          },
          "packages/second/node_modules/body-parser": {
            name: "two-range-deps",
            version: "1.0.0",
            resolved: reg("two-range-deps", "1.0.0"),
            integrity: integrity["two-range-deps@1.0.0"],
            dependencies: { "@types/is-number": ">=1.0.0", "no-deps": "^1.0.0" },
          },
          "packages/with-postinstall": {
            version: "1.0.0",
            hasInstallScript: true,
            dependencies: { "a-dep": "1.0.2" },
          },
          "packages/with-postinstall/node_modules/a-dep": {
            version: "1.0.2",
            resolved: reg("a-dep", "1.0.2"),
            integrity: integrity["a-dep@1.0.2"],
          },
        },
      },
      null,
      2,
    ),
  );

  await registry.writeBunfig(cwd!);
});

afterAll(() => {
  tarballServer?.stop();
  registry.stop();
});

test("the install succeeds", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "install"],
    env: bunEnv,
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  if (exitCode !== 0) {
    cwd = undefined;
    console.error(stderr);
    throw new Error("Failed to install");
  }
  expect(stderr).toContain("migrated lockfile from package-lock.json");
  expect(stdout).toContain("packages installed");
});

// bun-types: `file:` folder with a self-named `npm:` alias
validate("node_modules/bun-types", "1.0.0");
mustExist("node_modules/bun-types/isfake.txt");
validate("node_modules/bun-types/node_modules/bun-types", "1.0.0", "no-deps");
mustNotExist("node_modules/bun-types/node_modules/bun-types/isfake.txt");

// a-dep: one hoisted version plus two nested per-workspace versions
validate("node_modules/a-dep", "1.0.10");
validate("packages/second/node_modules/a-dep", "1.0.5");
validate("packages/with-postinstall/node_modules/a-dep", "1.0.2");
validate("node_modules/express", "1.0.10", "a-dep");

// hello: `file:` tarball with a transitive dep
validate("node_modules/hello", "0.3.2");
mustExist("node_modules/hello/version.txt");

// bar: remote tarball URL
validate("node_modules/bar", "0.0.2");

// body-parser workspace and its aliases
validate("node_modules/body-parser", "200.0.0");
validate("node_modules/not-body-parser", "200.0.0", "body-parser");
validate("packages/second/node_modules/body-parser", "1.0.0", "two-range-deps");

// @types/is-number: scoped transitive of two-range-deps, hoisted
validate("node_modules/@types/is-number", "2.0.0");
validate("node_modules/is-number", "1.0.0");

// with-postinstall: lifecycle script ran
mustExist("packages/with-postinstall/postinstall.txt");

// left-pad is not a dependency of anything here
mustNotExist("node_modules/left-pad");
mustNotExist("packages/second/node_modules/left-pad");
