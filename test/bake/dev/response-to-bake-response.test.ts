import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import path from "node:path";

test("Response -> import { Response } from 'bun:app' transform in server components", async () => {
  await using dir = tempDir("response-transform", {
    "server-component.js": `
      export const mode = "ssr";
      export const streaming = false;
      
      export default async function ServerPage({ request }) {
        // Response should be imported from 'bun:app'
        const response1 = new Response("Hello", { status: 200 });
        
        // Response.redirect should work with imported Response
        if (!request.userId) {
          return Response.redirect("/login");
        }
        
        // Response.render should work with imported Response
        if (request.page === "404") {
          return Response.render("/404");
        }
        
        // Response in string content should also be transformed
        return new Response("Hello from server", { status: 200 });
      }
    `,
    "client-component.js": `
      "use client";
      
      export default function ClientPage() {
        // Response should NOT be transformed in client components
        const response = new Response("Client", { status: 200 });
        return "Client Component";
      }
    `,
  });

  // Build with server components enabled for server-side
  const serverResult =
    await Bun.$`${bunExe()} build ${path.join(dir, "server-component.js")} --target=bun --server-components`
      .env(bunEnv)
      .text();

  // Check that Response import was added from 'bun:app'
  expect(serverResult).toContain('import { Response } from "bun:app"');
  // Each read of Response is a read of the imported binding
  expect(serverResult).toContain('new Response("Hello"');
  expect(serverResult).toContain('Response.redirect("/login")');
  expect(serverResult).toContain('Response.render("/404")');
  expect(serverResult).not.toContain("import_bun_app");

  // Build client component (should not have the transform)
  const clientResult = await Bun.$`${bunExe()} build ${path.join(dir, "client-component.js")} --target=browser`
    .env(bunEnv)
    .text();

  // Check that Response import was NOT added in client component
  expect(clientResult).not.toContain('import { Response } from "bun:app"');
  expect(clientResult).toContain("new Response");
});

test("Response import is added for global Response in various contexts", async () => {
  await using dir = tempDir("response-contexts", {
    "server.js": `
      export const mode = "ssr";
      
      export default function Page() {
        // As constructor
        const r1 = new Response();
        
        // As type check
        if (obj instanceof Response) {
          console.log("is response");
        }
        
        // As property access
        const status = Response.prototype.status;
        
        // As method call
        const json = Response.json({ data: true });
        
        // In destructuring (should not transform if it's a binding)
        const { Response: LocalResponse } = imports;
        
        return r1;
      }
    `,
  });

  const result = await Bun.$`${bunExe()} build ${path.join(dir, "server.js")} --target=bun --server-components`
    .env(bunEnv)
    .text();

  // Check that import was added
  expect(result).toContain('import { Response } from "bun:app"');
  // Each read of Response is a read of the imported binding
  expect(result).toContain("new Response");
  expect(result).toContain("instanceof Response");
  expect(result).toContain("Response.prototype.status");
  expect(result).toContain("Response.json(");
  expect(result).not.toContain("import_bun_app");
});

test("Response import is not added when Response is already imported or shadowed", async () => {
  await using dir = tempDir("response-shadowing", {
    "server.js": `
      export const mode = "ssr";
      
      // Import shadowing Response
      import { Response } from "./custom-response";
      
      export default function Page() {
        // Should use the imported Response, not transform to Bun.SSRResponse
        const r = new Response();
        return r;
      }
    `,
    "server2.js": `
      export const mode = "ssr";
      
      export default function Page() {
        // Local variable shadowing Response
        const Response = CustomResponse;
        
        // Should use the local Response, not transform
        const r = new Response();
        return r;
      }
      
      export function inner() {
        // But here it should transform since it's not shadowed
        return new Response();
      }
    `,
    "custom-response.ts": `
      export class Response {
        constructor() {
          this.custom = true;
        }
      }
    `,
  });

  const result1 = await Bun.$`${bunExe()} build ${path.join(dir, "server.js")} --target=bun --server-components`
    .env(bunEnv)
    .text();

  // When Response is already imported from another source, no bun:app import should be added
  expect(result1).not.toContain('import { Response } from "bun:app"');

  const result2 = await Bun.$`${bunExe()} build ${path.join(dir, "server2.js")} --target=bun --server-components`
    .env(bunEnv)
    .text();

  // Should preserve local variable
  expect(result2).toContain("return new CustomResponse");
  // The file should have the import added for the inner function
  expect(result2).toContain('import { Response } from "bun:app"');
});

