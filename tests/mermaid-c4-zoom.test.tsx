import type { On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { paint } from '../hooks/paint'
import { paintTreeLine, parsePromptTimes, tocPrompt, wrapTreeLine } from '../hooks/tree'
import { drawMermaid, labelOf, markZoomable, mermaidBlocks, padLabels } from '../hooks/register'

const PANE = {
  plugin: 'mermaid-c4-zoom',
  surface: 'terminal',
  component: 'Pane',
  requestId: 'diagrams',
  props: { title: 'Diagrams', isFocused: false, bodyColumns: 60, placement: 'dock' },
} as const

const DONE = {
  durationMs: 1000,
  isAborted: false,
  reason: 'answer',
  category: null,
  explanation: null,
} as const

const FLOW = 'graph TD\n  A[Start] --> B[Build]\n  B --> C[Ship]'

function seat(on: On) {
  const seen = { opened: [] as string[], shown: false }
  on('session.start', () => ({ cwd: '/x' }) as any)
  on('tool.register', ($, e) => ({ value: { tool: `mcp__mermaid-c4-zoom__${e.name}` } }) as any)
  on('command.register', () => ({ value: undefined }) as any)
  on('ui.panes', () => ({ value: seen.shown ? [{ id: 'diagrams', title: 'Diagrams', isShown: true, isFocused: false, isPlaced: true }] : [] }) as any)
  on('ui.open', ($, e) => {
    seen.opened.push(e.id)
    seen.shown = true

    return { value: { isShown: true } } as any
  })
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))

  return seen
}

async function start($: Engine) {
  await $.session.start({ cwd: '/x' } as any)

  return $.ui.mount(PANE as any)
}

describe('drawMermaid', () => {
  test('draws a flowchart as box art', () => {
    const drawn = drawMermaid(FLOW)
    expect('art' in drawn).toBe(true)
    if ('art' in drawn) {
      expect(drawn.art).toContain('Start')
      expect(drawn.art).toContain('Ship')
    }
  })

  test('reports a bad diagram instead of throwing', () => {
    expect('error' in drawMermaid('pie\n  "a": 1')).toBe(true)
  })
})

describe('paint', () => {
  test('rounds corners and gives each box its own color', () => {
    const drawn = drawMermaid(FLOW)
    if (!('art' in drawn)) throw new Error(drawn.error)
    expect(drawn.art).toContain('╭')
    expect(drawn.art).not.toContain('┌')
    const rows = drawn.art.split('\n')
    const colors = paint(drawn.art)
    const hueOf = (word: string) => {
      const r = rows.findIndex(row => row.includes(word))
      return colors[r]?.[[...rows[r]!].indexOf(word[0]!)]
    }
    expect(hueOf('Start')).toBeDefined()
    expect(hueOf('Start')).not.toEqual(hueOf('Build'))
  })
})

describe('padLabels', () => {
  test('pads box and diamond label lines, leaves special shapes alone', () => {
    const out = padLabels('graph TD\n  A["Hi<br>there"] --> B{ok?}\n  B --> C[(db)]')
    expect(out).toContain('A["\u00a0Hi\u00a0<br>\u00a0there\u00a0"]')
    expect(out).toContain('B{\u00a0ok?\u00a0}')
    expect(out).toContain('C[(db)]')
  })

  test('only touches flowcharts', () => {
    expect(padLabels('sequenceDiagram\n  A->>B: [x]')).toBe('sequenceDiagram\n  A->>B: [x]')
  })
})

describe('mermaidBlocks', () => {
  test('finds each mermaid block and skips other code', () => {
    const reply = `Here:\n\n\`\`\`mermaid\n${FLOW}\n\`\`\`\n\n\`\`\`ts\nconst x = 1\n\`\`\`\n\n\`\`\`mermaid\nsequenceDiagram\n  A->>B: hi\n\`\`\``
    expect(mermaidBlocks(reply)).toEqual([FLOW, 'sequenceDiagram\n  A->>B: hi'])
  })
})

