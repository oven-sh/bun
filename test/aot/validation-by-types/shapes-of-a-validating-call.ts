// Ways to write a call of `JSON.parse` with a type argument: how the callee is spelled, where the call stands, where the type
// comes from. Each is a module that defines `ask(text)`, with texts that its type refuses and texts that it takes.
// shapes-of-a-validating-call.test.ts builds them.
export type Shape = {
  name: string;
  code: (J: string, imports: string) => string;
  files?: (J: string, imports: string) => Record<string, string>;
  top?: string;
  imports?: string;
  bad?: string[];
  good?: string[];
  returns?: string[];
  extension?: string;
  spellings?: string[];
  compilerOptions?: Record<string, unknown>;
};
export const shapes: Shape[] = [];
const ofBun = ["imported", "same-name", "Bun.JSON"];
export const callees: {
  name: string;
  expression: (J: string) => string;
  setup: (J: string) => string;
  more: Partial<Shape>;
}[] = [];
export const contexts: { name: string; code: (J: string) => string; more: Partial<Shape> }[] = [];
export const call = (
  name: string,
  expression: (J: string) => string,
  setup: (J: string) => string = () => "",
  more: Partial<Shape> = {},
) =>
  callees.push({ name, expression, setup, more }) &&
  shapes.push({
    name: "call: " + name,
    code: J => `${setup(J)}\nfunction ask(text: string): unknown { return ${expression(J)}; }\n`,
    ...more,
  });
export const body = (name: string, code: (J: string) => string, more: Partial<Shape> = {}) =>
  contexts.push({ name, code, more }) && shapes.push({ name: "call: " + name, code, ...more });
export const type = (
  name: string,
  T: string,
  setup: string,
  bad: string[],
  good: string[],
  more: Partial<Shape> = {},
) =>
  shapes.push({
    name: "type: " + name,
    code: J => `${setup}\nfunction ask(text: string): unknown { return ${J}.parse<${T}>(text); }\n`,
    bad,
    good,
    ...more,
  });

