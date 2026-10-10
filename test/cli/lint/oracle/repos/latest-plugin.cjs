// Their ESLint, their configuration, their other plugins, and in the place of some plugins THE VERSION THAT `bun lint` FOLLOWS: LATEST_PLUGIN_DIRS names directories, each with a package.json whose dependencies are the packages to answer for. Every request for one of them from outside is answered from there; what they need of the project (typescript, eslint) is resolved from where THEIR copy of the plugin is.
const { createRequire, registerHooks } = require("node:module");
const { fileURLToPath, pathToFileURL } = require("node:url");
const { join } = require("node:path");
const places = (process.env.LATEST_PLUGIN_DIRS ?? __dirname).split(":").filter(Boolean).map(directory => {
  const names = Object.keys(require(join(directory, "package.json")).dependencies);
  const scopes = names.includes("typescript-eslint") ? ["@typescript-eslint/"] : [];
  return {
    here: pathToFileURL(directory + "/").href,
    mine: createRequire(join(directory, "package.json")),
    answers: specifier => names.some(name => specifier === name || specifier.startsWith(name + "/")) || scopes.some(scope => specifier.startsWith(scope)),
    theirs: undefined,
  };
});
const answer = path => ({ url: pathToFileURL(path).href, shortCircuit: true });
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
          return answer(place.mine.resolve(specifier));
        } catch {}
      }
    } else if (inside.theirs && /^(typescript|eslint)(\/|$)/.test(specifier)) {
      try {
        return answer(inside.theirs.resolve(specifier));
      } catch {}
    }
    return next(specifier, context);
  },
});
