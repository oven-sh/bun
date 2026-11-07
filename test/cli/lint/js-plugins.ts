// What js-plugins.test.ts and js-plugin-api.test.ts share.
import { bunEnv, bunExe, isASAN, isDebug, normalizeBunSnapshot, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "../children";

// Disable AI agent and CI detection regardless of the environment the tests run in.
export const env = {
  ...bunEnv,
  AGENT: "0",
  CLAUDECODE: undefined,
  REPL_ID: undefined,
  GITHUB_ACTIONS: undefined,
  GITHUB_WORKSPACE: undefined,
  NO_COLOR: undefined,
  FORCE_COLOR: undefined,
};

export async function lint(
  files: Record<string, string | Buffer>,
  args: string[],
  reads: string[] = [],
  variables: Record<string, string> = {},
) {
  using dir = tempDir("bun-lint-js-plugins", files);
  await using proc = spawn({
    cmd: [bunExe(), "lint", ...(args.includes("--threads") ? [] : ["--threads", "2"]), ...args],
    env: { ...env, ...variables },
    cwd: String(dir),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  // If a run fails or crashes, the assertion that fails is often about something else, so print the real cause.
  if (exitCode !== 0 && exitCode !== 1) console.error(`bun lint ${args.join(" ")}: exit code ${exitCode}\n${stderr}`);
  return {
    raw: stdout,
    stdout: normalizeBunSnapshot(stdout, String(dir)),
    stderr: normalizeBunSnapshot(stderr, String(dir)),
    exitCode,
    files: Object.fromEntries(reads.map(name => [name, readFileSync(join(String(dir), name), "utf8")])),
  };
}

export const oxlintrc = (config: object) =>
  JSON.stringify({ categories: { correctness: "off" }, ignorePatterns: ["plugin.mjs"], ...config });

// Each thread that lints a file starts a VM, which takes seconds in a debug build.
export const timeout = isDebug || isASAN ? 120_000 : 10_000;

// Reports every identifier called `foo`, using most of the report API.
export const noFoo = `
export default {
  meta: { name: "eslint-plugin-demo" },
  rules: {
    "no-foo": {
      meta: {
        type: "problem",
        fixable: "code",
        hasSuggestions: true,
        messages: { found: "No {{ name }} in a {{parent}}{{suffix}}", rename: "Call it {{to}}." },
        schema: [{ type: "object", properties: { suffix: { type: "string", default: "." } }, additionalProperties: false }],
        defaultOptions: [{}],
      },
      create(context) {
        return {
          Identifier(node) {
            if (node.name !== "foo") return;
            context.report({
              node,
              messageId: "found",
              data: { name: node.name, parent: node.parent.type, suffix: context.options[0].suffix },
              fix: fixer => fixer.replaceText(node, "bar"),
              suggest: [{ messageId: "rename", data: { to: "baz" }, fix: fixer => fixer.replaceText(node, "baz") }],
            });
          },
        };
      },
    },
  },
};
`;