// ---------------------------------------------------------------- the shape of the call
call("direct", J => `${J}.parse<User>(text)`);
call("a spread of a tuple", J => `${J}.parse<User>(...([text] as [string]))`);
body(
  "a spread of the rest parameter",
  J => `function ask(...all: [string]): unknown { return ${J}.parse<User>(...all); }`,
);
call("a spread behind an argument", J => `${J}.parse<User>(text, ...([] as []))`);
call(
  "a spread that brings a reviver",
  J => `${J}.parse<User>(...([text, (_k: string, v: unknown) => v] as [string, (k: string, v: unknown) => unknown]))`,
);
call("an optional call", J => `${J}.parse?.<User>(text)`);
call("an optional member", J => `${J}?.parse<User>(text)`);
call("optional twice", J => `${J}?.parse?.<User>(text)`);
call("an optional call in brackets", J => `${J}?.["parse"]?.<User>(text)`);
call("a key in brackets", J => `${J}["parse"]<User>(text)`);
call("a template key", J => `${J}[\`parse\`]<User>(text)`);
call(
  "a constant key",
  J => `${J}[key]<User>(text)`,
  () => `const key = "parse";`,
);
call("a key put together", J => `${J}[("par" + "se") as "parse"]<User>(text)`);
call(
  "a key known at run time",
  J => `${J}[key]<User>(text)`,
  () => `const key = (process.env.NOTHING_IS_SET_UNDER_THIS_NAME ?? "parse") as "parse";`,
);
call(
  "an instantiation, call",
  J => `(${J}.parse<User>).call(${J}, text)`,
  () => "",
  { spellings: ofBun },
);
call(
  "an instantiation, apply",
  J => `(${J}.parse<User>).apply(${J}, [text])`,
  () => "",
  { spellings: ofBun },
);
call(
  "an instantiation, bind",
  J => `(${J}.parse<User>).bind(${J})(text)`,
  () => "",
  { spellings: ofBun },
);
call(
  "an instantiation, bind with the text",
  J => `(${J}.parse<User>).bind(${J}, text)()`,
  () => "",
  { spellings: ofBun },
);
call(
  "an instantiation, Reflect.apply",
  J => `Reflect.apply(${J}.parse<User>, ${J}, [text])`,
  () => "",
  { spellings: ofBun },
);
call(
  "an instantiation, call.call",
  J => `Function.prototype.call.call(${J}.parse<User>, ${J}, text)`,
  () => "",
  { spellings: ofBun },
);
call(
  "an instantiation held",
  () => `held(text)`,
  J => `const held = ${J}.parse<User>;`,
  { spellings: ofBun },
);
call(
  "an instantiation called at once",
  J => `(${J}.parse<User>)(text)`,
  () => "",
  { spellings: ofBun },
);
call(
  "an instantiation as a callback of map",
  J => `[text].map(${J}.parse<User>)[0]`,
  () => "",
  { spellings: ofBun },
);
call(
  "an instantiation as a callback of then",
  J => `Promise.resolve(text).then(${J}.parse<User>)`,
  () => "",
  { spellings: ofBun },
);
call(
  "an instantiation in an object",
  () => `table.read(text)`,
  J => `const table = { read: ${J}.parse<User> };`,
  { spellings: ofBun },
);
call(
  "an instantiation handed to a function",
  J => `run(${J}.parse<User>, text)`,
  () => `function run<R>(f: (text: string) => R, text: string): R { return f(text); }`,
  { spellings: ofBun },
);
call("a comma", J => `(0, ${J}.parse)<User>(text)`);
call("a conditional of the same two", J => `(text.length > 0 ? ${J}.parse : ${J}.parse)<User>(text)`);
call(
  "a conditional with another function",
  J => `(text.length > 0 ? ${J}.parse : other)<User>(text)`,
  J => `const other: typeof ${J}.parse = ((text: string) => null) as any;`,
);
call("or", J => `(${J}.parse || ${J}.parse)<User>(text)`);
call("nullish or", J => `(${J}.parse ?? ${J}.parse)<User>(text)`);
call("and", J => `(${J} && ${J}.parse)<User>(text)`);
call("parentheses", J => `(${J}.parse)<User>(text)`);
call("parentheses round the object", J => `((${J})).parse<User>(text)`);
call("as typeof", J => `(${J}.parse as typeof ${J}.parse)<User>(text)`);
call("not null on the function", J => `${J}.parse!<User>(text)`);
call("not null on the object", J => `${J}!.parse<User>(text)`);
call("satisfies", J => `(${J}.parse satisfies Function)<User>(text)`);
call("as a generic function type", J => `(${J}.parse as <T>(text: string) => T)<User>(text)`);
call("an angle bracket cast to a generic function type", J => `(<<T>(text: string) => T>${J}.parse)<User>(text)`);
call(
  "a name typed as a generic function",
  () => `read<User>(text)`,
  J => `const read: <T>(text: string) => T = ${J}.parse;`,
);
call(
  "an object typed by an interface",
  () => `codec.parse<User>(text)`,
  J => `interface Codec { parse<T>(text: string): T }\nconst codec: Codec = ${J};`,
);
call(
  "an object cast to an interface",
  J => `(${J} as Codec).parse<User>(text)`,
  () => `interface Codec { parse<T>(text: string): T }`,
);
call(
  "an object that satisfies an interface",
  J => `(${J} satisfies Codec).parse<User>(text)`,
  () => `interface Codec { parse<T>(text: string): T }`,
);
call(
  "an object typed by Pick",
  () => `codec.parse<User>(text)`,
  J => `const codec: Pick<typeof ${J}, "parse"> = ${J};`,
);
call(
  "an object typed by typeof",
  () => `codec.parse<User>(text)`,
  J => `const codec: typeof ${J} = ${J};`,
);
call(
  "taken out",
  () => `parse<User>(text)`,
  J => `const { parse } = ${J};`,
);
call(
  "taken out under another name",
  () => `read<User>(text)`,
  J => `const { parse: read } = ${J};`,
);
call(
  "taken out with a default",
  () => `parse<User>(text)`,
  J => `const { parse = null! } = ${J};`,
);
call(
  "taken out by a computed key",
  () => `read<User>(text)`,
  J => `const { ["parse"]: read } = ${J};`,
);
call(
  "taken out with let",
  () => `parse<User>(text)`,
  J => `let { parse } = ${J};`,
);
call(
  "taken out in a parameter",
  J => `(current = text, inner(${J}))`,
  J => `let current = "";\nfunction inner({ parse }: typeof ${J}): unknown { return parse<User>(current); }`,
  {},
);
call(
  "held in const",
  () => `f<User>(text)`,
  J => `const f = ${J}.parse;`,
);
call(
  "held in let",
  () => `f<User>(text)`,
  J => `let f = ${J}.parse;`,
);
call(
  "held in var, stored twice",
  () => `f<User>(text)`,
  J => `var f = ${J}.parse; f = ${J}.parse;`,
);
call(
  "the object in const",
  () => `codec.parse<User>(text)`,
  J => `const codec = ${J};`,
);
call(
  "the object in let",
  () => `codec.parse<User>(text)`,
  J => `let codec = ${J};`,
);
call(
  "held in a list",
  () => `list[0]<User>(text)`,
  J => `const list = [${J}.parse];`,
);
call(
  "held in a tuple as const",
  () => `list[0]<User>(text)`,
  J => `const list = [${J}.parse] as const;`,
);
call(
  "held in an object",
  () => `table.p<User>(text)`,
  J => `const table = { p: ${J}.parse };`,
);
call(
  "the object held in an object",
  () => `table.codec.parse<User>(text)`,
  J => `const table = { codec: ${J} };`,
);
call(
  "given back by a function",
  () => `get()<User>(text)`,
  J => `const get = () => ${J}.parse;`,
);
call(
  "the object given back by a function",
  () => `get().parse<User>(text)`,
  J => `const get = () => ${J};`,
);
call(
  "a static member",
  () => `K.parse<User>(text)`,
  J => `class K { static parse = ${J}.parse; }`,
);
call(
  "an object made below it",
  () => `child.parse<User>(text)`,
  J => `const child: typeof ${J} = Object.create(${J});`,
);
call(
  "a class field that holds the object",
  () => `new Box().read(text)`,
  J => `class Box { codec = ${J}; read(text: string) { return this.codec.parse<User>(text); } }`,
);
call(
  "a default of a parameter holds the function",
  () => `inner(text)`,
  J => `function inner(text: string, parse = ${J}.parse): unknown { return parse<User>(text); }`,
);
body(
  "a default of a parameter is the call",
  J => `function ask(text: string, value = ${J}.parse<User>(text)): unknown { return value; }`,
);
body(
  "a default in a pattern is the call",
  J =>
    `function ask(text: string, { value = ${J}.parse<User>(text) }: { value?: User } = {}): unknown { return value; }`,
);
body(
  "a tagged template",
  J =>
    `function ask(text: string): unknown { return text === bad[0] ? ${J}.parse<User>\`{"id":"7"}\` : ${J}.parse<User>\`{"id":7}\`; }`,
  { top: "// @ts-nocheck\n" },
);
body(
  "a tagged template, one line silenced",
  J =>
    `function ask(text: string): unknown {\n  if (text === bad[0])\n    // @ts-ignore\n    return ${J}.parse<User>\`{"id":"7"}\`;\n  // @ts-ignore\n  return ${J}.parse<User>\`{"id":7}\`;\n}`,
);
body(
  "a generator",
  J =>
    `function* make(text: string) { yield ${J}.parse<User>(text); }\nfunction ask(text: string): unknown { return make(text).next().value; }`,
);
body(
  "a generator's return",
  J =>
    `function* make(text: string) { return ${J}.parse<User>(text); }\nfunction ask(text: string): unknown { return make(text).next().value; }`,
);
body(
  "behind a yield",
  J =>
    `function* make(text: string) { const other: string = yield 1; return ${J}.parse<User>(other); }\nfunction ask(text: string): unknown { const g = make(text); g.next(); return g.next(text).value; }`,
);
body("an async function", J => `async function ask(text: string): Promise<unknown> { return ${J}.parse<User>(text); }`);
body(
  "behind an await",
  J =>
    `async function ask(text: string): Promise<unknown> { const later = await Promise.resolve(text); return ${J}.parse<User>(later); }`,
);
body(
  "the argument is awaited",
  J => `async function ask(text: string): Promise<unknown> { return ${J}.parse<User>(await Promise.resolve(text)); }`,
);
body(
  "an async generator",
  J =>
    `async function* make(text: string) { yield ${J}.parse<User>(text); }\nasync function ask(text: string): Promise<unknown> { return (await make(text).next()).value; }`,
);
body("an async arrow", J => `const ask = async (text: string): Promise<unknown> => ${J}.parse<User>(text);`);
body(
  "a class field initializer",
  J =>
    `let current = "";\nclass Box { value = ${J}.parse<User>(current); }\nfunction ask(text: string): unknown { current = text; return new Box().value; }`,
);
body(
  "a static field initializer",
  J => `function ask(text: string): unknown { class Box { static value = ${J}.parse<User>(text); } return Box.value; }`,
);
body(
  "a static block",
  J =>
    `function ask(text: string): unknown { class Box { static value: unknown; static { Box.value = ${J}.parse<User>(text); } } return Box.value; }`,
);
body(
  "a private field initializer",
  J =>
    `let current = "";\nclass Box { #value = ${J}.parse<User>(current); get value() { return this.#value; } }\nfunction ask(text: string): unknown { current = text; return new Box().value; }`,
);
body(
  "a getter",
  J =>
    `class Box { constructor(private text: string) {} get value() { return ${J}.parse<User>(this.text); } }\nfunction ask(text: string): unknown { return new Box(text).value; }`,
);
body(
  "a getter of an object literal",
  J => `function ask(text: string): unknown { return { get value() { return ${J}.parse<User>(text); } }.value; }`,
);
body(
  "a setter",
  J =>
    `class Box { held: unknown; set text(text: string) { this.held = ${J}.parse<User>(text); } }\nfunction ask(text: string): unknown { const box = new Box(); box.text = text; return box.held; }`,
);
body(
  "a constructor",
  J =>
    `class Box { value: User; constructor(text: string) { this.value = ${J}.parse<User>(text); } }\nfunction ask(text: string): unknown { return new Box(text).value; }`,
);
body(
  "a parameter property's default",
  J =>
    `let current = "";\nclass Box { constructor(public value = ${J}.parse<User>(current)) {} }\nfunction ask(text: string): unknown { current = text; return new Box().value; }`,
);
body(
  "an argument of super",
  J =>
    `class Base { constructor(public value: User) {} }\nclass Box extends Base { constructor(text: string) { super(${J}.parse<User>(text)); } }\nfunction ask(text: string): unknown { return new Box(text).value; }`,
);
body(
  "a computed member name",
  J =>
    `function ask(text: string): unknown { class Box { [spell(${J}.parse<User>(text))]() {} } return globalThis.JSON.parse(Object.getOwnPropertyNames(Box.prototype)[1]); }`,
);
body(
  "an extends clause",
  J =>
    `function ask(text: string): unknown { let seen: unknown; class Box extends (seen = ${J}.parse<User>(text), Object) {} return seen; }`,
);
body(
  "a decorator's argument",
  J =>
    `let seen: unknown;\nfunction note(value: unknown) { seen = value; return (target: any, context?: any) => target; }\nfunction ask(text: string): unknown { @note(${J}.parse<User>(text)) class Box {} return seen; }`,
);
body(
  "a decorator's argument, experimental",
  J =>
    `let seen: unknown;\nfunction note(value: unknown) { seen = value; return (target: any) => target; }\nfunction ask(text: string): unknown { @note(${J}.parse<User>(text)) class Box {} return seen; }`,
  { compilerOptions: { experimentalDecorators: true } },
);
body(
  "a member decorator's argument",
  J =>
    `let seen: unknown;\nfunction note(value: unknown) { seen = value; return (target: any, context?: any) => {}; }\nfunction ask(text: string): unknown { class Box { @note(${J}.parse<User>(text)) m() {} } return seen; }`,
);
body("finally", J => `function ask(text: string): unknown { try { } finally { return ${J}.parse<User>(text); } }`);
body(
  "finally behind a throw",
  J => `function ask(text: string): unknown { try { throw 1; } catch { } finally { return ${J}.parse<User>(text); } }`,
);
body(
  "finally behind a return",
  J =>
    `function ask(text: string): unknown { let seen: unknown; const inner = () => { try { return 1; } finally { seen = ${J}.parse<User>(text); } }; inner(); return seen; }`,
);
body(
  "catch",
  J =>
    `function ask(text: string): unknown { try { throw text; } catch (thrown) { return ${J}.parse<User>(thrown as string); } }`,
);
body(
  "try whose catch throws it on",
  J => `function ask(text: string): unknown { try { return ${J}.parse<User>(text); } catch (error) { throw error; } }`,
);
body(
  "an argument of another parse",
  J => `function ask(text: string): unknown { return ${J}.parse<User>(${J}.parse<string>(spell(text))); }`,
);
body(
  "the outer of two takes all",
  J => `function ask(text: string): unknown { return ${J}.parse<{}>(spell(${J}.parse<User>(text))); }`,
);
body(
  "the inner of two takes all",
  J => `function ask(text: string): unknown { return ${J}.parse<User>(spell(${J}.parse<{}>(text))); }`,
);
body(
  "the inner of two is any",
  J => `function ask(text: string): unknown { return ${J}.parse<User>(spell(${J}.parse<any>(text))); }`,
);
body(
  "two in one expression",
  J => `function ask(text: string): unknown { return [${J}.parse<{}>(text), ${J}.parse<User>(text)][1]; }`,
);
body(
  "two types at one text, the wide one first",
  J =>
    `function ask(text: string): unknown { const wide = ${J}.parse<{ id: number | string }>(text); const narrow = ${J}.parse<User>(text); return wide.id === narrow.id ? narrow : null; }`,
);
body(
  "two types at one text, the wide one last",
  J =>
    `function ask(text: string): unknown { const narrow = ${J}.parse<User>(text); const wide = ${J}.parse<{ id: number | string }>(text); return wide.id === narrow.id ? narrow : null; }`,
);
body(
  "any first, then the type",
  J =>
    `function ask(text: string): unknown { const wide = ${J}.parse<any>(text); const narrow = ${J}.parse<User>(text); return wide.id === narrow.id ? narrow : null; }`,
);
body(
  "the result is not used",
  J => `function ask(text: string): unknown { ${J}.parse<User>(text); return { id: 7 }; }`,
);
body(
  "the result is voided",
  J => `function ask(text: string): unknown { void ${J}.parse<User>(text); return { id: 7 }; }`,
);
body(
  "the result is held and not read",
  J => `function ask(text: string): unknown { const user = ${J}.parse<User>(text); return { id: 7 }; }`,
);
body(
  "only typeof is asked",
  J => `function ask(text: string): unknown { return typeof ${J}.parse<User>(text) === "object" ? { id: 7 } : null; }`,
);
body(
  "only truth is asked",
  J => `function ask(text: string): unknown { return ${J}.parse<User>(text) ? { id: 7 } : null; }`,
);
body("the left of a comma", J => `function ask(text: string): unknown { return (${J}.parse<User>(text), { id: 7 }); }`);
body(
  "a member nobody declared is read",
  J =>
    `function ask(text: string): unknown { return (${J}.parse<User>(text) as any).nothing === undefined ? { id: 7 } : null; }`,
);
body(
  "in a loop, not used",
  J => `function ask(text: string): unknown { for (let i = 0; i < 3; i++) ${J}.parse<User>(text); return { id: 7 }; }`,
);
body(
  "hot, not used",
  J =>
    `function once(text: string) { ${J}.parse<User>(text); }\nfunction ask(text: string): unknown { for (let i = 0; i < 20000; i++) once(text); return { id: 7 }; }`,
);
body(
  "a reviver that is undefined",
  J => `function ask(text: string): unknown { return ${J}.parse<User>(text, undefined); }`,
);
body(
  "a reviver that is no function",
  J => `function ask(text: string): unknown { return ${J}.parse<User>(text, {} as any); }`,
);
body(
  "a reviver that is null",
  J => `function ask(text: string): unknown { return ${J}.parse<User>(text, null as any); }`,
);
body(
  "a reviver that may be there",
  J =>
    `function ask(text: string): unknown { return ${J}.parse<User>(text, text.length > 1000 ? (k, v) => v : undefined); }`,
);
body(
  "a reviver that spoils it",
  J => `function ask(text: string): unknown { return ${J}.parse<User>(text, (k, v) => (k === "id" ? String(v) : v)); }`,
  { bad: ['{"id":7}', '{"id":"7"}'], good: [] },
);
body(
  "a reviver that mends it",
  J => `function ask(text: string): unknown { return ${J}.parse<User>(text, (k, v) => (k === "id" ? Number(v) : v)); }`,
  { bad: [], good: ['{"id":"7"}'], returns: ['{"id":7}'] },
);
body(
  "a reviver that parses by another type",
  J =>
    `function ask(text: string): unknown { return ${J}.parse<User>(text, (k, v) => (k === "" ? v : ${J}.parse<unknown>(spell(v)))); }`,
);
body(
  "a third argument",
  J => `function ask(text: string): unknown {\n  // @ts-ignore\n  return ${J}.parse<User>(text, undefined, 1);\n}`,
);
body("no argument", J => `function ask(text: string): unknown {\n  // @ts-ignore\n  return ${J}.parse<User>();\n}`, {
  bad: ["x"],
  good: [],
});
body(
  "the text is an object with toString",
  J => `function ask(text: string): unknown { return ${J}.parse<User>({ toString: () => text } as any); }`,
);
body(
  "the text is a String object",
  J => `function ask(text: string): unknown { return ${J}.parse<User>(new String(text) as any); }`,
);
body(
  "the text is a list of one",
  J => `function ask(text: string): unknown { return ${J}.parse<User>([text] as any); }`,
);
body("the text is a number", J => `function ask(text: string): unknown { return ${J}.parse<User>(7 as any); }`, {
  bad: ["x"],
  good: [],
});
body(
  "the text changes while it is read",
  J =>
    `function ask(text: string): unknown { let n = 0; return ${J}.parse<User>({ toString: () => (n++ ? '{"id":"7"}' : text) } as any); }`,
);
body(
  "two type arguments, the type first",
  J => `function ask(text: string): unknown {\n  // @ts-ignore\n  return ${J}.parse<User, any>(text);\n}`,
);
call("a comma behind the type", J => `${J}.parse<User,>(text)`);
call(
  "comments inside",
  J => `${J} /* a */ . /* b */ parse /* c */ < /* d */ User /* e */ > /* f */ ( /* g */ text /* h */ )`,
);
call("lines inside", J => `${J}\n  .parse\n  <\n  User\n  >\n  (\n  text\n  )`);
call("the result cast to any", J => `${J}.parse<User>(text) as any`);
call("the result cast by angle brackets", J => `<any>${J}.parse<User>(text)`);
call("the result not null", J => `${J}.parse<User>(text)!`);
call("the result satisfies", J => `${J}.parse<User>(text) satisfies User`);
call("the result cast to another type", J => `${J}.parse<User>(text) as unknown as { id: string }`);
call("an arrow called at once", J => `(() => ${J}.parse<User>(text))()`);
call("a function expression called at once", J => `(function () { return ${J}.parse<User>(text); })()`);
call("inside a template", J => `globalThis.JSON.parse(\`\${spell(${J}.parse<User>(text))}\`)`);
call("inside an object literal", J => `({ value: ${J}.parse<User>(text) }).value`);
call("spread into an object literal", J => `({ ...${J}.parse<User>(text) })`);
call("inside a list", J => `[${J}.parse<User>(text)][0]`);
call("the right of and", J => `text.length > 0 && ${J}.parse<User>(text)`);
call("the right of nullish or", J => `(null as null | User) ?? ${J}.parse<User>(text)`);
call("an arm of a conditional", J => `text.length > 0 ? ${J}.parse<User>(text) : null`);
body(
  "a switch",
  J =>
    `function ask(text: string): unknown { switch (text.length > 0) { case true: return ${J}.parse<User>(text); default: return null; } }`,
);
body(
  "a case expression",
  J =>
    `function ask(text: string): unknown { let seen: unknown; switch (1 as unknown) { case (seen = ${J}.parse<User>(text)): break; } return seen; }`,
);
body(
  "the head of a for",
  J => `function ask(text: string): unknown { for (let user = ${J}.parse<User>(text); ; ) return user; }`,
);
body(
  "for of over the parse",
  J =>
    `function ask(text: string): unknown { const all = []; for (const user of ${J}.parse<User[]>(text)) all.push(user); return all; }`,
  { bad: ['[{"id":7},{"id":"7"}]', '{"id":7}'], good: ['[{"id":7}]'] },
);
body(
  "for in over the parse",
  J =>
    `function ask(text: string): unknown { const all: string[] = []; for (const key in ${J}.parse<User>(text)) all.push(key); return all; }`,
  { returns: ['["id"]'] },
);
body(
  "a pattern takes it apart",
  J => `function ask(text: string): unknown { const { id } = ${J}.parse<User>(text); return { id }; }`,
);
body(
  "a pattern takes nothing",
  J => `function ask(text: string): unknown { const {} = ${J}.parse<User>(text); return { id: 7 }; }`,
);
body(
  "a list pattern",
  J => `function ask(text: string): unknown { const [first] = ${J}.parse<User[]>(text); return first; }`,
  { bad: ['[{"id":7},{"id":"7"}]', '[{"id":"7"}]'], good: ['[{"id":7}]'], returns: ['{"id":7}'] },
);
body("a label", J => `function ask(text: string): unknown { out: { return ${J}.parse<User>(text); } }`);
body(
  "a namespace",
  J =>
    `namespace N { export const read = (text: string) => ${J}.parse<User>(text); }\nfunction ask(text: string): unknown { return N.read(text); }`,
);
body(
  "a namespace that declares JSON's type",
  J =>
    `namespace N { export type User = { id: string }; export const read = (text: string) => ${J}.parse<User>(text); }\nfunction ask(text: string): unknown { return N.read(text); }`,
  { bad: ['{"id":7}'], good: ['{"id":"7"}'] },
);
body(
  "an enum initializer",
  J => `function ask(text: string): unknown { enum E { A = ${J}.parse<number>(text) } return E.A; }`,
  { bad: ['"7"', "null"], good: ["7"] },
);
body(
  "a method of an object literal",
  J =>
    `const table = { read(text: string) { return ${J}.parse<User>(text); } };\nfunction ask(text: string): unknown { return table.read(text); }`,
);
body(
  "a callback of map",
  J => `function ask(text: string): unknown { return [text].map(one => ${J}.parse<User>(one))[0]; }`,
);
body(
  "a callback of then",
  J => `function ask(text: string): unknown { return Promise.resolve(text).then(one => ${J}.parse<User>(one)); }`,
);
body(
  "a callback of a timer",
  J =>
    `function ask(text: string): unknown { return new Promise((resolve, reject) => setTimeout(() => { try { resolve(${J}.parse<User>(text)); } catch (error) { reject(error); } }, 0)); }`,
);
body(
  "a function made in a loop",
  J =>
    `const all: ((text: string) => unknown)[] = [];\nfor (let i = 0; i < 3; i++) all.push(text => ${J}.parse<User>(text));\nfunction ask(text: string): unknown { return all[2](text); }`,
);
body(
  "a function that calls itself",
  J =>
    `function down(text: string, depth: number): unknown { return depth ? down(text, depth - 1) : ${J}.parse<User>(text); }\nfunction ask(text: string): unknown { return down(text, 5); }`,
);
body(
  "using",
  J =>
    `function ask(text: string): unknown { using held = { value: ${J}.parse<User>(text), [Symbol.dispose]() {} }; return held.value; }`,
);
body(
  "arguments",
  J =>
    `function inner(this: unknown): unknown { return ${J}.parse<User>(arguments[0]); }\nfunction ask(text: string): unknown { return (inner as any)(text); }`,
);
body("new", J => `function ask(text: string): unknown {\n  // @ts-ignore\n  return new ${J}.parse<User>(text);\n}`);
body(
  "the callee cast to any, silenced",
  J => `function ask(text: string): unknown {\n  // @ts-ignore\n  return (${J}.parse as any)<User>(text);\n}`,
);
body(
  "the object cast to any, silenced",
  J => `function ask(text: string): unknown {\n  // @ts-ignore\n  return (${J} as any).parse<User>(text);\n}`,
);
body("the whole file unchecked", J => `function ask(text: string): unknown { return ${J}.parse<User>(text); }`, {
  top: "// @ts-nocheck\n",
});
body(
  "a wrong argument, silenced",
  J => `function ask(text: string): unknown {\n  // @ts-ignore\n  return ${J}.parse<User>(text, 5, 6, 7);\n}`,
);
body(
  "unreachable by types",
  J =>
    `function never(): never { throw new Error("x"); }\nfunction ask(text: string): unknown { try { never(); } catch {} return ${J}.parse<User>(text); }`,
);
body(
  "behind a narrowing to never",
  J =>
    `function ask(text: string): unknown { const flag: true = (text.length >= 0) as true; if (!flag) return null; if (flag !== true) { return 1; } return ${J}.parse<User>(text); }`,
);
body(
  "in code that types call dead",
  J =>
    `function ask(text: string): unknown { const kind = "a" as "a"; if (kind !== "a") { return ${J}.parse<User>(text); } return (globalThis as any).nothing ?? inner(text); }\nfunction inner(text: string): unknown { const value: string = text; if (typeof value !== "string") { return ${J}.parse<{}>(value); } return ${J}.parse<User>(value); }`,
);
body(
  "behind a return by types",
  J =>
    `function stop(): never { return undefined as never; }\nfunction ask(text: string): unknown { stop(); return ${J}.parse<User>(text); }`,
);
body(
  "behind an assertion that lies",
  J =>
    `function sure(value: unknown): asserts value is never {}\nfunction ask(text: string): unknown { const copy: string = text; sure(copy); return ${J}.parse<User>(copy); }`,
);
body(
  "in an arm that types rule out",
  J =>
    `function ask(text: string): unknown { const value = text as never as number; if (typeof value === "string") { return ${J}.parse<User>(value); } return null; }`,
);

