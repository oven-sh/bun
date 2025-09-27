import { expect, describe, it } from "bun:test";
import cases from "./cases";
import { ValidateNpmPackageName } from "bun:internal-for-testing";

/**
 * Convert the expected object in validate-npm-package-name to match our output.
 *
 * In some ways, this is debt that needs to be addressed should we choose to expose this API publicly.
 */
function remapExpectedObject(expectedObject: any): object {
  const newObj = { ...expectedObject };

  if (newObj.warnings) {
    newObj.warnings = newObj.warnings.map(
      (warning: string) =>
        warning.endsWith("is a core module name") ? "name conflicts a core module name" :
        warning
    );
  }

  if (newObj.errors) {
    newObj.errors = newObj.errors.map(
      (error: string) =>
        error.endsWith("is not a valid package name") ? "name is not allowed" :
        error
    );
  }

  return newObj;
}

describe("validate-npm-package-name", () => {
  it.each(Object.entries(cases))("parses %s", (pkgName: string, expected: object) => {
    expect(ValidateNpmPackageName.validate(pkgName)).toMatchObject(remapExpectedObject(expected));
  });
})
