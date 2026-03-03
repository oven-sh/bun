import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";

// Test for https://github.com/oven-sh/bun/issues/27708
//
// Root cause: Error.prepareStackTrace interacts incorrectly with ES5-style
// Error subclasses when called through Error.captureStackTrace.
//
// 1. @babel/core's loadPartialConfig/transformSync replaces Error.prepareStackTrace
//    with a "stackTraceRewriter" that chains to the original prepareStackTrace.
// 2. @xmldom/xmldom uses ES5-style Error subclassing (Object.create(Error.prototype))
//    for its ParseError class, without calling super()/Error.call(this).
// 3. When Error.captureStackTrace is called on this non-ErrorInstance object,
//    bun's default prepareStackTrace (jsFunctionDefaultErrorPrepareStackTrace) was
//    called through the chain and threw TypeError because it required a JSC ErrorInstance.
// 4. This TypeError prevents xmldom's ParseError from being properly thrown during
//    malformed SVG parsing, causing the SAX parser to enter an error recovery path
//    that leads to an infinite loop in the position() function's linePattern regex.

const HELPERS_TS = `
import { DOMParser } from "@xmldom/xmldom";

interface DomNode {
  readonly tagName?: string;
  readonly nodeType: number;
  readonly attributes?: {
    readonly length: number;
    item(index: number): { readonly name: string; readonly value: string } | null;
  };
  readonly childNodes?: {
    readonly length: number;
    item(index: number): DomNode | null;
  };
}

const FORBIDDEN_ELEMENTS = new Set(["script", "style", "foreignobject"]);
const EVENT_HANDLER_PATTERN = /^on[a-z]+$/i;

interface Violation { rule: string; message: string; }
interface ValidationResult { valid: boolean; violations: Violation[]; }

const walkNode = (node: DomNode, violations: Violation[]): void => {
  const tagName = node.tagName?.toLowerCase() ?? "";
  if (FORBIDDEN_ELEMENTS.has(tagName)) {
    violations.push({ rule: "forbidden-element", message: "Forbidden: " + tagName });
  }
  if (node.attributes) {
    for (let i = 0; i < node.attributes.length; i++) {
      const attr = node.attributes.item(i);
      if (attr && EVENT_HANDLER_PATTERN.test(attr.name)) {
        violations.push({ rule: "event-handler", message: attr.name });
      }
    }
  }
  if (node.childNodes) {
    for (let i = 0; i < node.childNodes.length; i++) {
      const child = node.childNodes.item(i);
      if (child && child.nodeType === 1) walkNode(child, violations);
    }
  }
};

export const validateSvg = (svg: string): ValidationResult => {
  const violations: Violation[] = [];
  const sanitized = svg.replace(/<!DOCTYPE[^[>]*(?:\\[[^\\]]*\\])?\\s*>/gi, "").replace(/<!ENTITY[^>]*>/gi, "");
  if (svg !== sanitized) violations.push({ rule: "xxe-prevention", message: "DOCTYPE/ENTITY" });
  try {
    // No onError handler — xmldom defaults to console.error output
    const parser = new DOMParser();
    const doc = parser.parseFromString(sanitized, "image/svg+xml");
    if (doc.documentElement) walkNode(doc.documentElement, violations);
  } catch {
    violations.push({ rule: "parse-error", message: "Parse failed" });
  }
  return { valid: violations.length === 0, violations };
};
`;

// Generate a test file that exercises xmldom DOMParser with malformed input
// to produce stderr output via console.error
function makeParseTestFile(index: number): string {
  return `
import { describe, expect, test } from "bun:test";
import { validateSvg } from "./helpers";

describe("SVG validation batch ${index}", () => {
  test("accepts valid SVG", () => {
    const r = validateSvg('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h24v24H0z"/></svg>');
    expect(r.valid).toBe(true);
  });
  test("rejects script element", () => {
    const r = validateSvg('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    expect(r.valid).toBe(false);
  });
  test("handles malformed SVG", () => {
    const r = validateSvg("<not-valid-svg-${index}>");
    expect(r).toHaveProperty("valid");
  });
  test("handles random garbage", () => {
    for (let i = 0; i < 20; i++) {
      const garbage = Array.from({ length: 50 }, () => String.fromCharCode(Math.floor(Math.random() * 128))).join("");
      const r = validateSvg(garbage);
      expect(typeof r.valid).toBe("boolean");
    }
  });
});
`;
}

// Generate the async svgr test file
const SVGR_TEST = `
import { describe, expect, test } from "bun:test";
import { transform } from "@svgr/core";

describe("SVGR transformation", () => {
  test("transforms SVG to React component", async () => {
    const result = await transform(
      '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h24v24H0z"/></svg>',
      { plugins: ["@svgr/plugin-jsx"] },
      { componentName: "TestIcon" },
    );
    expect(result).toContain("TestIcon");
    expect(result).toContain("export default");
  });
  test("handles SVG with viewBox", async () => {
    const result = await transform(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/></svg>',
      { plugins: ["@svgr/plugin-jsx"] },
      { componentName: "CircleIcon" },
    );
    expect(result).toContain("CircleIcon");
  });
});
`;

test("bun test should not hang with 7+ test files combining xmldom stderr and svgr async", async () => {
  const files: Record<string, string> = {
    "package.json": JSON.stringify({
      name: "stderr-hang-regression",
      private: true,
      devDependencies: {
        "@svgr/core": "^8.1.0",
        "@svgr/plugin-jsx": "^8.1.0",
        "@xmldom/xmldom": "^0.9.8",
      },
    }),
    "tests/helpers.ts": HELPERS_TS,
    "tests/svgr.test.ts": SVGR_TEST,
  };

  // Create 7 parse test files to exceed the threshold
  for (let i = 1; i <= 7; i++) {
    files[`tests/parse-${String(i).padStart(2, "0")}.test.ts`] = makeParseTestFile(i);
  }

  const dir = tempDirWithFiles("issue-27708", files);

  // Install dependencies
  const install = Bun.spawnSync({
    cmd: [bunExe(), "install"],
    cwd: dir,
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });
  expect(install.exitCode).toBe(0);

  // Run bun test — before the fix, this would hang indefinitely.
  // Non-hang is enforced by this test's 60s timeout.
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test"],
    cwd: dir,
    env: bunEnv,
    stderr: "ignore",
    stdout: "ignore",
  });

  const exitCode = await proc.exited;
  expect(exitCode).toBe(0);
}, 60_000); // 60s test timeout
