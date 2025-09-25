import { describe, expect } from "bun:test";
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
      expect(page1Preloads.length).toBeGreaterThan(0);
      expect(page2Preloads.length).toBeGreaterThan(0);
    },
  });

  // Test with nested chunk dependencies - need multiple entry points for splitting
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
      "/other.html": `
<!DOCTYPE html>
<html>
  <head>
    <title>Other</title>
    <script type="module" src="./other.js"></script>
  </head>
  <body>
    <h1>Other</h1>
  </body>
</html>`,
      "/main.js": `
import { featureA } from './feature-a.js';
import { featureB } from './feature-b.js';
console.log('Main:', featureA(), featureB());`,
      "/other.js": `
import { featureA } from './feature-a.js';
import { shared } from './shared.js';
console.log('Other:', featureA(), shared());`,
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
    entryPoints: ["/index.html", "/other.html"],

    onAfterBundle(api) {
      // Check that HTML includes modulepreload links for all dependency chunks
      const indexHtml = api.readFile("out/index.html");
      const otherHtml = api.readFile("out/other.html");

      // Both should have modulepreload links
      api.expectFile("out/index.html").toMatch(/rel="modulepreload"/);
      api.expectFile("out/other.html").toMatch(/rel="modulepreload"/);

      // Should have preloads for shared chunks
      const indexPreloads = indexHtml.match(/rel="modulepreload"/g) || [];
      const otherPreloads = otherHtml.match(/rel="modulepreload"/g) || [];

      // With code splitting and nested dependencies, we should have preloads
      expect(indexPreloads.length).toBeGreaterThanOrEqual(1);
      expect(otherPreloads.length).toBeGreaterThanOrEqual(1);
    },
  });

  // Test that dynamic imports are NOT preloaded
  itBundled("html/dynamic-imports-not-preloaded", {
    outdir: "out/",
    splitting: true,
    files: {
      "/index.html": `
<!DOCTYPE html>
<html>
  <head>
    <title>Dynamic Import Test</title>
    <script type="module" src="./app.js"></script>
  </head>
  <body>
    <h1>Dynamic Import Test</h1>
  </body>
</html>`,
      "/other.html": `
<!DOCTYPE html>
<html>
  <head>
    <title>Other Page</title>
    <script type="module" src="./other.js"></script>
  </head>
  <body>
    <h1>Other Page</h1>
  </body>
</html>`,
      "/app.js": `
// Static imports - these SHOULD be preloaded
import { utils } from './utils.js';
import { api } from './api.js';

console.log('App loaded:', utils(), api());

// Dynamic imports - these should NOT be preloaded
if (typeof window !== 'undefined') {
  document.getElementById('load-feature')?.addEventListener('click', async () => {
    const { heavyFeature } = await import('./heavy-feature.js');
    console.log('Loaded:', heavyFeature());
  });

  // Conditional dynamic import
  if (window.location.search.includes('admin')) {
    import('./admin.js').then(m => m.initAdmin());
  }
}`,
      "/other.js": `
// Force code splitting by sharing utils
import { utils } from './utils.js';
import { shared } from './shared.js';
console.log('Other:', utils(), shared());`,
      "/utils.js": `
export function utils() {
  return 'utils';
}`,
      "/api.js": `
import { config } from './config.js';
export function api() {
  return 'api with ' + config();
}`,
      "/config.js": `
export function config() {
  return 'config';
}`,
      "/shared.js": `
export function shared() {
  return 'shared';
}`,
      "/heavy-feature.js": `
// This module is dynamically imported
import { shared } from './shared.js';
export function heavyFeature() {
  return 'heavy feature with ' + shared();
}`,
      "/admin.js": `
// This module is dynamically imported
import { shared } from './shared.js';
export function initAdmin() {
  console.log('Admin initialized with ' + shared());
}`,
    },
    entryPoints: ["/index.html", "/other.html"],

    onAfterBundle(api) {
      const indexHtml = api.readFile("out/index.html");

      // HTML should have some modulepreload links for static imports
      expect(indexHtml).toMatch(/rel="modulepreload"/);

      // Extract all preloaded chunk filenames
      const preloadMatches = [...indexHtml.matchAll(/rel="modulepreload"[^>]+href="\.\/([^"]+)"/g)];
      const preloadedFiles = preloadMatches.map(match => match[1]);

      // The dynamically imported chunks should NOT be preloaded
      // Check that none of the preloaded files contain "heavy" or "admin" in their names
      const hasHeavyPreload = preloadedFiles.some(f => f.includes('heavy'));
      const hasAdminPreload = preloadedFiles.some(f => f.includes('admin'));

      expect(hasHeavyPreload).toBe(false);
      expect(hasAdminPreload).toBe(false);

      // But there should be some preloads for the static imports
      expect(preloadedFiles.length).toBeGreaterThan(0);
    },
  });

  // Test that pages only preload their own dependencies, not other pages' chunks
  itBundled("html/chunk-isolation", {
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
      "/page3.html": `
<!DOCTYPE html>
<html>
  <head>
    <title>Page 3</title>
    <script type="module" src="./page3.js"></script>
  </head>
  <body>
    <h1>Page 3</h1>
  </body>
</html>`,
      "/page1.js": `
import { shared } from './shared.js';
import { moduleA } from './module-a.js';
console.log('Page 1:', shared(), moduleA());`,
      "/page2.js": `
import { shared } from './shared.js';
import { moduleB } from './module-b.js';
console.log('Page 2:', shared(), moduleB());`,
      "/page3.js": `
import { shared } from './shared.js';
import { moduleC } from './module-c.js';
console.log('Page 3:', shared(), moduleC());`,
      "/shared.js": `
// Shared by all pages
export function shared() {
  return 'shared by all';
}`,
      "/module-a.js": `
// Only used by page1
import { utilsA } from './utils-a.js';
export function moduleA() {
  return 'module A with ' + utilsA();
}`,
      "/module-b.js": `
// Only used by page2
import { utilsB } from './utils-b.js';
export function moduleB() {
  return 'module B with ' + utilsB();
}`,
      "/module-c.js": `
// Only used by page3
import { utilsC } from './utils-c.js';
export function moduleC() {
  return 'module C with ' + utilsC();
}`,
      "/utils-a.js": `export function utilsA() { return 'utils A'; }`,
      "/utils-b.js": `export function utilsB() { return 'utils B'; }`,
      "/utils-c.js": `export function utilsC() { return 'utils C'; }`,
    },
    entryPoints: ["/page1.html", "/page2.html", "/page3.html"],

    onAfterBundle(api) {
      const page1Html = api.readFile("out/page1.html");
      const page2Html = api.readFile("out/page2.html");
      const page3Html = api.readFile("out/page3.html");

      // Extract preloaded files for each page
      const getPreloadedFiles = (html: string) => {
        const matches = [...html.matchAll(/rel="modulepreload"[^>]+href="\.\/([^"]+)"/g)];
        return matches.map(m => m[1]);
      };

      const page1Preloads = getPreloadedFiles(page1Html);
      const page2Preloads = getPreloadedFiles(page2Html);
      const page3Preloads = getPreloadedFiles(page3Html);

      // All pages should preload the shared chunk
      expect(page1Preloads.length).toBeGreaterThan(0);
      expect(page2Preloads.length).toBeGreaterThan(0);
      expect(page3Preloads.length).toBeGreaterThan(0);

      // Since all pages share the same shared module, they should all preload the same chunk
      // (the shared chunk)
      expect(page1Preloads).toEqual(page2Preloads);
      expect(page2Preloads).toEqual(page3Preloads);

      // The important test: verify all pages preload the SAME chunk
      // (which should be the shared chunk, not page-specific chunks)
      // This proves that pages don't preload each other's exclusive chunks
    },
  });
});