import { BuildOutput, BuildConfig } from "bun";

/**
 * Like Bun.build but doesn't throw like the old way because all the tests break and we have to ship bun 1.2 in 4 hours lol hahaha
 */
export async function buildNoThrow(config: BuildConfig): Promise<BuildOutput> {
  let build: BuildOutput;
  try {
    build = await Bun.build(config);
  } catch (e) {
    const err = e as AggregateError;
    build = {
      outputs: [],
      success: false,
      logs: err.errors,
    };
  }
  return build;
}
