// these tests involve ensuring certain libraries are working correctly.  it
// should be preferred to write specific tests for the bugs that these libraries
// discovered, but it easy and still a reasonable idea to just test the library
// entirely.
import { expect } from "bun:test";
import { devTest } from "../dev-server-harness";

// Bugs discovered thanks to Svelte:
// - Circular import situations
// - export { live_binding }
// - export { x as y }
devTest("svelte component islands example", {
  fixture: "svelte-component-islands",
  timeoutMultiplier: 2,
  async test(dev) {
    const html = await dev.fetch("/").text();
    if (html.includes("Bun__renderFallbackError")) throw new Error("failed");

    // Expect SSR
    expect(html).toContain('self.$islands={"pages/_Counter.svelte":[[0,"default",{initial:5}]]}');
    expect(html).toContain(`<p>This is my svelte server component (non-interactive)</p> <p>Bun v${Bun.version}</p>`);
    expect(html).toContain(`>This is a client component (interactive island)</p>`);

    await using c = await dev.client("/");
    expect(await c.elemText("button")).toBe("Clicked 5 times");
    await c.click("button");
    await Bun.sleep(500); // TODO: de-flake event ordering.
    expect(await c.elemText("button")).toBe("Clicked 6 times");

    // TODO: plugin watch
    // await dev.patch("pages/index.svelte", {
    //   find: "non-interactive",
    //   replace: "awesome",
    // });

    // const html2 = await dev.fetch("/").text();
    // if (html2.includes("Bun__renderFallbackError")) throw new Error("failed");

    // // Expect SSR
    // expect(html2).toContain(`<p>This is my svelte server component (awesome)</p> <p>Bun v${Bun.version}</p>`);
    // expect(html2).toContain(`>This is a client component (interactive island)</p>`);
  },
});
