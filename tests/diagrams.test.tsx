import type { On } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { drawMermaid, mermaidBlocks } from '../hooks/register'

const PANE = {
  plugin: 'diagrams',
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
  on('tool.register', ($, e) => ({ value: { tool: `mcp__diagrams__${e.name}` } }) as any)
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

    const ran = await $.tool.call({ tool: 'mcp__diagrams__show_diagram', input: { title: 'Release flow', mermaid: FLOW } } as any)
    expect(JSON.stringify(ran)).toContain('Shown in the diagrams pane')
    expect(seen.opened).toEqual(['diagrams'])
    expect(await ui.find({ text: 'Release flow' })).toBeDefined()
    expect(JSON.stringify(await ui.drawn())).toContain('Build')
  })

  test('a diagram that does not parse comes back to the agent as an error', async ($, on) => {
    seat(on)
    await start($)

    const ran = await $.tool.call({ tool: 'mcp__diagrams__show_diagram', input: { title: 'x', mermaid: 'pie\n "a": 1' } } as any)
    expect(JSON.stringify(ran)).toContain('did not parse')
  })

  test('a mermaid block in a reply lands in the pane; arrows page between diagrams', async ($, on) => {
    seat(on)
    const ui = await start($)

    await $.tool.call({ tool: 'mcp__diagrams__show_diagram', input: { title: 'First', mermaid: FLOW } } as any)
    await $.turn.start({ text: 'draw', turnId: 't1' })
    await $.turn.complete({ ...DONE, turnId: 't1', answer: '```mermaid\nsequenceDiagram\n  Alice->>Bob: hello\n```' })
    expect(await ui.find({ text: '2/2' })).toBeDefined()
    expect(JSON.stringify(await ui.drawn())).toContain('Alice')

    await ui.press({ key: 'prev' })
    expect(await ui.find({ text: '1/2' })).toBeDefined()
    expect(await ui.find({ text: 'First' })).toBeDefined()
  })
})
