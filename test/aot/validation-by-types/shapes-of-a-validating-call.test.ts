// However a call of `JSON.parse` with a type argument is written, wherever it stands and wherever its type comes from: it
// validates, or the build stops and names the file, or the call throws whatever the text. A text that the type refuses never
// comes back, and a text that it takes comes back as `JSON.parse(text)` gives it.
//
// The shapes are modules of one program. The first build names the modules that stop it, the second holds the rest.
import { expect } from "bun:test";
import { bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "../harness/run";
import { test } from "../supported";
import { callees, contexts, shapes, type Shape } from "./shapes-of-a-validating-call";

const spellings: Record<string, { imports: string; J: string }> = {
  imported: { imports: `import { JSON as Checked } from "bun";`, J: "Checked" },
  "same-name": { imports: `import { JSON } from "bun";`, J: "JSON" },
  "Bun.JSON": { imports: ``, J: "Bun.JSON" },
  global: { imports: ``, J: "JSON" },
  globalThis: { imports: ``, J: "globalThis.JSON" },
};
const options = { strict: true, target: "esnext", module: "esnext", moduleResolution: "bundler" };
const joinedOptions = { ...options, allowImportingTsExtensions: true, noEmit: true };
const refusedByDefault = ['{"id":"7"}'];
const takenByDefault = ['{"id":7}'];

function moduleOf(shape: Shape, spelling: string) {
  const { imports, J } = spellings[spelling];
  // The build cannot tell what the texts are.
  const texts = (list: string[]) =>
    `${JSON.stringify(list)}.map(text => text + (process.env.NOTHING_IS_SET_UNDER_THIS_NAME ?? ""))`;
  const text = `${shape.top ?? ""}${imports}
${shape.imports ?? ""}
type User = { id: number };
const spell = globalThis.JSON.stringify;
export const bad: string[] = ${texts(shape.bad ?? refusedByDefault)};
export const good: string[] = ${texts(shape.good ?? takenByDefault)};
${shape.code(J, imports)}
export { ask };
`;
  return { text, files: shape.files?.(J, imports) ?? {} };
}

/** What it declares, or the options it is checked under, would reach the other modules. */
function standsAlone(shape: Shape, { text, files }: ReturnType<typeof moduleOf>) {
  const all = text + Object.values(files).join("\n");
  const isAmbient = (file: string) => /^[^/]*\.d\.ts$/.test(file) && !text.includes(file.replace(/\.d\.ts$/, '"'));
  return (
    !!shape.compilerOptions ||
    /declare global|declare module|reference types/.test(all) ||
    Object.keys(files).some(isAmbient)
  );
}

const main = (modules: { name: string; file: string }[]) => `${modules
  .map(({ name, file }) => `import * as ${name} from "./${file}";`)
  .join("\n")}
const spell = globalThis.JSON.stringify;
async function show(label: string, call: () => unknown) {
  let said: string;
  try {
    said = "returned " + spell(await call());
  } catch (error: any) {
    said = Array.isArray(error?.issues) ? "validated" : "threw";
  }
  console.log(label + " " + said);
}
for (const [name, shape] of Object.entries({ ${modules.map(({ name }) => name).join(", ")} })) {
  for (const [index, text] of shape.bad.entries()) await show(name + " bad " + index, () => shape.ask(text));
  for (const [index, text] of shape.good.entries()) await show(name + " good " + index, () => shape.ask(text));
}
`;

/** The modules that an error of the build names. */
function modulesNamedByErrors(said: string) {
  const named = new Set<string>();
  let isError = false;
  for (const line of said.split("\n")) {
    if (/^error\b/.test(line)) isError = true;
    else if (/^(warn|warning|note)\b/.test(line)) isError = false;
    const at = /[/\\](s\d+)[/\\]/.exec(line);
    if (at && isError) named.add(at[1]);
  }
  return named;
}

async function judge(list: Shape[], spelling: string, compilerOptions: object = joinedOptions) {
  const files: Record<string, string> = { "tsconfig.json": JSON.stringify({ compilerOptions }) };
  let modules = list.map((shape, index) => {
    const name = "s" + index;
    const module = moduleOf(shape, spelling);
    const file = `${name}/program.${shape.extension ?? "ts"}`;
    files[file] = module.text;
    for (const [path, text] of Object.entries(module.files)) files[`${name}/${path}`] = text;
    return { shape, name, file };
  });
  using dir = tempDir("shapes-of-a-validating-call", files);
  const outfile = join(String(dir), "main" + (isWindows ? ".exe" : ""));
  let stopped = 0;
  for (let round = 0; modules.length; round++) {
    await Bun.write(join(String(dir), "main.ts"), main(modules));
    const built = await run([bunExe(), "build", "--compile", "--aot", "./main.ts", "--outfile", outfile], String(dir));
    if (built.exitCode === 0) break;
    const said = built.stderr + built.stdout;
    const named = modulesNamedByErrors(said);
    // Every error names a module, and taking those modules out brings no new errors more than twice.
    expect({ round, said: named.size && round < 3 ? "" : said.slice(0, 2000) }).toEqual({ round, said: "" });
    stopped += named.size;
    modules = modules.filter(({ name }) => !named.has(name));
  }
  if (!modules.length) return { stopped, validating: 0, throwing: 0 };
  const { stdout, stderr, exitCode } = await run([outfile], String(dir));
  const lines = stdout.split("\n");
  const unexpected: string[] = [];
  let validating = 0;
  let throwing = 0;
  for (const { shape, name } of modules) {
    const bad = lines.filter(line => line.startsWith(name + " bad "));
    const good = lines.filter(line => line.startsWith(name + " good "));
    const taken = shape.good ?? takenByDefault;
    const wanted = taken.map(
      (text, index) => `${name} good ${index} returned ${shape.returns?.[index] ?? JSON.stringify(JSON.parse(text))}`,
    );
    const isWhole = bad.length === (shape.bad ?? refusedByDefault).length && good.length === taken.length;
    const comesBack = bad.some(line => line.includes(" returned "));
    const isAnother = good.some((line, index) => line !== wanted[index] && !line.endsWith(" threw"));
    if (!isWhole || comesBack || isAnother) {
      unexpected.push(`${shape.name} [${spelling}]: ${[...bad, ...good].join(" | ").slice(0, 300)}`);
    } else if (good.join("\n") === wanted.join("\n")) validating++;
    else throwing++;
  }
  expect({ unexpected, stderr, exitCode }).toEqual({ unexpected: [], stderr: "", exitCode: 0 });
  return { stopped, validating, throwing };
}

const inSpelling = (list: Shape[], spelling: string) =>
  list.filter(shape => !shape.spellings || shape.spellings.includes(spelling));

test.concurrent.each(Object.keys(spellings))(
  "every shape, %s",
  async spelling => {
    const joined = inSpelling(shapes, spelling).filter(shape => !standsAlone(shape, moduleOf(shape, spelling)));
    const { stopped, validating } = await judge(joined, spelling);
    expect(validating).toBeGreaterThan(400);
    expect(stopped).toBeGreaterThan(100);
  },
  600_000,
);

test.concurrent.each(["imported", "global"])(
  "the shapes that declare something for the whole program, %s",
  async spelling => {
    for (const shape of inSpelling(shapes, spelling)) {
      if (!standsAlone(shape, moduleOf(shape, spelling))) continue;
      await judge([shape], spelling, { ...options, ...shape.compilerOptions });
    }
  },
  900_000,
);

// Every way to write the callee, in every place where a call can stand.
const isPlain = (more: Partial<Shape>) => Object.keys(more).every(key => key === "spellings");
const hole = /§\.parse<User>\(((?:[^()]|\([^()]*\))*)\)/g;
const crossed: Shape[] = [];
for (const context of contexts) {
  if (!isPlain(context.more) || !context.code("§").match(hole)) continue;
  for (const callee of callees) {
    if (!isPlain(callee.more) || !/\btext\b/.test(callee.expression("§"))) continue;
    // What `then` is handed runs later than some of the places wait.
    if (callee.name.endsWith("a callback of then")) continue;
    const written = (J: string, argument: string) =>
      `(${callee.expression(J).replace(/\btext\b/g, () => argument.trim())})`;
    const code = (J: string) =>
      context
        .code("§")
        .replace(hole, (_, argument: string) => written(J, argument))
        .replaceAll("§", J);
    const spellings = callee.more.spellings ?? context.more.spellings;
    crossed.push({ name: `${context.name} x ${callee.name}`, code: J => `${callee.setup(J)}\n${code(J)}`, spellings });
  }
}

test.concurrent.each(["imported", "Bun.JSON", "global"])(
  "every callee in every place, %s",
  async spelling => {
    const { validating } = await judge(inSpelling(crossed, spelling), spelling);
    expect(validating).toBeGreaterThan(4000);
  },
  900_000,
);
