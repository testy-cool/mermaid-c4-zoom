// Colors for diagram text art. Adapted from prismantis hooks/mermaid.tsx
// (MIT): each box gets its own pastel, the same label keeps its color,
// arrows get the accent, lines stay quiet.

/** Catppuccin Mocha pastels, one per box, in turn. */
const BOX_COLORS = ['#f5c2e7', '#89b4fa', '#a6e3a1', '#f9e2af', '#cba6f7', '#94e2d5', '#fab387']
const LINE_COLOR = '#7f849c'
const ARROW_COLOR = '#f5c2e7'
const TEXT_COLOR = '#cdd6f4'

const LINE = /[─-╿◇]/
const ARROW = /[►◄▲▼▶◀]/
const ROUND: Record<string, string> = { '┌': '╭', '┐': '╮', '└': '╰', '┘': '╯' }

/** Swaps square corners for round ones, boxes and line bends alike. */
export function roundCorners(art: string): string {
  return art.replace(/[┌┐└┘]/g, ch => ROUND[ch] ?? ch)
}

type Box = { r: number; c: number; r2: number; c2: number }

/** A color for every cell of the art, row by row. */
export function paint(art: string): (string | undefined)[][] {
  const grid = art.split('\n').map(line => [...line])
  const cell = (r: number, c: number) => grid[r]?.[c] ?? ''
  const color: (string | undefined)[][] = grid.map(row => row.map(() => undefined))
  const labels = new Map<string, string>()

  const boxes: Box[] = []
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < (grid[r]?.length ?? 0); c++) {
      if (!/[┌╭(]/.test(cell(r, c))) continue
      let c2 = c + 1
      while (/[─┬┴┼▲▼]/.test(cell(r, c2))) c2++
      if (!/[┐╮)]/.test(cell(r, c2)) || c2 === c + 1) continue
      let r2 = r + 1
      while (/[│├┤┼►◄▶◀]/.test(cell(r2, c))) r2++
      if (!/[└╰(]/.test(cell(r2, c)) || !/[┘╯)]/.test(cell(r2, c2))) continue
      boxes.push({ r, c, r2, c2 })
    }
  }
  const inside = (a: Box, b: Box) => a !== b && b.r > a.r && b.r2 < a.r2 && b.c > a.c && b.c2 < a.c2
  for (const box of boxes.filter(a => !boxes.some(b => inside(a, b)))) {
    const { r, c, r2, c2 } = box
    const label = grid
      .slice(r + 1, r2)
      .map(row => row.slice(c + 1, c2).join(''))
      .join(' ')
      .trim()
    if (!labels.has(label)) labels.set(label, BOX_COLORS[labels.size % BOX_COLORS.length]!)
    const hue = labels.get(label)
    for (let y = r; y <= r2; y++) for (let x = c; x <= c2; x++) if (cell(y, x).trim()) color[y]![x] = hue
  }

  grid.forEach((row, r) =>
    row.forEach((ch, c) => {
      if (color[r]![c] !== undefined || ch.trim() === '') return
      if (ARROW.test(ch)) color[r]![c] = ARROW_COLOR
      else if (LINE.test(ch)) color[r]![c] = LINE_COLOR
      else color[r]![c] = TEXT_COLOR
    }),
  )

  return color
}

/** One art line as runs of same-colored text. */
export function runs(line: string, colors: (string | undefined)[] | undefined): { text: string; color?: string }[] {
  const chars = [...line]
  const out: { text: string; color?: string }[] = []
  let at = 0
  while (at < chars.length) {
    const hue = colors?.[at]
    let end = at + 1
    while (end < chars.length && colors?.[end] === hue) end++
    out.push({ text: chars.slice(at, end).join(''), color: hue })
    at = end
  }

  return out
}
