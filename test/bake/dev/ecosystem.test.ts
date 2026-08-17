// these tests involve ensuring certain libraries are working correctly.  it
// should be preferred to write specific tests for the bugs that these libraries
// discovered, but it easy and still a reasonable idea to just test the library
// entirely.
import { expect } from "bun:test";
import { Client, Dev, devTest } from "../bake-harness";

/**
 * The document served for `/`, with the names bake generates replaced (the
 * stylesheet name is a hash, and the route script's name ends in a generation
 * that is re-randomized whenever the route's client bundle is invalidated) and
 * adjacent tags put on separate lines, matching `expectedDocument`.
 */
async function servedDocument(dev: Dev) {
  const response = await dev.fetch("/");
  const html = await response.text();
  // A throw during SSR is served as bun's fallback error page instead of the route.
  expect(response.status).toBe(200);
  return html
    .replaceAll("><", ">\n<")
    .replace(/\/_bun\/asset\/[0-9a-f]+\./, "/_bun/asset/<hash>.")
    .replace(/\/_bun\/client\/route-[0-9a-f]+\./, "/_bun/client/route-<id>.");
}

/** What the fixture serves for `/` while its two components contain the given text. */
function expectedDocument({ server, island }: { server: string; island: string }) {
  return [
    "<!DOCTYPE html>",
    "<html>",
    "<head>",
    // Only the island's stylesheet: the plugin gives each component's CSS the
    // component's own path in another namespace, and the bundler currently
    // merges the server component's CSS into the component itself (#36549).
    '<link rel="stylesheet" href="/_bun/asset/<hash>.css">',
    "</head>",
    "<body>",
    "<!--[-->",
    '<main class="svelte-1f5jrvn">',
    `<h1 class="svelte-1f5jrvn">hello</h1> <p id="server_text">${server}</p> <p>Bun v${Bun.version}</p> <bake-island id="I:0">`,
    '<div class="svelte-lmhtl6">',
    `<p id="counter_text" class="svelte-lmhtl6">${island}</p> <button>Clicked 5 times</button>`,
    "</div>",
    "</bake-island>",
    "<!---->",
    "</main>",
    "<!--]-->",
    "</body>",
    '<script>self.$islands={"pages/_Counter.svelte":[[0,"default",{initial:5}]]}</script>',
    '<script type="module" src="/_bun/client/route-<id>.js">',
    "</script>",
    "</html>",
  ].join("\n");
}

/** The text of the server component, the island and the island's button, as currently rendered by the page. */
function pageState(c: Client) {
  return c.js<{ server: string; island: string; button: string }>`
    return {
      server: document.querySelector("#server_text").textContent,
      island: document.querySelector("#counter_text").textContent,
      button: document.querySelector("button").textContent,
    };
  `;
}

/**
 * Clicks the island's button and returns its text once svelte has flushed the
 * resulting DOM update, which happens asynchronously after the click.
 */
function clickButton(c: Client) {
  return c.js<string>`
    const button = document.querySelector("button");
    const before = button.textContent;
    const changed = new Promise(resolve => {
      new MutationObserver((_, observer) => {
        if (button.textContent === before) return;
        observer.disconnect();
        resolve(button.textContent);
      }).observe(button, { childList: true, characterData: true, subtree: true });
    });
    button.click();
    return await changed;
  `;
}

// Bugs discovered thanks to Svelte:
// - Circular import situations
// - export { live_binding }
// - export { x as y }
devTest("svelte component islands example", {
  fixture: "svelte-component-islands",
  skip: ["win32"],
  async test(dev) {
    // Expect SSR
    expect(await servedDocument(dev)).toBe(
      expectedDocument({
        server: "This is my svelte server component (non-interactive)",
        island: "This is a client component (interactive island)",
      }),
    );

    await using c = await dev.client("/");
    expect(await pageState(c)).toEqual({
      server: "This is my svelte server component (non-interactive)",
      island: "This is a client component (interactive island)",
      button: "Clicked 5 times",
    });
    // The island hydrated: its event handler is attached.
    expect(await clickButton(c)).toBe("Clicked 6 times");

    // Editing the server component reloads the page, which is rendered with
    // the edit, hydrated again, and so starts over from the initial count.
    await c.expectReload(async () => {
      await dev.patch("pages/index.svelte", {
        find: "non-interactive",
        replace: "awesome",
      });
    });
    expect(await pageState(c)).toEqual({
      server: "This is my svelte server component (awesome)",
      island: "This is a client component (interactive island)",
      button: "Clicked 5 times",
    });
    expect(await clickButton(c)).toBe("Clicked 6 times");

    // Editing the client component is a hot update delivered to the reloaded
    // page: the server component is untouched, and svelte re-mounts the island,
    // which is interactive again.
    await dev.patch("pages/_Counter.svelte", {
      find: "interactive island",
      replace: "magical",
    });
    expect(await pageState(c)).toEqual({
      server: "This is my svelte server component (awesome)",
      island: "This is a client component (magical)",
      button: "Clicked 5 times",
    });
    expect(await clickButton(c)).toBe("Clicked 6 times");

    // Expect SSR of both edits
    expect(await servedDocument(dev)).toBe(
      expectedDocument({
        server: "This is my svelte server component (awesome)",
        island: "This is a client component (magical)",
      }),
    );
  },
});
