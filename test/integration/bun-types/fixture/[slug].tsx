// This page test can return once we implement ssg/ssr/rsc again

// import { join } from "path";
// import { expectType } from "./utilities";

// // we're just checking types here really
// declare function markdownToJSX(markdown: string): React.ReactNode;

// type Params = {
//   slug: string;
// };

// const Index: Bun.__experimental.SSGPage<Params> = async ({ params }) => {
//   expectType(params.slug).is<string>();

//   const content = await Bun.file(join(process.cwd(), "posts", params.slug + ".md")).text();
//   const node = markdownToJSX(content);

//   return <div>{node}</div>;
// };

// expectType(Index.displayName).is<string | undefined>();

// export default Index;

// export const getStaticPaths: Bun.__experimental.GetStaticPaths<Params> = async () => {
//   const glob = new Bun.Glob("**/*.md");
//   const postsDir = join(process.cwd(), "posts");
//   const paths: Bun.__experimental.SSGPaths<Params> = [];

//   for (const file of glob.scanSync({ cwd: postsDir })) {
//     const slug = file.replace(/\.md$/, "");

//     paths.push({
//       params: { slug },
//     });
//   }

//   return { paths };
// };

export {};
