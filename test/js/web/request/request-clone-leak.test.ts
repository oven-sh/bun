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
] as const;
for (let i = 0; i < constructorArgs.length; i++) {
  const args = constructorArgs[i];
  test.leak("new Request(test #" + i + ")", async () => {
    new Request(...args);
  });

  test.leak("request.clone(test #" + i + ")", async () => {
    const request = new Request(...args);
    request.clone();
  });
}
