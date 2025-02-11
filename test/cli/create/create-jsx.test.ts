import "bun";
import { expect, test, describe, beforeEach, afterAll } from "bun:test";
import { tempDirWithFiles as tempDir, bunExe, bunEnv, isCI, isWindows } from "harness";
import { cp, readdir } from "fs/promises";
import path from "path";
import puppeteer, { type Browser } from "puppeteer";
import type { Subprocess } from "bun";
import * as vm from "vm";
const env = {
  ...bunEnv,
};
const baseOptions = {
  dumpio: !!process.env.CI_DEBUG,

  args: [
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--disable-setuid-sandbox",
    "--no-sandbox",
    "--ignore-certificate-errors",
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    "--disable-sync",
  ],
  executablePath: process.env.BROWSER_EXECUTABLE,
  headless: true,
};
let puppeteerBrowser: Browser | null = null;
async function getPuppeteerBrowser() {
  if (!puppeteerBrowser) {
    puppeteerBrowser = await puppeteer.launch(baseOptions);
  }
  return puppeteerBrowser;
}

afterAll(async () => {
  if (puppeteerBrowser) {
    await puppeteerBrowser.close();
  }
});

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
    NODE_PORT: "0",
    NODE_ENV: development ? undefined : "production",
  };

  const devServerLabel = development ? " dev server" : "";
  describe("react spa (no tailwind)", async () => {
    let dir: string;
    beforeEach(async () => {
      dir = tempDirWithFiles("react-spa-no-tailwind", {
        "README.md": "Hello, world!",
      });

      await cp(path.join(__dirname, "react-spa-no-tailwind"), dir, {
        recursive: true,
        force: true,
      });
    });

    test.todoIf(isCI)("dev server", async () => {
      await using process = Bun.spawn([bunExe(), "create", "./index.jsx"], {
        cwd: dir,
        env: env,
        stdout: "pipe",
        stdin: "ignore",
      });
      const all = { text: "" };
      const serverUrl = await getServerUrl(process, all);

      try {
        const browser = await getPuppeteerBrowser();
        var page = await browser.newPage();
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
            .trim()
            .replaceAll(serverUrl, "http://[SERVER_URL]"),
        ).toMatchSnapshot();
      } finally {
        process.kill();
        await Promise.resolve(page!?.close?.({ runBeforeUnload: false }));
      }
    });

    test.todoIf(isWindows)("build", async () => {
      {
        const process = Bun.spawn([bunExe(), "create", "./index.jsx"], {
          cwd: dir,
          env: env,
          stdout: "pipe",
          stdin: "ignore",
        });
        const all = { text: "" };
        const serverUrl = await getServerUrl(process, all);
        process.kill();
      }

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
    let dir: string;
    beforeEach(async () => {
      dir = tempDirWithFiles("react-spa-tailwind", {
        "index.tsx": await Bun.file(path.join(__dirname, "tailwind.tsx")).text(),
      });
    });

    test.todoIf(isCI)("dev server", async () => {
      const process = Bun.spawn([bunExe(), "create", "./index.tsx"], {
        cwd: dir,
        env: env,
        stdout: "pipe",
        stdin: "ignore",
      });
      const all = { text: "" };
      const serverUrl = await getServerUrl(process, all);
      console.log(serverUrl);

      try {
        var page = await (await getPuppeteerBrowser()).newPage();
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
            .trim()
            .replaceAll(serverUrl, "http://[SERVER_URL]"),
        ).toMatchSnapshot();
      } finally {
        process.kill();
        await Promise.resolve(page!?.close?.({ runBeforeUnload: false }));
      }
    });

    test.todoIf(isWindows)("build", async () => {
      {
        const process = Bun.spawn([bunExe(), "create", "./index.tsx"], {
          cwd: dir,
          env: env,
          stdout: "pipe",
          stdin: "ignore",
        });
        const all = { text: "" };
        const serverUrl = await getServerUrl(process, all);
        process.kill();
      }

      const process = Bun.spawn([bunExe(), "run", "build"], {
        cwd: dir,
        env: env,
        stdout: "pipe",
      });

      await process.exited;
      await checkBuildOutput(dir);
    });
  });

  describe(
    "shadcn/ui",
    async () => {
      let dir: string;
      beforeEach(async () => {
        dir = tempDirWithFiles("shadcn-ui", {
          "index.tsx": await Bun.file(path.join(__dirname, "shadcn.tsx")).text(),
        });
      });

      test(
        "dev server",
        async () => {
          const process = Bun.spawn([bunExe(), "create", "./index.tsx"], {
            cwd: dir,
            env: env,
            stdout: "pipe",
            stdin: "ignore",
          });
          const all = { text: "" };
          const serverUrl = await getServerUrl(process, all);
          console.log(serverUrl);
          console.log(dir);
          try {
            var page = await (await getPuppeteerBrowser()).newPage();
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
                .trim()
                .replaceAll(serverUrl, "http://[SERVER_URL]"),
            ).toMatchSnapshot();
          } finally {
            process.kill();
            await Promise.resolve(page!?.close?.({ runBeforeUnload: false }));
          }
        },
        1000 * 100,
      );

      test.todoIf(isWindows)("build", async () => {
        {
          const process = Bun.spawn([bunExe(), "create", "./index.tsx"], {
            cwd: dir,
            env: env,
            stdout: "pipe",
            stdin: "ignore",
          });
          const all = { text: "" };
          const serverUrl = await getServerUrl(process, all);
          process.kill();
        }

        const process = Bun.spawn([bunExe(), "run", "build"], {
          cwd: dir,
          env: env,
          stdout: "pipe",
        });

        await process.exited;
        await checkBuildOutput(dir);
      });
    },
    1000 * 100,
  );
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
