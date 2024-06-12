import { test, expect } from "bun:test";

test("blob: imports have sourcemapped stacktraces", async () => {
  const blob = new Blob(
    [
      `
    export function uhOh(very: any): boolean {
      return Bun.inspect(new Error());  
    }
  `,
    ],
    { type: "application/typescript" },
  );

  const url = URL.createObjectURL(blob);
  expect(url).toStartWith("blob:");
  const { uhOh } = await import(url);
  expect(uhOh()).toContain(`uhOh(very: any): boolean`);
  URL.revokeObjectURL(url);
});

test("Blob.slice", async () => {
  const blob = new Blob(["Bun", "Foo"]);
  const b1 = blob.slice(0, 3, "Text/HTML");
  expect(b1 instanceof Blob).toBeTruthy();
  expect(b1.size).toBe(3);
  expect(b1.type).toBe("text/html");
  const b2 = blob.slice(-1, 3);
  expect(b2.size).toBe(0);
  const b3 = blob.slice(100, 3);
  expect(b3.size).toBe(0);
  const b4 = blob.slice(0, 10);
  expect(b4.size).toBe(blob.size);

  expect(blob.slice().size).toBe(blob.size);
  expect(blob.slice(0).size).toBe(blob.size);
  expect(blob.slice(NaN).size).toBe(blob.size);
  expect(blob.slice(0, Infinity).size).toBe(blob.size);
  expect(blob.slice(-Infinity).size).toBe(blob.size);
  expect(blob.slice(0, NaN).size).toBe(0);
  // @ts-expect-error
  expect(blob.slice(Symbol(), "-123").size).toBe(6);
  expect(blob.slice(Object.create(null), "-123").size).toBe(6);
  // @ts-expect-error
  expect(blob.slice(null, "-123").size).toBe(6);
  expect(blob.slice(0, 10).size).toBe(blob.size);
  expect(blob.slice("text/plain;charset=utf-8").type).toBe("text/plain;charset=utf-8");

  // test Blob.slice().slice(), issue#6252
  expect(await blob.slice(0, 4).slice(0, 3).text()).toBe("Bun");
  expect(await blob.slice(0, 4).slice(1, 3).text()).toBe("un");
  expect(await blob.slice(1, 4).slice(0, 3).text()).toBe("unF");
  expect(await blob.slice(1, 4).slice(1, 3).text()).toBe("nF");
  expect(await blob.slice(1, 4).slice(2, 3).text()).toBe("F");
  expect(await blob.slice(1, 4).slice(3, 3).text()).toBe("");
  expect(await blob.slice(1, 4).slice(4, 3).text()).toBe("");
  // test negative start
  expect(await blob.slice(1, 4).slice(-1, 3).text()).toBe("F");
  expect(await blob.slice(1, 4).slice(-2, 3).text()).toBe("nF");
  expect(await blob.slice(1, 4).slice(-3, 3).text()).toBe("unF");
  expect(await blob.slice(1, 4).slice(-4, 3).text()).toBe("unF");
  expect(await blob.slice(1, 4).slice(-5, 3).text()).toBe("unF");
  expect(await blob.slice(-1, 4).slice(-1, 3).text()).toBe("");
  expect(await blob.slice(-2, 4).slice(-1, 3).text()).toBe("");
  expect(await blob.slice(-3, 4).slice(-1, 3).text()).toBe("F");
  expect(await blob.slice(-4, 4).slice(-1, 3).text()).toBe("F");
  expect(await blob.slice(-5, 4).slice(-1, 3).text()).toBe("F");
  expect(await blob.slice(-5, 4).slice(-2, 3).text()).toBe("nF");
  expect(await blob.slice(-5, 4).slice(-3, 3).text()).toBe("unF");
  expect(await blob.slice(-5, 4).slice(-4, 3).text()).toBe("unF");
  expect(await blob.slice(-4, 4).slice(-3, 3).text()).toBe("nF");
  expect(await blob.slice(-5, 4).slice(-4, 3).text()).toBe("unF");
  expect(await blob.slice(-3, 4).slice(-2, 3).text()).toBe("F");
  expect(await blob.slice(-blob.size, 4).slice(-blob.size, 3).text()).toBe("Bun");
});

test("new Blob", () => {
  var blob = new Blob(["Bun", "Foo"], { type: "text/foo" });
  expect(blob.size).toBe(6);
  expect(blob.type).toBe("text/foo");

  blob = new Blob(["Bun", "Foo"], { type: "\u1234" });
  expect(blob.size).toBe(6);
  expect(blob.type).toBe("");
});

test("blob: can be fetched", async () => {
  const blob = new Blob(["Bun", "Foo"]);
  const url = URL.createObjectURL(blob);
  expect(url).toStartWith("blob:");
  expect(await fetch(url).then(r => r.text())).toBe("BunFoo");
  URL.revokeObjectURL(url);
  expect(async () => {
    await fetch(url);
  }).toThrow();
});

test("blob: URL has Content-Type", async () => {
  const blob = new File(["Bun", "Foo"], "file.txt", { type: "text/javascript;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  expect(url).toStartWith("blob:");
  const resp = await fetch(url);
  expect(resp.headers.get("Content-Type")).toBe("text/javascript;charset=utf-8");
  URL.revokeObjectURL(url);
  expect(async () => {
    await fetch(url);
  }).toThrow();
});

test("blob: can be imported", async () => {
  const blob = new Blob(
    [
      `
    export function supportsTypescript(): boolean {
      return true;
    }
  `,
    ],
    { type: "application/typescript" },
  );

  const url = URL.createObjectURL(blob);
  expect(url).toStartWith("blob:");
  const { supportsTypescript } = await import(url);
  expect(supportsTypescript()).toBe(true);
  URL.revokeObjectURL(url);
  expect(async () => {
    await import(url);
  }).toThrow();
});

test("blob: can realiable get type from fetch #10072", async () => {
  using server = Bun.serve({
    fetch() {
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(Buffer.from("Hello"));
          },
          async pull(controller) {
            await Bun.sleep(100);
            controller.enqueue(Buffer.from("World"));
            await Bun.sleep(100);
            controller.close();
          },
        }),
        {
          headers: {
            "Content-Type": "plain/text",
          },
        },
      );
    },
  });

  const blob = await fetch(server.url).then(res => res.blob());
  expect(blob.type).toBe("plain/text");
});

test("blob: can set name property #10178", () => {
  const blob = new Blob([Buffer.from("Hello, World")]);
  //@ts-ignore
  expect(blob.name).toBeUndefined();
  //@ts-ignore
  blob.name = "logo.svg";
  //@ts-ignore
  expect(blob.name).toBe("logo.svg");
});
