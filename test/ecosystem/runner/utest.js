// https://www.npmjs.com/package/utest

export async function run(path) {
  const { mock, describe, test } = Bun.jest(path);

  mock.module("utest", () => {
    return {
      default: (title, tests) => {
        describe(title, () => {
          for (const [name, fn] of Object.entries(tests)) {
            test(name, async () => {
              await fn();
            });
          }
        });
      },
    };
  });

  await import(path);
}
