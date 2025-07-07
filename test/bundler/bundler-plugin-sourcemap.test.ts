import { describe, test, expect } from "bun:test";
import { itBundled } from "./expectBundled";
import { SourceMapConsumer } from "source-map";

// Direct test to verify implementation works
test("onLoad plugin sourcemap support - basic", async () => {
  const result = await Bun.build({
    entrypoints: [import.meta.dir + "/test-entry.js"],
    outdir: import.meta.dir + "/out",
    sourcemap: "external",
    plugins: [{
      name: "sourcemap-test",
      setup(build) {
        build.onResolve({ filter: /\.transformed\.js$/ }, (args) => {
          return {
            path: args.path,
            namespace: "transformed",
          };
        });
        
        build.onLoad({ filter: /.*/, namespace: "transformed" }, () => {
          const code = `console.log("transformed");`;
          // Create a more complete sourcemap with actual mappings
          const sourcemap = JSON.stringify({
            version: 3,
            sources: ["original.js"],
            sourcesContent: [`console.log("original");`],
            names: ["console", "log"],
            // This mapping says: first segment at (0,0) in generated maps to (0,0) in source 0
            mappings: "AAAA",
          });
          return {
            contents: code,
            loader: "js",
            sourcemap,
          };
        });
      }
    }],
    root: import.meta.dir,
  });
  
  expect(result.success).toBe(true);
  expect(result.outputs.length).toBeGreaterThan(0);
  
  // Check for sourcemap output
  const sourcemapOutput = result.outputs.find(o => o.path.endsWith(".map"));
  expect(sourcemapOutput).toBeDefined();
});

// Test with TypeScript-like transformation
test("onLoad plugin sourcemap support - typescript", async () => {
  const result = await Bun.build({
    entrypoints: [import.meta.dir + "/test-entry.js"],
    outdir: import.meta.dir + "/out2",
    sourcemap: "external", 
    minify: false,
    plugins: [{
      name: "typescript-transform",
      setup(build) {
        build.onResolve({ filter: /\.transformed\.js$/ }, (args) => {
          return {
            path: "virtual.ts",
            namespace: "typescript",
          };
        });
        
        build.onLoad({ filter: /.*/, namespace: "typescript" }, () => {
          // Simulate TypeScript source
          const originalCode = `function greet(name: string): void {
  console.log("Hello, " + name);
}
greet("World");`;
          
          // Transpiled JavaScript
          const transpiledCode = `function greet(name) {
  console.log("Hello, " + name);
}
greet("World");`;
          
          // A proper sourcemap for this transformation
          const sourcemap = JSON.stringify({
            version: 3,
            sources: ["virtual.ts"],
            sourcesContent: [originalCode],
            names: ["greet", "name", "console", "log"],
            // Generated with a tool - maps each token properly
            mappings: "AAAA,SAASA,MAAMC,MACbC,QAAQC,IAAI,WAAYF,MAE1BD,MAAM",
          });
          
          return {
            contents: transpiledCode,
            loader: "js",
            sourcemap,
          };
        });
      }
    }],
    root: import.meta.dir,
  });
  
  expect(result.success).toBe(true);
  
  // Check the generated sourcemap
  const sourcemapOutput = result.outputs.find(o => o.path.endsWith(".map"));
  expect(sourcemapOutput).toBeDefined();
  
  const sourcemapText = await sourcemapOutput!.text();
  const sourcemap = JSON.parse(sourcemapText);
  
  // Should preserve the TypeScript source (with namespace prefix)
  expect(sourcemap.sources[0]).toBe("typescript:virtual.ts");
  expect(sourcemap.sourcesContent).toBeDefined();
  
  // Verify the original TypeScript source is preserved
  expect(sourcemap.sourcesContent[0]).toContain("function greet(name: string): void");
  expect(sourcemap.version).toBe(3);
  expect(sourcemap.mappings).toBeDefined();
  expect(sourcemap.mappings.length).toBeGreaterThan(0);
});

