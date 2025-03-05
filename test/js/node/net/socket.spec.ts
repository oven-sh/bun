import { bunRun } from "harness";
import path from "node:path";

const fixturePath = (...segs: string[]): string => path.join(import.meta.dirname, "fixtures", "socket", ...segs);
function cleanLogs(text: string): string {
  return text
    .split("\n")
    .filter(line => !line.startsWith("mimalloc:"))
    .join("\n");
}

describe("Given a ping server/client", () => {
  let logs: string[], clientLogs, serverLogs;

  beforeAll(() => {
    logs = bunRun(fixturePath("ping.fixture.js")).stdout.split("\n");
    clientLogs = logs.filter(line => line.startsWith("[client]"));
    serverLogs = logs.filter(line => line.startsWith("[server]"));
  });

  it("no errors occur", () => {
    expect(logs.find(line => /error/i.test(line))).toBeUndefined();
  });

  describe("the client", () => {
    it("emits a connect event", () => expect(clientLogs).toContain("[client] connect"));
    it("emits a DNS 'lookup' event before attempting connect", () => {
      expect(clientLogs).toContain("[client] lookup");
      expect(clientLogs.indexOf("[client] lookup")).toBeLessThan(clientLogs.indexOf("[client] connectionAttempt"));
    });
    it("emits a 'connectionAttempt' event before connecting", () => {
      expect(clientLogs).toContain("[client] connectionAttempt");
      expect(clientLogs.indexOf("[client] connectionAttempt")).toBeLessThan(clientLogs.indexOf("[client] connect"));
    });
    it('receives "ping" from the server', () => expect(clientLogs).toContain("[client] data: ping"));
    it("emits 'prefinish' before 'finish'", () => {
      expect(clientLogs).toContain("[client] prefinish");
      expect(clientLogs).toContain("[client] finish");
      expect(clientLogs.indexOf("[client] prefinish")).toBeLessThan(clientLogs.indexOf("[client] finish"));
    });
    it("finishes with a close event", () => {
      expect(logs).toContain("[client] close");
      expect(clientLogs.at(-1)).toEqual("[client] close");
    });
  }); // the client

  describe("the server", () => {
    it("emits a 'connection' event", () => expect(serverLogs).toContain("[server] connection"));
    it("receives 'ping' from the client", () => expect(serverLogs).toContain("[server] socket data: ping"));
    it("finishes with a 'close' event", () => {
      expect(logs).toContain("[server] close");
      expect(serverLogs.at(-1)).toEqual("[server] close");
    });
  }); // the server
});