// ---------------------------------------------------------------- other files
body("re-exported object", () => `function ask(text: string): unknown { return Codec.parse<User>(text); }`, {
  imports: `import { Codec } from "./other";`,
  files: (J, imports) => ({ "other.ts": `${imports}\nexport const Codec = ${J};\n` }),
});
body("re-exported function", () => `function ask(text: string): unknown { return read<User>(text); }`, {
  imports: `import { read } from "./other";`,
  files: (J, imports) => ({ "other.ts": `${imports}\nexport const read = ${J}.parse;\n` }),
});
body("re-exported default", () => `function ask(text: string): unknown { return Codec.parse<User>(text); }`, {
  imports: `import Codec from "./other";`,
  files: (J, imports) => ({ "other.ts": `${imports}\nexport default ${J};\n` }),
});
body("export from bun", () => `function ask(text: string): unknown { return Codec.parse<User>(text); }`, {
  imports: `import { JSON as Codec } from "./other";`,
  files: () => ({ "other.ts": `export { JSON } from "bun";\n` }),
  spellings: ["Bun.JSON"],
});
body("export star from bun", () => `function ask(text: string): unknown { return Codec.parse<User>(text); }`, {
  imports: `import { JSON as Codec } from "./other";`,
  files: () => ({ "other.ts": `export * from "bun";\n` }),
  spellings: ["Bun.JSON"],
});
body("star import", () => `function ask(text: string): unknown { return bun.JSON.parse<User>(text); }`, {
  imports: `import * as bun from "bun";`,
  spellings: ["Bun.JSON"],
});
body("default import", () => `function ask(text: string): unknown { return bun.JSON.parse<User>(text); }`, {
  imports: `import bun from "bun";`,
  spellings: ["Bun.JSON"],
});
body("import equals require", () => `function ask(text: string): unknown { return bun.JSON.parse<User>(text); }`, {
  imports: `import bun = require("bun");`,
  spellings: ["Bun.JSON"],
});
body(
  "require",
  () =>
    `const bun: typeof import("bun") = require("bun");\nfunction ask(text: string): unknown { return bun.JSON.parse<User>(text); }`,
  { spellings: ["Bun.JSON"] },
);
body(
  "import()",
  () => `const bun = await import("bun");\nfunction ask(text: string): unknown { return bun.JSON.parse<User>(text); }`,
  { spellings: ["Bun.JSON"] },
);
body("globalThis.Bun", () => `function ask(text: string): unknown { return globalThis.Bun.JSON.parse<User>(text); }`, {
  spellings: ["Bun.JSON"],
});
body("Bun in const", () => `const B = Bun;\nfunction ask(text: string): unknown { return B.JSON.parse<User>(text); }`, {
  spellings: ["Bun.JSON"],
});
body(
  "taken out of Bun",
  () => `const { JSON: Codec } = Bun;\nfunction ask(text: string): unknown { return Codec.parse<User>(text); }`,
  { spellings: ["Bun.JSON"] },
);
body(
  "taken out of Bun two deep",
  () => `const { JSON: { parse } } = Bun;\nfunction ask(text: string): unknown { return parse<User>(text); }`,
  { spellings: ["Bun.JSON"] },
);
body("the call lies in another file", () => `function ask(text: string): unknown { return read(text); }`, {
  imports: `import { read } from "./other";`,
  files: (J, imports) => ({
    "other.ts": `${imports}\ntype User = { id: number };\nexport const read = (text: string) => ${J}.parse<User>(text);\n`,
  }),
});
body(
  "the call is another file's default export",
  () =>
    `async function ask(text: string): Promise<unknown> { (globalThis as any).current = text; return (await import("./other" + (text === bad[0] ? "-1" : "-2"))).default; }`,
  {
    files: (J, imports) => ({
      "other-1.ts": `${imports}\ntype User = { id: number };\nexport default ${J}.parse<User>((globalThis as any).current);\n`,
      "other-2.ts": `${imports}\ntype User = { id: number };\nexport default ${J}.parse<User>((globalThis as any).current);\n`,
    }),
  },
);
body("tsx", J => `function ask(text: string): unknown { return ${J}.parse<User>(text); }`, { extension: "tsx" });
body("mts", J => `function ask(text: string): unknown { return ${J}.parse<User>(text); }`, { extension: "mts" });
body("the call lies in a cts file", () => `function ask(text: string): unknown { return read(text); }`, {
  imports: `import { read } from "./other.cts";`,
  files: (J, imports) => ({
    "other.cts": `${imports.replace(/import (\{.*\}) from "bun";/, (_, names) => `const ${names.replace(" as ", ": ")} = require("bun");`)}\ntype User = { id: number };\nexport const read = (text: string) => ${J}.parse<User>(text);\n`,
  }),
});

// ---------------------------------------------------------------- type parameters
export const generic = (name: string, code: (J: string) => string, more: Partial<Shape> = {}) =>
  shapes.push({ name: "generic: " + name, code, ...more });
generic(
  "named at the call",
  J =>
    `function load<T>(text: string): T { return ${J}.parse<T>(text); }\nfunction ask(text: string): unknown { return load<User>(text); }`,
);
generic(
  "inferred from the return",
  J =>
    `function load<T>(text: string): T { return ${J}.parse<T>(text); }\nfunction ask(text: string): unknown { const user: User = load(text); return user; }`,
);
generic(
  "inferred from an argument",
  J =>
    `function load<T>(text: string, like: T): T { return ${J}.parse<T>(text); }\nfunction ask(text: string): unknown { return load(text, { id: 1 }); }`,
);
generic(
  "a default",
  J =>
    `function load<T = User>(text: string): T { return ${J}.parse<T>(text); }\nfunction ask(text: string): unknown { return load(text); }`,
);
generic(
  "a constraint",
  J =>
    `function load<T extends User>(text: string): T { return ${J}.parse<T>(text); }\nfunction ask(text: string): unknown { return load(text); }`,
);
generic(
  "a const type parameter",
  J =>
    `function load<const T>(text: string, like: T): T { return ${J}.parse<T>(text); }\nfunction ask(text: string): unknown { return load(text, { id: 7 }); }`,
);
generic(
  "of a class",
  J =>
    `class Box<T> { read(text: string): T { return ${J}.parse<T>(text); } }\nfunction ask(text: string): unknown { return new Box<User>().read(text); }`,
);
generic(
  "of an arrow",
  J =>
    `const load = <T,>(text: string): T => ${J}.parse<T>(text);\nfunction ask(text: string): unknown { return load<User>(text); }`,
);
generic(
  "of a method",
  J =>
    `const table = { load<T>(text: string): T { return ${J}.parse<T>(text); } };\nfunction ask(text: string): unknown { return table.load<User>(text); }`,
);
generic(
  "of an outer function",
  J =>
    `function outer<T>() { return (text: string): T => ${J}.parse<T>(text); }\nfunction ask(text: string): unknown { return outer<User>()(text); }`,
);
generic(
  "a list of T",
  J =>
    `function load<T>(text: string): T[] { return ${J}.parse<T[]>(text); }\nfunction ask(text: string): unknown { return load<User>(text); }`,
  { bad: ['[{"id":"7"}]'], good: ['[{"id":7}]'] },
);
generic(
  "a member of type T",
  J =>
    `function load<T>(text: string): { value: T } { return ${J}.parse<{ value: T }>(text); }\nfunction ask(text: string): unknown { return load<User>(text); }`,
  { bad: ['{"value":{"id":"7"}}'], good: ['{"value":{"id":7}}'] },
);
generic(
  "an optional member of type T",
  J =>
    `function load<T>(text: string): { id: number; value?: T } { return ${J}.parse<{ id: number; value?: T }>(text); }\nfunction ask(text: string): unknown { return load<User>(text); }`,
  { bad: ['{"id":1,"value":{"id":"7"}}'], good: ['{"id":1,"value":{"id":7}}'] },
);
generic(
  "Partial of T",
  J =>
    `function load<T>(text: string): Partial<T> { return ${J}.parse<Partial<T>>(text); }\nfunction ask(text: string): unknown { return load<User>(text); }`,
);
generic(
  "T and User",
  J =>
    `function load<T>(text: string): T & User { return ${J}.parse<T & User>(text); }\nfunction ask(text: string): unknown { return load<{}>(text); }`,
);
generic(
  "T or User",
  J =>
    `function load<T>(text: string): T | User { return ${J}.parse<T | User>(text); }\nfunction ask(text: string): unknown { return load<never>(text); }`,
);
generic(
  "a member of T",
  J =>
    `function load<T extends { user: unknown }>(text: string): T["user"] { return ${J}.parse<T["user"]>(text); }\nfunction ask(text: string): unknown { return load<{ user: User }>(text); }`,
);
generic(
  "a conditional over T that gives User both ways",
  J =>
    `function load<T>(text: string) { return ${J}.parse<T extends string ? User : User>(text); }\nfunction ask(text: string): unknown { return load<number>(text); }`,
);
generic(
  "a conditional over T",
  J =>
    `function load<T>(text: string) { return ${J}.parse<T extends string ? {} : User>(text); }\nfunction ask(text: string): unknown { return load<number>(text); }`,
);
generic(
  "mapped over the keys of T",
  J =>
    `function load<T>(text: string) { return ${J}.parse<{ [K in keyof T]: number }>(text); }\nfunction ask(text: string): unknown { return load<User>(text); }`,
);
generic(
  "Record by the keys of T",
  J =>
    `function load<T>(text: string) { return ${J}.parse<Record<keyof T & string, number>>(text); }\nfunction ask(text: string): unknown { return load<User>(text); }`,
);
generic(
  "Pick of User by K",
  J =>
    `function load<K extends keyof User>(text: string) { return ${J}.parse<Pick<User, K>>(text); }\nfunction ask(text: string): unknown { return load<"id">(text); }`,
);
generic(
  "a tuple's first",
  J =>
    `function load<T>(text: string) { return ${J}.parse<[T][0]>(text); }\nfunction ask(text: string): unknown { return load<User>(text); }`,
);
generic(
  "an alias that takes T",
  J =>
    `type Wrapped<T> = { value: T };\nfunction load<T>(text: string) { return ${J}.parse<Wrapped<T>>(text); }\nfunction ask(text: string): unknown { return load<User>(text); }`,
  { bad: ['{"value":{"id":"7"}}'], good: ['{"value":{"id":7}}'] },
);
generic(
  "an alias that drops T",
  J =>
    `type Same<T> = User;\nfunction load<T>(text: string) { return ${J}.parse<Same<T>>(text); }\nfunction ask(text: string): unknown { return load<string>(text); }`,
);
generic(
  "this",
  J =>
    `class Box { id = 1; read(text: string) { return ${J}.parse<this>(text); } }\nfunction ask(text: string): unknown { return new Box().read(text); }`,
);
generic(
  "a member of this",
  J =>
    `class Box { user: User = { id: 1 }; read(text: string) { return ${J}.parse<this["user"]>(text); } }\nfunction ask(text: string): unknown { return new Box().read(text); }`,
);
generic(
  "infer",
  J =>
    `function load<T>(text: string) { return ${J}.parse<T extends infer U ? U : never>(text); }\nfunction ask(text: string): unknown { return load<User>(text); }`,
);
generic(
  "typeof a parameter of type T",
  J =>
    `function load<T>(text: string, like: T) { return ${J}.parse<typeof like>(text); }\nfunction ask(text: string): unknown { return load(text, { id: 1 }); }`,
);
generic(
  "typeof a local of type T",
  J =>
    `function load<T>(text: string, like: T) { const copy = like; return ${J}.parse<typeof copy>(text); }\nfunction ask(text: string): unknown { return load(text, { id: 1 }); }`,
);
generic(
  "typeof a member of type T",
  J =>
    `function load<T>(text: string, like: { value: T }) { return ${J}.parse<typeof like.value>(text); }\nfunction ask(text: string): unknown { return load(text, { value: { id: 1 } }); }`,
);
generic(
  "ReturnType of a function type parameter",
  J =>
    `function load<F extends () => unknown>(text: string, make: F) { return ${J}.parse<ReturnType<F>>(text); }\nfunction ask(text: string): unknown { return load(text, () => ({ id: 1 })); }`,
);
generic(
  "a local alias of T",
  J =>
    `function load<T>(text: string) { type Local = T; return ${J}.parse<Local>(text); }\nfunction ask(text: string): unknown { return load<User>(text); }`,
);
generic(
  "a local interface with a member T",
  J =>
    `function load<T>(text: string) { interface Local { value: T } return ${J}.parse<Local>(text); }\nfunction ask(text: string): unknown { return load<User>(text); }`,
  { bad: ['{"value":{"id":"7"}}'], good: ['{"value":{"id":7}}'] },
);
generic(
  "a type parameter with the name of a type",
  J =>
    `function load<User>(text: string) { return ${J}.parse<User>(text); }\nfunction ask(text: string): unknown { return load<{ id: number }>(text); }`,
);
generic(
  "a generic alias fully given",
  J =>
    `type Wrapped<T> = { value: T };\nfunction ask(text: string): unknown { return ${J}.parse<Wrapped<User>>(text); }`,
  { bad: ['{"value":{"id":"7"}}', '{"value":null}', "{}"], good: ['{"value":{"id":7}}'] },
);
generic(
  "a generic alias by its default",
  J =>
    `type Wrapped<T = User> = { value: T };\nfunction ask(text: string): unknown { return ${J}.parse<Wrapped>(text); }`,
  { bad: ['{"value":{"id":"7"}}', "{}"], good: ['{"value":{"id":7}}'] },
);
generic(
  "a generic interface fully given",
  J =>
    `interface Wrapped<T> { value: T; next?: Wrapped<T> }\nfunction ask(text: string): unknown { return ${J}.parse<Wrapped<User>>(text); }`,
  {
    bad: ['{"value":{"id":"7"}}', '{"value":{"id":7},"next":{"value":{"id":"7"}}}'],
    good: ['{"value":{"id":7},"next":{"value":{"id":8}}}'],
  },
);
generic(
  "one generic alias at two types",
  J =>
    `type Wrapped<T> = { value: T };\nfunction ask(text: string): unknown { ${J}.parse<Wrapped<string | number>>(text); return ${J}.parse<Wrapped<number>>(text); }`,
  { bad: ['{"value":"7"}'], good: ['{"value":7}'] },
);
generic(
  "one generic alias at two types, the narrow one first",
  J =>
    `type Wrapped<T> = { value: T };\nfunction ask(text: string): unknown { try { ${J}.parse<Wrapped<number>>('{"value":1}'); } catch {} ${J}.parse<Wrapped<string | number>>(text); return ${J}.parse<Wrapped<number>>(text); }`,
  { bad: ['{"value":"7"}'], good: ['{"value":7}'] },
);

