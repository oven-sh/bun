import { describe, expect, test } from "bun:test";
import { devTest, minimalFramework, tempDirWithBakeDeps } from "../bake-harness";
import { bunEnv, bunExe } from "harness";
import path from "path";

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
    const hasIndexPath = indexHtml.includes("pages/index.tsx") || 
                        indexHtml.includes("pages&#x2F;index.tsx") ||
                        indexHtml.includes("pages\\index.tsx");
    expect(hasIndexPath).toBe(true);
    
    // For the API test page
    expect(apiTestHtml).toContain("test.tsx");
    expect(apiTestHtml).toContain("pages");
    
    const hasApiPath = apiTestHtml.includes("pages/api/test.tsx") || 
                      apiTestHtml.includes("pages&#x2F;api&#x2F;test.tsx") ||
                      apiTestHtml.includes("pages\\api\\test.tsx");
    expect(hasApiPath).toBe(true);
  });
});
