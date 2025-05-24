import auditFixturesJson from "./audit-fixtures.json" with { type: "json" };

type AuditReport = (typeof auditFixturesJson)[keyof typeof auditFixturesJson];

const fixtures = Object.entries(auditFixturesJson).map(
  ([key, value]) => [JSON.parse(key) as Record<string, string[]>, value as AuditReport] as const,
);

export function resolveBulkAdvisoryFixture(request: Record<string, string[]>) {
  for (const [body, response] of fixtures) {
    if (isSameJSON(body, request)) {
      return response;
    }
  }

  return undefined;
}

type JsonValue = string | number | boolean | null | JsonValue[] | { [key in string]: JsonValue };

function isSameJSON<T extends JsonValue>(a: T, b: T) {
  return sortedObjectHash(a) === sortedObjectHash(b);
}

function sortedObjectHash(obj: JsonValue): string {
  if (typeof obj === "string") {
    return JSON.stringify(obj);
  }

  if (Array.isArray(obj)) {
    const elements = obj.map(sortedObjectHash);
    return `[${elements.join(",")}]`;
  }

  if (typeof obj === "object" && obj !== null) {
    const sortedKeys = Object.keys(obj).sort();
    const pairs = sortedKeys.map(key => `${JSON.stringify(key)}:${sortedObjectHash(obj[key])}`);
    return `{${pairs.join(",")}}`;
  }

  if (typeof obj === "number" || typeof obj === "boolean" || obj === null) {
    return String(obj);
  }

  return obj satisfies never;
}
