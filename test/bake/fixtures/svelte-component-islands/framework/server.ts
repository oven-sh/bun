/// <reference path="../../../../../src/bake/bake.d.ts" />
import type { Bake } from "bun";
import * as svelte from "svelte/server";
import { uneval } from "devalue";

export function render(req: Request, meta: Bake.RouteMetadata) {
  isInsideIsland = false;
  islands = {};
  const { body, head } = svelte.render(meta.pageModule.default, {
    props: {
      params: meta.params,
    },
  });

  // Add stylesheets and preloaded modules to the head
  const extraHead = meta.styles.map((style) => `<link rel="stylesheet" href="${style}">`).join("")
    + meta.modulepreload.map((style) => `<link rel="modulepreload" href="${style}">`).join("");
  // Script tags
  const scripts = nextIslandId > 0
    ? `<script>self.$islands=${uneval(islands)}</script>` +
      meta.modules.map((module) => `<script type="module" src="${module}"></script>`).join("")
    : ""; // If no islands, no JavaScript

  return new Response(
    "<!DOCTYPE html><html><head>" + head + extraHead + "</head><body>"
      + body + "</body>" + scripts + "</html>",
    { headers: { "content-type": "text/html" } },
  );
}

// To allow static site generation, frameworks can specify a prerender function
export function prerender(meta: Bake.RouteMetadata) {
  return {
    files: {
      '/index.html': render(null!, meta),
    },
  };
}

let isInsideIsland = false;
let nextIslandId = 0;
let islands: IslandMap;
export type IslandMap = Record<string, Island[]>;
export type Island = [islandId: number, exportId: string, props: any];

/**
 * @param component The original export value, as is.
 * @param clientModuleId A string that the browser will pass to `import()`.
 * @param clientExportId The export ID from the imported module.
 * @returns A wrapped value for the export.
 */
export function registerClientReference(
  component: Function,
  clientModuleId: string,
  clientExportId: string,
) {
  return function Island(...args: any[]) {
    if (isInsideIsland) {
      return component(...args);
    }
    isInsideIsland = true;
    const [payload, props] = args;
    const islandId = nextIslandId++;
    payload.out += `<bake-island id="I:${islandId}">`;
    const file = (islands[clientModuleId] ??= []);
    file.push([islandId, clientExportId, props]);
    component(...args);
    payload.out += `</bake-island>`;
    isInsideIsland = false;
  };
}
