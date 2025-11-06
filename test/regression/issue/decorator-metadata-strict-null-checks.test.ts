import { test, expect } from "bun:test";
import { tempDir, bunEnv, bunExe } from "harness";

test("strictNullChecks: true - unions with null emit Object", async () => {
  using dir = tempDir("strict-null-checks-true", {
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
        strictNullChecks: true,
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

  expect(stderr).not.toContain("Cannot access");
  expect(stderr).not.toContain("before initialization");
  expect(stdout).toContain("profile: Object");
  expect(stdout).toContain("user: Object");
  expect(stdout).toContain("SUCCESS");
  expect(exitCode).toBe(0);
}, 30000);

test("strictNullChecks: false - unions with null emit actual type (causes TDZ in circular refs)", async () => {
  using dir = tempDir("strict-null-checks-false", {
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
        strictNullChecks: false,
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

  const [_, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // With strictNullChecks: false, we emit the actual class type
  // This causes TDZ errors in circular reference cases (matching TypeScript behavior)
  expect(stderr).toContain("Cannot access");
  expect(stderr).toContain("before initialization");
  expect(exitCode).not.toBe(0);
}, 30000);

test("strict: true enables strictNullChecks by default", async () => {
  using dir = tempDir("strict-true", {
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
        strict: true,
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
        bio: string = "";
      }

      console.log("SUCCESS");
    `,
    "package.json": JSON.stringify({
      dependencies: {
        "reflect-metadata": "latest",
      },
    }),
  });

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

  expect(stderr).not.toContain("Cannot access");
  expect(stdout).toContain("profile: Object"); // strict: true enables strictNullChecks
  expect(stdout).toContain("SUCCESS");
  expect(exitCode).toBe(0);
}, 30000);

test("explicit strictNullChecks: false overrides strict: true", async () => {
  using dir = tempDir("strict-override", {
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
        strict: true,
        strictNullChecks: false,
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
        bio: string = "";
      }

      console.log("SUCCESS");
    `,
    "package.json": JSON.stringify({
      dependencies: {
        "reflect-metadata": "latest",
      },
    }),
  });

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

  const [_, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Explicit strictNullChecks: false overrides strict: true, causing TDZ
  expect(stderr).toContain("Cannot access");
  expect(stderr).toContain("before initialization");
  expect(exitCode).not.toBe(0);
}, 30000);

test("no strictNullChecks config defaults to false (causes TDZ)", async () => {
  using dir = tempDir("no-strict-config", {
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
        bio: string = "";
      }

      console.log("SUCCESS");
    `,
    "package.json": JSON.stringify({
      dependencies: {
        "reflect-metadata": "latest",
      },
    }),
  });

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

  const [_, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Default is false when neither strict nor strictNullChecks is specified, causing TDZ
  expect(stderr).toContain("Cannot access");
  expect(stderr).toContain("before initialization");
  expect(exitCode).not.toBe(0);
}, 30000);
