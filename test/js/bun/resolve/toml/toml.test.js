import { expect, it } from "bun:test";
import tomlFromCustomTypeAttribute from "./toml-fixture.toml.txt" with { type: "toml" };

function checkToml(toml) {
  expect(toml.framework).toBe("next");
  expect(toml.bundle.packages["@emotion/react"]).toBe(true);
  expect(toml.array[0].entry_one).toBe("one");
  expect(toml.array[0].entry_two).toBe("two");
  expect(toml.array[1].entry_one).toBe("three");
  expect(toml.array[1].entry_two).toBe(undefined);
  expect(toml.array[1].nested[0].entry_one).toBe("four");
  expect(toml.dev.one.two.three).toBe(4);
  expect(toml.dev.foo).toBe(123);
  expect(toml.inline.array[0]).toBe(1234);
  expect(toml.inline.array[1]).toBe(4);
  expect(toml.dev["foo.bar"]).toBe("baz");
  expect(toml.install.scopes["@mybigcompany"].url).toBe("https://registry.mybigcompany.com");
  expect(toml.install.scopes["@mybigcompany2"].url).toBe("https://registry.mybigcompany.com");
  expect(toml.install.scopes["@mybigcompany3"].three).toBe(4);
  expect(toml.install.cache.dir).toBe("C:\\Windows\\System32");
  expect(toml.install.cache.dir2).toBe("C:\\Windows\\System32\\🏳️‍🌈");
}

it("via dynamic import", async () => {
  const toml = (await import("./toml-fixture.toml")).default;
  checkToml(toml);
});

it("via import type toml", async () => {
  checkToml(tomlFromCustomTypeAttribute);
});

it("via dynamic import with type attribute", async () => {
  delete require.cache[require.resolve("./toml-fixture.toml.txt")];
  const toml = (await import("./toml-fixture.toml.txt", { with: { type: "toml" } })).default;
  checkToml(toml);
});
