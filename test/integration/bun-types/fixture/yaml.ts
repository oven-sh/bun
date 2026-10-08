import { expectType } from "./utilities";

expectType(Bun.YAML.parse("")).is<unknown>();
// @ts-expect-error
expectType(Bun.YAML.parse({})).is<unknown>();
expectType(Bun.YAML.stringify({ abc: "def"})).is<string>();
// @ts-expect-error
expectType(Bun.YAML.stringify("hi", {})).is<string>();
// @ts-expect-error
expectType(Bun.YAML.stringify("hi", null, 123n)).is<string>();

expectType(Bun.YAML.parse("", {})).is<unknown>();
expectType(Bun.YAML.parse("", { tags: Bun.YAML.tags })).is<unknown>();
expectType(
  Bun.YAML.parse("", {
    tags: {
      ...Bun.YAML.tags,
      "!upper": (value: string, tag: string) => value.toUpperCase(),
      "!wrap": value => ({ value }),
    },
  }),
).is<unknown>();
expectType(Bun.YAML.tags["!env"]).is<Bun.YAML.TagHandler>();
const options: Bun.YAML.ParseOptions = { tags: { "!env": Bun.YAML.tags["!env"] } };
expectType(Bun.YAML.parse("", options)).is<unknown>();
// @ts-expect-error
Bun.YAML.parse("", { tags: { "!upper": "not a function" } });
// @ts-expect-error
Bun.YAML.parse("", "tags");
// @ts-expect-error
Bun.YAML.tags["!env"] = () => undefined;
