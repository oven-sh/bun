import auditFixturesJson from "./audit-fixtures.json" with { type: "json" };

type AuditReport = (typeof auditFixturesJson)[keyof typeof auditFixturesJson];

const map = new Map<Record<string, string[]>, AuditReport>(
  Object.entries(auditFixturesJson).map(([key, value]) => [JSON.parse(key), value]),
);

export function resolveBulkAdvisoryFixture(request: Record<string, string[]>) {
  const requestEntries = Object.entries(request);

  for (const [fixtureKey, fixtureBody] of map.entries()) {
    for (const [requestKey, requestValue] of requestEntries) {
      if (!fixtureKey[requestKey] || !requestValue.every(v => fixtureKey[requestKey].includes(v))) {
        continue;
      }
    }

    return fixtureBody;
  }

  return undefined;
}
