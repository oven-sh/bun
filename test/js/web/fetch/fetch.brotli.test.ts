import { expect, test } from "bun:test";

test("fetch brotli response works", async () => {
  const [firstText, secondText, { headers }] = await Promise.all([
    fetch("https://bun.sh/logo.svg", {
      headers: {
        "Accept-Encoding": "br",
      },
    }).then(res => res.text()),
    fetch("https://bun.sh/logo.svg", {
      headers: {
        "Accept-Encoding": "gzip",
      },
    }).then(res => res.text()),
    fetch("https://bun.sh/logo.svg", {
      headers: {
        "Accept-Encoding": "br",
      },
      decompress: false,
    }),
  ]);

  expect(firstText).toBe(secondText);
  expect(headers.get("Content-Encoding")).toBe("br");
});
