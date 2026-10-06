import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Diagram } from '../types'
import { paint, roundCorners, runs } from './paint'
import { renderMermaidAscii } from './vendor/mermaid-text.js'

const PANE = 'diagrams'
const TOOL = 'mcp__diagrams__show_diagram'
const MAX_KEPT = 20

const list = atom({ plugin: 'diagrams', key: 'list' } as const, [])
const shown = atom({ plugin: 'diagrams', key: 'shown' } as const, 0)

const TOOL_DESCRIPTION = [
  'Draw a mermaid diagram in the side pane beside the conversation.',
  'Use it when a flow, a sequence, states, classes or tables are easier to see than read.',
  'Supported: flowchart/graph (TD or LR), sequenceDiagram, stateDiagram-v2,',
  'classDiagram, erDiagram, xychart-beta. Pie charts and other types are not supported.',
  'Keep labels short; the pane is about 40 to 60 columns wide, so prefer TD over LR',
  'for anything with more than four nodes in a row.',
].join(' ')

/** Mermaid source as monospace text art, or the parser's complaint. */
export function drawMermaid(source: string): { art: string } | { error: string } {
  try {
    const art = renderMermaidAscii(source.replace(/^(\s*%%[^\n]*\n)+/, ''), {
      colorMode: 'none',
      paddingX: 2,
      paddingY: 1,
    })
      .replace(/[ \t]+$/gm, '')
      .trimEnd()
    if (art === '') return { error: 'The diagram drew nothing.' }

    return { art: roundCorners(art) }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}

/** The ```mermaid blocks in a reply, in order. */
export function mermaidBlocks(text: string): string[] {
  return [...text.matchAll(/```mermaid[ \t]*\n([\s\S]*?)\n[ \t]*```/g)].map(m => (m[1] ?? '').trim()).filter(s => s !== '')
}

/** A fallback title: the diagram type named on the first line. */
export function guessTitle(source: string): string {
  const head = source.split('\n')[0]?.trim() ?? 'Diagram'
  const type = head.split(/\s+/)[0] ?? 'Diagram'

  return type.replace(/-v2|-beta/, '')
}

function newId(): string {
  return Math.random().toString(36).slice(2, 10)
}

async function addDiagrams($: EngineInterface, fresh: Diagram[]) {
  if (fresh.length === 0) return
  const known = new Set((await read($, list)).map(d => d.source))
  const unseen = fresh.filter(d => !known.has(d.source))
  if (unseen.length === 0) return
  const kept = await update($, list, old => [...old, ...unseen].slice(-MAX_KEPT))
  await update($, shown, () => kept.length - 1)
  try {
    await openPane($)
  } catch {
    // The diagram is kept; /diagrams opens the pane by hand.
  }
}

async function openPane($: EngineInterface) {
  const panes = await $.ui.panes()
  if (!panes.some(pane => pane.id === PANE)) await $.ui.open({ id: PANE, title: 'Diagrams' })
}

async function togglePane($: EngineInterface): Promise<boolean> {
  const panes = await $.ui.panes()
  if (panes.some(pane => pane.id === PANE)) {
    await $.ui.close({ id: PANE })

    return false
  }
  await $.ui.open({ id: PANE, title: 'Diagrams' })

  return true
}

async function step($: EngineInterface, by: number) {
  const count = (await read($, list)).length
  await update($, shown, i => Math.min(Math.max(i + by, 0), Math.max(count - 1, 0)))
}

async function forget($: EngineInterface) {
  const index = await read($, shown)
  const left = await update($, list, old => old.filter((_, i) => i !== index))
  await update($, shown, i => Math.min(i, Math.max(left.length - 1, 0)))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.tool.register({
      name: 'show_diagram',
      description: TOOL_DESCRIPTION,
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'A short title, under 40 characters.' },
          mermaid: { type: 'string', description: 'The mermaid source, without ``` fences.' },
        },
        required: ['title', 'mermaid'],
      },
    })
    await $.command.register({
      name: 'diagrams',
      description: 'Open or close the diagrams pane',
      immediate: true,
    })

    return next(e)
  })

  on('tool.call', { tool: TOOL }, async ($, e) => {
    // MCP tool arguments arrive on the event itself, beside tool and tool_use_id.
    const input = e as { title?: unknown; mermaid?: unknown }
    const source = typeof input.mermaid === 'string' ? input.mermaid.replace(/^```(?:mermaid)?\s*\n|\n```\s*$/g, '').trim() : ''
    const title = typeof input.title === 'string' && input.title.trim() !== '' ? input.title.trim() : guessTitle(source)
    const drawn = drawMermaid(source)
    if ('error' in drawn) {
      return { isError: true, result: `The diagram did not parse: ${drawn.error}` }
    }
    await addDiagrams($, [{ id: newId(), title, source }])
    const size = drawn.art.split('\n')
    const width = Math.max(...size.map(line => [...line].length))

    return { result: `Shown in the diagrams pane as "${title}", ${width} columns wide and ${size.length} rows tall.` }
  })

  // Mermaid blocks the agent writes in its reply show in the pane too.
  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined && !e.isAborted) {
      const fresh = mermaidBlocks(e.answer)
        .filter(source => !('error' in drawMermaid(source)))
        .map(source => ({ id: newId(), title: guessTitle(source), source }))
      await addDiagrams($, fresh)
    }

    return done
  })

  on('command.run', { command: 'diagrams' }, async $ => {
    const isOpen = await togglePane($)

    return { text: isOpen ? 'Diagrams pane opened.' : 'Diagrams pane closed.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const diagrams = await read($, list)
    const index = await read($, shown)
    const diagram = diagrams[index]
    const width = e.props.bodyColumns

    if (diagram === undefined) {
      return (
        <Box flexDirection="column" width={width}>
          <Text bold>Diagrams</Text>
          <Text dimColor wrap="wrap">No diagrams yet. Ask the agent to draw one, or it can write a mermaid block in a reply.</Text>
        </Box>
      )
    }

    const drawn = drawMermaid(diagram.source)
    const lines = 'art' in drawn ? drawn.art.split('\n') : []
    const colors = 'art' in drawn ? paint(drawn.art) : []
    const isTooWide = lines.some(line => [...line].length > width)

    return (
      <Box flexDirection="column" width={width}>
        <Box flexDirection="row" gap={1}>
          <Button key="prev" plain onPress={() => void step($, -1)}>
            ‹
          </Button>
          <Text dimColor>{`${index + 1}/${diagrams.length}`}</Text>
          <Button key="next" plain onPress={() => void step($, 1)}>
            ›
          </Button>
          <Text bold wrap="truncate-end">
            {diagram.title}
          </Text>
        </Box>
        <Box flexDirection="column" marginTop={1}>
          {'art' in drawn ? (
            lines.map((line, i) => (
              <Text key={`l${i}`} wrap="truncate-end">
                {line === ''
                  ? ' '
                  : runs(line, colors[i]).map((run, k) => (
                      <Text key={`r${k}`} color={run.color}>
                        {run.text}
                      </Text>
                    ))}
              </Text>
            ))
          ) : (
            <Text color="red" wrap="wrap">{`Could not draw it: ${drawn.error}`}</Text>
          )}
        </Box>
        {isTooWide && (
          <Text dimColor wrap="wrap">
            Cut off at the right edge. Widen the window, or ask for a top-down layout.
          </Text>
        )}
        <Box marginTop={1}>
          <Button key="forget" plain onPress={() => void forget($)}>
            remove this one
          </Button>
        </Box>
      </Box>
    )
  })
}
