import { describe, expect, test } from "bun:test";
import { readFileSync, statSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import path from "path";

// The stylesheets that `bun create` writes, byte for byte. A test that puts one of
// them on disk sets up what an earlier run left behind.
const projects = path.join(import.meta.dir, "../../../src/runtime/cli/create/projects");
const REACT_CSS = readFileSync(path.join(projects, "react-spa/REPLACE_ME_WITH_YOUR_APP_FILE_NAME.css"), "utf8");
const TAILWIND_CSS = readFileSync(
  path.join(projects, "react-tailwind-spa/REPLACE_ME_WITH_YOUR_APP_FILE_NAME.css"),
  "utf8",
);
const SHADCN_CSS = readFileSync(path.join(projects, "react-shadcn-spa/REPLACE_ME_WITH_YOUR_APP_FILE_NAME.css"), "utf8");
const SHADCN_INDEX_CSS = readFileSync(path.join(projects, "react-shadcn-spa/styles/index.css"), "utf8");
const SHADCN_GLOBALS_CSS = readFileSync(path.join(projects, "react-shadcn-spa/styles/globals.css"), "utf8");

// The `create` lines of each template in an empty directory, for the component `${c}.tsx`.
// For ./index.tsx the shadcn/ui template names index.css twice: two of its rows are that one path.
const templates = {
  react: (c: string) => [`${c}.build.ts`, `${c}.css`, `${c}.html`, `${c}.client.tsx`, "package.json"],
  tailwind: (c: string) => [`${c}.build.ts`, `${c}.css`, `${c}.html`, `${c}.client.tsx`, "bunfig.toml", "package.json"],
  shadcn: (c: string) => [
    "lib/utils.ts",
    "index.css",
    `${c}.build.ts`,
    `${c}.client.tsx`,
    `${c}.css`,
    `${c}.html`,
    "styles/globals.css",
    "bunfig.toml",
    "package.json",
    "tsconfig.json",
    "components.json",
  ],
};

const div = (className: string) => `export default function App() { return <div className="${className}">hi</div>; }\n`;
const reactApp = div("card");
const tailwindApp = div("flex items-center p-4 text-xl");
const shadcnApp = `import { Button } from "@/components/ui/button";\nexport default function App() { return <Button>hi</Button>; }\n`;

// Runs `bun create <entry>` in `cwd`. The registry has no packages, so
// `bun create` writes the template files and then fails at the install step.
async function create(cwd: string, entry: string) {
  using registry = Bun.serve({ port: 0, fetch: () => new Response(null, { status: 404 }) });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "create", entry],
    cwd,
    env: {
      ...bunEnv,
      BUN_CONFIG_REGISTRY: registry.url.href,
      // `bun create` exits without freeing the bundler. The ASAN lane would turn that into exit code 134.
      ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "detect_leaks=0"].filter(Boolean).join(":"),
    },
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // `bun create` prints this line after it wrote the files. The line names what the template installs.
  const install = stdout.split("\n").find(line => line.includes("--only-missing install")) ?? "";
  expect({ reachedInstall: install !== "", exitCode }, stderr).toEqual({ reachedInstall: true, exitCode: 1 });
  return {
    template: install.includes("tw-animate-css") ? "shadcn" : install.includes("tailwindcss") ? "tailwind" : "react",
    created: stdout
      .split("\n")
      .filter(line => line.startsWith(" create "))
      .map(line => line.trim().split(/\s+/)[1]),
    stderr,
  };
}

// Equal before and after a run means that the run did not write, truncate or replace the file.
function identity(file: string) {
  const { ino, size, mtimeNs, ctimeNs } = statSync(file, { bigint: true });
  return { ino, size, mtimeNs, ctimeNs };
}

