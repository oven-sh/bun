import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, rmSync } from "fs";
import { bunEnv, bunExe } from "harness";
import path from "path";
import { tempDirWithBakeDeps } from "../bake-harness";

// Each client component is an entry point of the client build. The build
// numbers them in the order that the pages import them in, and that number
// decides the order of the imports between the chunks. Alpha shares a chunk
// with Beta and another one with Gamma. The plugin makes the bundler parse the
// components in the order of PARSE_ORDER: a component waits until the bundler
// asks for a file that only the component before it imports.
test("client components are numbered in import order, whichever is parsed first", async () => {
  const components = ["Alpha", "Beta", "Gamma"];
  const shared: Record<string, string[]> = { Alpha: ["x", "y"], Beta: ["x"], Gamma: ["y"] };
  const dir = await tempDirWithBakeDeps("bake-production-entry-order", {
    "src/index.tsx": `
import { basename } from "node:path";
const order = process.env.PARSE_ORDER.split(",");
const parsed = Object.fromEntries(order.map(name => [name, Promise.withResolvers()]));
const parseInOrder = {
  name: "parse-in-order",
  setup(builder) {
    builder.onLoad({ filter: /components/ }, async ({ path }) => {
      const file = basename(path);
      const name = file.split(/[-.]/)[0];
      if (!(name in parsed)) return undefined;
      if (file.includes("-parsed")) {
        parsed[name].resolve();
      } else {
        const before = order[order.indexOf(name) - 1];
        if (before) await parsed[before].promise;
      }
      return undefined;
    });
  },
};
export default { app: { framework: "react", plugins: [parseInOrder] } };`,
    "pages/index.tsx": `
${components.map(name => `import ${name} from "../components/${name}";`).join("\n")}
export default function IndexPage() {
  return <div>${components.map(name => `<${name} />`).join("")}</div>;
}`,
    "components/x.ts": `export const x = "x".repeat(2);`,
    "components/y.ts": `export const y = "y".repeat(2);`,
    ...Object.fromEntries(
      components.flatMap(name => [
        [
          `components/${name}.tsx`,
          `"use client";
import "./${name}-parsed";
${shared[name].map(file => `import { ${file} } from "./${file}";`).join("\n")}
export default function ${name}() { return <b>${name} ${shared[name].map(file => `{${file}}`).join(" ")}</b>; }`,
        ],
        [`components/${name}-parsed.ts`, `globalThis.${name}Parsed = true;`],
      ]),
    ),
    "package.json": JSON.stringify({ name: "test-app", version: "1.0.0" }),
  });

  const dist = path.join(dir, "dist");
  const build = async (order: string[]) => {
    rmSync(dist, { recursive: true, force: true });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--app", "./src/index.tsx"],
      env: { ...bunEnv, PARSE_ORDER: order.join(",") },
      cwd: dir,
      stdout: "ignore",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    const files = existsSync(dist)
      ? (readdirSync(dist, { recursive: true }) as string[])
          .map(file => file.replaceAll("\\", "/"))
          .filter(file => path.extname(file) !== "")
          .sort()
          .map(file => [file, Bun.hash(readFileSync(path.join(dist, file))).toString(16)])
      : [];
    return { files, stderr: exitCode === 0 ? "" : stderr, exitCode };
  };
  const inOrder = await build(components);
  const reversed = await build(components.toReversed());
  expect(reversed).toEqual(inOrder);
  expect(inOrder.files.map(([file]) => file)).toContain("index.html");
  expect(inOrder.exitCode).toBe(0);
}, 120_000);
