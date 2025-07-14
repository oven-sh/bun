import { test, expect } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";

test("CSS modules work in dev server", async () => {
  // Increase timeout
  await Bun.sleep(0);
  const timeoutController = new AbortController();
  const timeout = setTimeout(() => timeoutController.abort(), 30000);
  const dir = tempDirWithFiles("css-modules-dev", {
    "package.json": JSON.stringify({
      name: "css-modules-test",
      scripts: {
        dev: "bun dev"
      }
    }),
    "src/App.tsx": `
      import classes from "./styles.module.css";
      
      export function App() {
        return (
          <div className={classes.container}>
            <h1 className={classes.title}>Hello CSS Modules</h1>
          </div>
        );
      }
    `,
    "src/styles.module.css": `
      .container {
        background: red;
      }
      
      .title {
        color: blue;
      }
    `,
    "src/index.tsx": `
      import { serve } from "bun";
      
      const server = serve({
        port: 0, // Random port
        async fetch(req) {
          const url = new URL(req.url);
          if (url.pathname === "/test") {
            // Import and render the component
            const { App } = await import("./App.tsx");
            return new Response(
              JSON.stringify({
                component: App.toString(),
                hasClasses: typeof App === 'function'
              }),
              { headers: { "Content-Type": "application/json" } }
            );
          }
          return new Response("Not found", { status: 404 });
        }
      });
      
      console.log("PORT:" + server.port);
    `,
    "bunfig.toml": `
      [dev]
      framework = "react"
    `
  });

  const proc = Bun.spawn({
    cmd: [bunExe(), "dev"],
    env: bunEnv,
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe"
  });

  let port = 0;
  let stdout = "";
  let stderr = "";

  // Wait for server to start and get port
  const reader = proc.stdout!.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    
    const text = new TextDecoder().decode(value);
    stdout += text;
    
    const portMatch = text.match(/PORT:(\d+)/);
    if (portMatch) {
      port = parseInt(portMatch[1]);
      break;
    }
  }

  // Also capture stderr
  (async () => {
    const reader = proc.stderr!.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      stderr += new TextDecoder().decode(value);
    }
  })();

  expect(port).toBeGreaterThan(0);

  try {
    // Test that CSS modules don't throw errors
    const response = await fetch(`http://localhost:${port}/test`);
    const data = await response.json();
    
    expect(response.status).toBe(200);
    expect(data.hasClasses).toBe(true);
    
    // The component should render without errors
    expect(data.component).toContain("function App()");
    
    // Check stderr for CSS module errors
    expect(stderr).not.toContain("import_styles_module is not defined");
    expect(stderr).not.toContain("ReferenceError");
  } finally {
    proc.kill();
    await proc.exited;
  }
});