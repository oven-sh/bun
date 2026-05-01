// https://github.com/uNetworking/h1spec
// https://github.com/oven-sh/bun/issues/14826
// Thanks to Alex Hultman
import net from "net";

// Define test cases
interface TestCase {
  request: string;
  description: string;
  expectedStatus: [number, number][];
  expectedTimeout?: boolean;
}

const testCases: TestCase[] = [
  {
    request: "G",
    description: "Fragmented method",
    expectedStatus: [[-1, -1]],
    expectedTimeout: true,
  },
  {
    request: "GET ",
    description: "Fragmented URL 1",
    expectedStatus: [[-1, -1]],
    expectedTimeout: true,
  },
  {
    request: "GET /hello",
    description: "Fragmented URL 2",
    expectedStatus: [[-1, -1]],
    expectedTimeout: true,
  },
  {
    request: "GET /hello ",
    description: "Fragmented URL 3",
    expectedStatus: [[-1, -1]],
    expectedTimeout: true,
  },
  {
    request: "GET /hello HTTP",
    description: "Fragmented HTTP version",
    expectedStatus: [[-1, -1]],
    expectedTimeout: true,
  },
  {
    request: "GET /hello HTTP/1.1",
    description: "Fragmented request line",
    expectedStatus: [[-1, -1]],
    expectedTimeout: true,
  },
  {
    request: "GET /hello HTTP/1.1\r",
    description: "Fragmented request line newline 1",
    expectedStatus: [[-1, -1]],
    expectedTimeout: true,
  },
  {
    request: "GET /hello HTTP/1.1\r\n",
    description: "Fragmented request line newline 2",
    expectedStatus: [[-1, -1]],
    expectedTimeout: true,
  },
  {
    request: "GET /hello HTTP/1.1\r\nHos",
    description: "Fragmented field name",
    expectedStatus: [[-1, -1]],
    expectedTimeout: true,
  },
  {
    request: "GET /hello HTTP/1.1\r\nHost:",
    description: "Fragmented field value 1",
    expectedStatus: [[-1, -1]],
    expectedTimeout: true,
  },
  {
    request: "GET /hello HTTP/1.1\r\nHost: ",
    description: "Fragmented field value 2",
    expectedStatus: [[-1, -1]],
    expectedTimeout: true,
  },
  {
    request: "GET /hello HTTP/1.1\r\nHost: localhost",
    description: "Fragmented field value 3",
    expectedStatus: [[-1, -1]],
    expectedTimeout: true,
  },
  {
    request: "GET /hello HTTP/1.1\r\nHost: localhost\r",
    description: "Fragmented field value 4",
    expectedStatus: [[-1, -1]],
    expectedTimeout: true,
  },
  {
    request: "GET /hello HTTP/1.1\r\nHost: localhost\r\n",
    description: "Fragmented request",
    expectedStatus: [[-1, -1]],
    expectedTimeout: true,
  },
  {
    request: "GET /hello HTTP/1.1\r\nHost: localhost\r\n\r",
    description: "Fragmented request termination",
    expectedStatus: [[-1, -1]],
    expectedTimeout: true,
  },
  {
    request: "GET / \r\n\r\n",
    description: "Request without HTTP version",
    expectedStatus: [[400, 599]],
  },
  {
    request: "GET / HTTP/1.1\r\nHost: example.com\r\nExpect: 100-continue\r\n\r\n",
    description: "Request with Expect header",
    expectedStatus: [
      [100, 100],
      [200, 299],
    ],
  },
  {
    request: "GET / HTTP/1.1\r\nHost: example.com\r\n\r\n",
    description: "Valid GET request",
    expectedStatus: [[200, 299]],
  },
  {
    request: "GET / HTTP/1.0\r\nHost: example.com\r\n\r\n",
    description: "Valid GET request with HTTP/1.0",
    expectedStatus: [[200, 299]],
  },
  {
    request: "GET http://example.com/ HTTP/1.1\r\nHost: example.com\r\n\r\n",
    description: "Valid GET request for a proxy URL",
    expectedStatus: [[200, 299]],
  },
  {
    request: "GET https://example.com/ HTTP/1.1\r\nHost: example.com\r\n\r\n",
    description: "Valid GET request for an https proxy URL",
    expectedStatus: [[200, 299]],
  },
  {
    request: "GET HTTPS://example.com/ HTTP/1.1\r\nHost: example.com\r\n\r\n",
    description: "Valid GET request for an HTTPS proxy URL",
    expectedStatus: [[200, 299]],
  },
  {
    request: "GET HTTPZ://example.com/ HTTP/1.1\r\nHost: example.com\r\n\r\n",
    description: "Invalid GET request for an HTTPS proxy URL",
    expectedStatus: [[400, 499]],
  },
  {
    request: "GET H-TTP://example.com/ HTTP/1.1\r\nHost: example.com\r\n\r\n",
    description: "Invalid GET request for an HTTPS proxy URL",
    expectedStatus: [[400, 499]],
  },
  {
    request: "GET HTTP://example.com/ HTTP/1.1\r\nHost: example.com\r\n\r\n",
    description: "Valid GET request for an HTTP proxy URL",
    expectedStatus: [[200, 299]],
  },
  {
    request: "GET   HTTP/1.1\r\nHost: example.com\r\n\r\n",
    description: "Invalid GET request target (space)",
    expectedStatus: [[400, 499]],
  },
  {
    request: "GET ^ HTTP/1.1\r\nHost: example.com\r\n\r\n",
    description: "Invalid GET request target (caret)",
    expectedStatus: [[400, 499]],
  },
  {
    request: "GET / HTTP/1.1\r\nhoSt:\texample.com\r\nempty:\r\n\r\n",
    description: "Valid GET request with edge cases",
    expectedStatus: [[200, 299]],
  },
  {
    request: "GET / HTTP/1.1\r\nHost: example.com\r\nX-Invalid[]: test\r\n\r\n",
    description: "Invalid header characters",
    expectedStatus: [[400, 499]],
  },
  {
    request: "GET / HTTP/1.1\r\nContent-Length: 5\r\n\r\n",
    description: "Missing Host header",
    expectedStatus: [[400, 499]],
  },
  {
    request: "GET / HTTP/1.1\r\nHost: example.com\r\nContent-Length: -123456789123456789123456789\r\n\r\n",
    description: "Overflowing negative Content-Length header",
    expectedStatus: [[400, 499]],
  },
  {
    request: "GET / HTTP/1.1\r\nHost: example.com\r\nContent-Length: -1234\r\n\r\n",
    description: "Negative Content-Length header",
    expectedStatus: [[400, 499]],
  },
  {
    request: "GET / HTTP/1.1\r\nHost: example.com\r\nContent-Length: abc\r\n\r\n",
    description: "Non-numeric Content-Length header",
    expectedStatus: [[400, 499]],
  },
  {
    request: "GET / HTTP/1.1\r\nHost: example.com\r\nX-Empty-Header: \r\n\r\n",
    description: "Empty header value",
    expectedStatus: [[200, 299]],
  },
  {
    request: "GET / HTTP/1.1\r\nHost: example.com\r\nX-Bad-Control-Char: test\x07\r\n\r\n",
    description: "Header containing invalid control character",
    expectedStatus: [[400, 499]],
  },
  {
    request: "GET / HTTP/9.9\r\nHost: example.com\r\n\r\n",
    description: "Invalid HTTP version",
    expectedStatus: [
      [400, 499],
      [500, 599],
    ],
  },
  {
    request: "Extra lineGET / HTTP/1.1\r\nHost: example.com\r\n\r\n",
    description: "Invalid prefix of request",
    expectedStatus: [
      [400, 499],
      [500, 599],
    ],
  },
  {
    request: "GET / HTTP/1.1\r\nHost: example.com\r\n\rSome-Header: Test\r\n\r\n",
    description: "Invalid line ending",
    expectedStatus: [[400, 499]],
  },
  {
    request: "POST / HTTP/1.1\r\nHost: example.com\r\nContent-Length: 5\r\n\r\nhello",
    description: "Valid POST request with body",
    expectedStatus: [
      [200, 299],
      [404, 404],
    ],
  },
  {
    request: "GET / HTTP/1.1\r\nHost: example.com\r\nTransfer-Encoding: chunked\r\nContent-Length: 5\r\n\r\n",
    description: "Conflicting Transfer-Encoding and Content-Length",
    expectedStatus: [[400, 499]],
  },
];

