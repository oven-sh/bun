// Test SSG pages router functionality
import { expect } from "bun:test";
import { devTest } from "../bake-harness";

devTest("SSG pages router - multiple static pages", {
  framework: "react",
  files: {
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
  },
  async test(dev) {
    // Test about page
    await using c2 = await dev.client("/about");
    expect(await c2.elemText("h1")).toBe("About Page");

    // Test contact page
    await using c3 = await dev.client("/contact");
    expect(await c3.elemText("h1")).toBe("Contact Page");
  },
});

devTest("SSG pages router - dynamic routes with [slug]", {
  framework: "react",
  files: {
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
  },
  async test(dev) {
    // Test dynamic routes
    await using c1 = await dev.client("/first-post");
    expect(await c1.elemText("h1")).toBe("Dynamic Page: <!-- -->first-post");
    expect(await c1.elemText("p")).toBe("Slug value: <!-- -->first-post");

    await using c2 = await dev.client("/second-post");
    expect(await c2.elemText("h1")).toBe("Dynamic Page: <!-- -->second-post");

    await using c3 = await dev.client("/third-post");
    expect(await c3.elemText("h1")).toBe("Dynamic Page: <!-- -->third-post");
  },
});

devTest("SSG pages router - nested routes", {
  framework: "react",
  files: {
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
    // Test blog index
    await using c1 = await dev.client("/blog");
    expect(await c1.elemText("h1")).toBe("Blog Index");

    // Test blog posts
    await using c2 = await dev.client("/blog/1");
    expect(await c2.elemText("h1")).toBe("Blog Post <!-- -->1");

    await using c3 = await dev.client("/blog/2");
    expect(await c3.elemText("h1")).toBe("Blog Post <!-- -->2");

    // Test categories
    await using c4 = await dev.client("/blog/categories/tech");
    expect(await c4.elemText("h1")).toBe("Category: <!-- -->tech");

    await using c5 = await dev.client("/blog/categories/lifestyle");
    expect(await c5.elemText("h1")).toBe("Category: <!-- -->lifestyle");
  },
});

devTest("SSG pages router - hot reload on page changes", {
  framework: "react",
  files: {
    "pages/index.tsx": `
      export default function IndexPage() {
        return <h1>Welcome to SSG</h1>;
      }
    `,
  },
  async test(dev) {
    await using c = await dev.client("/");
    expect(await c.elemText("h1")).toBe("Welcome to SSG");

    // Update the page
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
    await c.expectMessage("%c%s%c updated load");
    expect(await c.elemText("h1")).toBe("Updated Content");
  },
});

devTest("SSG pages router - data fetching with async components", {
  framework: "react",
  files: {
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
  },
  async test(dev) {
    await using c = await dev.client("/data");
    expect(await c.elemText("h1")).toBe("Data from API");

    const items = await c.elemsText("li");
    expect(items).toEqual(["Item 1", "Item 2", "Item 3"]);
  },
});

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
    // Test first path
    await using c1 = await dev.client("/tech/2024/bun-release");
    expect(await c1.elemText("h1")).toBe("bun-release");
    expect(await c1.elemsText("p")).toEqual(["Category: <!-- -->tech", "Year: <!-- -->2024"]);

    // Test second path
    await using c2 = await dev.client("/news/2024/breaking-story");
    expect(await c2.elemText("h1")).toBe("breaking-story");
    expect(await c2.elemsText("p")).toEqual(["Category: <!-- -->news", "Year: <!-- -->2024"]);

    // Test third path
    await using c3 = await dev.client("/tech/2023/year-review");
    expect(await c3.elemText("h1")).toBe("year-review");
    expect(await c3.elemsText("p")).toEqual(["Category: <!-- -->tech", "Year: <!-- -->2023"]);
  },
});

devTest("SSG pages router - file loading with Bun.file", {
  framework: "react",
  fixture: "ssg-pages-router",
  files: {
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
    // Test first post
    await using c1 = await dev.client("/hello-world");
    expect(await c1.elemText("h1")).toBe("hello-world");
    expect(await c1.elemText("div div")).toBe("This is the content of hello world post");

    // Test second post
    await using c2 = await dev.client("/second-post");
    expect(await c2.elemText("h1")).toBe("second-post");
    expect(await c2.elemText("div div")).toBe("This is the second post content");
  },
});

devTest("SSG pages router - named import edge case", {
  framework: "react",
  fixture: "ssg-pages-router",
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
    "posts/hello-world.txt": "This is the content of hello world post",
    "posts/second-post.txt": "This is the second post content",
  },
  async test(dev) {
    // Should not error
    await using c1 = await dev.client("/");
    expect(await c1.elemText("h1")).toBe("Welcome to SSG");
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
    // Test single segment
    await using c1 = await dev.client("/docs");
    expect(await c1.elemText("h1")).toBe("Catch-all Route");
    expect(await c1.elemText("#params")).toBe('{"slug":"docs"}');
    expect(await c1.elemsText("li")).toEqual(["No slug array"]);

    // Test two segments
    await using c2 = await dev.client("/docs/getting-started");
    expect(await c2.elemText("h1")).toBe("Catch-all Route");
    expect(await c2.elemText("#params")).toBe('{"slug":["docs","getting-started"]}');
    expect(await c2.elemsText("li")).toEqual(["docs", "getting-started"]);

    // Test three segments
    await using c3 = await dev.client("/docs/api/reference");
    expect(await c3.elemText("h1")).toBe("Catch-all Route");
    expect(await c3.elemText("#params")).toBe('{"slug":["docs","api","reference"]}');
    expect(await c3.elemsText("li")).toEqual(["docs", "api", "reference"]);

    // Test four segments
    await using c4 = await dev.client("/blog/2024/january/new-features");
    expect(await c4.elemText("h1")).toBe("Catch-all Route");
    expect(await c4.elemText("#params")).toBe('{"slug":["blog","2024","january","new-features"]}');
    expect(await c4.elemsText("li")).toEqual(["blog", "2024", "january", "new-features"]);
  },
});
