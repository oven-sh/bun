// import.meta properties are inlined at parse time in Bake
import { expect } from "bun:test";
import { devTest, emptyHtmlFile, minimalFramework } from "../bake-harness";

devTest("import.meta properties are inlined in bake", {
  framework: minimalFramework,
  files: {
    "routes/index.ts": `
export default function (req, meta) {
  return Response.json({
    dir: import.meta.dir,
    dirname: import.meta.dirname,
    file: import.meta.file,
    path: import.meta.path,
    url: import.meta.url,
  });
}
`,
  },
  async test(dev) {
    const response = await dev.fetch("/");
    const json = await response.json();
    
    // Check that all properties are strings, not undefined
    expect(typeof json.dir).toBe("string");
    expect(typeof json.dirname).toBe("string");
    expect(typeof json.file).toBe("string");
    expect(typeof json.path).toBe("string");
    expect(typeof json.url).toBe("string");
    
    // Check that dir and dirname are the same
    expect(json.dir).toBe(json.dirname);
    
    // Check that file is just the filename
    expect(json.file).toBe("index.ts");
    
    // Check that path contains the full path including filename
    expect(json.path).toContain("routes/index.ts");
    expect(json.path).toEndWith("index.ts");
    
    // Check that url is a file:// URL
    expect(json.url).toStartWith("file://");
    expect(json.url).toContain("routes/index.ts");
  },
});

devTest("import.meta properties work with dynamic updates", {
  framework: minimalFramework,
  files: {
    "routes/test.ts": `
export default function (req, meta) {
  const values = [
    "dir: " + import.meta.dir,
    "file: " + import.meta.file,
    "path: " + import.meta.path,
  ];
  return new Response(values.join("\\n"));
}
`,
  },
  async test(dev) {
    const response = await dev.fetch("/test");
    const text = await response.text();
    
    // Verify the values are inlined strings
    expect(text).toContain("dir: ");
    expect(text).toContain("file: test.ts");
    expect(text).toContain("path: ");
    expect(text).toContain("routes/test.ts");
    
    // Update the file with a meaningful change
    await dev.patch("routes/test.ts", {
      find: '"dir: "',
      replace: '"directory: "',
    });
    
    const response2 = await dev.fetch("/test");
    const text2 = await response2.text();
    
    // After the patch, the first line should say "directory:" instead of "dir:"
    expect(text2).toContain("directory: ");
    expect(text2).toContain("file: test.ts");
    expect(text2).toContain("path: ");
    expect(text2).toContain("routes/test.ts");
  },
});

devTest("import.meta properties with nested directories", {
  framework: minimalFramework,
  files: {
    "routes/api/v1/handler.ts": `
export default function (req, meta) {
  return Response.json({
    dir: import.meta.dir,
    file: import.meta.file,
    path: import.meta.path,
    url: import.meta.url,
  });
}
`,
  },
  async test(dev) {
    const response = await dev.fetch("/api/v1/handler");
    const json = await response.json();
    
    expect(json.file).toBe("handler.ts");
    expect(json.path).toContain("routes/api/v1/handler.ts");
    expect(json.dir).toContain("routes/api/v1");
    expect(json.url).toMatch(/^file:\/\/.*routes\/api\/v1\/handler\.ts$/);
  },
});

devTest("import.meta properties in client-side code show runtime values", {
  framework: minimalFramework,
  files: {
    "test_import_meta_inline.js": `
// Test file for import.meta inlining
console.log("import.meta.dir:", import.meta.dir);
console.log("import.meta.dirname:", import.meta.dirname);
console.log("import.meta.file:", import.meta.file);
console.log("import.meta.path:", import.meta.path);
console.log("import.meta.url:", import.meta.url);
`,
    "index.html": emptyHtmlFile({
      scripts: ["test_import_meta_inline.js"],
    }),
  },
  async test(dev) {
    await using c = await dev.client("/");
    
    // In client-side code, import.meta properties show runtime values
    // They are NOT inlined because this is not server-side code
    const messages = [
      await c.getStringMessage(),
      await c.getStringMessage(),
      await c.getStringMessage(),
      await c.getStringMessage(),
      await c.getStringMessage(),
    ];
    
    // Verify all properties are logged
    expect(messages.some(m => m.startsWith("import.meta.dir:"))).toBe(true);
    expect(messages.some(m => m.startsWith("import.meta.dirname:"))).toBe(true);
    expect(messages.some(m => m.startsWith("import.meta.file:"))).toBe(true);
    expect(messages.some(m => m.startsWith("import.meta.path:"))).toBe(true);
    expect(messages.some(m => m.startsWith("import.meta.url:"))).toBe(true);
  },
});