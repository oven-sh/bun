import { bunEnv, bunExe, isASAN, tempDir } from "harness";
import path from "node:path";

test("dev server deinitializes itself", () => {
  const result = Bun.spawnSync({
    cmd: [bunExe(), "test", path.join(import.meta.dir, "fixtures/deinitialization/test.ts")],
    env: bunEnv,
    stdio: ["inherit", "inherit", "inherit"],
    cwd: path.join(import.meta.dir, "fixtures/deinitialization"),
  });
  expect(result.signalCode).toBeUndefined();
  expect(result.exitCode).toBe(0);
});

// Terminating a worker while its dev server still has a bundle in flight used
// to free the VirtualMachine (and the bundle state reachable from it) while
// ParseTasks were still running on the shared WorkPool. The stragglers then
// dereferenced the freed VM / bundle heap — observed in production as
// scattered segfaults inside parser codegen (react-refresh import generation).
// The UAF is only reliably detectable under ASAN; release builds corrupt
// silently, so this test is ASAN-only.
test.skipIf(!isASAN)(
  "worker terminate during an in-flight dev server bundle does not use-after-free",
  async () => {
    const components: Record<string, string> = {};
    const imports: string[] = [];
    const elements: string[] = [];
    for (let i = 0; i < 24; i++) {
      components[`Comp${i}.tsx`] = `
        import { useState, useEffect, useMemo } from "react";
        import { useCustom${i} } from "./hooks${i % 4}";
        ${
          // A bundler macro spins up a JSC VM on the worker-pool thread
          // mid-parse, keeping parse tasks in flight long enough that some
          // reliably outlive the worker's teardown.
          i % 2 === 0 ? `import { buildTag } from "./mac.ts" with { type: "macro" };\nconst TAG${i} = buildTag(${i});` : ""
        }
        export function Inner${i}() {
          const [count, setCount] = useState(${i});
          const [other] = useState({ a: ${i} });
          const memo = useMemo(() => count * ${i + 1}, [count]);
          const custom = useCustom${i}();
          useEffect(() => { setCount(c => c); }, []);
          return <div onClick={() => setCount(count + 1)}>{count}{memo}{custom}{other.a}</div>;
        }
        export const Inline${i} = () => {
          const [v] = useState(${i});
          return <span>{v}</span>;
        };
        export default function Comp${i}() {
          const [v, setV] = useState("x${i}");
          return <p onMouseOver={() => setV(v + "!")}>{v}<Inner${i} /><Inline${i} /></p>;
        }
      `;
      imports.push(`import Comp${i} from "./Comp${i}";`);
      elements.push(`<Comp${i} />`);
    }
    for (let j = 0; j < 4; j++) {
      let hooks = `import { useState } from "react";\n`;
      for (let i = j; i < 24; i += 4) {
        hooks += `export function useCustom${i}() { const [v] = useState(${i}); return v; }\n`;
      }
      components[`hooks${j}.tsx`] = hooks;
    }
    components["mac.ts"] = `
      export function buildTag(n: number) {
        return "tag-" + n;
      }
    `;

    using dir = tempDir("bake-worker-terminate", {
      ...components,
      "node_modules/react/package.json": JSON.stringify({ name: "react", version: "0.0.1", main: "index.js" }),
      "node_modules/react/index.js": `
        exports.useState = (v) => [v, () => {}];
        exports.useEffect = () => {};
        exports.useMemo = (f) => f();
      `,
      "node_modules/react/jsx-dev-runtime.js": `
        exports.jsxDEV = (t, p) => ({ t, p });
        exports.Fragment = "Fragment";
      `,
      "node_modules/react-refresh/package.json": JSON.stringify({
        name: "react-refresh",
        version: "0.0.1",
        main: "runtime.js",
      }),
      "node_modules/react-refresh/runtime.js": `
        exports.performReactRefresh = () => {};
        exports.injectIntoGlobalHook = () => {};
        exports.isLikelyComponentType = () => true;
        exports.register = () => {};
        exports.createSignatureFunctionForTransform = () => function (fn) { return fn; };
      `,
      "index.html": `<!DOCTYPE html><html><head></head><body><div id="root"></div><script type="module" src="./App.tsx"></script></body></html>`,
      "App.tsx": `
        ${imports.join("\n")}
        export function App() {
          return <main>${elements.join("")}</main>;
        }
        console.log(App);
      `,
      "worker-server.ts": `
        // @ts-ignore
        import html from "./index.html";
        const server = Bun.serve({
          routes: { "/": html },
          fetch() {
            return new Response("fallback");
          },
          hostname: "127.0.0.1",
          port: 0,
        });
        postMessage({ port: server.port });
      `,
      "terminate-fixture.ts": `
        // Sweep the terminate() timing so at least one iteration lands while
        // the dev server's bundle still has parse tasks in flight.
        for (let i = 0; i < 10; i++) {
          const worker = new Worker(new URL("./worker-server.ts", import.meta.url).href);
          const port = await new Promise(resolve => {
            worker.onmessage = e => resolve(e.data.port);
          });
          // Kick off the bundle; the response never arrives once the worker
          // is terminated, so don't await it.
          fetch(\`http://127.0.0.1:\${port}/\`, { signal: AbortSignal.timeout(10_000) }).catch(() => {});
          await Bun.sleep(25 + i * 10);
          await worker.terminate();
          console.log("terminated", i);
        }
        console.log("survived all");
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), path.join(String(dir), "terminate-fixture.ts")],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).not.toContain("AddressSanitizer");
    expect(stdout).toContain("survived all");
    expect(exitCode).toBe(0);
  },
  240_000,
);
