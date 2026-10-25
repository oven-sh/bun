// Which schemas `bun build --compile --aot` must refuse, may refuse, and must take.
// A keyword that has no translation is a build error that names it, wherever in the schema it stands. It is never passed over.

export type Draft = "2020-12" | "draft-07";

export interface Refusals {
  /** The build must fail at this schema, and the error must name one of these. */
  must: Set<string>;
  /** The build may fail at this schema, if the error names one of these. */
  may: Set<string>;
  /** JSON Pointers to the schemas that hold each of them. */
  places: Map<string, Set<string>>;
}

const withoutMeaning = new Set([
  "title",
  "description",
  "default",
  "examples",
  "$comment",
  "deprecated",
  "readOnly",
  "writeOnly",
  "contentEncoding",
  "contentMediaType",
  "contentSchema",
  "$defs",
  "definitions",
]);

const oneSchema = new Set(["not", "if", "then", "else", "additionalProperties", "propertyNames", "contains"]);
const listOfSchemas = new Set(["allOf", "anyOf", "oneOf"]);
const schemasByKey = new Set(["properties", "patternProperties"]);

const inBothDrafts = new Set([
  ...oneSchema,
  ...listOfSchemas,
  ...schemasByKey,
  "$schema",
  "$id",
  "$ref",
  "type",
  "enum",
  "const",
  "multipleOf",
  "maximum",
  "exclusiveMaximum",
  "minimum",
  "exclusiveMinimum",
  "maxLength",
  "minLength",
  "pattern",
  "format",
  "items",
  "maxItems",
  "minItems",
  "uniqueItems",
  "maxProperties",
  "minProperties",
  "required",
]);

const onlyIn: Record<Draft, Set<string>> = {
  "2020-12": new Set(["prefixItems", "minContains", "maxContains", "dependentRequired", "dependentSchemas", "$vocabulary"]),
  "draft-07": new Set(["additionalItems", "dependencies"]),
};

const knownButRefused = new Set(["unevaluatedItems", "unevaluatedProperties", "$dynamicRef", "$dynamicAnchor", "$anchor"]);

export const checkedFormats = new Set([
  "email",
  "uuid",
  "ipv4",
  "ipv6",
  "date",
  "date-time",
  "time",
  "duration",
  "hostname",
  "uri",
  "uri-reference",
  "regex",
  "json-pointer",
  "relative-json-pointer",
]);

const dialects: Record<string, Draft> = {
  "https://json-schema.org/draft/2020-12/schema": "2020-12",
  "http://json-schema.org/draft-07/schema#": "draft-07",
  "http://json-schema.org/draft-07/schema": "draft-07",
  "http://json-schema.org/draft-06/schema#": "draft-07",
  "http://json-schema.org/draft-06/schema": "draft-07",
};

const knownVocabularies = new Set(
  ["core", "applicator", "unevaluated", "validation", "meta-data", "format-annotation", "format-assertion", "content"].map(
    name => "https://json-schema.org/draft/2020-12/vocab/" + name,
  ),
);

const kinds = new Set(["null", "boolean", "number", "integer", "string", "array", "object"]);
const bounds = new Set(["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum"]);
const counts = new Set(["minLength", "maxLength", "minItems", "maxItems", "minContains", "maxContains", "minProperties", "maxProperties"]);
const largestCountThatMustBeTaken = 999_999_999;
/** A longer list of schemas, or a larger table of rules, is compiled right or refused. */
const mostPartsThatMustBeTaken = 64;

/** These ask about the value that the schema itself is asked about. */
const aboutTheSameValue = new Set(["$ref", "not", "if", "then", "else", "allOf", "anyOf", "oneOf", "dependentSchemas", "dependencies"]);
/** A schema that reaches itself through one of these may be refused. Through `properties`, `additionalProperties` and `items` it is taken. */
const mayNotRecur = new Set(["contains", "prefixItems", "propertyNames", "additionalItems", "items of a tuple", "additionalProperties beside patterns"]);
export const testedAgainstItself = "a type that is tested against itself";

