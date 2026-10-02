import type { Subprocess } from "bun";
import { describe, expect, test } from "bun:test";
import { cp, readdir, readFile } from "fs/promises";
import { bunEnv, bunExe, isCI, isWindows, tempDir, tempDirWithFiles } from "harness";
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

async function runBuildAndCheck(dir: string, env: Record<string, string | undefined>) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", "build"],
    cwd: dir,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, exitCode }).toEqual({ stdout: expect.any(String), stderr: expect.any(String), exitCode: 0 });

  const distDir = path.join(dir, "dist");
  const files = (await readdir(distDir)).sort();
  const js = files.find(f => f.endsWith(".js"));
  const html = files.find(f => f.endsWith(".html"));
  const css = files.find(f => f.endsWith(".css"));
  expect({ js: !!js, html: !!html, css: !!css, files }).toEqual({ js: true, html: true, css: true, files });

  // The generated HTML must reference the emitted JS and CSS chunks and contain
  // the root mount point that the client bundle hydrates into.
  const htmlContent = await readFile(path.join(distDir, html!), "utf8");
  expect(htmlContent).toContain(js!);
  expect(htmlContent).toContain(css!);
  expect(htmlContent).toContain('<div id="root">');
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
  await using subprocess = Bun.spawn({
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

  const [html] = await Promise.all([subprocess.stdout.text(), subprocess.exited]);
  return html;
}

const fixtureDir = path.join(__dirname, "react-spa-no-tailwind");
const tailwindTsx = await Bun.file(path.join(__dirname, "tailwind.tsx")).text();
const shadcnTsx = await Bun.file(path.join(__dirname, "shadcn.tsx")).text();

async function reactSpaNoTailwindDir() {
  const dir = tempDirWithFiles("react-spa-no-tailwind", {
    "README.md": "Hello, world!",
  });
  await cp(fixtureDir, dir, { recursive: true, force: true });
  return dir;
}

function reactSpaTailwindDir() {
  return tempDirWithFiles("react-spa-tailwind", { "index.tsx": tailwindTsx });
}

function shadcnDir() {
  return tempDirWithFiles("shadcn-ui", { "index.tsx": shadcnTsx });
}

// Run `bun create <entry>` until the project is scaffolded and the dev server
// prints its URL, then tear it down. Returns the captured stdout so the caller
// can assert on the scaffold log.
async function scaffold(dir: string, entry: string, env: Record<string, string | undefined>) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "create", entry],
    cwd: dir,
    env,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });
  // Drain stderr concurrently so a noisy install cannot fill the pipe buffer
  // and stall the child while we wait on stdout for the dev-server URL.
  const stderrPromise = proc.stderr.text();
  const all = { text: "" };
  let serverUrl: string;
  try {
    serverUrl = await getServerUrl(proc, all);
  } catch (e) {
    proc.kill();
    const stderr = await stderrPromise.catch(() => "");
    throw new Error(`${(e as Error).message}\nstderr:\n${stderr}`);
  }
  proc.kill();
  const [, stderr] = await Promise.all([proc.exited, stderrPromise]);
  return { stdout: all.text, stderr, serverUrl };
}

function envFor(development: boolean) {
  return {
    ...bunEnv,
    BUN_PORT: "0",
    NODE_ENV: development ? undefined : "production",
  };
}

