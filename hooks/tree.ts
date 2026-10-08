// Problem maps: an indented text tree of what the session is working on,
// written by a fork of the agent and drawn in the pane beside the diagrams.

export const ASK_PROBLEM_MAP = [
  'Pause the work for a moment. Do not use tools.',
  'Draw a problem map of what we are working on in this session, as a plain text tree.',
  'Use exactly this shape, and nothing before or after it:',
  '',
  'Problem: <the business problem, two or three plain sentences, said to the person as "you want ...":',
  '  what they are trying to get done and why it matters to them, then the limits they set. No tool or code names.>',
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
  '- Start from the person\'s goal, not from the code: group 1 is WHY, what changes for them when this works.',
  '- Then 3 to 7 more groups, such as WHAT, HOW, WHEN, WHERE it lives, WHERE results go, WHAT the person sees, SAFETY.',
  '- Each group has 2 to 4 items. Each item is one line under 60 characters.',
  '- Use the real names, numbers and decisions from this session. Mark open questions with "?".',
  '- Plain everyday words a high school student would understand.',
  '- Use the characters │ ├── └── exactly as shown.',
].join('\n')

export const ASK_SESSION_TOC = [
  'Pause the work for a moment. Do not use tools.',
  'Write a table of contents of this whole session, as a plain text tree.',
  'Use exactly this shape, and nothing before or after it:',
  '',
  'Session: <what this session was about, in under eight words>',
  '│',
  '├── 1. <topic>',
  '│   ├── <what was done> [seen]',
  '│   └── Decided: <a choice the person made>',
  '├── 2. <topic>',
  '│   └── <...> [tested]',
  '└── Open',
  '    └── <something unfinished>',
  '',
  'Rules:',
  '- 3 to 8 numbered topics, in the order they happened.',
  '- Each topic has 2 to 5 items. Each item is one line under 60 characters.',
  '- End each finished item with one tag: [seen] if it was shown working on screen,',
  '  [tested] if it was only checked by tests or commands, [live] if it is published or running for real.',
  '- Start a choice the person made with "Decided:". Decisions take no tag.',
  '- Put real file paths, repo names and commands in items where they help find the work.',
  '- The last group is Open: what is unfinished or never seen working. If nothing, one item: nothing open.',
  '- Plain everyday words a high school student would understand.',
  '- Use the characters │ ├── └── exactly as shown.',
].join('\n')

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * The person's typed prompts with local times, one line each, from the output
 * of `date +%z` followed by the transcript rows grep picked out.
 */
export function parsePromptTimes(stdout: string, max = 60): string[] {
  const [zone = '+0000', ...rows] = stdout.split('\n')
  const z = /^([+-])(\d\d)(\d\d)$/.exec(zone.trim())
  const offset = z ? (z[1] === '-' ? -1 : 1) * (Number(z[2]) * 60 + Number(z[3])) * 60000 : 0
  const lines: string[] = []
  for (const row of rows) {
    if (row.trim() === '') continue
    try {
      const d = JSON.parse(row) as { timestamp?: string; message?: { content?: unknown } }
      const text = d.message?.content
      const at = Date.parse(d.timestamp ?? '')
      if (typeof text !== 'string' || Number.isNaN(at)) continue
      const t = new Date(at + offset)
      const hh = String(t.getUTCHours()).padStart(2, '0')
      const mm = String(t.getUTCMinutes()).padStart(2, '0')
      const said = text.replace(/\s+/g, ' ').trim().slice(0, 80)
      lines.push(`${MONTHS[t.getUTCMonth()]} ${t.getUTCDate()} ${hh}:${mm}  ${said}`)
    } catch {
      // A row cut short or not JSON: skip it.
    }
  }

  return lines.slice(-max)
}

/** The table of contents prompt, with the person's prompt times when there are any. */
export function tocPrompt(times: string[]): string {
  if (times.length === 0) return ASK_SESSION_TOC

  return [
    ASK_SESSION_TOC,
    '- Start each numbered topic with the local time it began, taken from the list below:',
    '  "├── 1. 22:45 First version". When topics span days, give the day at each change: "├── 4. Oct 7 15:00 ...".',
    '',
    'The person\'s own messages in this session, with local times:',
    ...times,
  ].join('\n')
}

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

const HEAD = /^(Problem|Session):/

/** True when the text looks like a tree: a Problem or Session line and some branches. */
export function isTree(text: string): boolean {
  return /^(Problem|Session):/m.test(text) && /[├└]──/.test(text)
}

/** The tree's own title: its short head line (the second Problem line of a map), else the first. */
export function treeTitle(text: string): string {
  const heads = text.split('\n').filter(line => HEAD.test(line))
  const pick = heads.length > 1 ? heads[1] : heads[0]

  return (pick ?? 'Session').replace(HEAD, '').trim().slice(0, 60)
}

/** Colors for the state tags a table of contents ends its items with. */
const TAG_COLORS: Record<string, string> = { seen: '#a6e3a1', live: '#89b4fa', tested: '#f9e2af' }

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
  if (HEAD.test(line)) return [{ text: line, bold: true }]
  const glyphs = /^[│├└─\s]*/.exec(line)?.[0] ?? ''
  const rest = line.slice(glyphs.length)
  const runs: TreeRun[] = []
  if (glyphs !== '') runs.push({ text: glyphs, color: GLYPH_COLOR })
  if (rest === '') return runs.length > 0 ? runs : [{ text: ' ' }]
  const heading = /^\d+\.\s/.test(rest)
  const hue = GROUP_COLORS[(Math.max(group, 1) - 1) % GROUP_COLORS.length]
  if (heading) {
    const timed = /^(\d+\.\s)((?:[A-Z][a-z]{2} \d{1,2} )?\d{1,2}:\d{2}\s+)(.*)$/.exec(rest)
    if (timed) runs.push({ text: timed[1]!, color: hue, bold: true }, { text: timed[2]!, color: GLYPH_COLOR }, { text: timed[3]!, color: hue, bold: true })
    else runs.push({ text: rest, color: hue, bold: true })
    return runs
  }
  if (rest === 'Open') {
    runs.push({ text: rest, color: '#f38ba8', bold: true })
    return runs
  }
  const tag = /^(.*?)(\s*)\[(seen|tested|live)\]$/.exec(rest)
  if (tag) {
    runs.push({ text: `${tag[1]}${tag[2]}` }, { text: `[${tag[3]}]`, color: TAG_COLORS[tag[3]!] })
    return runs
  }
  const decided = /^Decided:/.test(rest)
  runs.push(decided ? { text: rest, color: '#cba6f7' } : { text: rest })

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
