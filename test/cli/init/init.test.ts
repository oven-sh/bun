import { expect, test } from "bun:test";
import fs, { readdirSync } from "fs";
import { bunEnv, bunExe, tempDirWithFiles, tmpdirSync } from "harness";
import path from "path";

test("bun init works", () => {
  const temp = tmpdirSync();

  const out = Bun.spawnSync({
    cmd: [bunExe(), "init", "-y"],
    cwd: temp,
    stdio: ["ignore", "inherit", "inherit"],
    env: bunEnv,
  });

  expect(out.signal).toBe(undefined);
  expect(out.exitCode).toBe(0);

  const pkg = JSON.parse(fs.readFileSync(path.join(temp, "package.json"), "utf8"));
  expect(pkg).toEqual({
    "name": path.basename(temp).toLowerCase(),
    "module": "index.ts",
    "type": "module",
    "private": true,
    "devDependencies": {
      "@types/bun": "latest",
    },
    "peerDependencies": {
      "typescript": "^5",
    },
  });
  const readme = fs.readFileSync(path.join(temp, "README.md"), "utf8");
  expect(readme).toStartWith("# " + path.basename(temp).toLowerCase() + "\n");
  expect(readme).toInclude("v" + Bun.version.replaceAll("-debug", ""));
  expect(readme).toInclude("index.ts");

  expect(fs.existsSync(path.join(temp, "index.ts"))).toBe(true);
  expect(fs.existsSync(path.join(temp, ".gitignore"))).toBe(true);
  expect(fs.existsSync(path.join(temp, "node_modules"))).toBe(true);
  expect(fs.existsSync(path.join(temp, "tsconfig.json"))).toBe(true);
}, 30_000);

test("bun init with piped cli", () => {
  const temp = tmpdirSync();

  const out = Bun.spawnSync({
    cmd: [bunExe(), "init"],
    cwd: temp,
    stdio: [new Blob(["\n\n\n\n\n\n\n\n\n\n\n\n"]), "inherit", "inherit"],
    env: bunEnv,
  });

  expect(out.signal).toBe(undefined);
  expect(out.exitCode).toBe(0);

  const pkg = JSON.parse(fs.readFileSync(path.join(temp, "package.json"), "utf8"));
  expect(pkg).toEqual({
    "name": path.basename(temp).toLowerCase(),
    "module": "index.ts",
    "private": true,
    "type": "module",
    "devDependencies": {
      "@types/bun": "latest",
    },
    "peerDependencies": {
      "typescript": "^5",
    },
  });
  const readme = fs.readFileSync(path.join(temp, "README.md"), "utf8");
  expect(readme).toStartWith("# " + path.basename(temp).toLowerCase() + "\n");
  expect(readme).toInclude("v" + Bun.version.replaceAll("-debug", ""));
  expect(readme).toInclude("index.ts");

  expect(fs.existsSync(path.join(temp, "index.ts"))).toBe(true);
  expect(fs.existsSync(path.join(temp, ".gitignore"))).toBe(true);
  expect(fs.existsSync(path.join(temp, "node_modules"))).toBe(true);
  expect(fs.existsSync(path.join(temp, "tsconfig.json"))).toBe(true);
}, 30_000);

test("bun init in folder", () => {
  const temp = tmpdirSync();
  const out = Bun.spawnSync({
    cmd: [bunExe(), "init", "-y", "mydir"],
    cwd: temp,
    stdio: ["ignore", "inherit", "inherit"],
    env: bunEnv,
  });
  expect(out.exitCode).toBe(0);
  expect(readdirSync(temp).sort()).toEqual(["mydir"]);
  expect(readdirSync(path.join(temp, "mydir")).sort()).toMatchInlineSnapshot(`
    [
      ".gitignore",
      "CLAUDE.md",
      "README.md",
      "bun.lock",
      "index.ts",
      "node_modules",
      "package.json",
      "tsconfig.json",
    ]
  `);
});