test("Response import is NOT added in client components", async () => {
  await using dir = tempDir("client-no-transform", {
    "client-component.js": `
      "use client";
      
      // Response should NOT be transformed to Bun.SSRResponse in client components
      const response = new Response("Client data", { 
        status: 200,
        headers: { "Content-Type": "text/plain" }
      });
      
      // Response.json should remain Response.json
      const jsonResponse = Response.json({ data: "test" });
      
      // instanceof Response should remain as-is
      if (response instanceof Response) {
        console.log("Is a Response");
      }
      
      // Response.redirect should remain Response.redirect
      const redirect = Response.redirect("/new-page");
      
      export default response;
    `,
    "server-component.js": `
      export const mode = "ssr";
      
      // Response should be imported from 'bun:app' in server component
      const serverResponse = new Response("Server", { status: 200 });
      
      // Response static methods should work with imported Response
      const json = Response.json({ server: true });
      
      export default serverResponse;
    `,
  });

  // Test 1: Client component - Response should NOT be transformed
  const clientResult = await Bun.$`${bunExe()} build ${path.join(dir, "client-component.js")} --target=browser`
    .env(bunEnv as any)
    .text();

  // Verify Response import is NOT added in client components
  expect(clientResult).not.toContain('import { Response } from "bun:app"');
  expect(clientResult).toContain("new Response");
  expect(clientResult).toContain("Response.json");
  expect(clientResult).toContain("instanceof Response");
  expect(clientResult).toContain("Response.redirect");

  // Test 2: Server component - Response SHOULD be transformed
  const serverResult =
    await Bun.$`${bunExe()} build ${path.join(dir, "server-component.js")} --target=bun --server-components`
      .env(bunEnv as any)
      .text();

  // Server component should have import from bun:app
  expect(serverResult).toContain('import { Response } from "bun:app"');
  expect(serverResult).toContain('new Response("Server"');
  expect(serverResult).not.toContain("import_bun_app");
});

test("Response import is added when Response is global, but not when shadowed", async () => {
  await using dir = tempDir("response-shadowing", {
    "server-component.js": `
      export const mode = "ssr";

      export function inner() {
        const Response = 'ooga booga!';
        const foo = new Response('test', { status: 200 });
        return foo;
      }

      export const lmao = new Response()
    `,
  });

  const serverResult =
    await Bun.$`${bunExe()} build ${path.join(dir, "server-component.js")} --target=bun --server-components`
      .env(bunEnv as any)
      .text();

  // Import should be added for the global Response usage
  expect(serverResult).toContain('import { Response } from "bun:app"');
  // Local shadowed Response should not be affected
  expect(serverResult).toContain('new "ooga booga!"');
  // The global Response is a read of the imported binding
  expect(serverResult).toContain("var lmao = new Response");
  expect(serverResult).not.toContain("import_bun_app");
});

