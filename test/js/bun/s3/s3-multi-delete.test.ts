import { describe, it, expect } from "bun:test";
import { S3Client, S3Options } from "bun";

const options: S3Options = {
  accessKeyId: "test",
  secretAccessKey: "test",
  region: "eu-west-3",
  bucket: "my_bucket",
};

async function collectRequstBody(body?: ReadableStream<Uint8Array<ArrayBufferLike>>): Promise<string> {
  if (!body) {
    return "";
  }

  const chunks: Uint8Array[] = [];

  // @ts-ignore false positive
  for await (const chunk of body) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function createBunServer(fetch: Parameters<typeof Bun.serve>[0]["fetch"]) {
  // @ts-ignore
  const server = Bun.serve({
    port: 0,
    fetch,
  });
  server.unref();

  return server;
}
describe("s3 - multi delete", () => {
  it("Should fail when input is not an array", async () => {
    using server = createBunServer(async () => {
      return new Response(`<>`, {
        headers: {
          "Content-Type": "application/xml",
        },
        status: 200,
      });
    });

    const client = new S3Client({
      ...options,
      endpoint: server.url.href,
    });

    try {
      // @ts-expect-error not allowed
      await client.deleteObjects("bad");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(TypeError);
    }
  });

  it("Should fail when Objectidentifier is not a string or object", async () => {
    using server = createBunServer(async () => {
      return new Response(`<>`, {
        headers: {
          "Content-Type": "application/xml",
        },
        status: 200,
      });
    });

    const client = new S3Client({
      ...options,
      endpoint: server.url.href,
    });

    try {
      // @ts-expect-error not allowed
      await client.deleteObjects([234]);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(TypeError);
    }
  });

  // Thrown error is not TypeError, instead we receive number
  // see blob.zig around 3700 where err is returned
  it.skip("Should fail when no Key is provided in Objectidentifier object", async () => {
    using server = createBunServer(async () => {
      return new Response(`<>`, {
        headers: {
          "Content-Type": "application/xml",
        },
        status: 200,
      });
    });

    const client = new S3Client({
      ...options,
      endpoint: server.url.href,
    });

    try {
      await client.deleteObjects([
        // @ts-expect-error not allowed
        {
          VersionId: "ok",
          // key: "wrong prop name"   // NOTE Bun issue ? When uncommented 'key' must not be returned with getTruthyComptime("Key")
        },
      ]);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(TypeError);
    }
  });

  // same above
  it.skip("Should fail when provided Key is not a string", async () => {
    using server = createBunServer(async () => {
      return new Response(`<>`, {
        headers: {
          "Content-Type": "application/xml",
        },
        status: 200,
      });
    });

    const client = new S3Client({
      ...options,
      endpoint: server.url.href,
    });

    try {
      await client.deleteObjects([
        {
          // @ts-expect-error not allowed
          Key: { supposedNotToWork: true },
        },
      ]);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(TypeError);
    }
  });

  it("Should not crash when response contains invalid xml", async () => {
    using server = createBunServer(async () => {
      return new Response(`<>`, {
        headers: {
          "Content-Type": "application/xml",
        },
        status: 200,
      });
    });

    const client = new S3Client({
      ...options,
      endpoint: server.url.href,
    });

    const result = await client.deleteObjects(["file_1"]);

    expect(result).toBeDefined();
    expect(Object.keys(result).length).toBe(0);
  });

  it("Should work with Quiet mode ON", async () => {
    using server = createBunServer(async req => {
      const body = await collectRequstBody(req.body!);

      const containsQuiet = body.includes("<Quiet>true</Quiet>");

      return new Response(containsQuiet ? "" : `<Error><Message>Not Good</Message></Error>`, {
        headers: {
          "Content-Type": "application/xml",
        },
        status: containsQuiet ? 200 : 400,
      });
    });
    const client = new S3Client({
      ...options,
      endpoint: server.url.href,
    });

    const result = await client.deleteObjects(["file_1"], { quiet: true });

    expect(result).toBeDefined();
    expect(Object.keys(result).length).toBe(0);
  });

  it("Should work with Quiet mode OFF", async () => {
    using server = createBunServer(async req => {
      const body = await collectRequstBody(req.body!);

      const containsQuiet = body.includes("<Quiet>true</Quiet>");

      return new Response(containsQuiet ? `<Error><Message>Not Good</Message></Error>` : "", {
        headers: {
          "Content-Type": "application/xml",
        },
        status: containsQuiet ? 400 : 200,
      });
    });

    const client = new S3Client({
      ...options,
      endpoint: server.url.href,
    });

    const result = await client.deleteObjects(["file_1"], {
      // @ts-expect-error only true is allowed
      quiet: false,
    });

    expect(result).toBeDefined();
    expect(Object.keys(result).length).toBe(0);
  });

  it("Should contain Content-MD5 in header", async () => {
    let reqHeaders: Headers;
    using server = createBunServer(async req => {
      reqHeaders = req.headers;

      return new Response(`<>`, {
        headers: {
          "Content-Type": "application/xml",
        },
        status: 200,
      });
    });

    const client = new S3Client({
      ...options,
      endpoint: server.url.href,
    });

    await client.deleteObjects(["file_1"]);

    expect(reqHeaders!.get("content-md5")).toBe("xOwdj1J6B54UezIWYiVcyw==");
  });

  it("Should have alphabetically ordered SignedHeaders with content-md5", async () => {
    let reqHeaders: Headers;
    using server = createBunServer(async req => {
      reqHeaders = req.headers;
      return new Response(`<>`, {
        headers: {
          "Content-Type": "application/xml",
        },
        status: 200,
      });
    });

    const client = new S3Client({
      ...options,
      endpoint: server.url.href,
      sessionToken: "dummyToken",
    });

    await client.deleteObjects(["file_1", "file_2", "file_3"]);

    expect(reqHeaders!.get("authorization")).toInclude(
      "SignedHeaders=content-md5;host;x-amz-content-sha256;x-amz-date;x-amz-security-token,",
    );
  });

  it("Should produce valid DeleteObjects XML request", async () => {
    let body;
    using server = createBunServer(async req => {
      body = await collectRequstBody(req.body!);
      return new Response(`<>`, {
        headers: {
          "Content-Type": "application/xml",
        },
        status: 200,
      });
    });

    const client = new S3Client({
      ...options,
      endpoint: server.url.href,
    });

    await client.deleteObjects([
      "file_1",
      "file_2",
      { Key: "file_3" },
      "files/4",
      { Key: "Deleted/Errors/file_5", VersionId: "good version" },
      { Key: "file_6", ETag: "good etag" },
      "file_7",
      { Key: "sub/file_8.png", LastModifiedTime: "2928292" },
      { Key: "sub/file_9.png", Size: 344 },
      {
        Key: "files/full_file_10.txt",
        LastModifiedTime: "2928292",
        Size: 344,
        VersionId: "good version",
        ETag: "good etag",
      },
    ]);

    expect(body).toBe(
      '<?xml version="1.0" encoding="UTF-8"?><Delete xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Object><Key>file_1</Key></Object><Object><Key>file_2</Key></Object><Object><Key>file_3</Key></Object><Object><Key>files/4</Key></Object><Object><Key>Deleted/Errors/file_5</Key><VersionId>good version</VersionId></Object><Object><Key>file_6</Key><ETag>good etag</ETag></Object><Object><Key>file_7</Key></Object><Object><Key>sub/file_8.png</Key><LastModifiedTime>2928292</LastModifiedTime></Object><Object><Key>sub/file_9.png</Key><Size>344</Size></Object><Object><Key>files/full_file_10.txt</Key><VersionId>good version</VersionId><ETag>good etag</ETag><LastModifiedTime>2928292</LastModifiedTime><Size>344</Size></Object></Delete>',
    );
  });

  it("Should return only successfully Deleted objects", async () => {
    using server = createBunServer(async req => {
      return new Response(
        `<?xml version="1.0" encoding="UTF-8"?>
            <DeleteResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
             <Deleted>
               <Key>sample1.txt</Key>
             </Deleted>
              <Deleted>
               <Key>sample2.png</Key>
               <VersionId>Very=Cool'Version<Id>*We=Accept"<Id/></VersionId>
             </Deleted>
             <Deleted>
               <Key>sample3.pdf</Key>
               <DeleteMarker>true</DeleteMarker>
               <DeleteMarkerVersionId>some good id</DeleteMarkerVersionId>
             </Deleted>
            
            </DeleteResult>`,
        {
          headers: {
            "Content-Type": "application/xml",
          },
          status: 200,
        },
      );
    });

    const client = new S3Client({
      ...options,
      endpoint: server.url.href,
    });

    const res = await client.deleteObjects(["dont care"]);

    expect(res).toEqual({
      Deleted: [
        {
          Key: "sample1.txt",
        },
        {
          Key: "sample2.png",
          VersionId: "Very=Cool'Version<Id>*We=Accept\"<Id/>",
        },
        {
          Key: "sample3.pdf",
          DeleteMarker: true,
          DeleteMarkerVersionId: "some good id",
        },
      ],
    });
  });

  it("Should return only Errors", async () => {
    using server = createBunServer(async req => {
      return new Response(
        `<?xml version="1.0" encoding="UTF-8"?>
            <DeleteResult xmlns="http://s3.'''''am'azona >
           <Error>
              <Key>sample4.txt</Key>
              <Code>AccessDenied</Code>
              <Message>Access Denied</Message> </Error>
  
 <Error>
              <Key>sample/file4.txt</Key>
              <Message>Access Denied</Message> </Error><Error>
              <Key>sample/Errors/file4.void</Key>
              <Message>Access Denied</Message> </Error>

      <Error>
              <Key>sample/Errors/file4.void</Key>
              <VersionId>version77</VersionId> </Error>
            </DeleteResult>`,
        {
          headers: {
            "Content-Type": "application/xml",
          },
          status: 200,
        },
      );
    });

    const client = new S3Client({
      ...options,
      endpoint: server.url.href,
    });

    const res = await client.deleteObjects(["dont care"]);

    expect(res).toEqual({
      Errors: [
        {
          Key: "sample4.txt",
          Code: "AccessDenied",
          Message: "Access Denied",
        },
        {
          Key: "sample/file4.txt",
          Message: "Access Denied",
        },
        {
          Key: "sample/Errors/file4.void",
          Message: "Access Denied",
        },
        {
          Key: "sample/Errors/file4.void",
          VersionId: "version77",
        },
      ],
    });
  });

  it("Should return both Errors and successfully Deleted", async () => {
    using server = createBunServer(async req => {
      return new Response(
        `<?xml version="1.0" encoding="UTF-8"?>
            <DeleteResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
             <Deleted>
               <Key>sample1.txt</Key>
             </Deleted>
             <Error>
              <Key>sample4.txt</Key>
              <Code>AccessDenied</Code>
              <Message>Access Denied</Message>
             </Error>
              <Deleted>
               <Key>sample2.png</Key>
               <VersionId>Very=Cool'Version<Id>*We=Accept"<Id/></VersionId>
             </Deleted>
             <Deleted>
               <Key>sample3.pdf</Key>
               <DeleteMarker>true</DeleteMarker>
               <DeleteMarkerVersionId>some good id</DeleteMarkerVersionId>
             </Deleted></DeleteResult>`,
        {
          headers: {
            "Content-Type": "application/xml",
          },
          status: 200,
        },
      );
    });

    const client = new S3Client({
      ...options,
      endpoint: server.url.href,
    });

    const res = await client.deleteObjects(["dont care"]);

    expect(res).toEqual({
      Deleted: [
        {
          Key: "sample1.txt",
        },
        {
          Key: "sample2.png",
          VersionId: "Very=Cool'Version<Id>*We=Accept\"<Id/>",
        },
        {
          Key: "sample3.pdf",
          DeleteMarker: true,
          DeleteMarkerVersionId: "some good id",
        },
      ],
      Errors: [
        {
          Key: "sample4.txt",
          Code: "AccessDenied",
          Message: "Access Denied",
        },
      ],
    });
  });

  it("Should be able to parse whitespaceless XML responses", async () => {
    using server = createBunServer(async req => {
      return new Response(
        `<?xmlversion="1.0"encoding="UTF-8"?><DeleteResultxmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Deleted><Key>sample1.txt</Key></Deleted><Error><Key>sample4.txt</Key><Code>AccessDenied</Code><Message>AccessDenied</Message></Error><Deleted><Key>sample2.png</Key><VersionId>Very=Cool'Version<Id>*We=Accept"<Id/></VersionId></Deleted><Deleted><Key>sample3.pdf</Key><DeleteMarker>true</DeleteMarker><DeleteMarkerVersionId>somegoodid</DeleteMarkerVersionId></Deleted></DeleteResult>`,
        {
          headers: {
            "Content-Type": "application/xml",
          },
          status: 200,
        },
      );
    });

    const client = new S3Client({
      ...options,
      endpoint: server.url.href,
    });

    const res = await client.deleteObjects(["dont care"]);

    expect(res).toEqual({
      Deleted: [
        {
          Key: "sample1.txt",
        },
        {
          Key: "sample2.png",
          VersionId: "Very=Cool'Version<Id>*We=Accept\"<Id/>",
        },
        {
          Key: "sample3.pdf",
          DeleteMarker: true,
          DeleteMarkerVersionId: "somegoodid",
        },
      ],
      Errors: [
        {
          Key: "sample4.txt",
          Code: "AccessDenied",
          Message: "AccessDenied",
        },
      ],
    });
  });

  it("Should be able to parse endless XML responses", async () => {
    using server = createBunServer(async => {
      return new Response(
        `<?xml version="1.0" encoding="UTF-8"?>
            <DeleteResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
             <Deleted>
               <Key>sample1.txt`,
        {
          headers: {
            "Content-Type": "application/xml",
          },
          status: 200,
        },
      );
    });

    const client = new S3Client({
      ...options,
      endpoint: server.url.href,
    });

    const res = await client.deleteObjects(["dont care"]);

    expect(res).toEqual({});
  });

  it("Should be able to parse bad 'Error' closing tag XML responses", async () => {
    using server = createBunServer(async => {
      return new Response(
        `<?xml version="1.0" encoding="UTF-8"?>
<DeleteResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Deleted>
    <Key>sample1.txt</Key>
  </Deleted>
  <Error>
    <Key>sample4.txt</Key>
    <Code>AccessDenied</Code>
    <Message>Access Denied</Message>
  </Error>
  <Deleted>
    <Key>sample2.png</Key>
    <VersionId>Very=Cool'Version<Id>*We=Accept"<Id/>
    </VersionId>
  </Deleted>
  <Deleted>
    <Key>sample3.pdf</Key>
    <DeleteMarker>true</DeleteMarker>
    <DeleteMarkerVersionId>some good id</DeleteMarkerVersionId>
  </Deleted>
  <Error>
    <Key>/Deleted/sub/dir/with/Key/sample5.pdf</Key>
    <DeleteMarker>true</DeleteMarker>
    <DeleteMarkerVersionId>some good id</DeleteMarkerVersionId>
  </Deleted>
</DeleteResult>`,
        {
          headers: {
            "Content-Type": "application/xml",
          },
          status: 200,
        },
      );
    });

    const client = new S3Client({
      ...options,
      endpoint: server.url.href,
    });

    const res = await client.deleteObjects(["dont care"]);

    expect(res).toEqual({
      Deleted: [
        {
          Key: "sample1.txt",
        },
        {
          Key: "sample2.png",
          VersionId: "Very=Cool'Version<Id>*We=Accept\"<Id/>\n    ",
        },
        {
          Key: "sample3.pdf",
          DeleteMarker: true,
          DeleteMarkerVersionId: "some good id",
        },
      ],
      Errors: [
        {
          Key: "sample4.txt",
          Code: "AccessDenied",
          Message: "Access Denied",
        },
        {
          Key: "/Deleted/sub/dir/with/Key/sample5.pdf",
        },
      ],
    });
  });

  it("Should be able to parse bad 'Deleted' closing tag XML responses", async () => {
    using server = createBunServer(async => {
      return new Response(
        `<?xml version="1.0" encoding="UTF-8"?>
<DeleteResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Deleted>
    <Key>sample1.txt</Key>
  </Deleted>
  <Error>
    <Key>sample4.txt</Key>
    <Code>AccessDenied</Code>
    <Message>Access Denied</Message>
  </Error>
  <Deleted>
    <Key>sample2.png</Key>
    <VersionId>Very=Cool'Version<Id>*We=Accept"<Id/>
    </VersionId>
  </Deleted>
  <Deleted>
    <Key>sample3.pdf</Key>
    <DeleteMarker>true</DeleteMarker>
    <DeleteMarkerVersionId>some good id</DeleteMarkerVersionId>
  </Error>
  <Error>
    <Key>/Deleted/sub/dir/with/Key/sample5.pdf</Key>
    <DeleteMarker>true</DeleteMarker>
    <DeleteMarkerVersionId>some good id</DeleteMarkerVersionId>
  </Error>
</DeleteResult>`,
        {
          headers: {
            "Content-Type": "application/xml",
          },
          status: 200,
        },
      );
    });

    const client = new S3Client({
      ...options,
      endpoint: server.url.href,
    });

    const res = await client.deleteObjects(["dont care"]);

    expect(res).toEqual({
      Deleted: [
        {
          Key: "sample1.txt",
        },
        {
          Key: "sample2.png",
          VersionId: "Very=Cool'Version<Id>*We=Accept\"<Id/>\n    ",
        },
        {
          Key: "/Deleted/sub/dir/with/Key/sample5.pdf",
          DeleteMarker: true,
          DeleteMarkerVersionId: "some good id",
        },
      ],
      Errors: [
        {
          Key: "sample4.txt",
          Code: "AccessDenied",
          Message: "Access Denied",
        },
      ],
    });
  });

  it("Should throw S3Error on Unknown status code", async () => {
    using server = createBunServer(async => {
      return new Response(
        `<?xml version="1.0" encoding="UTF-8"?>
            <Error><Message>This is an error from AWS</Message></Error>`,
        {
          headers: {
            "Content-Type": "application/xml",
          },
          status: 500,
        },
      );
    });

    const client = new S3Client({
      ...options,
      endpoint: server.url.href,
    });

    try {
      await client.deleteObjects(["dont care"]);
      expect.unreachable();
    } catch (err: any) {
      expect(err.message).toBe("This is an error from AWS");
    }
  });

  it("Shoulw work from static method", async () => {
    using server = createBunServer(async => {
      return new Response(
        `<?xml version="1.0" encoding="UTF-8"?>
            <DeleteResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
             <Deleted>
               <Key>sample1.txt</Key>
             </Deleted>
             <Error>
              <Key>sample4.txt</Key>
              <Code>AccessDenied</Code>
              <Message>Access Denied</Message>
             </Error>
              <Deleted>
               <Key>sample2.png</Key>
               <VersionId>Very=Cool'Version<Id>*We=Accept"<Id/></VersionId>
             </Deleted>
             <Deleted>
               <Key>sample3.pdf</Key>
               <DeleteMarker>true</DeleteMarker>
               <DeleteMarkerVersionId>some good id</DeleteMarkerVersionId>
             </Deleted>
            
            </DeleteResult>
        `,
        {
          headers: {
            "Content-Type": "application/xml",
          },
          status: 200,
        },
      );
    });

    const res = await S3Client.deleteObjects(["one", "two"], { ...options, endpoint: server.url.href });

    expect(res).toEqual({
      Deleted: [
        {
          Key: "sample1.txt",
        },
        {
          Key: "sample2.png",
          VersionId: "Very=Cool'Version<Id>*We=Accept\"<Id/>",
        },
        {
          Key: "sample3.pdf",
          DeleteMarker: true,
          DeleteMarkerVersionId: "some good id",
        },
      ],
      Errors: [
        {
          Key: "sample4.txt",
          Code: "AccessDenied",
          Message: "Access Denied",
        },
      ],
    });
  });
});
