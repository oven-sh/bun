import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// docs/compiler/debugging.mdx, "What a test can't replace".
const works = {
  "a written name": `Object.prototype.alpha = 1; return {}.alpha;`,
  "a constant": `const name = "bravo"; Object.prototype[name] = 1; return {}.bravo;`,
  "one of two strings": `const name = Math.random() < 2 ? "charlie" : "delta"; Object.prototype[name] = 1; return {}.charlie;`,
  "a template of constants": `const part = "ec"; Object.prototype[\`\${part}ho\`] = 1; return {}.echo;`,
  "a loop over an array of strings": `for (const name of ["foxtrot", "golf"]) Object.prototype[name] = 1; return {}.golf;`,
  "defineProperty": `Object.defineProperty(Object.prototype, "hotel", { get: () => 1, configurable: true }); return {}.hotel;`,
  "Reflect.defineProperty": `Reflect.defineProperty(Object.prototype, "india", { value: 1, configurable: true }); return {}.india;`,
  "Object.assign": `Object.assign(Object.prototype, { juliet: 1 }); return {}.juliet;`,
  "a name made at run time on Array.prototype": `Array.prototype[made("kilo")] = 1; return [].kilo;`,
  "a name made at run time on Map.prototype": `Map.prototype[made("lima")] = 1; return new Map().lima;`,
  "a name made at run time that the cleanup spells": `Object.prototype[made("mike")] = 1; const got = {}.mike; delete Object.prototype.mike; return got;`, // prettier-ignore
  "a helper that takes a name that the cleanup spells": `set(Object.prototype, "sierra", 1); const got = {}.sierra; delete Object.prototype.sierra; return got;`, // prettier-ignore
  "a name made at run time that a function nobody calls stores": `Object.prototype[made("tango")] = 1; return {}.tango;`,
  "a name made at run time that a file of the tests spells": `Object.prototype[made("uniform")] = 1; return {}.uniform;`,
  "the same on Function.prototype": `Function.prototype[made("victor")] = 1; const got = (() => {}).victor; delete Function.prototype.victor; return got;`, // prettier-ignore
  "a name made at run time on Promise.prototype": `Promise.prototype[made("november")] = 1; return Promise.resolve().november;`,
};
const throws = {
  "a name made at run time": ["Object.prototype.oscar", `Object.prototype[made("oscar")] = 1; return {}.oscar;`],
  "a name made at run time that a read spells": ["Object.prototype.whiskey", `Object.prototype[made("whiskey")] = 1; return Object.prototype.whiskey;`], // prettier-ignore
  "a name made at run time on Function.prototype": ["Function.prototype.xray", `Function.prototype[made("xray")] = 1; return (() => {}).xray;`], // prettier-ignore
  "a helper that takes the name": ["Object.prototype.papa", `set(Object.prototype, "papa", 1); return {}.papa;`],
  "a helper and a name made at run time": [
    "Object.prototype.quebec",
    `set(Object.prototype, made("quebec"), 1); return {}.quebec;`,
  ],
  "defineProperty under a name made at run time": ["Object.prototype.romeo", `Object.defineProperty(Object.prototype, made("romeo"), { value: 1, configurable: true }); return {}.romeo;`], // prettier-ignore
};
const bodies = { ...works, ...Object.fromEntries(Object.entries(throws).map(([form, [, body]]) => [form, body])) };
const files = {
  "package.json": `{ "name": "p", "type": "module" }`,
  "clean.js": `export const clean = () => { delete Object.prototype.uniform; };`,
  "a.test.js": `import { test } from "bun:test";
import "./clean.js";
const made = text => JSON.parse(JSON.stringify(text));
const set = (holder, name, value) => { holder[name] = value; };
function never() { Object.prototype.tango = 2; }
const forms = {
${Object.entries(bodies)
  .map(([form, body]) => `  ${JSON.stringify(form)}: () => { ${body} },`)
  .join("\n")}
};
test("adds", () => {
  for (const [form, add] of Object.entries(forms)) {
    let said;
    try {
      said = "works " + add();
    } catch (error) {
      said = error.name + ": " + error.message;
    }
    console.log("SAID " + form + ": " + said);
  }
});`,
};
const said = (text: string) => text.split("\n").filter(line => line.startsWith("SAID ")).map(line => line.slice(5)); // prettier-ignore

test("a new name on Object.prototype works where the build reads it, and throws with the cure where it doesn't", async () => {
  using dir = tempDir("aot-new-name-on-object-prototype", files);
  const compiled = said((await run([bunExe(), "test", "--aot"], String(dir), bunEnv)).stdout);
  expect(compiled.slice(0, Object.keys(works).length)).toEqual(Object.keys(works).map(form => `${form}: works 1`));
  const refused = compiled.slice(Object.keys(works).length);
  expect(refused.length).toBe(Object.keys(throws).length);
  for (const [place, [form, [name]]] of Object.entries(throws).entries()) {
    expect(refused[place]).toStartWith(`${form}: TypeError: Cannot assign to ${name} because built-in objects are read-only in compiled code, and the build didn't see a test add this one.`); // prettier-ignore
    expect(refused[place]).toContain(`as in ${name} = value`);
  }
  const plain = said((await run([bunExe(), "test"], String(dir), bunEnv)).stdout);
  expect(plain).toEqual(Object.keys(bodies).map(form => `${form}: works 1`));
}, 300000);
