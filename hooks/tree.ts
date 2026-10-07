// Problem maps: an indented text tree of what the session is working on,
// written by a fork of the agent and drawn in the pane beside the diagrams.

export const ASK_PROBLEM_MAP = [
  'Pause the work for a moment. Do not use tools.',
  'Draw a problem map of what we are working on in this session, as a plain text tree.',
  'Use exactly this shape, and nothing before or after it:',
  '',
  'Problem: <two or three plain sentences: what is wanted, and the constraints that shape it>',
  '',
  'Problem: <the same problem in under eight words>',
  '│',
  '├── 1. WHAT <short heading>',
  '│   ├── <one fact or decision>',
  '│   └── <one fact or decision>',
  '├── 2. HOW <short heading>',
  '│   └── <...>',
  '└── 7. <last group>',
  '    └── <...>',
  '',
  'Rules:',
  '- 4 to 8 numbered groups, such as WHAT, HOW, WHEN, WHERE it lives, WHERE results go, WHAT the person sees, SAFETY.',
  '- Each group has 2 to 4 items. Each item is one line under 60 characters.',
  '- Use the real names, numbers and decisions from this session. Mark open questions with "?".',
  '- Plain everyday words a high school student would understand.',
  '- Use the characters │ ├── └── exactly as shown.',
].join('\n')

/** Pastels for the numbered groups, in turn (Catppuccin Mocha). */
const GROUP_COLORS = ['#f5c2e7', '#89b4fa', '#a6e3a1', '#f9e2af', '#cba6f7', '#94e2d5', '#fab387', '#f38ba8']
const GLYPH_COLOR = '#9399b2'

/** The tree text out of a reply: code fences and blank edges dropped. */
export function cleanTree(reply: string): string {
  return reply
    .replace(/^\s*```[a-z]*\s*\n/i, '')
    .replace(/\n\s*```\s*$/, '')
    .replace(/[ \t]+$/gm, '')
    .trim()
}

/** True when the text looks like a tree: a Problem line and some branches. */
export function isTree(text: string): boolean {
  return /^Problem:/m.test(text) && /[├└]──/.test(text)
}

/** The tree's own title: its short Problem line, else the first one. */
export function treeTitle(text: string): string {
  const problems = text.split('\n').filter(line => line.startsWith('Problem:'))
  const pick = problems.length > 1 ? problems[1] : problems[0]

  return (pick ?? 'Problem map').replace(/^Problem:\s*/, '').slice(0, 60)
}

/**
 * Wraps one tree line to a width, carrying its branch glyphs down so the
 * wrapped words stay under their branch.
 */
export function wrapTreeLine(line: string, width: number): string[] {
  const chars = [...line]
  if (chars.length <= width) return [line]
  const prefix = /^[│├└─\s]*(?:\d+\.\s)?/.exec(line)?.[0] ?? ''
  const carry = [...prefix].map(ch => (ch === '├' ? '│' : ch === '└' || ch === '─' ? ' ' : ch)).join('').replace(/\d+\.\s$/, m => ' '.repeat(m.length))
  const words = chars.slice([...prefix].length).join('').split(/\s+/)
  const out: string[] = []
  let current = prefix
  let used = [...prefix].length
  let hasWords = false
  for (const word of words) {
    const size = [...word].length
    if (hasWords && used + size > width) {
      out.push(current.trimEnd())
      current = carry
      used = [...carry].length
    }
    current += `${word} `
    used += size + 1
    hasWords = true
  }
  out.push(current.trimEnd())

  return out
}

export type TreeRun = { text: string; color?: string; bold?: boolean; dim?: boolean }

/** One tree line as colored runs; `group` is the number of the group the line sits in, 0 above the first. */
export function paintTreeLine(line: string, group: number): TreeRun[] {
  if (line.startsWith('Problem:')) return [{ text: line, bold: true }]
  const glyphs = /^[│├└─\s]*/.exec(line)?.[0] ?? ''
  const rest = line.slice(glyphs.length)
  const runs: TreeRun[] = []
  if (glyphs !== '') runs.push({ text: glyphs, color: GLYPH_COLOR })
  if (rest === '') return runs.length > 0 ? runs : [{ text: ' ' }]
  const heading = /^\d+\.\s/.test(rest)
  const hue = GROUP_COLORS[(Math.max(group, 1) - 1) % GROUP_COLORS.length]
  runs.push(heading ? { text: rest, color: hue, bold: true } : { text: rest })

  return runs
}

/** The group number for each line: a "N." heading starts group N. */
export function groupsOf(lines: string[]): number[] {
  let group = 0

  return lines.map(line => {
    const m = /^[│├└─\s]*(\d+)\.\s/.exec(line)
    if (m) group = Number(m[1])

    return group
  })
}
