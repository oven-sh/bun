type IAmIncredibleLongParameterType = {};
const IAmAnotherFunctionName = (_0: IAmIncredibleLongParameterType) => {};
export const IAmIncredibleLongFunctionName = IAmAnotherFunctionName(
  (_0: IAmIncredibleLongParameterType) => {
    setTimeout(() => {
      /*
          Multiline comment
          Multiline comment
          Multiline comment
      */
      console.log(
        'Multiline string\
         Multiline string\
         Multiline string'
      );
      console.log(
        `Multiline \n string\
         Multiline string\
         Multiline string`
      );
    });
  }
);
