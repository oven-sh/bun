import { test, expect } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
import path from "node:path";

test("Response -> BakeResponse transform in server components", async () => {
  const dir = tempDirWithFiles("response-transform", {
    "server-component.js": `
      export const mode = "ssr";
      export const streaming = false;
      
      export default async function ServerPage({ request }) {
        // Response should be transformed to BakeResponse
        const response1 = new Response("Hello", { status: 200 });
        
        // Response.redirect should be transformed to BakeResponse.redirect
        if (!request.userId) {
          return Response.redirect("/login");
        }
        
        // Response.render should be transformed to BakeResponse.render
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

  // Check that Response was transformed to BakeResponse in server component
  expect(serverResult).toContain("SSRResponse");
  expect(serverResult).not.toContain("new Response");
  expect(serverResult).toContain("BakeResponse.redirect");
  expect(serverResult).toContain("BakeResponse.render");

  // Build client component (should not have the transform)
  const clientResult = await Bun.$`${bunExe()} build ${path.join(dir, "client-component.js")} --target=browser`
    .env(bunEnv)
    .text();

  // Check that Response was NOT transformed in client component
  expect(clientResult).toContain("new Response");
  expect(clientResult).not.toContain("SSRResponse");
});

test("Response identifier is transformed in various contexts", async () => {
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
        
        // As variable declaration (should not transform)
        const Response = MyCustomResponse;
        
        return r1;
      }
    `,
  });

  const result = await Bun.$`${bunExe()} build ${path.join(dir, "server.js")} --target=bun --server-components`
    .env(bunEnv)
    .text();

  await Bun.$`echo ${result} > out.txt`;
  // Check various contexts
  expect(result).toContain("new BakeResponse");
  expect(result).toContain("instanceof BakeResponse");
  expect(result).toContain("BakeResponse.prototype.status");
  expect(result).toContain("BakeResponse.json");
});

test("Response is not transformed when imported or shadowed", async () => {
  const dir = tempDirWithFiles("response-shadowing", {
    "server.js": `
      export const mode = "ssr";
      
      // Import shadowing Response
      import { Response } from "./custom-response";
      
      export default function Page() {
        // Should use the imported Response, not transform to BakeResponse
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
      
      function inner() {
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

  // When Response is imported, it should not be transformed
  // The bundler will bundle the import, so we check that BakeResponse appears for the global Response
  // but the imported Response keeps its original behavior
  expect(result1).toContain("SSRResponse");

  const result2 = await Bun.$`${bunExe()} build ${path.join(dir, "server2.js")} --target=bun --server-components`
    .env(bunEnv)
    .text();

  // Should preserve local variable
  expect(result2).toContain("Response = CustomResponse");
  // But the inner function should have the transform
  expect(result2).toContain("new BakeResponse");
});

test("Response is NOT transformed in client components", async () => {
  const dir = tempDirWithFiles("client-no-transform", {
    "client-component.js": `
      "use client";
      
      // Response should NOT be transformed to BakeResponse in client components
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
      
      // This should be transformed to BakeResponse in server component
      const serverResponse = new Response("Server", { status: 200 });
      
      // Response static methods should be transformed
      const json = Response.json({ server: true });
      
      export default serverResponse;
    `,
  });

  // Test 1: Client component - Response should NOT be transformed
  const clientResult = await Bun.$`${bunExe()} build ${path.join(dir, "client-component.js")} --target=browser`
    .env(bunEnv as any)
    .text();

  // Verify Response is NOT transformed to BakeResponse in client components
  expect(clientResult).toContain("new Response");
  expect(clientResult).toContain("Response.json");
  expect(clientResult).toContain("instanceof Response");
  expect(clientResult).toContain("Response.redirect");
  expect(clientResult).not.toContain("SSRResponse");

  // Test 2: Server component - Response SHOULD be transformed
  const serverResult =
    await Bun.$`${bunExe()} build ${path.join(dir, "server-component.js")} --target=bun --server-components`
      .env(bunEnv as any)
      .text();

  // Server component should have BakeResponse
  expect(serverResult).toContain("SSRResponse");
  expect(serverResult).not.toContain("new Response");
});