// ---------------------------------------------------------------- where the type comes from
const U = ['{"id":"7"}', '{"id":null}', "{}", "null", "[]", "7", '"x"'];
type("typeof a constant", "typeof sample", `const sample = { id: 1 };`, U, ['{"id":7}']);
type(
  "typeof a constant as const",
  "typeof sample",
  `const sample = { id: 7 } as const;`,
  [...U, '{"id":8}'],
  ['{"id":7}'],
);
type("typeof a let", "typeof sample", `let sample = { id: 1 };`, U, ['{"id":7}']);
type("typeof a member", "typeof sample.user", `const sample = { user: { id: 1 } };`, U, ['{"id":7}']);
type("typeof a function's parameter", "typeof user", ``, U, ['{"id":7}'], {
  code: J =>
    `function inner(text: string, user: User) { return ${J}.parse<typeof user>(text); }\nfunction ask(text: string): unknown { return inner(text, { id: 1 }); }`,
});
type("typeof a narrowed name", "typeof value", ``, ['"x"', "null", "{}"], ["7"], {
  code: J =>
    `function inner(text: string, value: string | number) { if (typeof value === "number") return ${J}.parse<typeof value>(text); return null; }\nfunction ask(text: string): unknown { return inner(text, 1); }`,
});
type("typeof a name narrowed by an assignment", "typeof value", ``, ['"x"', "null"], ["7"], {
  code: J =>
    `function ask(text: string): unknown { let value: string | number = "a"; value = 1; return ${J}.parse<typeof value>(text); }`,
});
type(
  "typeof a class instance name",
  "typeof point",
  `class Point { x = 0; y = 0; }\nconst point = new Point();`,
  ['{"x":"1","y":2}', '{"x":1}'],
  ['{"x":1,"y":2}'],
);
type("typeof an imported constant", "typeof sample", ``, U, ['{"id":7}'], {
  imports: `import { sample } from "./types";`,
  files: () => ({ "types.ts": `export const sample = { id: 1 };\n` }),
});
type("typeof an import of a json file", "typeof sample", ``, U, ['{"id":7}'], {
  imports: `import sample from "./sample.json";`,
  files: () => ({ "sample.json": `{"id":1}` }),
  compilerOptions: { resolveJsonModule: true },
});
type("typeof a value of an untyped js file", "typeof sample", ``, U, ['{"id":7}'], {
  imports: `import { sample } from "./untyped.js";`,
  files: () => ({ "untyped.js": `export const sample = { id: 1 };\n` }),
});
type("typeof a value of an untyped js file, not strict", "typeof sample", ``, U, ['{"id":7}'], {
  imports: `import { sample } from "./untyped.js";`,
  files: () => ({ "untyped.js": `export const sample = { id: 1 };\n` }),
  compilerOptions: { strict: false },
});
type("typeof a value of a js file, allowJs", "typeof sample", ``, U, ['{"id":7}'], {
  imports: `import { sample } from "./untyped.js";`,
  files: () => ({ "untyped.js": `export const sample = { id: 1 };\n` }),
  compilerOptions: { allowJs: true, checkJs: false },
});
type(
  "a member whose type is typeof an untyped import, not strict",
  "{ id: number; more: typeof sample }",
  ``,
  ['{"id":1,"more":{"id":"7"}}', '{"id":1,"more":5}', '{"id":1}'],
  ['{"id":1,"more":{"id":7}}'],
  {
    imports: `import { sample } from "./untyped.js";`,
    files: () => ({ "untyped.js": `export const sample = { id: 1 };\n` }),
    compilerOptions: { strict: false },
  },
);
type(
  "a member whose type is not declared, silenced",
  "Holder",
  `type Holder = {\n  id: number;\n  // @ts-ignore\n  more: NotDeclared;\n};`,
  ['{"id":1,"more":5}', '{"id":1}'],
  [],
);
type(
  "an element whose type is not declared, silenced",
  "Holder",
  `// @ts-ignore\ntype Holder = NotDeclared[];`,
  ["[5]", "[]"],
  [],
);
type(
  "a member of a package that is not there, silenced",
  "{ id: number; more: Missing }",
  ``,
  ['{"id":1,"more":5}'],
  [],
  { imports: `// @ts-ignore\nimport type { Missing } from "a-package-that-is-not-installed";` },
);
type(
  "a member that is ReturnType of JSON.parse",
  "{ id: number; more: ReturnType<typeof globalThis.JSON.parse> }",
  ``,
  ['{"id":"1","more":5}'],
  ['{"id":1,"more":5}'],
);
type("ReturnType", "ReturnType<typeof make>", `function make() { return { id: 1 }; }`, U, ['{"id":7}']);
type(
  "ReturnType of an arrow with a written type",
  "ReturnType<typeof make>",
  `const make = (): User => ({ id: 1 });`,
  U,
  ['{"id":7}'],
);
type(
  "ReturnType of an overloaded function",
  "ReturnType<typeof make>",
  `function make(a: string): { id: string };\nfunction make(a: number): User;\nfunction make(a: unknown): unknown { return a; }`,
  U,
  ['{"id":7}'],
);
type(
  "ReturnType of a generic function",
  "ReturnType<typeof make<User>>",
  `function make<T>(value?: T): T { return value!; }`,
  U,
  ['{"id":7}'],
);
type("Awaited", "Awaited<Promise<User>>", ``, U, ['{"id":7}']);
type(
  "Awaited of ReturnType of an async function",
  "Awaited<ReturnType<typeof make>>",
  `async function make() { return { id: 1 }; }`,
  U,
  ['{"id":7}'],
);
type("Awaited twice", "Awaited<Promise<Promise<User>>>", ``, U, ['{"id":7}']);
type("Parameters", "Parameters<typeof take>[0]", `function take(user: User) {}`, U, ['{"id":7}']);
type(
  "Parameters whole",
  "Parameters<typeof take>",
  `function take(user: User, n: number) {}`,
  ['[{"id":"7"},1]', '[{"id":7}]', '[{"id":7},1,2]', '[{"id":7},"1"]', "{}"],
  ['[{"id":7},1]'],
);
type("ConstructorParameters", "ConstructorParameters<typeof K>[0]", `class K { constructor(user: User) {} }`, U, [
  '{"id":7}',
]);
type("InstanceType", "InstanceType<typeof K>", `class K { id = 1; }`, U, ['{"id":7}']);
type("NonNullable", "NonNullable<User | null | undefined>", ``, U, ['{"id":7}']);
type("Exclude", "Exclude<User | string | null, string | null>", ``, U, ['{"id":7}']);
type("Extract", "Extract<User | string | null, object>", ``, U, ['{"id":7}']);
type("a conditional", "Pick1<number>", `type Pick1<T> = T extends number ? User : { id: string };`, U, ['{"id":7}']);
type(
  "a distributive conditional",
  "Boxed<number | string>",
  `type Boxed<T> = T extends unknown ? { v: T } : never;`,
  ['{"v":null}', '{"v":true}', "{}"],
  ['{"v":7}', '{"v":"x"}'],
);
type("a conditional with infer", "Element<User[]>", `type Element<T> = T extends (infer E)[] ? E : never;`, U, [
  '{"id":7}',
]);
type(
  "a conditional that gives never",
  "Nothing<string>",
  `type Nothing<T> = T extends string ? never : User;`,
  [...U, '{"id":7}'],
  [],
);
type("a recursive conditional", "Deep<[[User]]>", `type Deep<T> = T extends [infer E] ? Deep<E> : T;`, U, ['{"id":7}']);
type(
  "Partial",
  "Partial<{ id: number; name: string }>",
  ``,
  ['{"id":"7"}', '{"name":1}', '{"id":null}', "null", "[]"],
  ["{}", '{"id":7}', '{"id":7,"name":"a"}'],
);
type(
  "Required",
  "Required<{ id?: number; name?: string }>",
  ``,
  ['{"id":7}', "{}", '{"id":7,"name":1}', '{"id":7,"name":null}'],
  ['{"id":7,"name":"a"}'],
);
type("Readonly", "Readonly<User>", ``, U, ['{"id":7}']);
type("Pick", 'Pick<{ id: number; name: string }, "id">', ``, U, ['{"id":7}', '{"id":7,"name":5}']);
type("Omit", 'Omit<{ id: number; name: string }, "name">', ``, U, ['{"id":7}', '{"id":7,"name":5}']);
type(
  "Record of literal keys",
  'Record<"a" | "b", number>',
  ``,
  ['{"a":1}', '{"a":1,"b":"2"}', "{}", '{"b":2}'],
  ['{"a":1,"b":2}'],
);
type(
  "Record of string",
  "Record<string, number>",
  ``,
  ['{"a":"1"}', '{"a":1,"b":null}', "[]", "null", '{"__proto__":"x"}'],
  ["{}", '{"a":1,"b":2}'],
);
type(
  "a mapped type",
  "{ [K in keyof Both]: Both[K] }",
  `type Both = { id: number; name: string };`,
  ['{"id":7}', '{"id":7,"name":1}'],
  ['{"id":7,"name":"a"}'],
);
type(
  "a mapped type that takes the question mark away",
  "{ [K in keyof Both]-?: Both[K] }",
  `type Both = { id?: number; name?: string };`,
  ['{"id":7}', "{}"],
  ['{"id":7,"name":"a"}'],
);
type(
  "a mapped type that renames",
  "{ [K in keyof Both as `x_${K}`]: Both[K] }",
  `type Both = { id: number; name: string };`,
  ['{"id":7,"name":"a"}', '{"x_id":7}', '{"x_id":"7","x_name":"a"}'],
  ['{"x_id":7,"x_name":"a"}'],
);
type(
  "a mapped type that filters",
  "{ [K in keyof Both as Both[K] extends number ? K : never]: Both[K] }",
  `type Both = { id: number; name: string };`,
  U,
  ['{"id":7}'],
);
type(
  "a mapped type over a union",
  '{ [K in "a" | "b"]: K }',
  ``,
  ['{"a":"b","b":"a"}', '{"a":"a"}'],
  ['{"a":"a","b":"b"}'],
);
type(
  "a mapped type over a tuple",
  "Strings<[number, number]>",
  `type Strings<T> = { [K in keyof T]: string };`,
  ["[1,2]", '["a"]', '["a","b","c"]', '{"0":"a","1":"b"}'],
  ['["a","b"]'],
);
type(
  "a mapped type over a list",
  "Strings<number[]>",
  `type Strings<T> = { [K in keyof T]: string };`,
  ["[1,2]", '{"0":"a"}'],
  ['["a","b"]', "[]"],
);
type(
  "a template literal type",
  "`id-${number}`",
  ``,
  ['"id-"', '"id-x"', '"7"', "7", '"ID-7"', '" id-7"', '"id-7x"'],
  ['"id-7"', '"id-1.5"', '"id-7 "'],
);
type(
  "a template literal type of a union",
  '`${"a" | "b"}-${"x" | "y"}`',
  ``,
  ['"a-z"', '"c-x"', '"a-"', '"ax"', '"a-xx"'],
  ['"a-x"', '"b-y"'],
);
type(
  "a template literal type of string",
  "`a${string}z`",
  ``,
  ['"a"', '"z"', '"bz"', '"ab"', '""'],
  ['"az"', '"a--z"'],
);
type("a template key", "{ [K in `k${1 | 2}`]: number }", ``, ['{"k1":1}', '{"k1":1,"k2":"2"}'], ['{"k1":1,"k2":2}']);
type("Uppercase of a union", 'Uppercase<"a" | "b">', ``, ['"a"', '"C"', '""'], ['"A"', '"B"']);
type(
  "Capitalize in a template",
  '`get${Capitalize<"id" | "name">}`',
  ``,
  ['"getid"', '"get"', '"getX"'],
  ['"getId"', '"getName"'],
);
type(
  "an imported type",
  "Person",
  ``,
  ['{"id":7}', '{"id":7,"name":1}', '{"id":"7","name":"a"}'],
  ['{"id":7,"name":"a"}'],
  {
    imports: `import type { Person } from "./types";`,
    files: () => ({ "types.ts": `export type Person = { id: number; name: string };\n` }),
  },
);
type("an imported type, no word type", "Person", ``, ['{"id":7}', '{"id":7,"name":1}'], ['{"id":7,"name":"a"}'], {
  imports: `import { Person } from "./types";`,
  files: () => ({ "types.ts": `export type Person = { id: number; name: string };\n` }),
});
type("an imported type under another name", "Someone", ``, ['{"id":7}', '{"id":7,"name":1}'], ['{"id":7,"name":"a"}'], {
  imports: `import { type Person as Someone } from "./types";`,
  files: () => ({ "types.ts": `export type Person = { id: number; name: string };\n` }),
});
type("an imported type with the name of a local one in the other file", "User2", ``, ['{"id":7}'], ['{"id":"7"}'], {
  imports: `import type { User as User2 } from "./types";`,
  files: () => ({ "types.ts": `export type User = { id: string };\n` }),
});
type("a type exported on through two files", "Person", ``, ['{"id":7}', '{"id":7,"name":1}'], ['{"id":7,"name":"a"}'], {
  imports: `import type { Person } from "./a";`,
  files: () => ({
    "a.ts": `export * from "./b";\n`,
    "b.ts": `export type { Person } from "./c";\n`,
    "c.ts": `export interface Person { id: number; name: string }\n`,
  }),
});
type("a default export that is a type", "Person", ``, ['{"id":7}', '{"id":7,"name":1}'], ['{"id":7,"name":"a"}'], {
  imports: `import type Person from "./types";`,
  files: () => ({ "types.ts": `interface Person { id: number; name: string }\nexport default Person;\n` }),
});
type("import() as a type", 'import("./types").Person', ``, ['{"id":7}', '{"id":7,"name":1}'], ['{"id":7,"name":"a"}'], {
  files: () => ({ "types.ts": `export type Person = { id: number; name: string };\n` }),
});
type("typeof import()", '(typeof import("./types"))["sample"]', ``, U, ['{"id":7}'], {
  files: () => ({ "types.ts": `export const sample = { id: 1 };\n` }),
});
type("a star import's type", "types.Person", ``, ['{"id":7}', '{"id":7,"name":1}'], ['{"id":7,"name":"a"}'], {
  imports: `import type * as types from "./types";`,
  files: () => ({ "types.ts": `export type Person = { id: number; name: string };\n` }),
});
type("a type of a declaration file", "Person", ``, ['{"id":7}', '{"id":7,"name":1}'], ['{"id":7,"name":"a"}'], {
  imports: `import type { Person } from "./types";`,
  files: () => ({ "types.d.ts": `export type Person = { id: number; name: string };\n` }),
});
type("a global type of a declaration file", "Person", ``, ['{"id":7}', '{"id":7,"name":1}'], ['{"id":7,"name":"a"}'], {
  files: () => ({ "globals.d.ts": `interface Person { id: number; name: string }\n` }),
});
type("a type of a package", "Person", ``, ['{"id":7}', '{"id":7,"name":1}'], ['{"id":7,"name":"a"}'], {
  imports: `import type { Person } from "people";`,
  files: () => ({
    "node_modules/people/package.json": `{"name":"people","version":"1.0.0","types":"index.d.ts","main":"index.js"}`,
    "node_modules/people/index.d.ts": `export interface Person { id: number; name: string }\n`,
    "node_modules/people/index.js": ``,
  }),
});
type("a type of @types", "Person", ``, ['{"id":7}', '{"id":7,"name":1}'], ['{"id":7,"name":"a"}'], {
  imports: `import type { Person } from "people";`,
  files: () => ({
    "node_modules/people/package.json": `{"name":"people","version":"1.0.0","main":"index.js"}`,
    "node_modules/people/index.js": ``,
    "node_modules/@types/people/package.json": `{"name":"@types/people","version":"1.0.0","types":"index.d.ts"}`,
    "node_modules/@types/people/index.d.ts": `export interface Person { id: number; name: string }\n`,
  }),
});
type("a type by a path of tsconfig", "Person", ``, ['{"id":7}', '{"id":7,"name":1}'], ['{"id":7,"name":"a"}'], {
  imports: `import type { Person } from "@/types";`,
  files: () => ({ "src/types.ts": `export type Person = { id: number; name: string };\n` }),
  compilerOptions: { paths: { "@/*": ["./src/*"] } },
});
type(
  "a namespace member",
  "N.Person",
  `namespace N { export type Person = { id: number; name: string }; }`,
  ['{"id":7}', '{"id":7,"name":1}'],
  ['{"id":7,"name":"a"}'],
);
type(
  "a namespace two deep",
  "N.M.Person",
  `namespace N.M { export interface Person { id: number; name: string } }`,
  ['{"id":7}', '{"id":7,"name":1}'],
  ['{"id":7,"name":"a"}'],
);
type(
  "a namespace merged",
  "N.Person",
  `namespace N { export interface Person { id: number } }\nnamespace N { export interface Person { name: string } }`,
  ['{"id":7}', '{"name":"a"}', '{"id":7,"name":1}'],
  ['{"id":7,"name":"a"}'],
);
type(
  "an import alias of a namespace member",
  "P",
  `namespace N { export type Person = { id: number; name: string }; }\nimport P = N.Person;`,
  ['{"id":7}', '{"id":7,"name":1}'],
  ['{"id":7,"name":"a"}'],
);
type(
  "a namespace merged with a function",
  "make.Options",
  `function make() {}\nnamespace make { export type Options = { id: number; name: string }; }`,
  ['{"id":7}', '{"id":7,"name":1}'],
  ['{"id":7,"name":"a"}'],
);
type("a class", "Point", `class Point { x = 0; y = 0; }`, ['{"x":"1","y":2}', '{"x":1}', "null"], ['{"x":1,"y":2}']);
type(
  "a class with a method",
  "Point",
  `class Point { x = 0; norm() { return this.x; } }`,
  ['{"x":1}', '{"x":"1"}'],
  [],
);
type(
  "a class with a private member",
  "Point",
  `class Point { x = 0; private y = 0; }`,
  ['{"x":1}', '{"x":1,"y":"2"}', '{"x":"1","y":2}'],
  [],
);
type("a class with a hash member", "Point", `class Point { x = 0; #y = 0; }`, ['{"x":"1"}'], []);
type(
  "a class with a protected member",
  "Point",
  `class Point { x = 0; protected y = 0; }`,
  ['{"x":1}', '{"x":1,"y":"2"}'],
  [],
);
type("a class with a static member", "Point", `class Point { x = 0; static z = 1; }`, ['{"x":"1"}', "{}"], ['{"x":1}']);
type(
  "a class with an accessor",
  "Point",
  `class Point { x = 0; get w() { return 1; } set w(value: number) {} }`,
  ['{"x":1}', '{"x":1,"w":"2"}'],
  [],
);
type(
  "a class with a getter alone",
  "Point",
  `class Point { x = 0; get w() { return 1; } }`,
  ['{"x":1}', '{"x":1,"w":"2"}'],
  [],
);
type(
  "a class with an auto accessor",
  "Point",
  `class Point { x = 0; accessor w = 1; }`,
  ['{"x":1}', '{"x":1,"w":"2"}'],
  [],
);
type(
  "a class below a class",
  "Point3",
  `class Point { x = 0; }\nclass Point3 extends Point { z = 0; }`,
  ['{"z":1}', '{"x":1}', '{"x":"1","z":1}'],
  ['{"x":1,"z":1}'],
);
type(
  "an abstract class",
  "Shape",
  `abstract class Shape { id = 0; abstract area: number; }`,
  ['{"id":1}', '{"id":1,"area":"2"}'],
  ['{"id":1,"area":2}'],
);
type("a class with a declared member", "Point", `class Point { declare x: number; }`, ['{"x":"1"}', "{}"], ['{"x":1}']);
type(
  "a class with an optional member",
  "Point",
  `class Point { x = 0; y?: number; }`,
  ['{"x":1,"y":"2"}', "{}"],
  ['{"x":1}', '{"x":1,"y":2}'],
);
type(
  "a class with parameter properties",
  "Point",
  `class Point { constructor(public x: number, readonly y: number) {} }`,
  ['{"x":1}', '{"x":1,"y":"2"}'],
  ['{"x":1,"y":2}'],
);
type(
  "an interface below a class",
  "Named",
  `class Point { x = 0; }\ninterface Named extends Point { name: string }`,
  ['{"x":1}', '{"name":"a"}', '{"x":"1","name":"a"}'],
  ['{"x":1,"name":"a"}'],
);
type(
  "an interface merged with a class",
  "Point",
  `class Point { x = 0; }\ninterface Point { name: string }`,
  ['{"x":1}', '{"name":"a"}'],
  ['{"x":1,"name":"a"}'],
);
type(
  "a member that is a class",
  "{ at: Point }",
  `class Point { x = 0; }`,
  ['{"at":{"x":"1"}}', '{"at":null}', "{}"],
  ['{"at":{"x":1}}'],
);
type("typeof a class", "typeof Point", `class Point { x = 0; static z = 1; }`, ['{"z":1}', '{"z":"1"}', "{}"], []);
type("an enum", "Color", `enum Color { Red, Green }`, ["2", "-1", '"Red"', "null", "0.5", '"0"', "1e400"], ["0", "1"]);
type("an enum with values", "Flag", `enum Flag { A = 1, B = 2, C = 4 }`, ["0", "8", '"A"', "1.5"], ["1", "2", "4"]);
type(
  "a string enum",
  "Color",
  `enum Color { Red = "red", Green = "green" }`,
  ['"Red"', '"blue"', "0", '""', "null"],
  ['"red"', '"green"'],
);
type("a mixed enum", "Mixed", `enum Mixed { A = 1, B = "b" }`, ['"A"', "2", '"1"'], ["1", '"b"']);
type("a const enum", "Color", `const enum Color { Red, Green }`, ["2", '"Red"', "null"], ["0", "1"]);
type(
  "a const string enum",
  "Color",
  `const enum Color { Red = "red", Green = "green" }`,
  ['"Red"', "0"],
  ['"red"', '"green"'],
);
type("a declared enum", "Color", `declare enum Color { Red = 0, Green = 1 }`, ["2", '"Red"'], ["0", "1"]);
type("a declared const enum", "Color", `declare const enum Color { Red = 0, Green = 1 }`, ["2", '"Red"'], ["0", "1"]);
type("an enum member", "Color.Green", `enum Color { Red, Green }`, ["0", "2", '"Green"'], ["1"]);
type(
  "an enum with a computed member",
  "Sized",
  `enum Sized { A = "ab".length, B = 7 }`,
  ['"A"', "null", '"7"'],
  ["7", "2"],
);
type("an enum merged", "Color", `enum Color { Red }\nenum Color { Green = 1 }`, ["2", '"Red"'], ["0", "1"]);
type("an imported enum", "Color", ``, ["2", '"Red"'], ["0", "1"], {
  imports: `import { Color } from "./types";`,
  files: () => ({ "types.ts": `export enum Color { Red, Green }\n` }),
});
type("an imported const enum", "Color", ``, ["2", '"Red"'], ["0", "1"], {
  imports: `import { Color } from "./types";`,
  files: () => ({ "types.ts": `export const enum Color { Red, Green }\n` }),
});
type(
  "an enum as a tag",
  "Shape",
  `enum Kind { Circle, Square }\ntype Shape = { kind: Kind.Circle; r: number } | { kind: Kind.Square; side: number };`,
  ['{"kind":0,"side":1}', '{"kind":1,"r":1}', '{"kind":2,"r":1}', '{"kind":"Circle","r":1}'],
  ['{"kind":0,"r":1}', '{"kind":1,"side":1}'],
);
type("keys of an enum", "keyof typeof Color", `enum Color { Red, Green }`, ['"red"', "0", '"0"'], ['"Red"', '"Green"']);
type(
  "a record by an enum",
  "Record<Color, number>",
  `enum Color { Red = "red", Green = "green" }`,
  ['{"red":1}', '{"red":1,"green":"2"}', '{"Red":1,"Green":2}'],
  ['{"red":1,"green":2}'],
);
type(
  "an interface merged in one file",
  "Person",
  `interface Person { id: number }\ninterface Person { name: string }`,
  ['{"id":7}', '{"name":"a"}', '{"id":7,"name":1}'],
  ['{"id":7,"name":"a"}'],
);
type(
  "an interface merged over two files, global",
  "Person",
  `declare global { interface Person { id: number } }`,
  ['{"id":7}', '{"name":"a"}', '{"id":7,"name":1}'],
  ['{"id":7,"name":"a"}'],
  {
    imports: `import "./more";`,
    files: () => ({ "more.ts": `declare global { interface Person { name: string } }\nexport {};\n` }),
  },
);
type(
  "an interface merged over two files, the other never imported",
  "Person",
  `declare global { interface Person { id: number } }`,
  ['{"id":7}', '{"name":"a"}', '{"id":7,"name":1}'],
  ['{"id":7,"name":"a"}'],
  { files: () => ({ "more.d.ts": `interface Person { name: string }\n` }) },
);
type(
  "a module augmentation",
  "Person",
  ``,
  ['{"id":7}', '{"name":"a"}', '{"id":7,"name":1}'],
  ['{"id":7,"name":"a"}'],
  {
    imports: `import type { Person } from "./types";\nimport "./more";`,
    files: () => ({
      "types.ts": `export interface Person { id: number }\n`,
      "more.ts": `declare module "./types" { interface Person { name: string } }\nexport {};\n`,
    }),
  },
);
type(
  "a module augmentation in this file",
  "Person",
  `declare module "./types" { interface Person { name: string } }`,
  ['{"id":7}', '{"name":"a"}', '{"id":7,"name":1}'],
  ['{"id":7,"name":"a"}'],
  {
    imports: `import type { Person } from "./types";`,
    files: () => ({ "types.ts": `export interface Person { id: number }\n` }),
  },
);
type(
  "a module augmentation of a package",
  "Person",
  `declare module "people" { interface Person { name: string } }`,
  ['{"id":7}', '{"name":"a"}', '{"id":7,"name":1}'],
  ['{"id":7,"name":"a"}'],
  {
    imports: `import type { Person } from "people";`,
    files: () => ({
      "node_modules/people/package.json": `{"name":"people","version":"1.0.0","types":"index.d.ts","main":"index.js"}`,
      "node_modules/people/index.d.ts": `export interface Person { id: number }\n`,
      "node_modules/people/index.js": ``,
    }),
  },
);
type(
  "a global augmentation of a built-in interface",
  "{ at: Marked }",
  `declare global { interface Marked { id: number } }`,
  ['{"at":{"id":"7"}}', '{"at":{}}'],
  ['{"at":{"id":7}}'],
);
type("a type that shadows a global one", "Request", `type Request = { id: number };`, U, ['{"id":7}']);
type("a type that shadows a type of the library in a block", "Date", ``, U, ['{"id":7}'], {
  code: J => `function ask(text: string): unknown { type Date = { id: number }; return ${J}.parse<Date>(text); }`,
});
type("a local type that shadows an outer one", "User", ``, ['{"id":7}'], ['{"id":"7"}'], {
  code: J => `function ask(text: string): unknown { type User = { id: string }; return ${J}.parse<User>(text); }`,
});
type("two local types of one name in two functions", "Local", ``, ['{"id":"7"}'], ['{"id":7}'], {
  code: J =>
    `function other(text: string): unknown { type Local = { id: string }; return ${J}.parse<Local>(text); }\nfunction ask(text: string): unknown { type Local = { id: number }; try { other('{"id":"x"}'); } catch {} return ${J}.parse<Local>(text); }`,
});
type("two local types of one name in two blocks", "Local", ``, ['{"id":"7"}'], ['{"id":7}'], {
  code: J =>
    `function ask(text: string): unknown { { type Local = { id: string }; ${J}.parse<Local>('{"id":"x"}'); } { type Local = { id: number }; return ${J}.parse<Local>(text); } }`,
});
type(
  "two types of one shape but for one member's type",
  "B",
  `type A = { id: string; name: string };\ntype B = { id: number; name: string };`,
  ['{"id":"7","name":"a"}'],
  ['{"id":7,"name":"a"}'],
  {
    code: J =>
      `type A = { id: string; name: string };\ntype B = { id: number; name: string };\nfunction ask(text: string): unknown { ${J}.parse<A>('{"id":"x","name":"a"}'); return ${J}.parse<B>(text); }`,
  },
);
type(
  "an interface that extends two",
  "C",
  `interface A { id: number }\ninterface B { name: string }\ninterface C extends A, B { on: boolean }`,
  ['{"id":7,"name":"a"}', '{"id":7,"on":true}', '{"name":"a","on":true}', '{"id":7,"name":"a","on":1}'],
  ['{"id":7,"name":"a","on":true}'],
);
type(
  "an interface that narrows what it extends",
  "B",
  `interface A { id: number | string }\ninterface B extends A { id: number }`,
  U,
  ['{"id":7}'],
);
type(
  "an interface that extends an alias of an intersection",
  "B",
  `type A = { id: number } & { name: string };\ninterface B extends A { on: boolean }`,
  ['{"id":7,"on":true}', '{"name":"a","on":true}'],
  ['{"id":7,"name":"a","on":true}'],
);
type(
  "an interface that extends Pick",
  "B",
  `interface A { id: number; name: string; extra: string }\ninterface B extends Pick<A, "id" | "name"> {}`,
  ['{"id":7}', '{"name":"a"}'],
  ['{"id":7,"name":"a"}'],
);
type(
  "an interface that extends a generic one",
  "B",
  `interface A<T> { value: T }\ninterface B extends A<number> { name: string }`,
  ['{"value":"7","name":"a"}', '{"name":"a"}'],
  ['{"value":7,"name":"a"}'],
);
type(
  "an interface that extends Array",
  "Numbers",
  `interface Numbers extends Array<number> {}`,
  ['["a"]', "{}", "null"],
  ["[1,2]", "[]"],
);
type("an indexed access", 'Holder["user"]', `type Holder = { user: User; other: string };`, U, ['{"id":7}']);
type(
  "an indexed access by a union",
  'Holder["a" | "b"]',
  `type Holder = { a: number; b: boolean; c: string };`,
  ['"x"', "null"],
  ["1", "true"],
);
type("an element by number", "Users[number]", `type Users = User[];`, U, ['{"id":7}']);
type(
  "an element of a constant list",
  "(typeof names)[number]",
  `const names = ["a", "b"] as const;`,
  ['"c"', '""', "0"],
  ['"a"', '"b"'],
);
type("keyof", "keyof Both", `type Both = { id: number; name: string };`, ['"x"', '""', "0"], ['"id"', '"name"']);
type(
  "values of a constant object",
  "(typeof table)[keyof typeof table]",
  `const table = { a: 1, b: "two" } as const;`,
  ["2", '"a"', '"b"'],
  ["1", '"two"'],
);
type(
  "satisfies keeps the literal",
  "typeof sample",
  `const sample = { kind: "a" } satisfies { kind: string };`,
  ['{"kind":1}', "{}"],
  ['{"kind":"a"}', '{"kind":"b"}'],
);
type("a type in parentheses", "(User)", ``, U, ['{"id":7}']);
type("a union with never", "User | never", ``, U, ['{"id":7}']);
type("an intersection with unknown", "User & unknown", ``, U, ['{"id":7}']);
type("a union with unknown", "User | unknown", ``, [], ['{"id":"7"}']);
type("a union with any", "User | any", ``, [], ['{"id":"7"}']);
type("an intersection with any", "User & any", ``, [], ['{"id":"7"}']);
type("an intersection with an empty object type", "User & {}", ``, U, ['{"id":7}']);
type("null is let in where checks of null are off", "User", ``, ['{"id":"7"}', "[]", "7"], ['{"id":7}'], {
  compilerOptions: { strict: false },
});
type("null where checks of null are off", "User", ``, ['{"id":null}', "null", "{}"], ['{"id":7}'], {
  compilerOptions: { strict: false },
});
type("null where only checks of null are off", "User", ``, ['{"id":null}', "null", "{}"], ['{"id":7}'], {
  compilerOptions: { strict: true, strictNullChecks: false },
});
type("an optional member, exact", "{ id?: number }", ``, ['{"id":null}', '{"id":"7"}'], ["{}", '{"id":7}'], {
  compilerOptions: { exactOptionalPropertyTypes: true },
});
type("a type with a getter signature", "{ get id(): number }", ``, U, ['{"id":7}']);
type("a type with get and set of two types", "{ get id(): number; set id(value: number | string) }", ``, U, [
  '{"id":7}',
]);
type("a readonly list", "readonly number[]", ``, ['["a"]', "{}"], ["[1]"]);
type("ReadonlyArray", "ReadonlyArray<number>", ``, ['["a"]', "{}"], ["[1]"]);
type("Array by name", "Array<User>", ``, ['[{"id":"7"}]', "{}"], ['[{"id":7}]']);
type("a named tuple", "[id: number, name: string]", ``, ["[1]", "[1,2]", '["a","b"]', '[1,"a",2]'], ['[1,"a"]']);

