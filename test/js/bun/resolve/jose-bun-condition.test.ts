// https://github.com/oven-sh/bun/issues/15932
// jose v4.11+ / v5 sets "bun": "./dist/browser/index.js" in its exports map.
// The browser build is a pure WebCrypto build whose importJWK() returns a
// non-extractable CryptoKey; jwks-rsa 3.1 (used by firebase-admin 13) then
// fails to extract any signing keys. Bun now drops jose's "bun" condition so
// it falls through to the Node build, matching Node.js behavior.

import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// jose's exports shape (v4.15.x / v5.x).
const joseExports = {
  ".": {
    types: "./dist/types/index.d.ts",
    bun: "./dist/browser/index.js",
    deno: "./dist/browser/index.js",
    browser: "./dist/browser/index.js",
    worker: "./dist/browser/index.js",
    import: "./dist/node/esm/index.js",
    require: "./dist/node/cjs/index.js",
  },
  "./errors": {
    bun: "./dist/browser/util/errors.js",
    import: "./dist/node/esm/util/errors.js",
    require: "./dist/node/cjs/util/errors.js",
  },
  "./package.json": "./package.json",
};

function fixture(extra: Record<string, string> = {}) {
  return tempDir("jose-bun-condition", {
    "package.json": JSON.stringify({ name: "app", private: true }),
    "node_modules/jose/package.json": JSON.stringify({
      name: "jose",
      version: "4.15.9",
      exports: joseExports,
    }),
    "node_modules/jose/dist/browser/index.js": "module.exports.build = 'browser';",
    "node_modules/jose/dist/browser/util/errors.js": "module.exports.build = 'browser';",
    "node_modules/jose/dist/node/cjs/index.js": "module.exports.build = 'node-cjs';",
    "node_modules/jose/dist/node/cjs/util/errors.js": "module.exports.build = 'node-cjs';",
    "node_modules/jose/dist/node/esm/index.js": "export const build = 'node-esm';",
    "node_modules/jose/dist/node/esm/package.json": JSON.stringify({ type: "module" }),
    "node_modules/jose/dist/node/esm/util/errors.js": "export const build = 'node-esm';",
    "node_modules/jose/dist/types/index.d.ts": "",
    // Control: same shape, different name. Must still pick "bun".
    "node_modules/not-jose/package.json": JSON.stringify({
      name: "not-jose",
      exports: {
        ".": {
          bun: "./bun.js",
          import: "./node.js",
          require: "./node.js",
        },
      },
    }),
    "node_modules/not-jose/bun.js": "module.exports.build = 'bun';",
    "node_modules/not-jose/node.js": "module.exports.build = 'node';",
    ...extra,
  });
}

async function run(dir: string, args: string[]) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args],
    env: bunEnv,
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

