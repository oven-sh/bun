// Port of the variations half of internal/testutil/harnessutil/harnessutil.go (:1026 to :1226) of typescript-go 89d5d5b: the configurations of a test case from its settings.
import { compareStrings, equalFold, toLower, trimSpace } from "./gostrings";
import { type CommandLineOption, compilerOptions, enumMap } from "./tsoptions";

// harnessutil.go:59; config is a TestConfiguration (:57): a compiler setting, its name in lower case, to one of its values.
export interface NamedTestConfiguration {
  name: string;
  config: Map<string, string>;
}

// A t.Fatal or a panic of the reference, with its text: the reference stops there, before the case has a configuration.
export class HarnessFatal extends Error {}

// What tryGetValueOfOptionString gives of a tsoptions.CompilerOptionsValue: the value of an enum, a boolean, or the spelling itself.
type CompilerOptionsValue = number | string | boolean;

// harnessutil.go:1026
export function getFileBasedTestConfigurationDescription(config: ReadonlyMap<string, string>): string {
  const keys = [...config.keys()].sort(compareStrings);
  return keys.map(key => `${key}=${toLower(config.get(key)!)}`).join(",");
}

// harnessutil.go:1038; throws HarnessFatal where the reference calls t.Fatal. The reference walks the settings as a Go map, this walks the sorted names, which changes no name.
export function getFileBasedTestConfigurations(
  settings: ReadonlyMap<string, string>,
  varyByOptions: ReadonlySet<string>,
): NamedTestConfiguration[] {
  // Each element has the option name as the first element, and the values as the rest
  const optionEntries: string[][] = [];
  let variationCount = 1;
  const nonVaryingOptions = new Map<string, string>();
  for (const [option, value] of [...settings].sort(([a], [b]) => compareStrings(a, b))) {
    if (varyByOptions.has(option)) {
      const entries = splitOptionValues(value, option);
      if (entries.length > 1) {
        variationCount *= entries.length;
        if (variationCount > 25) {
          throw new HarnessFatal("Provided test options exceeded the maximum number of variations");
        }
        optionEntries.push([option, ...entries]);
      } else if (entries.length === 1) {
        nonVaryingOptions.set(option, entries[0]);
      }
    } else {
      // Variation is not supported for the option
      nonVaryingOptions.set(option, value);
    }
  }

  const configurations: NamedTestConfiguration[] = [];
  if (optionEntries.length > 0) {
    // Merge varying and non-varying options
    const varyingConfigurations = computeFileBasedTestConfigurationVariations(variationCount, optionEntries);
    for (const varyingConfig of varyingConfigurations) {
      const description = getFileBasedTestConfigurationDescription(varyingConfig);
      for (const [option, value] of nonVaryingOptions) varyingConfig.set(option, value);
      configurations.push({ name: description, config: varyingConfig });
    }
  } else if (nonVaryingOptions.size > 0) {
    // Only non-varying options
    configurations.push({ name: "", config: nonVaryingOptions });
  }
  return configurations;
}

// harnessutil.go:1085: the unique values of an option; "esnext, es2015, es6" of target is esnext and es2015, "*" of strict is true and false, "*, -true" is false. It throws HarnessFatal where the reference calls t.Fatalf or panics, and returns sorted what the reference returns in the order of a Go map.
export function splitOptionValues(value: string, option: string): string[] {
  if (value.length === 0) return [];

  let star = false;
  const includes: string[] = [];
  const excludes: string[] = [];
  for (let s of value.split(",")) {
    s = trimSpace(s);
    if (s.length === 0) continue;
    if (s === "*") {
      star = true;
    } else if (s.startsWith("-") || s.startsWith("!")) {
      excludes.push(s.slice(1));
    } else {
      includes.push(s);
    }
  }

  if (includes.length === 0 && !star && excludes.length === 0) return [];

  // Dedupe the variations by their normalized values: the first spelling of a value stays
  const variations = new Map<CompilerOptionsValue, string>();

  for (const include of includes) {
    const normalized = getValueOfOptionString(option, include);
    if (!variations.has(normalized)) variations.set(normalized, include);
  }

  const allValues = getAllValuesForOption(option);
  if (star && allValues.length > 0) {
    for (const include of allValues) {
      const normalized = getValueOfOptionString(option, include);
      if (!variations.has(normalized)) variations.set(normalized, include);
    }
  }

  for (const exclude of excludes) {
    const normalized = tryGetValueOfOptionString(option, exclude);
    // The excluded value is not recognized (e.g., a removed option like "es3"): there is nothing to remove
    if (normalized === undefined) continue;
    variations.delete(normalized);
  }

  if (variations.size === 0) {
    throw new HarnessFatal(`Variations in test option '@${option}' resulted in an empty set.`);
  }
  return [...variations.values()].sort(compareStrings);
}

// harnessutil.go:1150
function getValueOfOptionString(option: string, value: string): CompilerOptionsValue {
  const result = tryGetValueOfOptionString(option, value);
  if (result === undefined) throw new HarnessFatal(`Unknown value '${value}' for option '${option}'`);
  return result;
}

// harnessutil.go:1158; undefined stands for the false of the reference.
export function tryGetValueOfOptionString(option: string, value: string): CompilerOptionsValue | undefined {
  const optionDecl = getCommandLineOption(option);
  if (optionDecl === undefined) return undefined;
  switch (optionDecl.kind) {
    case "enum":
      return enumMap(optionDecl)?.get(toLower(value));
    case "boolean":
      switch (toLower(value)) {
        case "true":
          return true;
        case "false":
          return false;
      }
      return undefined;
  }
  return value;
}

// harnessutil.go:1182
export function getCommandLineOption(option: string): CommandLineOption | undefined {
  return compilerOptions.find(optionDecl => equalFold(optionDecl.name, option));
}

// harnessutil.go:1188; the values of an enum come in the order of the keys of its map.
export function getAllValuesForOption(option: string): string[] {
  const optionDecl = getCommandLineOption(option);
  if (optionDecl === undefined) return [];
  switch (optionDecl.kind) {
    case "enum":
      return [...(enumMap(optionDecl)?.keys() ?? [])];
    case "boolean":
      return ["true", "false"];
  }
  return [];
}

// harnessutil.go:1202; variationCount is the capacity that the reference reserves for the result.
export function computeFileBasedTestConfigurationVariations(
  variationCount: number,
  optionEntries: readonly (readonly string[])[],
): Map<string, string>[] {
  const configurations: Map<string, string>[] = [];
  computeFileBasedTestConfigurationVariationsWorker(configurations, optionEntries, 0, new Map());
  return configurations;
}

// harnessutil.go:1208
function computeFileBasedTestConfigurationVariationsWorker(
  configurations: Map<string, string>[],
  optionEntries: readonly (readonly string[])[],
  index: number,
  variationState: Map<string, string>,
): void {
  if (index >= optionEntries.length) {
    configurations.push(new Map(variationState));
    return;
  }

  const optionKey = optionEntries[index][0];
  const entries = optionEntries[index].slice(1);
  for (const entry of entries) {
    // set or overwrite the variation, then compute the next variation
    variationState.set(optionKey, entry);
    computeFileBasedTestConfigurationVariationsWorker(configurations, optionEntries, index + 1, variationState);
  }
}