describe('diagrams pane', () => {
  test('the tool draws into the pane and opens it', async ($, on) => {
    const seen = seat(on)
    const ui = await start($)

    const ran = await $.tool.call({ tool: 'mcp__mermaid-c4-zoom__show_diagram', title: 'Release flow', mermaid: FLOW } as any)
    expect(JSON.stringify(ran)).toContain('Shown in the diagrams pane')
    expect(seen.opened).toEqual(['diagrams'])
    expect(await ui.find({ text: 'Release flow' })).toBeDefined()
    expect(JSON.stringify(await ui.drawn())).toContain('Build')
  })

  test('a diagram that does not parse comes back to the agent as an error', async ($, on) => {
    seat(on)
    await start($)

    const ran = await $.tool.call({ tool: 'mcp__mermaid-c4-zoom__show_diagram', title: 'x', mermaid: 'pie\n "a": 1' } as any)
    expect(JSON.stringify(ran)).toContain('did not parse')
  })

  test('a mermaid block in a reply lands in the pane; arrows page between diagrams', async ($, on) => {
    seat(on)
    const ui = await start($)

    await $.tool.call({ tool: 'mcp__mermaid-c4-zoom__show_diagram', title: 'First', mermaid: FLOW } as any)
    await $.turn.start({ text: 'draw', turnId: 't1' })
    await $.turn.complete({ ...DONE, turnId: 't1', answer: '```mermaid\nsequenceDiagram\n  Alice->>Bob: hello\n```' })
    expect(await ui.find({ text: '2/2' })).toBeDefined()
    expect(JSON.stringify(await ui.drawn())).toContain('Alice')

    await ui.press({ key: 'prev' })
    expect(await ui.find({ text: '1/2' })).toBeDefined()
    expect(await ui.find({ text: 'First' })).toBeDefined()
  })
})

const CONTEXT = 'graph TD\n  U["Users"] --> APP["App servers<br>many clones"]\n  APP --> DB["Postgres"]'
const INSIDE = 'graph TD\n  API["API"] --> W["Worker"]'

describe('zoom levels', () => {
  test('labelOf and markZoomable find and mark the first label line', () => {
    expect(labelOf(CONTEXT, 'APP')).toBe('App servers')
    expect(labelOf(CONTEXT, 'NOPE')).toBeUndefined()
    expect(markZoomable(CONTEXT, ['APP'])).toContain('APP["App servers ▸<br>many clones"]')
  })

  test('clicking a marked box goes one level in, up comes back', async ($, on) => {
    seat(on)
    const ui = await start($)

    const ran = await $.tool.call({
      tool: 'mcp__mermaid-c4-zoom__show_diagram',
      title: 'Web app',
      mermaid: CONTEXT,
      zoom: { APP: { title: 'Inside the app', mermaid: INSIDE } },
    } as any)
    expect(JSON.stringify(ran)).toContain('1 zoomed level inside')
    expect(await ui.find({ type: 'Button', text: 'App servers ▸' })).toBeDefined()

    await ui.press({ key: 'zoom-APP' })
    expect(await ui.find({ text: 'Inside the app' })).toBeDefined()
    expect(JSON.stringify(await ui.drawn())).toContain('Worker')

    await ui.press({ key: 'up' })
    expect(JSON.stringify(await ui.drawn())).toContain('Postgres')
    expect(await ui.find({ text: 'Inside the app' })).toBeUndefined()
  })

  test('a zoom key that names no node is refused with the reason', async ($, on) => {
    seat(on)
    await start($)

    const ran = await $.tool.call({
      tool: 'mcp__mermaid-c4-zoom__show_diagram',
      title: 'Web app',
      mermaid: CONTEXT,
      zoom: { CACHE: { title: 'x', mermaid: INSIDE } },
    } as any)
    expect(JSON.stringify(ran)).toContain('no [box] or {diamond} node with that id')
  })
})

const MAP = [
  'Problem: you want to see which companies are behind the jobs you are shown.',
  '',
  'Problem: know who is behind each job I am shown',
  '│',
  '├── 1. WHAT to look up',
  '│   ├── Only companies in my final job list, not all 5.1M jobs',
  '│   └── Skip companies already looked up (152 done)',
  '└── 2. WHEN it runs',
  '    └── By itself, once my final list exists',
].join('\n')

