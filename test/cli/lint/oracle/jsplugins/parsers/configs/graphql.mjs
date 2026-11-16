import js from "@eslint/js";
import graphql from "@graphql-eslint/eslint-plugin";

export default [
  { files: ["**/*.js"], processor: graphql.processor, rules: js.configs.recommended.rules },
  {
    files: ["**/*.graphql"],
    languageOptions: { parser: graphql.parser },
    plugins: { "@graphql-eslint": graphql },
    rules: {
      "@graphql-eslint/alphabetize": ["error", { fields: ["ObjectTypeDefinition"], selections: ["OperationDefinition"] }],
      "@graphql-eslint/description-style": "error",
      "@graphql-eslint/naming-convention": ["error", { FieldDefinition: "camelCase", types: "PascalCase" }],
      "@graphql-eslint/no-anonymous-operations": "error",
      "@graphql-eslint/no-duplicate-fields": "error",
      "@graphql-eslint/no-hashtag-description": "error",
      "@graphql-eslint/no-typename-prefix": "error",
      "@graphql-eslint/require-description": ["error", { types: true }],
    },
  },
];
