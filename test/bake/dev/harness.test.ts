// Tests for the behavior of bake-harness.ts itself.
import { expect } from "bun:test";
import { devTest, emptyHtmlFile } from "../bake-harness";

const files = {
  "index.html": emptyHtmlFile({
    scripts: ["index.ts"],
    body: "<h1>Hello</h1>",
  }),
  "index.ts": `
    console.log("loaded");
    import.meta.hot.accept();
  `,
};

async function rejectionMessage(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err: any) {
    return err.message;
  }
  throw new Error("Expected the promise to reject");
}

// The tests below kill the client by evaluating `console.error(...)` in the
// page: client-fixture.mjs exits with exitCodeMap.consoleError ("Runtime
// error") from inside the page's console.error, so the request that ran it is
// never answered.

devTest("requests that are in flight when the client exits reject with the exit reason", {
  files,
  async test(dev) {
    const c = await dev.client("/");
    await c.expectMessage("loaded");

    // jsInteractive sends its request synchronously and the fixture handles
    // requests in order, so the client exits while handling this one and the
    // requests sent after it are still waiting for a reply when it does.
    const crash = c.jsInteractive('console.error("boom")');
    const style = c.style("h1").color;
    const notFound = c.style(".missing").notFound();
    const overlay = c.expectErrorOverlay([]);
    const js = c.js`1 + 1`;

    expect(await rejectionMessage(crash)).toBe("Client exited while evaluating JS: Runtime error");
    expect(await rejectionMessage(style)).toBe('Client exited while reading the style of "h1": Runtime error');
    expect(await rejectionMessage(notFound)).toBe('Client exited while reading the style of ".missing": Runtime error');
    expect(await rejectionMessage(overlay)).toBe("Client exited while evaluating JS: Runtime error");
    expect(await rejectionMessage(js)).toBe("Client exited while evaluating JS: Runtime error");

    expect(await rejectionMessage(c[Symbol.asyncDispose]())).toBe('Client exited: "Runtime error"');
  },
});

devTest("requests made after the client exited reject with the exit reason", {
  files,
  async test(dev) {
    const c = await dev.client("/");
    await c.expectMessage("loaded");

    expect(await rejectionMessage(c.js`console.error("boom")`)).toBe(
      "Client exited while evaluating JS: Runtime error",
    );

    expect(await rejectionMessage(c.js`1 + 1`)).toBe("Client exited while evaluating JS: Runtime error");
    expect(await rejectionMessage(c.elemText("h1"))).toBe("Client exited while evaluating JS: Runtime error");
    expect(await rejectionMessage(c.style("h1").color)).toBe(
      'Client exited while reading the style of "h1": Runtime error',
    );
    expect(await rejectionMessage(c.style(".missing").notFound())).toBe(
      'Client exited while reading the style of ".missing": Runtime error',
    );
    expect(await rejectionMessage(c.expectErrorOverlay([]))).toBe("Client exited while evaluating JS: Runtime error");

    expect(await rejectionMessage(c[Symbol.asyncDispose]())).toBe('Client exited: "Runtime error"');
  },
});

devTest("dev.write() reports a client that exits while its error overlay is being checked", {
  files,
  async test(dev) {
    const c = await dev.client("/");
    await c.expectMessage("loaded");

    // Once the clients have acknowledged a hot update, dev.write() asks each of
    // them whether the error overlay is visible, using document.querySelector.
    // The updated module makes that query the thing that kills the client, so
    // it exits while dev.write() is waiting for the answer.
    expect(
      await rejectionMessage(
        dev.write(
          "index.ts",
          `
            import.meta.hot.accept();
            document.querySelector = () => console.error("boom");
          `,
        ),
      ),
    ).toBe("Client exited while evaluating JS: Runtime error");

    expect(await rejectionMessage(c[Symbol.asyncDispose]())).toBe('Client exited: "Runtime error"');
  },
});
