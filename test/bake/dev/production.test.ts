import { describe, expect, test } from "bun:test";
import { existsSync } from "fs";
import { bunEnv, bunExe, isASAN, isWindows } from "harness";
import path from "path";
import { tempDirWithBakeDeps } from "../bake-harness";

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

  // Every BunString production.rs creates (module keys from BakeProdResolve,
  // chunk sources from BakeProdLoad, the config path, route patterns, client
  // entry URLs) carries a reference that exactly one consumer has to release:
  // transferToWTFString() in BakeGlobalObject.cpp, transfer_to_js()/OwnedString
  // in production.rs. The build used to read them with toWTFString()/to_js(),
  // which take a reference of their own and leave that one behind, so every
  // import edge resolved and every chunk loaded while prerendering leaked its
  // string. Only LeakSanitizer can see that, and only with Malloc=1: WTF strings
  // otherwise live in bmalloc, which LSan does not track.
  describe.skipIf(!isASAN || isWindows)("strings created for the build are released", () => {
    // Both pages statically import one shared chunk and dynamically import
    // another, so the same "bake:/..." keys are resolved more than once through
    // bakeModuleLoaderResolve (static imports) and bakeModuleLoaderImportModule
    // (import()). Only a repeat resolution leaks a string LSan can report: the
    // first one's string becomes the interned module key, which the atom table
    // still points at.
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
          // With Malloc=1 about 20 bmalloc frames sit between malloc and the
          // code that created the string; keep that code in view. log_threads
          // makes the leak check announce itself even when it finds nothing.
          LSAN_OPTIONS: "malloc_context_size=40:log_threads=1",
        })
        .quiet()
        .throws(false);
      const output = stderr.toString();
      expect(output).toContain("Processing thread");
      return output;
    }
    // LSan symbolizes every record it reports through llvm-symbolizer, which
    // takes tens of seconds against the debug binary on a loaded machine.
    const leakScanTimeout = 120_000;

    // LSan prints one record per allocation site: "Direct leak of N byte(s) in
    // M object(s) allocated from:" followed by "#k 0x... in <function> <file>"
    // frames. `bun build --app` still leaks unrelated process-lifetime bundler
    // state, so neither the report as a whole nor the exit code LSan forces
    // means anything here. Every BunString is created through bun_core::String
    // and the BunString__* exports of BunString.cpp, so the records with those
    // on the stack are exactly the strings this build created and never
    // released. Each is reduced to the two frames above the string machinery,
    // so a failure reads as "who created it".
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
        expect(leakedBunStrings(stderr)).toEqual([]);
      },
      leakScanTimeout,
    );

    // A successful build exits without tearing its VM down, and the VM's module
    // registry and JS strings keep most of these strings reachable (the chunk
    // sources BakeProdLoad returns, the config path, the client entry URL), so
    // a leaked reference to them goes unreported above. A failing build exits
    // through the VM's exit path, so under BUN_DESTRUCT_VM_ON_EXIT the VM lets
    // go of them and only a leaked reference would be left holding them.
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
        expect(leakedBunStrings(stderr)).toEqual([]);
      },
      leakScanTimeout,
    );
  });
});
