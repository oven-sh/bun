import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, rmSync, symlinkSync } from "fs";
import { bunEnv, bunExe, isASAN, isWindows, normalizeBunSnapshot, tempDir } from "harness";
import path from "path";
import { tempDirWithBakeDeps, WAIT_MULTIPLIER } from "../bake-harness";

const normalizePath = (path: string) => (process.platform === "win32" ? path.replaceAll("\\", "/") : path);
const platformPath = (path: string) => (process.platform === "win32" ? path.replaceAll("/", "\\") : path);

/**
 * Production build tests
 */
describe("production", () => {
  test("works with sourcemaps - error thrown in React component", async () => {
    const dir = await tempDirWithBakeDeps("bake-production-sourcemap", {
      "src/index.tsx": `export default { app: { framework: "react" } };`,
      "pages/index.tsx": `export default function IndexPage() {
  throw new Error("oh no!");
  return <div>Hello World</div>;
}`,
      "package.json": JSON.stringify({
        "name": "test-app",
        "version": "1.0.0",
        "devDependencies": {
          "react": "^18.0.0",
          "react-dom": "^18.0.0",
        },
      }),
    });

    // Run the build command
    const {
      exitCode: buildExitCode,
      stdout: buildStdout,
      stderr: buildStderr,
    } = await Bun.$`${bunExe()} build --app ./src/index.tsx`.cwd(dir).throws(false);

    // The build should fail due to the runtime error during SSG
    expect(buildExitCode).toBe(1);

    // Check that the error message shows the proper source location
    expect(buildStderr.toString()).toContain("throw new Error");
    expect(buildStderr.toString()).toContain("oh no!");
  });

  test("import.meta properties are inlined in production build", async () => {
    const dir = await tempDirWithBakeDeps("bake-production-import-meta", {
      "src/index.tsx": `export default { 
        app: { 
          framework: "react",
        } 
      };`,
      "pages/index.tsx": `
export default function IndexPage() {
  const metaInfo = {
    dir: import.meta.dir,
    dirname: import.meta.dirname,
    file: import.meta.file,
    path: import.meta.path,
    url: import.meta.url,
  };
  
  return (
    <div>
      <h1>Import Meta Test</h1>
      <pre>{JSON.stringify(metaInfo, null, 2)}</pre>
      <div id="meta-data" style={{display: 'none'}}>{JSON.stringify(metaInfo)}</div>
    </div>
  );
}
`,
      "pages/api/test.tsx": `
export default function TestPage() {
  const values = [
    "dir=" + import.meta.dir,
    "dirname=" + import.meta.dirname,
    "file=" + import.meta.file,
    "path=" + import.meta.path,
    "url=" + import.meta.url,
  ];
  
  return (
    <div>
      <h1>API Test</h1>
      <pre>{values.join("\\n")}</pre>
      <div id="api-meta-data" style={{display: 'none'}}>{values.join("|")}</div>
    </div>
  );
}
`,
    });

    // Run the build command
    const buildProc = await Bun.$`${bunExe()} build --app ./src/index.tsx --outdir ./dist`
      .cwd(dir)
      .env(bunEnv)
      .throws(false);

    expect(buildProc.exitCode).toBe(0);

    // Check that the build output contains the generated files
    const distFiles = await Bun.$`ls -la dist/`.cwd(dir).text();
    expect(distFiles).toContain("index.html");
    expect(distFiles).toContain("_bun");

    // In production SSG, the import.meta values are inlined during build time
    // and rendered into the static HTML. The values should appear in the HTML output.

    // Check the generated static HTML files
    const indexHtml = await Bun.file(path.join(dir, "dist", "index.html")).text();
    const apiTestHtml = await Bun.file(path.join(dir, "dist", "api", "test", "index.html")).text();

    // The HTML output should contain the rendered import.meta values
    // Check for the presence of the expected values in the HTML

    // For the index page, check that it contains the expected file paths
    expect(indexHtml).toContain("index.tsx");
    expect(indexHtml).toContain("pages");

    // Check if the HTML contains evidence of import.meta values being used
    // The exact format might be HTML-escaped, so we check for key patterns
    const hasIndexPath =
      indexHtml.includes("pages/index.tsx") ||
      indexHtml.includes("pages&#x2F;index.tsx") ||
      indexHtml.includes("pages\\index.tsx");
    expect(hasIndexPath).toBe(true);

    // For the API test page
    expect(apiTestHtml).toContain("test.tsx");
    expect(apiTestHtml).toContain("pages");

    const hasApiPath =
      apiTestHtml.includes("pages/api/test.tsx") ||
      apiTestHtml.includes("pages&#x2F;api&#x2F;test.tsx") ||
      apiTestHtml.includes("pages\\api\\test.tsx");
    expect(hasApiPath).toBe(true);
  });

  test("import.meta properties are inlined in catch-all routes during production build", async () => {
    const dir = await tempDirWithBakeDeps("bake-production-catch-all", {
      "src/index.tsx": `export default { 
        app: { 
          framework: "react",
        } 
      };`,
      "pages/blog/[...slug].tsx": `
export default function BlogPost({ params }) {
  const slug = params.slug || [];
  
  const metaInfo = {
    file: import.meta.file,
    dir: import.meta.dir,
    path: import.meta.path,
    url: import.meta.url,
    dirname: import.meta.dirname,
  };
  
  return (
    <article>
      <h1>Blog Post: {slug.join(' / ')}</h1>
      <p>You are reading: {slug.length === 0 ? 'the blog index' : slug.join('/')}</p>
      <div id="blog-meta" data-file={metaInfo.file} data-dir={metaInfo.dir} data-path={metaInfo.path}>
        <pre>{JSON.stringify(metaInfo, null, 2)}</pre>
      </div>
    </article>
  );
}

export async function getStaticPaths() {
  return {
    paths: [
      { params: { slug: ['2024', 'hello-world'] } },
      { params: { slug: ['2024', 'tech', 'bun-framework'] } },
      { params: { slug: ['tutorials', 'getting-started'] } },
    ],
    fallback: false,
  };
}
`,
      "pages/docs/[...path].tsx": `
export default function DocsPage({ params }) {
  const path = params.path || [];
  
  return (
    <div>
      <h1>Documentation</h1>
      <nav aria-label="Breadcrumb">
        <ol>
          <li>Docs</li>
          {path.map((segment, i) => (
            <li key={i}>{segment}</li>
          ))}
        </ol>
      </nav>
      <div id="docs-content">
        <p>Reading docs at: /{path.join('/')}</p>
        <div id="docs-meta" style={{display: 'none'}}>
          <span data-file={import.meta.file}></span>
          <span data-dir={import.meta.dir}></span>
          <span data-path={import.meta.path}></span>
          <span data-url={import.meta.url}></span>
        </div>
      </div>
    </div>
  );
}

export async function getStaticPaths() {
  return {
    paths: [
      { params: { path: ['api', 'reference'] } },
      { params: { path: ['guides', 'advanced', 'optimization'] } },
      { params: { path: [] } }, // docs index
    ],
    fallback: false,
  };
}
`,
      "pages/docs/getting-started.tsx": `
export default function GettingStarted() {
  return (
    <div>
      <h1>Getting Started</h1>
      <p>This is a static page, not a catch-all route.</p>
      <div id="static-meta" style={{display: 'none'}}>
        <span data-file={import.meta.file}></span>
        <span data-path={import.meta.path}></span>
      </div>
    </div>
  );
}
`,
    });

    console.error("DIR", dir);

    // Run the build command
    const buildProc = await Bun.$`${bunExe()} build --app ./src/index.tsx --outdir ./dist`
      .cwd(dir)
      .env(bunEnv)
      .throws(false);

    expect(buildProc.exitCode).toBe(0);

    // Check that the build output contains the generated files
    const htmlFiles = Array.from(new Bun.Glob("dist/**/*.html").scanSync(dir))
      .sort()
      .map(p => normalizePath(p));

    // Should have generated all the static paths
    // Note: React's routing may flatten the paths
    expect(htmlFiles).toContain("dist/blog/2024/hello-world/index.html");
    expect(htmlFiles).toContain("dist/blog/2024/tech/bun-framework/index.html");
    expect(htmlFiles).toContain("dist/blog/tutorials/getting-started/index.html");
    expect(htmlFiles).toContain("dist/docs/api/reference/index.html");
    expect(htmlFiles).toContain("dist/docs/guides/advanced/optimization/index.html");
    expect(htmlFiles).toContain("dist/docs/index.html");
    expect(htmlFiles).toContain("dist/docs/getting-started/index.html");

    // Check blog post with multiple segments
    const blogPostHtml = await Bun.file(
      path.join(dir, "dist", "blog", "2024", "tech", "bun-framework", "index.html"),
    ).text();

    // Verify the content is rendered (may include HTML comments)
    expect(blogPostHtml).toContain("Blog Post:");
    expect(blogPostHtml).toContain("2024 / tech / bun-framework");
    expect(blogPostHtml).toContain("You are reading:");
    expect(blogPostHtml).toContain("2024/tech/bun-framework");

    // Check that import.meta values are inlined in the HTML
    expect(blogPostHtml).toContain('data-file="[...slug].tsx"');
    expect(blogPostHtml).toContain("data-dir=");
    expect(blogPostHtml).toContain(platformPath('/pages/blog"')); // The full path will include the temp directory
    expect(blogPostHtml).toContain("data-path=");
    expect(blogPostHtml).toContain(platformPath('/pages/blog/[...slug].tsx"'));

    // Check docs catch-all route
    const docsHtml = await Bun.file(
      path.join(dir, "dist", "docs", "guides", "advanced", "optimization", "index.html"),
    ).text();

    expect(docsHtml).toContain("Reading docs at:");
    expect(docsHtml).toContain("guides/advanced/optimization");
    expect(docsHtml).toContain('data-file="[...path].tsx"');
    expect(docsHtml).toContain(platformPath('/pages/docs/[...path].tsx"'));

    // Check that the static getting-started page uses its own file name, not the catch-all
    const staticHtml = await Bun.file(path.join(dir, "dist", "docs", "getting-started", "index.html")).text();

    expect(staticHtml).toContain("Getting Started");
    expect(staticHtml).toContain("This is a static page");
    expect(staticHtml).toContain('data-file="getting-started.tsx"');
    expect(staticHtml).toContain(platformPath('/pages/docs/getting-started.tsx"'));
    expect(staticHtml).not.toContain("[...path].tsx");

    // Verify that import.meta values are consistent across all catch-all instances
    const blogIndex = await Bun.file(
      path.join(dir, "dist", "blog", "tutorials", "getting-started", "index.html"),
    ).text();
    expect(blogIndex).toContain('data-file="[...slug].tsx"');
    expect(blogIndex).toContain(platformPath('/pages/blog/[...slug].tsx"'));
  });

  test("params are collected from the page's parent routes too", async () => {
    const dir = await tempDirWithBakeDeps("bake-production-nested-params", {
      "src/index.tsx": `export default { app: { framework: "react" } };`,
      "pages/[category]/[id].tsx": `
export default function Item({ params }) {
  return <p>{params.category + "/" + params.id}</p>;
}

export async function getStaticPaths() {
  return {
    paths: [
      { params: { category: "tech", id: "bun" } },
      { params: { category: "news", id: "release" } },
    ],
  };
}
`,
    });

    const { exitCode, stderr } = await Bun.$`${bunExe()} build --app ./src/index.tsx --outdir ./dist`
      .cwd(dir)
      .env(bunEnv)
      .throws(false);
    expect(stderr.toString()).not.toContain("error:");
    expect(exitCode).toBe(0);

    const htmlFiles = Array.from(new Bun.Glob("dist/**/*.html").scanSync(dir))
      .sort()
      .map(p => normalizePath(p));
    expect(htmlFiles).toEqual(["dist/news/release/index.html", "dist/tech/bun/index.html"]);
    expect(await Bun.file(path.join(dir, "dist", "tech", "bun", "index.html")).text()).toContain("tech/bun");
  });

  test("optional catch-all routes are rejected", async () => {
    const dir = await tempDirWithBakeDeps("bake-production-optional-catch-all", {
      "src/index.tsx": `export default { app: { framework: "react" } };`,
      "pages/docs/[[...slug]].tsx": `
export default function Docs() {
  return <p>docs</p>;
}
`,
    });

    const { exitCode, stderr } = await Bun.$`${bunExe()} build --app ./src/index.tsx --outdir ./dist`
      .cwd(dir)
      .env(bunEnv)
      .throws(false);
    expect(stderr.toString()).toContain("catch-all routes are not supported in static site generation");
    expect(exitCode).toBe(1);
  });

  test("two pages resolving to the same route are reported", async () => {
    const dir = await tempDirWithBakeDeps("bake-production-route-collision", {
      "src/index.tsx": `export default { app: { framework: "react" } };`,
      "pages/about.tsx": `export default function About() { return <p>about</p>; }`,
      "pages/about/index.tsx": `export default function About() { return <p>about</p>; }`,
    });

    const { stderr } = await Bun.$`${bunExe()} build --app ./src/index.tsx --outdir ./dist`
      .cwd(dir)
      .env(bunEnv)
      .throws(false);
    expect(stderr.toString()).toContain("Multiple pages matching the same route pattern is ambiguous");
  });

  // The bundler's diagnostics are the whole report for a build it rejects; it then exits 1 through the build VM.
  describe.concurrent("a build the bundler rejects", () => {
    const config = `
      process.on("exit", code => console.log("exit event: " + code));
      export default { app: { framework: "react" } };
    `;

    async function build(dir: string) {
      const { exitCode, stdout, stderr } = await Bun.$`${bunExe()} build --app ./src/index.tsx`
        .cwd(dir)
        .env(bunEnv)
        .quiet()
        .throws(false);
      // Everything printed after the bundler started.
      const report = stderr.toString().split("Bundling routes\n").at(-1)!;
      return { exitCode, stdout: stdout.toString(), report: normalizeBunSnapshot(report, dir) };
    }

    const timeout = 30_000 * WAIT_MULTIPLIER;

    test(
      "a page that does not parse",
      async () => {
        const dir = await tempDirWithBakeDeps("bake-production-parse-error", {
          "src/index.tsx": config,
          "pages/index.tsx": `export default function IndexPage() { return <p>index</p>; `,
        });

        const { exitCode, stdout, report } = await build(dir);
        expect(report).toMatchInlineSnapshot(`
          "1 | export default function IndexPage() { return <p>index</p>;
                                                                        ^
          error: Unexpected end of file
              at <dir>/pages/index.tsx:1:59"
        `);
        expect(stdout).toBe("exit event: 1\n");
        expect(exitCode).toBe(1);
      },
      timeout,
    );

    test(
      "a page with an import that does not resolve",
      async () => {
        const dir = await tempDirWithBakeDeps("bake-production-resolve-error", {
          "src/index.tsx": config,
          "pages/index.tsx": `import { title } from "../lib/title";
export default function IndexPage() { return <p>{title}</p>; }
`,
        });

        const { exitCode, stdout, report } = await build(dir);
        expect(report).toMatchInlineSnapshot(`
          "1 | import { title } from "../lib/title";
                                    ^
          error: Could not resolve: "../lib/title"
              at <dir>/pages/index.tsx:1:23"
        `);
        expect(stdout).toBe("exit event: 1\n");
        expect(exitCode).toBe(1);
      },
      timeout,
    );
  });

  test("handles build with no pages directory without crashing", async () => {
    const dir = await tempDirWithBakeDeps("bake-production-no-pages", {
      "app.ts": `export default { app: { framework: "react" } };`,
      "package.json": JSON.stringify({
        "name": "test-app",
        "version": "1.0.0",
        "devDependencies": {
          "react": "^18.0.0",
          "react-dom": "^18.0.0",
        },
      }),
    });

    // Run the build command - should not crash even with no pages
    const { exitCode, stderr } = await Bun.$`${bunExe()} build --app ./app.ts`.cwd(dir).throws(false);

    // The build should complete successfully (or fail gracefully, not crash)
    // We're testing that it doesn't crash with the StringBuilder assertion
    expect(exitCode).toBeDefined();

    // If it fails, it should be a graceful failure, not a crash
    if (exitCode !== 0) {
      expect(stderr.toString()).not.toContain("reached unreachable code");
      expect(stderr.toString()).not.toContain("assert(this.cap > 0)");
    }
  });

  // A reported failure exits through the build VM (the config's 'exit' handler runs) or, before the VM exists, exits 1 without an internal-error line.
  describe.concurrent("failures reported by the build", () => {
    const config = `
      process.on("exit", code => console.log("exit event: " + code));
      export default { app: { framework: "react" } };
    `;
    const app = {
      "src/index.tsx": config,
      "pages/index.tsx": `export default function IndexPage() { return <p>index</p>; }`,
    };

    async function build(dir: string, ...entryPoints: string[]) {
      const { exitCode, stdout, stderr } = await Bun.$`${bunExe()} build --app ${entryPoints}`
        .cwd(dir)
        .env({ ...bunEnv, BUN_DESTRUCT_VM_ON_EXIT: "1" })
        .quiet()
        .throws(false);
      return { exitCode, stdout: stdout.toString(), stderr: stderr.toString() };
    }

    // The dist cases bundle a react app; this is the budget bake-harness gives its production builds.
    const timeout = 30_000 * WAIT_MULTIPLIER;

    test(
      "a file at dist",
      async () => {
        const dir = await tempDirWithBakeDeps("bake-production-dist-is-a-file", {
          ...app,
          "dist": "a file in the way of the output directory",
        });

        const { exitCode, stdout, stderr } = await build(dir, "./src/index.tsx");
        expect(stderr).toContain(
          `ENOTDIR: Not a directory: could not open output directory "${path.join(dir, "dist")}"`,
        );
        expect(stderr).not.toContain("An internal error occurred");
        expect(stdout).toBe("exit event: 1\n");
        expect(exitCode).toBe(1);
      },
      timeout,
    );

    test.skipIf(isWindows)(
      "a dangling symlink at dist",
      async () => {
        const dir = await tempDirWithBakeDeps("bake-production-dist-is-a-dangling-symlink", app);
        symlinkSync("does-not-exist", path.join(dir, "dist"));

        const { exitCode, stdout, stderr } = await build(dir, "./src/index.tsx");
        expect(stderr).toContain(
          `ENOENT: No such file or directory: could not open output directory "${path.join(dir, "dist")}"`,
        );
        expect(stdout).toBe("exit event: 1\n");
        expect(exitCode).toBe(1);
      },
      timeout,
    );

    test("framework imports that do not resolve", async () => {
      // No react packages are installed here.
      using dir = tempDir("bake-production-framework-unresolved", { "app.ts": config });

      const { exitCode, stdout, stderr } = await build(String(dir), "./app.ts");
      expect(stderr).toContain("error: Failed to resolve all imports required by the framework");
      expect(stdout).toBe("exit event: 1\n");
      expect(exitCode).toBe(1);
    });

    test("more than one entry point", async () => {
      using dir = tempDir("bake-production-two-entry-points", { "app.ts": config, "other.ts": config });

      const { exitCode, stdout, stderr } = await build(String(dir), "./app.ts", "./other.ts");
      expect(stderr).toContain("error: bun build --app only accepts one entrypoint");
      expect(stderr).not.toContain("BakeBuildFailed");
      expect(stdout).toBe("");
      expect(exitCode).toBe(1);
    });
  });

  test("client-side component with default import should work", async () => {
    const dir = await tempDirWithBakeDeps("bake-production-client-import", {
      "src/index.tsx": `export default { app: { framework: "react" } };`,
      "pages/index.tsx": `import Client from "../components/Client";

export default function IndexPage() {
  return (
    <div>
      <title>LMAO</title>Hello World
      <Client />
    </div>
  );
}`,
      "components/Client.tsx": `"use client";

export default function Client() {
  console.log("Client-side!");
  return <div>Hello World</div>;
}`,
      "package.json": JSON.stringify({
        "name": "test-app",
        "version": "1.0.0",
        "devDependencies": {
          "react": "^18.0.0",
          "react-dom": "^18.0.0",
        },
      }),
    });

    // Run the build command
    const { exitCode, stderr } = await Bun.$`${bunExe()} build --app ./src/index.tsx`.cwd(dir).throws(false);

    expect(exitCode).toBe(0);

    // Check the generated HTML file for pages/index.tsx
    const htmlPage = path.join(dir, "dist", "index.html");
    expect(existsSync(htmlPage)).toBe(true);

    const htmlContent = await Bun.file(htmlPage).text();

    // Verify the static content is rendered
    expect(htmlContent).toContain("<title>LMAO</title>");
    expect(htmlContent).toContain("Hello World");
  });

  test("importing useState server-side", async () => {
    const dir = await tempDirWithBakeDeps("bake-production-react-import", {
      "src/index.tsx": `export default { app: { framework: "react" } };`,
      "pages/index.tsx": `import { useState } from 'react';

export default function IndexPage() {
  const [count, setCount] = useState(0);

  return (
    <div>
      <title>LMAO</title>Hello World
      <button onClick={() => setCount(count + 1)}>Click me</button>
    </div>
  );
}`,
      "package.json": JSON.stringify({
        "name": "test-app",
        "version": "1.0.0",
        "devDependencies": {
          "react": "^18.0.0",
          "react-dom": "^18.0.0",
        },
      }),
    });

    // Run the build command
    const { exitCode, stderr } = await Bun.$`${bunExe()} build --app ./src/index.tsx`.cwd(dir).throws(false);

    // The build should succeed - client components should support default imports
    expect(stderr.toString()).toContain(
      '"useState" is not available in a server component. If you need interactivity, consider converting part of this to a Client Component (by adding `"use client";` to the top of the file).',
    );
    expect(exitCode).toBe(1);
  });

  test("importing useState from client component", async () => {
    const dir = await tempDirWithBakeDeps("bake-production-client-useState", {
      "src/index.tsx": `
 const bundlerOptions = {
  sourcemap: "inline",
  minify: {
    whitespace: false,
    identifiers: false,
    syntax: false,
  },
};     
export default { app: { framework: "react", bundlerOptions: { server: bundlerOptions, client: bundlerOptions, ssr: bundlerOptions } } };`,
      "pages/index.tsx": `import Counter from "../components/Counter";

export default function IndexPage() {
  return (
    <div>
      <h1>Counter Example</h1>
      <Counter />
    </div>
  );
}`,
      "components/Counter.tsx": `"use client";
import { useState } from 'react';

export default function Counter() {
  const [count, setCount] = useState(0);
  
  return (
    <div>
      <p>Count: {count}</p>
      <button onClick={() => setCount(count + 1)}>Click me</button>
    </div>
  );
}`,
      "package.json": JSON.stringify({
        "name": "test-app",
        "version": "1.0.0",
        "devDependencies": {
          "react": "^18.0.0",
          "react-dom": "^18.0.0",
        },
      }),
    });

    // Run the build command
    const { exitCode, stderr } = await Bun.$`${bunExe()} build --app ./src/index.tsx`.cwd(dir).throws(false);

    // The build should succeed - client components CAN use useState
    expect(stderr.toString()).not.toContain("useState");
    expect(exitCode).toBe(0);

    // Check the generated HTML file
    const htmlPage = path.join(dir, "dist", "index.html");
    expect(existsSync(htmlPage)).toBe(true);

    const htmlContent = await Bun.file(htmlPage).text();

    // Verify the static content is rendered
    expect(htmlContent).toContain("<h1>Counter Example</h1>");

    // Verify client component script tags exist
    expect(htmlContent).toContain("<script");
    expect(htmlContent).toContain("/_bun/");

    // Extract the JS bundle filename from the HTML
    const scriptMatch = htmlContent.match(/src="[/]_bun[/]([a-z0-9]+\.js)"/);
    expect(scriptMatch).toBeTruthy();
    const bundleFilename = scriptMatch![1];

    // Check that the client bundle was created
    const clientBundle = path.join(dir, "dist", "_bun", bundleFilename);
    expect(existsSync(clientBundle)).toBe(true);

    // Also check for component-specific bundle by looking for all JS files
    const bundles = await Bun.$`ls ${path.join(dir, "dist", "_bun")}/*.js`.cwd(dir).text();
    const bundleFiles = bundles.trim().split("\n").filter(Boolean);

    // Read all bundles to find the one with our component code
    let foundCounterBundle = false;
    for (const bundleFile of bundleFiles) {
      const content = await Bun.file(bundleFile).text();
      if (content.includes("useState") && content.includes("setCount") && content.includes("Click me")) {
        foundCounterBundle = true;
        break;
      }
    }

    expect(foundCounterBundle).toBe(true);
  });

  test("inline flight data is escaped as a single unit across stream chunks", async () => {
    const dir = await tempDirWithBakeDeps("bake-production-flight-escaping", {
      "src/index.tsx": `export default { app: { framework: "react" } };`,
      "components/Box.tsx": `"use client";

export default function Box({ children }) {
  return <b>{children}</b>;
}`,
      "pages/index.tsx": `import Box from "../components/Box";

const filler = Buffer.alloc(495, "</script>").toString();

async function Item({ index }: { index: number }) {
  return <i>{index + ":" + filler}</i>;
}

export default function IndexPage() {
  return (
    <div>
      <h1>Chunked</h1>
      <Box>hydrated</Box>
      {Array.from({ length: 120 }, (_, i) => (
        <Item key={i} index={i} />
      ))}
    </div>
  );
}`,
      "package.json": JSON.stringify({
        "name": "test-app",
        "version": "1.0.0",
        "devDependencies": {
          "react": "^18.0.0",
          "react-dom": "^18.0.0",
        },
      }),
    });

    const { exitCode } = await Bun.$`${bunExe()} build --app ./src/index.tsx --outdir ./dist`
      .cwd(dir)
      .env(bunEnv)
      .throws(false);
    expect(exitCode).toBe(0);

    const htmlContent = await Bun.file(path.join(dir, "dist", "index.html")).text();
    const opener = "(self.__bun_f||=[]).push('";
    const start = htmlContent.indexOf(opener);
    expect(start).toBeGreaterThan(-1);
    const end = htmlContent.indexOf("')</script>", start);
    expect(end).toBeGreaterThan(start);
    const payload = htmlContent.slice(start + opener.length, end);
    expect(payload).toContain("</\\script></\\script>");
    expect(payload).not.toContain("</script");
  });

  test("don't include client code if fully static route", async () => {
    const dir = await tempDirWithBakeDeps("bake-production-no-client-js", {
      "src/index.tsx": `export default { app: { framework: "react" } };`,
      "pages/index.tsx": `
export default function IndexPage() {
  return (
    <div>
      Hello World
    </div>
  );
}`,
      "package.json": JSON.stringify({
        "name": "test-app",
        "version": "1.0.0",
        "devDependencies": {
          "react": "^18.0.0",
          "react-dom": "^18.0.0",
        },
      }),
    });

    // Run the build command
    const { exitCode, stderr } = await Bun.$`${bunExe()} build --app ./src/index.tsx`.cwd(dir).throws(false);

    // The build should succeed
    // expect(stderr.toString()).toBe("");
    expect(exitCode).toBe(0);

    // Check the generated HTML file
    const htmlPage = path.join(dir, "dist", "index.html");
    expect(existsSync(htmlPage)).toBe(true);

    const htmlContent = await Bun.file(htmlPage).text();

    // Verify the content is rendered
    expect(htmlContent).toContain("Hello World");

    // Verify NO JavaScript imports are included in the HTML
    expect(htmlContent).not.toContain('<script type="module"');
  });

  // A successful build leaves through `on_exit` + `global_exit`: 'exit' handlers, process.exitCode, and VM teardown under BUN_DESTRUCT_VM_ON_EXIT.
  describe.concurrent("exits through the build VM", () => {
    const env = { ...bunEnv, BUN_DESTRUCT_VM_ON_EXIT: "1" };

    const onExitConfig = `
      process.on("exit", code => console.log("exit event: " + code));
      export default { app: { framework: "react" } };
    `;

    const timeout = 30_000 * WAIT_MULTIPLIER;

    test(
      "a rendered build runs 'exit' handlers and exits with process.exitCode",
      async () => {
        const dir = await tempDirWithBakeDeps("bake-production-exit-rendered", {
          "app.ts": onExitConfig,
          "pages/index.tsx": `
            process.exitCode = 3;
            export default function IndexPage() {
              return <div>Hello World</div>;
            }
          `,
        });

        const { stdout, exitCode } = await Bun.$`${bunExe()} build --app ./app.ts`
          .cwd(dir)
          .env(env)
          .quiet()
          .throws(false);

        expect(await Bun.file(path.join(dir, "dist", "index.html")).text()).toContain("Hello World");
        expect(stdout.toString()).toBe("done\nexit event: 3\n");
        expect(exitCode).toBe(3);
      },
      timeout,
    );

    test(
      "a build with nothing to render runs 'exit' handlers",
      async () => {
        const dir = await tempDirWithBakeDeps("bake-production-exit-no-routes", {
          "app.ts": onExitConfig,
        });

        const { stdout, exitCode } = await Bun.$`${bunExe()} build --app ./app.ts`
          .cwd(dir)
          .env(env)
          .quiet()
          .throws(false);

        expect(stdout.toString()).toBe("done\nexit event: 0\n");
        expect(exitCode).toBe(0);
      },
      timeout,
    );

    // These natives are freed by wrapper finalizers, so a build that exits without destroying its VM leaves them for LeakSanitizer.
    test.skipIf(!isASAN)(
      "a rendered build frees the natives its JS objects own",
      async () => {
        const dir = await tempDirWithBakeDeps("bake-production-exit-teardown", {
          "app.ts": `export default { app: { framework: "react" } };`,
          "pages/index.tsx": `
            export default function IndexPage() {
              globalThis.keepUntilExit = [
                new TextDecoder(),
                new Blob(["prerender"]),
                setImmediate(() => {}),
                new Bun.CryptoHasher("sha256"),
              ];
              return <div>Hello World</div>;
            }
          `,
        });

        const { stdout, stderr } = await Bun.$`${bunExe()} build --app ./app.ts`
          .cwd(dir)
          .env({
            ...env,
            ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "detect_leaks=1"].filter(Boolean).join(":"),
            LSAN_OPTIONS: [
              bunEnv.LSAN_OPTIONS,
              `print_suppressions=0:suppressions=${path.join(import.meta.dirname, "../../leaksan.supp")}`,
            ]
              .filter(Boolean)
              .join(":"),
          })
          .quiet()
          .throws(false);

        expect(await Bun.file(path.join(dir, "dist", "index.html")).text()).toContain("Hello World");
        expect(stdout.toString()).toBe("done\n");
        const leaked = ["TextDecoder", "Blob", "ImmediateObject", "CryptoHasher"].filter(type =>
          stderr.toString().includes(type),
        );
        expect(leaked).toStrictEqual([]);
      },
      timeout,
    );
  });

  describe.concurrent("output files that cannot be written", () => {
    const app = {
      "src/index.tsx": `
        process.on("exit", code => console.log("exit event: " + code));
        export default { app: { framework: "react" } };
      `,
      "pages/index.tsx": `import Client from "../components/Client";

export default function IndexPage() {
  return <Client />;
}`,
      "components/Client.tsx": `"use client";

export default function Client() {
  return "client";
}`,
    };

    // With --debug-no-minify the outputs under dist/_bun are named after their sources; the page becomes dist/index.html.
    const clientEntry = expect.stringMatching(/^bun-framework-react\/client\.\w+\.js$/);
    const runtimeChunk = expect.stringMatching(/^bun-framework-react\/server\.\w+\.chunk\.js$/);
    const clientComponent = expect.stringMatching(/^components\/Client\.\w+\.js$/);
    const serverPage = expect.stringMatching(/^pages\/index\.\w+\.js$/);

    async function build(dir: string, ...flags: string[]) {
      const { exitCode, stdout, stderr } =
        await Bun.$`${bunExe()} build --app ./src/index.tsx --debug-no-minify ${flags}`
          .cwd(dir)
          .env({ ...bunEnv, BUN_DESTRUCT_VM_ON_EXIT: "1" })
          .quiet()
          .throws(false);
      return {
        exitCode,
        stdout: stdout.toString(),
        // Paths relative to dist/_bun, sorted.
        failedWrites: Array.from(
          normalizePath(stderr.toString()).matchAll(/Failed to write "_bun\/([^"]+)" to output directory/g),
          match => match[1],
        ).sort(),
        prerendered: existsSync(path.join(dir, "dist", "index.html")),
        stderr: stderr.toString(),
      };
    }

    // The failure exits through the build VM (the config's 'exit' handler runs) and nothing is prerendered.
    const failed = { exitCode: 1, stdout: "exit event: 1\n", prerendered: false };

    // Every test bundles a react app once or twice; see "failures reported by the build" above.
    const timeout = 30_000 * WAIT_MULTIPLIER;

    test(
      "every failed write is reported",
      async () => {
        // Files in the way of both output directories (not dist/_bun itself: on Windows, mkdir under a file never returns).
        const dir = await tempDirWithBakeDeps("bake-production-unwritable-output-dirs", {
          ...app,
          "dist/_bun/bun-framework-react": "a file in the way of the directory",
          "dist/_bun/components": "a file in the way of the directory",
        });

        expect(await build(dir)).toMatchObject({
          ...failed,
          failedWrites: [clientEntry, runtimeChunk, clientComponent],
        });
      },
      timeout,
    );

    test(
      "a client chunk that cannot be written fails the build",
      async () => {
        const dir = await tempDirWithBakeDeps("bake-production-unwritable-client-chunk", {
          ...app,
          "dist/_bun/components": "a file in the way of the directory",
        });

        expect(await build(dir)).toMatchObject({ ...failed, failedWrites: [clientComponent] });
      },
      timeout,
    );

    test(
      "a runtime chunk that cannot be written fails the build",
      async () => {
        const dir = await tempDirWithBakeDeps("bake-production-unwritable-runtime-chunk", app);
        expect(await build(dir)).toMatchObject({ exitCode: 0, failedWrites: [], prerendered: true });

        // The hash in the chunk's name is only known from a build that wrote it.
        const frameworkDir = path.join(dir, "dist", "_bun", "bun-framework-react");
        const chunks = readdirSync(frameworkDir).filter(name => name.endsWith(".chunk.js"));
        expect(chunks).toHaveLength(1);
        rmSync(path.join(dir, "dist"), { recursive: true });
        mkdirSync(path.join(frameworkDir, chunks[0]), { recursive: true });

        expect(await build(dir)).toMatchObject({ ...failed, failedWrites: [`bun-framework-react/${chunks[0]}`] });
      },
      2 * timeout,
    );

    test(
      "a dumped server file that cannot be written fails the build",
      async () => {
        const dir = await tempDirWithBakeDeps("bake-production-unwritable-server-file", {
          ...app,
          "dist/_bun/pages": "a file in the way of the directory",
        });

        expect(await build(dir, "--debug-dump-server-files")).toMatchObject({ ...failed, failedWrites: [serverPage] });
      },
      timeout,
    );
  });

  // The build's per-graph transpilers must be freed; these builds stop right after bundling, where a leak report would exit non-zero.
  describe.concurrent.skipIf(!isASAN)("frees its transpilers before exiting", () => {
    async function buildApp(cwd: string) {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "build", "--app", "./app.ts"],
        cwd,
        env: {
          ...bunEnv,
          // Silences the "Bun Bake is highly experimental" banner.
          BUN_DEV_SERVER_TEST_RUNNER: "1",
          ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "detect_leaks=1"].filter(Boolean).join(":"),
          LSAN_OPTIONS: `print_suppressions=0:suppressions=${path.join(import.meta.dir, "../../leaksan.supp")}`,
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stdout, stderr, exitCode };
    }

    const cleanBuild = {
      stdout: "done\n",
      stderr: "Loading configuration\nBundling routes\n",
      exitCode: 0,
    };

    const timeout = 30_000 * WAIT_MULTIPLIER;

    test(
      "react framework: server, client and ssr graphs",
      async () => {
        const dir = await tempDirWithBakeDeps("bake-production-transpiler-leak-react", {
          "app.ts": `export default { app: { framework: "react" } };`,
        });

        expect(await buildApp(dir)).toStrictEqual(cleanBuild);
      },
      timeout,
    );

    test(
      "framework without server components: server and client graphs only",
      async () => {
        using dir = tempDir("bake-production-transpiler-leak-two-graphs", {
          "app.ts": `export default {
            app: {
              framework: {
                fileSystemRouterTypes: [{ root: "pages", serverEntryPoint: "./server.ts", style: "nextjs-pages" }],
              },
            },
          };`,
          "server.ts": `export function prerender() {}`,
        });

        expect(await buildApp(String(dir))).toStrictEqual(cleanBuild);
      },
      timeout,
    );

    test(
      "build that fails while bundling",
      async () => {
        const dir = await tempDirWithBakeDeps("bake-production-transpiler-leak-bundle-error", {
          "app.ts": `export default { app: { framework: "react" } };`,
          "pages/index.tsx": `import { useState } from "react";
export default function IndexPage() {
  useState(0);
}
`,
        });

        const { stdout, stderr, exitCode } = await buildApp(dir);
        expect({ stdout, stderr: normalizeBunSnapshot(stderr, dir), exitCode }).toMatchInlineSnapshot(`
          {
            "exitCode": 1,
            "stderr": 
          "Loading configuration
          Bundling routes
          3 |   useState(0);
                ^
          error: "useState" is not available in a server component. If you need interactivity, consider converting part of this to a Client Component (by adding \`"use client";\` to the top of the file).
              at <dir>/pages/index.tsx:3:3"
          ,
            "stdout": "",
          }
        `);
      },
      timeout,
    );
  });

  // BUN_JSC_validateExceptionChecks=1 aborts the child on the first unchecked JSC exception (debug/ASAN builds only).
  describe.concurrent("exception checks", () => {
    async function buildApp(cwd: string, ...args: string[]) {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "build", "--app", ...args],
        cwd,
        env: { ...bunEnv, BUN_JSC_validateExceptionChecks: "1", BUN_JSC_dumpSimulatedThrows: "1" },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      // The two report lines that name the throwing scope and the one that failed to check it.
      const uncheckedScopes = stderr
        .split("\n")
        .map(line => line.trim())
        .filter(line => line.startsWith("This scope can throw") || line.startsWith("But the exception was unchecked"));
      return { stdout, stderr, exitCode, signalCode: proc.signalCode, uncheckedScopes };
    }

    test("loading the config file", async () => {
      // No routes directory: the build stops after reading the config's default export.
      using dir = tempDir("bake-production-validate-config", {
        "bun.app.ts": `export default {
          app: {
            framework: {
              fileSystemRouterTypes: [{ root: "routes", style: "nextjs-pages", serverEntryPoint: "./server.ts" }],
            },
          },
        };`,
        "server.ts": `export function render() { return new Response("unused"); }`,
      });

      const { stdout, exitCode, signalCode, uncheckedScopes } = await buildApp(String(dir));
      expect({ stdout: normalizeBunSnapshot(stdout), exitCode, signalCode, uncheckedScopes }).toStrictEqual({
        stdout: "done",
        exitCode: 0,
        signalCode: null,
        uncheckedScopes: [],
      });
    });

    test("loading the server entry point and prerendering routes", async () => {
      // Loads the server entry point, reads prerender/getParams, and (via the client component) has a "bake:/" module call import().
      const dir = await tempDirWithBakeDeps("bake-production-validate-prerender", {
        "src/index.tsx": `export default { app: { framework: "react" } };`,
        "pages/index.tsx": `import Greeting from "../components/Greeting";

export default function IndexPage() {
  return (
    <main>
      <h1>Static Home</h1>
      <Greeting />
    </main>
  );
}`,
        "components/Greeting.tsx": `"use client";

export default function Greeting() {
  return <p>Hello from the client</p>;
}`,
        "pages/posts/[slug].tsx": `export default function Post({ params }) {
  return <h1>{"Post " + params.slug}</h1>;
}

export function getStaticPaths() {
  return { paths: [{ params: { slug: "first" } }, { params: { slug: "second" } }], fallback: false };
}`,
      });

      const { exitCode, signalCode, uncheckedScopes } = await buildApp(dir, "./src/index.tsx");
      expect({ exitCode, signalCode, uncheckedScopes }).toStrictEqual({
        exitCode: 0,
        signalCode: null,
        uncheckedScopes: [],
      });

      const rendered = await Promise.all(
        ["index.html", "posts/first/index.html", "posts/second/index.html"].map(file =>
          Bun.file(path.join(dir, "dist", file)).text(),
        ),
      );
      expect(rendered[0]).toContain("<h1>Static Home</h1>");
      expect(rendered[0]).toContain("<p>Hello from the client</p>");
      expect(rendered[1]).toContain("<h1>Post first</h1>");
      expect(rendered[2]).toContain("<h1>Post second</h1>");
    });

    test("a config import that fails to resolve", async () => {
      // A specifier the bake resolve hook cannot resolve falls through to the regular resolver, which throws.
      using dir = tempDir("bake-production-validate-unresolved", {
        "bun.app.ts": `import "./does-not-exist";
          export default { app: { framework: "react" } };`,
      });

      const { stderr, exitCode, signalCode, uncheckedScopes } = await buildApp(String(dir));
      expect({ exitCode, signalCode, uncheckedScopes }).toStrictEqual({
        exitCode: 1,
        signalCode: null,
        uncheckedScopes: [],
      });
      expect(stderr).toContain("Cannot find module './does-not-exist'");
    });

    test("a route importing a file outside the bundle while rendering", async () => {
      // A "bake:/" key that is not in the output map is handed to the regular loader to read from disk.
      const dir = await tempDirWithBakeDeps("bake-production-validate-disk-import", {
        "src/index.tsx": `export default { app: { framework: "react" } };`,
        "extra/banner.mjs": `export const banner = "read from disk while rendering";`,
        "pages/index.tsx": `import { join } from "node:path";

export default async function IndexPage() {
  // A computed specifier, so the bundler leaves this import() for the runtime.
  const { banner } = await import(join(import.meta.dir, "../extra/banner.mjs"));
  return <p>{banner}</p>;
}`,
      });

      const { exitCode, signalCode, uncheckedScopes } = await buildApp(dir, "./src/index.tsx");
      expect({ exitCode, signalCode, uncheckedScopes }).toStrictEqual({
        exitCode: 0,
        signalCode: null,
        uncheckedScopes: [],
      });
      expect(await Bun.file(path.join(dir, "dist", "index.html")).text()).toContain(
        "<p>read from disk while rendering</p>",
      );
    });
  });

  // Every BunString the build creates has exactly one consumer that releases it; only LSan with Malloc=1 can see a missed release (WTF strings otherwise live in bmalloc).
  describe.skipIf(!isASAN || isWindows)("strings created for the build are released", () => {
    // Both pages import the same chunks statically and via import(), so the same "bake:/" keys resolve more than once (only a repeat resolution leaks a reportable string).
    const app = (aboutPageBody: string) => ({
      "src/index.tsx": `export default { app: { framework: "react" } };`,
      "components/Shared.tsx": `export function Shared({ page }: { page: string }) {
  return <p>{"shared from " + page}</p>;
}`,
      "components/lazy.ts": `export const lazy = "lazy";`,
      "pages/index.tsx": `import { Shared } from "../components/Shared";

export default async function IndexPage() {
  const { lazy } = await import("../components/lazy");
  return <div>{"index " + lazy}<Shared page="index" /></div>;
}`,
      "pages/about.tsx": `import { Shared } from "../components/Shared";

export default async function AboutPage() {
  const { lazy } = await import("../components/lazy");
  ${aboutPageBody}
}`,
    });

    async function buildUnderLeakSanitizer(dir: string, env: Record<string, string> = {}): Promise<string> {
      const { stderr } = await Bun.$`${bunExe()} build --app ./src/index.tsx`
        .cwd(dir)
        .env({
          ...bunEnv,
          ...env,
          Malloc: "1",
          ASAN_OPTIONS: "allow_user_segv_handler=1:disable_coredump=0:detect_leaks=1",
          // ~20 bmalloc frames sit between malloc and the string's creator; log_threads makes the check announce itself.
          LSAN_OPTIONS: "malloc_context_size=40:log_threads=1",
        })
        .quiet()
        .throws(false);
      const output = stderr.toString();
      expect(output).toContain("Processing thread");
      return output;
    }
    const leakScanTimeout = 120_000;

    // Keep only the LSan records with BunString machinery on the stack, reduced to the two frames above it ("who created it").
    const stringMachinery = /\bBunString__\w+|bun_core::string::/;
    function leakedBunStrings(stderr: string): string[] {
      return stderr
        .split(/^(?=(?:Direct|Indirect) leak of )/m)
        .filter(record => stringMachinery.test(record))
        .map(record => {
          const [header, ...lines] = record.split("\n");
          const frames = lines.map(line => line.trim().replace(/^#\d+ 0x[0-9a-f]+ in /, ""));
          const created = frames.findIndex(frame => stringMachinery.test(frame));
          const creators = frames
            .slice(created)
            .filter(frame => !stringMachinery.test(frame))
            .slice(0, 2)
            .map(frame => frame.replace(/\(.*\) /, "() ").replace(/ \S*\/src\//, " src/"));
          return [header, ...creators].join("\n");
        });
    }

    test.concurrent(
      "after a successful build",
      async () => {
        const dir = await tempDirWithBakeDeps(
          "bake-production-string-leaks",
          app(`return <div>{"about " + lazy}<Shared page="about" /></div>;`),
        );

        const stderr = await buildUnderLeakSanitizer(dir);

        // Both pages rendered, so every import above was resolved and loaded.
        const indexHtml = await Bun.file(path.join(dir, "dist", "index.html")).text();
        const aboutHtml = await Bun.file(path.join(dir, "dist", "about", "index.html")).text();
        expect(indexHtml).toContain("<div>index lazy<p>shared from index</p></div>");
        expect(aboutHtml).toContain("<div>about lazy<p>shared from about</p></div>");
        expect(leakedBunStrings(stderr)).toStrictEqual([]);
      },
      leakScanTimeout,
    );

    // Under BUN_DESTRUCT_VM_ON_EXIT the VM releases the module registry, so only a leaked reference would still hold these strings.
    test.concurrent(
      "after a failed build tears the VM down",
      async () => {
        const dir = await tempDirWithBakeDeps(
          "bake-production-string-leaks-teardown",
          app(`throw new Error("about page failed to render");`),
        );

        const stderr = await buildUnderLeakSanitizer(dir, { BUN_DESTRUCT_VM_ON_EXIT: "1" });

        // The build got as far as loading and running the page modules.
        expect(stderr).toContain("about page failed to render");
        expect(leakedBunStrings(stderr)).toStrictEqual([]);
      },
      leakScanTimeout,
    );
  });

  test("a route can import a file outside the bundle while rendering", async () => {
    // A path the bundler never saw is keyed under "bake:", misses the module map, and is read from disk; on Windows it is a drive path.
    const dir = await tempDirWithBakeDeps("bake-production-disk-import", {
      "src/index.tsx": `export default { app: { framework: "react" } };`,
      "extra/banner.mjs": `import { detail } from "../shared/detail.mjs";

export const banner = "read from disk while rendering";
export { detail };`,
      "shared/detail.mjs": `export const detail = "resolved relative to the file on disk";`,
      "pages/index.tsx": `import { join } from "node:path";

export default async function IndexPage() {
  // Computed specifiers stay runtime import()s; both spellings must name the same module.
  const joined = await import(join(import.meta.dir, "..", "extra", "banner.mjs"));
  const unnormalized = await import([import.meta.dir, "..", "extra", "banner.mjs"].join("/"));
  return (
    <ul>
      <li>{joined.banner}</li>
      <li>{joined.detail}</li>
      <li>{joined === unnormalized ? "one module instance" : "two module instances"}</li>
    </ul>
  );
}`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--app", "./src/index.tsx"],
      cwd: dir,
      env: bunEnv,
      stdout: "ignore",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);

    const html = await Bun.file(path.join(dir, "dist", "index.html")).text();
    expect(html).toContain("<li>read from disk while rendering</li>");
    expect(html).toContain("<li>resolved relative to the file on disk</li>");
    expect(html).toContain("<li>one module instance</li>");
  });
});
