import { describe, expect, it } from "bun:test";
import { isDebug } from "harness";
import { render as svelteRender } from "svelte/server";
import "./bun-loader-svelte";

// Each reload compiles the component again through the plugin, 20-30ms apiece on a debug build, so
// 1,000 of them blow the default per-test timeout there. Release builds keep the full count: the bugs
// these loops have caught (#9521, the code cache collisions in #35778) only surfaced on a release
// build after many reloads.
const reloads = isDebug ? 50 : 1000;

describe("require", () => {
  it("SSRs `<h1>Hello world!</h1>` with Svelte", () => {
    const { default: App } = require("./hello.svelte");
    const { body } = svelteRender(App);

    expect(body).toBe("<!--[--><h1>Hello world!</h1><!--]-->");
  });

  it(`works if you require it ${reloads} times`, () => {
    const prev = Bun.unsafe.gcAggressionLevel();
    Bun.unsafe.gcAggressionLevel(0);
    for (let i = 0; i < reloads; i++) {
      const { default: App } = require("./hello.svelte?r" + i);
      expect(App).toBeFunction();
    }
    Bun.gc(true);
    Bun.unsafe.gcAggressionLevel(prev);
  });
});

describe("dynamic import", () => {
  it(`works if you import it ${reloads} times`, async () => {
    const prev = Bun.unsafe.gcAggressionLevel();
    Bun.unsafe.gcAggressionLevel(0);
    for (let i = 0; i < reloads; i++) {
      const { default: App } = await import("./hello.svelte?i" + i);
      expect(App).toBeFunction();
    }
    Bun.gc(true);
    Bun.unsafe.gcAggressionLevel(prev);
  });
  it("SSRs `<h1>Hello world!</h1>` with Svelte", async () => {
    const { default: App }: any = await import("./hello.svelte");

    const { body } = svelteRender(App);
    expect(body).toBe("<!--[--><h1>Hello world!</h1><!--]-->");
  });
});