export async function runTestsStandalone(host: string, port: number) {
  const results = await Promise.all(testCases.map(testCase => runTestCase(testCase, host, parseInt(port, 10))));

  const passedCount = results.filter(result => result).length;
  console.log(`\n${passedCount} out of ${testCases.length} tests passed.`);
  return passedCount === testCases.length;
}

// Run all test cases in parallel
export async function runTests() {
  let host, port;

  using server = Bun.serve({
    port: 0,
    fetch(req) {
      return new Response("Hello, world!");
    },
  });

  host = server.url.hostname;
  port = server.url.port;
  return await runTestsStandalone(host, port);
}

// Run a single test case with a 3-second timeout on reading
async function runTestCase(testCase: TestCase, host: string, port: number): Promise<boolean> {
  try {
    const conn = new Promise((resolve, reject) => {
      const client = net.createConnection({ host, port }, () => {
        resolve(client);
      });
      client.on("error", reject);
    });

    const client: net.Socket = await conn;

    // Send the request
    client.write(Buffer.from(testCase.request));

    // Set up a read timeout promise
    const readTimeout = new Promise<boolean>(resolve => {
      const timeoutId = setTimeout(() => {
        if (testCase.expectedTimeout) {
          console.log(`✅ ${testCase.description}: Server waited successfully`);
          client.destroy(); // Ensure the connection is closed on timeout
          resolve(true);
        } else {
          console.error(`❌ ${testCase.description}: Read operation timed out`);
          client.destroy(); // Ensure the connection is closed on timeout
          resolve(false);
        }
      }, 500);

      client.on("data", data => {
        // Clear the timeout if read completes
        clearTimeout(timeoutId);
        const response = data.toString();
        const statusCode = parseStatusCode(response);

        const isSuccess = testCase.expectedStatus.some(([min, max]) => statusCode >= min && statusCode <= max);
        if (!isSuccess) {
          console.log(JSON.stringify(response, null, 2));
        }
        console.log(
          `${isSuccess ? "✅" : "❌"} ${
            testCase.description
          }: Response Status Code ${statusCode}, Expected ranges: ${JSON.stringify(testCase.expectedStatus)}`,
        );
        client.destroy();
        resolve(isSuccess);
      });

      client.on("error", error => {
        clearTimeout(timeoutId);
        console.error(`Error in test "${testCase.description}":`, error);
        resolve(false);
      });
    });

    // Wait for the read operation or timeout
    return await readTimeout;
  } catch (error) {
    console.error(`Error in test "${testCase.description}":`, error);
    return false;
  }
}

// Parse the HTTP status code from the response
function parseStatusCode(response: string): number {
  const statusLine = response.split("\r\n")[0];
  const match = statusLine.match(/HTTP\/1\.\d (\d{3})/);
  return match ? parseInt(match[1], 10) : 0;
}

if (import.meta.main) {
  if (process.argv.length > 2) {
    await runTestsStandalone(process.argv[2], parseInt(process.argv[3], 10));
  } else {
    await runTests();
  }
}
