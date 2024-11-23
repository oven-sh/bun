// This is a test app for:
// - TestReporter.enable
// - TestReporter.found
// - TestReporter.start
// - TestReporter.end
// - Console.messageAdded
// - LifecycleReporter.enable
// - LifecycleReporter.error

const debug = false;
import { listen, type Socket } from "bun";

import { SocketFramer } from "./socket-framer.ts";
import type { JSC } from "../../../packages/bun-inspector-protocol/src/protocol/jsc";

interface Message {
  id?: number;
  method?: string;
  params?: any;
  result?: any;
}

export class InspectorSession {
  private messageCallbacks: Map<number, (result: any) => void>;
  private eventListeners: Map<string, ((params: any) => void)[]>;
  private nextId: number;
  framer?: SocketFramer;
  socket?: Socket<{ onData: (socket: Socket<any>, data: Buffer) => void }>;

  constructor() {
    this.messageCallbacks = new Map();
    this.eventListeners = new Map();
    this.nextId = 1;
  }

  onMessage(data: string) {
    if (debug) console.log(data);
    const message: Message = JSON.parse(data);

    if (message.id && this.messageCallbacks.has(message.id)) {
      const callback = this.messageCallbacks.get(message.id)!;
      callback(message.result);
      this.messageCallbacks.delete(message.id);
    } else if (message.method && this.eventListeners.has(message.method)) {
      if (debug) console.log("event", message.method, message.params);
      const listeners = this.eventListeners.get(message.method)!;
      for (const listener of listeners) {
        listener(message.params);
      }
    }
  }

  send(method: string, params: any = {}) {
    if (!this.framer) throw new Error("Socket not connected");
    const id = this.nextId++;
    const message = { id, method, params };
    this.framer.send(this.socket as any, JSON.stringify(message));
  }

  addEventListener(method: string, callback: (params: any) => void) {
    if (!this.eventListeners.has(method)) {
      this.eventListeners.set(method, []);
    }
    this.eventListeners.get(method)!.push(callback);
  }
}

interface JUnitTestCase {
  name: string;
  classname: string;
  time: number;
  failure?: {
    message: string;
    type: string;
    content: string;
  };
  systemOut?: string;
  systemErr?: string;
}

interface JUnitTestSuite {
  name: string;
  tests: number;
  failures: number;
  errors: number;
  skipped: number;
  time: number;
  timestamp: string;
  testCases: JUnitTestCase[];
}

interface TestInfo {
  id: number;
  name: string;
  file: string;
  startTime?: number;
  stdout: string[];
  stderr: string[];
}

export class JUnitReporter {
  private session: InspectorSession;
  testSuites: Map<string, JUnitTestSuite>;
  private tests: Map<number, TestInfo>;
  private currentTest: TestInfo | null = null;

  constructor(session: InspectorSession) {
    this.session = session;
    this.testSuites = new Map();
    this.tests = new Map();

    this.enableDomains();
    this.setupEventListeners();
  }

  private async enableDomains() {
    this.session.send("Inspector.enable");
    this.session.send("TestReporter.enable");
    this.session.send("LifecycleReporter.enable");
    this.session.send("Console.enable");
    this.session.send("Runtime.enable");
  }

  private setupEventListeners() {
    this.session.addEventListener("TestReporter.found", this.handleTestFound.bind(this));
    this.session.addEventListener("TestReporter.start", this.handleTestStart.bind(this));
    this.session.addEventListener("TestReporter.end", this.handleTestEnd.bind(this));
    this.session.addEventListener("Console.messageAdded", this.handleConsoleMessage.bind(this));
    this.session.addEventListener("LifecycleReporter.error", this.handleException.bind(this));
  }

  private getOrCreateTestSuite(file: string): JUnitTestSuite {
    if (!this.testSuites.has(file)) {
      this.testSuites.set(file, {
        name: file,
        tests: 0,
        failures: 0,
        errors: 0,
        skipped: 0,
        time: 0,
        timestamp: new Date().toISOString(),
        testCases: [],
      });
    }
    return this.testSuites.get(file)!;
  }

  private handleTestFound(params: JSC.TestReporter.FoundEvent) {
    const file = params.url || "unknown";
    const suite = this.getOrCreateTestSuite(file);
    suite.tests++;

    const test: TestInfo = {
      id: params.id,
      name: params.name || `Test ${params.id}`,
      file,
      stdout: [],
      stderr: [],
    };
    this.tests.set(params.id, test);
  }

  private handleTestStart(params: JSC.TestReporter.StartEvent) {
    const test = this.tests.get(params.id);
    if (test) {
      test.startTime = Date.now();
      this.currentTest = test;
    }
  }

