// https://github.com/oven-sh/bun/issues/17056
// Circular Dependency Causes Uninitialized Error When Using Decorators
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("decorator metadata with circular imports should not cause TDZ error", async () => {
  using dir = tempDir("issue17056", {
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
        target: "ES2022",
        module: "ESNext",
      },
    }),
    "entity-a.ts": `
      import { EntityB } from "./entity-b";

      function Entity() {
        return function (target: any) {};
      }

      function Field(target: any, propertyKey: string) {}

      @Entity()
      export class EntityA {
        @Field
        value: string = "a";
      }
    `,
    "entity-b.ts": `
      import { EntityA } from "./entity-a";

      function Entity() {
        return function (target: any) {};
      }

      function Field(target: any, propertyKey: string) {}

      @Entity()
      export class EntityB {
        @Field
        reference: EntityA | null = null;
      }
    `,
    "index.ts": `
      import { EntityA } from "./entity-a";
      import { EntityB } from "./entity-b";

      const a = new EntityA();
      const b = new EntityB();

      console.log("EntityA:", a.value);
      console.log("EntityB reference:", b.reference);
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

  expect(stderr).not.toContain("ReferenceError");
  expect(stderr).not.toContain("Cannot access");
  expect(stderr).not.toContain("before initialization");
  expect(stdout).toContain("EntityA: a");
  expect(stdout).toContain("EntityB reference: null");
  expect(exitCode).toBe(0);
});

test("decorator metadata with circular imports in separate files", async () => {
  using dir = tempDir("issue17056-cross-file", {
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
        target: "ES2022",
        module: "ESNext",
      },
    }),
    "base-entity.ts": `
      export abstract class BaseEntity {
        id: number = 0;
      }
    `,
    "user.ts": `
      import { BaseEntity } from "./base-entity";
      import { Post } from "./post";

      function Entity() {
        return function (target: any) {};
      }

      function OneToMany(props: any) {
        return function (target: any, propertyKey: string) {};
      }

      @Entity()
      export class User extends BaseEntity {
        @OneToMany({ target: () => Post })
        posts: Post[] = [];
      }
    `,
    "post.ts": `
      import { BaseEntity } from "./base-entity";
      import { User } from "./user";

      function Entity() {
        return function (target: any) {};
      }

      function ManyToOne(props: any) {
        return function (target: any, propertyKey: string) {};
      }

      @Entity()
      export class Post extends BaseEntity {
        @ManyToOne({ target: () => User })
        author: User | null = null;
      }
    `,
    "index.ts": `
      import { User } from "./user";
      import { Post } from "./post";

      const user = new User();
      const post = new Post();

      console.log("User created with", user.posts.length, "posts");
      console.log("Post author:", post.author);
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

  expect(stderr).not.toContain("ReferenceError");
  expect(stderr).not.toContain("Cannot access");
  expect(stderr).not.toContain("before initialization");
  expect(stdout).toContain("User created with 0 posts");
  expect(stdout).toContain("Post author: null");
  expect(exitCode).toBe(0);
});
