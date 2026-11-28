import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

async function check(files: Record<string, string>, compilerOptions: object, ...args: string[]) {
  const tsconfig = { compilerOptions: { strict: true, noEmit: true, types: [], ...compilerOptions } };
  using dir = tempDir("check-proto", { "tsconfig.json": JSON.stringify(tsconfig), ...files });
  await using proc = Bun.spawn({ cmd: [bunExe(), ...args], cwd: String(dir), env: bunEnv, stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { output: stdout + stderr, exitCode };
}

const typesOfBun = {
  typeRoots: [join(import.meta.dir, "../../../packages")],
  types: ["bun-types"],
  skipLibCheck: true,
};

const schema = `syntax = "proto3";
enum Kind { NONE = 0; SOME = 1; }
message User {
  string name = 1;
  int64 id = 2;
  optional Kind kind = 3;
  oneof contact { string email = 4; User delegate = 5; }
}
`;

test.concurrent("an import of a schema has its types", async () => {
  const main = `import { Kind, User } from "./user.proto";
const user: User = User.decode(User.encode({ id: 1, kind: Kind.SOME }));
export const id: bigint = user.id;
export const email: string = user.contact?.case === "email" ? user.contact.value : "";
export const wrong: number = user.name;
export const kind: Kind = user.kind;
User.encode({ nmae: "" });
User.encode({ contact: { case: "email", value: {} } });
`;
  const { output, exitCode } = await check({ "main.ts": main, "user.proto": schema }, {}, "check", "--no-pretty");
  expect(output.match(/^\S+: error TS\d+/gm)).toEqual([
    "main.ts(5,14): error TS2322",
    "main.ts(6,14): error TS2322",
    "main.ts(7,15): error TS2353",
    "main.ts(8,41): error TS2322",
  ]);
  expect(exitCode).toBe(1);
});

test.concurrent("the client and the routes of a service have its types", async () => {
  const main = `import * as users from "./users.proto";
class Server implements users.Users.Server {
  get = (request: users.User) => ({ id: request.id });
}
Bun.serve({ http2: true, routes: { ...users.Users.routes(new Server()), "/": new Response() } });
users.Users.routes({
  async *watch(requests, context) {
    for await (const { name } of requests) yield { name: name + context.headers.get("a") };
  },
});
const client: users.Users.Client = new users.Users.Client("http://localhost", { timeout: 1 });
export const id: bigint = (await client.get({ name: "a" }, { timeout: 1 })).id;
for await (const user of client.watch([{}])) user satisfies users.User;
users.Users.routes({ get: () => ({ name: 1 }) });
users.Users.routes({ gte: () => ({}) });
users.Users.routes({ watch: () => 1 });
client.get({ name: 1 });
client.watch({ name: "a" });
client.get({}, { timeout: "1" });
`;
  const service = `service Users { rpc Get(User) returns (User); rpc Watch(stream User) returns (stream User); }`;
  const files = { "main.ts": main, "users.proto": schema + service };
  const options = { ...typesOfBun, target: "esnext", module: "preserve" };
  const { output } = await check(files, options, "check", "--no-pretty");
  expect(output.match(/^\S+(?=,\d+\): error)/gm)).toEqual([14, 15, 16, 17, 18, 19].map(line => `main.ts(${line}`));
});

test.concurrent.each([
  ["./user.proto", { "user.proto": schema }],
  ["schemas/user.proto", { "node_modules/schemas/user.proto": schema }],
  [
    "schemas/user",
    {
      "node_modules/schemas/package.json": `{ "exports": { "./*": "./protos/*.proto" } }`,
      "node_modules/schemas/protos/user.proto": schema,
    },
  ],
])("%s has its types whatever target and lib are", async (specifier, files) => {
  const main = `import type { User } from "${specifier}";\nexport const name: User["name"] = 1;\n`;
  const options = { target: "es2015", lib: ["es2015"], module: "preserve" };
  const { output } = await check({ "main.ts": main, ...files }, options, "check", "--no-pretty");
  expect(output.match(/^\S+: error.*/gm)).toEqual([expect.stringContaining("main.ts(2,14): error TS2322")]);
});

test.concurrent("a mistake in a schema is an error", async () => {
  const files = { "main.ts": `import "./user.proto";\n`, "user.proto": `syntax = "proto3";\nmessage A { B b = 1; }\n` };
  const { output, exitCode } = await check(files, {}, "check", "--no-pretty");
  expect(output).toContain(`user.proto(2,13): error: "B" is not defined`);
  expect(exitCode).toBe(1);
});

test.concurrent("a file that is imported as text or as a file is not read as a schema", async () => {
  const files = {
    "main.ts": `import path from "./a.proto" with { type: "file" };\nimport text from "./b.proto" with { type: "text" };\nexport const wrong: number[] = [path, text];\n`,
    "files.d.ts": `declare module "*.proto" {\n  const contents: string;\n  export default contents;\n}\n`,
    "a.proto": schema,
    "b.proto": "not a schema",
  };
  const { output } = await check(files, { module: "preserve" }, "check", "--no-pretty");
  expect(output.match(/^\S+: error.*?:/gm)).toEqual(["main.ts(3,33): error TS2322:", "main.ts(3,39): error TS2322:"]);
});

test.concurrent("a declaration file beside a schema comes first", async () => {
  const files = {
    "main.ts": `import path from "./a.proto";\nexport const wrong: number = path;\n`,
    "a.proto": "not a schema",
    "a.proto.d.ts": `declare const path: string;\nexport default path;\n`,
  };
  const { output } = await check(files, {}, "check", "--no-pretty");
  expect(output.match(/^\S+: error.*?:/gm)).toEqual(["main.ts(2,14): error TS2322:"]);
});

test.concurrent("--loader decides what is a schema", async () => {
  const files = {
    "main.ts": `import path from "./a.proto";\nimport type { User } from "./user.schema";\nexport const names: User["name"][] = [path, 1];\n`,
    "files.d.ts": `declare module "*.proto" {\n  const path: string;\n  export default path;\n}\n`,
    "a.proto": "not a schema",
    "user.schema": schema,
  };
  const flags = ["--loader=.proto:file", "--loader=.schema:proto", "--outdir=out"];
  const { output } = await check(files, {}, "build", "--check", ...flags, "main.ts");
  expect(output.match(/error: TS\d+|main\.ts:\d+:\d+/g)).toEqual(["error: TS2322", "main.ts:3:45"]);
});

// --aot trusts the types of what a schema compiles to, and nothing else reports an error in it.
test.concurrent.each(["bun", "browser"] as const)(
  "what a schema compiles to for %s has no type error",
  async target => {
    const root = join(import.meta.dir, "../../js/bun/resolve/proto");
    const entrypoints = ["proto3", "proto2", "editions", "names", "shared/forwards"].map(name =>
      join(root, `${name}.proto`),
    );
    const { outputs } = await Bun.build({ entrypoints, root, target, sourcemap: "external" });
    const files: Record<string, string> = {};
    for (const output of outputs.filter(output => output.kind === "sourcemap")) {
      const { sources, sourcesContent } = await output.json();
      sources.forEach((source: string, index: number) => {
        files[relative(root, resolve(source)).replaceAll("\\", "/") + ".ts"] = sourcesContent[index];
      });
    }
    expect(Object.keys(files)).toHaveLength(6);
    expect(files["names.proto.ts"]).not.toBe(readFileSync(join(root, "names.proto"), "utf8"));
    const options = {
      ...typesOfBun,
      target: "esnext",
      module: "preserve",
      declaration: true,
      erasableSyntaxOnly: true,
      exactOptionalPropertyTypes: true,
      isolatedDeclarations: true,
      noFallthroughCasesInSwitch: true,
      noImplicitReturns: true,
      noPropertyAccessFromIndexSignature: true,
      noUncheckedIndexedAccess: true,
      noUnusedLocals: true,
      noUnusedParameters: true,
      verbatimModuleSyntax: true,
    };
    const { output, exitCode } = await check(files, options, "check", "--no-pretty");
    expect(output).toContain("No type errors");
    expect(exitCode).toBe(0);
  },
);
