const yesFrame = (
    ...args: Interpolation<ThemedStyledProps<{}, Theme>>[]
) => css`
    ${ChatRoot}[data-frame="yes"] & {
        ${css({}, ...args)}
    }
`