// Windows: `bun create <component>` does not reach its install step there (see create-jsx.test.ts).
describe.concurrent.todoIf(isWindows)("bun create <component> and files that are already there", () => {
  const userCss = "/* my own stylesheet */\n.card { color: red; }\n";
  const packageJson = JSON.stringify({ name: "my-app", private: true });

  // The project is laid out as Vite and Create React App do it: the component
  // imports the stylesheet beside it.
  test.each([
    { title: "React", template: "react", entry: "src/App.tsx", component: reactApp, css: userCss },
    {
      title: "React + Tailwind, class names in the component",
      template: "tailwind",
      entry: "src/App.tsx",
      component: tailwindApp,
      css: userCss,
    },
    {
      title: "React + Tailwind, the generated stylesheet with the user's theme added",
      template: "tailwind",
      entry: "src/App.tsx",
      component: reactApp,
      css: TAILWIND_CSS + "@theme { --color-brand: #f00; }\n",
    },
    { title: "React + shadcn/ui", template: "shadcn", entry: "src/App.tsx", component: shadcnApp, css: userCss },
    // In the next two layouts the stylesheet of the component is also a fixed file name of the shadcn/ui template.
    {
      title: "React + shadcn/ui, ./index.tsx",
      template: "shadcn",
      entry: "index.tsx",
      component: shadcnApp,
      css: userCss,
    },
    {
      title: "React + shadcn/ui, ./styles/globals.tsx",
      template: "shadcn",
      entry: "styles/globals.tsx",
      component: shadcnApp,
      css: userCss,
    },
  ] as const)("keeps the user's stylesheet: $title", async ({ template, entry, component, css }) => {
    const base = entry.slice(0, -".tsx".length);
    const stylesheet = `${base}.css`;
    using dir = tempDir("create-jsx-files", {
      [entry]: `import "./${path.basename(stylesheet)}";\n${component}`,
      [stylesheet]: css,
      "package.json": packageJson,
    });
    const file = path.join(String(dir), stylesheet);
    const before = identity(file);

    const { stderr, ...result } = await create(String(dir), `./${entry}`);

    expect(
      {
        ...result,
        css: readFileSync(file, "utf8"),
        identity: identity(file),
        packageJson: readFileSync(path.join(String(dir), "package.json"), "utf8"),
      },
      stderr,
    ).toEqual({
      template,
      created: templates[template](base).filter(name => name !== stylesheet && name !== "package.json"),
      css,
      identity: before,
      packageJson,
    });
  });

  // No Tailwind here, but `App-header` holds `p-`, one of the substrings that
  // `bun create` takes for a Tailwind class name.
  test("keeps the user's stylesheet: the class names of a stock Create React App", async () => {
    const css = ".App-header { background-color: #282c34; }\n";
    using dir = tempDir("create-jsx-files", {
      "src/App.tsx": `import "./App.css";\nexport default function App() { return <div className="App"><header className="App-header">hi</header></div>; }\n`,
      "src/App.css": css,
    });

    const { stderr, created } = await create(String(dir), "./src/App.tsx");

    expect(created, stderr).toContain("src/App.html");
    expect(created).not.toContain("src/App.css");
    expect(readFileSync(path.join(String(dir), "src/App.css"), "utf8")).toBe(css);
  });

  // An existing shadcn/ui project has these files already, and the template has a row for each name.
  test("keeps the user's index.css and styles/globals.css beside a component of another name", async () => {
    const mine = ["index.css", "styles/globals.css"];
    const content = (name: string) => `/* my own ${name} */\n`;
    using dir = tempDir("create-jsx-files", {
      "src/App.tsx": shadcnApp,
      "package.json": packageJson,
      ...Object.fromEntries(mine.map(name => [name, content(name)])),
    });
    const files = mine.map(name => path.join(String(dir), name));
    const before = files.map(identity);

    const { stderr, ...result } = await create(String(dir), "./src/App.tsx");

    expect(
      { ...result, contents: files.map(file => readFileSync(file, "utf8")), identity: files.map(identity) },
      stderr,
    ).toEqual({
      template: "shadcn",
      created: templates.shadcn("src/App").filter(name => !mine.includes(name) && name !== "package.json"),
      contents: mine.map(content),
      identity: before,
    });
  });

  // Vite and Create React App keep the global stylesheet of a project at src/index.css.
  test("keeps the project's src/index.css when the command runs in src/", async () => {
    using dir = tempDir("create-jsx-files", { "src/App.tsx": shadcnApp, "src/index.css": userCss });
    const file = path.join(String(dir), "src/index.css");
    const before = identity(file);

    const { stderr, ...result } = await create(path.join(String(dir), "src"), "./App.tsx");

    expect({ ...result, css: readFileSync(file, "utf8"), identity: identity(file) }, stderr).toEqual({
      template: "shadcn",
      created: templates.shadcn("App").filter(name => name !== "index.css"),
      css: userCss,
      identity: before,
    });
  });

  // The page of ./index.tsx links the index.css that its own run wrote. A
  // shadcn/ui run for another component has a row for that name too.
  test.each([
    { template: "React", css: REACT_CSS },
    { template: "React + Tailwind", css: TAILWIND_CSS },
    { template: "React + shadcn/ui", css: SHADCN_CSS },
  ])(
    "a shadcn/ui run for ./src/App.tsx keeps the index.css of an earlier $template run for ./index.tsx",
    async ({ css }) => {
      using dir = tempDir("create-jsx-files", { "index.tsx": reactApp, "index.css": css, "src/App.tsx": shadcnApp });
      const file = path.join(String(dir), "index.css");
      const before = identity(file);

      const { stderr, ...result } = await create(String(dir), "./src/App.tsx");

      expect({ ...result, css: readFileSync(file, "utf8"), identity: identity(file) }, stderr).toEqual({
        template: "shadcn",
        created: templates.shadcn("src/App").filter(name => name !== "index.css"),
        css,
        identity: before,
      });
    },
  );

  // `shadcn add` writes components/ui/button.tsx. From then on the import
  // resolves, and the next run picks the Tailwind template.
  test("keeps the shadcn/ui stylesheet when a later run picks the Tailwind template", async () => {
    using dir = tempDir("create-jsx-files", {
      "src/App.tsx": `import { Button } from "@/components/ui/button";\nexport default function App() { return <Button className="flex items-center p-4">hi</Button>; }\n`,
      "src/App.css": SHADCN_CSS,
      "components/ui/button.tsx": `export function Button(props: any) { return <button {...props} />; }\n`,
      "tsconfig.json": JSON.stringify({ compilerOptions: { paths: { "@/*": ["./*"] } } }),
    });
    const file = path.join(String(dir), "src/App.css");
    const before = identity(file);

    const { stderr, template, created } = await create(String(dir), "./src/App.tsx");

    expect({ template, css: readFileSync(file, "utf8"), identity: identity(file) }, stderr).toEqual({
      template: "tailwind",
      css: SHADCN_CSS,
      identity: before,
    });
    expect(created).not.toContain("src/App.css");
  });

  // The stylesheet on disk is bun's own, byte for byte, so the run replaces it
  // with the one that its template needs.
  test.each([
    { from: "React", to: "tailwind", css: REACT_CSS, component: tailwindApp, expected: TAILWIND_CSS },
    { from: "React", to: "shadcn", css: REACT_CSS, component: shadcnApp, expected: SHADCN_CSS },
    { from: "React + Tailwind", to: "shadcn", css: TAILWIND_CSS, component: shadcnApp, expected: SHADCN_CSS },
  ])("replaces the $from stylesheet of an earlier run: $to template", async ({ to, css, component, expected }) => {
    using dir = tempDir("create-jsx-files", { "src/App.tsx": component, "src/App.css": css });

    const { stderr, template, created } = await create(String(dir), "./src/App.tsx");

    expect({ template, css: readFileSync(path.join(String(dir), "src/App.css"), "utf8") }, stderr).toEqual({
      template: to,
      css: expected,
    });
    expect(created).toContain("src/App.css");
  });

  // A shadcn/ui run for another component leaves this root index.css. It is
  // bun's own too, so a Tailwind run for ./index.tsx replaces it.
  test("replaces the index.css of an earlier shadcn/ui run when the component is ./index.tsx", async () => {
    using dir = tempDir("create-jsx-files", { "index.tsx": tailwindApp, "index.css": SHADCN_INDEX_CSS });

    const { stderr, template, created } = await create(String(dir), "./index.tsx");

    expect({ template, css: readFileSync(path.join(String(dir), "index.css"), "utf8") }, stderr).toEqual({
      template: "tailwind",
      css: TAILWIND_CSS,
    });
    expect(created).toContain("index.css");
  });

  // In these two layouts the shadcn/ui template has two rows for one path. The second row wins.
  test.each([
    { entry: "index.tsx", stylesheet: "index.css", css: SHADCN_CSS },
    { entry: "styles/globals.tsx", stylesheet: "styles/globals.css", css: SHADCN_GLOBALS_CSS },
  ])("an empty directory and ./$entry: the second row for $stylesheet wins", async ({ entry, stylesheet, css }) => {
    using dir = tempDir("create-jsx-files", { [entry]: shadcnApp });

    const { stderr, ...result } = await create(String(dir), `./${entry}`);

    expect({ ...result, css: readFileSync(path.join(String(dir), stylesheet), "utf8") }, stderr).toEqual({
      template: "shadcn",
      created: templates.shadcn(entry.slice(0, -".tsx".length)),
      css,
    });
  });

  test("writes <component>.client.tsx again when the export has another name", async () => {
    using dir = tempDir("create-jsx-files", {
      "src/App.tsx": `export function Widget() { return <div>hi</div>; }\n`,
      "src/App.client.tsx": `import { default as Component } from "./App";\n`,
    });

    const { stderr, created } = await create(String(dir), "./src/App.tsx");

    expect(created, stderr).toContain("src/App.client.tsx");
    expect(readFileSync(path.join(String(dir), "src/App.client.tsx"), "utf8")).toContain(
      `import { Widget as Component } from "./App";`,
    );
  });
});
