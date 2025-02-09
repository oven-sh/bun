import "bun";
import { expect, test, describe } from "bun:test";
import { tempDirWithFiles as tempDir, bunExe, bunEnv } from "harness";
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

describe.each(["true", "false"])("development: %s", developmentString => {
  const development = developmentString === "true";
  const tempDirWithFiles = (name: string, files: Record<string, string>) =>
    tempDir(name + (development ? "-dev" : "-prod"), files);
  const normalizeHTML = normalizeHTMLFn(development);
  const env = {
    ...bunEnv,
    NODE_ENV: development ? undefined : "production",
  };
  const devServerLabel = development ? " dev server" : "";
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

        expect(normalizeHTML(content)).toMatchSnapshot();

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
Bun v*.*.*${devServerLabel} ready in *.** ms
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

        // Check that React root exists and has Tailwind classes
        const root = await page.$("#root");
        expect(root).toBeTruthy();

        const content = await page.evaluate(() => document.documentElement.outerHTML);
        expect(normalizeHTML(content)).toMatchSnapshot();

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
        Bun v*.*.*${devServerLabel} ready in *.** ms
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
});

function normalizeHTMLFn(development: boolean = true) {
  return (html: string) =>
    html
      .split("\n")
      .map(line => {
        // First trim the line
        const trimmed = line.trim();
        if (!trimmed) return "";

        if (!development) {
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
        }

        // In development mode, replace generational IDs in script/link tags
        return trimmed.replace(
          /<(link rel="stylesheet" href|script type="module" src)="\/_bun\/(client|asset)\/[^"]+\.(?:css|js)("><\/script>|">)/g,
          (_, tagStart, path, end) => `<${tagStart}="/_bun/${path}/[GENERATION_ID]${end}`,
        );
      })
      .filter(Boolean)
      .join("\n")
      .trim();
}
