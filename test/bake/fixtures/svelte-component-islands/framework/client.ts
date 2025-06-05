import type { IslandMap } from "./server";
import { hydrate } from 'svelte';

declare var $islands: IslandMap;
Object.entries($islands).forEach(async([moduleId, islands]) => {
    const mod = await import(moduleId);
    for(const [islandId, exportId, props] of islands) {
        const elem = document.getElementById(`I:${islandId}`)!;
        hydrate(mod[exportId], {
            target: elem,
            props,
        });
    }
});
