// Conduit application mark: the circuit "C" tile from the brand master
// (assets/branding/app-logo.source.svg), background plate dropped so the mark
// sits on any surface. Brand green is fixed — a logo does not ride theme ink.

/** The mark's path in its native 1100-unit tile space (bounds 200..900). */
export const CONDUIT_MARK_PATH = 'M770,200A30,30 0 0 1 800,230L800,270A30,30 0 0 0 830,300L870,300A30,30 0 0 1 900,330L900,370A30,30 0 0 1 870,400L730,400A30,30 0 0 1 700,370L700,330A30,30 0 0 0 670,300L630,300A30,30 0 0 0 600,330L600,370A30,30 0 0 1 570,400L430,400A30,30 0 0 0 400,430L400,470A30,30 0 0 0 430,500L470,500A30,30 0 0 1 500,530L500,570A30,30 0 0 1 470,600L430,600A30,30 0 0 0 400,630L400,670A30,30 0 0 0 430,700L570,700A30,30 0 0 1 600,730L600,770A30,30 0 0 0 630,800L670,800A30,30 0 0 0 700,770L700,730A30,30 0 0 1 730,700L870,700A30,30 0 0 1 900,730L900,770A30,30 0 0 1 870,800L830,800A30,30 0 0 0 800,830L800,870A30,30 0 0 1 770,900L430,900A30,30 0 0 1 400,870L400,830A30,30 0 0 0 370,800L330,800A30,30 0 0 1 300,770L300,730A30,30 0 0 0 270,700L230,700A30,30 0 0 1 200,670L200,630A30,30 0 0 1 230,600L270,600A30,30 0 0 0 300,570L300,530A30,30 0 0 0 270,500L230,500A30,30 0 0 1 200,470L200,430A30,30 0 0 1 230,400L270,400A30,30 0 0 0 300,370L300,330A30,30 0 0 1 330,300L370,300A30,30 0 0 0 400,270L400,230A30,30 0 0 1 430,200ZM670,500A30,30 0 0 1 700,530L700,570A30,30 0 0 1 670,600L630,600A30,30 0 0 1 600,570L600,530A30,30 0 0 1 630,500Z'

import type { IconProps } from './icons/props.ts'

/**
 * Render the Conduit mark.
 * @param props.size - width in px (default 24; the mark is square).
 * @param props.className - extra class for layout placement.
 * @returns the mark svg (aria-hidden; pair with text for accessibility).
 */
export function ConduitMark({ size = 24, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      className={className}
      viewBox="150 150 800 800"
      fill="none"
      aria-hidden="true"
    >
      <path d={CONDUIT_MARK_PATH} fill="#35e888" />
    </svg>
  )
}