// Test that verifies sourcemap mappings are working
test("onLoad plugin sourcemap remapping", async () => {
  const result = await Bun.build({
    entrypoints: [import.meta.dir + "/test-entry.js"],
    outdir: import.meta.dir + "/out3",
    sourcemap: "external",
    minify: false,
    plugins: [{
      name: "sourcemap-remap-test",
      setup(build) {
        build.onResolve({ filter: /\.transformed\.js$/ }, (args) => {
          return {
            path: "code.ts", 
            namespace: "transform",
          };
        });
        
        build.onLoad({ filter: /.*/, namespace: "transform" }, () => {
          // Original TypeScript-like code
          const originalCode = `// Original comment
function add(a: number, b: number): number {
  return a + b;
}
console.log(add(1, 2));`;

          // Transpiled JavaScript (simulating TypeScript output)
          const transpiledCode = `// Original comment
function add(a, b) {
  return a + b;
}
console.log(add(1, 2));`;
          
          // This sourcemap maps the transpiled code back to the original
          // Line 1 (comment) maps to line 1
          // Line 2 (function) maps to line 2 
          // etc.
          const sourcemap = JSON.stringify({
            version: 3,
            sources: ["code.ts"],
            sourcesContent: [originalCode],
            names: ["add", "a", "b", "console", "log"],
            // Simple 1:1 line mapping
            mappings: "AAAA;AACA;AACA;AACA;AACA",
          });
          
          return {
            contents: transpiledCode,
            loader: "js",
            sourcemap,
          };
        });
      }
    }],
    root: import.meta.dir,
  });
  
  expect(result.success).toBe(true);
  
  const sourcemapOutput = result.outputs.find(o => o.path.endsWith(".map"));
  expect(sourcemapOutput).toBeDefined();
  
  const sourcemapText = await sourcemapOutput!.text();
  const sourcemap = JSON.parse(sourcemapText);
  
  // Use source-map library to verify mappings work
  const consumer = await new SourceMapConsumer(sourcemap);
  
  // Check that we can map from generated position back to original
  // The function "add" should be on line 2 in both files due to our simple mapping
  const originalPos = consumer.originalPositionFor({
    line: 2,
    column: 9, // "add" in "function add"
  });
  
  // Should map back to the TypeScript file
  expect(originalPos.source).toContain("code.ts");
  expect(originalPos.line).toBe(2);
  
  consumer.destroy();
});

