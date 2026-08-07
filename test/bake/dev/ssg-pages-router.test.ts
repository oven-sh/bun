// Test SSG pages router functionality
//
// Each devTest boots a dev server (bundler + react framework install), which
// dominates wall time, so related routes share one server. Route variations
// are asserted on the server-rendered HTML via fetch; hydration is still
// covered by a happy-dom client per distinct page shape.
import { expect } from "bun:test";
import { devTest, type Dev } from "../bake-harness";

async function fetchHtml(dev: Dev, url: string): Promise<string> {
  const res = await dev.fetch(url);
  expect(res.status).toBe(200);
  return await res.text();
}

devTest("SSG pages router - static, dynamic, nested, and async pages with hot reload", {
  framework: "react",
  files: {
    "pages/index.tsx": `
      export default function IndexPage() {
        return <h1>Welcome to SSG</h1>;
      }
    `,
    "pages/[slug].tsx": `
      type Props = Bun.SSGProps;

      const Page: Bun.SSGPage = async ({ params }) => {
        return (
          <div>
            <h1>Dynamic Page: {params.slug}</h1>
            <p>Slug value: {params.slug}</p>
          </div>
        );
      };

      export default Page;

      export const getStaticPaths: Bun.GetStaticPaths = async () => {
        return {
          paths: [
            { params: { slug: "first-post" } },
            { params: { slug: "second-post" } },
            { params: { slug: "third-post" } },
          ],
        };
      };
    `,
    "pages/about.tsx": `
      export default function AboutPage() {
        return <h1>About Page</h1>;
      }
    `,
    "pages/contact.tsx": `
      export default function ContactPage() {
        return <h1>Contact Page</h1>;
      }
    `,
    "pages/data.tsx": `
      async function fetchData() {
        // Simulate API call
        return new Promise(resolve => {
          setTimeout(() => {
            resolve({ message: "Data from API", items: ["Item 1", "Item 2", "Item 3"] });
          }, 10);
        });
      }

      export default async function DataPage() {
        const data = await fetchData();

        return (
          <div>
            <h1>{data.message}</h1>
            <ul>
              {data.items.map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ul>
          </div>
        );
      }
    `,
    "pages/blog/index.tsx": `
      export default function BlogIndex() {
        return <h1>Blog Index</h1>;
      }
    `,
    "pages/blog/[id].tsx": `
      const BlogPost: Bun.SSGPage = ({ params }) => {
        return <h1>Blog Post {params.id}</h1>;
      };

      export default BlogPost;

      export const getStaticPaths: Bun.GetStaticPaths = async () => {
        return {
          paths: [
            { params: { id: "1" } },
            { params: { id: "2" } },
          ],
        };
      };
    `,
    "pages/blog/categories/[category].tsx": `
      const CategoryPage: Bun.SSGPage = ({ params }) => {
        return <h1>Category: {params.category}</h1>;
      };

      export default CategoryPage;

      export const getStaticPaths: Bun.GetStaticPaths = async () => {
        return {
          paths: [
            { params: { category: "tech" } },
            { params: { category: "lifestyle" } },
          ],
        };
      };
    `,
  },
  async test(dev) {
    // This client stays open so the hot reload step at the end can observe
    // the update; every other client is scoped to its own block.
    await using indexClient = await dev.client("/");
    expect(await indexClient.elemText("h1")).toBe("Welcome to SSG");

    // Multiple static pages, server-rendered. These also assert that static
    // routes win over the sibling [slug] pattern.
    expect(await fetchHtml(dev, "/about")).toContain("<h1>About Page</h1>");
    expect(await fetchHtml(dev, "/contact")).toContain("<h1>Contact Page</h1>");

    // Dynamic [slug] route with params
    {
      await using c = await dev.client("/first-post");
      expect(await c.elemText("h1")).toBe("Dynamic Page: <!-- -->first-post");
      expect(await c.elemText("p")).toBe("Slug value: <!-- -->first-post");
    }
    expect(await fetchHtml(dev, "/second-post")).toContain("<h1>Dynamic Page: <!-- -->second-post</h1>");
    const third = await fetchHtml(dev, "/third-post");
    expect(third).toContain("<h1>Dynamic Page: <!-- -->third-post</h1>");
    expect(third).toContain("<p>Slug value: <!-- -->third-post</p>");

    // In dev, getStaticPaths does not restrict rendering: params that are not
    // in the returned list still render on demand.
    expect(await fetchHtml(dev, "/not-in-static-paths")).toContain(
      "<h1>Dynamic Page: <!-- -->not-in-static-paths</h1>",
    );

    // Nested routes: static index + dynamic siblings
    {
      await using c = await dev.client("/blog/1");
      expect(await c.elemText("h1")).toBe("Blog Post <!-- -->1");
    }
    expect(await fetchHtml(dev, "/blog")).toContain("<h1>Blog Index</h1>");
    expect(await fetchHtml(dev, "/blog/2")).toContain("<h1>Blog Post <!-- -->2</h1>");
    expect(await fetchHtml(dev, "/blog/categories/tech")).toContain("<h1>Category: <!-- -->tech</h1>");
    expect(await fetchHtml(dev, "/blog/categories/lifestyle")).toContain("<h1>Category: <!-- -->lifestyle</h1>");

    // Async page components can await data before rendering
    {
      await using c = await dev.client("/data");
      expect(await c.elemText("h1")).toBe("Data from API");
      expect(await c.elemsText("li")).toEqual(["Item 1", "Item 2", "Item 3"]);
    }

    // Paths that match no route return 404
    await dev.fetch("/two/segments").expect404();
    await dev.fetch("/blog/categories/tech/extra").expect404();

    // Hot reload: update the index page while its client is connected
    await dev.write(
      "pages/index.tsx",
      `
        export default function IndexPage() {
          console.log("updated load");
          return <h1>Updated Content</h1>;
        }
      `,
    );

    // this %c%s%c is a react devtools thing and I don't know how to turn it off
    await indexClient.expectMessage("%c%s%c updated load");
    expect(await indexClient.elemText("h1")).toBe("Updated Content");
  },
});

