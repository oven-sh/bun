declare module "astro:actions" {
	type Actions = typeof import("/workspace/bun/test/js/third_party/astro/fixtures/src/actions")["server"];

	export const actions: Actions;
}