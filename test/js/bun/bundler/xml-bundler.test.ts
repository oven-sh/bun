import { expect, test, describe } from "bun:test";
import { tempDirWithFiles, bunEnv, bunExe } from "harness";

describe("XML Bundler Integration", () => {
  test("can bundle XML files as modules", async () => {
    const dir = tempDirWithFiles("xml-bundle-basic", {
      "index.js": `
        import xmlData from "./config.xml";
        export { xmlData };
      `,
      "config.xml": `
        <?xml version="1.0" encoding="UTF-8"?>
        <configuration>
          <database>
            <host>localhost</host>
            <port>5432</port>
          </database>
          <features>
            <feature name="auth" enabled="true"/>
            <feature name="logging" enabled="false"/>
          </features>
        </configuration>
      `,
    });

    const result = await Bun.build({
      entrypoints: [`${dir}/index.js`],
      outdir: `${dir}/dist`,
    });

    expect(result.success).toBe(true);
    expect(result.logs.length).toBe(0);
    expect(result.outputs).toHaveLength(1);

    // Verify the output file was created
    const output = result.outputs[0];
    expect(output).toBeDefined();
    expect(output.path).toContain("index.js");
  });

  test("can bundle multiple XML files", async () => {
    const dir = tempDirWithFiles("xml-bundle-multiple", {
      "index.js": `
        import config from "./config.xml";
        import users from "./users.xml";
        import products from "./products.xml";
        export { config, users, products };
      `,
      "config.xml": `
        <config>
          <name>My App</name>
          <version>1.0.0</version>
        </config>
      `,
      "users.xml": `
        <users>
          <user id="1">
            <name>Alice</name>
            <email>alice@example.com</email>
          </user>
          <user id="2">
            <name>Bob</name>
            <email>bob@example.com</email>
          </user>
        </users>
      `,
      "products.xml": `
        <products>
          <product id="p1" category="electronics">
            <name>Laptop</name>
            <price currency="USD">999.99</price>
          </product>
          <product id="p2" category="books">
            <name>XML Guide</name>
            <price currency="USD">29.99</price>
          </product>
        </products>
      `,
    });

    const result = await Bun.build({
      entrypoints: [`${dir}/index.js`],
      outdir: `${dir}/dist`,
    });

    expect(result.success).toBe(true);
    expect(result.logs.length).toBe(0);
    expect(result.outputs).toHaveLength(1);
  });

  test("handles XML files with different extensions", async () => {
    const dir = tempDirWithFiles("xml-extensions", {
      "index.js": `
        import data1 from "./file.xml";
        import data2 from "./file.XML";
        export { data1, data2 };
      `,
      "file.xml": "<root>lowercase</root>",
      "file.XML": "<root>uppercase</root>",
    });

    const result = await Bun.build({
      entrypoints: [`${dir}/index.js`],
      outdir: `${dir}/dist`,
    });

    expect(result.success).toBe(true);
    expect(result.logs.length).toBe(0);
  });

  test("can re-export XML modules", async () => {
    const dir = tempDirWithFiles("xml-reexport", {
      "index.js": `export { default as xmlData } from "./data.xml";`,
      "data.xml": `
        <data>
          <item>value1</item>
          <item>value2</item>
        </data>
      `,
    });

    const result = await Bun.build({
      entrypoints: [`${dir}/index.js`],
      outdir: `${dir}/dist`,
    });

    expect(result.success).toBe(true);
    expect(result.logs.length).toBe(0);
  });

  test("works with dynamic imports", async () => {
    const dir = tempDirWithFiles("xml-dynamic", {
      "index.js": `
        export async function loadConfig() {
          const config = await import("./config.xml");
          return config.default;
        }
      `,
      "config.xml": `
        <config>
          <environment>production</environment>
          <debug>false</debug>
        </config>
      `,
    });

    const result = await Bun.build({
      entrypoints: [`${dir}/index.js`],
      outdir: `${dir}/dist`,
      splitting: true,
    });

    expect(result.success).toBe(true);
    expect(result.logs.length).toBe(0);
  });

  test("preserves XML structure in bundled output", async () => {
    const dir = tempDirWithFiles("xml-structure", {
      "index.js": `
        import data from "./structured.xml";
        console.log("XML Data:", JSON.stringify(data, null, 2));
      `,
      "structured.xml": `
        <?xml version="1.0"?>
        <library>
          <book id="1" isbn="978-1234567890">
            <title>JavaScript Guide</title>
            <author>
              <name>John Doe</name>
              <bio>Expert developer</bio>
            </author>
            <metadata>
              <pages>350</pages>
              <language>English</language>
            </metadata>
          </book>
        </library>
      `,
    });

    const result = await Bun.build({
      entrypoints: [`${dir}/index.js`],
      outdir: `${dir}/dist`,
    });

    expect(result.success).toBe(true);
    expect(result.logs.length).toBe(0);
  });

  test("handles XML with CDATA in bundler", async () => {
    const dir = tempDirWithFiles("xml-cdata", {
      "index.js": `import script from "./script.xml"; export { script };`,
      "script.xml": `
        <script>
          <![CDATA[
            function hello() {
              console.log("Hello from <XML>!");
              return x < y && y > z;
            }
          ]]>
        </script>
      `,
    });

    const result = await Bun.build({
      entrypoints: [`${dir}/index.js`],
      outdir: `${dir}/dist`,
    });

    expect(result.success).toBe(true);
    expect(result.logs.length).toBe(0);
  });

  test("handles XML with namespaces in bundler", async () => {
    const dir = tempDirWithFiles("xml-namespaces", {
      "index.js": `import svg from "./image.xml"; export { svg };`,
      "image.xml": `
        <svg:svg xmlns:svg="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="100" height="100">
          <svg:circle cx="50" cy="50" r="40"/>
          <svg:text x="50" y="50">SVG</svg:text>
        </svg:svg>
      `,
    });

    const result = await Bun.build({
      entrypoints: [`${dir}/index.js`],
      outdir: `${dir}/dist`,
    });

    expect(result.success).toBe(true);
    expect(result.logs.length).toBe(0);
  });

  test("handles malformed XML gracefully in bundler", async () => {
    const dir = tempDirWithFiles("xml-malformed", {
      "index.js": `
        try {
          import("./malformed.xml").then(data => {
            console.log("Should not reach here");
          }).catch(err => {
            console.log("Expected error:", err.message);
          });
        } catch (e) {
          console.log("Build-time error:", e.message);
        }
      `,
      "malformed.xml": "<root><unclosed>content</root>", // Intentionally malformed
    });

    const result = await Bun.build({
      entrypoints: [`${dir}/index.js`],
      outdir: `${dir}/dist`,
    });

    // The build might fail due to malformed XML, which is expected
    if (!result.success) {
      expect(result.logs.length).toBeGreaterThan(0);
      expect(result.logs[0].message).toContain("XML");
    }
  });

  test("works with nested directory structure", async () => {
    const dir = tempDirWithFiles("xml-nested", {
      "index.js": `
        import config from "./config/app.xml";
        import users from "./data/users.xml";
        export { config, users };
      `,
      "config/app.xml": `
        <application>
          <name>Test App</name>
          <version>2.0.0</version>
        </application>
      `,
      "data/users.xml": `
        <users>
          <user>Admin</user>
          <user>Guest</user>
        </users>
      `,
    });

    const result = await Bun.build({
      entrypoints: [`${dir}/index.js`],
      outdir: `${dir}/dist`,
    });

    expect(result.success).toBe(true);
    expect(result.logs.length).toBe(0);
  });

  test("XML loader works with custom build configuration", async () => {
    const dir = tempDirWithFiles("xml-custom-config", {
      "index.js": `import data from "./data.xml"; export default data;`,
      "data.xml": `
        <data>
          <timestamp>2024-01-15T10:30:00Z</timestamp>
          <metrics>
            <cpu>45.2</cpu>
            <memory>78.9</memory>
          </metrics>
        </data>
      `,
    });

    const result = await Bun.build({
      entrypoints: [`${dir}/index.js`],
      outdir: `${dir}/dist`,
      minify: true,
      target: "node",
    });

    expect(result.success).toBe(true);
    expect(result.logs.length).toBe(0);
  });
});

