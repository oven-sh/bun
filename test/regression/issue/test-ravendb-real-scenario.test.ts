import { test, expect } from "bun:test";

test("RavenDB real scenario - request with compression", async () => {
  // Simulate a RavenDB-like server response
  const server = Bun.serve({
    port: 0,
    fetch: async (req) => {
      // Simulate a JSON response that gets compressed
      const responseData = {
        Results: [
          { id: "users/1", name: "John", email: "john@example.com" },
          { id: "users/2", name: "Jane", email: "jane@example.com" },
        ],
        TotalResults: 2,
        SkippedResults: 0,
        DurationInMs: 42
      };
      
      // Compress the response as RavenDB would
      const jsonStr = JSON.stringify(responseData);
      const compressed = Bun.gzipSync(jsonStr);
      
      return new Response(compressed, {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Encoding': 'gzip',
          'Server': 'RavenDB',
          // Include Content-Length as RavenDB would
          'Content-Length': compressed.length.toString(),
        }
      });
    }
  });

  try {
    // Make a fetch request similar to how @ravendb npm package would
    const response = await fetch(`http://localhost:${server.port}/databases/test/indexes/Users/query`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip, deflate, br',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        Query: "from Users",
        Start: 0,
        PageSize: 128
      })
    });

    expect(response.ok).toBe(true);
    expect(response.headers.get('content-encoding')).toBe('gzip');
    
    const data = await response.json();
    expect(data.Results).toHaveLength(2);
    expect(data.TotalResults).toBe(2);
    expect(data.Results[0].name).toBe("John");
    
    console.log("RavenDB-like scenario works correctly");
  } catch (err: any) {
    if (err.message?.includes("ShortRead")) {
      console.error("ShortRead error encountered - this is the bug");
      throw new Error(`RavenDB ShortRead bug reproduced: ${err.message}`);
    }
    throw err;
  } finally {
    server.stop();
  }
});