// [category]/[year]/[slug] and [...slug] stay in separate dev servers (and
// apart from the [slug] tree above): overlapping dynamic patterns at the same
// level resolve by insertion order, so sharing a tree would change what each
// test matches.
devTest("SSG pages router - multiple dynamic segments", {
  framework: "react",
  files: {
    "pages/[category]/[year]/[slug].tsx": `
      const ArticlePage: Bun.SSGPage = ({ params }) => {
        return (
          <div>
            <h1>{params.slug}</h1>
            <p>Category: {params.category}</p>
            <p>Year: {params.year}</p>
          </div>
        );
      };

      export default ArticlePage;

      export const getStaticPaths: Bun.GetStaticPaths = async () => {
        return {
          paths: [
            { params: { category: "tech", year: "2024", slug: "bun-release" } },
            { params: { category: "news", year: "2024", slug: "breaking-story" } },
            { params: { category: "tech", year: "2023", slug: "year-review" } },
          ],
        };
      };
    `,
  },
  async test(dev) {
    {
      await using c = await dev.client("/tech/2024/bun-release");
      expect(await c.elemText("h1")).toBe("bun-release");
      expect(await c.elemsText("p")).toEqual(["Category: <!-- -->tech", "Year: <!-- -->2024"]);
    }
    const news = await fetchHtml(dev, "/news/2024/breaking-story");
    expect(news).toContain("<h1>breaking-story</h1>");
    expect(news).toContain("<p>Category: <!-- -->news</p>");
    expect(news).toContain("<p>Year: <!-- -->2024</p>");
    const review = await fetchHtml(dev, "/tech/2023/year-review");
    expect(review).toContain("<h1>year-review</h1>");
    expect(review).toContain("<p>Category: <!-- -->tech</p>");
    expect(review).toContain("<p>Year: <!-- -->2023</p>");

    // Four segments do not match the three-segment pattern
    await dev.fetch("/a/b/c/d").expect404();
  },
});

