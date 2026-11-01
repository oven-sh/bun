import css from "@eslint/css";

const all = Object.fromEntries(Object.keys(css.rules).map(name => [`css/${name}`, "error"]));
export default [{ files: ["**/*.css"], plugins: { css }, language: "css/css", languageOptions: { tolerant: true }, rules: all }];