describe('jose "bun" export condition override', () => {
  test("require() resolves to the node CJS build", async () => {
    using dir = fixture();
    const { stdout, stderr, exitCode } = await run(String(dir), [
      "-e",
      "console.log(require('jose').build, require('jose/errors').build)",
    ]);
    expect(stderr).toBe("");
    expect(stdout).toBe("node-cjs node-cjs\n");
    expect(exitCode).toBe(0);
  });

  test("import resolves to the node ESM build", async () => {
    using dir = fixture({
      "index.mjs": "import { build } from 'jose'; console.log(build);",
    });
    const { stdout, stderr, exitCode } = await run(String(dir), ["index.mjs"]);
    expect(stderr).toBe("");
    expect(stdout).toBe("node-esm\n");
    expect(exitCode).toBe(0);
  });

  test("only jose is overridden; other packages keep their 'bun' condition", async () => {
    using dir = fixture();
    const { stdout, stderr, exitCode } = await run(String(dir), ["-e", "console.log(require('not-jose').build)"]);
    expect(stderr).toBe("");
    expect(stdout).toBe("bun\n");
    expect(exitCode).toBe(0);
  });

  test("Bun.build with target 'bun' skips jose's 'bun' condition", async () => {
    using dir = fixture({
      "entry.ts": "import { build } from 'jose'; console.log(build);",
    });
    const result = await Bun.build({
      entrypoints: [`${dir}/entry.ts`],
      target: "bun",
    });
    expect(result.success).toBe(true);
    const out = await result.outputs[0].text();
    expect(out).toContain("node-esm");
    expect(out).not.toContain("'browser'");
    expect(out).not.toContain('"browser"');
  });

  test("Bun.build with target 'browser' still resolves jose to its browser build", async () => {
    using dir = fixture({
      "entry.ts": "import { build } from 'jose'; console.log(build);",
    });
    const result = await Bun.build({
      entrypoints: [`${dir}/entry.ts`],
      target: "browser",
    });
    expect(result.success).toBe(true);
    const out = await result.outputs[0].text();
    expect(out).toContain("browser");
  });

  test("jwks-rsa retrieveSigningKeys path imports JWKs successfully (#15932)", async () => {
    // End-to-end shape: jose.importJWK(publicJWK) followed by key export must
    // produce a PEM, which it does from the Node build but not the browser
    // build (the browser build creates a non-extractable CryptoKey).
    using dir = tempDir("jose-jwks-e2e", {
      "package.json": JSON.stringify({ name: "app", private: true }),
      "node_modules/jose/package.json": JSON.stringify({
        name: "jose",
        version: "4.15.9",
        exports: joseExports,
      }),
      "node_modules/jose/dist/browser/index.js": `
        exports.importJWK = async (jwk, alg) => {
          const data = { ...jwk }; delete data.alg; delete data.use;
          return crypto.subtle.importKey('jwk', data,
            { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
            jwk.ext ?? false, ['verify']);
        };
        exports.exportSPKI = async (key) => {
          if (!key.extractable) throw new TypeError('CryptoKey is not extractable');
          const der = new Uint8Array(await crypto.subtle.exportKey('spki', key));
          return '-----BEGIN PUBLIC KEY-----\\n' + Buffer.from(der).toString('base64') + '\\n-----END PUBLIC KEY-----\\n';
        };
      `,
      "node_modules/jose/dist/node/cjs/index.js": `
        const crypto = require('crypto');
        exports.importJWK = async (jwk) => crypto.createPublicKey({ key: jwk, format: 'jwk' });
        exports.exportSPKI = async (key) => key.export({ type: 'spki', format: 'pem' });
      `,
      "node_modules/jose/dist/node/esm/package.json": JSON.stringify({ type: "module" }),
      "node_modules/jose/dist/node/esm/index.js": `
        import crypto from 'crypto';
        export const importJWK = async (jwk) => crypto.createPublicKey({ key: jwk, format: 'jwk' });
        export const exportSPKI = async (key) => key.export({ type: 'spki', format: 'pem' });
      `,
      // Inlined from jwks-rsa 3.1.0 src/utils.js.
      "index.cjs": `
        const jose = require('jose');
        const crypto = require('crypto');
        (async () => {
          const { publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
          const jwk = publicKey.export({ format: 'jwk' });
          jwk.use = 'sig'; jwk.alg = 'RS256'; jwk.kid = 'test-kid';
          try {
            const key = await jose.importJWK(jwk, 'RS256');
            let spki;
            switch (key[Symbol.toStringTag]) {
              case 'CryptoKey': spki = await jose.exportSPKI(key); break;
              default: spki = key.export({ format: 'pem', type: 'spki' });
            }
            console.log(JSON.stringify({ ok: spki.includes('BEGIN PUBLIC KEY') }));
          } catch (err) {
            console.log(JSON.stringify({ ok: false, err: err.message }));
          }
        })();
      `,
    });
    const { stdout, stderr, exitCode } = await run(String(dir), ["index.cjs"]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout.trim())).toEqual({ ok: true });
    expect(exitCode).toBe(0);
  });
});
