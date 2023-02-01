const puppeteer = require("puppeteer");
const http = require("http");
const path = require("path");
const url = require("url");
const fs = require("fs");
const child_process = require("child_process");
const snippetsDir = path.resolve(__dirname, "../snippets");
const serverURL = process.env.TEST_SERVER_URL || "http://localhost:8080";
const USE_EXISTING_PROCESS = process.env.USE_EXISTING_PROCESS || false;
const DISABLE_HMR = !!process.env.DISABLE_HMR;
const bunFlags = ["dev", `--origin=${serverURL}`, DISABLE_HMR && "--disable-hmr"].filter(Boolean);
const bunExec = process.env.BUN_BIN || "bun";

var bunProcess;
var waitSpawn;
if (!USE_EXISTING_PROCESS) {
  bunProcess = child_process.spawn(bunExec, bunFlags, {
    cwd: snippetsDir,
    stdio: "pipe",
    env: {
      ...process.env,
      DISABLE_BUN_ANALYTICS: "1",
    },

    shell: false,
  });
  console.log("$", bunExec, bunFlags.join(" "));
  bunProcess.stderr.pipe(process.stderr);
  bunProcess.stdout.pipe(process.stdout);
  var rejecter;
  bunProcess.once("error", err => {
    console.error("❌ bun error", err);
    process.exit(1);
  });
  if (!process.env.CI) {
    waitSpawn = new Promise((resolve, reject) => {
      bunProcess.once("spawn", code => {
        console.log("Spawned");
        resolve();
      });
    });
  }
  process.on("beforeExit", () => {
    bunProcess && bunProcess.kill(0);
  });
}
const isDebug = bunExec.endsWith("-debug");

function writeSnapshot(name, code) {
  let file = path.join(__dirname, "../snapshots", name);

  if (!DISABLE_HMR) {
    file = file.substring(0, file.length - path.extname(file).length) + ".hmr" + path.extname(file);
  }

  if (!fs.existsSync(path.dirname(file))) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }

  fs.writeFileSync(
    isDebug ? file.substring(0, file.length - path.extname(file).length) + ".debug" + path.extname(file) : file,
    code,
  );
}

const baseOptions = {
  dumpio: !!process.env.CI_DEBUG,

  args: [
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--disable-setuid-sandbox",
    "--no-sandbox",
    "--ignore-certificate-errors",
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    "--disable-sync",
  ],
  executablePath: process.env.BROWSER_EXECUTABLE,
  headless: true,
};

async function main() {
  const launchOptions = USE_EXISTING_PROCESS ? { ...baseOptions, devtools: !process.env.CI } : baseOptions;
  const browser = await puppeteer.launch(launchOptions);
  const promises = [];
  let allTestsPassed = true;

  if (waitSpawn) await waitSpawn;
  var canRetry = true;

  async function runPage(key) {
    var page;
    try {
      page = await browser.newPage();
      if (USE_EXISTING_PROCESS) {
        await page.evaluate(`
        globalThis.BUN_DEBUG_MODE = true;
      `);
      }

      var shouldClose = true;
      page.on("console", obj => console.log(`[console.${obj.type()}] ${obj.text()}`));
      page.exposeFunction("testFail", error => {
        console.log(`❌ ${error}`);
        allTestsPassed = false;
      });
      let testDone = new Promise(resolve => {
        page.exposeFunction("testDone", resolve);
      });
      try {
        await page.goto(`${serverURL}/`, {
          waitUntil: "domcontentloaded",
        });

        await page.evaluate(`
        globalThis.runTest("${key}");
      `);
        await testDone;
      } catch (err) {
        if (canRetry) {
          console.log(
            `❌ ${key} failed once (incase it's still booting on universal binary for the first time). Retrying...`,
          );
          canRetry = false;
          return await runPage(key);
        }
        throw err;
      }

      console.log(`✅ ${key}`);
    } catch (e) {
      if (USE_EXISTING_PROCESS) shouldClose = false;
      allTestsPassed = false;
      console.log(`❌ ${key}: ${(e && e.message) || e}`);
    } finally {
      try {
        const code = await page.evaluate(`
         globalThis.getModuleScriptSrc("${key}");
      `);
        writeSnapshot(key, code);
      } catch (exception) {
        console.warn(`Failed to update snapshot: ${key}`, exception);
      }
    }
    canRetry = false;
    if (shouldClose) await page.close();
  }

  const tests = require("./snippets.json");
  tests.reverse();

  for (let test of tests) {
    await runPage(test);
  }

  if (!USE_EXISTING_PROCESS || (USE_EXISTING_PROCESS && allTestsPassed)) {
    bunProcess && bunProcess.kill(0);

    if (!allTestsPassed) {
      console.error(`❌ browser test failed`);
      process.exit(1);
    } else {
      console.log(`✅ browser test passed`);
      bunProcess && bunProcess.kill(0);
      process.exit(0);
    }
    await browser.close();
  }
}

main().catch(error =>
  setTimeout(() => {
    throw error;
  }),
);