const codecs = `interface Codec { parse<T>(text: string): T }\ntype Read = <T>(text: string) => T;\n`;
const own = (
  name: string,
  expression: (J: string) => string,
  setup: (J: string) => string = () => "",
  more: Partial<Shape> = {},
) => call("own signature: " + name, expression, J => codecs + setup(J), more);

// ---------------------------------------------------------------- the signature at the call is the program's own
own(
  "let of the interface",
  () => `codec.parse<User>(text)`,
  J => `let codec: Codec = ${J};`,
);
own(
  "an angle bracket cast of the object",
  () => `codec.parse<User>(text)`,
  J => `const codec = <Codec>${J};`,
);
own(
  "cast through unknown",
  () => `codec.parse<User>(text)`,
  J => `const codec = ${J} as unknown as Codec;`,
);
own(
  "cast through any",
  () => `codec.parse<User>(text)`,
  J => `const codec: Codec = ${J} as any;`,
);
own(
  "the interface or null",
  () => `codec!.parse<User>(text)`,
  J => `const codec: Codec | null = ${J};`,
);
own(
  "the interface or null, optional call",
  () => `codec?.parse<User>(text)`,
  J => `const codec: Codec | null = ${J};`,
);
own(
  "taken out of the typed object",
  () => `parse<User>(text)`,
  J => `const codec: Codec = ${J};\nconst { parse } = codec;`,
);
own(
  "two names in a row",
  () => `second.parse<User>(text)`,
  J => `const first: Codec = ${J};\nconst second = first;`,
);
own(
  "a function gives the typed object",
  () => `make().parse<User>(text)`,
  J => `function make(): Codec { return ${J}; }`,
  { spellings: ofBun },
);
own(
  "an object literal cast",
  () => `codec.parse<User>(text)`,
  J => `const codec = { parse: ${J}.parse } as Codec;`,
  { spellings: ofBun },
);
own(
  "an object literal typed",
  () => `codec.parse<User>(text)`,
  J => `const codec: Codec = { parse: ${J}.parse };`,
  { spellings: ofBun },
);
own(
  "a class that implements it",
  () => `new C().parse<User>(text)`,
  J => `class C implements Codec { parse: Read = ${J}.parse; }`,
  { spellings: ofBun },
);
own(
  "a static member typed",
  () => `C.parse<User>(text)`,
  J => `class C { static parse: Read = ${J}.parse; }`,
  { spellings: ofBun },
);
own(
  "a static readonly member typed",
  () => `C.parse<User>(text)`,
  J => `class C { static readonly parse: Read = ${J}.parse; }`,
  { spellings: ofBun },
);
own(
  "the function cast, held",
  () => `read<User>(text)`,
  J => `const read = ${J}.parse as Read;`,
);
own(
  "the function cast through unknown",
  () => `read<User>(text)`,
  J => `const read = ${J}.parse as unknown as Read;`,
);
own(
  "a signature with a default",
  () => `read<User>(text)`,
  J => `const read: <T = unknown>(text: string) => T = ${J}.parse;`,
);
own(
  "a signature with a constraint",
  () => `read<User>(text)`,
  J => `const read: <T extends object>(text: string) => T = ${J}.parse;`,
);
own(
  "a signature that gives a promise's inside",
  () => `read<User>(text)`,
  J => `const read: <T>(text: string) => T | undefined = ${J}.parse;`,
);
own(
  "a signature that wraps T",
  () => `read<User>(text)`,
  J => `const read: <T>(text: string) => Readonly<T> = ${J}.parse;`,
);
own(
  "a signature of two type parameters",
  () => `read<string, User>(text)`,
  J => `const read: <A, T>(text: A & string) => T = ${J}.parse;`,
);
own(
  "a call signature in an object type",
  () => `read<User>(text)`,
  J => `const read: { <T>(text: string): T } = ${J}.parse;`,
);
own(
  "an overloaded own signature",
  () => `read<User>(text)`,
  J => `const read: { (text: string): unknown; <T>(text: string): T } = ${J}.parse;`,
);
own(
  "a declared function type by typeof",
  () => `read<User>(text)`,
  J => `declare function like<T>(text: string): T;\nconst read: typeof like = ${J}.parse;`,
);
own(
  "typed in another file",
  () => `read<User>(text)`,
  () => ``,
  {
    spellings: ofBun,
    imports: `import { read } from "./other";`,
    files: (J, imports) => ({ "other.ts": `${imports}\nexport const read: <T>(text: string) => T = ${J}.parse;\n` }),
  },
);
own(
  "the typed object in another file",
  () => `codec.parse<User>(text)`,
  () => ``,
  {
    spellings: ofBun,
    imports: `import { codec } from "./other";`,
    files: (J, imports) => ({ "other.ts": `${imports}\nexport const codec: { parse<T>(text: string): T } = ${J};\n` }),
  },
);
own(
  "an intersection with the interface",
  () => `codec.parse<User>(text)`,
  J => `const codec: Codec & { stringify(value: unknown): string } = ${J};`,
);
own(
  "the built-in type and the interface",
  () => `codec.parse<User>(text)`,
  J => `const codec: Codec & typeof ${J} = ${J};`,
);
own(
  "the built-in type and the interface, the other way",
  () => `codec.parse<User>(text)`,
  J => `const codec: typeof ${J} & Codec = ${J};`,
);
own(
  "an interface below the built-in type",
  () => `codec.parse<User>(text)`,
  J => `type Base = typeof ${J};\ninterface Mine extends Base { parse<T>(text: string): T }\nconst codec: Mine = ${J};`,
);
own(
  "Omit and add",
  () => `codec.parse<User>(text)`,
  J => `const codec: Omit<typeof ${J}, "parse"> & Codec = ${J};`,
);
body(
  "the program adds a signature to the global JSON",
  J =>
    `declare global { interface JSON { parse<T>(text: string): T } }\nfunction ask(text: string): unknown { return ${J}.parse<User>(text); }`,
  { spellings: ["global", "globalThis", "imported"] },
);
body(
  "the program adds a signature with another parameter name",
  J =>
    `declare global { interface JSON { parse<Out>(source: string, reviver?: (key: string, value: unknown) => unknown): Out } }\nfunction ask(text: string): unknown { return ${J}.parse<User>(text); }`,
  { spellings: ["global", "globalThis", "imported"] },
);
body(
  "a declaration file adds a signature to the global JSON",
  J => `function ask(text: string): unknown { return ${J}.parse<User>(text); }`,
  {
    spellings: ["global", "globalThis", "imported"],
    files: () => ({ "globals.d.ts": `interface JSON { parse<T>(text: string): T }\n` }),
  },
);
body(
  "an imported file adds a signature to the global JSON",
  J => `function ask(text: string): unknown { return ${J}.parse<User>(text); }`,
  {
    spellings: ["global", "globalThis", "imported"],
    imports: `import "./more";`,
    files: () => ({ "more.ts": `declare global { interface JSON { parse<T>(text: string): T } }\nexport {};\n` }),
  },
);
body(
  "a package adds a signature to the global JSON",
  J => `function ask(text: string): unknown { return ${J}.parse<User>(text); }`,
  {
    spellings: ["global", "globalThis", "imported"],
    imports: `import "typed-json";`,
    files: () => ({
      "node_modules/typed-json/package.json": `{"name":"typed-json","version":"1.0.0","types":"index.d.ts","main":"index.js"}`,
      "node_modules/typed-json/index.d.ts": `declare global { interface JSON { parse<T>(text: string): T } }\nexport {};\n`,
      "node_modules/typed-json/index.js": ``,
    }),
  },
);
body(
  "the program adds a signature to the JSON of bun",
  J =>
    `declare module "bun" { interface JSON { parse<T>(text: string): T } }\nfunction ask(text: string): unknown { return ${J}.parse<User>(text); }`,
  { spellings: ["imported", "Bun.JSON"] },
);
body(
  "the reference to the typings of the global",
  J => `function ask(text: string): unknown { return ${J}.parse<User>(text); }`,
  { top: `/// <reference types="bun-types/aot" />\n`, spellings: ["global"] },
);

