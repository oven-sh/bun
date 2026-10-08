import syntaxImportAssertions from "@babel/plugin-syntax-import-assertions" with {
  BABEL_8_BREAKING: "false",
  USE_ESM: "true", IS_STANDALONE: "false" };

import a1 from "foo" with {
  BABEL_8_BREAKING: "false",
  USE_ESM: "true", IS_STANDALONE: "false" };
import a2 from "foo" with {BABEL_8_BREAKING: "false",
  USE_ESM: "true", IS_STANDALONE: "false" };
import a3 from "foo" with {
  BABEL_8_BREAKING: "false", };
import a4 from "foo" with { BABEL_8_BREAKING: "false", };
