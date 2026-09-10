import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as tls from "node:tls";

describe("tls.createSecureContext extra arguments test", () => {
  it("should throw an error if the privateKeyEngine is not a string", () => {
    // @ts-expect-error
    expect(() => tls.createSecureContext({ privateKeyIdentifier: "valid", privateKeyEngine: 0 })).toThrow(
      "string or one of null or undefined",
    );
    // @ts-expect-error
    expect(() => tls.createSecureContext({ privateKeyIdentifier: "valid", privateKeyEngine: true })).toThrow(
      "string or one of null or undefined",
    );
    // @ts-expect-error
    expect(() => tls.createSecureContext({ privateKeyIdentifier: "valid", privateKeyEngine: {} })).toThrow(
      "string or one of null or undefined",
    );
  });

  it("should throw an error if the privateKeyIdentifier is not a string", () => {
    // @ts-expect-error
    expect(() => tls.createSecureContext({ privateKeyIdentifier: 0, privateKeyEngine: "valid" })).toThrow(
      "string or one of null or undefined",
    );
    // @ts-expect-error
    expect(() => tls.createSecureContext({ privateKeyIdentifier: true, privateKeyEngine: "valid" })).toThrow(
      "string or one of null or undefined",
    );
    // @ts-expect-error
    expect(() => tls.createSecureContext({ privateKeyIdentifier: {}, privateKeyEngine: "valid" })).toThrow(
      "string or one of null or undefined",
    );
  });

  it("should throw with a valid privateKeyIdentifier but missing privateKeyEngine", () => {
    expect(() => tls.createSecureContext({ privateKeyIdentifier: "valid" })).toThrow(
      "The property 'options.privateKeyEngine' is invalid. Received undefined",
    );
  });

  it("should not throw for invalid privateKeyEngine when privateKeyIdentifier is not provided", () => {
    // Node.js does not throw an error in the case where only privateKeyEngine is provided, even if
    // the key is invalid. The checks for both keys are only done when privateKeyIdentifier is passed.
    // Verifiable with: `node -p 'tls.createSecureContext({ privateKeyEngine: 0 })'`

    // @ts-expect-error
    expect(() => tls.createSecureContext({ privateKeyEngine: 0 })).not.toThrow();
    // @ts-expect-error
    expect(() => tls.createSecureContext({ privateKeyEngine: true })).not.toThrow();
    // @ts-expect-error
    expect(() => tls.createSecureContext({ privateKeyEngine: {} })).not.toThrow();
  });

  it("should throw for invalid privateKeyIdentifier", () => {
    // @ts-expect-error
    expect(() => tls.createSecureContext({ privateKeyIdentifier: 0 })).toThrow(
      "The property 'options.privateKeyEngine' is invalid. Received undefined",
    );

    // @ts-expect-error
    expect(() => tls.createSecureContext({ privateKeyIdentifier: true })).toThrow(
      "The property 'options.privateKeyEngine' is invalid. Received undefined",
    );

    // @ts-expect-error
    expect(() => tls.createSecureContext({ privateKeyIdentifier: {} })).toThrow(
      "The property 'options.privateKeyEngine' is invalid. Received undefined",
    );
  });
});

describe("tls.createSecureContext pfx argument", () => {
  it("throws instead of crashing when the pfx buffer is detached", async () => {
    // A detached view reaches the native PKCS#12 parser as a null pointer. Run
    // in a child so a regression aborts that process, not the test runner.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          import tls from "node:tls";
          const report = (label, fn) => {
            try {
              fn();
              console.log(label + ": no error");
            } catch (e) {
              console.log(label + ": " + e.message);
            }
          };
          const view = new Uint8Array(64);
          structuredClone(view.buffer, { transfer: [view.buffer] });
          report("detached view", () => tls.createSecureContext({ pfx: view }));
          const arrayBuffer = new ArrayBuffer(64);
          structuredClone(arrayBuffer, { transfer: [arrayBuffer] });
          report("detached ArrayBuffer", () => tls.createSecureContext({ pfx: arrayBuffer }));
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toBe(
      [
        "detached view: PFX certificate argument is mandatory",
        "detached ArrayBuffer: PFX certificate argument is mandatory",
        "",
      ].join("\n"),
    );
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  it("reads the whole byte range of a non-Uint8Array view", () => {
    // agent10.pfx is 4736 bytes, so it can be viewed exactly as 8-byte elements.
    const pfx = readFileSync(join(import.meta.dir, "../test/fixtures/keys/agent10.pfx"));
    const bytes = new Uint8Array(pfx).buffer;
    expect(bytes.byteLength % 8).toBe(0);
    for (const view of [new Uint16Array(bytes), new Float64Array(bytes)]) {
      // @ts-expect-error the types only admit Buffer, the runtime accepts any view
      expect(() => tls.createSecureContext({ pfx: view, passphrase: "sample" })).not.toThrow();
    }
  });
});
