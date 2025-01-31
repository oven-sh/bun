import { describe, it, expect } from "bun:test";
import { randomUUIDv7, S3Client, S3ListObjectsResponse, S3Options } from "bun";

const options: S3Options = {
  accessKeyId: "test",
  secretAccessKey: "test",
  region: "eu-west-3",
  bucket: "my_bucket",
};

function createBunServer(fetch: Parameters<typeof Bun.serve>[0]["fetch"]) {
  // @ts-ignore
  const server = Bun.serve({
    port: 0,
    fetch,
  });
  server.unref();

  return server;
}

describe("S3 - List Objects", () => {
  it("Should set encoded continuation-token in the request url before list-type", async () => {
    let reqUrl: string;
    using server = createBunServer(async req => {
      reqUrl = req.url;
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

    await client.listObjects({
      ContinuationToken: "continue=ation-_m^token",
    });

    expect(reqUrl!).toEndWith("/?continuation-token=continue%3Dation-_m%5Etoken&list-type=2");
  });

  it("Should set encoded delimiter in the request url before list-type", async () => {
    let reqUrl: string;
    using server = createBunServer(async req => {
      reqUrl = req.url;
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

    await client.listObjects({
      Delimiter: "files/",
    });

    expect(reqUrl!).toEndWith("/?delimiter=files%2F&list-type=2");
  });

  it("Should set encoding-type in the request url before list-type", async () => {
    let reqUrl: string;
    using server = createBunServer(async req => {
      reqUrl = req.url;
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

    await client.listObjects({
      EncodingType: "url",
    });

    expect(reqUrl!).toEndWith("/?encoding-type=url&list-type=2");
  });

  it("Should set fetch-owner (true) in the request url before list-type", async () => {
    let reqUrl: string;
    using server = createBunServer(async req => {
      reqUrl = req.url;
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

    await client.listObjects({
      FetchOwner: true,
    });

    expect(reqUrl!).toEndWith("/?fetch-owner=true&list-type=2");
  });

  it("Should set fetch-owner (false) in the request url before list-type", async () => {
    let reqUrl: string;
    using server = createBunServer(async req => {
      reqUrl = req.url;
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

    await client.listObjects({
      FetchOwner: false,
    });

    expect(reqUrl!).toEndWith("/?fetch-owner=false&list-type=2");
  });

  it("Should set max-keys in the request url after list-type", async () => {
    let reqUrl: string;
    using server = createBunServer(async req => {
      reqUrl = req.url;
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

    await client.listObjects({
      MaxKeys: 2034,
    });

    expect(reqUrl!).toEndWith("/?list-type=2&max-keys=2034");
  });

  it("Should set encoded prefix in the request url after list-type", async () => {
    let reqUrl: string;
    using server = createBunServer(async req => {
      reqUrl = req.url;
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

    await client.listObjects({
      Prefix: "some/sub/&folder",
    });

    expect(reqUrl!).toEndWith("/?list-type=2&prefix=some%2Fsub%2F%26folder");
  });

  it("Should set encoded start-after in the request url after list-type", async () => {
    let reqUrl: string;
    using server = createBunServer(async req => {
      reqUrl = req.url;
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

    await client.listObjects({
      StartAfter: "àwsôme/fìles",
    });

    expect(reqUrl!).toEndWith("/?list-type=2&start-after=%E0ws%F4me%2Ff%ECles");
  });

  it("Should work with multiple options all encoded in correct order", async () => {
    let reqUrl: string;
    using server = createBunServer(async req => {
      reqUrl = req.url;
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

    await client.listObjects({
      Prefix: "some/sub/&folder",
      StartAfter: "àwsôme/fìles",
      MaxKeys: 2034,
      FetchOwner: true,
      EncodingType: "url",
      Delimiter: "files/",
      ContinuationToken: "continue=ation-_m^token",
    });

    expect(reqUrl!).toEndWith(
      "/?continuation-token=continue%3Dation-_m%5Etoken&delimiter=files%2F&encoding-type=url&fetch-owner=true&list-type=2&max-keys=2034&prefix=some%2Fsub%2F%26folder&start-after=%E0ws%F4me%2Ff%ECles",
    );
  });

  it("Should work without provided option", async () => {
    using server = createBunServer(async => {
      return new Response(
        `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
        <Name>my_bucket</Name>
        </ListBucketResult>`,
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

    const res = await client.listObjects();

    expect(res).toEqual({
      Name: "my_bucket",
    });
  });

  it("Should work with extra options", async () => {
    let reqHeaders: Headers;
    using server = createBunServer(async req => {
      reqHeaders = req.headers;

      return new Response(
        `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
        <Name>my_bucket</Name>
        </ListBucketResult>`,
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

    await client.listObjects(undefined, {
      ...options,
      bucket: "another-bucket",
      sessionToken: "good token",
    });

    expect(reqHeaders!.get("x-amz-security-token")).toBe("good token");
  });

  it("Should work without xmlns attrib", async () => {
    using server = createBunServer(async => {
      return new Response(
        `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult  >
        <Name>my_bucket</Name>
        </ListBucketResult>`,
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

    const res = await client.listObjects();

    expect(res).toEqual({
      Name: "my_bucket",
    });
  });

  it("Should return parsed response with bucket Name", async () => {
    using server = createBunServer(async => {
      return new Response(
        `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
        <Name>my_bucket</Name>
        </ListBucketResult>`,
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

    const res = await client.listObjects();

    expect(res).toEqual({
      Name: "my_bucket",
    });
  });
  it("Should return parsed response with Prefix", async () => {
    using server = createBunServer(async => {
      return new Response(
        `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
        <Prefix>some/prefix</Prefix>
        </ListBucketResult>`,
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

    const res = await client.listObjects();

    expect(res).toEqual({
      Prefix: "some/prefix",
    });
  });

  it("Should return parsed response with KeyCount", async () => {
    using server = createBunServer(async => {
      return new Response(
        `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
        <KeyCount>18</KeyCount>
        </ListBucketResult>`,
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

    const res = await client.listObjects();

    expect(res).toEqual({
      KeyCount: 18,
    });
  });

  it("Should return parsed response with MaxKeys", async () => {
    using server = createBunServer(async => {
      return new Response(
        `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
        <MaxKeys>2323</MaxKeys>
        </ListBucketResult>`,
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

    const res = await client.listObjects();

    expect(res).toEqual({
      MaxKeys: 2323,
    });
  });

  it("Should return parsed response with Delimiter", async () => {
    using server = createBunServer(async => {
      return new Response(
        `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
        <Delimiter>good@&/de$</limiter</Delimiter>
        </ListBucketResult>`,
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

    const res = await client.listObjects();

    expect(res).toEqual({
      Delimiter: "good@&/de$</limiter",
    });
  });

  it("Should return parsed response with ContinuationToken", async () => {
    using server = createBunServer(async => {
      return new Response(
        `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
        <ContinuationToken>current pagination token</ContinuationToken>
        </ListBucketResult>`,
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

    const res = await client.listObjects();

    expect(res).toEqual({
      ContinuationToken: "current pagination token",
    });
  });

  it("Should return parsed response with EncodingType", async () => {
    using server = createBunServer(async => {
      return new Response(
        `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
        <EncodingType>url</EncodingType>
        </ListBucketResult>`,
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

    const res = await client.listObjects();

    expect(res).toEqual({
      EncodingType: "url",
    });
  });

  it("Should return parsed response with NextContinuationToken", async () => {
    using server = createBunServer(async => {
      return new Response(
        `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
         <NextContinuationToken>some next token</NextContinuationToken>
        </ListBucketResult>`,
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

    const res = await client.listObjects();

    expect(res).toEqual({
      NextContinuationToken: "some next token",
    });
  });

  it("Should return parsed response with IsTruncated (false)", async () => {
    using server = createBunServer(async => {
      return new Response(
        `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult>
         <IsTruncated>false</IsTruncated>
        </ListBucketResult>`,
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

    const res = await client.listObjects();

    expect(res).toEqual({
      IsTruncated: false,
    });
  });

  it("Should return parsed response with IsTruncated (true)", async () => {
    using server = createBunServer(async => {
      return new Response(
        `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult>
         <IsTruncated>true</IsTruncated>
        </ListBucketResult>`,
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

    const res = await client.listObjects();

    expect(res).toEqual({
      IsTruncated: true,
    });
  });

  it("Should return parsed response with StartAfter", async () => {
    using server = createBunServer(async => {
      return new Response(
        `
        
        
        <ListBucketResult>
    <StartAfter>some/file/name.pdf</StartAfter> </ListBucketResult>
    
    `,
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

    const res = await client.listObjects();

    expect(res).toEqual({
      StartAfter: "some/file/name.pdf",
    });
  });

  it("Should return parsed response with CommonPrefixes", async () => {
    using server = createBunServer(async => {
      return new Response(
        `<ListBucketResult>    <CommonPrefixes><Prefix>photos/</Prefix><Prefix>videos/</Prefix>
  

        <Prefix>documents/public</Prefix>

        </CommonPrefixes></ListBucketResult>`,
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

    const res = await client.listObjects();

    expect(res).toEqual({
      CommonPrefixes: [
        {
          Prefix: "photos/",
        },
        {
          Prefix: "videos/",
        },
        {
          Prefix: "documents/public",
        },
      ],
    });
  });

  it("Should return parsed response with Contents", async () => {
    using server = createBunServer(async => {
      return new Response(
        `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult>
    <Contents>
        <Key>my_files/important/bun.js</Key>
        <LastModified>2025-01-20T22:12:38.000Z</LastModified>
        <RestoreStatus>
            <IsRestoreInProgress>false</IsRestoreInProgress>
            <RestoreExpiryDate>2012-12-21T00:00:00.000Z</RestoreExpiryDate>
        </RestoreStatus>
        <ETag>&quot;4c6426ac7ef186464ecbb0d81cbfcb1e&quot;</ETag>
        <Size>102400</Size>
        <Owner>
            <ID>someId23Sodgopez</ID>
        </Owner>
        <StorageClass>STANDARD</StorageClass>
    </Contents>

       <Contents>
        <Key>my_files/important/bun1.2.3.js</Key>
        <LastModified>2025-02-07</LastModified>
        <ETag>"etag-with-quotes"</ETag>
        <Size></Size>
        <Owner>
            <ID>someId23Sodgopez</ID>
            <DisplayName>some display name</DisplayName>
        </Owner>
        <StorageClass>GLACIER</StorageClass>
    </Contents>


 <Contents>
        <Key>all-empty_file</Key>
        <LastModified></LastModified>
        <ETag></ETag>
        <Size></Size>
        <Owner>
            <ID></ID>
            <DisplayName></DisplayName>
        </Owner>
        <StorageClass></StorageClass>
    </Contents>


        </ListBucketResult>`,
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

    const res = await client.listObjects();

    expect(res).toEqual({
      Contents: [
        {
          Key: "my_files/important/bun.js",
          ETag: '"4c6426ac7ef186464ecbb0d81cbfcb1e"',
          LastModified: "2025-01-20T22:12:38.000Z",
          Size: 102400,
          StorageClass: "STANDARD",
          Owner: {
            Id: "someId23Sodgopez",
          },
        },
        {
          Key: "my_files/important/bun1.2.3.js",
          ETag: '"etag-with-quotes"',
          LastModified: "2025-02-07",
          StorageClass: "GLACIER",
          Owner: {
            Id: "someId23Sodgopez",
            DisplayName: "some display name",
          },
        },
        {
          Key: "all-empty_file",
          ETag: "",
          LastModified: "",
          // @ts-expect-error
          StorageClass: "",
        },
      ],
    });
  });

  it("Should return parsed response with all fields", async () => {
    using server = createBunServer(async => {
      return new Response(
        `<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
    <Name>inqnuam</Name>
    <Prefix>/</Prefix>
    <KeyCount>0</KeyCount>
    <MaxKeys>10000</MaxKeys>
    <Delimiter>awsome.<files>dummy thing</files></Delimiter>
    <ContinuationToken>current pagination token</ContinuationToken>
    <EncodingType>url</EncodingType>
    <NextContinuationToken>some next token</NextContinuationToken>
    <IsTruncated>false</IsTruncated>
    <Contents>
        <Key>from_static_file</Key>
        <LastModified>2025-01-20T23:02:53.000Z</LastModified>
        <ETag>&quot;ef2b83534e23713ee9751d492178109e&quot;</ETag>
        <Size>922282819299999</Size>
        <Owner>
        <DisplayName>some display name</DisplayName>
            <ID>some_id_</ID>
        </Owner>
        <StorageClass>STANDARD_IA</StorageClass>
    </Contents>
   

    <StartAfter>some/file/name.pdf</StartAfter>


    <CommonPrefixes><Prefix>photos/</Prefix><Prefix>videos/</Prefix></CommonPrefixes>
</ListBucketResult>`,
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

    const res = await client.listObjects(
      {
        ContinuationToken: "token",
        Prefix: "files/",
      },
      {},
    );

    expect(res).toEqual({
      Name: "inqnuam",
      Prefix: "/",
      Delimiter: "awsome.<files>dummy thing</files>",
      StartAfter: "some/file/name.pdf",
      EncodingType: "url",
      ContinuationToken: "current pagination token",
      NextContinuationToken: "some next token",
      IsTruncated: false,
      KeyCount: 0,
      MaxKeys: 10000,
      Contents: [
        {
          Key: "from_static_file",
          ETag: '"ef2b83534e23713ee9751d492178109e"',
          LastModified: "2025-01-20T23:02:53.000Z",
          Size: 922282819299999,
          StorageClass: "STANDARD_IA",
          Owner: {
            DisplayName: "some display name",
            Id: "some_id_",
          },
        },
      ],
      CommonPrefixes: [
        {
          Prefix: "photos/",
        },
        {
          Prefix: "videos/",
        },
      ],
    });
  });

  it("Should work with static method", async () => {
    let reqUrl: string;
    using server = createBunServer(async req => {
      reqUrl = req.url;
      return new Response(
        `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
         <NextContinuationToken>some next token</NextContinuationToken>
        </ListBucketResult>`,
        {
          headers: {
            "Content-Type": "application/xml",
          },
          status: 200,
        },
      );
    });

    const res = await S3Client.listObjects({ Prefix: "some/prefix" }, { ...options, endpoint: server.url.href });
    expect(reqUrl!).toEndWith("/my_bucket/?list-type=2&prefix=some%2Fprefix");
    expect(res).toEqual({
      NextContinuationToken: "some next token",
    });
  });

  it("Should work with big responses", async () => {
    const Contents = new Array(40 * 1000).fill("").map(x => ({
      Key: randomUUIDv7(),
      ETag: '"4c6426ac7ef186464ecbb0d81cbfcb1e"',
      LastModified: new Date().toISOString(),
      Size: 922282819299999,
      StorageClass: "STANDARD_IA",
      Owner: {
        Id: "some_id_",
      },
    }));

    using server = createBunServer(async => {
      const asXml = Contents.map(
        x => `<Contents>
        <Key>${x.Key}</Key>
        <LastModified>${x.LastModified}</LastModified>
        <ETag>&quot;4c6426ac7ef186464ecbb0d81cbfcb1e&quot;</ETag>
        <Size>922282819299999</Size>
        <Owner>
            <ID>some_id_</ID>
        </Owner>
        <StorageClass>STANDARD_IA</StorageClass>
    </Contents>`,
      ).join("");

      return new Response(`<?xml version="1.0" encoding="UTF-8"?><ListBucketResult>${asXml}</ListBucketResult>`, {
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

    const res = await client.listObjects();

    expect(res).toEqual({
      // @ts-ignore
      Contents,
    });
  });

  it("Should not crash with bad xml", async () => {
    using server = createBunServer(async => {
      return new Response(
        `<ListBucketResult> </Contents>
    <StartAfter> <Contents> </ListBucketResult>`,
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

    const res = await client.listObjects();
    expect(res).toEqual({});
  });

  it("Should throw Error if request failed", async () => {
    using server = createBunServer(async => {
      return new Response(
        `<Error>
     <Code>WhoKnows</Code></Error>`,
        {
          headers: {
            "Content-Type": "application/xml",
          },
          status: 400,
        },
      );
    });

    const client = new S3Client({
      ...options,
      endpoint: server.url.href,
    });

    try {
      await client.listObjects();
      expect.unreachable();
    } catch (error: any) {
      expect(error.code).toBe("WhoKnows");
    }
  });

  it("Should throw if option is not an Object", async () => {
    using server = createBunServer(async => {
      return new Response(`<Error><Code>Should not be errored here</Code></Error>`, {
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
      // @ts-expect-error
      await client.listObjects(11143n);
      expect.unreachable();
    } catch (error: any) {
      expect(error.code).toBe("ERR_INVALID_ARG_TYPE");
    }
  });
});
