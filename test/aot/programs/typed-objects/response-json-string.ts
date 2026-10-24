const long = "0123456789abcdef".repeat(5000);
const answer = Response.json("text \u4e2d \"q\"");
console.log(await answer.text(), answer.headers.get("content-type"));
function answerWith(text: string): Response {
  return Response.json(text);
}
console.log(await answerWith("by its type").text(), await answerWith("").text(), (await answerWith(long).text()).length);
