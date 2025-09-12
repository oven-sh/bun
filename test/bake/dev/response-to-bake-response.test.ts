import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
import path from "node:path";

test("Response -> import { Response } from 'bun:app' transform in server components", async () => {
  const dir = tempDirWithFiles("response-transform", {
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
  // The bundler output might vary, so check for the module reference
  expect(serverResult).toMatch(/from\s+["']bun:app["']/);
  // Response should still be used as Response (not transformed inline)
  expect(serverResult).toContain("new Response");
  expect(serverResult).toContain("Response.redirect");
  expect(serverResult).toContain("Response.render");

  // Build client component (should not have the transform)
  const clientResult = await Bun.$`${bunExe()} build ${path.join(dir, "client-component.js")} --target=browser`
    .env(bunEnv)
    .text();

  // Check that Response import was NOT added in client component
  expect(clientResult).not.toMatch(/from\s+["']bun:app["']/);
  expect(clientResult).toContain("new Response");
});

test("Response import is added for global Response in various contexts", async () => {
  const dir = tempDirWithFiles("response-contexts", {
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
  expect(result).toMatch(/from\s+["']bun:app["']/);
  // Response should still appear as Response in the code
  expect(result).toContain("new Response");
  expect(result).toContain("instanceof Response");
  expect(result).toContain("Response.prototype.status");
  expect(result).toContain("Response.json");
});

test("Response import is not added when Response is already imported or shadowed", async () => {
  const dir = tempDirWithFiles("response-shadowing", {
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
  expect(result1).not.toMatch(/from\s+["']bun:app["']/);

  const result2 = await Bun.$`${bunExe()} build ${path.join(dir, "server2.js")} --target=bun --server-components`
    .env(bunEnv)
    .text();

  // Should preserve local variable
  expect(result2).toContain("return new CustomResponse");
  // The file should have the import added for the inner function
  expect(result2).toMatch(/from\s+["']bun:app["']/);
});

test("Response import is NOT added in client components", async () => {
  const dir = tempDirWithFiles("client-no-transform", {
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
  expect(clientResult).not.toMatch(/from\s+["']bun:app["']/);
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
  expect(serverResult).toMatch(/from\s+["']bun:app["']/);
  expect(serverResult).toContain("new Response");
});

test("Response import is added when Response is global, but not when shadowed", async () => {
  const dir = tempDirWithFiles("response-shadowing", {
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
  expect(serverResult).toMatch(/from\s+["']bun:app["']/);
  // Local shadowed Response should not be affected
  expect(serverResult).toContain('new "ooga booga!"');
  expect(serverResult).toContain("var lmao = new Response");
});
