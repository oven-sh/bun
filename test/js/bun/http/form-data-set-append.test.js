import { expect, test } from "bun:test";

// https://github.com/oven-sh/bun/issues/12325

test("formdata set with File works as expected", async () => {
  const expected = ["617580375", "text-notes1.txt"];

  using server = Bun.serve({
    port: 0,
    fetch: async req => {
      const data = await req.formData();
      const chat_id = data.get("chat_id");
      const document = data.get("document");
      expect(chat_id).toEqual(expected[0]);
      expect(document.name).toEqual(expected[1]);
      return new Response("");
    },
  });

  async function sendDocument(body) {
    const response = await fetch(server.url, {
      method: "POST",
      body: body,
    });
    const text = await response.text();
    return text;
  }

  const formDataSet = new FormData();
  formDataSet.set("chat_id", expected[0]);
  formDataSet.set("document", new File(["some text notes 1"], expected[1]));
  await sendDocument(formDataSet);
});

test("formdata apppend with File works as expected", async () => {
  const expected = ["617580376", "text-notes2.txt"];

  using server = Bun.serve({
    port: 0,
    fetch: async req => {
      const data = await req.formData();
      const chat_id = data.get("chat_id");
      const document = data.get("document");
      expect(chat_id).toEqual(expected[0]);
      expect(document.name).toEqual(expected[1]);
      return new Response("");
    },
  });

  async function sendDocument(body) {
    const response = await fetch(server.url, {
      method: "POST",
      body: body,
    });
    const text = await response.text();
    return text;
  }

  const formDataSet = new FormData();
  formDataSet.append("chat_id", expected[0]);
  formDataSet.append("document", new File(["some text notes 2"], expected[1]));
  await sendDocument(formDataSet);
});
