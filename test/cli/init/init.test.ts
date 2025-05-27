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
