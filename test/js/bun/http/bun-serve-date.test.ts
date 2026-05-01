import { expect, test } from "bun:test";

test("Date header is not updated every request", async () => {
  const twoSecondsAgo = new Date(Date.now() - 2 * 1000);
  await using server = Bun.serve({
    port: 0,
    fetch() {
      return new Response("OK");
    },
  });

  // Make multiple requests in quick succession
  const responses = await Promise.all([
    fetch(server.url),
    fetch(server.url),
    fetch(server.url),
    fetch(server.url),
    fetch(server.url),
  ]);

  // All responses should have the same Date header since they were made within the same second
  const dates = responses.map(r => r.headers.get("Date"));
  const uniqueDates = new Set(dates);

  // Should only have 1 unique date value since all requests were made rapidly
  expect(uniqueDates.size).toBe(1);
  expect(dates[0]).toBeTruthy();

  for (const delay of [250, 250, 250, 250, 250]) {
    await Bun.sleep(delay);
    const laterResponses = await Promise.all([
      fetch(server.url),
      fetch(server.url),
      fetch(server.url),
      fetch(server.url),
      fetch(server.url),
    ]);
    const laterDates = laterResponses.map(r => r.headers.get("Date"));
    const laterUniqueDates = new Set(laterDates);
    expect(laterUniqueDates.size).toBe(1);
    uniqueDates.add([...laterUniqueDates][0]);
  }

  // There should only really be two, but I don't trust timers to be SUPER accurate.
  expect(uniqueDates.size).toBeLessThan(4);

  for (const date of [...uniqueDates]) {
    const d = new Date(date!);
    const stamp = d.getTime();
    expect(Number.isFinite(stamp)).toBe(true);
    expect(stamp).toBeGreaterThan(0);
    expect(stamp).toBeGreaterThan(twoSecondsAgo.getTime());
    expect(stamp).toBeLessThan(Date.now() + 100);
  }
});
