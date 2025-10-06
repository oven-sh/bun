import { describe } from "bun:test";
import { itBundled } from "./expectBundled";

describe("bundler", () => {
  itBundled("compile/DotEnvDisabledByDefault", {
    compile: true,
    files: {
      "/entry.ts": /* js */ `
        console.log(process.env.MY_SECRET_VAR || "not set");
      `,
      "/.env": `MY_SECRET_VAR=secret_value`,
    },
    run: { stdout: "not set" },
  });

  itBundled("compile/DotEnvWithEnvInlineAPI", {
    compile: {
      env: "inline",
    },
    backend: "api",
    files: {
      "/entry.ts": /* js */ `
        console.log(process.env.MY_SECRET_VAR || "not set");
      `,
      "/.env": `MY_SECRET_VAR=secret_value`,
    },
    run: { stdout: "secret_value" },
  });

  itBundled("compile/DotEnvWithEnvAsteriskAPI", {
    compile: {
      env: "*",
    },
    backend: "api",
    files: {
      "/entry.ts": /* js */ `
        console.log(process.env.MY_SECRET_VAR || "not set");
      `,
      "/.env": `MY_SECRET_VAR=secret_value`,
    },
    run: { stdout: "secret_value" },
  });

  itBundled("compile/DotEnvWithEnvPrefixAPI", {
    compile: {
      env: "PUBLIC_*",
    },
    backend: "api",
    files: {
      "/entry.ts": /* js */ `
        console.log("PUBLIC:", process.env.PUBLIC_VAR || "not set");
        console.log("PRIVATE:", process.env.PRIVATE_VAR || "not set");
      `,
      "/.env": `PUBLIC_VAR=public_value
PRIVATE_VAR=private_value`,
    },
    run: {
      stdout: `PUBLIC: public_value
PRIVATE: not set`,
    },
  });

  itBundled("compile/DotEnvWithEnvTrueAPI", {
    compile: {
      env: true,
    },
    backend: "api",
    files: {
      "/entry.ts": /* js */ `
        console.log(process.env.MY_SECRET_VAR || "not set");
      `,
      "/.env": `MY_SECRET_VAR=secret_value`,
    },
    run: { stdout: "secret_value" },
  });

  itBundled("compile/DotEnvWithEnvFalseAPI", {
    compile: {
      env: false,
    },
    backend: "api",
    files: {
      "/entry.ts": /* js */ `
        console.log(process.env.MY_SECRET_VAR || "not set");
      `,
      "/.env": `MY_SECRET_VAR=secret_value`,
    },
    run: { stdout: "not set" },
  });

  itBundled("compile/DotEnvWithEnvDisableAPI", {
    compile: {
      env: "disable",
    },
    backend: "api",
    files: {
      "/entry.ts": /* js */ `
        console.log(process.env.MY_SECRET_VAR || "not set");
      `,
      "/.env": `MY_SECRET_VAR=secret_value`,
    },
    run: { stdout: "not set" },
  });
});