test("bun init error rather than overwriting file", async () => {
  const temp = tempDirWithFiles("mytmp", {
    "mydir": "don't delete me!!!",
  });
  const out = Bun.spawnSync({
    cmd: [bunExe(), "init", "-y", "mydir"],
    cwd: temp,
    stdio: ["ignore", "pipe", "pipe"],
    env: bunEnv,
  });
  expect(out.stdout.toString()).toBe("");
  expect(out.stderr.toString()).toBe("Failed to create directory mydir: NotDir\n");
  expect(out.exitCode).not.toBe(0);
  expect(readdirSync(temp).sort()).toEqual(["mydir"]);
  expect(await Bun.file(path.join(temp, "mydir")).text()).toBe("don't delete me!!!");
});

test("bun init utf-8", async () => {
  const temp = tempDirWithFiles("mytmp", {});
  const out = Bun.spawnSync({
    cmd: [bunExe(), "init", "-y", "u t f ∞™/subpath"],
    cwd: temp,
    stdio: ["ignore", "inherit", "inherit"],
    env: bunEnv,
  });
  expect(out.exitCode).toBe(0);
  expect(readdirSync(temp).sort()).toEqual(["u t f ∞™"]);
  expect(readdirSync(path.join(temp, "u t f ∞™")).sort()).toEqual(["subpath"]);
  expect(readdirSync(path.join(temp, "u t f ∞™/subpath")).sort()).toMatchInlineSnapshot(`
    [
      ".gitignore",
      "CLAUDE.md",
      "README.md",
      "bun.lock",
      "index.ts",
      "node_modules",
      "package.json",
      "tsconfig.json",
    ]
  `);
});

test("bun init twice", async () => {
  const temp = tempDirWithFiles("mytmp", {});
  const out = Bun.spawnSync({
    cmd: [bunExe(), "init", "-y", "mydir"],
    cwd: temp,
    stdio: ["ignore", "inherit", "inherit"],
    env: bunEnv,
  });
  expect(out.exitCode).toBe(0);
  expect(readdirSync(temp).sort()).toEqual(["mydir"]);
  expect(readdirSync(path.join(temp, "mydir")).sort()).toMatchInlineSnapshot(`
    [
      ".gitignore",
      "CLAUDE.md",
      "README.md",
      "bun.lock",
      "index.ts",
      "node_modules",
      "package.json",
      "tsconfig.json",
    ]
  `);
  await Bun.write(path.join(temp, "mydir/index.ts"), "my edited index.ts");
  await Bun.write(path.join(temp, "mydir/README.md"), "my edited README.md");
  await Bun.write(path.join(temp, "mydir/.gitignore"), "my edited .gitignore");
  await Bun.write(
    path.join(temp, "mydir/package.json"),
    JSON.stringify({
      ...(await Bun.file(path.join(temp, "mydir/package.json")).json()),
      name: "my edited package.json",
    }),
  );
  await Bun.write(path.join(temp, "mydir/tsconfig.json"), `my edited tsconfig.json`);
  const out2 = Bun.spawnSync({
    cmd: [bunExe(), "init", "mydir"],
    cwd: temp,
    stdio: ["ignore", "pipe", "pipe"],
    env: bunEnv,
  });
  expect(out2.stdout.toString()).toMatchInlineSnapshot(`""`);
  expect(out2.stderr.toString()).toMatchInlineSnapshot(`
    "note: package.json already exists, configuring existing project
    "
  `);
  expect(out2.exitCode).toBe(0);
  expect(readdirSync(temp).sort()).toEqual(["mydir"]);
  expect(readdirSync(path.join(temp, "mydir")).sort()).toMatchInlineSnapshot(`
    [
      ".gitignore",
      "CLAUDE.md",
      "README.md",
      "bun.lock",
      "index.ts",
      "node_modules",
      "package.json",
      "tsconfig.json",
    ]
  `);
  expect(await Bun.file(path.join(temp, "mydir/index.ts")).text()).toMatchInlineSnapshot(`"my edited index.ts"`);
  expect(await Bun.file(path.join(temp, "mydir/README.md")).text()).toMatchInlineSnapshot(`"my edited README.md"`);
  expect(await Bun.file(path.join(temp, "mydir/.gitignore")).text()).toMatchInlineSnapshot(`"my edited .gitignore"`);
  expect(await Bun.file(path.join(temp, "mydir/package.json")).json()).toMatchInlineSnapshot(`
    {
      "devDependencies": {
        "@types/bun": "latest",
      },
      "module": "index.ts",
      "name": "my edited package.json",
      "peerDependencies": {
        "typescript": "^5",
      },
      "private": true,
      "type": "module",
    }
  `);
  expect(await Bun.file(path.join(temp, "mydir/tsconfig.json")).text()).toMatchInlineSnapshot(
    `"my edited tsconfig.json"`,
  );
});

