import { describe, expect, it } from "bun:test";
import "./bun-loader-svelte";

describe("require", () => {
  it("SSRs `<h1>Hello world!</h1>` with Svelte", () => {
    const { default: App } = require("./hello.svelte");
    const { html } = App.render();

    expect(html).toBe("<h1>Hello world!</h1>");
  });
});

describe("dynamic import", () => {
  it("SSRs `<h1>Hello world!</h1>` with Svelte", async () => {
    const { default: App }: any = await import("./hello.svelte");

    const { html } = App.render();

    expect(html).toBe("<h1>Hello world!</h1>");
  });
});
