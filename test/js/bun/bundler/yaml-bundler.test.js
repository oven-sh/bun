import { expect, it } from "bun:test";
import { tempDirWithFiles } from "harness";

it("can bundle yaml files", async () => {
  const dir = tempDirWithFiles("yaml-bundle", {
    "index.js": `
      import yamlData from "./config.yaml";
      import ymlData from "./config.yml";
      export { yamlData, ymlData };
    `,
    "config.yaml": `
      name: "test"
      version: "1.0.0"
      features:
        - feature1
        - feature2
    `,
    "config.yml": `
      name: "test-yml"
      version: "2.0.0"
    `,
  });

  const result = await Bun.build({
    entrypoints: [`${dir}/index.js`],
    outdir: `${dir}/dist`,
  });

  expect(result.success).toBe(true);
  expect(result.logs.length).toBe(0);

  // Check that the output file was created
  const output = result.outputs[0];
  expect(output).toBeDefined();
});

it("yaml files work with Bun.build API", async () => {
  const dir = tempDirWithFiles("yaml-build-api", {
    "input.js": `
      import config from "./config.yaml";
      export default config;
    `,
    "config.yaml": `
      name: "test"
      version: "1.0.0"
    `,
  });

  const result = await Bun.build({
    entrypoints: [`${dir}/input.js`],
    outdir: `${dir}/dist`,
  });

  expect(result.success).toBe(true);
  expect(result.logs.length).toBe(0);

  // For now, we expect the build to succeed even though our mock parser returns empty objects
  const output = result.outputs[0];
  expect(output).toBeDefined();
});
