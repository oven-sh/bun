import { expect, it } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import empty from "./xml-empty.xml";
import fixture, * as namespace from "./xml-fixture.xml";
import xmlFromCustomTypeAttribute from "./xml-fixture.xml.txt" with { type: "xml" };

const expectedFixture = {
  config: {
    "@framework": "next",
    bundle: {
      package: [
        { "@name": "@emotion/react", "@enabled": "true" },
        { "@name": "lodash", "@enabled": "false" },
      ],
    },
    dev: { "@port": "3000", "#text": "watch ", b: "on" },
    empty: "",
  },
};

it("via import statement", () => {
  expect(fixture).toEqual(expectedFixture);
});

it("the root element is also a named export", () => {
  expect(namespace.config).toEqual(expectedFixture.config);
  expect(namespace.default).toEqual(expectedFixture);
});

it("via dynamic import", async () => {
  const xml = (await import("./xml-fixture.xml")).default;
  expect(xml).toEqual(expectedFixture);
});

it("via require", () => {
  // Already in the module registry from the import above, so this is the
  // namespace object: the root element is reachable either way.
  expect(require("./xml-fixture.xml").config).toEqual(expectedFixture.config);
});

it("via import type xml", () => {
  expect(xmlFromCustomTypeAttribute).toEqual({ note: { "@importance": "high", "#text": "remember" } });
});

it("via dynamic import with type attribute", async () => {
  delete require.cache[require.resolve("./xml-fixture.xml.txt")];
  const xml = (await import("./xml-fixture.xml.txt", { with: { type: "xml" } })).default;
  expect(xml).toEqual({ note: { "@importance": "high", "#text": "remember" } });
});

it("an empty file is an empty object, like the other data loaders", () => {
  expect(empty).toEqual({});
});

it("files in the encodings XML requires are decoded before parsing", async () => {
  const expected = { doc: { "@lang": "français", "#text": "café 日本" } };
  expect((await import("./xml-utf16le-bom.xml")).default).toEqual(expected);
  expect((await import("./xml-utf16be-bom.xml")).default).toEqual(expected);
  expect((await import("./xml-utf8-bom.xml")).default).toEqual(expected);
  expect((await import("./xml-latin1.xml")).default).toEqual({ doc: { "@lang": "français", "#text": "café" } });
});

it("a file is read as its bytes, so import, require and Bun.build give what XML.parse gives", async () => {
  const bom = "﻿";
  const files = {
    "utf8-bom-declares-latin1.xml": Buffer.from(`${bom}<?xml version="1.0" encoding="ISO-8859-1"?><r>café</r>`),
    "utf16-bom-declares-latin1.xml": Buffer.from(
      `${bom}<?xml version="1.0" encoding="ISO-8859-1"?><r>café</r>`,
      "utf16le",
    ),
    "utf16-bom-declares-utf8.xml": Buffer.from(`${bom}<?xml version="1.0" encoding="UTF-8"?><r>café</r>`, "utf16le"),
    "utf8-declares-utf16.xml": Buffer.from(`<?xml version="1.0" encoding="UTF-16"?><r>café</r>`),
    "two-boms.xml": Buffer.from(`${bom}${bom}<r>café</r>`),
    "bom-only.xml": Buffer.from(bom),
    "unclosed.xml": Buffer.from("<r>"),
    "utf8-bom.xml": Buffer.from(`${bom}<r>café</r>`),
    "utf16le-bom.xml": Buffer.from(`${bom}<r>café</r>`, "utf16le"),
    "utf16be-bom.xml": Buffer.from(`${bom}<r>café</r>`, "utf16le").swap16(),
    "latin1.xml": Buffer.from(`<?xml version="1.0" encoding="ISO-8859-1"?><r>caf\xe9</r>`, "latin1"),
  };
  const names = Object.keys(files);
  const outcome = load => {
    try {
      return JSON.stringify(load());
    } catch (error) {
      return "threw " + error.message.replace(/^XML Parse error: /, "");
    }
  };
  const expected = Object.fromEntries(names.map(name => [name, outcome(() => Bun.XML.parse(files[name]))]));
  expect(Object.values(expected).filter(value => value === `{"r":"café"}`)).toHaveLength(4);

  const tree = {
    "load.mjs": `
      import { createRequire } from "node:module";
      const require = createRequire(import.meta.url);
      const names = ${JSON.stringify(names)};
      const said = { import: {}, require: {}, typed: {} };
      const outcome = async load => {
        try {
          return JSON.stringify(await load());
        } catch (error) {
          return "threw " + error.message;
        }
      };
      for (const name of names) {
        said.import[name] = await outcome(async () => (await import("./import/" + name)).default);
        said.require[name] = await outcome(() => require("./require/" + name));
        said.typed[name] = await outcome(
          async () => (await import("./typed/" + name + ".txt", { with: { type: "xml" } })).default,
        );
      }
      console.log(JSON.stringify(said));
    `,
  };
  for (const name of names) {
    tree["import/" + name] = files[name];
    tree["require/" + name] = files[name];
    tree["typed/" + name + ".txt"] = files[name];
    tree["build/" + name] = files[name];
    tree["build/" + name + ".mjs"] = `import doc from "./${name}";\nexport default doc;\n`;
  }
  using dir = tempDir("xml-file-bytes", tree);

  const bundled = {};
  for (const name of names) {
    const build = await Bun.build({
      entrypoints: [join(String(dir), "build", name + ".mjs")],
      outdir: join(String(dir), "out", name),
      throw: false,
    });
    bundled[name] = build.success
      ? outcome(() => require(build.outputs[0].path).default)
      : "threw " + build.logs.map(log => log.message).join("\n");
  }

  await using proc = Bun.spawn({
    cmd: [bunExe(), "load.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ said: JSON.parse(stdout || "null"), bundled, stderr }).toEqual({
    said: { import: expected, require: expected, typed: expected },
    bundled: expected,
    stderr: "",
  });
  expect(exitCode).toBe(0);
});

it("a malformed file is a build error with the parser's message and location", async () => {
  let error;
  try {
    await import("./xml-malformed.xml");
  } catch (e) {
    error = e;
  }
  expect(error?.name).toBe("BuildMessage");
  expect(error.message).toBe("Expected closing tag </port> but found </bad>");
  expect(error.position).toMatchObject({ line: 3, column: 13, lineText: "  <port>8080</bad>" });
});

it("a document nested too deeply to parse is a build error, not a crash or a missing module", async () => {
  // Deep enough to overflow any native stack, whatever the frame size.
  const depth = 2_000_000;
  using dir = tempDir("xml-deep", {
    "deep.xml": Buffer.alloc(depth * 3, "<a>").toString() + Buffer.alloc(depth * 4, "</a>").toString(),
  });
  let error;
  try {
    await import(join(String(dir), "deep.xml"));
  } catch (e) {
    error = e;
  }
  expect(error?.name).toBe("BuildMessage");
  expect(error.message).toBe("Nesting is too deep");
});