describe('problem maps', () => {
  test('a long item wraps under its own branch', () => {
    const rows = wrapTreeLine('│   ├── Only companies in my final job list, not all 5.1M jobs', 34)
    expect(rows).toEqual(['│   ├── Only companies in my final', '│   │   job list, not all 5.1M', '│   │   jobs'])
    expect(rows.every(row => [...row].length <= 34)).toBe(true)
  })

  test('map this session asks a fork and draws its tree', async ($, on) => {
    seat(on)
    const asked: string[] = []
    on('model.fork', ($, e) => {
      asked.push(e.prompt)

      return { value: { isAnswered: true, text: '```\n' + MAP + '\n```', usage: {} } } as any
    })
    const ui = await start($)

    await ui.press({ key: 'map' })
    expect(asked[0]).toContain('problem map')
    expect(await ui.find({ text: 'know who is behind each job I am shown' })).toBeDefined()
    expect(JSON.stringify(await ui.drawn())).toContain('1. WHAT to look up')
  })

  test('/diagrams map starts the same thing', async ($, on) => {
    seat(on)
    const clock = mock.clock(on)
    let forks = 0
    on('model.fork', () => {
      forks += 1

      return { value: { isAnswered: true, text: MAP, usage: {} } } as any
    })
    await $.session.start({ cwd: '/x' } as any)

    const said = await $.command.run({ command: 'diagrams', args: 'map' } as any)
    expect(JSON.stringify(said)).toContain('Mapping this session')
    await clock.advance(1)
    expect(forks).toBe(1)
  })
})

const TOC = [
  'Session: a diagrams side pane for Claude Code',
  '│',
  '├── 1. First version',
  '│   ├── Side pane draws mermaid as text art [seen]',
  '│   └── Decided: name it mermaid-c4-zoom',
  '└── Open',
  '    └── Problem map never seen on screen',
].join('\n')

describe('table of contents', () => {
  test('state tags get their own color, decisions and Open stand out', () => {
    const seen = paintTreeLine('│   ├── Side pane draws mermaid as text art [seen]', 1)
    expect(seen.at(-1)).toEqual({ text: '[seen]', color: '#a6e3a1' })
    expect(paintTreeLine('│   └── Decided: name it', 1).at(-1)?.color).toBe('#cba6f7')
    expect(paintTreeLine('└── Open', 1).at(-1)).toMatchObject({ text: 'Open', bold: true })
  })

  test('the table of contents button asks a fork and draws the tree', async ($, on) => {
    seat(on)
    const asked: string[] = []
    on('model.fork', ($, e) => {
      asked.push(e.prompt)

      return { value: { isAnswered: true, text: TOC, usage: {} } } as any
    })
    const ui = await start($)

    await ui.press({ key: 'toc' })
    expect(asked[0]).toContain('table of contents')
    expect(await ui.find({ text: 'a diagrams side pane for Claude Code' })).toBeDefined()
    expect(JSON.stringify(await ui.drawn())).toContain('[seen]')
  })
})

describe('prompt times', () => {
  const row = (ts: string, content: unknown) => JSON.stringify({ type: 'user', message: { role: 'user', content }, timestamp: ts, origin: { kind: 'human' } })

  test('turns transcript rows into local times and short prompts', () => {
    const out = ['+0300', row('2026-10-06T20:45:54.234Z', 'Can you make a mod\nthat draws diagrams?'), row('2026-10-07T13:00:00Z', [{ type: 'text' }]), 'not json', ''].join('\n')
    expect(parsePromptTimes(out)).toEqual(['Oct 6 23:45  Can you make a mod that draws diagrams?'])
  })

  test('the table of contents asks for times only when there are some', () => {
    expect(tocPrompt([])).not.toContain('local time')
    expect(tocPrompt(['Oct 6 23:45  hi'])).toContain('Oct 6 23:45  hi')
  })

  test('a timed topic heading draws its time in gray', () => {
    const runs = paintTreeLine('├── 1. 23:45 First version', 1)
    expect(runs.map(r => r.text)).toEqual(['├── ', '1. ', '23:45 ', 'First version'])
    expect(runs[2]?.color).toBe('#9399b2')
  })
})
