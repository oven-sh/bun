//#FILE: test-inspect-publish-uid.js
//#SHA1: cd6577ea81261e5e89b5ec6272e27f5a0614ffcf
//-----------------
"use strict";

const { spawnSync } = require("child_process");
const inspector = require("inspector");
const http = require("http");
const url = require("url");

// Skip the test if inspector is disabled
if (!inspector.url()) {
  test.skip("Inspector is disabled", () => {});
} else {
  test("Checks stderr", async () => {
    await testArg("stderr");
  });

  test("Checks http", async () => {
    await testArg("http");
  });

  test("Checks http,stderr", async () => {
    await testArg("http,stderr");
  });
}

async function testArg(argValue) {
  console.log("Checks " + argValue + "..");
  const hasHttp = argValue.split(",").includes("http");
  const hasStderr = argValue.split(",").includes("stderr");

  const nodeProcess = spawnSync(process.execPath, [
    "--inspect=0",
    `--inspect-publish-uid=${argValue}`,
    "-e",
    `(${scriptMain.toString()})(${hasHttp ? 200 : 404})`,
  ]);
  const hasWebSocketInStderr = checkStdError(nodeProcess.stderr.toString("utf8"));
  expect(hasWebSocketInStderr).toBe(hasStderr);
}

function checkStdError(data) {
  const matches = data.toString("utf8").match(/ws:\/\/.+:(\d+)\/.+/);
  return !!matches;
}

function scriptMain(code) {
  const inspectorUrl = inspector.url();
  const { host } = url.parse(inspectorUrl);
  http.get("http://" + host + "/json/list", response => {
    expect(response.statusCode).toBe(code);
    response.destroy();
  });
}

//<#END_FILE: test-inspect-publish-uid.js
