import type { Subprocess } from "bun";
import { beforeEach, describe, expect, test } from "bun:test";
import { cp, readdir } from "fs/promises";
import { bunEnv, bunExe, isCI, isWindows, tempDirWithFiles } from "harness";
import path from "path";

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
    throw new Error("Could not find server URL in stdout: " + all.text);
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

let dir_with_happy_dom = tempDirWithFiles("happy-dom", {
  ["package.json"]: JSON.stringify({
    name: "happy-dom-tester",
    version: "0.0.0",
    dependencies: {
      "@happy-dom/global-registrator": "17.1.1",
    },
  }),
});

async function fetchAndInjectHTML(url: string) {
  var subprocess = Bun.spawn({
    cmd: [
      bunExe(),
      "--eval",
      `
        const url = ${JSON.stringify(url)};
        const initial = await fetch(url).then(r => r.text());
        import { GlobalRegistrator } from "@happy-dom/global-registrator";
        GlobalRegistrator.register({
          url,
        });
        globalThis.WebSocket = class {
          constructor(url) {
          }
        };

        location.href = url;
        document.write(initial);
        window.happyDOM.waitUntilComplete().then(() => {
          const html = document.documentElement.outerHTML;
          process.stdout.write(html, () => {
            process.exit(0);
          });
        });
      `,
    ],
    cwd: dir_with_happy_dom,
    env: bunEnv,
    stdout: "pipe",
    stdin: "ignore",
    stderr: "inherit",
  });

  await subprocess.exited;
  return await subprocess.stdout.text();
}

for (const development of [true, false]) {
  describe(`development: ${development}`, () => {
    const normalizeHTML = normalizeHTMLFn(development);
    const env = {
      ...bunEnv,
      BUN_PORT: "0",
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

      test.todoIf(isCI || isWindows)("dev server", async () => {
        console.log({ dir });
        await using process = Bun.spawn([bunExe(), "create", "./index.jsx"], {
          cwd: dir,
          env: env,
          stdout: "pipe",
          stdin: "ignore",
        });
        const all = { text: "" };

        const serverUrl = await getServerUrl(process, all);

        try {
          console.log({ dir });
          const content = await fetchAndInjectHTML(serverUrl);
          expect(normalizeHTML(content)).toMatchSnapshot();

          expect(
            all.text
              .replaceAll(Bun.version, "*.*.*")
              .replaceAll(Bun.version_with_sha, "*.*.*")
              .replace(/v\d+\.\d+\.\d+(?:\s*\([a-f0-9]+\))?(?:-(debug|canary.*))?/g, "v*.*.*") // Handle version with git hash
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

      test.todoIf(isCI || isWindows)("dev server", async () => {
        const process = Bun.spawn([bunExe(), "create", "./index.tsx"], {
          cwd: dir,
          env: env,
          stdout: "pipe",
          stdin: "ignore",
        });
        const all = { text: "" };
        console.log({ dir });
        const serverUrl = await getServerUrl(process, all);
        console.log(serverUrl);

        try {
          const content = await fetchAndInjectHTML(serverUrl);

          expect(normalizeHTML(content)).toMatchSnapshot();

          expect(
            all.text
              .replaceAll(Bun.version_with_sha, "*.*.*")
              .replace(/Bun (v\d+\.\d+\.\d+)/, "Bun *.*.*")
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

    describe("shadcn/ui", async () => {
      let dir: string;
      beforeEach(async () => {
        dir = tempDirWithFiles("shadcn-ui", {
          "index.tsx": await Bun.file(path.join(__dirname, "shadcn.tsx")).text(),
        });
      });

      test.todoIf(isCI || isWindows)("dev server", async () => {
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
          const content = await fetchAndInjectHTML(serverUrl);

          // Check for components.json
          const componentsJson = await Bun.file(path.join(dir, "components.json")).exists();
          expect(componentsJson).toBe(true);

          expect(
            all.text
              .replaceAll(Bun.version_with_sha, "*.*.*")
              .replaceAll(Bun.version, "*.*.*")
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
          expect(normalizeHTML(content)).toMatchSnapshot();
        } finally {
          process.kill();
        }
      });

      test.todoIf(isCI || isWindows)("build", async () => {
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
  });
}

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
        console.log(trimmed);
        // In development mode, replace non-deterministic generation IDs
        return trimmed
          .replace(/\/_bun\/client\/(.*?-[a-z0-9]{8})[a-z0-9]{8}\.js/gm, "/_bun/client/$1[NONDETERMINISTIC].js")
          .replace(/\/_bun\/asset\/[a-z0-9]{16}\.[a-z]+/gm, "/_bun/asset/[ASSET_HASH].css");
      })
      .filter(Boolean)
      .join("\n")
      .trim();
}
