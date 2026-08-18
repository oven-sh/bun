// these tests involve ensuring certain libraries are working correctly.  it
// should be preferred to write specific tests for the bugs that these libraries
// discovered, but it easy and still a reasonable idea to just test the library
// entirely.
import { expect } from "bun:test";
import { Client, Dev, devTest } from "../bake-harness";

/** The document served for `/`, with the generated asset hash, route id and svelte scope classes replaced and adjacent tags split onto lines. */
async function servedDocument(dev: Dev) {
  const response = await dev.fetch("/");
  const html = await response.text();
  // A throw during SSR is served as bun's fallback error page instead of the route.
  expect(response.status).toBe(200);
  return html
    .replaceAll("><", ">\n<")
    .replace(/\/_bun\/asset\/[0-9a-f]+\./, "/_bun/asset/<hash>.")
    .replace(/\/_bun\/client\/route-[0-9a-f]+\./, "/_bun/client/route-<id>.")
    .replaceAll(/svelte-[0-9a-z]+/g, "svelte-<hash>");
}

/** What the fixture serves for `/` while its two components contain the given text. */
function expectedDocument({ server, island }: { server: string; island: string }) {
  return [
    "<!DOCTYPE html>",
    "<html>",
    "<head>",
    // Only the island's stylesheet: the bundler merges the server component's CSS into the island (#36549).
    '<link rel="stylesheet" href="/_bun/asset/<hash>.css">',
    "</head>",
    "<body>",
    "<!--[-->",
    '<main class="svelte-<hash>">',
    `<h1 class="svelte-<hash>">hello</h1> <p id="server_text">${server}</p> <p>Bun v${Bun.version}</p> <bake-island id="I:0">`,
    '<div class="svelte-<hash>">',
    `<p id="counter_text" class="svelte-<hash>">${island}</p> <button>Clicked 5 times</button>`,
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
    expect(await pageState(c)).toStrictEqual({
      server: "This is my svelte server component (non-interactive)",
      island: "This is a client component (interactive island)",
      button: "Clicked 5 times",
    });
    // The island hydrated: its event handler is attached.
    await c.click("button");
    await c.expectElemText("button", "Clicked 6 times");

    // Editing the server component reloads the page, which hydrates again from the initial count.
    await c.expectReload(async () => {
      await dev.patch("pages/index.svelte", {
        find: "non-interactive",
        replace: "awesome",
      });
    });
    expect(await pageState(c)).toStrictEqual({
      server: "This is my svelte server component (awesome)",
      island: "This is a client component (interactive island)",
      button: "Clicked 5 times",
    });
    await c.click("button");
    await c.expectElemText("button", "Clicked 6 times");

    // Editing the client component is a hot update: svelte re-mounts the island, interactive again.
    await dev.patch("pages/_Counter.svelte", {
      find: "interactive island",
      replace: "magical",
    });
    expect(await pageState(c)).toStrictEqual({
      server: "This is my svelte server component (awesome)",
      island: "This is a client component (magical)",
      button: "Clicked 5 times",
    });
    await c.click("button");
    await c.expectElemText("button", "Clicked 6 times");

    // Expect SSR of both edits
    expect(await servedDocument(dev)).toBe(
      expectedDocument({
        server: "This is my svelte server component (awesome)",
        island: "This is a client component (magical)",
      }),
    );
  },
});
