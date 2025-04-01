import { describe, it, expect, afterAll } from "bun:test";
import { randomUUIDv7, S3Client, S3ListObjectsResponse, S3Options } from "bun";
import { getSecret } from "harness";

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

    await client.list({
      continuationToken: "continue=ation-_m^token",
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

    await client.list({
      delimiter: "files/",
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

    await client.list({
      encodingType: "url",
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

    await client.list({
      fetchOwner: true,
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

    await client.list({
      fetchOwner: false,
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

    await client.list({
      maxKeys: 2034,
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

    await client.list({
      prefix: "some/sub/&folder",
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

    await client.list({
      startAfter: "àwsôme/fìles",
    });

    expect(reqUrl!).toEndWith("/?list-type=2&start-after=%C3%A0ws%C3%B4me%2Ff%C3%ACles");
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

    await client.list({
      prefix: "some/sub/&folder",
      startAfter: "àwsôme/fìles",
      maxKeys: 2034,
      fetchOwner: true,
      encodingType: "url",
      delimiter: "files/",
      continuationToken: "continue=ation-_m^token",
    });

    expect(reqUrl!).toEndWith(
      "/?continuation-token=continue%3Dation-_m%5Etoken&delimiter=files%2F&encoding-type=url&fetch-owner=true&list-type=2&max-keys=2034&prefix=some%2Fsub%2F%26folder&start-after=%C3%A0ws%C3%B4me%2Ff%C3%ACles",
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

    const res = await client.list();

    expect(res).toEqual({
      name: "my_bucket",
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

    await client.list(undefined, {
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

    const res = await client.list();

    expect(res).toEqual({
      name: "my_bucket",
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

    const res = await client.list();

    expect(res).toEqual({
      name: "my_bucket",
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

    const res = await client.list();

    expect(res).toEqual({
      prefix: "some/prefix",
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

    const res = await client.list();

    expect(res).toEqual({
      keyCount: 18,
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

    const res = await client.list();

    expect(res).toEqual({
      maxKeys: 2323,
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

    const res = await client.list();

    expect(res).toEqual({
      delimiter: "good@&/de$</limiter",
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

    const res = await client.list();

    expect(res).toEqual({
      continuationToken: "current pagination token",
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

    const res = await client.list();

    expect(res).toEqual({
      encodingType: "url",
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

    const res = await client.list();

    expect(res).toEqual({
      nextContinuationToken: "some next token",
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

    const res = await client.list();

    expect(res).toEqual({
      isTruncated: false,
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

    const res = await client.list();

    expect(res).toEqual({
      isTruncated: true,
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

    const res = await client.list();

    expect(res).toEqual({
      startAfter: "some/file/name.pdf",
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

    const res = await client.list();

    expect(res).toEqual({
      commonPrefixes: [
        {
          prefix: "photos/",
        },
        {
          prefix: "videos/",
        },
        {
          prefix: "documents/public",
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

    const res = await client.list();

    expect(res).toEqual({
      contents: [
        {
          key: "my_files/important/bun.js",
          eTag: '"4c6426ac7ef186464ecbb0d81cbfcb1e"',
          lastModified: "2025-01-20T22:12:38.000Z",
          size: 102400,
          storageClass: "STANDARD",
          owner: {
            id: "someId23Sodgopez",
          },
        },
        {
          key: "my_files/important/bun1.2.3.js",
          eTag: '"etag-with-quotes"',
          lastModified: "2025-02-07",
          storageClass: "GLACIER",
          owner: {
            id: "someId23Sodgopez",
            displayName: "some display name",
          },
        },
        {
          key: "all-empty_file",
          eTag: "",
          lastModified: "",
          // @ts-expect-error
          storageClass: "",
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

    const res = await client.list(
      {
        continuationToken: "token",
        prefix: "files/",
      },
      {},
    );

    expect(res).toEqual({
      name: "inqnuam",
      prefix: "/",
      delimiter: "awsome.<files>dummy thing</files>",
      startAfter: "some/file/name.pdf",
      encodingType: "url",
      continuationToken: "current pagination token",
      nextContinuationToken: "some next token",
      isTruncated: false,
      keyCount: 0,
      maxKeys: 10000,
      contents: [
        {
          key: "from_static_file",
          eTag: '"ef2b83534e23713ee9751d492178109e"',
          lastModified: "2025-01-20T23:02:53.000Z",
          size: 922282819299999,
          storageClass: "STANDARD_IA",
          owner: {
            displayName: "some display name",
            id: "some_id_",
          },
        },
      ],
      commonPrefixes: [
        {
          prefix: "photos/",
        },
        {
          prefix: "videos/",
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

    const res = await S3Client.list({ prefix: "some/prefix" }, { ...options, endpoint: server.url.href });
    expect(reqUrl!).toEndWith("/my_bucket/?list-type=2&prefix=some%2Fprefix");
    expect(res).toEqual({
      nextContinuationToken: "some next token",
    });
  });

  it("Should work with big responses", async () => {
    const contents = new Array(40 * 1000).fill("").map(x => ({
      key: randomUUIDv7(),
      eTag: '"4c6426ac7ef186464ecbb0d81cbfcb1e"',
      lastModified: new Date().toISOString(),
      size: 922282819299999,
      storageClass: "STANDARD_IA",
      owner: {
        id: "some_id_",
      },
    }));

    using server = createBunServer(async => {
      const asXml = contents
        .map(
          x => `<Contents>
        <Key>${x.key}</Key>
        <LastModified>${x.lastModified}</LastModified>
        <ETag>&quot;4c6426ac7ef186464ecbb0d81cbfcb1e&quot;</ETag>
        <Size>922282819299999</Size>
        <Owner>
            <ID>some_id_</ID>
        </Owner>
        <StorageClass>STANDARD_IA</StorageClass>
    </Contents>`,
        )
        .join("");

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

    const res = await client.list();

    expect(res).toEqual({
      // @ts-ignore
      contents,
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

    const res = await client.list();
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
      await client.list();
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
      await client.list(11143n);
      expect.unreachable();
    } catch (error: any) {
      expect(error.code).toBe("ERR_INVALID_ARG_TYPE");
    }
  });

  it("Should work with an actual S3 output", async () => {
    // do not change any byte in this string
    const actualOutput = `<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>awsome-very-dummy-bucket</Name><Prefix></Prefix><KeyCount>3</KeyCount><MaxKeys>1000</MaxKeys><IsTruncated>false</IsTruncated><Contents><Key>01951feb-1db5-7000-aee3-213b4df4015f/file_1.txt</Key><LastModified>2025-02-19T20:34:18.000Z</LastModified><ETag>&quot;9297ab3fbd56b42f6566284119238125&quot;</ETag><Size>9</Size><StorageClass>STANDARD</StorageClass></Contents><Contents><Key>01951feb-1db5-7000-aee3-213b4df4015f/file_2.txt</Key><LastModified>2025-02-19T20:34:18.000Z</LastModified><ETag>&quot;6685cd62b95f2c58818cb20e7292168b&quot;</ETag><Size>9</Size><StorageClass>STANDARD</StorageClass></Contents><Contents><Key>01951feb-1db5-7000-aee3-213b4df4015f/file_3.txt</Key><LastModified>2025-02-19T20:34:18.000Z</LastModified><ETag>&quot;bffd51760cd2c6b531756efac72110c3&quot;</ETag><Size>9</Size><StorageClass>STANDARD</StorageClass></Contents></ListBucketResult>`;

    using server = createBunServer(async => {
      return new Response(actualOutput, {
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

    const res = await client.list();

    expect(res).toEqual({
      name: "awsome-very-dummy-bucket",
      isTruncated: false,
      keyCount: 3,
      maxKeys: 1000,
      contents: [
        {
          key: "01951feb-1db5-7000-aee3-213b4df4015f/file_1.txt",
          eTag: '"9297ab3fbd56b42f6566284119238125"',
          lastModified: "2025-02-19T20:34:18.000Z",
          size: 9,
          storageClass: "STANDARD",
        },
        {
          key: "01951feb-1db5-7000-aee3-213b4df4015f/file_2.txt",
          eTag: '"6685cd62b95f2c58818cb20e7292168b"',
          lastModified: "2025-02-19T20:34:18.000Z",
          size: 9,
          storageClass: "STANDARD",
        },
        {
          key: "01951feb-1db5-7000-aee3-213b4df4015f/file_3.txt",
          eTag: '"bffd51760cd2c6b531756efac72110c3"',
          lastModified: "2025-02-19T20:34:18.000Z",
          size: 9,
          storageClass: "STANDARD",
        },
      ],
    });
  });

  it("Should throw error when no creds is found from instance method", async () => {
    const client = new S3Client();

    try {
      await client.list();
      expect.unreachable();
    } catch (error: any) {
      expect(error.code).toBe("ERR_S3_MISSING_CREDENTIALS");
    }
  });

  it("Should throw error when no creds is found from static method", async () => {
    try {
      await S3Client.list();
      expect.unreachable();
    } catch (error: any) {
      expect(error.code).toBe("ERR_S3_MISSING_CREDENTIALS");
    }
  });
});

const optionsFromEnv: S3Options = {
  accessKeyId: getSecret("S3_R2_ACCESS_KEY"),
  secretAccessKey: getSecret("S3_R2_SECRET_KEY"),
  endpoint: getSecret("S3_R2_ENDPOINT"),
  bucket: getSecret("S3_R2_BUCKET"),
};

describe.skipIf(!optionsFromEnv.accessKeyId)("S3 - CI - List Objects", () => {
  const bucket = new S3Client(optionsFromEnv);

  const keyPrefix = `${randomUUIDv7()}/`;

  const file_1 = `${keyPrefix}file_1.txt`;
  const file_2 = `${keyPrefix}file_2.txt`;
  const file_3 = `${keyPrefix}file_3.txt`;

  const file_4 = `${keyPrefix}file_a>b.txt`;
  const file_5 = `${keyPrefix}file_a>c.txt`;
  const file_6 = `${keyPrefix}file_a>d.txt`;

  afterAll(async () => {
    try {
      // TODO replace with deleteObjects once merged
      await Promise.all([file_1, file_2, file_3, file_4, file_5, file_6].map(async key => await bucket.delete(key)));
    } catch (error) {
      console.error(error);
    }
  });

  it("should list objects with prefix, maxKeys and nextContinuationToken", async () => {
    await bucket.write(file_1, "content 1");
    await bucket.write(file_2, "content 2");
    await bucket.write(file_3, "content 3");

    const first_response = await bucket.list({ prefix: keyPrefix, maxKeys: 1 });

    expect(first_response.name).toBeString();
    expect(first_response.prefix).toBe(keyPrefix);
    expect(first_response.nextContinuationToken).toBeString();
    expect(first_response.isTruncated).toBeTrue();
    expect(first_response.keyCount).toBe(1);
    expect(first_response.maxKeys).toBe(1);
    expect(first_response.contents).toBeArray();
    expect(first_response.contents![0].key).toBe(file_1);

    const final_response = await bucket.list({
      prefix: keyPrefix,
      maxKeys: 30,
      continuationToken: first_response.nextContinuationToken,
    });

    expect(final_response.nextContinuationToken).toBeUndefined();
    expect(final_response.continuationToken).toBeString();
    expect(final_response.isTruncated).toBeFalse();
    expect(final_response.keyCount).toBe(2);
    expect(final_response.maxKeys).toBe(30);
    expect(final_response.contents).toHaveLength(2);
    expect(final_response.contents![0].key).toBe(file_2);
    expect(final_response.contents![1].key).toBe(file_3);

    const storedFile = final_response.contents![1];

    expect(storedFile.eTag).toBeString();
    expect(storedFile.lastModified).toBeString();
    expect(storedFile.size).toBe(9);
  });

  it("should list objects with startAfter, encodingType and fetchOwner", async () => {
    await bucket.write(file_4, "content 4");
    await bucket.write(file_5, "content 5");
    await bucket.write(file_6, "content 6");

    const res = await bucket.list({
      prefix: keyPrefix, // isolates the test when Bucket is not empty
      startAfter: file_4,
      fetchOwner: true,
      encodingType: "url",
    });

    expect(res.encodingType).toBe("url");
    expect(res.keyCount).toBe(2);
    expect(res.startAfter).toEndWith(encodeURIComponent("file_a>b.txt"));
    expect(res.contents).toBeArray();
    expect(res.contents).toHaveLength(2);
    expect(res.contents![0].key).toEndWith(encodeURIComponent("file_a>c.txt"));
    expect(res.contents![1].key).toEndWith(encodeURIComponent("file_a>d.txt"));

    const storedFile = res.contents![1];
    expect(storedFile.owner).toBeObject();
    expect(storedFile.owner!.id).toBeString();
  });
});
