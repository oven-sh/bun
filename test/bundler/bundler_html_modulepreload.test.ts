import { describe } from "bun:test";
import { itBundled } from "./expectBundled";

describe("bundler", () => {
  // Test that modulepreload links are added for chunk dependencies
  itBundled("html/modulepreload-chunks", {
    outdir: "out/",
    splitting: true,
    files: {
      "/page1.html": `
<!DOCTYPE html>
<html>
  <head>
    <title>Page 1</title>
    <script type="module" src="./page1.js"></script>
  </head>
  <body>
    <h1>Page 1</h1>
  </body>
</html>`,
      "/page2.html": `
<!DOCTYPE html>
<html>
  <head>
    <title>Page 2</title>
    <script type="module" src="./page2.js"></script>
  </head>
  <body>
    <h1>Page 2</h1>
  </body>
</html>`,
      "/page1.js": `
import { shared } from './shared.js';
import { utils } from './utils.js';
console.log('Page 1:', shared(), utils());
export function page1Init() {
  console.log('Page 1 initialized');
}`,
      "/page2.js": `
import { shared } from './shared.js';
import { utils } from './utils.js';
console.log('Page 2:', shared(), utils());
export function page2Init() {
  console.log('Page 2 initialized');
}`,
      "/shared.js": `
export function shared() {
  return 'shared code';
}`,
      "/utils.js": `
export function utils() {
  return 'utils';
}`,
    },
    entryPoints: ["/page1.html", "/page2.html"],

    onAfterBundle(api) {
      // Check that HTML includes modulepreload links for chunks
      const page1Html = api.readFile("out/page1.html");
      const page2Html = api.readFile("out/page2.html");

      // Both pages should have modulepreload links
      api.expectFile("out/page1.html").toMatch(/rel="modulepreload"/);
      api.expectFile("out/page2.html").toMatch(/rel="modulepreload"/);

      // Extract the chunk names from modulepreload links
      const page1Preloads = page1Html.match(/rel="modulepreload"[^>]+href="([^"]+)"/g) || [];
      const page2Preloads = page2Html.match(/rel="modulepreload"[^>]+href="([^"]+)"/g) || [];

      // Both should preload the shared chunk
      api.expect(page1Preloads.length).toBeGreaterThan(0);
      api.expect(page2Preloads.length).toBeGreaterThan(0);
    },
  });

  // Test with nested chunk dependencies
  itBundled("html/modulepreload-nested-chunks", {
    outdir: "out/",
    splitting: true,
    files: {
      "/index.html": `
<!DOCTYPE html>
<html>
  <head>
    <title>Main</title>
    <script type="module" src="./main.js"></script>
  </head>
  <body>
    <h1>Main</h1>
  </body>
</html>`,
      "/main.js": `
import { featureA } from './feature-a.js';
import { featureB } from './feature-b.js';
console.log('Main:', featureA(), featureB());`,
      "/feature-a.js": `
import { shared } from './shared.js';
export function featureA() {
  return 'Feature A: ' + shared();
}`,
      "/feature-b.js": `
import { shared } from './shared.js';
export function featureB() {
  return 'Feature B: ' + shared();
}`,
      "/shared.js": `
import { deepDep } from './deep-dep.js';
export function shared() {
  return 'shared: ' + deepDep();
}`,
      "/deep-dep.js": `
export function deepDep() {
  return 'deep dependency';
}`,
    },
    entryPoints: ["/index.html"],

    onAfterBundle(api) {
      // Check that HTML includes modulepreload links for all dependency chunks
      api.expectFile("out/index.html").toMatch(/rel="modulepreload"/);

      // Should have preloads for all chunks that the main chunk depends on
      const htmlContent = api.readFile("out/index.html");
      const preloadMatches = htmlContent.match(/rel="modulepreload"/g) || [];

      // With nested dependencies, we should have multiple preloads
      api.expect(preloadMatches.length).toBeGreaterThanOrEqual(1);
    },
  });
});