describe.concurrent("the built output runs", () => {
  // The Response of "bun:app" is not the global one. It extends it and adds `render`.
  const reads = `Response === globalThis.Response, new Response("x") instanceof globalThis.Response, typeof Response.render`;

  async function buildAndRun(files: Record<string, string>, { args = [] as string[], entries = ["./entry.js"] } = {}) {
    using dir = tempDir("response-run", files);
    await using build = Bun.spawn({
      cmd: [bunExe(), "build", "--server-components", "--target=bun", ...args, ...entries, "--outdir", "out"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "ignore",
      stderr: "pipe",
    });
    const [buildStderr, buildExitCode] = await Promise.all([build.stderr.text(), build.exited]);
    expect(buildStderr).toBe("");
    expect(buildExitCode).toBe(0);

    await using proc = Bun.spawn({
      cmd: [bunExe(), "out/entry.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const output = await Bun.file(path.join(dir, "out", "entry.js")).text();
    return { output, result: { stdout, stderr, exitCode } };
  }

  test("esm", async () => {
    const { output, result } = await buildAndRun({
      "entry.js": `
        export default function Page() {
          return new Response("x");
        }
        console.log(${reads}, Page() instanceof Response);
      `,
    });
    expect(result).toEqual({ stdout: "false true function true\n", stderr: "", exitCode: 0 });
    expect(output).toContain('import { Response } from "bun:app"');
  });

  test("Response.redirect() and Response.render()", async () => {
    const { result } = await buildAndRun({
      "entry.js": `
        const response = Response.redirect("/login", 302);
        console.log(response instanceof globalThis.Response, response.status, response.headers.get("location"));
        try {
          Response.render("/404");
        } catch (error) {
          console.log(error.message);
        }
      `,
    });
    expect(result).toEqual({
      stdout: "true 302 /login\nResponse.render() is only available in the Bun dev server\n",
      stderr: "",
      exitCode: 0,
    });
  });

  // The linker turns the read into `import_bun_app.Response` here, and declares `import_bun_app`.
  // It does that only for a read that is an import item.
  test("cjs", async () => {
    const { output, result } = await buildAndRun({ "entry.js": `console.log(${reads});` }, { args: ["--format=cjs"] });
    expect(result).toEqual({ stdout: "false true function\n", stderr: "", exitCode: 0 });
    expect(output).toContain('var import_bun_app = require("bun:app")');
  });

  test("two files that read Response, minified", async () => {
    const { result } = await buildAndRun(
      {
        "entry.js": `
          import { make } from "./other.js";
          console.log(${reads}, make() instanceof Response);
        `,
        "other.js": `
          export function make() {
            return new Response("x");
          }
        `,
      },
      { args: ["--minify"] },
    );
    expect(result).toEqual({ stdout: "false true function true\n", stderr: "", exitCode: 0 });
  });

  test("a chunk shared by two entry points", async () => {
    const { output, result } = await buildAndRun(
      {
        "entry.js": `
          import { make } from "./shared.js";
          console.log(${reads}, make() instanceof Response);
        `,
        "second.js": `
          import { make } from "./shared.js";
          console.log(make() instanceof Response);
        `,
        "shared.js": `
          export function make() {
            return new Response("x");
          }
        `,
      },
      { args: ["--splitting"], entries: ["./entry.js", "./second.js"] },
    );
    expect(result).toEqual({ stdout: "false true function true\n", stderr: "", exitCode: 0 });
    expect(output).not.toContain("function make");
  });

  test("a re-export of Response", async () => {
    const { output, result } = await buildAndRun({
      "entry.js": `
        import { Response as Named } from "./lib.js";
        import * as ns from "./lib.js";
        console.log(Named === globalThis.Response, ns.Response === Named, typeof Named.render, Object.keys(ns));
      `,
      "lib.js": `export { Response };`,
    });
    expect(result).toEqual({ stdout: 'false true function [ "Response" ]\n', stderr: "", exitCode: 0 });
    expect(output).toContain('import { Response } from "bun:app"');
  });

  test("a CommonJS file", async () => {
    const { output, result } = await buildAndRun({
      "entry.js": `
        module.exports = function Page() {
          return new Response("x");
        };
        console.log(${reads}, module.exports() instanceof Response);
      `,
    });
    expect(result).toEqual({ stdout: "false true function true\n", stderr: "", exitCode: 0 });
    expect(output).toContain("__commonJS");
  });

  // The bundler keeps this statement, but the read is not counted as a use.
  test("a read in dead code adds no import", async () => {
    const { output, result } = await buildAndRun({
      "entry.js": `
        if (false) {
          switch (new Response("x")) {
            case 1:
          }
        }
        console.log("ok");
      `,
    });
    expect(output).toContain('switch (new Response("x"))');
    expect(output).not.toContain("bun:app");
    expect(result).toEqual({ stdout: "ok\n", stderr: "", exitCode: 0 });
  });
});

// Only the dev server sets the AsyncLocalStorage instance that these calls read.
describe.concurrent('the Response of "bun:app" outside the dev server', () => {
  async function run(source: string) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", `import { Response } from "bun:app";\n${source}`],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  test("Response.redirect() returns a Response", async () => {
    const result = await run(`
      const response = Response.redirect("/login", 302);
      console.log(response instanceof globalThis.Response, response.status, response.headers.get("location"));
    `);
    expect(result).toEqual({ stdout: "true 302 /login\n", stderr: "", exitCode: 0 });
  });

  test("Response.render() throws", async () => {
    const result = await run(`
      try {
        Response.render("/404");
      } catch (error) {
        console.log(error.message);
      }
    `);
    expect(result).toEqual({
      stdout: "Response.render() is only available in the Bun dev server\n",
      stderr: "",
      exitCode: 0,
    });
  });

  test("new Response(<jsx />) returns the element as a component", async () => {
    const result = await run(`
      const element = { $$typeof: Symbol.for("react.transitional.element"), type: "div", key: null, props: {} };
      const response = new Response(element, { status: 201 });
      console.log(response.status, response.type() === element);
    `);
    expect(result).toEqual({ stdout: "201 true\n", stderr: "", exitCode: 0 });
  });
});
