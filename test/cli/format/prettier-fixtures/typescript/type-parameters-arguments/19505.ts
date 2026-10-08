createObject<{
        // dangling comment
        [key in keyof Function]: TypeInfo | null
    }>()

createObject<
// comment
{
        [key in keyof Function]: TypeInfo | null
    }>()

createObject<
{
        [key in keyof Function]: TypeInfo | null
    }
// comment
>()

foo<{
  // comment
}>();

foo<[
  // comment
]>();
