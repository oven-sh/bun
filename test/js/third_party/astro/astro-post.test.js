import { build, preview } from "astro";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, nodeExe } from "harness";
import { join } from "path";

const fixtureDir = join(import.meta.dirname, "fixtures");
async function postNodeFormData(port) {
  const result = Bun.spawn({
    cmd: [nodeExe(), join(fixtureDir, "node-form-data.fetch.fixture.js"), port?.toString()],
    env: bunEnv,
    stdio: ["inherit", "inherit", "inherit"],
  });
  expect(await result.exited).toBe(0);
}
async function postNodeAction(port) {
  const result = Bun.spawn({
    cmd: [nodeExe(), join(fixtureDir, "node-action.fetch.fixture.js"), port?.toString()],
    env: bunEnv,
    stdio: ["inherit", "inherit", "inherit"],
  });
  expect(await result.exited).toBe(0);
}

describe("astro", async () => {
  let previewServer;
  let origin;

  beforeAll(async () => {
    await build({
      root: fixtureDir,
      devOutput: false,
      logLevel: "error",
    });
    previewServer = await preview({
      root: fixtureDir,
      port: 0,
      logLevel: "error",
    });
    origin = `http://localhost:${previewServer.port}`;
  });
  afterAll(async () => {
    await previewServer.stop();
  });

  test("is able todo a POST request to an astro action using bun", async () => {
    const r = await fetch(`${origin}/_actions/getGreeting/`, {
      body: '{"name":"World"}',
      headers: {
        accept: "application/json",
        "accept-language": "en-US,en;q=0.9,es;q=0.8",
        "content-type": "application/json",
        "sec-ch-ua": '"Chromium";v="134", "Not:A-Brand";v="24", "Google Chrome";v="134"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"macOS"',
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-origin",
        Referer: origin,
        "Referrer-Policy": "strict-origin-when-cross-origin",
      },
      method: "POST",
    });
    expect(r.status).toBe(200);
    const text = await r.text();
    expect(text).toBe('["Hello, World!"]');
  });

  test("is able todo a POST request to an astro action using node", async () => {
    await postNodeAction(previewServer.port);
  });

  test("is able to post form data to an astro using bun", async () => {
    const formData = new FormData();
    formData.append("name", "John Doe");
    formData.append("email", "john.doe@example.com");
    const r = await fetch(`${origin}/form-data`, {
      "body": formData,
      "headers": {
        "origin": origin,
      },
      "method": "POST",
    });

    expect(r.status).toBe(200);
    const text = await r.json();
    expect(text).toEqual({
      name: "John Doe",
      email: "john.doe@example.com",
    });
  });
  test("is able to post form data to an astro using node", async () => {
    await postNodeFormData(previewServer.port);
  });
});