  private handleTestEnd(params: JSC.TestReporter.EndEvent) {
    const test = this.tests.get(params.id);
    if (!test || !test.startTime) return;

    const suite = this.getOrCreateTestSuite(test.file);
    const testCase: JUnitTestCase = {
      name: test.name,
      classname: test.file,
      time: (Date.now() - test.startTime) / 1000,
    };

    if (test.stdout.length > 0) {
      testCase.systemOut = test.stdout.join("\n");
    }

    if (params.status === "fail") {
      suite.failures++;
      testCase.failure = {
        message: "Test failed",
        type: "AssertionError",
        content: test.stderr.join("\n") || "No error details available",
      };
      test.stderr = [];
    } else if (params.status === "skip" || params.status === "todo") {
      suite.skipped++;
    }

    if (test.stderr.length > 0) {
      testCase.systemErr = test.stderr.join("\n");
    }

    suite.testCases.push(testCase);
    this.currentTest = null;
  }

  private handleConsoleMessage(params: any) {
    if (!this.currentTest) return;

    const message = params.message;
    const text = message.text || "";

    if (message.level === "error" || message.level === "warning") {
      this.currentTest.stderr.push(text);
    } else {
      this.currentTest.stdout.push(text);
    }
  }

  private handleException(params: JSC.LifecycleReporter.ErrorEvent) {
    if (!this.currentTest) return;

    const error = params;
    let stackTrace = "";
    for (let i = 0; i < error.urls.length; i++) {
      let url = error.urls[i];
      let line = Number(error.lineColumns[i * 2]);
      let column = Number(error.lineColumns[i * 2 + 1]);

      if (column > 0 && line > 0) {
        stackTrace += `  at ${url}:${line}:${column}\n`;
      } else if (line > 0) {
        stackTrace += `  at ${url}:${line}\n`;
      } else {
        stackTrace += `  at ${url}\n`;
      }
    }

    this.currentTest.stderr.push(`${error.name || "Error"}: ${error.message || "Unknown error"}`, "");
    if (stackTrace) {
      this.currentTest.stderr.push(stackTrace);
      this.currentTest.stderr.push("");
    }
  }

  generateReport(): string {
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += "<testsuites>\n";

    for (const suite of this.testSuites.values()) {
      xml += `  <testsuite name="${escapeXml(suite.name)}" `;
      xml += `tests="${suite.tests}" `;
      xml += `failures="${suite.failures}" `;
      xml += `errors="${suite.errors}" `;
      xml += `skipped="${suite.skipped}" `;

      xml += `timestamp="${suite.timestamp}">\n`;

      for (const testCase of suite.testCases) {
        xml += `    <testcase classname="${escapeXml(testCase.classname)}" `;
        xml += `name="${escapeXml(testCase.name)}" `;

        if (testCase.failure) {
          xml += `      <failure message="${escapeXml(testCase.failure.message)}" `;
          xml += `type="${escapeXml(testCase.failure.type)}">\n`;
          xml += `        ${escapeXml(testCase.failure.content)}\n`;
          xml += "      </failure>\n";
        }

        if (testCase.systemOut) {
          xml += `      <system-out>${escapeXml(testCase.systemOut)}</system-out>\n`;
        }

        if (testCase.systemErr) {
          xml += `      <system-err>${escapeXml(testCase.systemErr)}</system-err>\n`;
        }

        xml += "    </testcase>\n";
      }

      xml += "  </testsuite>\n";
    }

    xml += "</testsuites>";
    return xml;
  }
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export async function connect(
  address: string,
  onClose?: () => void,
): Promise<Socket<{ onData: (socket: Socket<any>, data: Buffer) => void }>> {
  const { promise, resolve } = Promise.withResolvers<Socket<{ onData: (socket: Socket<any>, data: Buffer) => void }>>();

  var listener = listen<{ onData: (socket: Socket<any>, data: Buffer) => void }>({
    unix: address.slice("unix://".length),
    socket: {
      open: socket => {
        listener.stop();
        socket.ref();
        resolve(socket);
      },
      data(socket, data: Buffer) {
        socket.data?.onData(socket, data);
      },
      error(socket, error) {
        console.error(error);
      },
      close(socket) {
        if (onClose) {
          onClose();
        }
      },
    },
  });

  return await promise;
}

if (import.meta.main) {
  // Main execution
  const address = process.argv[2];
  if (!address) {
    throw new Error("Please provide the inspector address as an argument");
  }

  let reporter: JUnitReporter;
  let session: InspectorSession;

  const socket = await connect(address);
  const framer = new SocketFramer((message: string) => {
    session.onMessage(message);
  });

  session = new InspectorSession();
  session.socket = socket;
  session.framer = framer;
  socket.data = {
    onData: framer.onData.bind(framer),
  };

  reporter = new JUnitReporter(session);

  // Handle process exit
  process.on("exit", () => {
    if (reporter) {
      const report = reporter.generateReport();
      console.log(report);
    }
  });
}
