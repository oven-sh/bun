const randomFuncion = (value) => {
    if (value.a) {
        funcA(
            "",
            funcB(
                dayjs(value.a?.toString())
                      .add(1, "day")
                      .toISOString()
            )
        );
    }
};
