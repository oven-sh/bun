import { expect, test } from "bun:test";

test("ShadowRealm importValue with nonexistent module does not crash", async () => {
  const realm = new ShadowRealm();
  // importValue returns a promise that rejects when the module is not found.
  // This must not crash (e.g. via an assertion failure) even though the
  // rejection handler re-throws across realms.
  await expect(async () => {
    await realm.importValue("nonexistent_module", "foo");
  }).toThrow();
});

test("ShadowRealm multiple importValue rejections do not crash", async () => {
  const realm = new ShadowRealm();
  const promises = [];
  for (let i = 0; i < 5; i++) {
    promises.push(realm.importValue(`nonexistent_${i}`, "bar"));
  }
  const results = await Promise.allSettled(promises);
  for (const result of results) {
    expect(result.status).toBe("rejected");
  }
  Bun.gc(true);
});
