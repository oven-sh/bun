function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  const parent = Object.getPrototypeOf(value);
  const mark = parent === Object.prototype ? "" : parent === null ? "without a prototype " : "with another prototype ";
  return mark + "{" + Object.entries(value).map(([key, held]) => JSON.stringify(key) + ": " + show(held)).join(", ") + "}";
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label, "->", show(run()));
  } catch (error) {
    console.log(label, "threw", error instanceof Error ? error.constructor.name : typeof error);
  }
}

interface Profile {
  name: string;
  age?: number;
  nick: string | null;
  tags?: string[] | null;
  inner?: { deep?: number };
}

function describe(profile: Profile): unknown[] {
  return [
    profile.name,
    profile.age,
    profile.age === undefined ? "no age" : profile.age + 1,
    profile.nick,
    profile.nick === null ? "no nick" : profile.nick.length,
    profile.tags,
    profile.tags?.length ?? "no tags",
    profile.inner?.deep ?? "not deep",
    "age" in profile,
    "tags" in profile,
    "inner" in profile,
    Object.keys(profile),
    JSON.stringify(profile),
  ];
}

const texts = [
  '{"name":"a","nick":null}',
  '{"name":"b","nick":"bee","age":1}',
  '{"name":"c","nick":"","age":0,"tags":[]}',
  '{"name":"d","nick":null,"tags":null}',
  '{"name":"e","nick":null,"inner":{}}',
  '{"name":"f","nick":null,"inner":{"deep":-0}}',
  '{"inner":{"deep":1,"deeper":2},"tags":["x"],"age":1.5,"nick":"n","name":"g"}',
];

let warm = 0;
for (let i = 0; i < 2000; i++) warm += describe(i % 2 ? { name: "n", nick: null } : { name: "n", nick: "k", age: i, tags: ["t"], inner: { deep: i } }).length;
console.log("2000 honest literals", warm);

for (const text of texts) attempt(text, () => describe(JSON.parse<Profile>(text)));
attempt("optional members are added later", () => {
  const profile = JSON.parse<Profile>('{"name":"a","nick":null}');
  profile.age = 3;
  profile.inner = { deep: 4 };
  profile.tags = null;
  return describe(profile);
});
attempt("optional members are deleted later", () => {
  const profile = JSON.parse<Profile>('{"name":"b","age":1,"nick":"n","tags":["x"],"inner":{"deep":2}}');
  delete profile.age;
  delete profile.inner;
  profile.tags = undefined;
  return describe(profile);
});
attempt("mapped types", () => {
  const part = JSON.parse<Partial<Profile>>("{}");
  const picked = JSON.parse<Pick<Profile, "name" | "age">>('{"name":"p","nick":5}');
  const whole = JSON.parse<Required<Pick<Profile, "age">>>('{"age":2}');
  return [part, Object.keys(part), part.name, picked, picked.name.length, whole.age + 1];
});
