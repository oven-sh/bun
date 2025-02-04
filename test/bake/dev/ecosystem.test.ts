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
devTest('svelte component islands example', {
  fixture: 'svelte-component-islands',
  async test(dev) {
    const html = await dev.fetch('/').text()
    if (html.includes('Bun__renderFallbackError')) throw new Error('failed');
    expect(html).toContain('self.$islands={\"pages/_Counter.svelte\":[[0,\"default\",{initial:5}]]}');
    expect(html).toContain(`<p>This is my svelte server component (non-interactive)</p> <p>Bun v${Bun.version}</p>`);
    expect(html).toContain(`>This is a client component (interactive island)</p>`);
    // TODO: puppeteer test for client-side interactivity, hmr.
    // care must be taken to implement this in a way that is not flaky.
  },
});
