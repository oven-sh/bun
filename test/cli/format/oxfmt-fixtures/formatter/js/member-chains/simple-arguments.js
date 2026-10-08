// `TaggedTemplateExpression` shouldn't be treated as a simple argument
// https://github.com/oxc-project/oxc/issues/16956
utc("time_updated")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)`)
