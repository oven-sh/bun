import { test, expect } from "bun:test";
import { tempDirWithFiles, bunEnv, bunExe, nodeExe } from "harness";

test.concurrent("decorator metadata with union types emits Object", async () => {
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

  const dir = tempDirWithFiles("decorator-union", files);

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test.ts"],
    env: bunEnv,
    cwd: dir,
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
});

test("Bun matches TypeScript with strictNullChecks", async () => {
  const node = nodeExe();
  if (!node) {
    console.log("Skipping test: Node.js not found");
    return;
  }

  const files = {
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
  };

  const dir = tempDirWithFiles("tsc-bun-comparison", files);

  const tscProc = Bun.spawn({
    cmd: [bunExe(), "x", "tsc"],
    cwd: dir,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const bunBuildResult = Bun.build({
    entrypoints: [`${dir}/test.ts`],
    outdir: dir,
    naming: "test-bun.js",
  });

  await Promise.all([tscProc.exited, bunBuildResult]);

  const tscOutput = await Bun.file(`${dir}/test.js`).text();
  const bunOutput = await Bun.file(`${dir}/test-bun.js`).text();

  const tscMetadata = tscOutput.match(/__metadata\("design:type", (\w+)\)/g) || [];
  const bunMetadata = bunOutput.match(/__legacyMetadataTS\("design:type", (\w+)\)/g) || [];

  const tscTypes = tscMetadata.map(m => m.match(/(\w+)\)$/)?.[1]).filter(Boolean);
  const bunTypes = bunMetadata.map(m => m.match(/(\w+)\)$/)?.[1]).filter(Boolean);

  expect(tscTypes).toEqual(["String", "Object", "Object", "String", "String"]);
  expect(bunTypes).toEqual(["String", "Object", "Object", "String", "String"]);
  expect(bunTypes).toEqual(tscTypes);
});

test.concurrent("decorator metadata with non-union types emits actual type", async () => {
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
        name: string = "";

        @Property()
        age: number = 0;

        @Property()
        active: boolean = true;
      }

      console.log("SUCCESS");
    `,
  };

  const dir = tempDirWithFiles("decorator-non-union", files);

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test.ts"],
    env: bunEnv,
    cwd: dir,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

  expect(stdout).toContain("name: String");
  expect(stdout).toContain("age: Number");
  expect(stdout).toContain("active: Boolean");
  expect(stdout).toContain("SUCCESS");
  expect(exitCode).toBe(0);
});

test.concurrent("ORM pattern with circular references works", async () => {
  const files = {
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
        strictNullChecks: true,
      },
    }),
    "test.ts": `
      function OneToOne(fn: () => any) {
        return function (target: any, propertyKey: string) {
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
  };

  const dir = tempDirWithFiles("orm-circular", files);

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test.ts"],
    env: bunEnv,
    cwd: dir,
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

test.concurrent("mixed union and non-union types", async () => {
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
  };

  const dir = tempDirWithFiles("mixed-types", files);

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test.ts"],
    env: bunEnv,
    cwd: dir,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

  expect(stdout).toContain("id: Number");
  expect(stdout).toContain("name: String");
  expect(stdout).toContain("profile: Object");
  expect(stdout).toContain("settings: Object");
  expect(stdout).toContain("bio: String");
  expect(stdout).toContain("theme: String");
  expect(stdout).toContain("SUCCESS");
  expect(exitCode).toBe(0);
});
