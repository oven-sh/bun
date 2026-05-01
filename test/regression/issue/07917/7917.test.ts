test("boundary does not have quotes (#7917)", async () => {
  // for `content-type: multipart/form-data; boundary=...` / https://datatracker.ietf.org/doc/html/rfc2046#section-5.1
  // the spec states that the boundary parameter accepts quotes, and both node and bun accept quotes when parsing
  // the form data. however, some websites do not accept quotes and node does not quote it. this test ensures that the
  // boundary is not quoted.

  const form = new FormData();
  form.append("filename[]", "document.tex");
  form.append("filecontents[]", "\\documentclass{article}\\begin{document}Hello world\\end{document}");
  form.append("return", "pdf");
  const req = new Request("http://localhost:35411", {
    method: "POST",
    body: form,
  });
  const content_type = req.headers.get("content-type");
  const val = await req.text();
  const actual_boundary = val.split("\r")[0].slice(2);
  expect(content_type).toEqual(`multipart/form-data; boundary=${actual_boundary}`);
});