test("bun init --react works", () => {
  const temp = tmpdirSync();

  const out = Bun.spawnSync({
    cmd: [bunExe(), "init", "--react"],
    cwd: temp,
    stdio: ["ignore", "inherit", "inherit"],
    env: bunEnv,
  });

  expect(out.signalCode).toBeUndefined();
  expect(out.exitCode).toBe(0);

  const pkg = JSON.parse(fs.readFileSync(path.join(temp, "package.json"), "utf8"));
  expect(pkg).toHaveProperty("dependencies.react");
  expect(pkg).toHaveProperty("dependencies.react-dom");
  expect(pkg).toHaveProperty("devDependencies.@types/react");
  expect(pkg).toHaveProperty("devDependencies.@types/react-dom");

  expect(fs.existsSync(path.join(temp, "src"))).toBe(true);
  expect(fs.existsSync(path.join(temp, "src/index.tsx"))).toBe(true);
  expect(fs.existsSync(path.join(temp, "tsconfig.json"))).toBe(true);
}, 30_000);

test("bun init --react=tailwind works", () => {
  const temp = tmpdirSync();

  const out = Bun.spawnSync({
    cmd: [bunExe(), "init", "--react=tailwind"],
    cwd: temp,
    stdio: ["ignore", "inherit", "inherit"],
    env: bunEnv,
  });

  expect(out.signalCode).toBeUndefined();
  expect(out.exitCode).toBe(0);

  const pkg = JSON.parse(fs.readFileSync(path.join(temp, "package.json"), "utf8"));
  expect(pkg).toHaveProperty("dependencies.react");
  expect(pkg).toHaveProperty("dependencies.react-dom");
  expect(pkg).toHaveProperty("devDependencies.@types/react");
  expect(pkg).toHaveProperty("devDependencies.@types/react-dom");
  expect(pkg).toHaveProperty("dependencies.bun-plugin-tailwind");

  expect(fs.existsSync(path.join(temp, "src"))).toBe(true);
  expect(fs.existsSync(path.join(temp, "src/index.tsx"))).toBe(true);
}, 30_000);

test("bun init --react=shadcn works", () => {
  const temp = tmpdirSync();

  const out = Bun.spawnSync({
    cmd: [bunExe(), "init", "--react=shadcn"],
    cwd: temp,
    stdio: ["ignore", "inherit", "inherit"],
    env: bunEnv,
  });

  expect(out.signalCode).toBeUndefined();
  expect(out.exitCode).toBe(0);

  const pkg = JSON.parse(fs.readFileSync(path.join(temp, "package.json"), "utf8"));
  expect(pkg).toHaveProperty("dependencies.react");
  expect(pkg).toHaveProperty("dependencies.react-dom");
  expect(pkg).toHaveProperty("dependencies.@radix-ui/react-slot");
  expect(pkg).toHaveProperty("dependencies.class-variance-authority");
  expect(pkg).toHaveProperty("dependencies.clsx");
  expect(pkg).toHaveProperty("dependencies.bun-plugin-tailwind");

  expect(fs.existsSync(path.join(temp, "src"))).toBe(true);
  expect(fs.existsSync(path.join(temp, "src/index.tsx"))).toBe(true);
  expect(fs.existsSync(path.join(temp, "src/components"))).toBe(true);
  expect(fs.existsSync(path.join(temp, "src/components/ui"))).toBe(true);
}, 30_000);

test("bun init creates VS Code extensions.json when VSCODE_PID is set", () => {
  const temp = tmpdirSync();

  const out = Bun.spawnSync({
    cmd: [bunExe(), "init", "-y"],
    cwd: temp,
    stdio: ["ignore", "inherit", "inherit"],
    env: { ...bunEnv, VSCODE_PID: "12345" },
  });

  expect(out.signal).toBe(undefined);
  expect(out.exitCode).toBe(0);

  // Check that .vscode directory and extensions.json were created
  expect(fs.existsSync(path.join(temp, ".vscode"))).toBe(true);
  expect(fs.existsSync(path.join(temp, ".vscode/extensions.json"))).toBe(true);

  const extensions = JSON.parse(fs.readFileSync(path.join(temp, ".vscode/extensions.json"), "utf8"));
  expect(extensions).toEqual({
    recommendations: ["oven.bun-vscode"],
  });
}, 30_000);

