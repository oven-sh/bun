import { test, expect } from "bun:test";
import { tempDir, bunEnv, bunExe, nodeExe } from "harness";

test("decorator metadata with union types emits Object", async () => {
  using dir = tempDir("decorator-union", {
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
      },
    }),
    "index.ts": `
      import "reflect-metadata";

      function Property() {
        return function (target: any, propertyKey: string) {
          const designType = Reflect.getMetadata("design:type", target, propertyKey);
          console.log(\`\${propertyKey}: \${designType?.name || designType}\`);
        };
      }

      class User {
        @Property()
        profile: Profile | null = null;
      }

      class Profile {
        @Property()
        user: User | null = null;
      }

      console.log("SUCCESS");
    `,
    "package.json": JSON.stringify({
      dependencies: {
        "reflect-metadata": "latest",
      },
    }),
  });

  // Install dependencies
  const installProc = Bun.spawn({
    cmd: [bunExe(), "install"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  await installProc.exited;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.ts"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Should not have TDZ errors
  expect(stderr).not.toContain("Cannot access");
  expect(stderr).not.toContain("before initialization");

  // Should emit Object for union types (treating as strictNullChecks: true)
  expect(stdout).toContain("profile: Object");
  expect(stdout).toContain("user: Object");
  expect(stdout).toContain("SUCCESS");
  expect(exitCode).toBe(0);
}, 30000);

test("Bun matches TypeScript with strictNullChecks", async () => {
  const node = nodeExe();
  if (!node) {
    console.log("Skipping test: Node.js not found");
    return;
  }

  using dir = tempDir("tsc-bun-comparison", {
    "package.json": JSON.stringify({
      name: "tsc-comparison",
      devDependencies: {
        "typescript": "~4.9.0",
      },
    }),
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
        target: "ES2015",
        module: "commonjs",
        strict: true,
        strictNullChecks: true,
      },
      files: ["test.ts"],
    }),
    "test.ts": `
      function Property() {
        return function (_target: any, _propertyKey: string) {};
      }

      class User {
        @Property()
        name: string = "";

        @Property()
        profile: Profile | null = null;

        @Property()
        settings: Settings | undefined;
      }

      class Profile {
        @Property()
        bio: string = "";
      }

      class Settings {
        @Property()
        theme: string = "light";
      }
    `,
  });

  // Install TypeScript
  const installProc = Bun.spawn({
    cmd: [bunExe(), "install"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  await installProc.exited;

  // Compile with TypeScript
  const tscProc = Bun.spawn({
    cmd: [bunExe(), "x", "tsc"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  await tscProc.exited;

  // Compile with Bun
  const bunBuildProc = Bun.spawn({
    cmd: [bunExe(), "build", "test.ts", "--outfile=test-bun.js"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  await bunBuildProc.exited;

  // Read both outputs
  const tscOutput = await Bun.file(`${dir}/test.js`).text();
  const bunOutput = await Bun.file(`${dir}/test-bun.js`).text();

  // Extract metadata calls
  const tscMetadata = tscOutput.match(/__metadata\("design:type", (\w+)\)/g) || [];
  const bunMetadata = bunOutput.match(/__legacyMetadataTS\("design:type", (\w+)\)/g) || [];

  // Extract just the type names
  const tscTypes = tscMetadata.map(m => m.match(/(\w+)\)$/)?.[1]).filter(Boolean);
  const bunTypes = bunMetadata.map(m => m.match(/(\w+)\)$/)?.[1]).filter(Boolean);

  // Both should emit the same types
  expect(tscTypes).toEqual(["String", "Object", "Object", "String", "String"]);
  expect(bunTypes).toEqual(["String", "Object", "Object", "String", "String"]);
  expect(bunTypes).toEqual(tscTypes);
}, 30000);

test("decorator metadata with non-union types emits actual type", async () => {
  using dir = tempDir("decorator-non-union", {
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
      },
    }),
    "index.ts": `
      import "reflect-metadata";

      function Property() {
        return function (target: any, propertyKey: string) {
          const designType = Reflect.getMetadata("design:type", target, propertyKey);
          console.log(\`\${propertyKey}: \${designType?.name || designType}\`);
        };
      }

      class User {
        @Property()
        name: string = "";

        @Property()
        age: number = 0;

        @Property()
        active: boolean = true;
      }

      console.log("SUCCESS");
    `,
    "package.json": JSON.stringify({
      dependencies: {
        "reflect-metadata": "latest",
      },
    }),
  });

  // Install dependencies
  const installProc = Bun.spawn({
    cmd: [bunExe(), "install"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  await installProc.exited;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.ts"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout).toContain("name: String");
  expect(stdout).toContain("age: Number");
  expect(stdout).toContain("active: Boolean");
  expect(stdout).toContain("SUCCESS");
  expect(exitCode).toBe(0);
}, 30000);

test("ORM pattern with circular references works", async () => {
  using dir = tempDir("orm-circular", {
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
      },
    }),
    "index.ts": `
      function OneToOne(fn: () => any) {
        return function (target: any, propertyKey: string) {
          // Store the function like real ORMs do (don't call it during decoration)
          console.log(\`Decorated: \${propertyKey}\`);
        };
      }

      class ScheduledRequest {
        @OneToOne(() => RequestInvocation)
        processedByRequest: RequestInvocation | null = null;
      }

      class RequestInvocation {
        @OneToOne(() => ScheduledRequest)
        scheduledRequest: ScheduledRequest | null = null;
      }

      console.log("SUCCESS");
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.ts"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).not.toContain("Cannot access");
  expect(stderr).not.toContain("before initialization");
  expect(stdout).toContain("Decorated: processedByRequest");
  expect(stdout).toContain("Decorated: scheduledRequest");
  expect(stdout).toContain("SUCCESS");
  expect(exitCode).toBe(0);
});

test("mixed union and non-union types", async () => {
  using dir = tempDir("mixed-types", {
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
      },
    }),
    "index.ts": `
      import "reflect-metadata";

      function Property() {
        return function (target: any, propertyKey: string) {
          const designType = Reflect.getMetadata("design:type", target, propertyKey);
          console.log(\`\${propertyKey}: \${designType?.name || designType}\`);
        };
      }

      class User {
        @Property()
        id: number = 0;

        @Property()
        name: string = "";

        @Property()
        profile: Profile | null = null;

        @Property()
        settings: Settings | undefined = undefined;
      }

      class Profile {
        @Property()
        bio: string = "";
      }

      class Settings {
        @Property()
        theme: string = "light";
      }

      console.log("SUCCESS");
    `,
    "package.json": JSON.stringify({
      dependencies: {
        "reflect-metadata": "latest",
      },
    }),
  });

  // Install dependencies
  const installProc = Bun.spawn({
    cmd: [bunExe(), "install"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  await installProc.exited;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.ts"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout).toContain("id: Number");
  expect(stdout).toContain("name: String");
  expect(stdout).toContain("profile: Object"); // Union with null
  expect(stdout).toContain("settings: Object"); // Union with undefined
  expect(stdout).toContain("bio: String");
  expect(stdout).toContain("theme: String");
  expect(stdout).toContain("SUCCESS");
  expect(exitCode).toBe(0);
}, 30000);
