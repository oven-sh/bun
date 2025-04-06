import { describe, it, expect } from "bun:test";
import { randomUUIDv7, S3Client, S3Options } from "bun";
import { getSecret } from "harness";

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

  it("Should fail when no Key is provided in Objectidentifier object", async () => {
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
          versionId: "ok",
          // @ts-expect-error must be key
          Key: "wrong prop name",
        },
      ]);

      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(TypeError);
    }

    try {
      await client.deleteObjects([
        // @ts-expect-error must include key
        {
          versionId: "ok",
        },
      ]);

      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(TypeError);
    }
  });

  // same above
  it("Should fail when provided Key is not a string", async () => {
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
      return new Response("<>", {
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
      { key: "file_3" },
      "files/4",
      { key: "Deleted/Errors/file_5", versionId: "good version" },
      { key: "file_6", eTag: "good etag" },
      "file_7",
      { key: "sub/file_8.png", lastModifiedTime: "2928292" },
      { key: "sub/file_9.png", size: 344 },
      {
        key: "files/full_file_10.txt",
        lastModifiedTime: "2928292",
        size: 344,
        versionId: "good version",
        eTag: "good etag",
      },
    ]);

    expect(body).toBe(
      '<?xml version="1.0" encoding="UTF-8"?><Delete xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Object><Key>file_1</Key></Object><Object><Key>file_2</Key></Object><Object><Key>file_3</Key></Object><Object><Key>files/4</Key></Object><Object><Key>Deleted/Errors/file_5</Key><VersionId>good version</VersionId></Object><Object><Key>file_6</Key><ETag>good etag</ETag></Object><Object><Key>file_7</Key></Object><Object><Key>sub/file_8.png</Key><LastModifiedTime>2928292</LastModifiedTime></Object><Object><Key>sub/file_9.png</Key><Size>344</Size></Object><Object><Key>files/full_file_10.txt</Key><VersionId>good version</VersionId><ETag>good etag</ETag><LastModifiedTime>2928292</LastModifiedTime><Size>344</Size></Object></Delete>',
    );
  });

  it("Should xml encode object keys", async () => {
    let body;
    using server = createBunServer(async req => {
      body = await collectRequstBody(req.body!);
      return new Response("<>", {
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
      "file<1",
      "file>2",
      "file'3",
      'file"4',
      "file&5",
      { key: "file<6" },
      { key: "file>7" },
      { key: "file'8" },
      { key: 'file"9' },
      { key: "file&10" },
    ]);

    expect(body).toBe(
      `<?xml version=\"1.0\" encoding=\"UTF-8\"?><Delete xmlns=\"http://s3.amazonaws.com/doc/2006-03-01/\"><Object><Key>file&lt;1</Key></Object><Object><Key>file&gt;2</Key></Object><Object><Key>file&apos;3</Key></Object><Object><Key>file&quot;4</Key></Object><Object><Key>file&amp;5</Key></Object><Object><Key>file&lt;6</Key></Object><Object><Key>file&gt;7</Key></Object><Object><Key>file&apos;8</Key></Object><Object><Key>file&quot;9</Key></Object><Object><Key>file&amp;10</Key></Object></Delete>`,
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
      deleted: [
        {
          key: "sample1.txt",
        },
        {
          key: "sample2.png",
          versionId: "Very=Cool'Version<Id>*We=Accept\"<Id/>",
        },
        {
          key: "sample3.pdf",
          deleteMarker: true,
          deleteMarkerVersionId: "some good id",
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
      errors: [
        {
          key: "sample4.txt",
          code: "AccessDenied",
          message: "Access Denied",
        },
        {
          key: "sample/file4.txt",
          message: "Access Denied",
        },
        {
          key: "sample/Errors/file4.void",
          message: "Access Denied",
        },
        {
          key: "sample/Errors/file4.void",
          versionId: "version77",
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
      deleted: [
        {
          key: "sample1.txt",
        },
        {
          key: "sample2.png",
          versionId: "Very=Cool'Version<Id>*We=Accept\"<Id/>",
        },
        {
          key: "sample3.pdf",
          deleteMarker: true,
          deleteMarkerVersionId: "some good id",
        },
      ],
      errors: [
        {
          key: "sample4.txt",
          code: "AccessDenied",
          message: "Access Denied",
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
      deleted: [
        {
          key: "sample1.txt",
        },
        {
          key: "sample2.png",
          versionId: "Very=Cool'Version<Id>*We=Accept\"<Id/>",
        },
        {
          key: "sample3.pdf",
          deleteMarker: true,
          deleteMarkerVersionId: "somegoodid",
        },
      ],
      errors: [
        {
          key: "sample4.txt",
          code: "AccessDenied",
          message: "AccessDenied",
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
      deleted: [
        {
          key: "sample1.txt",
        },
        {
          key: "sample2.png",
          versionId: "Very=Cool'Version<Id>*We=Accept\"<Id/>\n    ",
        },
        {
          key: "sample3.pdf",
          deleteMarker: true,
          deleteMarkerVersionId: "some good id",
        },
      ],
      errors: [
        {
          key: "sample4.txt",
          code: "AccessDenied",
          message: "Access Denied",
        },
        {
          key: "/Deleted/sub/dir/with/Key/sample5.pdf",
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
      deleted: [
        {
          key: "sample1.txt",
        },
        {
          key: "sample2.png",
          versionId: "Very=Cool'Version<Id>*We=Accept\"<Id/>\n    ",
        },
        {
          key: "/Deleted/sub/dir/with/Key/sample5.pdf",
          deleteMarker: true,
          deleteMarkerVersionId: "some good id",
        },
      ],
      errors: [
        {
          key: "sample4.txt",
          code: "AccessDenied",
          message: "Access Denied",
        },
      ],
    });
  });

  it("Should work with spaceless xml", async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<DeleteResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Deleted><Key>valid/file_1001</Key></Deleted><Deleted><Key>valid/file_1000</Key></Deleted><Error><Key>invalid/file_1002</Key><VersionId>8</VersionId><Code>NoSuchVersion</Code><Message>The specified version does not exist.</Message></Error><Error><Key>invalid/file_1004</Key><VersionId>4</VersionId><Code>NoSuchVersion</Code><Message>The specified version does not exist.</Message></Error></DeleteResult>`;

    using server = createBunServer(async => {
      return new Response(xml, {
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

    const res = await client.deleteObjects(["dont care"]);

    expect(res).toEqual({
      deleted: [
        {
          key: "valid/file_1001",
        },
        {
          key: "valid/file_1000",
        },
      ],
      errors: [
        {
          key: "invalid/file_1002",
          versionId: "8",
          code: "NoSuchVersion",
          message: "The specified version does not exist.",
        },
        {
          key: "invalid/file_1004",
          versionId: "4",
          code: "NoSuchVersion",
          message: "The specified version does not exist.",
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
      deleted: [
        {
          key: "sample1.txt",
        },
        {
          key: "sample2.png",
          versionId: "Very=Cool'Version<Id>*We=Accept\"<Id/>",
        },
        {
          key: "sample3.pdf",
          deleteMarker: true,
          deleteMarkerVersionId: "some good id",
        },
      ],
      errors: [
        {
          key: "sample4.txt",
          code: "AccessDenied",
          message: "Access Denied",
        },
      ],
    });
  });
});

const optionsFromEnv: S3Options = {
  accessKeyId: getSecret("S3_R2_ACCESS_KEY"),
  secretAccessKey: getSecret("S3_R2_SECRET_KEY"),
  endpoint: getSecret("S3_R2_ENDPOINT"),
  bucket: getSecret("S3_R2_BUCKET"),
};

describe.skipIf(!optionsFromEnv.accessKeyId)("S3 - CI - Delete Objects", () => {
  const bucket = new S3Client(optionsFromEnv);

  const keyPrefix = `${randomUUIDv7()}/`;

  const file_1 = `${keyPrefix}file_1.txt`;
  const file_2 = `${keyPrefix}file_2.txt`;
  const file_3 = `${keyPrefix}file_3.txt`;

  const file_4 = `${keyPrefix}file_4.txt`;
  const file_5 = `${keyPrefix}file_5.txt`;
  const file_6 = `${keyPrefix}file_6.txt`;

  const allFiles = [file_1, file_2, file_3, file_4, file_5, file_6];

  it("Should delete multiple objects", async () => {
    await Promise.all(allFiles.map(async key => await bucket.write(key, "a")));

    const res = await bucket.deleteObjects(allFiles);

    expect(res.errors).toBeUndefined();
    expect(res.deleted).toBeArrayOfSize(6);

    // deleted result is unordered
    expect(
      res.deleted!.every(
        x =>
          allFiles.includes(x.key) &&
          typeof x.versionId == "undefined" &&
          typeof x.deleteMarker == "undefined" &&
          typeof x.deleteMarkerVersionId == "undefined",
      ),
    );
  });
});
