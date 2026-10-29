import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir, unprivilegedSpawnOptions, type DirectoryTree } from "harness";
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

  test("fails the build when the react framework has no pages directory", async () => {
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

    const { exitCode, stderr } = await Bun.$`${bunExe()} build --app ./app.ts`.cwd(dir).env(bunEnv).throws(false);

    const lines = normalizePath(stderr.toString()).split(/\r?\n/);
    expect(lines.slice(lines.indexOf("Bundling routes") + 1)).toEqual([
      `ENOENT: Cannot read the router root "${normalizePath(path.join(dir, "pages"))}"`,
      `note: The "react" framework reads its pages (.tsx, .jsx) from this directory`,
      "",
    ]);
    expect(existsSync(path.join(dir, "dist"))).toBe(false);
    expect(exitCode).toBe(1);
  });

  // A router type reads its routes from `root`. A build that skips a root has pages missing and exit code 0.
  describe("router roots that cannot be read", () => {
    const router = { root: "routes", style: "nextjs-pages", serverEntryPoint: "./server.ts" };
    // The framework can prerender every page of these fixtures, so only a root stops a build.
    // `config` is the source text of the router types. `setup` runs in the build, before the roots are read.
    const fixture = (config: string, files: DirectoryTree, setup = "") => ({
      "app.ts": `${setup}
        export default { app: { framework: { fileSystemRouterTypes: ${config} } } };
      `,
      "server.ts": `
        export function render(req, meta) {
          return new Response(String(meta.pageModule.default()));
        }
        export async function prerender(meta) {
          return { files: { "/index.html": String(meta.pageModule.default()) } };
        }
      `,
      ...files,
    });
    const roots = (...roots: string[]) => JSON.stringify(roots.map(root => ({ ...router, root })));
    const page = (name: string) => `export default () => ${JSON.stringify(name)};`;
    // The two lines of a report: the error with the absolute root, and the option that names the root.
    const report = (error: string, root: string, index: number) => [
      `${error} the router root "${normalizePath(root)}"`,
      `note: This directory is 'fileSystemRouterTypes[${index}].root'`,
    ];

    async function build(dir: string, spawnOptions: { uid?: number; gid?: number } = {}) {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "build", "--app", "./app.ts"],
        env: bunEnv,
        cwd: dir,
        stdout: "pipe",
        stderr: "pipe",
        ...spawnOptions,
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      const lines = normalizePath(stderr).split(/\r?\n/);
      const dist = path.join(dir, "dist");
      const result = {
        // The build reads the roots after this line. Its reports follow, or the line of the render step.
        afterConfig: lines.slice(lines.indexOf("Bundling routes") + 1).filter(line => line !== ""),
        stdout,
        pages: existsSync(dist) ? Array.from(new Bun.Glob("**/*.html").scanSync(dist), normalizePath).sort() : null,
        exitCode,
      };
      return { result, stderr };
    }
    const failed = (...afterConfig: string[]) => ({ afterConfig, stdout: "", pages: null, exitCode: 1 });

    test.concurrent.each([
      ["that does not exist", "ENOENT", { "routes/index.ts": page("index") }],
      ["that is a file", "ENOTDIR", { "route": "not a directory" }],
    ])("fails the build for a root %s", async (_, errno, files) => {
      using dir = tempDir("bake-production-unreadable-root", fixture(roots("route"), files));
      const { result, stderr } = await build(String(dir));
      expect(result, stderr).toEqual(failed(...report(`${errno}: Cannot read`, path.join(String(dir), "route"), 0)));
    });

    test.concurrent("fails the build when one of two roots does not exist", async () => {
      using dir = tempDir(
        "bake-production-one-root-missing",
        fixture(roots("src/pages", "routes"), { "routes/index.ts": page("index") }),
      );
      const { result, stderr } = await build(String(dir));
      expect(result, stderr).toEqual(failed(...report("ENOENT: Cannot read", path.join(String(dir), "src/pages"), 0)));
    });

    test.concurrent("reports every root and every route before it fails the build", async () => {
      using dir = tempDir(
        "bake-production-unreadable-roots",
        fixture(roots("missing", "routes", "../bake-production-no-root"), {
          "routes/index.ts": page("index"),
          "routes/[oops.ts": page("oops"),
        }),
      );
      const { result, stderr } = await build(String(dir));
      expect(result, stderr).toEqual(
        failed(
          ...report("ENOENT: Cannot read", path.join(String(dir), "missing"), 0),
          ...report("ENOENT: Cannot read", path.join(String(dir), "..", "bake-production-no-root"), 2),
          `error: "routes/[oops.ts" is not a valid route`,
          `               -------`,
          `               Missing "]" to match this route parameter`,
        ),
      );
    });

    // The resolver looks up at most 256 directories that it has not seen, so it has no listing for
    // a root that is 257 directories below the project. Windows: not run, the path is longer than MAX_PATH.
    test.concurrent.skipIf(isWindows)(
      "fails the build for a root that opens, when the resolver cannot load it",
      async () => {
        const root = Array(257).fill("a").join("/");
        using dir = tempDir(
          "bake-production-unloadable-root",
          fixture(roots(root), { [`${root}/index.ts`]: page("index") }),
        );
        const { result, stderr } = await build(String(dir));
        expect(result, stderr).toEqual(
          failed(...report("error: The resolver cannot load", path.join(String(dir), root), 0)),
        );
      },
    );

    test.concurrent("leaves the files of an earlier build as they are", async () => {
      using dir = tempDir(
        "bake-production-unreadable-root-old-dist",
        fixture(roots("route"), { "dist/index.html": "the earlier build" }),
      );
      const { result, stderr } = await build(String(dir));
      expect(result, stderr).toEqual({
        ...failed(...report("ENOENT: Cannot read", path.join(String(dir), "route"), 0)),
        pages: ["index.html"],
      });
      expect(await Bun.file(path.join(String(dir), "dist", "index.html")).text()).toBe("the earlier build");
    });

    // POSIX only: `unprivilegedSpawnOptions` runs the build as a user that the mode bits apply to.
    // Not concurrent: it can change the modes of the directories above the test's own.
    // The build can enter a root of mode 0o311. It finds the entry point below that root, and the
    // resolver then has an empty listing for the root.
    test.skipIf(isWindows).each([
      ["that it has no permission to read", 0o000, "./server.ts"],
      ["that it can enter but cannot read", 0o311, "./routes/_lib/server.ts"],
    ])("fails the build for a root %s", async (_, mode, serverEntryPoint) => {
      using dir = tempDir(
        "bake-production-root-no-permission",
        fixture(JSON.stringify([{ ...router, serverEntryPoint }]), {
          "routes/index.ts": page("index"),
          "routes/_lib/server.ts": `export * from "../../server.ts";`,
        }),
      );
      const root = path.join(String(dir), "routes");
      using unprivileged = unprivilegedSpawnOptions(String(dir));
      chmodSync(root, mode);
      using restoreMode = { [Symbol.dispose]: () => chmodSync(root, 0o755) };
      const { result, stderr } = await build(String(dir), unprivileged);
      expect(result, stderr).toEqual(failed(...report("EACCES: Cannot read", root, 0)));
    });

    // Builds to the end, which uses every core, so it runs alone.
    // The root "empty" exists and has no files. The build has no routes from it, and that is valid.
    test("builds a framework that lists only the roots that exist", async () => {
      const setup = `import { existsSync } from "node:fs";`;
      using dir = tempDir(
        "bake-production-optional-roots",
        fixture(
          `${roots("src/pages", "routes", "empty")}.filter(router => existsSync(router.root))`,
          { "routes/index.ts": page("index"), "empty": {} },
          setup,
        ),
      );
      const { result, stderr } = await build(String(dir));
      expect(result, stderr).toEqual({
        afterConfig: ["Rendering routes"],
        stdout: "done\n",
        pages: ["index.html"],
        exitCode: 0,
      });
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