// ---------------------------------------------------------------- the text is known to the build
const known = (name: string, spoiled: string, fine: string, setup = "") =>
  body(
    "known text: " + name,
    J =>
      `${setup}\nfunction ask(text: string): unknown { return text === bad[0] ? ${J}.parse<User>(${spoiled}) : ${J}.parse<User>(${fine}); }`,
  );
known("a literal", `'{"id":"7"}'`, `'{"id":7}'`);
known("a template", '`{"id":"7"}`', '`{"id":7}`');
known("a constant", `SPOILED`, `FINE`, `const SPOILED = '{"id":"7"}', FINE = '{"id":7}';`);
known("put together", `'{"id":' + '"7"}'`, `'{"id":' + '7}'`);
known("a template with a constant", '`{"id":${INNER}}`', '`{"id":${7}}`', `const INNER = '"7"';`);
known("stringify of a literal", `spell({ id: "7" })`, `spell({ id: 7 })`);
known("String.raw", 'String.raw`{"id":"7"}`', 'String.raw`{"id":7}`');
known("as const", `('{"id":"7"}' as const)`, `('{"id":7}' as const)`);
known("an enum member", `Texts.Spoiled`, `Texts.Fine`, `enum Texts { Spoiled = '{"id":"7"}', Fine = '{"id":7}' }`);
known(
  "a const enum member",
  `Texts.Spoiled`,
  `Texts.Fine`,
  `const enum Texts { Spoiled = '{"id":"7"}', Fine = '{"id":7}' }`,
);
known("a literal with an escaped name", `'{"\\\\u0069d":"7"}'`, `'{"\\\\u0069d":7}'`);
known("an imported text file", `spoiled`, `fine`, ``);
shapes[shapes.length - 1].imports = `import spoiled from "./spoiled.txt";\nimport fine from "./fine.txt";`;
shapes[shapes.length - 1].files = () => ({
  "spoiled.txt": `{"id":"7"}`,
  "fine.txt": `{"id":7}`,
  "texts.d.ts": `declare module "*.txt" { const text: string; export default text; }\n`,
});
body("known text: no JSON at all", J => `function ask(text: string): unknown { return ${J}.parse<User>("{"); }`, {
  bad: ["x"],
  good: [],
});
body(
  "known text: a literal in a loop",
  J =>
    `function ask(text: string): unknown { let last: unknown; for (let i = 0; i < 3; i++) last = text === bad[0] ? ${J}.parse<User>('{"id":"7"}') : ${J}.parse<User>('{"id":7}'); return last; }`,
);
body(
  "known text: at the top of the module",
  J =>
    `let seen: unknown, thrown: unknown;\ntry { seen = ${J}.parse<User>('{"id":"7"}'); } catch (error) { thrown = error; }\nfunction ask(text: string): unknown { if (text === bad[0]) { if (thrown) throw thrown; return seen; } return ${J}.parse<User>('{"id":7}'); }`,
);

// ---------------------------------------------------------------- odd spellings
call("an escape in the member name", J => `${J}.p\\u0061rse<User>(text)`);
call("an escape in braces in the member name", J => `${J}.p\\u{61}rse<User>(text)`);
call("an escape in the key", J => `${J}["p\\u0061rse"]<User>(text)`);
call("an escape in the type's name", J => `${J}.parse<Us\\u0065r>(text)`);
call(
  "an escape in the object's name",
  () => `JS\\u004fN.parse<User>(text)`,
  () => ``,
  { spellings: ["global", "same-name"] },
);
call("a comma behind the argument", J => `${J}.parse<User>(text,)`);
call("spaces", J => `${J} . parse < User > ( text )`);
call(
  "an instantiation, optional call",
  J => `${J}.parse<User>?.(text)`,
  () => "",
  { spellings: ofBun },
);
call("not null behind an optional member", J => `${J}?.parse!<User>(text)`);
call("not null twice", J => `${J}!!.parse!!<User>(text)`);
call("parentheses and not null", J => `((${J}.parse)!)<User>(text)`);
call(
  "as const on the function",
  J => `(${J}.parse as const)<User>(text)`,
  () => ``,
  { top: "" },
);
call("a cast of the object to its own type", J => `(${J} as typeof ${J}).parse<User>(text)`);
call("void 0 comma", J => `(void 0, ${J}.parse)<User>(text)`);
call(
  "an assignment as the callee",
  J => `(slot = ${J}.parse)<User>(text)`,
  J => `let slot: typeof ${J}.parse;`,
);
call(
  "an identity function round the callee",
  J => `same(${J}.parse)<User>(text)`,
  () => `const same = <F,>(f: F): F => f;`,
);
call(
  "an identity function round the object",
  J => `same(${J}).parse<User>(text)`,
  () => `const same = <F,>(f: F): F => f;`,
);
call(
  "await of the function",
  J => `(await ${J}.parse)<User>(text)`,
  () => ``,
  {},
);
shapes[shapes.length - 1].code = J =>
  `async function ask(text: string): Promise<unknown> { return (await ${J}.parse)<User>(text); }`;
call("the type in a long form", J => `${J}.parse<{ id: number }>(text)`);
call("the type as an intersection of itself", J => `${J}.parse<User & User>(text)`);
call("the type as a union of itself", J => `${J}.parse<User | User>(text)`);
body(
  "this is the object",
  J =>
    `function inner(this: typeof ${J}, text: string): unknown { return this.parse<User>(text); }\nfunction ask(text: string): unknown { return inner.call(${J}, text); }`,
);
body(
  "super reaches it",
  J =>
    `const base = { parse: ${J}.parse };\nconst child = { __proto__: base, read(text: string): unknown { return (super.parse as typeof ${J}.parse)<User>(text); } };\nfunction ask(text: string): unknown { return child.read(text); }`,
  { top: "// @ts-nocheck\n" },
);
body(
  "a name declared, bound at run time",
  J =>
    `declare const Late: typeof ${J};\n(globalThis as any).Late = ${J};\nfunction ask(text: string): unknown { return Late.parse<User>(text); }`,
);
body(
  "with a shadow in a block",
  J =>
    `function ask(text: string): unknown { { const JSON = { parse<T>(text: string): T { return globalThis.JSON.parse(text); } }; void JSON; } return ${J}.parse<User>(text); }`,
);
body(
  "the import is shadowed by the global in a block",
  () => `function ask(text: string): unknown { { const JSON = globalThis.JSON; return JSON.parse<User>(text); } }`,
  { spellings: ["same-name"] },
);
body(
  "the import is shadowed by a parameter's default",
  () =>
    `function inner(text: string, JSON = globalThis.JSON): unknown { return JSON.parse<User>(text); }\nfunction ask(text: string): unknown { return inner(text); }`,
  { spellings: ["same-name"] },
);

