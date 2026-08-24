// Conduit brand wordmark: the application mark beside the product name.
// Letterforms render as live text in the theme's own font, so the wordmark
// tracks UI typography instead of pinning path outlines.

import type { IconProps } from './icons/props.ts'
import { CONDUIT_MARK_PATH } from './ConduitMark.tsx'

/** Height of the wordmark row; the mark is square and the text centers on it. */
const HEIGHT = 24
/** Mark box plus the gap and the rendered text width at the chosen font size. */
const WIDTH = 118
/** The mark's native 700-unit bounds scaled into the 24px row, centered. */
const MARK_SCALE = HEIGHT / 700

/**
 * Render the full brand wordmark.
 * @param props.size - height in px (default 24; width keeps the fixed ratio).
 * @param props.className - extra class for layout placement.
 * @returns the wordmark svg (aria-hidden decorative brand art).
 */
export function ConduitWordmark({ size = HEIGHT, className }: IconProps) {
  return (
    <svg
      width={(size * WIDTH) / HEIGHT}
      height={size}
      className={className}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      fill="none"
      aria-hidden="true"
    >
      <g transform={`translate(${HEIGHT / 2} ${HEIGHT / 2}) scale(${MARK_SCALE}) translate(-550 -550)`}>
        <path d={CONDUIT_MARK_PATH} fill="#35e888" />
      </g>
      <text
        x={34}
        y={HEIGHT / 2}
        dominantBaseline="central"
        fill="currentColor"
        fontFamily="inherit"
        fontSize={19}
        fontWeight={700}
        letterSpacing="0.5"
      >
        Conduit
      </text>
    </svg>
  )
}
