// Their ESLint, their configuration, their other plugins, and in the place of some plugins THE VERSION THAT `bun lint` FOLLOWS:
// LATEST_PLUGIN_DIRS names directories, each with a package.json whose dependencies are the packages to answer for. Every request
// for one of them from outside is answered from there; what they need of the project (typescript, eslint) is resolved from where
// THEIR copy of the plugin is. A loader that resolves by itself (jiti, for an eslint.config.ts) asks for a file by its path: that
// is answered too. At the end it says on stderr how often it has answered for each: a judge that was not asked is no judge.
const { createRequire, registerHooks } = require("node:module");
const { fileURLToPath, pathToFileURL } = require("node:url");
const { dirname, join, normalize } = require("node:path");
const { existsSync } = require("node:fs");
const places = (process.env.LATEST_PLUGIN_DIRS ?? __dirname)
  .split(":")
  .filter(Boolean)
  .map(directory => {
    const names = Object.keys(require(join(directory, "package.json")).dependencies);
    const scopes = names.includes("typescript-eslint") ? ["@typescript-eslint/"] : [];
    return {
      name: names[0],
      here: pathToFileURL(directory + "/").href,
      mine: createRequire(join(directory, "package.json")),
      answers: specifier =>
        names.some(name => specifier === name || specifier.startsWith(name + "/")) ||
        scopes.some(scope => specifier.startsWith(scope)),
      theirs: undefined,
      answered: 0,
    };
  });
const answer = (place, path) => {
  place.answered++;
  return { url: pathToFileURL(path).href, shortCircuit: true };
};
registerHooks({
  resolve(specifier, context, next) {
    const parent = context.parentURL ?? "";
    const inside = places.find(place => parent.startsWith(place.here));
    if (!inside) {
      const place = places.find(place => place.answers(specifier));
      if (place) {
        try {
          place.theirs ??= createRequire(fileURLToPath(next(specifier, context).url));
        } catch {}
        try {
          return answer(place, place.mine.resolve(specifier));
        } catch {}
      }
      const path = /^(?:file:\/\/)?(\/.*\/node_modules\/((?:@[^/]+\/)?[^/]+))\/(.+)$/.exec(specifier);
      const byPath = path && !places.some(place => pathToFileURL(path[1]).href.startsWith(place.here)) && places.find(place => place.answers(path[2]));
      if (byPath) {
        try {
          byPath.theirs ??= createRequire(join(path[1], "package.json"));
          const main = normalize(require(join(path[1], "package.json")).main ?? "index.js");
          const same = join(dirname(byPath.mine.resolve(path[2] + "/package.json")), path[3]);
          return answer(byPath, normalize(path[3]) === main || !existsSync(same) ? byPath.mine.resolve(path[2]) : same);
        } catch {}
      }
    } else if (inside.theirs && /^(typescript|eslint)(\/|$)/.test(specifier)) {
      try {
        return { url: pathToFileURL(inside.theirs.resolve(specifier)).href, shortCircuit: true };
      } catch {}
    }
    return next(specifier, context);
  },
});
process.on("exit", () => {
  console.error(`latest-plugin: ${JSON.stringify(Object.fromEntries(places.map(place => [place.name, place.answered])))}`);
});