/** The aliases of `Schema` are object types with one of these keys. A member of that name in any other type is refused. */
export const brandKeys = [
  "int32",
  "int",
  "min",
  "max",
  "above",
  "below",
  "multipleOf",
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
  "pattern",
  "format",
  "uniqueItems",
  "contains",
  "not",
  "if",
  "oneOf",
  "allOf",
  "patternProperties",
  "propertyNames",
  "minProperties",
  "maxProperties",
  "dependentRequired",
  "dependentSchemas",
  "refused",
  "message",
  "default",
  "strict",
].map(name => "bun." + name);

function brandKeysIn(value: unknown): string[] {
  if (typeof value !== "object" || value === null) return [];
  return [...Object.keys(value).filter(key => !Array.isArray(value) && brandKeys.includes(key)), ...Object.values(value).flatMap(brandKeysIn)];
}

/** JSON Schema means the `u` flag. */
function isRegularExpression(source: string): boolean {
  try {
    new RegExp(source, "u");
    return true;
  } catch {
    return false;
  }
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function draftOf(schema: unknown, otherwise: Draft): Draft {
  if (isObject(schema) && typeof schema.$schema === "string") return dialects[schema.$schema] ?? otherwise;
  return otherwise;
}

const isListOfStrings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === "string");

/** A literal such as `1e400` in a schema that is written in TypeScript. */
function holdsWhatIsNotFinite(value: unknown): boolean {
  if (typeof value === "number") return !Number.isFinite(value);
  return typeof value === "object" && value !== null && Object.values(value).some(holdsWhatIsNotFinite);
}

const unescaped = (pointer: string) => pointer.replaceAll("~1", "/").replaceAll("~0", "~");
const unescapedSteps = (pointer: string) => JSON.stringify(pointer.split("/").map(unescaped));
const below = (pointer: string, ...steps: (string | number)[]) =>
  pointer + steps.map(step => "/" + String(step).replaceAll("~", "~0").replaceAll("/", "~1")).join("");

/** Whether `pointer` leads to where the table found `name`: to the schema that holds the keyword, or to the keyword in it. */
export function isPlaceOf({ places }: Refusals, name: string, pointer: string): boolean {
  const given = unescaped(pointer === "#/" ? "#" : pointer);
  return [...(places.get(name) ?? [])].some(place => given === unescaped(place) || given === unescaped(below(place, name)));
}

