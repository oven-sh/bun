import { Suspense } from "react";
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it } from "bun:test";

if (!import.meta.resolveSync("react-dom/server").endsWith("server.bun.js")) {
  throw new Error("react-dom/server is not the correct version:\n  " + import.meta.resolveSync("react-dom/server"));
}

describe("ReactDOM", () => {
  it("should properly chunk Suspense boundaries", async () => {
    const A = async () => {
      await new Promise(resolve => setImmediate(resolve));
      return <div>hi</div>;
    };

    const B = async () => {
      return (
        // @ts-ignore
        <Suspense fallback={<div>loading</div>}>
          {/* @ts-ignore */}
          <A />
        </Suspense>
      );
    };
    // @ts-ignore
    const stream = await renderToReadableStream(<B />);

    let text = "";
    let numChunks = 0;
    for await (const chunk of stream) {
      text += new TextDecoder().decode(chunk);
      numChunks++;
    }

    expect(text).toBe(
      `<!--$?--><template id="B:0"></template><div>loading</div><!--/$--><div hidden id="S:0"><div>hi</div></div><script>$RC=function(b,c,e){c=document.getElementById(c);c.parentNode.removeChild(c);var a=document.getElementById(b);if(a){b=a.previousSibling;if(e)b.data="$!",a.setAttribute("data-dgst",e);else{e=b.parentNode;a=b.nextSibling;var f=0;do{if(a&&8===a.nodeType){var d=a.data;if("/$"===d)if(0===f)break;else f--;else"$"!==d&&"$?"!==d&&"$!"!==d||f++}d=a.nextSibling;e.removeChild(a);a=d}while(a);for(;c.firstChild;)e.insertBefore(c.firstChild,a);b.data="$"}b._reactRetry&&b._reactRetry()}};$RC("B:0","S:0")</script>`,
    );
    expect(numChunks).toBeGreaterThan(1);
  });
});
const A = async () => {
  await new Promise(resolve => setImmediate(resolve));
  return <div>hi</div>;
};

const B = async () => {
  return (
    // @ts-ignore
    <Suspense fallback={<div>loading</div>}>
      {/* @ts-ignore */}
      <A />
    </Suspense>
  );
};
