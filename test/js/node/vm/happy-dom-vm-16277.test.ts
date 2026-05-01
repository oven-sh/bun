import { expect, test } from "bun:test";
import { Window } from "happy-dom";
test("reproduction", async (): Promise<undefined> => {
  expect.assertions(1);
  for (let i: number = 0; i < 2; ++i) {
    // TODO: have a reproduction of this that doesn't depend on a 10 MB file.
    const response: Response = new Response(`<!DOCTYPE html>
<html>
  <head>
    <script
    id="base-js"
    src="https://www.youtube.com/s/desktop/6ed1dd74/jsbin/desktop_polymer_legacy_browsers.vflset/desktop_polymer_legacy_browsers.js"
    nonce="4oKS2biXokC0utrX4MKrsQ"></script>
  </head>
  </body>
</html>`);
    const window: Window = new Window({ url: "http://youtube.com" });
    const localStorage = window.localStorage;
    global.window = window;
    global.document = window.document;
    localStorage.clear();
    document.body.innerHTML = await response.text();
  }

  // This test passes by simply not crashing.
  expect().pass();
});
