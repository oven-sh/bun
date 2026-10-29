type Way = [name: string, call: (holder: string, name: string) => string];

/** `holder.name()`, the call that every other way is compared with. */
export const calledOnItsHolder: Way = ["a call on its holder", (holder, name) => `${holder}.${name}();`];

/** Ways to call `holder.name` in TypeScript after the function has gone through another expression, a variable or a built-in. */
export const waysToHandOn: Way[] = [
  ["a comma expression", (holder, name) => `(0, ${holder}.${name})();`],
  ["parentheses", (holder, name) => `(${holder}.${name})();`],
  ["a comma expression around a key in brackets", (holder, name) => `(0, ${holder}[${JSON.stringify(name)}])();`],
  ["a comma expression around an optional chain", (holder, name) => `(0, ${holder}?.${name})();`],
  ["a type assertion", (holder, name) => `{ const handed = ${holder}.${name} as any; handed(); }`],
  ["a non-null assertion", (holder, name) => `{ const handed = ${holder}.${name}!; handed(); }`],
  ["satisfies", (holder, name) => `{ const handed = ${holder}.${name} satisfies any; handed(); }`],
  ["the first arm of a conditional", (holder, name) => `(process.argv.length ? ${holder}.${name} : undefined)();`],
  ["the second arm of a conditional", (holder, name) => `(process.argv.length ? undefined : ${holder}.${name})();`],
  ["??", (holder, name) => `(${holder}.${name} ?? undefined)();`],
  ["||", (holder, name) => `(${holder}.${name} || undefined)();`],
  ["&&", (holder, name) => `(${holder} && ${holder}.${name})();`],
  ["an assignment expression", (holder, name) => `{ let handed: any; (handed = ${holder}.${name})(); }`],
  ["??=", (holder, name) => `{ let handed: any; handed ??= ${holder}.${name}; handed(); }`],
  ["a constant", (holder, name) => `{ const handed = ${holder}.${name}; handed(); }`],
  ["a variable that is assigned later", (holder, name) => `{ let handed: any; handed = ${holder}.${name}; handed(); }`],
  ["a constant that holds its holder", (holder, name) => `{ const held = ${holder}; (0, held.${name})(); }`],
  ["destructuring", (holder, name) => `{ const { ${name}: handed } = ${holder}; handed(); }`],
  [
    "destructuring with a default",
    (holder, name) => `{ const { ${name}: handed = undefined } = ${holder}; handed(); }`,
  ],
  [
    "destructuring in an assignment",
    (holder, name) => `{ let handed: any; ({ ${name}: handed } = ${holder}); handed(); }`,
  ],
  ["a parameter", (holder, name) => `((handed: any) => handed())(${holder}.${name});`],
  ["a destructured parameter", (holder, name) => `(({ ${name}: handed }: any) => handed())(${holder});`],
  ["a default of a parameter", (holder, name) => `((handed: any = ${holder}.${name}) => handed())();`],
  ["a returned value", (holder, name) => `(() => ${holder}.${name})()();`],
  ["an element of an array", (holder, name) => `[${holder}.${name}][0]();`],
  ["a property of an object", (holder, name) => `({ handed: ${holder}.${name} }).handed();`],
  ["a captured variable", (holder, name) => `{ const handed = ${holder}.${name}; (() => handed())(); }`],
  ["call", (holder, name) => `${holder}.${name}.call(undefined);`],
  ["apply", (holder, name) => `${holder}.${name}.apply(undefined, []);`],
  ["bind", (holder, name) => `${holder}.${name}.bind(undefined)();`],
  ["Reflect.apply", (holder, name) => `Reflect.apply(${holder}.${name}, undefined, []);`],
  ["Reflect.get", (holder, name) => `Reflect.get(${holder}, ${JSON.stringify(name)})();`],
  ["a callback of Array.prototype.map", (holder, name) => `[0].map(${holder}.${name});`],
  ["a reaction of a promise", (holder, name) => `Promise.resolve(0).then(${holder}.${name});`],
];
