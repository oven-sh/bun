// import.meta properties are inlined at parse time in Bake
import { expect } from "bun:test";
import { devTest, emptyHtmlFile, minimalFramework } from "../bake-harness";

const platformPath = (path: string) => {
  if (process.platform === "win32") {
    return path.replace(/\//g, "\\");
  }
  return path;
};

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
    expect(json.path).toContain(platformPath("routes/index.ts"));
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
    expect(text).toContain(platformPath("routes/test.ts"));

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
    expect(text2).toContain(platformPath("routes/test.ts"));
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
    expect(json.path).toContain(platformPath("routes/api/v1/handler.ts"));
    expect(json.dir).toContain(platformPath("routes/api/v1"));
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

devTest("import.meta properties in catch-all routes", {
  framework: minimalFramework,
  files: {
    "routes/blog/[...slug].ts": `
export default function BlogPost(req, meta) {
  const url = new URL(req.url);
  const slug = url.pathname.replace('/blog/', '').split('/').filter(Boolean);
  
  const metaInfo = {
    file: import.meta.file,
    dir: import.meta.dir,
    path: import.meta.path,
    url: import.meta.url,
    dirname: import.meta.dirname,
  };
  
  return Response.json({
    slug: slug,
    title: slug.map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' '),
    meta: metaInfo,
    content: "This is a blog post at: " + slug.join('/'),
  });
}
`,
  },
  async test(dev) {
    // Test single segment
    const post1 = await dev.fetch("/blog/hello");
    const json1 = await post1.json();

    expect(json1.slug).toEqual(["hello"]);
    expect(json1.title).toBe("Hello");
    expect(json1.content).toBe("This is a blog post at: hello");

    // Verify import.meta properties are inlined
    expect(json1.meta.file).toBe("[...slug].ts");
    expect(json1.meta.dir).toContain(platformPath("routes/blog"));
    expect(json1.meta.dirname).toBe(json1.meta.dir);
    expect(json1.meta.path).toContain(platformPath("routes/blog/[...slug].ts"));
    // url encoded!
    expect(json1.meta.url).toMatch(/^file:\/\/.*routes\/blog\/%5B\.\.\.slug%5D\.ts$/);

    // Test multiple segments
    const post2 = await dev.fetch("/blog/2024/tech/bun-framework");
    const json2 = await post2.json();

    expect(json2.slug).toEqual(["2024", "tech", "bun-framework"]);
    expect(json2.title).toBe("2024 Tech Bun-framework");
    expect(json2.content).toBe("This is a blog post at: 2024/tech/bun-framework");

    // Meta properties should be the same regardless of the route
    expect(json2.meta.file).toBe("[...slug].ts");
    expect(json2.meta.path).toContain(platformPath("routes/blog/[...slug].ts"));

    // Test empty slug (just /blog/)
    const post3 = await dev.fetch("/blog/");
    const json3 = await post3.json();

    expect(json3.slug).toEqual([]);
    expect(json3.title).toBe("");
    expect(json3.content).toBe("This is a blog post at: ");
  },
});

devTest("import.meta properties in nested catch-all routes with static siblings", {
  framework: minimalFramework,
  files: {
    "routes/docs/[...path].ts": `
export default function DocsPage(req, meta) {
  const url = new URL(req.url);
  const path = url.pathname.replace('/docs/', '').split('/').filter(Boolean);
  
  return Response.json({
    type: "catch-all",
    path: path,
    file: import.meta.file,
    dir: import.meta.dir,
    fullPath: import.meta.path,
  });
}
`,
    "routes/docs/api.ts": `
export default function ApiDocs(req, meta) {
  return Response.json({
    type: "static",
    page: "API Documentation",
    file: import.meta.file,
    dir: import.meta.dir,
    fullPath: import.meta.path,
  });
}
`,
    "routes/docs/getting-started.ts": `
export default function GettingStarted(req, meta) {
  return Response.json({
    type: "static",
    page: "Getting Started",
    file: import.meta.file,
    dir: import.meta.dir,
    fullPath: import.meta.path,
  });
}
`,
  },
  async test(dev) {
    // Test static route - should match api.ts, not catch-all
    const apiResponse = await dev.fetch("/docs/api");
    const apiJson = await apiResponse.json();

    expect(apiJson.type).toBe("static");
    expect(apiJson.page).toBe("API Documentation");
    expect(apiJson.file).toBe("api.ts");
    expect(apiJson.dir).toContain(platformPath("routes/docs"));
    expect(apiJson.fullPath).toContain(platformPath("routes/docs/api.ts"));

    // Test another static route
    const startResponse = await dev.fetch("/docs/getting-started");
    const startJson = await startResponse.json();

    expect(startJson.type).toBe("static");
    expect(startJson.page).toBe("Getting Started");
    expect(startJson.file).toBe("getting-started.ts");
    expect(startJson.fullPath).toContain(platformPath("routes/docs/getting-started.ts"));

    // Test catch-all route - should match for non-static paths
    const guideResponse = await dev.fetch("/docs/guides/advanced/optimization");
    expect(guideResponse.status).toBe(200);
    const guideJson = await guideResponse.json();

    expect(guideJson.type).toBe("catch-all");
    expect(guideJson.path).toEqual(["guides", "advanced", "optimization"]);
    expect(guideJson.file).toBe("[...path].ts");
    expect(guideJson.dir).toContain(platformPath("routes/docs"));
    expect(guideJson.fullPath).toContain(platformPath("routes/docs/[...path].ts"));

    // Update catch-all route and verify import.meta values remain inlined
    await dev.patch("routes/docs/[...path].ts", {
      find: '"catch-all"',
      replace: '"dynamic-catch-all"',
    });

    const updatedResponse = await dev.fetch("/docs/tutorials/intro");
    const updatedJson = await updatedResponse.json();

    expect(updatedJson.type).toBe("dynamic-catch-all");
    expect(updatedJson.file).toBe("[...path].ts");
    expect(updatedJson.fullPath).toContain(platformPath("routes/docs/[...path].ts"));
  },
});
