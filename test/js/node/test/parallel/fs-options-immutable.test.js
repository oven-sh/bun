//#FILE: test-fs-options-immutable.js
//#SHA1: 3e986f4e0d29505ada9980c8af5146abd307ddb7
//-----------------
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");

// These tests make sure that the `options` object passed to these functions are
// never altered.
//
// Refer: https://github.com/nodejs/node/issues/7655

const originalOptions = {};
let options;

beforeEach(() => {
  options = JSON.parse(JSON.stringify(originalOptions));
});

const tmpdir = {
  path: path.join(os.tmpdir(), "node-test-fs-options-immutable"),
  refresh: () => {
    try {
      fs.rmSync(tmpdir.path, { recursive: true, force: true });
    } catch (error) {
      // Ignore errors
    }
    fs.mkdirSync(tmpdir.path, { recursive: true });
  },
  resolve: filename => path.join(tmpdir.path, filename),
};

tmpdir.refresh();

test("fs.readFile", async () => {
  await fs.promises.readFile(__filename, options);
  expect(options).toEqual(originalOptions);
});

test("fs.readFileSync", () => {
  fs.readFileSync(__filename, options);
  expect(options).toEqual(originalOptions);
});

test("fs.readdir", async () => {
  await fs.promises.readdir(__dirname, options);
  expect(options).toEqual(originalOptions);
});

test("fs.readdirSync", () => {
  fs.readdirSync(__dirname, options);
  expect(options).toEqual(originalOptions);
});

test("fs.readlink and fs.readlinkSync", async () => {
  const canCreateSymLink = await new Promise(resolve => {
    fs.symlink(__filename, "dummy-symlink", err => {
      if (err) resolve(false);
      fs.unlink("dummy-symlink", () => resolve(true));
    });
  });

  if (canCreateSymLink) {
    const sourceFile = tmpdir.resolve("test-readlink");
    const linkFile = tmpdir.resolve("test-readlink-link");

    await fs.promises.writeFile(sourceFile, "");
    await fs.promises.symlink(sourceFile, linkFile);

    await fs.promises.readlink(linkFile, options);
    expect(options).toEqual(originalOptions);

    fs.readlinkSync(linkFile, options);
    expect(options).toEqual(originalOptions);
  } else {
    test.skip("Symlink tests skipped - cannot create symlinks", () => {});
  }
});

test("fs.writeFile and fs.writeFileSync", async () => {
  const fileName = tmpdir.resolve("writeFile");
  fs.writeFileSync(fileName, "ABCD", options);
  expect(options).toEqual(originalOptions);

  await fs.promises.writeFile(fileName, "ABCD", options);
  expect(options).toEqual(originalOptions);
});

test("fs.appendFile and fs.appendFileSync", async () => {
  const fileName = tmpdir.resolve("appendFile");
  fs.appendFileSync(fileName, "ABCD", options);
  expect(options).toEqual(originalOptions);

  await fs.promises.appendFile(fileName, "ABCD", options);
  expect(options).toEqual(originalOptions);
});

test("fs.watch", () => {
  if (process.platform === "os400") {
    return test.skip("IBMi does not support fs.watch()");
  }

  const watch = fs.watch(__filename, options, () => {});
  watch.close();
  expect(options).toEqual(originalOptions);
});

test("fs.watchFile and fs.unwatchFile", () => {
  fs.watchFile(__filename, options, () => {});
  fs.unwatchFile(__filename);
  expect(options).toEqual(originalOptions);
});

test("fs.realpath and fs.realpathSync", async () => {
  fs.realpathSync(__filename, options);
  expect(options).toEqual(originalOptions);

  await fs.promises.realpath(__filename, options);
  expect(options).toEqual(originalOptions);
});

test("fs.mkdtemp and fs.mkdtempSync", async () => {
  const tempFileName = tmpdir.resolve("mkdtemp-");
  fs.mkdtempSync(tempFileName, options);
  expect(options).toEqual(originalOptions);

  await fs.promises.mkdtemp(tempFileName, options);
  expect(options).toEqual(originalOptions);
});

test("fs.WriteStream and fs.ReadStream", done => {
  const fileName = tmpdir.resolve("streams");
  const writeStream = fs.createWriteStream(fileName, options);
  writeStream.once("open", () => {
    expect(options).toEqual(originalOptions);
    const readStream = fs.createReadStream(fileName, options);
    readStream.once("open", () => {
      expect(options).toEqual(originalOptions);
      readStream.destroy();
      writeStream.end();
      done();
    });
  });
});

//<#END_FILE: test-fs-options-immutable.js