// The "build" tests are registered first and all marked concurrent so they form
// a single concurrent group; a serial test between them would force bun:test to
// drain the group and run the builds one after another. The "dev server" tests
// (todo in CI, snapshot-based so they must stay serial) are registered after.
for (const development of [true, false]) {
  describe(`development: ${development}`, () => {
    const env = envFor(development);

    describe("react spa (no tailwind)", () => {
      test.concurrent.todoIf(isWindows)("build", async () => {
        const dir = await reactSpaNoTailwindDir();
        const { stdout: createOut } = await scaffold(dir, "./index.jsx", env);
        expect(createOut).toContain("React project configured");
        expect(createOut).toContain("bun run build");
        await runBuildAndCheck(dir, env);
      });
    });

    describe("react spa (tailwind)", () => {
      test.concurrent.todoIf(isWindows)("build", async () => {
        const dir = reactSpaTailwindDir();
        const { stdout: createOut } = await scaffold(dir, "./index.tsx", env);
        expect(createOut).toContain("React + Tailwind project configured");
        expect(createOut).toContain("bun run build");
        await runBuildAndCheck(dir, env);
      });
    });

    describe("shadcn/ui", () => {
      test.concurrent.todoIf(isCI || isWindows)("build", async () => {
        const dir = shadcnDir();
        const { stdout: createOut } = await scaffold(dir, "./index.tsx", env);
        expect(createOut).toContain("React + shadcn/ui + Tailwind project configured");
        expect(createOut).toContain("bun run build");
        await runBuildAndCheck(dir, env);
      });
    });
  });
}

// Windows: `bun create` never prints the "--only-missing install" line this
// asserts on, so the dependency detection cannot be observed there.
test.concurrent.todoIf(isWindows)("auto-install passes detected dependencies as positionals", async () => {
  using dir = tempDir("create-arg-separator", {
    "Component.tsx": `import "--trust";

export default function Component() {
  return <div>Hello</div>;
}
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "create", "./Component.tsx"],
    cwd: String(dir),
    env: {
      ...bunEnv,
      // Unreachable registry so the spawned install fails fast offline.
      BUN_CONFIG_REGISTRY: "http://localhost:1/",
    },
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });

  const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const installLine = stdout.split("\n").find(line => line.includes("--only-missing install"));
  expect(installLine).toBeDefined();
  expect(installLine).toContain(" install -- ");
  // The registry is unreachable, so the spawned install must fail.
  expect(exitCode).not.toBe(0);
});

for (const development of [true, false]) {
  describe(`development: ${development}`, () => {
    const normalizeHTML = normalizeHTMLFn(development);
    const env = envFor(development);

    describe("react spa (no tailwind)", () => {
      test.todoIf(isCI || isWindows)("dev server", async () => {
        const dir = await reactSpaNoTailwindDir();
        await using process = Bun.spawn({
          cmd: [bunExe(), "create", "./index.jsx"],
          cwd: dir,
          env,
          stdout: "pipe",
          stderr: "inherit",
          stdin: "ignore",
        });
        const all = { text: "" };
        const serverUrl = await getServerUrl(process, all);
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
      });
    });

    describe("react spa (tailwind)", () => {
      test.todoIf(isCI || isWindows)("dev server", async () => {
        const dir = reactSpaTailwindDir();
        await using process = Bun.spawn({
          cmd: [bunExe(), "create", "./index.tsx"],
          cwd: dir,
          env,
          stdout: "pipe",
          stderr: "inherit",
          stdin: "ignore",
        });
        const all = { text: "" };
        const serverUrl = await getServerUrl(process, all);
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
      });
    });

    describe("shadcn/ui", () => {
      test.todoIf(isCI || isWindows)("dev server", async () => {
        const dir = shadcnDir();
        await using process = Bun.spawn({
          cmd: [bunExe(), "create", "./index.tsx"],
          cwd: dir,
          env,
          stdout: "pipe",
          stderr: "inherit",
          stdin: "ignore",
        });
        const all = { text: "" };
        const serverUrl = await getServerUrl(process, all);
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
        // In development mode, replace non-deterministic generation IDs
        return trimmed
          .replace(/\/_bun\/client\/(.*?-[a-z0-9]{8})[a-z0-9]{8}\.js/gm, "/_bun/client/$1[NONDETERMINISTIC].js")
          .replace(/\/_bun\/asset\/[a-z0-9]{16}\.[a-z]+/gm, "/_bun/asset/[ASSET_HASH].css");
      })
      .filter(Boolean)
      .join("\n")
      .trim();
}