test("bun init creates VS Code extensions.json when CURSOR_TRACE_ID is set", () => {
  const temp = tmpdirSync();

  const out = Bun.spawnSync({
    cmd: [bunExe(), "init", "-y"],
    cwd: temp,
    stdio: ["ignore", "inherit", "inherit"],
    env: { ...bunEnv, CURSOR_TRACE_ID: "test123" },
  });

  expect(out.signal).toBe(undefined);
  expect(out.exitCode).toBe(0);

  // Check that .vscode directory and extensions.json were created
  expect(fs.existsSync(path.join(temp, ".vscode"))).toBe(true);
  expect(fs.existsSync(path.join(temp, ".vscode/extensions.json"))).toBe(true);

  const extensions = JSON.parse(fs.readFileSync(path.join(temp, ".vscode/extensions.json"), "utf8"));
  expect(extensions).toEqual({
    recommendations: ["oven.bun-vscode"],
  });
}, 30_000);

test("bun init does not create VS Code files when no editor is detected", () => {
  const temp = tmpdirSync();

  const out = Bun.spawnSync({
    cmd: [bunExe(), "init", "-y"],
    cwd: temp,
    stdio: ["ignore", "inherit", "inherit"],
    env: bunEnv, // No VSCODE_PID or CURSOR_TRACE_ID
  });

  expect(out.signal).toBe(undefined);
  expect(out.exitCode).toBe(0);

  // Check that .vscode directory was not created
  expect(fs.existsSync(path.join(temp, ".vscode"))).toBe(false);
}, 30_000);

test("bun init respects BUN_VSCODE_EXTENSION_DISABLED opt-out", () => {
  const temp = tmpdirSync();

  const out = Bun.spawnSync({
    cmd: [bunExe(), "init", "-y"],
    cwd: temp,
    stdio: ["ignore", "inherit", "inherit"],
    env: { ...bunEnv, VSCODE_PID: "12345", BUN_VSCODE_EXTENSION_DISABLED: "1" },
  });

  expect(out.signal).toBe(undefined);
  expect(out.exitCode).toBe(0);

  // Check that .vscode directory was not created due to opt-out
  expect(fs.existsSync(path.join(temp, ".vscode"))).toBe(false);
}, 30_000);

test("bun init creates launch.json for basic templates with VS Code", () => {
  const temp = tmpdirSync();

  const out = Bun.spawnSync({
    cmd: [bunExe(), "init", "-y"],
    cwd: temp,
    stdio: ["ignore", "inherit", "inherit"],
    env: { ...bunEnv, VSCODE_PID: "12345" },
  });

  expect(out.signal).toBe(undefined);
  expect(out.exitCode).toBe(0);

  // Check that launch.json was created
  expect(fs.existsSync(path.join(temp, ".vscode/launch.json"))).toBe(true);

  const launch = JSON.parse(fs.readFileSync(path.join(temp, ".vscode/launch.json"), "utf8"));
  expect(launch.version).toBe("0.2.0");
  expect(launch.configurations).toHaveLength(1);
  expect(launch.configurations[0]).toMatchObject({
    name: "Debug Bun",
    type: "bun",
    request: "launch",
    program: "${workspaceFolder}/index.ts",
  });
}, 30_000);

