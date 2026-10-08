testFunc<
//#region
{
    testProp: number
}
//#endregion
>(parserFunc`
Some multiline string
In here`);

testFunc(
//#region
{
    testProp: number
}
//#endregion
)