// ---------------------------------------------------------------- what stands for "bun"
body(
  "a path of tsconfig names bun",
  () => `function ask(text: string): unknown { return Checked.parse<User>(text); }`,
  {
    spellings: ["imported"],
    compilerOptions: { paths: { bun: ["./mine.ts"] } },
    files: () => ({
      "mine.ts": `export const JSON = { parse<T>(text: string): T { return globalThis.JSON.parse(text); } };\n`,
    }),
  },
);
body(
  "a path of tsconfig names bun by a declaration file",
  () => `function ask(text: string): unknown { return Checked.parse<User>(text); }`,
  {
    spellings: ["imported"],
    compilerOptions: { paths: { bun: ["./mine.d.ts"] } },
    files: () => ({ "mine.d.ts": `export declare const JSON: { parse<T>(text: string): T };\n` }),
  },
);
body(
  "the package named bun is installed",
  J => `function ask(text: string): unknown { return ${J}.parse<User>(text); }`,
  {
    files: () => ({
      "node_modules/bun/package.json": `{"name":"bun","version":"1.4.3","bin":{"bun":"bin/bun.exe"}}`,
      "node_modules/bun/README.md": ``,
    }),
  },
);
body(
  "the package named bun is installed with a main",
  J => `function ask(text: string): unknown { return ${J}.parse<User>(text); }`,
  {
    files: () => ({
      "node_modules/bun/package.json": `{"name":"bun","version":"1.4.3","main":"index.js","types":"index.d.ts"}`,
      "node_modules/bun/index.js": `exports.JSON = globalThis.JSON;`,
      "node_modules/bun/index.d.ts": `export declare const JSON: { parse<T>(text: string): T };\n`,
    }),
  },
);
body("older typings are installed", J => `function ask(text: string): unknown { return ${J}.parse<User>(text); }`, {
  files: () => ({
    "node_modules/@types/bun/package.json": `{"name":"@types/bun","version":"1.0.0","types":"index.d.ts"}`,
    "node_modules/@types/bun/index.d.ts": `declare module "bun" { export function sleep(ms: number): Promise<void>; }\ndeclare var Bun: typeof import("bun");\n`,
  }),
});
body(
  "other typings of bun declare JSON",
  J => `function ask(text: string): unknown { return ${J}.parse<User>(text); }`,
  {
    files: () => ({
      "node_modules/@types/bun/package.json": `{"name":"@types/bun","version":"9.0.0","types":"index.d.ts"}`,
      "node_modules/@types/bun/index.d.ts": `declare module "bun" { export const JSON: { parse<T>(text: string): T; stringify(value: unknown): string }; }\ndeclare var Bun: typeof import("bun");\n`,
    }),
  },
);
body(
  "the program declares the module bun",
  J => `function ask(text: string): unknown { return ${J}.parse<User>(text); }`,
  {
    files: () => ({
      "bun.d.ts": `declare module "bun" { export const JSON: { parse<T>(text: string): T; stringify(value: unknown): string }; }\n`,
    }),
  },
);
body(
  "the program declares the global Bun",
  J => `function ask(text: string): unknown { return ${J}.parse<User>(text); }`,
  {
    spellings: ["Bun.JSON"],
    files: () => ({ "bun.d.ts": `declare var Bun: { JSON: { parse<T>(text: string): T } };\n` }),
  },
);
body("no library", J => `function ask(text: string): unknown { return ${J}.parse<User>(text); }`, {
  compilerOptions: { noLib: true },
});
body("an old library", J => `function ask(text: string): unknown { return ${J}.parse<User>(text); }`, {
  compilerOptions: { lib: ["es5"], target: "es5" },
});
body("types is empty", J => `function ask(text: string): unknown { return ${J}.parse<User>(text); }`, {
  compilerOptions: { types: [] },
});
body("skipLibCheck and no checks", J => `function ask(text: string): unknown { return ${J}.parse<User>(text); }`, {
  compilerOptions: { skipLibCheck: true, strict: false, noImplicitAny: false },
});

const S = `import type { Schema } from "bun";`;
const rule = (name: string, T: string, setup: string, bad: string[], good: string[], more: Partial<Shape> = {}) =>
  type("rule: " + name, T, setup, bad, good, { ...more, imports: S + "\n" + (more.imports ?? "") });
const Age = `type Age = number & Schema.Min<0>;`;

// ---------------------------------------------------------------- members that JSON cannot bring
type(
  "an optional function member",
  "{ id: number; f?: () => void }",
  ``,
  ['{"id":1,"f":5}', '{"id":1,"f":{}}', '{"id":1,"f":null}'],
  ['{"id":1}'],
);
type("an optional method", "{ id: number; f?(): void }", ``, ['{"id":1,"f":5}', '{"id":1,"f":"x"}'], ['{"id":1}']);
type(
  "an optional symbol member",
  "{ id: number; s?: symbol }",
  ``,
  ['{"id":1,"s":5}', '{"id":1,"s":"x"}'],
  ['{"id":1}'],
);
type(
  "an optional bigint member",
  "{ id: number; b?: bigint }",
  ``,
  ['{"id":1,"b":5}', '{"id":1,"b":"5"}'],
  ['{"id":1}'],
);
type(
  "an optional Date member",
  "{ id: number; at?: Date }",
  ``,
  ['{"id":1,"at":5}', '{"id":1,"at":"2026-01-01"}', '{"id":1,"at":{}}'],
  ['{"id":1}'],
);
type(
  "an optional Map member",
  "{ id: number; m?: Map<string, number> }",
  ``,
  ['{"id":1,"m":{}}', '{"id":1,"m":[]}'],
  ['{"id":1}'],
);
type(
  "an optional member of a class",
  "{ id: number; p?: Point }",
  `class Point { x = 0; }`,
  ['{"id":1,"p":{"x":"1"}}', '{"id":1,"p":5}'],
  ['{"id":1}'],
);
type(
  "an optional never member",
  "{ id: number; no?: never }",
  ``,
  ['{"id":1,"no":5}', '{"id":1,"no":null}'],
  ['{"id":1}'],
);
type("a never member", "{ id: number; no: never }", ``, ['{"id":1,"no":5}', '{"id":1}'], []);
type("an undefined member", "{ id: number; u: undefined }", ``, ['{"id":1,"u":5}', '{"id":1,"u":null}'], []);
type(
  "an optional undefined member",
  "{ id: number; u?: undefined }",
  ``,
  ['{"id":1,"u":5}', '{"id":1,"u":null}'],
  ['{"id":1}'],
);
type("a void member", "{ id: number; v: void }", ``, ['{"id":1,"v":5}', '{"id":1,"v":null}'], []);
type("a member under a symbol", "{ id: number; [key]: string }", `const key = Symbol("k");`, ['{"id":"1"}'], []);
type(
  "an optional member under a symbol",
  "{ id: number; [key]?: string }",
  `const key: unique symbol = Symbol("k");`,
  ['{"id":"1"}'],
  ['{"id":1}'],
);
type(
  "a member under Symbol.iterator",
  "{ id: number; [Symbol.iterator]?: () => Iterator<number> }",
  ``,
  ['{"id":"1"}'],
  ['{"id":1}'],
);
type("a member under a constant name", "{ [key]: number }", `const key = "id";`, ['{"id":"1"}', "{}"], ['{"id":1}']);
type(
  "a member under a number",
  "{ 0: string; 1: number }",
  ``,
  ['{"0":"a"}', '{"0":"a","1":"b"}', '["a"]'],
  ['{"0":"a","1":2}'],
);
type(
  "a member under an enum's value",
  "{ [Key.Id]: number }",
  `enum Key { Id = "id" }`,
  ['{"id":"1"}', "{}", '{"Id":1}'],
  ['{"id":1}'],
);
type("a call signature beside members", "{ (): void; id: number }", ``, ['{"id":1}', '{"id":"1"}'], []);
type("a construct signature beside members", "{ new (): object; id: number }", ``, ['{"id":1}'], []);
type(
  "a branded string",
  "{ id: UserId }",
  `type UserId = string & { readonly __brand: "UserId" };`,
  ['{"id":5}', '{"id":null}', "{}"],
  [],
);
type(
  "a branded number by a unique symbol",
  "{ id: UserId }",
  `declare const brand: unique symbol;\ntype UserId = number & { readonly [brand]: true };`,
  ['{"id":"5"}', "{}"],
  [],
);
type(
  "a branded string with an optional mark",
  "{ id: UserId }",
  `type UserId = string & { readonly __brand?: "UserId" };`,
  ['{"id":5}', '{"id":null}', "{}"],
  ['{"id":"a"}'],
);
type("wrapper types", "{ a: String; b: Number; c: Boolean }", ``, ['{"a":1,"b":"x","c":0}'], []);
type("Object", "{ a: Object }", ``, ['{"a":null}', "{}"], []);
type("Function", "{ a?: Function }", ``, ['{"a":1}'], ["{}"]);
type("PropertyKey", "{ a: PropertyKey }", ``, ['{"a":null}', '{"a":true}'], []);
type(
  "a member named like one of Object.prototype, left out",
  "{ toString: string }",
  ``,
  ["{}", '{"toString":1}'],
  ['{"toString":"a"}'],
);
type(
  "an unknown member named like one of Object.prototype, left out",
  "{ valueOf: unknown; id: number }",
  ``,
  ['{"id":"1","valueOf":1}'],
  ['{"id":1,"valueOf":1}'],
);
type(
  "a member named constructor",
  "{ constructor: { name: string } }",
  ``,
  ["{}", '{"constructor":{}}', '{"constructor":{"name":1}}'],
  ['{"constructor":{"name":"a"}}'],
);
type(
  "a member named __proto__",
  '{ "__proto__": { id: number } }',
  ``,
  ["{}", '{"__proto__":{"id":"1"}}', '{"__proto__":null}'],
  [],
);
type(
  "an optional member named __proto__",
  '{ "__proto__"?: { id: number }; ok: boolean }',
  ``,
  ['{"ok":true,"__proto__":{"id":"1"}}', '{"ok":true,"__proto__":5}'],
  ['{"ok":true}'],
);
type(
  "a member named length of an object",
  "{ length: number }",
  ``,
  ["[]", "[1,2]", '"ab"', '{"length":"1"}'],
  ['{"length":1}'],
);