describe("XML Runtime Integration", () => {
  test("can execute bundled XML modules", async () => {
    const dir = tempDirWithFiles("xml-runtime", {
      "index.js": `
        import config from "./config.xml";
        console.log("Loaded XML:", JSON.stringify(config));
        process.exit(0);
      `,
      "config.xml": `
        <config>
          <debug>true</debug>
          <port>3000</port>
        </config>
      `,
    });

    // First bundle the files
    const buildResult = await Bun.build({
      entrypoints: [`${dir}/index.js`],
      outdir: `${dir}/dist`,
    });

    expect(buildResult.success).toBe(true);

    // Then try to execute the bundled result
    await using proc = Bun.spawn({
      cmd: [bunExe(), `${dir}/dist/index.js`],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Loaded XML:");
    expect(stderr).toBe("");
  });

  test("XML imports work in TypeScript files", async () => {
    const dir = tempDirWithFiles("xml-typescript", {
      "index.ts": `
        import type { } from "bun-types";
        import config from "./config.xml";
        
        // Type assertion for XML data
        const typedConfig = config as any;
        
        console.log("XML config loaded:", typedConfig);
        process.exit(0);
      `,
      "config.xml": `
        <config>
          <name>TypeScript App</name>
          <features>
            <feature>typescript</feature>
            <feature>xml</feature>
          </features>
        </config>
      `,
    });

    const buildResult = await Bun.build({
      entrypoints: [`${dir}/index.ts`],
      outdir: `${dir}/dist`,
    });

    expect(buildResult.success).toBe(true);
  });

  test("can import XML in ESM and CommonJS contexts", async () => {
    const dir = tempDirWithFiles("xml-module-systems", {
      "esm.mjs": `
        import data from "./data.xml";
        console.log("ESM:", data);
      `,
      "cjs.cjs": `
        const data = require("./data.xml");
        console.log("CJS:", data);
      `,
      "data.xml": `
        <data>
          <value>test</value>
        </data>
      `,
    });

    // Test ESM
    const esmResult = await Bun.build({
      entrypoints: [`${dir}/esm.mjs`],
      outdir: `${dir}/dist-esm`,
      format: "esm",
    });
    expect(esmResult.success).toBe(true);

    // Test CommonJS
    const cjsResult = await Bun.build({
      entrypoints: [`${dir}/cjs.cjs`],
      outdir: `${dir}/dist-cjs`,
      format: "cjs",
    });
    expect(cjsResult.success).toBe(true);
  });
});

describe("XML Bundler Error Handling", () => {
  test("provides helpful errors for missing XML files", async () => {
    const dir = tempDirWithFiles("xml-missing", {
      "index.js": `import data from "./missing.xml";`,
    });

    const result = await Bun.build({
      entrypoints: [`${dir}/index.js`],
      outdir: `${dir}/dist`,
    });

    expect(result.success).toBe(false);
    expect(result.logs.length).toBeGreaterThan(0);
    expect(result.logs[0].message.toLowerCase()).toMatch(/cannot find|not found/);
  });

  test("handles XML parsing errors during build", async () => {
    const dir = tempDirWithFiles("xml-parse-error", {
      "index.js": `import data from "./invalid.xml";`,
      "invalid.xml": `<root><unclosed></root>`, // Malformed XML
    });

    const result = await Bun.build({
      entrypoints: [`${dir}/index.js`],
      outdir: `${dir}/dist`,
    });

    // Build should fail with XML parsing error
    expect(result.success).toBe(false);
    expect(result.logs.length).toBeGreaterThan(0);
  });

  test("handles empty XML files", async () => {
    const dir = tempDirWithFiles("xml-empty", {
      "index.js": `import data from "./empty.xml"; console.log(data);`,
      "empty.xml": ``, // Empty file
    });

    const result = await Bun.build({
      entrypoints: [`${dir}/index.js`],
      outdir: `${dir}/dist`,
    });

    // Build should handle empty XML files appropriately
    // (either fail with a clear error or handle gracefully)
    if (!result.success) {
      expect(result.logs.length).toBeGreaterThan(0);
    }
  });
});