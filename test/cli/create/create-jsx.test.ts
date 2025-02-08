import "bun";
import { expect, test, describe } from "bun:test";
import { tempDirWithFiles, bunExe, bunEnv } from "harness";
import { cp, readdir } from "fs/promises";
import path from "path";
import puppeteer from "puppeteer";
import type { Subprocess } from "bun";
import * as vm from "vm";
const env = {
  ...bunEnv,
};

async function getServerUrl(process: Subprocess<any, "pipe", any>, all = { text: "" }) {
  // Read the port number from stdout
  const decoder = new TextDecoder();
  let serverUrl = "";
  all.text = "";

  const reader = process.stdout.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const textChunk = decoder.decode(value, { stream: true });
    all.text += textChunk;
    console.log(textChunk);

    if (all.text.includes("http://")) {
      serverUrl = all.text.trim();
      serverUrl = serverUrl.slice(serverUrl.indexOf("http://"));

      serverUrl = serverUrl.slice(0, serverUrl.indexOf("\n"));
      if (URL.canParse(serverUrl)) {
        break;
      }

      serverUrl = serverUrl.slice(0, serverUrl.indexOf("/n"));
      serverUrl = serverUrl.slice(0, serverUrl.lastIndexOf("/"));
      serverUrl = serverUrl.trim();

      if (URL.canParse(serverUrl)) {
        break;
      }
    }
  }
  reader.releaseLock();

  if (!serverUrl) {
    throw new Error("Could not find server URL in stdout");
  }

  return serverUrl;
}

async function checkBuildOutput(dir: string) {
  const distDir = path.join(dir, "dist");
  const files = await readdir(distDir);
  expect(files.some(f => f.endsWith(".js"))).toBe(true);
  expect(files.some(f => f.endsWith(".html"))).toBe(true);
  expect(files.some(f => f.endsWith(".css"))).toBe(true);
}

describe("react spa (no tailwind)", async () => {
  const dir = tempDirWithFiles("react-spa-no-tailwind", {
    "README.md": "Hello, world!",
  });

  await cp(path.join(__dirname, "react-spa-no-tailwind"), dir, {
    recursive: true,
    force: true,
  });

  test("dev server", async () => {
    await using process = Bun.spawn([bunExe(), "create", "./index.jsx"], {
      cwd: dir,
      env: env,
      stdout: "pipe",
      stdin: "ignore",
    });
    const all = { text: "" };
    const serverUrl = await getServerUrl(process, all);
    console.log(serverUrl);

    const browser = await puppeteer.launch({
      headless: true,
    });
    try {
      const page = await browser.newPage();
      await page.goto(serverUrl, { waitUntil: "networkidle0" });

      const content = await page.evaluate(() => document.documentElement.innerHTML);

      expect(normalizeHTML(content)).toMatchInlineSnapshot();

      expect(
        all.text
          .replace(/v\d+\.\d+\.\d+(?:\s*\([a-f0-9]+\))?/g, "v*.*.*") // Handle version with git hash
          .replace(/\[\d+\.?\d*m?s\]/g, "[*ms]")
          .replace(/@\d+\.\d+\.\d+/g, "@*.*.*")
          .replace(/\d+\.\d+\s*ms/g, "*.** ms")
          .replace(/^\s+/gm, "") // Remove leading spaces
          .replace(/installed react(-dom)?@\d+\.\d+\.\d+/g, "installed react$1@*.*.*") // Handle react versions
          .trim(),
      ).toMatchInlineSnapshot(`
"create  index.build.ts     build
create  index.css          css
create  index.html         html
create  index.client.tsx   bun
create  package.json       npm
📦 Auto-installing 3 detected dependencies
$ bun --only-missing install classnames react-dom@19 react@19
bun add v*.*.*
installed classnames@*.*.*
installed react-dom@*.*.*
installed react@*.*.*
4 packages installed [*ms]
--------------------------------
✨ React project configured
Development - frontend dev server with hot reload
bun dev
Production - build optimized assets
bun run build
Happy bunning! 🐇
Bun v*.*.* dev server ready in *.** ms
url: ${serverUrl}/"
`);
    } finally {
      await browser.close();
      process.kill();
    }
  });

  test("build", async () => {
    const process = Bun.spawn([bunExe(), "run", "build"], {
      cwd: dir,
      env: env,
      stdout: "pipe",
    });

    await process.exited;
    await checkBuildOutput(dir);
  });
});

