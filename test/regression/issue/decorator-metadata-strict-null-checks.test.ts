import { test, expect } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";

test.concurrent("strictNullChecks: true - unions with null emit Object", async () => {
  const files = {
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
        strictNullChecks: true,
      },
    }),
    "test.ts": `
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
  };

  const dir = tempDirWithFiles("strict-null-checks-true", files);

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test.ts"],
    env: bunEnv,
    cwd: dir,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(stderr).not.toContain("Cannot access");
  expect(stderr).not.toContain("before initialization");
  expect(stdout).toContain("profile: Object");
  expect(stdout).toContain("user: Object");
  expect(stdout).toContain("SUCCESS");
  expect(exitCode).toBe(0);
});

test.concurrent("strictNullChecks: false - unions with null emit actual type (causes TDZ)", async () => {
  const files = {
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
        strictNullChecks: false,
      },
    }),
    "test.ts": `
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
  };

  const dir = tempDirWithFiles("strict-null-checks-false", files);

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test.ts"],
    env: bunEnv,
    cwd: dir,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

  expect(stderr).toContain("Cannot access");
  expect(stderr).toContain("before initialization");
  expect(exitCode).not.toBe(0);
});

test.concurrent("strict: true enables strictNullChecks by default", async () => {
  const files = {
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
        strict: true,
      },
    }),
    "test.ts": `
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
  };

  const dir = tempDirWithFiles("strict-true", files);

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test.ts"],
    env: bunEnv,
    cwd: dir,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(stderr).not.toContain("Cannot access");
  expect(stdout).toContain("profile: Object");
  expect(stdout).toContain("bio: String");
  expect(stdout).toContain("SUCCESS");
  expect(exitCode).toBe(0);
});

test.concurrent("explicit strictNullChecks: false overrides strict: true", async () => {
  const files = {
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
        strict: true,
        strictNullChecks: false,
      },
    }),
    "test.ts": `
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
  };

  const dir = tempDirWithFiles("strict-override", files);

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test.ts"],
    env: bunEnv,
    cwd: dir,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

  expect(stderr).toContain("Cannot access");
  expect(stderr).toContain("before initialization");
  expect(exitCode).not.toBe(0);
});

test.concurrent("no strictNullChecks config defaults to false (causes TDZ)", async () => {
  const files = {
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
      },
    }),
    "test.ts": `
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
  };

  const dir = tempDirWithFiles("no-strict-config", files);

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test.ts"],
    env: bunEnv,
    cwd: dir,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

  expect(stderr).toContain("Cannot access");
  expect(stderr).toContain("before initialization");
  expect(exitCode).not.toBe(0);
});
