import markdown from "@eslint/markdown";

const all = Object.fromEntries(Object.keys(markdown.rules).map(name => [`markdown/${name}`, "error"]));
export default [{ files: ["**/*.md"], plugins: { markdown }, language: "markdown/gfm", rules: all }];