describe("react spa (tailwind)", async () => {
  const dir = tempDirWithFiles("react-spa-tailwind", {
    "index.tsx": await Bun.file(path.join(__dirname, "tailwind.tsx")).text(),
  });

  test.only("dev server", async () => {
    const process = Bun.spawn([bunExe(), "create", "./index.tsx"], {
      cwd: dir,
      env: env,
      stdout: "pipe",
      stdin: "ignore",
    });
    const all = { text: "" };
    const serverUrl = await getServerUrl(process, all);
    console.log(serverUrl);

    const browser = await puppeteer.launch({
      headless: true,
    });
    try {
      const page = await browser.newPage();
      await page.goto(serverUrl, { waitUntil: "networkidle0" });

      // Check that React root exists and has Tailwind classes
      const root = await page.$("#root");
      expect(root).toBeTruthy();

      const content = await page.evaluate(() => document.documentElement.outerHTML);
      expect(normalizeHTML(content)).toMatchInlineSnapshot(`
        "<html><head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>index | Powered by Bun</title>
        <link rel="icon" type="image/x-icon" href="https://bun.sh/favicon.ico">
        <link rel="stylesheet" crossorigin="" href="/chunk-[HASH].css"><script type="module" crossorigin="" src="/chunk-[HASH].js"></script></head>
        <body>
        <div id="root"><div class="min-h-screen bg-gradient-to-b from-gray-900 to-black text-white"><div class="max-w-6xl mx-auto px-4 py-20"><div class="text-center mb-16"><h1 class="text-6xl font-bold mb-6"><span class="text-purple-400">bun create</span> for React</h1><p class="text-xl text-gray-300 mb-8">Start a React dev server instantly from a single component file</p><div class="bg-gray-800 p-4 rounded-lg flex items-center justify-between max-w-lg mx-auto mb-8"><code class="text-purple-400">bun create ./MyComponent.tsx</code><button class="bg-purple-600 hover:bg-purple-700 px-4 py-2 rounded transition">Copy</button></div></div><div class="grid md:grid-cols-3 gap-8 mb-20"><div class="bg-gray-800 p-6 rounded-lg"><h3 class="text-xl font-semibold mb-4">Zero Config</h3><p class="text-gray-300">Just write your React component and run. No setup needed.</p></div><div class="bg-gray-800 p-6 rounded-lg"><h3 class="text-xl font-semibold mb-4">Auto Dependencies</h3><p class="text-gray-300">Automatically detects and installs required npm packages.</p></div><div class="bg-gray-800 p-6 rounded-lg"><h3 class="text-xl font-semibold mb-4">Tool Detection</h3><p class="text-gray-300">Recognizes Tailwind, animations, and UI libraries automatically.</p></div></div><div class="bg-gray-800 rounded-lg p-8 mb-20"><h2 class="text-3xl font-bold mb-6">How it Works</h2><div class="space-y-4"><div class="flex items-start gap-4"><div class="bg-purple-600 rounded-full p-2 mt-1">1</div><div><h3 class="font-semibold mb-2">Create Component</h3><p class="text-gray-300">Write your React component in a .tsx file</p></div></div><div class="flex items-start gap-4"><div class="bg-purple-600 rounded-full p-2 mt-1">2</div><div><h3 class="font-semibold mb-2">Run Command</h3><p class="text-gray-300">Execute bun create with your file path</p></div></div><div class="flex items-start gap-4"><div class="bg-purple-600 rounded-full p-2 mt-1">3</div><div><h3 class="font-semibold mb-2">Start Developing</h3><p class="text-gray-300">Dev server starts instantly with hot reload</p></div></div></div></div><div class="text-center"><h2 class="text-3xl font-bold mb-6">Ready to Try?</h2><div class="space-x-4"><a href="https://bun.sh/docs" class="inline-block bg-purple-600 hover:bg-purple-700 px-6 py-3 rounded-lg transition">Read Docs</a><a href="https://github.com/oven-sh/bun" class="inline-block bg-gray-700 hover:bg-gray-600 px-6 py-3 rounded-lg transition">GitHub →</a></div></div></div></div></div>
        </body></html>"
      `);

      expect(
        all.text
          .replace(/v\d+\.\d+\.\d+(?:\s*\([a-f0-9]+\))?/g, "v*.*.*")
          .replace(/\[\d+\.?\d*m?s\]/g, "[*ms]")
          .replace(/@\d+\.\d+\.\d+/g, "@*.*.*")
          .replace(/\d+\.\d+\s*ms/g, "*.** ms")
          .replace(/^\s+/gm, "")
          .replace(/installed (react(-dom)?|tailwindcss)@\d+\.\d+\.\d+/g, "installed $1@*.*.*")
          .trim(),
      ).toMatchInlineSnapshot(`
        "create  index.build.ts     build
        create  index.css          css
        create  index.html         html
        create  index.client.tsx   bun
        create  bunfig.toml        bun
        create  package.json       npm
        📦 Auto-installing 4 detected dependencies
        $ bun --only-missing install tailwindcss bun-plugin-tailwind react-dom@19 react@19
        bun add v*.*.*
        installed tailwindcss@*.*.*
        installed bun-plugin-tailwind@*.*.*
        installed react-dom@*.*.*
        installed react@*.*.*
        7 packages installed [*ms]
        --------------------------------
        ✨ React + Tailwind project configured
        Development - frontend dev server with hot reload
        bun dev
        Production - build optimized assets
        bun run build
        Happy bunning! 🐇
        Bun v*.*.* dev server ready in *.** ms
        url: http://localhost:3002/"
      `);
    } finally {
      await browser.close();
      process.kill();
    }
  });

  test("build", async () => {
    const process = Bun.spawn([bunExe(), "run", "build"], {
      cwd: dir,
      env: env,
      stdout: "pipe",
    });

    await process.exited;
    await checkBuildOutput(dir);
  });
});