describe("bundler", () => {
  describe("onLoad sourcemap", () => {
    itBundled("plugin/SourcemapString", {
      files: {
        "index.js": `import "./test.transformed.js";`,
      },
      plugins(builder) {
        builder.onLoad({ filter: /\.transformed\.js$/ }, () => {
          // Simulate a TypeScript-like transformation
          const originalCode = `function greet(name: string) {
  console.log("Hello, " + name);
}
greet("World");`;

          const transformedCode = `function greet(name) {
  console.log("Hello, " + name);
}
greet("World");`;

          // A simple sourcemap that maps line 1 of transformed to line 1 of original
          const sourcemap = JSON.stringify({
            version: 3,
            sources: ["transformed.ts"],
            sourcesContent: [originalCode],
            names: ["greet", "name", "console", "log"],
            mappings: "AAAA,SAASA,MAAMC,MACbC,QAAQC,IAAI,UAAYD,MAE1BF,MAAM",
          });

          return {
            contents: transformedCode,
            loader: "js",
            sourcemap,
          };
        });
      },
      outdir: "/out",
      sourcemap: "external",
      onAfterBundle(api) {
        // Check that sourcemap was generated
        const sourcemapFile = api.outputs.find(f => f.path.endsWith(".js.map"));
        if (!sourcemapFile) {
          throw new Error("Expected sourcemap file to be generated");
        }
        
        const sourcemap = JSON.parse(sourcemapFile.text);
        if (sourcemap.version !== 3) {
          throw new Error("Expected sourcemap version 3");
        }
        if (!sourcemap.sources.includes("transformed.ts")) {
          throw new Error("Expected sourcemap to contain transformed.ts source");
        }
        if (!sourcemap.sourcesContent?.[0]?.includes("function greet(name: string)")) {
          throw new Error("Expected sourcemap to contain original TypeScript source");
        }
      },
    });

    itBundled("plugin/SourcemapTypedArray", {
      files: {
        "index.js": `import "./test.transformed.js";`,
      },
      plugins(builder) {
        builder.onLoad({ filter: /\.transformed\.js$/ }, () => {
          const code = `console.log("transformed");`;
          const sourcemap = new TextEncoder().encode(JSON.stringify({
            version: 3,
            sources: ["original.js"],
            sourcesContent: [`console.log("original");`],
            names: ["console", "log"],
            mappings: "AAAA",
          }));

          return {
            contents: code,
            loader: "js",
            sourcemap: new Uint8Array(sourcemap),
          };
        });
      },
      sourcemap: "inline",
      onAfterBundle(api) {
        const output = api.outputs[0];
        // Check for inline sourcemap
        if (!output.text.includes("//# sourceMappingURL=data:")) {
          throw new Error("Expected inline sourcemap");
        }
      },
    });

    itBundled("plugin/SourcemapInvalid", {
      files: {
        "index.js": `import "./test.transformed.js";`,
      },
      plugins(builder) {
        builder.onLoad({ filter: /\.transformed\.js$/ }, () => {
          return {
            contents: `console.log("test");`,
            loader: "js",
            sourcemap: "not a valid sourcemap",
          };
        });
      },
      sourcemap: "external",
      bundleWarnings: {
        "/test.transformed.js": ["Failed to parse sourcemap from plugin: InvalidJSON"],
      },
    });

    itBundled("plugin/SourcemapPreservesOriginal", {
      files: {
        "index.js": `import "./user.ts";`,
      },
      plugins(builder) {
        // First transformation: TypeScript -> JavaScript
        builder.onLoad({ filter: /\.ts$/ }, () => {
          const tsCode = `interface User {
  name: string;
  age: number;
}

function greet(user: User): void {
  console.log(\`Hello, \${user.name}! You are \${user.age} years old.\`);
}

const john: User = { name: "John", age: 30 };
greet(john);`;

          const jsCode = `function greet(user) {
  console.log(\`Hello, \${user.name}! You are \${user.age} years old.\`);
}

const john = { name: "John", age: 30 };
greet(john);`;

          // Simplified sourcemap for the transformation
          const sourcemap = JSON.stringify({
            version: 3,
            sources: ["user.ts"],
            sourcesContent: [tsCode],
            names: ["greet", "user", "console", "log", "name", "age", "john"],
            mappings: "AAIA,SAASA,MAAMC,OACbC,QAAQC,IAAI,WAAWF,KAAKG,aAAaH,KAAKI,eAGhD,MAAMC,MAAQ,CAAEF,KAAM,OAAQC,IAAK,IACnCL,MAAMM",
          });

          return {
            contents: jsCode,
            loader: "js",
            sourcemap,
          };
        });
      },
      outdir: "/out",
      sourcemap: "external",
      onAfterBundle(api) {
        const sourcemapFile = api.outputs.find(f => f.path.endsWith(".js.map"));
        if (!sourcemapFile) {
          throw new Error("Expected sourcemap file to be generated");
        }
        
        const sourcemap = JSON.parse(sourcemapFile.text);
        // Should preserve the original TypeScript source
        if (!sourcemap.sources.includes("user.ts")) {
          throw new Error("Expected sourcemap to contain user.ts");
        }
        if (!sourcemap.sourcesContent?.[0]?.includes("interface User")) {
          throw new Error("Expected sourcemap to contain original TypeScript source");
        }
      },
    });
  });
});