test("bun init creates launch.json for React templates with browser debugging", () => {
  const temp = tmpdirSync();

  const out = Bun.spawnSync({
    cmd: [bunExe(), "init", "--react"],
    cwd: temp,
    stdio: ["ignore", "inherit", "inherit"],
    env: { ...bunEnv, VSCODE_PID: "12345" },
  });

  expect(out.signal).toBe(undefined);
  expect(out.exitCode).toBe(0);

  // Check that launch.json was created
  expect(fs.existsSync(path.join(temp, ".vscode/launch.json"))).toBe(true);

  const launch = JSON.parse(fs.readFileSync(path.join(temp, ".vscode/launch.json"), "utf8"));
  expect(launch.version).toBe("0.2.0");
  expect(launch.configurations).toHaveLength(2);

  // Check Bun debugger configuration
  expect(launch.configurations[0]).toMatchObject({
    name: "Debug Bun",
    type: "bun",
    request: "launch",
    program: "${workspaceFolder}/src/index.tsx",
  });

  // Check Chrome browser debugger configuration
  expect(launch.configurations[1]).toMatchObject({
    name: "Launch Chrome",
    type: "chrome",
    request: "launch",
    url: "http://localhost:3000",
    webRoot: "${workspaceFolder}/src",
  });
}, 30_000);

test("bun init does not overwrite existing .vscode/extensions.json", async () => {
  const temp = tmpdirSync();

  // Create .vscode directory and existing extensions.json
  fs.mkdirSync(path.join(temp, ".vscode"));
  const existingExtensions = {
    recommendations: ["ms-vscode.vscode-typescript-next"],
  };
  fs.writeFileSync(path.join(temp, ".vscode/extensions.json"), JSON.stringify(existingExtensions, null, 2));

  const out = Bun.spawnSync({
    cmd: [bunExe(), "init", "-y"],
    cwd: temp,
    stdio: ["ignore", "inherit", "inherit"],
    env: { ...bunEnv, VSCODE_PID: "12345" },
  });

  expect(out.signal).toBe(undefined);
  expect(out.exitCode).toBe(0);

  // Check that existing extensions.json was not overwritten
  const extensions = JSON.parse(fs.readFileSync(path.join(temp, ".vscode/extensions.json"), "utf8"));
  expect(extensions).toEqual(existingExtensions);
}, 30_000);

test("bun init does not overwrite existing .vscode/launch.json", async () => {
  const temp = tmpdirSync();

  // Create .vscode directory and existing launch.json
  fs.mkdirSync(path.join(temp, ".vscode"));
  const existingLaunch = {
    version: "0.2.0",
    configurations: [
      {
        name: "Custom Configuration",
        type: "node",
        request: "launch",
        program: "${workspaceFolder}/custom.js",
      },
    ],
  };
  fs.writeFileSync(path.join(temp, ".vscode/launch.json"), JSON.stringify(existingLaunch, null, 2));

  const out = Bun.spawnSync({
    cmd: [bunExe(), "init", "-y"],
    cwd: temp,
    stdio: ["ignore", "inherit", "inherit"],
    env: { ...bunEnv, VSCODE_PID: "12345" },
  });

  expect(out.signal).toBe(undefined);
  expect(out.exitCode).toBe(0);

  // Check that existing launch.json was not overwritten
  const launch = JSON.parse(fs.readFileSync(path.join(temp, ".vscode/launch.json"), "utf8"));
  expect(launch).toEqual(existingLaunch);

  // But extensions.json should still be created
  expect(fs.existsSync(path.join(temp, ".vscode/extensions.json"))).toBe(true);
}, 30_000);

test("bun init creates both extensions.json and launch.json together", () => {
  const temp = tmpdirSync();

  const out = Bun.spawnSync({
    cmd: [bunExe(), "init", "-y"],
    cwd: temp,
    stdio: ["ignore", "inherit", "inherit"],
    env: { ...bunEnv, CURSOR_TRACE_ID: "test123" },
  });

  expect(out.signal).toBe(undefined);
  expect(out.exitCode).toBe(0);

  // Check that both files were created
  expect(fs.existsSync(path.join(temp, ".vscode"))).toBe(true);
  expect(fs.existsSync(path.join(temp, ".vscode/extensions.json"))).toBe(true);
  expect(fs.existsSync(path.join(temp, ".vscode/launch.json"))).toBe(true);

  // Verify contents
  const extensions = JSON.parse(fs.readFileSync(path.join(temp, ".vscode/extensions.json"), "utf8"));
  expect(extensions.recommendations).toContain("oven.bun-vscode");

  const launch = JSON.parse(fs.readFileSync(path.join(temp, ".vscode/launch.json"), "utf8"));
  expect(launch.configurations[0].type).toBe("bun");
}, 30_000);