devTest("SSG pages router - Bun.file data loading and named import edge case", {
  framework: "react",
  files: {
    "pages/index.tsx": `
      import Markdoc, * as md from '../src/ooga'

      console.log(md);

      export default function IndexPage() {
        return <h1>Welcome to SSG</h1>;
      }
    `,
    "src/ooga.ts": `var Markdoc = function () {
  return {
    parse: () => {},
    transform: () => {},
  };
};

export { Markdoc as default };`,
    "pages/[slug].tsx": `
      import { join } from "path";

      const PostPage: Bun.SSGPage = async ({ params }) => {
        const content = await Bun.file(
          join(process.cwd(), "posts", params.slug + ".txt")
        ).text();

        return (
          <div>
            <h1>{params.slug}</h1>
            <div>{content}</div>
          </div>
        );
      };

      export default PostPage;

      export const getStaticPaths: Bun.GetStaticPaths = async () => {
        const glob = new Bun.Glob("**/*.txt");
        const paths = [];

        for (const file of Array.from(glob.scanSync({ cwd: join(process.cwd(), "posts") }))) {
          const slug = file.replace(/\\.txt$/, "");
          paths.push({ params: { slug } });
        }

        return { paths };
      };
    `,
    "posts/hello-world.txt": "This is the content of hello world post",
    "posts/second-post.txt": "This is the second post content",
  },
  async test(dev) {
    // Mixed default + namespace import of the same module must not error
    {
      await using c = await dev.client("/");
      expect(await c.elemText("h1")).toBe("Welcome to SSG");
    }

    // Page content loaded from disk with Bun.file during render
    {
      await using c = await dev.client("/hello-world");
      expect(await c.elemText("h1")).toBe("hello-world");
      expect(await c.elemText("div div")).toBe("This is the content of hello world post");
    }
    const second = await fetchHtml(dev, "/second-post");
    expect(second).toContain("<h1>second-post</h1>");
    expect(second).toContain("<div>This is the second post content</div>");
  },
});

devTest("SSG pages router - catch-all routes [...slug]", {
  framework: "react",
  files: {
    "pages/[...slug].tsx": `
      const CatchAllPage: Bun.SSGPage = ({ params }) => {
        return (
          <div>
            <h1>Catch-all Route</h1>
            <p id="params">{JSON.stringify(params)}</p>
            <ul>
              {params.slug && Array.isArray(params.slug) ? (
                params.slug.map((segment, index) => (
                  <li key={index}>{segment}</li>
                ))
              ) : (
                <li>No slug array</li>
              )}
            </ul>
          </div>
        );
      };

      export default CatchAllPage;

      export const getStaticPaths: Bun.GetStaticPaths = async () => {
        return {
          paths: [
            { params: { slug: ["docs"] } },
            { params: { slug: ["docs", "getting-started"] } },
            { params: { slug: ["docs", "api", "reference"] } },
            { params: { slug: ["blog", "2024", "january", "new-features"] } },
          ],
        };
      };
    `,
  },
  async test(dev) {
    // Two segments arrive as an array
    {
      await using c = await dev.client("/docs/getting-started");
      expect(await c.elemText("h1")).toBe("Catch-all Route");
      expect(await c.elemText("#params")).toBe('{"slug":["docs","getting-started"]}');
      expect(await c.elemsText("li")).toEqual(["docs", "getting-started"]);
    }

    // A single segment is passed as a string, not a one-element array
    const single = await fetchHtml(dev, "/docs");
    expect(single).toContain("<h1>Catch-all Route</h1>");
    expect(single).toContain("{&quot;slug&quot;:&quot;docs&quot;}");
    expect(single).toContain("<ul><li>No slug array</li></ul>");

    const three = await fetchHtml(dev, "/docs/api/reference");
    expect(three).toContain("{&quot;slug&quot;:[&quot;docs&quot;,&quot;api&quot;,&quot;reference&quot;]}");
    expect(three).toContain("<ul><li>docs</li><li>api</li><li>reference</li></ul>");

    const four = await fetchHtml(dev, "/blog/2024/january/new-features");
    expect(four).toContain(
      "{&quot;slug&quot;:[&quot;blog&quot;,&quot;2024&quot;,&quot;january&quot;,&quot;new-features&quot;]}",
    );
    expect(four).toContain("<ul><li>blog</li><li>2024</li><li>january</li><li>new-features</li></ul>");
  },
});
