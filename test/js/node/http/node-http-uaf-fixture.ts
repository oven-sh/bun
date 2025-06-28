import express from "express";
import bodyParser from "body-parser";

import { setTimeout as sleep } from "node:timers/promises";

const CONCURRENCY = 100;

const app = express();
app.use(bodyParser.json());

app.post("/error", (req, res) => {
  try {
    // This specific pattern causes the segfault in Bun v1.2.6
    const headers = { location: undefined };
    headers.location.split("*/")["2"].split(")")["0"];
  } catch (err) {
    setTimeout(() => res.status(500).json({ error: err.message }), 1);
  }
});

var server = app.listen(0, async () => {
  const port = server.address().port;
  console.log(`Server running on http://localhost:${port}`);

  const active = new Set();

  async function makeRequest(id) {
    const controller = new AbortController();

    const secondPromise = setTimeout(() => controller.abort(), Math.random() * 5 + 1);

    try {
      await fetch(`http://localhost:${port}/error`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        signal: controller.signal,
      }).catch(() => {});
    } catch (e) {}

    try {
      await secondPromise;
    } catch (e) {}

    active.delete(id);
  }

  console.log(`Starting concurrent requests...`);
  for (let i = 0; i < 10000; i++) {
    while (active.size >= CONCURRENCY) {
      await sleep(1);
    }

    active.add(i);
    makeRequest(i);
    if (i > 0 && i % 1000 === 0) {
      console.count("Completed request x 1000");
    }
  }

  console.log("Done");
  server.close();
});
