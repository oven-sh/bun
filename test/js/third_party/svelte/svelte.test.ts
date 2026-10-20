import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { render as svelteRender } from "svelte/server";
import "./bun-loader-svelte";

describe("require", () => {
  it("SSRs `<h1>Hello world!</h1>` with Svelte", () => {
    const { default: App } = require("./hello.svelte");
    const { body } = svelteRender(App);

    expect(body).toBe("<!--[--><h1>Hello world!</h1><!--]-->");
  });

  it("works if you require it 1,000 times", () => {
    const prev = Bun.unsafe.gcAggressionLevel();
    Bun.unsafe.gcAggressionLevel(0);
    for (let i = 0; i < 1000; i++) {
      const { default: App } = require("./hello.svelte?r" + i);
      expect(App).toBeFunction();
    }
    Bun.gc(true);
    Bun.unsafe.gcAggressionLevel(prev);
  });
});

describe("dynamic import", () => {
  it("works if you import it 1,000 times", async () => {
    const prev = Bun.unsafe.gcAggressionLevel();
    Bun.unsafe.gcAggressionLevel(0);
    for (let i = 0; i < 1000; i++) {
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

it("has the positions in the .svelte file in error.stack, with Svelte's source map", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "--preload",
      "./bun-loader-svelte-source-map.ts",
      "-e",
      `
        import { render } from "svelte/server";
        import App from "./throws.svelte";
        try {
          render(App);
        } catch (e) {
          console.log(e.stack.match(/throws\\.svelte:\\d+:\\d+/g).join(" "));
        }
      `,
    ],
    env: bunEnv,
    cwd: import.meta.dir,
    stdout: "pipe",
    stderr: "inherit",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect(stdout).toBe("throws.svelte:4:15 throws.svelte:6:3\n");
  expect(exitCode).toBe(0);
});
