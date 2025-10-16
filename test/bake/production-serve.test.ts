import { Subprocess } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { tempDirWithBakeDeps } from "./bake-harness";

async function startProductionServer(
  dir: string,
  fromDist: boolean = false,
): Promise<{ url: string; proc: Subprocess }> {
  console.log("DIR", dir);
  const { promise, resolve } = Promise.withResolvers<string>();

  const cwd = fromDist ? `${dir}/dist` : dir;

  const proc = Bun.spawn({
    cmd: [bunExe(), fromDist ? "../serve.ts" : "serve.ts"],
    env: {
      ...bunEnv,
      NODE_ENV: "production",
    },
    cwd,
    stdout: "ignore",
    stderr: "pipe",
    ipc(message) {
      resolve(message);
    },
  });

  // Log stderr for debugging
  (async () => {
    const reader = proc.stderr.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      if (text.trim() && text.includes("error")) {
        console.error("Server stderr:", text);
      }
    }
  })();

  const url = await promise;
  return { url, proc };
}

describe("production serve", () => {
  test("should work with SSG routes", async () => {
    const dir = await tempDirWithBakeDeps("production-serve-ssg", {
      "index.ts": 'export default { app: "react" }',
      "pages/index.tsx": `export default function IndexPage() {
        return <div>Hello World</div>;
      }`,
      "serve.ts": `
        import app from './index.ts';

        const server = Bun.serve({
          ...app,
          port: 0,
        });

        process.send(\`\${server.url}\`);
      `,
    });

    // Build the app
    const { exitCode } = await Bun.$`${bunExe()} build --app ./index.ts`.cwd(dir).throws(false);
    expect(exitCode).toBe(0);

    // Start the production server
    const { url, proc } = await startProductionServer(dir);
    await using _ = proc;

    // Fetch the index page
    const response = await fetch(url);
    expect(response.ok).toBe(true);
    expect(response.status).toBe(200);

    const html = await response.text();
    expect(html).toContain("Hello World");
    expect(html).toContain("<div");
  });

  test("should work with SSR routes with params", async () => {
    const dir = await tempDirWithBakeDeps("production-serve-ssr-params", {
      "index.ts": 'export default { app: "react" }',
      "pages/user/[id].tsx": `
        export const mode = 'ssr';

        export default async function UserPage({ params }) {
          const userId = params.id;

          return (
            <div>
              <h1>User Profile</h1>
              <p>User ID: {userId}</p>
            </div>
          );
        }
      `,
      "serve.ts": `
        import app from './index.ts';

        const server = Bun.serve({
          ...app,
          port: 0,
        });

        process.send(\`\${server.url}\`);
      `,
    });

    // Build the app
    const { exitCode } = await Bun.$`${bunExe()} build --app ./index.ts`.cwd(dir).throws(false);
    expect(exitCode).toBe(0);

    // Start the production server
    const { url, proc } = await startProductionServer(dir);
    await using _ = proc;

    // Test with different user IDs
    const response1 = await fetch(`${url}/user/123`);
    expect(response1.ok).toBe(true);
    expect(response1.status).toBe(200);

    const html1 = await response1.text();
    expect(html1).toContain("User Profile");
    expect(html1).toContain("User ID: <!-- -->123");

    // Test with another user ID
    const response2 = await fetch(`${url}/user/jane-doe`);
    expect(response2.ok).toBe(true);
    expect(response2.status).toBe(200);

    const html2 = await response2.text();
    expect(html2).toContain("User Profile");
    expect(html2).toContain("User ID: <!-- -->jane-doe");
  });

  test("should work with SSG routes with params", async () => {
    const dir = await tempDirWithBakeDeps("production-serve-ssg-params", {
      "index.ts": 'export default { app: "react" }',
      "pages/blog/[slug].tsx": `
        export default function BlogPost({ params }) {
          const slug = params.slug;

          return (
            <article>
              <h1>Blog Post</h1>
              <p>Slug: {slug}</p>
            </article>
          );
        }

        export async function getStaticPaths() {
          return {
            paths: [
              { params: { slug: 'lmao' } },
              { params: { slug: 'lolfucku' } },
            ],
            fallback: false,
          };
        }
      `,
      "serve.ts": `
        import app from './index.ts';

        const server = Bun.serve({
          ...app,
          port: 0,
        });

        process.send(\`\${server.url}\`);
      `,
    });

    // Build the app
    const { exitCode } = await Bun.$`${bunExe()} build --app ./index.ts`.cwd(dir).throws(false);
    expect(exitCode).toBe(0);

    // Start the production server
    const { url, proc } = await startProductionServer(dir);
    await using _ = proc;

    // Test the first static path
    const response1 = await fetch(`${url}/blog/lmao`);
    expect(response1.ok).toBe(true);
    expect(response1.status).toBe(200);

    const html1 = await response1.text();
    expect(html1).toContain("Blog Post");
    expect(html1).toContain("Slug: <!-- -->lmao");

    // Test the second static path
    const response2 = await fetch(`${url}/blog/lolfucku`);
    expect(response2.ok).toBe(true);
    expect(response2.status).toBe(200);

    const html2 = await response2.text();
    expect(html2).toContain("Blog Post");
    expect(html2).toContain("Slug: <!-- -->lolfucku");

    // Test a path that wasn't pre-rendered (should 404)
    const response3 = await fetch(`${url}/blog/not-found`);
    expect(response3.ok).toBe(false);
    expect(response3.status).toBe(404);
  });

  test("should work with SSR routes with catch-all params", async () => {
    const dir = await tempDirWithBakeDeps("production-serve-ssr-catch-all", {
      "index.ts": 'export default { app: "react" }',
      "pages/shop/[...item].tsx": `
        export const mode = 'ssr';

        export default async function ShopItem({ params }) {
          const itemPath = typeof params.item === 'string' ? [params.item] : params.item || [];

          return (
            <div>
              <h1>Shop</h1>
              <p>Path segments: {itemPath.length}</p>
              <p>Full path: {itemPath.join('/')}</p>
              {itemPath.map((segment, i) => (
                <div key={i}>Segment {i}: {segment}</div>
              ))}
            </div>
          );
        }
      `,
      "serve.ts": `
        import app from './index.ts';

        const server = Bun.serve({
          ...app,
          port: 0,
        });

        process.send(\`\${server.url}\`);
      `,
    });

    // Build the app
    const { exitCode } = await Bun.$`${bunExe()} build --app ./index.ts`.cwd(dir).throws(false);
    expect(exitCode).toBe(0);

    // Start the production server
    const { url, proc } = await startProductionServer(dir);
    await using _ = proc;

    // Test with single segment
    const response1 = await fetch(`${url}/shop/electronics`);
    expect(response1.ok).toBe(true);
    expect(response1.status).toBe(200);

    const html1 = await response1.text();
    expect(html1).toContain("Shop");
    expect(html1).toContain("Path segments: <!-- -->1");
    expect(html1).toContain("Full path: <!-- -->electronics");
    expect(html1).toContain("Segment <!-- -->0<!-- -->: <!-- -->electronics");

    // Test with multiple segments
    const response2 = await fetch(`${url}/shop/electronics/phones/iphone`);
    expect(response2.ok).toBe(true);
    expect(response2.status).toBe(200);

    const html2 = await response2.text();
    expect(html2).toContain("Shop");
    expect(html2).toContain("Path segments: <!-- -->3");
    expect(html2).toContain("Full path: <!-- -->electronics/phones/iphone");
    expect(html2).toContain("Segment <!-- -->0<!-- -->: <!-- -->electronics");
    expect(html2).toContain("Segment <!-- -->1<!-- -->: <!-- -->phones");
    expect(html2).toContain("Segment <!-- -->2<!-- -->: <!-- -->iphone");

    // Note: /shop (without trailing slash or segments) won't match [...item].tsx
    // because [...item] requires at least one segment after /shop/
    // For routes that don't match, they would get a 404, not null params
  });

  test("should work with SSG routes with catch-all params", async () => {
    const dir = await tempDirWithBakeDeps("production-serve-ssg-catch-all", {
      "index.ts": 'export default { app: "react" }',
      "pages/articles/[...path].tsx": `
        export default function Article({ params }) {
          const pathSegments = params.path || [];

          return (
            <article>
              <h1>Article</h1>
              <p>Path segments: {pathSegments.length}</p>
              <p>Full path: {pathSegments.join('/')}</p>
              {pathSegments.map((segment, i) => (
                <div key={i}>Part {i}: {segment}</div>
              ))}
            </article>
          );
        }

        export async function getStaticPaths() {
          return {
            paths: [
              { params: { path: ['2024', 'tech', 'ai-revolution'] } },
              { params: { path: ['2024', 'guides', 'getting-started'] } },
              { params: { path: ['archive', '2023'] } },
            ],
            fallback: false,
          };
        }
      `,
      "serve.ts": `
        import app from './index.ts';

        const server = Bun.serve({
          ...app,
          port: 0,
        });

        process.send(\`\${server.url}\`);
      `,
    });

    // Build the app
    const { exitCode } = await Bun.$`${bunExe()} build --app ./index.ts`.cwd(dir).throws(false);
    expect(exitCode).toBe(0);

    // Start the production server
    const { url, proc } = await startProductionServer(dir);
    await using _ = proc;

    // Test the first static path with 3 segments
    const response1 = await fetch(`${url}/articles/2024/tech/ai-revolution`);
    expect(response1.ok).toBe(true);
    expect(response1.status).toBe(200);

    const html1 = await response1.text();
    expect(html1).toContain("Article");
    expect(html1).toContain("Path segments: <!-- -->3");
    expect(html1).toContain("Full path: <!-- -->2024/tech/ai-revolution");
    expect(html1).toContain("Part <!-- -->0<!-- -->: <!-- -->2024");
    expect(html1).toContain("Part <!-- -->1<!-- -->: <!-- -->tech");
    expect(html1).toContain("Part <!-- -->2<!-- -->: <!-- -->ai-revolution");

    // Test the second static path
    const response2 = await fetch(`${url}/articles/2024/guides/getting-started`);
    expect(response2.ok).toBe(true);
    expect(response2.status).toBe(200);

    const html2 = await response2.text();
    expect(html2).toContain("Article");
    expect(html2).toContain("Path segments: <!-- -->3");
    expect(html2).toContain("Full path: <!-- -->2024/guides/getting-started");

    // Test the third static path with 2 segments
    const response3 = await fetch(`${url}/articles/archive/2023`);
    expect(response3.ok).toBe(true);
    expect(response3.status).toBe(200);

    const html3 = await response3.text();
    expect(html3).toContain("Article");
    expect(html3).toContain("Path segments: <!-- -->2");
    expect(html3).toContain("Full path: <!-- -->archive/2023");
    expect(html3).toContain("Part <!-- -->0<!-- -->: <!-- -->archive");
    expect(html3).toContain("Part <!-- -->1<!-- -->: <!-- -->2023");

    // Test a path that wasn't pre-rendered (should 404)
    const response4 = await fetch(`${url}/articles/not/found/path`);
    expect(response4.ok).toBe(false);
    expect(response4.status).toBe(404);
  });

  test.skip("should work with SSR routes with optional catch-all params", async () => {
    // SKIP: Optional catch-all routes [[...slug]] are not yet supported, even for SSR.
    // Error: "catch-all optional routes are not supported in static site generation"
    const dir = await tempDirWithBakeDeps("production-serve-ssr-optional-catch-all", {
      "index.ts": 'export default { app: "react" }',
      "pages/docs/[[...slug]].tsx": `
        export const mode = 'ssr';

        export default async function Docs({ params }) {
          const slugPath = params.slug || [];

          return (
            <div>
              <h1>Documentation</h1>
              {slugPath.length === 0 ? (
                <p>Welcome to the docs home page!</p>
              ) : (
                <>
                  <p>Path segments: {slugPath.length}</p>
                  <p>Full path: {slugPath.join('/')}</p>
                  {slugPath.map((segment, i) => (
                    <div key={i}>Section {i}: {segment}</div>
                  ))}
                </>
              )}
            </div>
          );
        }
      `,
      "serve.ts": `
        import app from './index.ts';

        const server = Bun.serve({
          ...app,
          port: 0,
        });

        process.send(\`\${server.url}\`);
      `,
    });

    // Build the app
    const { exitCode } = await Bun.$`${bunExe()} build --app ./index.ts`.cwd(dir).throws(false);
    expect(exitCode).toBe(0);

    // Start the production server
    const { url, proc } = await startProductionServer(dir);
    await using _ = proc;

    // Test with no segments (just /docs) - params.slug should be empty array
    const response1 = await fetch(`${url}/docs`);
    expect(response1.ok).toBe(true);
    expect(response1.status).toBe(200);

    const html1 = await response1.text();
    expect(html1).toContain("Documentation");
    expect(html1).toContain("Welcome to the docs home page!");

    // Test with single segment
    const response2 = await fetch(`${url}/docs/api`);
    expect(response2.ok).toBe(true);
    expect(response2.status).toBe(200);

    const html2 = await response2.text();
    expect(html2).toContain("Documentation");
    expect(html2).toContain("Path segments: <!-- -->1");
    expect(html2).toContain("Full path: <!-- -->api");
    expect(html2).toContain("Section <!-- -->0<!-- -->: <!-- -->api");

    // Test with multiple segments
    const response3 = await fetch(`${url}/docs/api/v2/users`);
    expect(response3.ok).toBe(true);
    expect(response3.status).toBe(200);

    const html3 = await response3.text();
    expect(html3).toContain("Documentation");
    expect(html3).toContain("Path segments: <!-- -->3");
    expect(html3).toContain("Full path: <!-- -->api/v2/users");
    expect(html3).toContain("Section <!-- -->0<!-- -->: <!-- -->api");
    expect(html3).toContain("Section <!-- -->1<!-- -->: <!-- -->v2");
    expect(html3).toContain("Section <!-- -->2<!-- -->: <!-- -->users");
  });

  test("should work with SSR routes", async () => {
    const dir = await tempDirWithBakeDeps("production-serve-ssr", {
      "index.ts": 'export default { app: "react" }',
      "pages/ssr-test.tsx": `
        export const mode = 'ssr';

        export default async function SSRRoute({ request }) {
          const userId = request.cookies.get("x-user-id");

          return <h1>Hello, {userId ?? "uh oh!"}</h1>;
        }
      `,
      "serve.ts": `
        import app from './index.ts';

        const server = Bun.serve({
          ...app,
          port: 0,
        });

        process.send(\`\${server.url}\`);
      `,
    });

    // Build the app
    const { exitCode } = await Bun.$`${bunExe()} build --app ./index.ts`.cwd(dir).throws(false);
    expect(exitCode).toBe(0);

    // Start the production server
    const { url, proc } = await startProductionServer(dir);
    await using _ = proc;

    // Test without cookie - should get "uh oh!"
    const response1 = await fetch(`${url}/ssr-test`);
    expect(response1.ok).toBe(true);
    expect(response1.status).toBe(200);

    const html1 = await response1.text();
    // Note that <!-- --> is placed by RSC
    expect(html1).toContain("Hello, <!-- -->uh oh!");

    // Test with cookie - should get the user ID
    const response2 = await fetch(`${url}/ssr-test`, {
      headers: {
        Cookie: "x-user-id=john123",
      },
    });
    expect(response2.ok).toBe(true);
    expect(response2.status).toBe(200);

    const html2 = await response2.text();
    expect(html2).toContain("Hello, <!-- -->john123");
  });

  test("should work with SSR route using Response.render() for SSG route", async () => {
    const dir = await tempDirWithBakeDeps("production-serve-ssr-render-ssg", {
      "index.ts": 'export default { app: "react" }',
      "pages/static-content.tsx": `
        export default function StaticContent() {
          return (
            <div>
              <h1>Static Page</h1>
              <p>This is pre-rendered content</p>
            </div>
          );
        }
      `,
      "pages/dynamic-renderer.tsx": `
        export const mode = 'ssr';

        export default async function DynamicRenderer({ request }) {
          // This SSR route renders a pre-built SSG route
          return Response.render("/static-content");
        }
      `,
      "serve.ts": `
        import app from './index.ts';

        const server = Bun.serve({
          ...app,
          port: 0,
        });

        process.send(\`\${server.url}\`);
      `,
    });

    // Build the app
    const { exitCode } = await Bun.$`${bunExe()} build --app ./index.ts`.cwd(dir).throws(false);
    expect(exitCode).toBe(0);

    // Start the production server
    const { url, proc } = await startProductionServer(dir);
    await using _ = proc;

    // Access the SSR route that renders the SSG route
    const response = await fetch(`${url}/dynamic-renderer`);
    expect(response.ok).toBe(true);
    expect(response.status).toBe(200);

    const html = await response.text();
    expect(html).toContain("Static Page");
    expect(html).toContain("This is pre-rendered content");

    // Also verify the static route works directly
    const staticResponse = await fetch(`${url}/static-content`);
    expect(staticResponse.ok).toBe(true);
    expect(staticResponse.status).toBe(200);

    const staticHtml = await staticResponse.text();
    expect(staticHtml).toContain("Static Page");
    expect(staticHtml).toContain("This is pre-rendered content");
  });
});