/** `documents`: the other documents that the type is given, by their URIs. */
export function whatTheBuildRefuses(
  root: unknown,
  draftWithoutDialect: Draft,
  documents: Record<string, unknown> = {},
  read = new Set<unknown>(),
): Refusals {
  const must = new Set<string>();
  const may = new Set<string>();
  const places = new Map<string, Set<string>>();
  const draft = draftOf(root, draftWithoutDialect);
  const otherDraft = onlyIn[draft === "2020-12" ? "draft-07" : "2020-12"];
  const walked = new Set<unknown>();
  read.add(root);
  const steps: { from: unknown; keyword: string; to: unknown }[] = [];
  const schemas = new Map<string, unknown>();
  const references: { pointer: string; from: unknown; target: string | undefined }[] = [];

  function note(names: Set<string>, pointer: string, noted: string[]) {
    for (const name of noted) {
      names.add(name);
      if (!places.has(name)) places.set(name, new Set());
      places.get(name)!.add(pointer);
    }
  }

  /** Whether a reference leads to this document by its `$id`, or to one of the others. Another document that is reached is read whole. */
  function isInReach(reference: string): boolean {
    const base = isObject(root) && typeof root.$id === "string" ? root.$id : undefined;
    const uri = URL.canParse(reference, base) ? new URL(reference, base) : undefined;
    if (uri) uri.hash = "";
    const key = [reference.split("#")[0], uri?.href].find(key => key !== undefined && Object.hasOwn(documents, key));
    if (key === undefined) return uri !== undefined && base !== undefined && URL.canParse(base) && uri.href === new URL("#", base).href.replace(/#$/, "");
    const document = documents[key];
    if (isObject(document) && Object.hasOwn(document, "$id") && document.$id !== key) may.add("$id");
    if (read.has(document)) return true;
    read.add(document);
    const other = whatTheBuildRefuses(document, draftWithoutDialect, documents, read);
    for (const name of other.must) must.add(name);
    for (const name of other.may) may.add(name);
    return true;
  }

  function walk(schema: unknown, pointer: string, holder?: { pointer: string; keyword: string }) {
    schemas.set(pointer, schema);
    if (typeof schema === "boolean") return;
    if (!isObject(schema)) {
      if (holder) note(must, holder.pointer, [holder.keyword]);
      return note(must, pointer, ["schema"]);
    }
    if (walked.has(schema)) return;
    walked.add(schema);
    const isRoot = schema === root;
    const has = (keyword: string) => Object.hasOwn(schema, keyword);
    const refuse = (...names: string[]) => note(must, pointer, names);
    const allow = (...names: string[]) => note(may, pointer, names);
    /** `step`: by which keyword the check goes from this schema to that one. */
    const inner = (to: unknown, keyword: string, key?: string | number, step = keyword) => {
      steps.push({ from: schema, keyword: step, to });
      walk(to, key === undefined ? below(pointer, keyword) : below(pointer, keyword, key), { pointer, keyword });
    };

    for (const [keyword, value] of Object.entries(schema)) {
      if (keyword.startsWith("x-")) continue;
      if (keyword === "$defs" || keyword === "definitions") {
        if (!isObject(value)) refuse(keyword);
        else for (const [name, definition] of Object.entries(value)) walk(definition, below(pointer, keyword, name), { pointer, keyword });
        continue;
      }
      if (keyword === "contentSchema") walk(value, below(pointer, keyword), { pointer, keyword });
      if (withoutMeaning.has(keyword)) continue;
      if (knownButRefused.has(keyword) || otherDraft.has(keyword)) {
        refuse(keyword);
        continue;
      }
      if (!inBothDrafts.has(keyword) && !onlyIn[draft].has(keyword)) {
        refuse(keyword);
        continue;
      }
      if (draft === "draft-07" && has("$ref") && keyword !== "$ref" && !(isRoot && keyword === "$schema")) refuse(keyword, "$ref");

      if (keyword === "additionalProperties" && isObject(schema.patternProperties) && Object.keys(schema.patternProperties).length > 0) {
        inner(value, keyword, undefined, "additionalProperties beside patterns");
      } else if (oneSchema.has(keyword)) inner(value, keyword);
      else if (listOfSchemas.has(keyword) || keyword === "prefixItems") {
        if (!Array.isArray(value)) refuse(keyword);
        else {
          if (value.length === 0 || value.length > mostPartsThatMustBeTaken) allow(keyword);
          value.forEach((part, index) => inner(part, keyword, index));
        }
      } else if (schemasByKey.has(keyword) || keyword === "dependentSchemas") {
        if (!isObject(value)) refuse(keyword);
        else for (const [key, part] of Object.entries(value)) inner(part, keyword, key);
      }
      if (keyword !== "properties" && isObject(value) && Object.keys(value).length > mostPartsThatMustBeTaken) allow(keyword);

      if (bounds.has(keyword) && !(typeof value === "number" && Number.isFinite(value))) refuse(keyword);
      if (counts.has(keyword)) {
        if (!(typeof value === "number" && Number.isInteger(value) && value >= 0)) refuse(keyword);
        else if (value > largestCountThatMustBeTaken) allow(keyword);
      }

      switch (keyword) {
        case "$schema":
          if (typeof value !== "string" || !Object.hasOwn(dialects, value)) refuse(keyword);
          else if (!isRoot) allow(keyword);
          break;
        case "$id":
          if (typeof value !== "string" || !isRoot) refuse(keyword);
          break;
        case "$ref":
          if (typeof value !== "string") refuse(keyword);
          else if (value === "#" || value.startsWith("#/")) {
            if (value.includes("%")) allow(keyword);
            references.push({ pointer, from: schema, target: decodeURIComponentOrNothing(value) });
          } else if (value.startsWith("#")) refuse(keyword, "$anchor");
          else if (!isInReach(value)) refuse(keyword);
          else if (/#[^/]/.test(value)) refuse(keyword, "$anchor");
          else allow(keyword);
          break;
        case "$vocabulary":
          if (!isObject(value)) refuse(keyword);
          else if (Object.entries(value).some(([uri, isRequired]) => isRequired === true && !knownVocabularies.has(uri))) refuse(keyword);
          else allow(keyword);
          break;
        case "type": {
          const listed = Array.isArray(value) ? value : [value];
          if (!listed.every(kind => typeof kind === "string" && kinds.has(kind))) refuse(keyword);
          else if (listed.length === 0) refuse(keyword);
          else if (new Set(listed).size !== listed.length) allow(keyword);
          break;
        }
        case "enum":
          if (!Array.isArray(value)) refuse(keyword);
          else if (has("const") || holdsWhatIsNotFinite(value)) allow(keyword);
          refuse(...brandKeysIn(value));
          break;
        case "const":
          if (holdsWhatIsNotFinite(value)) allow(keyword);
          refuse(...brandKeysIn(value));
          break;
        case "properties":
          if (isObject(value)) refuse(...Object.keys(value).filter(key => brandKeys.includes(key)));
          break;
        case "required":
          if (!isListOfStrings(value)) refuse(keyword);
          else refuse(...value.filter(name => brandKeys.includes(name)));
          break;
        case "uniqueItems":
          if (typeof value !== "boolean") refuse(keyword);
          break;
        case "dependentRequired":
          if (!isObject(value) || !Object.values(value).every(isListOfStrings)) refuse(keyword);
          break;
        case "format":
          if (typeof value !== "string" || !checkedFormats.has(value)) refuse(keyword);
          break;
        case "pattern":
          if (typeof value !== "string") refuse(keyword);
          else if (!isRegularExpression(value)) refuse(keyword, value);
          break;
        case "patternProperties":
          if (!isObject(value)) break;
          for (const source of Object.keys(value)) if (!isRegularExpression(source)) refuse(keyword, source);
          // The type has no place for a required member whose type only a pattern or `additionalProperties` says.
          if (has("additionalProperties") && schema.additionalProperties !== true && isListOfStrings(schema.required)) {
            const declared = isObject(schema.properties) ? schema.properties : {};
            if (schema.required.some(name => !Object.hasOwn(declared, name))) allow(keyword);
          }
          break;
        case "multipleOf":
          if (typeof value !== "number" || !(value > 0) || !Number.isFinite(value)) refuse(keyword);
          break;
        case "then":
        case "else":
          if (!has("if")) refuse(keyword);
          break;
        case "minContains":
        case "maxContains":
          if (!has("contains")) refuse(keyword);
          break;
        case "items":
          if (Array.isArray(value)) {
            if (draft === "2020-12") refuse(keyword);
            else value.forEach((part, index) => inner(part, keyword, index, "prefixItems"));
          } else inner(value, keyword, undefined, has("prefixItems") ? "items of a tuple" : keyword);
          break;
        case "additionalItems":
          if (!Array.isArray(schema.items)) refuse(keyword);
          else inner(value, keyword);
          break;
        case "dependencies":
          if (!isObject(value)) refuse(keyword);
          else {
            for (const [key, part] of Object.entries(value)) {
              if (!Array.isArray(part)) inner(part, keyword, key);
              else if (!isListOfStrings(part)) refuse(keyword);
            }
          }
          break;
      }
    }
  }

  function reaches(from: unknown, to: unknown, along: Set<string> | undefined): boolean {
    const seen = new Set([from]);
    for (const schema of seen) {
      if (schema === to) return true;
      for (const step of steps) if (step.from === schema && (along === undefined || along.has(step.keyword))) seen.add(step.to);
    }
    return false;
  }

  walk(root, "#");
  // A reference leads to a place where a schema stands, and to nothing else that a JSON Pointer could reach.
  const byPlace = new Map([...schemas].map(([pointer, schema]) => [unescapedSteps(pointer), schema]));
  for (const { pointer, from, target } of references) {
    if (target === undefined || !byPlace.has(unescapedSteps(target))) note(must, pointer, ["$ref"]);
    else steps.push({ from, keyword: "$ref", to: byPlace.get(unescapedSteps(target)) });
  }
  for (const { from, keyword, to } of steps) {
    if (typeof to !== "object" || to === null) continue;
    const asksItself = aboutTheSameValue.has(keyword) && reaches(to, from, aboutTheSameValue);
    if (!asksItself && !(mayNotRecur.has(keyword) && reaches(to, from, undefined))) continue;
    for (const { pointer } of references) note(may, pointer, asksItself ? ["$ref", testedAgainstItself] : ["$ref"]);
  }
  for (const keyword of must) may.delete(keyword);
  return { must, may, places };
}

function decodeURIComponentOrNothing(text: string): string | undefined {
  try {
    return decodeURIComponent(text);
  } catch {
    return undefined;
  }
}