test("shadcn/ui", async () => {
  const dir = tempDirWithFiles("shadcn-ui", {
    "index.tsx": await Bun.file(path.join(__dirname, "shadcn.tsx")).text(),
  });

  test("dev server", async () => {
    const process = Bun.spawn([bunExe(), "create", "./index.tsx"], {
      cwd: dir,
      env: env,
      stdout: "pipe",
      stdin: "ignore",
    });
    const all = { text: "" };
    const serverUrl = await getServerUrl(process, all);
    console.log(serverUrl);

    const browser = await puppeteer.launch({
      headless: true,
    });
    try {
      const page = await browser.newPage();
      await page.goto(serverUrl, { waitUntil: "networkidle0" });

      // Check that React root exists and has Shadcn components
      const root = await page.$("#root");
      expect(root).toBeTruthy();

      const content = await page.evaluate(() => document.documentElement.innerHTML);
      expect(content).toContain("shadcn"); // Basic check for Shadcn classes

      // Check for components.json
      const componentsJson = await Bun.file(path.join(dir, "components.json")).exists();
      expect(componentsJson).toBe(true);

      expect(
        all.text
          .replace(/v\d+\.\d+\.\d+(?:\s*\([a-f0-9]+\))?/g, "v*.*.*")
          .replace(/\[\d+\.?\d*m?s\]/g, "[*ms]")
          .replace(/@\d+\.\d+\.\d+/g, "@*.*.*")
          .replace(/\d+\.\d+\s*ms/g, "*.** ms")
          .replace(/^\s+/gm, "")
          .replace(
            /installed (react(-dom)?|@radix-ui\/.*|tailwindcss|class-variance-authority|clsx|lucide-react|tailwind-merge)@\d+\.\d+\.\d+/g,
            "installed $1@*.*.*",
          )
          .trim(),
      ).toMatchInlineSnapshot();
    } finally {
      await browser.close();
      process.kill();
    }
  });

  test("build", async () => {
    const process = Bun.spawn([bunExe(), "run", "build"], {
      cwd: dir,
      env: env,
      stdout: "pipe",
    });

    await process.exited;
    await checkBuildOutput(dir);
  });
});

function normalizeHTML(html: string) {
  return html
    .split("\n")
    .map(line => {
      // First trim the line
      const trimmed = line.trim();
      if (!trimmed) return "";

      // Replace chunk hashes in stylesheet and script tags
      return trimmed.replace(
        /<(link rel="stylesheet" crossorigin="" href|script type="module" crossorigin="" src)="\/chunk-[a-zA-Z0-9]+\.(css|js)("><\/script>|">)/g,
        (_, tagStart, ext) => {
          if (ext === "css") {
            return `<${tagStart}="/chunk-[HASH].css">`;
          }
          return `<${tagStart}="/chunk-[HASH].js"></script>`;
        },
      );
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}
