import { expect } from "bun:test";
import { devTest } from "../bake-harness";

devTest("serve static files from public directory", {
  framework: "react",
  files: {
    "pages/index.tsx": `
      export default function Home() {
        return <h1>Hello World</h1>;
      }
    `,
    "public/robots.txt": `
User-agent: *
Disallow: /admin
    `,
    "public/favicon.ico": Buffer.from([0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x10, 0x10]),
    "public/test.json": `{"hello": "world"}`,
  },
  async test(dev) {
    // Test serving robots.txt
    const robotsResponse = await dev.fetch("/robots.txt");
    expect(robotsResponse.status).toBe(200);
    expect(robotsResponse.headers.get("content-type")).toContain("text/plain");
    const robotsText = await robotsResponse.text();
    expect(robotsText).toContain("User-agent: *");
    expect(robotsText).toContain("Disallow: /admin");

    // Test serving favicon.ico (binary file)
    const faviconResponse = await dev.fetch("/favicon.ico");
    expect(faviconResponse.status).toBe(200);
    const faviconBuffer = await faviconResponse.arrayBuffer();
    expect(faviconBuffer.byteLength).toBe(8);

    // Test serving JSON file
    const jsonResponse = await dev.fetch("/test.json");
    expect(jsonResponse.status).toBe(200);
    expect(jsonResponse.headers.get("content-type")).toContain("application/json");
    const jsonData = await jsonResponse.json();
    expect(jsonData.hello).toBe("world");

    // Test that non-existent files return 404
    const notFoundResponse = await dev.fetch("/does-not-exist.txt");
    expect(notFoundResponse.status).toBe(404);

    // Test that the React page still works
    const pageResponse = await dev.fetch("/");
    expect(pageResponse.status).toBe(200);
    const html = await pageResponse.text();
    expect(html).toContain("Hello World");
  },
});

devTest("static files take precedence over routes", {
  framework: "react",
  files: {
    "pages/test.txt.tsx": `
      export default function TestPage() {
        return <div>This is a route</div>;
      }
    `,
    "public/test.txt": `This is a static file`,
  },
  async test(dev) {
    const response = await dev.fetch("/test.txt");
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toBe("This is a static file");
    expect(text).not.toContain("This is a route");
  },
});

devTest("serve nested static files", {
  framework: "react",
  files: {
    "pages/index.tsx": `
      export default function Home() {
        return <h1>Home</h1>;
      }
    `,
    "public/assets/styles.css": `
body { background: red; }
    `,
    "public/images/logo.svg": `
<svg xmlns="http://www.w3.org/2000/svg"><circle r="50"/></svg>
    `,
  },
  async test(dev) {
    // Test nested CSS file
    const cssResponse = await dev.fetch("/assets/styles.css");
    expect(cssResponse.status).toBe(200);
    expect(cssResponse.headers.get("content-type")).toContain("text/css");
    const css = await cssResponse.text();
    expect(css).toContain("background: red");

    // Test nested SVG file
    const svgResponse = await dev.fetch("/images/logo.svg");
    expect(svgResponse.status).toBe(200);
    expect(svgResponse.headers.get("content-type")).toContain("image/svg");
    const svg = await svgResponse.text();
    expect(svg).toContain("<circle");
  },
});
