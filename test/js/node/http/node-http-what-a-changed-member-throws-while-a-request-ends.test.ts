import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "node:path";

test("what a changed member of a request or of its socket throws goes where _read() and _destroy() send it", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), join(import.meta.dir, "node-http-what-a-changed-member-throws-while-a-request-ends-fixture.ts")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, exitCode }).toEqual({
    stdout: `GET, unread, with 'error' listeners
  req _consuming getter throws: uncaught get _consuming; the client: 200 ok
  req _consuming setter throws: the request: set _consuming, the socket: set _consuming; the client: 200 ok
  req _consuming read-only: the request: TypeError, the socket: TypeError; the client: 200 ok
  req complete getter throws: the request: get complete; the client: 200 ok
  req socket getter throws: the request: get socket; the client: 200 ok
  req upgrade getter throws: the request: get upgrade, the socket: get upgrade; the client: 200 ok
  req _read getter throws: the request: get _read, the socket: get _read; the client: 200 ok
  req _read throws when called: the request: call _read, the socket: call _read; the client: 200 ok
  req _destroy getter throws: the request: get _destroy; the client: 200 ok
  req _destroy throws when called: the request: call _destroy; the client: 200 ok
  req @eofInProgress getter throws: the request: get @eofInProgress, the socket: get @eofInProgress; the client: 200 ok
  req @eofInProgress setter throws: the request: set @eofInProgress, the socket: set @eofInProgress; the client: 200 ok
  req @eofInProgress read-only: the request: TypeError, the socket: TypeError; the client: 200 ok
  req @handle setter throws: the request: set @handle; the client: 200 ok
  req @handle read-only: the request: TypeError; the client: 200 ok
  req @handle a number: the request: TypeError; the client: 200 ok
  req @noBody getter throws: the request: get @noBody, the socket: get @noBody; the client: 200 ok
  socket resume getter throws: the request: get resume, the socket: get resume; the client: 200 ok
  socket resume a number: the request: TypeError, the socket: TypeError; the client: 200 ok
  socket resume throws when called: the request: call resume, the socket: call resume; the client: 200 ok
  socket readable getter throws: the request: get readable, the socket: get readable; the client: 200 ok
  socket readableLength getter throws: the request: get readableLength, the socket: get readableLength; the client: 200 ok
  socket readableHighWaterMark getter throws: the request: get readableHighWaterMark, the socket: get readableHighWaterMark; the client: 200 ok
  socket _paused getter throws: the request: get _paused, the socket: get _paused; the client: 200 ok
  socket parser getter throws: uncaught get parser, uncaught get parser, uncaught get parser; the client: 200 ok
  socket @kUpgradeIncoming getter throws: the request: get @kUpgradeIncoming, the socket: get @kUpgradeIncoming; the client: 200 ok
  socket @kUpgradeIncoming a number: the request: TypeError, the socket: TypeError; the client: 200 ok
  socket @kHandoffResponse getter throws: the request: get @kHandoffResponse, the socket: get @kHandoffResponse; the client: 200 ok
  socket @kStreamingEnabled getter throws: the request: get @kStreamingEnabled, the socket: get @kStreamingEnabled; the client: 200 ok
GET, unread, without 'error' listeners
  req _consuming getter throws: uncaught get _consuming; the client: 200 ok
  req _consuming setter throws: nothing; the client: 200 ok
  req _consuming read-only: nothing; the client: 200 ok
  req complete getter throws: uncaught get complete; the client: 200 ok
  req socket getter throws: uncaught get socket; the client: 200 ok
  req upgrade getter throws: nothing; the client: 200 ok
  req _read getter throws: nothing; the client: 200 ok
  req _read throws when called: nothing; the client: 200 ok
  req _destroy getter throws: uncaught get _destroy; the client: 200 ok
  req _destroy throws when called: uncaught call _destroy; the client: 200 ok
  req @eofInProgress getter throws: nothing; the client: 200 ok
  req @eofInProgress setter throws: nothing; the client: 200 ok
  req @eofInProgress read-only: nothing; the client: 200 ok
  req @handle setter throws: uncaught set @handle; the client: 200 ok
  req @handle read-only: uncaught TypeError; the client: 200 ok
  req @handle a number: uncaught TypeError; the client: 200 ok
  req @noBody getter throws: nothing; the client: 200 ok
  socket resume getter throws: nothing; the client: 200 ok
  socket resume a number: nothing; the client: 200 ok
  socket resume throws when called: nothing; the client: 200 ok
  socket readable getter throws: nothing; the client: 200 ok
  socket readableLength getter throws: nothing; the client: 200 ok
  socket readableHighWaterMark getter throws: nothing; the client: 200 ok
  socket _paused getter throws: nothing; the client: 200 ok
  socket parser getter throws: uncaught get parser, uncaught get parser, uncaught get parser; the client: 200 ok
  socket @kUpgradeIncoming getter throws: nothing; the client: 200 ok
  socket @kUpgradeIncoming a number: nothing; the client: 200 ok
  socket @kHandoffResponse getter throws: nothing; the client: 200 ok
  socket @kStreamingEnabled getter throws: nothing; the client: 200 ok
POST, unread, with 'error' listeners
  req _consuming getter throws: uncaught get _consuming; the client: 200 ok
  req _consuming setter throws: the request: set _consuming, the socket: set _consuming; the client: 200 ok
  req _consuming read-only: the request: TypeError, the socket: TypeError; the client: 200 ok
  req complete getter throws: the request: get complete; the client: 200 ok
  req socket getter throws: the request: get socket; the client: 200 ok
  req upgrade getter throws: the request: get upgrade, the socket: get upgrade; the client: 200 ok
  req _read getter throws: the request: get _read, the socket: get _read; the client: 200 ok
  req _read throws when called: the request: call _read, the socket: call _read; the client: 200 ok
  req _destroy getter throws: the request: get _destroy; the client: 200 ok
  req _destroy throws when called: the request: call _destroy; the client: 200 ok
  req @eofInProgress getter throws: the request: get @eofInProgress, the socket: get @eofInProgress; the client: 200 ok
  req @eofInProgress setter throws: uncaught set @eofInProgress; the client: 200 ok
  req @eofInProgress read-only: uncaught TypeError; the client: 200 ok
  req @handle setter throws: the request: set @handle; the client: 200 ok
  req @handle read-only: the request: TypeError; the client: 200 ok
  req @handle a number: the request: TypeError; the client: 200 ok
  req @noBody getter throws: the request: get @noBody, the socket: get @noBody; the client: 200 ok
  socket resume getter throws: the request: get resume, the socket: get resume; the client: 200 ok
  socket resume a number: the request: TypeError, the socket: TypeError; the client: 200 ok
  socket resume throws when called: the request: call resume, the socket: call resume; the client: 200 ok
  socket readable getter throws: the request: get readable, the socket: get readable; the client: 200 ok
  socket readableLength getter throws: the request: get readableLength, the socket: get readableLength; the client: 200 ok
  socket readableHighWaterMark getter throws: the request: get readableHighWaterMark, the socket: get readableHighWaterMark; the client: 200 ok
  socket _paused getter throws: the request: get _paused, the socket: get _paused; the client: 200 ok
  socket parser getter throws: uncaught get parser, uncaught get parser, uncaught get parser; the client: 200 ok
  socket @kUpgradeIncoming getter throws: the request: get @kUpgradeIncoming, the socket: get @kUpgradeIncoming; the client: 200 ok
  socket @kUpgradeIncoming a number: the request: TypeError, the socket: TypeError; the client: 200 ok
  socket @kHandoffResponse getter throws: the request: get @kHandoffResponse, the socket: get @kHandoffResponse; the client: 200 ok
  socket @kStreamingEnabled getter throws: the request: get @kStreamingEnabled, the socket: get @kStreamingEnabled; the client: 200 ok
POST, unread, without 'error' listeners
  req _consuming getter throws: uncaught get _consuming; the client: 200 ok
  req _consuming setter throws: nothing; the client: 200 ok
  req _consuming read-only: nothing; the client: 200 ok
  req complete getter throws: uncaught get complete; the client: 200 ok
  req socket getter throws: uncaught get socket; the client: 200 ok
  req upgrade getter throws: nothing; the client: 200 ok
  req _read getter throws: nothing; the client: 200 ok
  req _read throws when called: nothing; the client: 200 ok
  req _destroy getter throws: uncaught get _destroy; the client: 200 ok
  req _destroy throws when called: uncaught call _destroy; the client: 200 ok
  req @eofInProgress getter throws: nothing; the client: 200 ok
  req @eofInProgress setter throws: uncaught set @eofInProgress; the client: 200 ok
  req @eofInProgress read-only: uncaught TypeError; the client: 200 ok
  req @handle setter throws: uncaught set @handle; the client: 200 ok
  req @handle read-only: uncaught TypeError; the client: 200 ok
  req @handle a number: uncaught TypeError; the client: 200 ok
  req @noBody getter throws: nothing; the client: 200 ok
  socket resume getter throws: nothing; the client: 200 ok
  socket resume a number: nothing; the client: 200 ok
  socket resume throws when called: nothing; the client: 200 ok
  socket readable getter throws: nothing; the client: 200 ok
  socket readableLength getter throws: nothing; the client: 200 ok
  socket readableHighWaterMark getter throws: nothing; the client: 200 ok
  socket _paused getter throws: nothing; the client: 200 ok
  socket parser getter throws: uncaught get parser, uncaught get parser, uncaught get parser; the client: 200 ok
  socket @kUpgradeIncoming getter throws: nothing; the client: 200 ok
  socket @kUpgradeIncoming a number: nothing; the client: 200 ok
  socket @kHandoffResponse getter throws: nothing; the client: 200 ok
  socket @kStreamingEnabled getter throws: nothing; the client: 200 ok
GET, data, with 'error' listeners
  req _consuming getter throws: the request: get _consuming, the socket: get _consuming; the client: ECONNRESET
  req _consuming setter throws: the request: set _consuming, the socket: set _consuming; the client: ECONNRESET
  req _consuming read-only: the request: TypeError, the socket: TypeError; the client: ECONNRESET
  req complete getter throws: end, the request: get complete; the client: 200 ok
  req upgrade getter throws: the request: get upgrade, the socket: get upgrade; the client: ECONNRESET
  req _read getter throws: the request: get _read, the socket: get _read; the client: ECONNRESET
  req _read throws when called: the request: call _read, the socket: call _read; the client: ECONNRESET
  req _destroy getter throws: end, the request: get _destroy; the client: 200 ok
  req _destroy throws when called: end, the request: call _destroy; the client: 200 ok
  req @eofInProgress getter throws: the request: get @eofInProgress, the socket: get @eofInProgress; the client: ECONNRESET
  req @eofInProgress setter throws: the request: set @eofInProgress, the socket: set @eofInProgress; the client: ECONNRESET
  req @eofInProgress read-only: the request: TypeError, the socket: TypeError; the client: ECONNRESET
  req @handle setter throws: end, the request: set @handle; the client: 200 ok
  req @handle read-only: end, the request: TypeError; the client: 200 ok
  req @noBody getter throws: the request: get @noBody, the socket: get @noBody; the client: ECONNRESET
  socket resume getter throws: the request: get resume, the socket: get resume; the client: ECONNRESET
  socket resume a number: the request: TypeError, the socket: TypeError; the client: ECONNRESET
  socket resume throws when called: the request: call resume, the socket: call resume; the client: ECONNRESET
  socket readable getter throws: the request: get readable, the socket: get readable; the client: ECONNRESET
  socket readableLength getter throws: the request: get readableLength, the socket: get readableLength; the client: ECONNRESET
  socket readableHighWaterMark getter throws: the request: get readableHighWaterMark, the socket: get readableHighWaterMark; the client: ECONNRESET
  socket _paused getter throws: the request: get _paused, the socket: get _paused; the client: ECONNRESET
  socket parser getter throws: uncaught get parser, end, uncaught get parser, uncaught get parser; the client: 200 ok
  socket @kUpgradeIncoming getter throws: the request: get @kUpgradeIncoming, the socket: get @kUpgradeIncoming; the client: ECONNRESET
  socket @kUpgradeIncoming a number: the request: TypeError, the socket: TypeError; the client: ECONNRESET
  socket @kHandoffResponse getter throws: the request: get @kHandoffResponse, the socket: get @kHandoffResponse; the client: ECONNRESET
  socket @kStreamingEnabled getter throws: the request: get @kStreamingEnabled, the socket: get @kStreamingEnabled; the client: ECONNRESET
GET, data, without 'error' listeners
  req _consuming getter throws: nothing; the client: ECONNRESET
  req _consuming setter throws: nothing; the client: ECONNRESET
  req _consuming read-only: nothing; the client: ECONNRESET
  req complete getter throws: end, uncaught get complete; the client: 200 ok
  req upgrade getter throws: nothing; the client: ECONNRESET
  req _read getter throws: nothing; the client: ECONNRESET
  req _read throws when called: nothing; the client: ECONNRESET
  req _destroy getter throws: end, uncaught get _destroy; the client: 200 ok
  req _destroy throws when called: end, uncaught call _destroy; the client: 200 ok
  req @eofInProgress getter throws: nothing; the client: ECONNRESET
  req @eofInProgress setter throws: nothing; the client: ECONNRESET
  req @eofInProgress read-only: nothing; the client: ECONNRESET
  req @handle setter throws: end, uncaught set @handle; the client: 200 ok
  req @handle read-only: end, uncaught TypeError; the client: 200 ok
  req @noBody getter throws: nothing; the client: ECONNRESET
  socket resume getter throws: nothing; the client: ECONNRESET
  socket resume a number: nothing; the client: ECONNRESET
  socket resume throws when called: nothing; the client: ECONNRESET
  socket readable getter throws: nothing; the client: ECONNRESET
  socket readableLength getter throws: nothing; the client: ECONNRESET
  socket readableHighWaterMark getter throws: nothing; the client: ECONNRESET
  socket _paused getter throws: nothing; the client: ECONNRESET
  socket parser getter throws: uncaught get parser, end, uncaught get parser, uncaught get parser; the client: 200 ok
  socket @kUpgradeIncoming getter throws: nothing; the client: ECONNRESET
  socket @kUpgradeIncoming a number: nothing; the client: ECONNRESET
  socket @kHandoffResponse getter throws: nothing; the client: ECONNRESET
  socket @kStreamingEnabled getter throws: nothing; the client: ECONNRESET
POST, data, with 'error' listeners
  req _consuming getter throws: the request: get _consuming, the socket: get _consuming; the client: ECONNRESET
  req _consuming setter throws: the request: set _consuming, the socket: set _consuming; the client: ECONNRESET
  req _consuming read-only: the request: TypeError, the socket: TypeError; the client: ECONNRESET
  req complete getter throws: data 4, end, the request: get complete; the client: 200 ok
  req upgrade getter throws: the request: get upgrade, the socket: get upgrade; the client: ECONNRESET
  req _read getter throws: the request: get _read, the socket: get _read; the client: ECONNRESET
  req _read throws when called: the request: call _read, the socket: call _read; the client: ECONNRESET
  req _destroy getter throws: data 4, end, the request: get _destroy; the client: 200 ok
  req _destroy throws when called: data 4, end, the request: call _destroy; the client: 200 ok
  req @eofInProgress getter throws: the request: get @eofInProgress, the socket: get @eofInProgress; the client: ECONNRESET
  req @eofInProgress setter throws: data 4, uncaught set @eofInProgress, the request: set @eofInProgress, the socket: set @eofInProgress; the client: ECONNRESET
  req @eofInProgress read-only: data 4, uncaught TypeError, the request: TypeError, the socket: TypeError; the client: ECONNRESET
  req @handle setter throws: data 4, end, the request: set @handle; the client: 200 ok
  req @handle read-only: data 4, end, the request: TypeError; the client: 200 ok
  req @noBody getter throws: the request: get @noBody, the socket: get @noBody; the client: ECONNRESET
  socket resume getter throws: the request: get resume, the socket: get resume; the client: ECONNRESET
  socket resume a number: the request: TypeError, the socket: TypeError; the client: ECONNRESET
  socket resume throws when called: the request: call resume, the socket: call resume; the client: ECONNRESET
  socket readable getter throws: the request: get readable, the socket: get readable; the client: ECONNRESET
  socket readableLength getter throws: the request: get readableLength, the socket: get readableLength; the client: ECONNRESET
  socket readableHighWaterMark getter throws: the request: get readableHighWaterMark, the socket: get readableHighWaterMark; the client: ECONNRESET
  socket _paused getter throws: the request: get _paused, the socket: get _paused; the client: ECONNRESET
  socket parser getter throws: data 4, uncaught get parser, end, uncaught get parser, uncaught get parser; the client: 200 ok
  socket @kUpgradeIncoming getter throws: the request: get @kUpgradeIncoming, the socket: get @kUpgradeIncoming; the client: ECONNRESET
  socket @kUpgradeIncoming a number: the request: TypeError, the socket: TypeError; the client: ECONNRESET
  socket @kHandoffResponse getter throws: the request: get @kHandoffResponse, the socket: get @kHandoffResponse; the client: ECONNRESET
  socket @kStreamingEnabled getter throws: the request: get @kStreamingEnabled, the socket: get @kStreamingEnabled; the client: ECONNRESET
POST, data, without 'error' listeners
  req _consuming getter throws: nothing; the client: ECONNRESET
  req _consuming setter throws: nothing; the client: ECONNRESET
  req _consuming read-only: nothing; the client: ECONNRESET
  req complete getter throws: data 4, end, uncaught get complete; the client: 200 ok
  req upgrade getter throws: nothing; the client: ECONNRESET
  req _read getter throws: nothing; the client: ECONNRESET
  req _read throws when called: nothing; the client: ECONNRESET
  req _destroy getter throws: data 4, end, uncaught get _destroy; the client: 200 ok
  req _destroy throws when called: data 4, end, uncaught call _destroy; the client: 200 ok
  req @eofInProgress getter throws: nothing; the client: ECONNRESET
  req @eofInProgress setter throws: data 4, uncaught set @eofInProgress; the client: ECONNRESET
  req @eofInProgress read-only: data 4, uncaught TypeError; the client: ECONNRESET
  req @handle setter throws: data 4, end, uncaught set @handle; the client: 200 ok
  req @handle read-only: data 4, end, uncaught TypeError; the client: 200 ok
  req @noBody getter throws: nothing; the client: ECONNRESET
  socket resume getter throws: nothing; the client: ECONNRESET
  socket resume a number: nothing; the client: ECONNRESET
  socket resume throws when called: nothing; the client: ECONNRESET
  socket readable getter throws: nothing; the client: ECONNRESET
  socket readableLength getter throws: nothing; the client: ECONNRESET
  socket readableHighWaterMark getter throws: nothing; the client: ECONNRESET
  socket _paused getter throws: nothing; the client: ECONNRESET
  socket parser getter throws: data 4, uncaught get parser, end, uncaught get parser, uncaught get parser; the client: 200 ok
  socket @kUpgradeIncoming getter throws: nothing; the client: ECONNRESET
  socket @kUpgradeIncoming a number: nothing; the client: ECONNRESET
  socket @kHandoffResponse getter throws: nothing; the client: ECONNRESET
  socket @kStreamingEnabled getter throws: nothing; the client: ECONNRESET
POST, readable, with 'error' listeners
  req _consuming getter throws: the request: get _consuming, the socket: get _consuming; the client: ECONNRESET
  req _consuming setter throws: the request: set _consuming, the socket: set _consuming; the client: ECONNRESET
  req _consuming read-only: the request: TypeError, the socket: TypeError; the client: ECONNRESET
  req complete getter throws: read 4, end, the request: get complete; the client: 200 ok
  req upgrade getter throws: the request: get upgrade, the socket: get upgrade; the client: ECONNRESET
  req _read getter throws: the request: get _read, the socket: get _read; the client: ECONNRESET
  req _read throws when called: the request: call _read, the socket: call _read; the client: ECONNRESET
  req _destroy getter throws: read 4, end, the request: get _destroy; the client: 200 ok
  req _destroy throws when called: read 4, end, the request: call _destroy; the client: 200 ok
  req @eofInProgress getter throws: the request: get @eofInProgress, the socket: get @eofInProgress; the client: ECONNRESET
  req @eofInProgress setter throws: uncaught set @eofInProgress, read 4, the request: set @eofInProgress, the socket: set @eofInProgress; the client: ECONNRESET
  req @eofInProgress read-only: uncaught TypeError, read 4, the request: TypeError, the socket: TypeError; the client: ECONNRESET
  req @handle setter throws: read 4, end, the request: set @handle; the client: 200 ok
  req @handle read-only: read 4, end, the request: TypeError; the client: 200 ok
  req @noBody getter throws: the request: get @noBody, the socket: get @noBody; the client: ECONNRESET
  socket resume getter throws: the request: get resume, the socket: get resume; the client: ECONNRESET
  socket resume a number: the request: TypeError, the socket: TypeError; the client: ECONNRESET
  socket resume throws when called: the request: call resume, the socket: call resume; the client: ECONNRESET
  socket readable getter throws: the request: get readable, the socket: get readable; the client: ECONNRESET
  socket readableLength getter throws: the request: get readableLength, the socket: get readableLength; the client: ECONNRESET
  socket readableHighWaterMark getter throws: the request: get readableHighWaterMark, the socket: get readableHighWaterMark; the client: ECONNRESET
  socket _paused getter throws: the request: get _paused, the socket: get _paused; the client: ECONNRESET
  socket parser getter throws: read 4, uncaught get parser, end, uncaught get parser, uncaught get parser; the client: 200 ok
  socket @kUpgradeIncoming getter throws: the request: get @kUpgradeIncoming, the socket: get @kUpgradeIncoming; the client: ECONNRESET
  socket @kUpgradeIncoming a number: the request: TypeError, the socket: TypeError; the client: ECONNRESET
  socket @kHandoffResponse getter throws: the request: get @kHandoffResponse, the socket: get @kHandoffResponse; the client: ECONNRESET
  socket @kStreamingEnabled getter throws: the request: get @kStreamingEnabled, the socket: get @kStreamingEnabled; the client: ECONNRESET
POST, readable, without 'error' listeners
  req _consuming getter throws: nothing; the client: ECONNRESET
  req _consuming setter throws: nothing; the client: ECONNRESET
  req _consuming read-only: nothing; the client: ECONNRESET
  req complete getter throws: read 4, end, uncaught get complete; the client: 200 ok
  req upgrade getter throws: nothing; the client: ECONNRESET
  req _read getter throws: nothing; the client: ECONNRESET
  req _read throws when called: nothing; the client: ECONNRESET
  req _destroy getter throws: read 4, end, uncaught get _destroy; the client: 200 ok
  req _destroy throws when called: read 4, end, uncaught call _destroy; the client: 200 ok
  req @eofInProgress getter throws: nothing; the client: ECONNRESET
  req @eofInProgress setter throws: uncaught set @eofInProgress, read 4; the client: ECONNRESET
  req @eofInProgress read-only: uncaught TypeError, read 4; the client: ECONNRESET
  req @handle setter throws: read 4, end, uncaught set @handle; the client: 200 ok
  req @handle read-only: read 4, end, uncaught TypeError; the client: 200 ok
  req @noBody getter throws: nothing; the client: ECONNRESET
  socket resume getter throws: nothing; the client: ECONNRESET
  socket resume a number: nothing; the client: ECONNRESET
  socket resume throws when called: nothing; the client: ECONNRESET
  socket readable getter throws: nothing; the client: ECONNRESET
  socket readableLength getter throws: nothing; the client: ECONNRESET
  socket readableHighWaterMark getter throws: nothing; the client: ECONNRESET
  socket _paused getter throws: nothing; the client: ECONNRESET
  socket parser getter throws: read 4, uncaught get parser, end, uncaught get parser, uncaught get parser; the client: 200 ok
  socket @kUpgradeIncoming getter throws: nothing; the client: ECONNRESET
  socket @kUpgradeIncoming a number: nothing; the client: ECONNRESET
  socket @kHandoffResponse getter throws: nothing; the client: ECONNRESET
  socket @kStreamingEnabled getter throws: nothing; the client: ECONNRESET
`,
    stderr: "",
    exitCode: 0,
  });
}, 60_000);
