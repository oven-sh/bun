import { PrismaClient } from "@prisma/client";
import { test, expect, beforeAll } from "bun:test";
import { bunExe, bunEnv } from "harness";
import path from "path";

function* TestIDGenerator() {
  let i = 0;
  while (true) {
    yield i++;
  }
}
const test_id = TestIDGenerator();
async function getPrisma(callback: Function) {
  const prisma = new PrismaClient();
  try {
    await callback(prisma, test_id.next().value);
  } finally {
    await prisma.$disconnect();
  }
}

beforeAll(async () => {
  //spawn command bunx prisma migrate dev --name init
  const cwd = import.meta.dir;
  const result = Bun.spawnSync([bunExe(), "x", "prisma", "migrate", "dev", "--name", "init", "--schema", path.join(cwd, "prisma", "schema.prisma")], {
    cwd,
    env: {
      ...bunEnv,
      NODE_ENV: undefined,
    },
  });
  if (!result.success) throw new Error(result.stderr.toString("utf8"));
  return {
    stdout: result.stdout.toString("utf8").trim(),
    stderr: result.stderr.toString("utf8").trim(),
  };
});

test("CRUD basics", async () => {
  await getPrisma(async (prisma: PrismaClient, testId: number) => {
    const user = await prisma.user.create({
      data: {
        testId,
        name: "Test",
        email: "test@oven.sh",
      },
    });

    expect(user?.name).toBe("Test");
    expect(user?.email).toBe("test@oven.sh");
    expect(user?.testId).toBe(testId);

    const users = await prisma.user.findMany({
      where: {
        testId,
        name: "Test",
      },
    });

    expect(users.length).toBe(1);

    const updatedUser = await prisma.user.update({
      where: {
        id: user.id,
      },
      data: {
        name: "Test2",
      },
    });

    expect(updatedUser?.name).toBe("Test2");

    const deletedUser = await prisma.user.delete({ where: { id: user.id } });

    expect(deletedUser?.name).toBe("Test2");
  });
});

test("CRUD with relations", async () => {
  await getPrisma(async (prisma: PrismaClient, testId: number) => {
    const user = await prisma.user.create({
      data: {
        testId,
        name: "Test",
        email: "test@oven.sh",
        posts: {
          create: {
            testId,
            title: "Hello World",
          },
        },
      },
    });

    expect(user?.name).toBe("Test");
    expect(user?.email).toBe("test@oven.sh");
    expect(user?.testId).toBe(testId);

    const usersWithPosts = await prisma.user.findMany({
      include: {
        posts: true,
      },
    });

    expect(usersWithPosts.length).toBe(1);
    expect(usersWithPosts[0]?.posts?.length).toBe(1);
    expect(usersWithPosts[0]?.posts[0]?.title).toBe("Hello World");

    expect(async ()=>  await prisma.user.deleteMany({ where: { testId } })).toThrow();
    
    const deletedPosts = await prisma.post.deleteMany({ where: { testId } });

    expect(deletedPosts?.count).toBe(1);

    const deletedUser = await prisma.user.deleteMany({ where: { testId } });
    
    expect(deletedUser?.count).toBe(1);
  });
});