// ---------------------------------------------------------------- a rule of Schema, wherever a type can stand
const low = ["-1", "-0.5", '"1"', "null"];
rule("alone", "Age", Age, low, ["0", "5"]);
rule("the rule first", "Schema.Min<0> & number", ``, low, ["0", "5"]);
rule("a member", "{ age: Age }", Age, ['{"age":-1}', "{}"], ['{"age":1}']);
rule("an optional member", "{ age?: Age }", Age, ['{"age":-1}', '{"age":null}'], ["{}", '{"age":1}']);
rule("a member or undefined", "{ age: Age | undefined }", Age, ['{"age":-1}'], ['{"age":1}']);
rule("a member or null", "{ age: Age | null }", Age, ['{"age":-1}', "{}"], ['{"age":1}', '{"age":null}']);
rule("an element", "Age[]", Age, ["[1,-1]", "[-1]"], ["[]", "[1]"]);
rule("an element of a readonly list", "readonly Age[]", Age, ["[1,-1]"], ["[1]"]);
rule("Array by name", "Array<Age>", Age, ["[1,-1]"], ["[1]"]);
rule("an element of a tuple", "[Age, string]", Age, ['[-1,"a"]'], ['[1,"a"]']);
rule("a named element of a tuple", "[age: Age, name: string]", Age, ['[-1,"a"]'], ['[1,"a"]']);
rule("a value of a record", "Record<string, Age>", Age, ['{"a":-1}', '{"a":1,"b":-1}'], ["{}", '{"a":1}']);
rule(
  "a value of a record of literal keys",
  'Record<"a" | "b", Age>',
  Age,
  ['{"a":-1,"b":1}', '{"a":1,"b":-1}'],
  ['{"a":1,"b":1}'],
);
rule("a value of an index signature", "{ [key: string]: Age }", Age, ['{"a":-1}'], ['{"a":1}']);
rule("an alias of the alias", "Years", Age + `\ntype Years = Age;`, low, ["0"]);
rule(
  "a generic alias given the alias",
  "Box<Age>",
  Age + `\ntype Box<T> = { value: T };`,
  ['{"value":-1}'],
  ['{"value":1}'],
);
rule(
  "a generic interface given the alias",
  "Box<Age>",
  Age + `\ninterface Box<T> { value: T }`,
  ['{"value":-1}'],
  ['{"value":1}'],
);
rule(
  "a generic alias that adds the rule",
  "AtLeast<0>",
  `type AtLeast<N extends number> = number & Schema.Min<N>;`,
  low,
  ["0"],
);
rule("a generic alias that adds the rule to T", "Positive<number>", `type Positive<T> = T & Schema.Min<0>;`, low, [
  "0",
]);
rule("the bound from a constant", "number & Schema.Min<typeof least>", `const least = 0;`, low, ["0"]);
rule("the bound from an enum", "number & Schema.Min<Bound.Least>", `enum Bound { Least = 0 }`, low, ["0"]);
rule("the bound from an indexed access", 'number & Schema.Min<Limits["least"]>', `type Limits = { least: 0 };`, low, [
  "0",
]);
rule(
  "the bound from a conditional",
  "number & Schema.Min<Pick0<string>>",
  `type Pick0<T> = T extends string ? 0 : 100;`,
  low,
  ["0"],
);
rule("the bound is a union", "number & Schema.Min<0 | 10>", ``, ["-1"], []);
rule("the bound is number", "number & Schema.Min<number>", ``, ["-1"], []);
rule("the bound is never", "number & Schema.Min<never>", ``, ["-1"], []);
rule("the bound is any", "number & Schema.Min<any>", ``, ["-1"], []);
rule("Partial", "Partial<{ age: Age }>", Age, ['{"age":-1}'], ["{}", '{"age":1}']);
rule("Required", "Required<{ age?: Age }>", Age, ['{"age":-1}', "{}"], ['{"age":1}']);
rule("Readonly", "Readonly<{ age: Age }>", Age, ['{"age":-1}'], ['{"age":1}']);
rule("Pick", 'Pick<{ age: Age; name: string }, "age">', Age, ['{"age":-1}'], ['{"age":1}']);
rule("Omit", 'Omit<{ age: Age; name: string }, "name">', Age, ['{"age":-1}'], ['{"age":1}']);
rule(
  "a mapped type that copies",
  "{ [K in keyof Both]: Both[K] }",
  Age + `\ntype Both = { age: Age; name: string };`,
  ['{"age":-1,"name":"a"}'],
  ['{"age":1,"name":"a"}'],
);
rule("a mapped type over a literal", '{ [K in "age"]: Age }', Age, ['{"age":-1}'], ['{"age":1}']);
rule(
  "a mapped type that renames",
  "{ [K in keyof Both as `x_${K}`]: Both[K] }",
  Age + `\ntype Both = { age: Age };`,
  ['{"x_age":-1}'],
  ['{"x_age":1}'],
);
rule(
  "a mapped type that wraps in a list",
  "{ [K in keyof Both]: Both[K][] }",
  Age + `\ntype Both = { age: Age };`,
  ['{"age":[-1]}'],
  ['{"age":[1]}'],
);
rule(
  "a mapped type that adds null",
  "{ [K in keyof Both]: Both[K] | null }",
  Age + `\ntype Both = { age: Age };`,
  ['{"age":-1}'],
  ['{"age":1}', '{"age":null}'],
);
rule("an indexed access", 'Both["age"]', Age + `\ntype Both = { age: Age };`, low, ["0"]);
rule("an element by number", "Ages[number]", Age + `\ntype Ages = Age[];`, low, ["0"]);
rule("NonNullable", "NonNullable<Age | null>", Age, low, ["0"]);
rule("Exclude", "Exclude<Age | string, string>", Age, low, ["0"]);
rule("Extract", "Extract<Age | string, number>", Age, low, ["0"]);
rule("Awaited", "Awaited<Promise<Age>>", Age, low, ["0"]);
rule("ReturnType", "ReturnType<() => Age>", Age, low, ["0"]);
rule(
  "ReturnType of a declared function",
  "ReturnType<typeof make>",
  Age + `\ndeclare function make(): { age: Age };`,
  ['{"age":-1}'],
  ['{"age":1}'],
);
rule("Parameters", "Parameters<(age: Age) => void>[0]", Age, low, ["0"]);
rule(
  "typeof a typed constant",
  "typeof sample",
  Age + `\nconst sample: { age: Age } = { age: 1 };`,
  ['{"age":-1}'],
  ['{"age":1}'],
);
rule(
  "typeof a member of a typed constant",
  "typeof sample.age",
  Age + `\nconst sample: { age: Age } = { age: 1 };`,
  low,
  ["0"],
);
rule("typeof a let that was assigned", "typeof age", Age + `\nlet age: Age = 1;`, low, ["0"]);
rule("a conditional that gives T back", "Same<Age>", Age + `\ntype Same<T> = T extends number ? T : never;`, low, [
  "0",
]);
rule(
  "a conditional with infer",
  "Inner<{ age: Age }>",
  Age + `\ntype Inner<T> = T extends { age: infer A } ? A : never;`,
  low,
  ["0"],
);
rule(
  "a conditional with infer and a constraint",
  "Inner<{ age: Age }>",
  Age + `\ntype Inner<T> = T extends { age: infer A extends number } ? A : never;`,
  low,
  ["0"],
);
rule("two rules", "Age & Schema.Max<10>", Age, ["-1", "11"], ["0", "10"]);
rule("two rules of one kind", "number & Schema.Min<0> & Schema.Min<5>", ``, ["-1", "3"], ["5"]);
rule(
  "a union of two ruled numbers",
  "(number & Schema.Min<10>) | (number & Schema.Max<-10>)",
  ``,
  ["0", "9", "-9"],
  ["10", "-10"],
);
rule("a ruled number or a string", "Age | string", Age, ["-1", "null"], ["1", '"a"']);
rule("a ruled number or number", "Age | number", Age, ['"a"'], ["-1", "1"]);
rule("an intersection with an empty object type", "Age & {}", Age, low, ["0"]);
rule("an intersection with unknown", "Age & unknown", Age, low, ["0"]);
rule("an interface member", "Person", Age + `\ninterface Person { age: Age }`, ['{"age":-1}'], ['{"age":1}']);
rule(
  "an interface that narrows by a rule",
  "Adult",
  `interface Person { age: number }\ninterface Adult extends Person { age: number & Schema.Min<18> }`,
  ['{"age":17}'],
  ['{"age":18}'],
);
rule(
  "an intersection of objects that adds a rule",
  "{ age: number } & { age: number & Schema.Min<18> }",
  ``,
  ['{"age":17}'],
  ['{"age":18}'],
);
rule(
  "an intersection of objects, a rule each",
  "{ age: number & Schema.Max<30> } & { age: number & Schema.Min<18> }",
  ``,
  ['{"age":17}', '{"age":31}'],
  ['{"age":18}'],
);
rule(
  "merged interfaces",
  "Person",
  Age + `\ninterface Person { name: string }\ninterface Person { age: Age }`,
  ['{"name":"a","age":-1}'],
  ['{"name":"a","age":1}'],
);
rule("imported from another file", "Age", ``, low, ["0"], {
  imports: `import type { Age } from "./types";`,
  files: () => ({ "types.ts": `import type { Schema } from "bun";\nexport type Age = number & Schema.Min<0>;\n` }),
});
rule("imported from a declaration file", "Age", ``, low, ["0"], {
  imports: `import type { Age } from "./types";`,
  files: () => ({ "types.d.ts": `import type { Schema } from "bun";\nexport type Age = number & Schema.Min<0>;\n` }),
});
rule("imported from a package", "Age", ``, low, ["0"], {
  imports: `import type { Age } from "people";`,
  files: () => ({
    "node_modules/people/package.json": `{"name":"people","version":"1.0.0","types":"index.d.ts","main":"index.js"}`,
    "node_modules/people/index.d.ts": `import type { Schema } from "bun";\nexport type Age = number & Schema.Min<0>;\n`,
    "node_modules/people/index.js": ``,
  }),
});
rule("Schema under another name", "number & Rules.Min<0>", ``, low, ["0"], {
  imports: `import type { Schema as Rules } from "bun";`,
});
rule("Schema by Bun", "number & Bun.Schema.Min<0>", ``, low, ["0"]);
rule("Schema by import()", 'number & import("bun").Schema.Min<0>', ``, low, ["0"]);
rule("Schema by a star import", "number & bun.Schema.Min<0>", ``, low, ["0"], {
  imports: `import type * as bun from "bun";`,
});
rule("the rule re-exported by another file", "number & Min<0>", ``, low, ["0"], {
  imports: `import type { Min } from "./rules";`,
  files: () => ({
    "rules.ts": `import type { Schema } from "bun";\nexport type Min<N extends number> = Schema.Min<N>;\n`,
  }),
});
rule("the rule under an alias of its own", "number & NotNegative", `type NotNegative = Schema.Min<0>;`, low, ["0"]);
rule(
  "the rules in an alias of two",
  "number & Range",
  `type Range = Schema.Min<0> & Schema.Max<10>;`,
  ["-1", "11"],
  ["0"],
);
rule("the rule by an import alias", "number & Min0", `import Min0 = Schema.Int;`, ["0.5"], ["1"]);
rule(
  "the rule in an interface that extends it",
  "number & NotNegative",
  `interface NotNegative extends Schema.Min<0> {}`,
  low,
  ["0"],
);
rule(
  "a program's own type of the same name",
  "number & Schema2.Min<0>",
  `namespace Schema2 { export type Min<N extends number> = { readonly "bun.min"?: N }; }`,
  ["-1"],
  [],
);
rule("in a template literal type", "`${Age}`", Age, ['"-1"', '"x"'], []);
rule("a ruled key of a record", 'Record<string & Schema.Pattern<"^a">, number>', ``, ['{"b":1}'], ['{"a":1}']);
rule(
  "a ruled key of an index signature",
  "{ [key: Key]: number }",
  `type Key = string & Schema.Pattern<"^a">;`,
  ['{"b":1}'],
  ['{"a":1}'],
);
rule("a rule for another kind", "string & Schema.Min<1>", ``, ['""', '"a"'], []);
rule("a rule of lists on a string", "string & Schema.MinItems<1>", ``, ['""'], []);
rule("a rule of strings on a list", "string[] & Schema.MinLength<1>", ``, ["[]"], []);
rule("a rule on a boolean", "boolean & Schema.Min<1>", ``, ["false"], []);
rule("a rule on a literal", "5 & Schema.Min<10>", ``, ["5"], []);
rule("a rule on a union", "(number | string) & Schema.Min<0>", ``, ["-1"], []);
rule("a rule on a union of numbers", "(1 | -1) & Schema.Min<0>", ``, ["-1"], []);
rule("a rule on an enum", "Level & Schema.Min<1>", `enum Level { Low, High }`, ["0"], []);
rule("a rule on an object", "{ id: number } & Schema.Min<0>", ``, ['{"id":-1}'], []);
rule("a rule on unknown", "unknown & Schema.Min<0>", ``, ["-1"], []);
rule("a rule on any", "any & Schema.Min<0>", ``, ["-1"], []);
rule("a rule alone", "Schema.Min<0>", ``, ["-1", "{}"], []);
rule("MinItems on a tuple", "[number, number] & Schema.MinItems<3>", ``, ["[1,2]"], []);
rule(
  "MaxItems on a list in a member",
  "{ tags: string[] & Schema.MaxItems<1> }",
  ``,
  ['{"tags":["a","b"]}'],
  ['{"tags":["a"]}'],
);
rule("MaxItems on a list of lists", "(number[] & Schema.MaxItems<1>)[]", ``, ["[[1,2]]", "[[1],[1,2]]"], ["[[1],[2]]"]);
rule("MaxItems on a readonly list", "readonly number[] & Schema.MaxItems<1>", ``, ["[1,2]"], ["[1]"]);
rule("MaxItems on ReadonlyArray", "ReadonlyArray<number> & Schema.MaxItems<1>", ``, ["[1,2]"], ["[1]"]);
rule("Strict", "{ id: number } & Schema.Strict", ``, ['{"id":1,"x":1}'], ['{"id":1}']);
rule("Strict first", "Schema.Strict & { id: number }", ``, ['{"id":1,"x":1}'], ['{"id":1}']);
rule(
  "Strict on an interface",
  "Person & Schema.Strict",
  `interface Person { id: number }`,
  ['{"id":1,"x":1}'],
  ['{"id":1}'],
);
rule(
  "Strict on an interface that extends it",
  "Person",
  `interface Person extends Schema.Strict { id: number }`,
  ['{"id":1,"x":1}'],
  ['{"id":1}'],
);
rule("Strict in an alias", "Closed", `type Closed = { id: number } & Schema.Strict;`, ['{"id":1,"x":1}'], ['{"id":1}']);
rule(
  "Strict by a generic alias",
  "Exact<{ id: number }>",
  `type Exact<T> = T & Schema.Strict;`,
  ['{"id":1,"x":1}'],
  ['{"id":1}'],
);
rule(
  "Strict on a member",
  "{ at: { x: number } & Schema.Strict }",
  ``,
  ['{"at":{"x":1,"y":1}}'],
  ['{"at":{"x":1}}', '{"at":{"x":1},"more":1}'],
);
rule("Strict on an element", "({ x: number } & Schema.Strict)[]", ``, ['[{"x":1,"y":1}]'], ['[{"x":1}]']);
rule(
  "Strict on a union",
  "({ a: number } | { b: string }) & Schema.Strict",
  ``,
  ['{"a":1,"x":1}', '{"b":"a","x":1}'],
  ['{"a":1}', '{"b":"a"}'],
);
rule(
  "Strict on each arm",
  "({ a: number } & Schema.Strict) | ({ b: string } & Schema.Strict)",
  ``,
  ['{"a":1,"x":1}', '{"a":1,"b":"a"}'],
  ['{"a":1}', '{"b":"a"}'],
);
rule(
  "Strict on an intersection of two objects",
  "{ a: number } & { b: string } & Schema.Strict",
  ``,
  ['{"a":1,"b":"a","x":1}'],
  ['{"a":1,"b":"a"}'],
);
rule(
  "Strict on one of two intersected objects",
  "({ a: number } & Schema.Strict) & { b: string }",
  ``,
  ['{"a":1,"b":"a","x":1}'],
  ['{"a":1,"b":"a"}'],
);
rule("Strict on a record", "Record<string, number> & Schema.Strict", ``, ['{"a":"1"}'], ['{"a":1}']);
rule("Strict on a list", "number[] & Schema.Strict", ``, ['["a"]'], []);
rule(
  "Pick leaves Strict behind",
  'Pick<{ id: number; name: string } & Schema.Strict, "id">',
  ``,
  ['{"id":"1"}'],
  ['{"id":1,"x":1}'],
);
rule("Strict with Omit", 'Omit<{ id: number; name: string } & Schema.Strict, "name">', ``, ['{"id":1,"x":1}'], []);
rule(
  "Strict round Pick",
  'Pick<{ id: number; name: string }, "id"> & Schema.Strict',
  ``,
  ['{"id":1,"name":"a"}', '{"id":1,"x":1}'],
  ['{"id":1}'],
);
rule(
  "Strict round Partial",
  "Partial<{ id: number }> & Schema.Strict",
  ``,
  ['{"x":1}', '{"id":1,"x":1}'],
  ["{}", '{"id":1}'],
);
rule("Strict with an optional member", "{ id?: number } & Schema.Strict", ``, ['{"x":1}'], ["{}", '{"id":1}']);
rule(
  "Strict refuses __proto__",
  "{ id: number } & Schema.Strict",
  ``,
  ['{"id":1,"__proto__":{}}', '{"id":1,"__proto__":null}', '{"id":1,"constructor":1}', '{"id":1,"":1}'],
  ['{"id":1}'],
);
rule(
  "DeepStrict",
  "{ at: { x: number }; all: { y: number }[] } & Schema.DeepStrict",
  ``,
  ['{"at":{"x":1,"z":1},"all":[]}', '{"at":{"x":1},"all":[{"y":1,"z":1}]}', '{"at":{"x":1},"all":[],"z":1}'],
  ['{"at":{"x":1},"all":[{"y":1}]}'],
);
rule(
  "DeepStrict through an alias",
  "{ at: At } & Schema.DeepStrict",
  `type At = { x: number };`,
  ['{"at":{"x":1,"z":1}}'],
  ['{"at":{"x":1}}'],
);
rule(
  "DeepStrict through an interface",
  "Outer & Schema.DeepStrict",
  `interface At { x: number }\ninterface Outer { at: At }`,
  ['{"at":{"x":1,"z":1}}'],
  ['{"at":{"x":1}}'],
);
rule(
  "DeepStrict through a generic",
  "Box<{ x: number }> & Schema.DeepStrict",
  `type Box<T> = { value: T };`,
  ['{"value":{"x":1,"z":1}}'],
  ['{"value":{"x":1}}'],
);
rule(
  "DeepStrict through a union",
  "{ at: { x: number } | { y: string } } & Schema.DeepStrict",
  ``,
  ['{"at":{"x":1,"z":1}}', '{"at":{"y":"a","z":1}}'],
  ['{"at":{"x":1}}'],
);
rule(
  "DeepStrict through a record",
  "{ all: Record<string, { x: number }> } & Schema.DeepStrict",
  ``,
  ['{"all":{"k":{"x":1,"z":1}}}'],
  ['{"all":{"k":{"x":1}}}'],
);
rule(
  "DeepStrict through a tuple",
  "{ pair: [{ x: number }, { y: number }] } & Schema.DeepStrict",
  ``,
  ['{"pair":[{"x":1},{"y":1,"z":1}]}'],
  ['{"pair":[{"x":1},{"y":1}]}'],
);
rule(
  "DeepStrict through a type that leads back to itself",
  "Tree & Schema.DeepStrict",
  `type Tree = { v: number; kids?: Tree[] };`,
  ['{"v":1,"kids":[{"v":2,"z":1}]}', '{"v":1,"kids":[{"v":2,"kids":[{"v":3,"z":1}]}]}'],
  ['{"v":1,"kids":[{"v":2,"kids":[]}]}'],
);
rule(
  "one type strict here and open there",
  "{ open: At; closed: At & Schema.Strict }",
  `type At = { x: number };`,
  ['{"open":{"x":1},"closed":{"x":1,"z":1}}'],
  ['{"open":{"x":1,"z":1},"closed":{"x":1}}'],
);
rule(
  "one type deep strict at one call and open at another",
  "Outer & Schema.DeepStrict",
  `type At = { x: number };\ntype Outer = { at: At };`,
  ['{"at":{"x":1,"z":1}}'],
  ['{"at":{"x":1}}'],
  {
    code: J =>
      `type At = { x: number };\ntype Outer = { at: At };\nfunction ask(text: string): unknown { ${J}.parse<Outer>('{"at":{"x":1,"z":1}}'); return ${J}.parse<Outer & Schema.DeepStrict>(text); }`,
  },
);
rule(
  "one type open at one call and deep strict at an earlier one",
  "Outer",
  `type At = { x: number };\ntype Outer = { at: At };`,
  ['{"at":{"x":"1"}}'],
  ['{"at":{"x":1,"z":1}}'],
  {
    code: J =>
      `type At = { x: number };\ntype Outer = { at: At };\nfunction ask(text: string): unknown { ${J}.parse<Outer & Schema.DeepStrict>('{"at":{"x":1}}'); return ${J}.parse<Outer>(text); }`,
  },
);
rule("Pattern", 'string & Schema.Pattern<"^[a-z]+$">', ``, ['"A"', '""', '"a1"', '"a\\n"', '"a\\nB"'], ['"a"']);
rule(
  "Pattern from a constant",
  "string & Schema.Pattern<typeof source>",
  `const source = "^[a-z]+$";`,
  ['"A"'],
  ['"a"'],
);
rule(
  "Pattern from a template type",
  "string & Schema.Pattern<`^${Letters}+$`>",
  `type Letters = "[a-z]";`,
  ['"A"'],
  ['"a"'],
);
rule("Pattern that is string", "string & Schema.Pattern<string>", ``, ['"A"'], []);
rule("Pattern that is no regular expression", 'string & Schema.Pattern<"(">', ``, ['"A"'], []);
rule("Format", 'string & Schema.Format<"uuid">', ``, ['"x"', '""'], ['"123e4567-e89b-12d3-a456-426614174000"']);
rule(
  "Format from an alias",
  "string & Schema.Format<Kind>",
  `type Kind = "uuid";`,
  ['"x"'],
  ['"123e4567-e89b-12d3-a456-426614174000"'],
);
rule(
  "Default beside a rule",
  "{ port: number & Schema.Min<1> & Schema.Default<8080> }",
  ``,
  ['{"port":0}', '{"port":null}', '{"port":"1"}'],
  ['{"port":1}', "{}"],
  { returns: ['{"port":1}', '{"port":8080}'] },
);
rule(
  "Default that breaks its own rule",
  "{ port: number & Schema.Min<1> & Schema.Default<0> }",
  ``,
  ['{"port":0}'],
  [],
);
rule("Message", '{ n: number & Schema.Min<1> & Schema.Message<"no"> }', ``, ['{"n":0}'], ['{"n":1}']);
