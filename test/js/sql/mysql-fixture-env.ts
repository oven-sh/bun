import { expect } from "bun:test";
expect(Bun.sql.options.adapter).toBe("mysql");
const result = await Bun.sql`select 1 as x`;
expect(result).toEqual([{ x: 1 }]);
