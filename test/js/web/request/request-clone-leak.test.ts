import { test, expect } from "bun:test";

const constructorArgs = [
  [
    new Request("http://foo/", {
      body: "ahoyhoy",
      method: "POST",
    }),
  ],
  [
    "http://foo/",
    {
      body: "ahoyhoy",
      method: "POST",
    },
  ],
  [
    new URL("http://foo/"),
    {
      body: "ahoyhoy",
      method: "POST",
    },
  ],
  [
    new Request("http://foo/", {
      body: "ahoyhoy",
      method: "POST",
      headers: {
        "test-header": "value",
      },
    }),
  ],
  [
    "http://foo/",
    {
      body: "ahoyhoy",
      method: "POST",
      headers: {
        "test-header": "value",
      },
    },
  ],
  [
    new URL("http://foo/"),
    {
      body: "ahoyhoy",
      method: "POST",
      headers: {
        "test-header": "value",
      },
    },
  ],
];
for (let i = 0; i < constructorArgs.length; i++) {
  const args = constructorArgs[i];
  test("new Request(test #" + i + ")", () => {
    Bun.gc(true);

    for (let i = 0; i < 1000; i++) {
      new Request(...args);
    }

    Bun.gc(true);
    const baseline = (process.memoryUsage.rss() / 1024 / 1024) | 0;
    for (let i = 0; i < 2000; i++) {
      for (let j = 0; j < 500; j++) {
        new Request(...args);
      }
      Bun.gc();
    }
    Bun.gc(true);

    const memory = (process.memoryUsage.rss() / 1024 / 1024) | 0;
    const delta = Math.max(memory, baseline) - Math.min(baseline, memory);
    console.log("RSS delta: ", delta, "MB");
    expect(delta).toBeLessThan(30);
  });

  test("request.clone(test #" + i + ")", () => {
    Bun.gc(true);

    for (let i = 0; i < 1000; i++) {
      const request = new Request(...args);
      request.clone();
    }

    Bun.gc(true);
    const baseline = (process.memoryUsage.rss() / 1024 / 1024) | 0;
    for (let i = 0; i < 2000; i++) {
      for (let j = 0; j < 500; j++) {
        const request = new Request(...args);
        request.clone();
      }
      Bun.gc();
    }
    Bun.gc(true);

    const memory = (process.memoryUsage.rss() / 1024 / 1024) | 0;
    const delta = Math.max(memory, baseline) - Math.min(baseline, memory);
    console.log("RSS delta: ", delta, "MB");
    expect(delta).toBeLessThan(30);
  });
}
