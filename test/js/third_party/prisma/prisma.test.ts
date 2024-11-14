import { createCanvas } from "@napi-rs/canvas";
import { it as bunIt, test as bunTest, describe, expect } from "bun:test";
import { generate, generateClient } from "./helper.ts";
import type { PrismaClient } from "./prisma/types.d.ts";

function* TestIDGenerator(): Generator<number> {
  while (true) {
    yield Math.floor(1 + Math.random() * 2147483648);
  }
}
const test_id = TestIDGenerator();

async function cleanTestId(prisma: PrismaClient, testId: number) {
  try {
    await prisma.post.deleteMany({ where: { testId } });
    await prisma.user.deleteMany({ where: { testId } });
  } catch {}
}
["sqlite", "postgres" /*"mssql", "mongodb"*/].forEach(async type => {
  let Client: typeof PrismaClient;

  try {
    if (type !== "sqlite" && !process.env[`TLS_${type.toUpperCase()}_DATABASE_URL`]) {
      throw new Error(`$TLS_${type.toUpperCase()}_DATABASE_URL is not set`);
    }

    Client = await generateClient(type);
  } catch (err: any) {
    console.warn(`Skipping ${type} tests, failed to generate/migrate`, err.message);
  }

  async function test(label: string, callback: Function, timeout: number = 5000) {
    const it = Client ? bunTest : bunTest.skip;

    it(
      label,
      async () => {
        const prisma = new Client();
        const currentTestId = test_id.next().value;
        await cleanTestId(prisma, currentTestId);
        try {
          await callback(prisma, currentTestId);
        } finally {
          await prisma.$disconnect();
        }
      },
      timeout,
    );
  }

  describe(`prisma ${type}`, () => {
    if (type === "postgres") {
      // https://github.com/oven-sh/bun/issues/7864
      test("memory issue reproduction issue #7864", async (client, testId) => {
        async function causeError() {
          // 1. Some DB query
          const tx = client.$executeRaw`SELECT pg_sleep(0.001)`;
          // 2. Some napi-based operation
          createCanvas(10, 10);
          // 3. Wait for the DB query to finish
          await tx;
        }

        for (let i = 0; i < 20; i++) {
          try {
            await causeError();
          } catch (e) {
            console.log(`Encountered error after ${i + 1} iterations`);
            throw e;
          }
        }

        expect().pass();
      });
    }

    test(
      "CRUD basics",
      async (prisma: PrismaClient, testId: number) => {
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
      },
      20000,
    );

    test(
      "CRUD with relations",
      async (prisma: PrismaClient, testId: number) => {
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
          where: {
            testId,
          },
          include: {
            posts: true,
          },
        });

        expect(usersWithPosts.length).toBe(1);

        expect(async () => await prisma.user.deleteMany({ where: { testId } })).toThrow();

        const deletedPosts = await prisma.post.deleteMany({ where: { testId } });

        expect(deletedPosts?.count).toBe(1);

        const deletedUser = await prisma.user.deleteMany({ where: { testId } });

        expect(deletedUser?.count).toBe(1);
      },
      20000,
    );

    test(
      "Should execute multiple commands at the same time",
      async (prisma: PrismaClient, testId: number) => {
        function user(i: number) {
          return {
            testId,
            name: `Test${i}`,
            email: `test${i}@oven.sh`,
          };
        }
        const createdUsers = await Promise.all(
          new Array(10).fill(0).map((_, i) =>
            prisma.user.create({
              data: user(i),
            }),
          ),
        );
        expect(createdUsers.length).toBe(10);

        createdUsers.forEach((user, i) => {
          expect(user?.name).toBe(`Test${i}`);
          expect(user?.email).toBe(`test${i}@oven.sh`);
        });

        createdUsers.sort((a, b) => a.id - b.id);

        for (let i = 0; i < 10; i++) {
          const loadAllUsers10Times = await Promise.all(
            new Array(10).fill(0).map(() => prisma.user.findMany({ where: { testId }, orderBy: { id: "asc" } })),
          );
          for (const users of loadAllUsers10Times) {
            expect(users).toEqual(createdUsers);
          }
          Bun.gc(true);
        }

        const deletedUser = await prisma.user.deleteMany({ where: { testId } });

        expect(deletedUser?.count).toBe(10);
      },
      20000,
    );

    bunIt("generates client successfully", async () => {
      try {
        generate(type);
      } catch (err: any) {
        // already generated from previous test, ignore error
        if (err.message.indexOf("EPERM: operation not permitted, unlink") === -1) throw err;
      }
    });
  });
});
