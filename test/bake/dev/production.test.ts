import { describe, expect, test } from "bun:test";
import { existsSync, symlinkSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import path from "path";
import { minimalFramework, tempDirWithBakeDeps } from "../bake-harness";

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

  // The bundler has no transform for these modules yet. The build used to abort
  // in the parser instead of reporting the file.
  test.concurrent.each([
    ["with a semicolon", `"use server";\nexport async function save() {\n  return "saved";\n}\n`],
    ["without a semicolon", `'use server'\nexport async function save() {\n  return "saved";\n}\n`],
  ])('a "use server" module is a build error (%s)', async (_, actions) => {
    using dir = tempDir("bake-production-use-server", {
      "app.ts": `export default { app: { framework: ${JSON.stringify(minimalFramework)} } };`,
      "routes/index.ts": `
import "../actions";
export default function () {
  return new Response("Hello");
}
`,
      "actions.ts": actions,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--app", "./app.ts", "--outdir", "./dist"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "ignore",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    expect(stderr).toContain('error: "use server" is not supported yet');
    expect(normalizePath(stderr)).toContain("/actions.ts:1:1");
    expect(existsSync(path.join(String(dir), "dist"))).toBe(false);
    expect(exitCode).toBe(1);
  });

  // A production build has no client references without a separate SSR graph.
  // The build used to abort instead of reporting the file: in the parser when it
  // wraps an exported value, and in the linker when it has nothing to wrap.
  test.concurrent.each([
    ["an exported function", `export function Button() {}`],
    ["an export clause", `function Button() {}\nexport { Button };`],
  ])('a "use client" module without a separate SSR graph is a build error (%s)', async (_, exports) => {
    const framework = {
      ...minimalFramework,
      serverComponents: { ...minimalFramework.serverComponents!, separateSSRGraph: false },
    };
    using dir = tempDir("bake-production-use-client-single-graph", {
      "app.ts": `export default { app: { framework: ${JSON.stringify(framework)} } };`,
      "routes/index.ts": `
import { Button } from "../components/Button";
export default function () {
  return new Response("Hello, " + typeof Button);
}
`,
      "components/Button.ts": `"use client";\n${exports}\n`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--app", "./app.ts", "--outdir", "./dist"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "ignore",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    expect(stderr).toContain(
      `error: "use client" is not supported yet in a production build unless 'framework.serverComponents.separateSSRGraph' is true`,
    );
    expect(normalizePath(stderr)).toContain("/components/Button.ts:1:1");
    expect(existsSync(path.join(String(dir), "dist"))).toBe(false);
    expect(exitCode).toBe(1);
  });

  test('a framework entry point that a "browser" map disables is reported', async () => {
    using dir = tempDir("bake-production-disabled-entry", {
      "package.json": JSON.stringify({ name: "app", browser: { "./client.ts": false } }),
      "client.ts": `export {};`,
      "server.ts": `export function render() { return new Response("ok"); }`,
      "routes/index.ts": `export default () => new Response("ok");`,
      "app.ts": `
        const fsr = { root: "routes", style: "nextjs-pages", serverEntryPoint: "./server.ts", clientEntryPoint: "./client.ts" };
        export default { app: { framework: { fileSystemRouterTypes: [fsr] } } };
      `,
    });

    const { exitCode, stderr } = await Bun.$`${bunExe()} build --app ./app.ts`
      .cwd(String(dir))
      .env(bunEnv)
      .throws(false);
    expect(stderr.toString()).toContain("Failed to resolve './client.ts' for framework (client side entrypoint)");
    expect(exitCode).toBe(1);
  });

  test("builds a framework without server components and keeps its client entry point", async () => {
    using dir = tempDir("bake-production-custom-framework", {
      "client.ts": `console.log("client loaded");`,
      "server.ts": `
        export function render(req, meta) {
          return new Response(String(meta.pageModule.default()));
        }
        export async function prerender(meta) {
          const scripts = meta.modules.map(m => '<script type="module" src="' + m + '"></script>').join("");
          return { files: { "index.html": "<body>" + meta.pageModule.default() + scripts + "</body>" } };
        }
      `,
      "routes/index.ts": `export default () => "homepage";`,
      "app.ts": `
        const fsr = { root: "routes", style: "nextjs-pages", serverEntryPoint: "./server.ts", clientEntryPoint: "./client.ts" };
        export default { app: { framework: { fileSystemRouterTypes: [fsr] } } };
      `,
    });

    const { exitCode, stderr } = await Bun.$`${bunExe()} build --app ./app.ts`
      .cwd(String(dir))
      .env(bunEnv)
      .throws(false);
    const html = await Bun.file(path.join(String(dir), "dist", "index.html"))
      .text()
      .catch(() => stderr.toString());
    expect(html).toContain("homepage");
    const script = html.match(/<script type="module" src="\/([^"]*_bun[^"]*\.js)"><\/script>/);
    expect(script).toBeTruthy();
    expect(existsSync(path.join(String(dir), "dist", script![1]))).toBe(true);
    expect(exitCode).toBe(0);
  });

  // Two entry points can name one file, and an onResolve plugin answers for an
  // entry point after the other entry points are in the graph. Each route is still
  // prerendered from the module of its own file.
  describe("every route is prerendered from its own module", () => {
    const page = (text: string) => `export default () => ${JSON.stringify(text)};`;
    const allPages = ["a", "b", "d", "e", "f", "g", "h"];
    const serverComponents = `serverComponents: { separateSSRGraph: true, serverRuntimeImportSource: "./server.ts", serverRegisterClientReferenceExport: "registerClientReference" },`;
    const clientEntryPoint = `clientEntryPoint: "./client.ts",`;

    /**
     * An app with a framework that renders the text a page returns. `framework`, `router` and
     * `plugins` are spliced into its config. A plugin calls `asked(args)` to record a call.
     */
    const appFiles = (pages: string[], { framework = "", router = "", plugins = "" } = {}) => ({
      "server.ts": `
        export function render(req, meta) {
          return new Response(String(meta.pageModule.default()));
        }
        export async function prerender(meta) {
          return { files: { "/index.html": meta.pageModule.default(), "/scripts.json": JSON.stringify(meta.modules) } };
        }
        export function registerClientReference(value, file, name) {
          return "client-" + name;
        }
      `,
      "client.ts": `console.log("client");`,
      "app.ts": `
        import fs from "node:fs";
        import path from "node:path";
        const fsr = { root: "routes", style: "nextjs-pages", serverEntryPoint: "./server.ts", layouts: true, ${router} };
        const shared = path.join(import.meta.dir, "shared", "page.ts");
        const asked = args =>
          fs.appendFileSync(path.join(import.meta.dir, "asked.txt"), args.kind + " " + path.basename(args.path) + "\\n");
        export default { app: { framework: { fileSystemRouterTypes: [fsr], ${framework} }, plugins: [${plugins}] } };
      `,
      "shared/page.ts": page("shared-page"),
      "routes/index.ts": page("homepage"),
      ...Object.fromEntries(pages.map(name => [`routes/${name}.ts`, page(`page-${name}`)])),
      // Entry points that are not pages.
      ...Object.fromEntries(
        ["c.ts", "za", "zb", "zc", "zd", "ze"].map(name => [`routes/${name}/_layout.ts`, page(`layout-${name}`)]),
      ),
    });
    const ownPages = (pages: string[]) => ({
      "/": "homepage",
      ...Object.fromEntries(pages.map(name => [`/${name}`, `page-${name}`])),
    });

    /** Builds the app in `dir`. `asked` is the sorted calls of the plugin, `scripts` says for each client script of a page whether the build wrote it. */
    async function prerender(dir: string) {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "build", "--app", "./app.ts"],
        env: bunEnv,
        cwd: dir,
        stdout: "ignore",
        stderr: "pipe",
      });
      const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
      const dist = path.join(dir, "dist");
      const pages: Record<string, string> = {};
      const scripts: Record<string, boolean> = {};
      for (const file of existsSync(dist) ? new Bun.Glob("**/index.html").scanSync(dist) : []) {
        const route = normalizePath(path.dirname(file));
        pages[route === "." ? "/" : "/" + route] = await Bun.file(path.join(dist, file)).text();
        for (const script of await Bun.file(path.join(dist, path.dirname(file), "scripts.json")).json()) {
          scripts[script.replace(/[\w-]+(?=\.js$)/, "[name]")] = existsSync(path.join(dist, script));
        }
      }
      const calls = await Bun.file(path.join(dir, "asked.txt"))
        .text()
        .catch(() => "");
      return { pages, scripts, asked: calls.split("\n").filter(Boolean).sort(), exitCode, stderr };
    }

    test.concurrent("when no two routes share a file", async () => {
      using dir = tempDir("bake-production-own-module", appFiles(allPages));
      const { pages, exitCode, stderr } = await prerender(String(dir));
      expect({ pages, exitCode }, stderr).toEqual({ pages: ownPages(allPages), exitCode: 0 });
    });

    test.concurrent("when two route files are links to one file", async () => {
      const realPages = ["a", "b", "d", "e", "h"];
      using dir = tempDir("bake-production-linked-route-files", appFiles(realPages));
      symlinkSync(path.join("..", "shared", "page.ts"), path.join(String(dir), "routes", "f.ts"));
      symlinkSync(path.join("..", "shared", "page.ts"), path.join(String(dir), "routes", "g.ts"));
      const { pages, exitCode, stderr } = await prerender(String(dir));
      expect({ pages, exitCode }, stderr).toEqual({
        pages: { ...ownPages(realPages), "/f": "shared-page", "/g": "shared-page" },
        exitCode: 0,
      });
    });

    test.concurrent("when a route directory is a link to another route directory", async () => {
      const realPages = ["a", "b", "real/d", "real/e"];
      using dir = tempDir("bake-production-linked-route-dir", appFiles(realPages));
      symlinkSync(path.join(String(dir), "routes", "real"), path.join(String(dir), "routes", "linked"), "junction");
      const { pages, exitCode, stderr } = await prerender(String(dir));
      expect({ pages, exitCode }, stderr).toEqual({
        pages: { ...ownPages(realPages), "/linked/d": "page-real/d", "/linked/e": "page-real/e" },
        exitCode: 0,
      });
    });

    test.concurrent("when an onResolve plugin passes on the server entry point and a route", async () => {
      const plugins = `{
        name: "passes",
        setup(build) {
          build.onResolve({ filter: /[\\\\/](server|a)\\.ts$/ }, args => void asked(args));
        },
      }`;
      using dir = tempDir("bake-production-plugin-passes", appFiles(allPages, { plugins }));
      const { pages, asked, exitCode, stderr } = await prerender(String(dir));
      expect({ pages, asked, exitCode }, stderr).toEqual({
        pages: ownPages(allPages),
        asked: ["entry-point-build a.ts", "entry-point-build server.ts"],
        exitCode: 0,
      });
    });

    test.concurrent("when an onResolve plugin answers for four routes in the reverse of the order asked", async () => {
      const plugins = `{
        name: "reverse",
        setup(build) {
          const answers = [];
          build.onResolve({ filter: /[\\\\/]routes[\\\\/][bdeh]\\.ts$/ }, args => {
            asked(args);
            const answer = Promise.withResolvers();
            answers.push(answer);
            if (answers.length === 4) for (const last of answers.reverse()) last.resolve();
            return answer.promise;
          });
        },
      }`;
      using dir = tempDir("bake-production-plugin-reverse", appFiles(allPages, { plugins }));
      const { pages, asked, exitCode, stderr } = await prerender(String(dir));
      expect({ pages, asked, exitCode }, stderr).toEqual({
        pages: ownPages(allPages),
        asked: ["b", "d", "e", "h"].map(name => `entry-point-build ${name}.ts`),
        exitCode: 0,
      });
    });

    test.concurrent("when an onResolve plugin resolves two routes to one file", async () => {
      const plugins = `{
        name: "resolves",
        setup(build) {
          build.onResolve({ filter: /[\\\\/]routes[\\\\/](a|e)\\.ts$/ }, args => (asked(args), { path: shared }));
        },
      }`;
      using dir = tempDir("bake-production-plugin-resolves", appFiles(allPages, { plugins }));
      const { pages, asked, exitCode, stderr } = await prerender(String(dir));
      expect({ pages, asked, exitCode }, stderr).toEqual({
        pages: { ...ownPages(allPages), "/a": "shared-page", "/e": "shared-page" },
        asked: ["entry-point-build a.ts", "entry-point-build e.ts"],
        exitCode: 0,
      });
    });

    // The plugin sees `b.ts` twice: as an entry point, and as the import in `a.ts`.
    // Whichever it answers first puts the file in the graph.
    const passesOnImportedRoute = (entryPointFirst: boolean) => `{
      name: "passes",
      setup(build) {
        const first = Promise.withResolvers();
        build.onResolve({ filter: /b\\.ts$/ }, async args => {
          asked(args);
          if ((args.kind === "entry-point-build") === ${entryPointFirst}) first.resolve();
          else await first.promise;
          return undefined;
        });
      },
    }`;
    test.concurrent.each([
      ["before", true],
      ["after", false],
    ])("when an onResolve plugin passes on a route %s the import of it is resolved", async (_, entryPointFirst) => {
      using dir = tempDir("bake-production-plugin-import-order", {
        ...appFiles(allPages, { plugins: passesOnImportedRoute(entryPointFirst) }),
        "routes/a.ts": `import b from "./b.ts";\nexport default () => "page-a imports " + b();`,
      });
      const { pages, asked, exitCode, stderr } = await prerender(String(dir));
      expect({ pages, asked, exitCode }, stderr).toEqual({
        pages: { ...ownPages(allPages), "/a": "page-a imports page-b" },
        asked: ["entry-point-build b.ts", "import-statement b.ts"],
        exitCode: 0,
      });
    });

    test.concurrent.each([
      ["passes on", "undefined"],
      ["resolves", "{ path: args.path }"],
    ])("when an onResolve plugin %s the client entry point", async (_, answer) => {
      const plugins = `{
        name: "client",
        setup(build) {
          build.onResolve({ filter: /[\\\\/]client\\.ts$/ }, args => (asked(args), ${answer}));
        },
      }`;
      using dir = tempDir("bake-production-plugin-client", appFiles(allPages, { router: clientEntryPoint, plugins }));
      const { pages, scripts, asked, exitCode, stderr } = await prerender(String(dir));
      expect({ pages, scripts, asked, exitCode }, stderr).toEqual({
        pages: ownPages(allPages),
        scripts: { "/_bun/[name].js": true },
        asked: ["entry-point-build client.ts"],
        exitCode: 0,
      });
    });

    // A client component is an entry point of the build, but no route file.
    describe("with a client component", () => {
      const clientComponent = {
        "components/Button.ts": `"use client";\nexport function Button() {}`,
        "routes/b.ts": `import { Button } from "../components/Button.ts";\nexport default () => "page-b with " + Button;`,
      };

      test.concurrent("when two route files are links to one file", async () => {
        const realPages = ["a", "b", "d", "e", "h"];
        using dir = tempDir("bake-production-client-component", {
          ...appFiles(realPages, { framework: serverComponents }),
          ...clientComponent,
        });
        symlinkSync(path.join("..", "shared", "page.ts"), path.join(String(dir), "routes", "f.ts"));
        symlinkSync(path.join("..", "shared", "page.ts"), path.join(String(dir), "routes", "g.ts"));
        const { pages, exitCode, stderr } = await prerender(String(dir));
        expect({ pages, exitCode }, stderr).toEqual({
          pages: {
            ...ownPages(realPages),
            "/b": "page-b with client-Button",
            "/f": "shared-page",
            "/g": "shared-page",
          },
          exitCode: 0,
        });
      });

      test.concurrent("when an onResolve plugin passes on a route after the import of it is resolved", async () => {
        using dir = tempDir("bake-production-client-component-plugin", {
          ...appFiles(allPages, {
            framework: serverComponents,
            router: clientEntryPoint,
            plugins: passesOnImportedRoute(false),
          }),
          ...clientComponent,
          "routes/a.ts": `import b from "./b.ts";\nexport default () => "page-a imports " + b();`,
        });
        const { pages, scripts, asked, exitCode, stderr } = await prerender(String(dir));
        expect({ pages, scripts, asked, exitCode }, stderr).toEqual({
          pages: {
            ...ownPages(allPages),
            "/a": "page-a imports page-b with client-Button",
            "/b": "page-b with client-Button",
          },
          scripts: { "/_bun/[name].js": true },
          asked: ["entry-point-build b.ts", "import-statement b.ts"],
          exitCode: 0,
        });
      });
    });

    // The reproduction of https://github.com/oven-sh/bun/pull/39488#discussion_r3815289177
    test("when an onResolve plugin passes on one page of a React app", async () => {
      const reactPage = (name: string) => `export default function Page() { return <p>page:${name}</p>; }`;
      const dir = await tempDirWithBakeDeps("bake-production-plugin-react", {
        "src/index.tsx": `
          const plugin = {
            name: "passes",
            setup(build) {
              build.onResolve({ filter: /pages[\\\\/]index\\.tsx$/ }, () => undefined);
            },
          };
          export default { app: { framework: "react", plugins: [plugin] } };
        `,
        "pages/about.tsx": reactPage("about"),
        "pages/index.tsx": reactPage("index"),
        "pages/zed.tsx": reactPage("zed"),
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "build", "--app", "./src/index.tsx"],
        env: bunEnv,
        cwd: dir,
        stdout: "ignore",
        stderr: "pipe",
      });
      const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
      const read = async (file: string) =>
        (
          await Bun.file(path.join(dir, "dist", file))
            .text()
            .catch(() => "")
        ).match(/page:(\w+)/)?.[1];
      expect(
        {
          "/": await read("index.html"),
          "/about": await read("about/index.html"),
          "/zed": await read("zed/index.html"),
          exitCode,
        },
        stderr,
      ).toEqual({ "/": "index", "/about": "about", "/zed": "zed", exitCode: 0 });
    });

    // The build loads the output of each entry point as a module. It names every file that has none.
    // A route file with "use client" works in the dev server, and is not supported yet in a production build.
    test.concurrent("an entry point that is not bundled to a module of its side is reported", async () => {
      using dir = tempDir("bake-production-no-module", {
        ...appFiles(["a"], {
          framework: serverComponents,
          router: `extensions: "*", clientEntryPoint: "./client.css",`,
        }),
        "client.css": `body { color: blue; }`,
        "routes/styles.css": `body { color: red; }`,
        "routes/client.ts": `"use client";\n${page("page-client")}`,
      });
      const { pages, exitCode, stderr } = await prerender(String(dir));
      const reported = stderr
        .replace(/\\+/g, "/")
        .split(/\r?\n/)
        .filter(line => /^(error|note): /.test(line))
        .sort();
      expect({ reported, pages, dist: existsSync(path.join(String(dir), "dist")), exitCode }, stderr).toEqual({
        reported: [
          `error: "client.css" was not bundled to a JavaScript module, so the client cannot load it`,
          `error: "routes/client.ts" is a client component, so the server cannot load it`,
          `error: "routes/styles.css" was not bundled to a JavaScript module, so the server cannot load it`,
          `note: "use client" is not supported yet in a route file in a production build. Put the client component in a file of its own and import it from the route file.`,
          `note: The build loads each route file, layout and framework entry point as a module.`,
        ],
        pages: {},
        dist: false,
        exitCode: 1,
      });
    });
  });

  test("fails the build for a route file with an invalid name", async () => {
    using dir = tempDir("bake-production-invalid-route", {
      "app.ts": `export default { app: { framework: ${JSON.stringify(minimalFramework)} } };`,
      "routes/index.ts": `export default () => new Response("index");`,
      "routes/[oops.ts": `export default () => new Response("oops");`,
    });

    const { exitCode, stderr } = await Bun.$`${bunExe()} build --app ./app.ts`
      .cwd(String(dir))
      .env(bunEnv)
      .throws(false);
    expect(stderr.toString()).toContain('"routes/[oops.ts" is not a valid route');
    expect(existsSync(path.join(String(dir), "dist"))).toBe(false);
    expect(exitCode).toBe(1);
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

  test("a page can make a WebSocket while it is prerendered", async () => {
    const dir = await tempDirWithBakeDeps("bake-production-websocket", {
      "src/index.tsx": `export default { app: { framework: "react" } };`,
      "pages/index.tsx": `export default function IndexPage() {
  const socket = new WebSocket("ws://127.0.0.1:1/");
  socket.onerror = () => {};
  const state = socket.readyState;
  socket.close();
  return <div>readyState={state}</div>;
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

    const buildProc = await Bun.$`${bunExe()} build --app ./src/index.tsx --outdir ./dist`
      .cwd(dir)
      .env(bunEnv)
      .throws(false);

    const indexHtml = await Bun.file(path.join(dir, "dist", "index.html"))
      .text()
      .catch(() => buildProc.stderr.toString());
    expect(indexHtml).toContain("readyState=<!-- -->" + WebSocket.CONNECTING);
    expect(buildProc.exitCode).toBe(0);
  });

  // A debug build with BUN_JSC_validateExceptionChecks=1 aborts on the first JSC call with an unchecked exception.
  // Windows resolves the import()'s absolute path as a relative path.
  test.skipIf(isWindows)("the module loader hooks check for exceptions", async () => {
    using dir = tempDir("bake-production-exception-checks", {
      "server.ts": `
        export async function prerender(meta) {
          return { files: { "/index.html": await meta.pageModule.default(meta.params) } };
        }
        export function getParams() {
          return [{ slug: "first" }];
        }
      `,
      "extra/banner.mjs": `export const banner = "read from disk";`,
      // The specifier is computed, so the import() is resolved at runtime and loads a file outside the bundle.
      "routes/index.ts": `
        import { join } from "node:path";
        export default async () => (await import(join(import.meta.dir, "../extra/banner.mjs"))).banner;
      `,
      "routes/posts/[slug].ts": `export default params => "post " + params.slug;`,
      "app.ts": `
        const fsr = { root: "routes", style: "nextjs-pages", serverEntryPoint: "./server.ts" };
        export default { app: { framework: { fileSystemRouterTypes: [fsr] } } };
      `,
      "unresolved.ts": `
        import "./does-not-exist";
        export default {};
      `,
    });
    const env = { ...bunEnv, BUN_JSC_validateExceptionChecks: "1" };

    const built = await Bun.$`${bunExe()} build --app ./app.ts`.cwd(String(dir)).env(env).throws(false);
    const read = (file: string) =>
      Bun.file(path.join(String(dir), "dist", file))
        .text()
        .catch(() => built.stderr.toString());
    expect(await read("index.html")).toBe("read from disk");
    expect(await read("posts/first/index.html")).toBe("post first");
    expect(built.exitCode).toBe(0);

    const unresolved = await Bun.$`${bunExe()} build --app ./unresolved.ts`.cwd(String(dir)).env(env).throws(false);
    expect(unresolved.stderr.toString()).toContain("Cannot find module './does-not-exist'");
    expect(unresolved.exitCode).toBe(1);
  });
});
