import angular from "angular-eslint";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    files: ["**/*.ts"],
    extends: [...tseslint.configs.recommended, ...angular.configs.tsRecommended],
    processor: angular.processInlineTemplates,
  },
  { files: ["**/*.html"], extends: [...angular.configs.templateAll] },
);
