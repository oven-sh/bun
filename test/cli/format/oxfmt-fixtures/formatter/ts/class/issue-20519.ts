// Long decorator + union type: decorator should go on its own line
class SlSlider extends ShoelaceElement {
  @property({ attribute: 'tooltip-placement', reflect: true }) tooltipPlacement: 'top' | 'right' |
'bottom' | 'left' =
    'top';
}

// Short decorator + long union type: decorator should stay inline
class WaTooltip extends WebAwesomeElement {
  @property() placement:
    | "top"
    | "top-start"
    | "top-end"
    | "right"
    | "right-start"
    | "right-end"
    | "bottom"
    | "bottom-start"
    | "bottom-end"
    | "left"
    | "left-start"
    | "left-end" = "bottom";
}
