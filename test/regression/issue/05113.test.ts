import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/5113
// `bun test` on a file that touches a DOM global (document, window, ...) should
// point at the DOM testing docs instead of a bare ReferenceError.

const DOM_HINT = "preload a DOM library like happy-dom";
const DOM_DOCS_URL = "https://bun.com/docs/test/dom";

async function run(cmd: string[], cwd: string) {
  await using proc = Bun.spawn({
    cmd,
    env: bunEnv,
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode, combined: stdout + stderr };
}

describe("DOM global ReferenceError hint", () => {
  test.concurrent("bun test: `document` hints at the DOM testing docs", async () => {
    using dir = tempDir("dom-hint-document", {
      "dom.test.ts": `
        import { test, expect } from "bun:test";
        test("dom", () => {
          expect(document.body).toBeDefined();
        });
      `,
    });
    const { combined, exitCode } = await run([bunExe(), "test", "dom.test.ts"], String(dir));
    expect(combined).toContain("ReferenceError: document is not defined");
    expect(combined).toContain(DOM_HINT);
    expect(combined).toContain(DOM_DOCS_URL);
    expect(combined).toContain("document");
    expect(exitCode).toBe(1);
  });

  test.concurrent("bun test: `window` hints at the DOM testing docs", async () => {
    using dir = tempDir("dom-hint-window", {
      "dom.test.ts": `
        import { test, expect } from "bun:test";
        test("dom", () => {
          expect(window).toBeDefined();
        });
      `,
    });
    const { combined, exitCode } = await run([bunExe(), "test", "dom.test.ts"], String(dir));
    expect(combined).toContain("ReferenceError: window is not defined");
    expect(combined).toContain(DOM_HINT);
    expect(combined).toContain(DOM_DOCS_URL);
    expect(exitCode).toBe(1);
  });

  test.concurrent("bun test: top-level `HTMLElement` hints at the DOM testing docs", async () => {
    using dir = tempDir("dom-hint-htmlelement", {
      "dom.test.ts": `
        import { test } from "bun:test";
        console.log(HTMLElement);
        test("noop", () => {});
      `,
    });
    const { combined, exitCode } = await run([bunExe(), "test", "dom.test.ts"], String(dir));
    expect(combined).toContain("ReferenceError: HTMLElement is not defined");
    expect(combined).toContain(DOM_HINT);
    expect(combined).toContain(DOM_DOCS_URL);
    expect(exitCode).toBe(1);
  });

  test.concurrent("bun run: `document` hints at the DOM testing docs", async () => {
    using dir = tempDir("dom-hint-run", {
      "index.ts": `console.log(document.body);`,
    });
    const { combined, exitCode } = await run([bunExe(), "index.ts"], String(dir));
    expect(combined).toContain("ReferenceError: document is not defined");
    expect(combined).toContain(DOM_HINT);
    expect(combined).toContain(DOM_DOCS_URL);
    expect(exitCode).toBe(1);
  });

  test.concurrent("non-DOM ReferenceError does not print the DOM hint", async () => {
    using dir = tempDir("dom-hint-negative", {
      "dom.test.ts": `
        import { test, expect } from "bun:test";
        test("dom", () => {
          expect(notADomGlobal).toBeDefined();
        });
      `,
    });
    const { combined, exitCode } = await run([bunExe(), "test", "dom.test.ts"], String(dir));
    expect(combined).toContain("ReferenceError: notADomGlobal is not defined");
    expect(combined).not.toContain(DOM_HINT);
    expect(combined).not.toContain(DOM_DOCS_URL);
    expect(exitCode).toBe(1);
  });

  test.concurrent("user-thrown ReferenceError with DOM message still gets the hint", async () => {
    using dir = tempDir("dom-hint-user-thrown", {
      "dom.test.ts": `
        import { test } from "bun:test";
        test("dom", () => {
          throw new ReferenceError("document is not defined");
        });
      `,
    });
    const { combined, exitCode } = await run([bunExe(), "test", "dom.test.ts"], String(dir));
    expect(combined).toContain("ReferenceError: document is not defined");
    expect(combined).toContain(DOM_HINT);
    expect(exitCode).toBe(1);
  });
});
