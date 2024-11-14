//#FILE: test-zlib-dictionary.js
//#SHA1: b5fc5a33125dfeaa9965b0564a8196b056b95918
//-----------------
"use strict";

const zlib = require("zlib");

const spdyDict = Buffer.from(
  [
    "optionsgetheadpostputdeletetraceacceptaccept-charsetaccept-encodingaccept-",
    "languageauthorizationexpectfromhostif-modified-sinceif-matchif-none-matchi",
    "f-rangeif-unmodifiedsincemax-forwardsproxy-authorizationrangerefererteuser",
    "-agent10010120020120220320420520630030130230330430530630740040140240340440",
    "5406407408409410411412413414415416417500501502503504505accept-rangesageeta",
    "glocationproxy-authenticatepublicretry-afterservervarywarningwww-authentic",
    "ateallowcontent-basecontent-encodingcache-controlconnectiondatetrailertran",
    "sfer-encodingupgradeviawarningcontent-languagecontent-lengthcontent-locati",
    "oncontent-md5content-rangecontent-typeetagexpireslast-modifiedset-cookieMo",
    "ndayTuesdayWednesdayThursdayFridaySaturdaySundayJanFebMarAprMayJunJulAugSe",
    "pOctNovDecchunkedtext/htmlimage/pngimage/jpgimage/gifapplication/xmlapplic",
    "ation/xhtmltext/plainpublicmax-agecharset=iso-8859-1utf-8gzipdeflateHTTP/1",
    ".1statusversionurl\0",
  ].join(""),
);

const input = ["HTTP/1.1 200 Ok", "Server: node.js", "Content-Length: 0", ""].join("\r\n");

function basicDictionaryTest(spdyDict) {
  return new Promise(resolve => {
    let output = "";
    const deflate = zlib.createDeflate({ dictionary: spdyDict });
    const inflate = zlib.createInflate({ dictionary: spdyDict });
    inflate.setEncoding("utf-8");

    deflate.on("data", chunk => {
      inflate.write(chunk);
    });

    inflate.on("data", chunk => {
      output += chunk;
    });

    deflate.on("end", () => {
      inflate.end();
    });

    inflate.on("end", () => {
      expect(output).toBe(input);
      resolve();
    });

    deflate.write(input);
    deflate.end();
  });
}

function deflateResetDictionaryTest(spdyDict) {
  return new Promise(resolve => {
    let doneReset = false;
    let output = "";
    const deflate = zlib.createDeflate({ dictionary: spdyDict });
    const inflate = zlib.createInflate({ dictionary: spdyDict });
    inflate.setEncoding("utf-8");

    deflate.on("data", chunk => {
      if (doneReset) inflate.write(chunk);
    });

    inflate.on("data", chunk => {
      output += chunk;
    });

    deflate.on("end", () => {
      inflate.end();
    });

    inflate.on("end", () => {
      expect(output).toBe(input);
      resolve();
    });

    deflate.write(input);
    deflate.flush(() => {
      deflate.reset();
      doneReset = true;
      deflate.write(input);
      deflate.end();
    });
  });
}

function rawDictionaryTest(spdyDict) {
  return new Promise(resolve => {
    let output = "";
    const deflate = zlib.createDeflateRaw({ dictionary: spdyDict });
    const inflate = zlib.createInflateRaw({ dictionary: spdyDict });
    inflate.setEncoding("utf-8");

    deflate.on("data", chunk => {
      inflate.write(chunk);
    });

    inflate.on("data", chunk => {
      output += chunk;
    });

    deflate.on("end", () => {
      inflate.end();
    });

    inflate.on("end", () => {
      expect(output).toBe(input);
      resolve();
    });

    deflate.write(input);
    deflate.end();
  });
}

function deflateRawResetDictionaryTest(spdyDict) {
  return new Promise(resolve => {
    let doneReset = false;
    let output = "";
    const deflate = zlib.createDeflateRaw({ dictionary: spdyDict });
    const inflate = zlib.createInflateRaw({ dictionary: spdyDict });
    inflate.setEncoding("utf-8");

    deflate.on("data", chunk => {
      if (doneReset) inflate.write(chunk);
    });

    inflate.on("data", chunk => {
      output += chunk;
    });

    deflate.on("end", () => {
      inflate.end();
    });

    inflate.on("end", () => {
      expect(output).toBe(input);
      resolve();
    });

    deflate.write(input);
    deflate.flush(() => {
      deflate.reset();
      doneReset = true;
      deflate.write(input);
      deflate.end();
    });
  });
}

const dictionaries = [spdyDict, Buffer.from(spdyDict), new Uint8Array(spdyDict)];

describe("zlib dictionary tests", () => {
  test.each(dictionaries)("basic dictionary test", async dict => {
    await basicDictionaryTest(dict);
  });

  test.each(dictionaries)("deflate reset dictionary test", async dict => {
    await deflateResetDictionaryTest(dict);
  });

  test.each(dictionaries)("raw dictionary test", async dict => {
    await rawDictionaryTest(dict);
  });

  test.each(dictionaries)("deflate raw reset dictionary test", async dict => {
    await deflateRawResetDictionaryTest(dict);
  });
});

//<#END_FILE: test-zlib-dictionary.js
