import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "fs";
import { bunEnv, bunExe } from "harness";
import path from "path";
import { tempDirWithBakeDeps } from "../bake-harness";

// `bun build --app` gives the transpilers of the app, and the VMs of their macros, an environment of their own. It is
// not the one of the VM that loads the configuration, so the command has to keep the default `.env` files out of it.
const files = {
  ".env": "API_KEY=key-from-dot-env\n",
  "values.ts": "export const values = () => String(process.env.API_KEY);\n",
  "src/index.tsx": `export default { app: { framework: "react" } };`,
  "pages/index.tsx": `import { values } from "../values.ts" with { type: "macro" };

export default function IndexPage() {
  return <div>{"seen:" + values()}</div>;
}`,
  "package.json": JSON.stringify({
    "name": "test-app",
    "version": "1.0.0",
    "devDependencies": {
      "react": "^18.0.0",
      "react-dom": "^18.0.0",
    },
  }),
};

// The timeout is explicit because a production build of a React app takes more than the 5s default on a debug build.
test.concurrent.each([
  ["bun build --app", [], "seen:key-from-dot-env"],
  ["bun build --app --no-env-file", ["--no-env-file"], "seen:undefined"],
])(
  "%s: what a macro of a page has of .env",
  async (_, flags, seen) => {
    const dir = await tempDirWithBakeDeps("bake-production-env", files);
    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--app", ...flags, "./src/index.tsx"],
      env: { ...bunEnv, NODE_ENV: undefined, API_KEY: undefined },
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const page = path.join(dir, "dist", "index.html");
    const html = existsSync(page) ? readFileSync(page, "utf8") : stderr;
    expect({ seen: /seen:[\w-]+/.exec(html)?.[0] ?? html, exitCode }).toEqual({ seen, exitCode: 0 });
  },
  120_000,
);
