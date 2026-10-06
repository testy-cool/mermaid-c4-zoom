import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Diagram } from '../types'
import { joinStems, paint, roundCorners, runs } from './paint'
import { renderMermaidAscii } from './vendor/mermaid-text.js'

const PANE = 'diagrams'
const TOOL = 'mcp__diagrams__show_diagram'
const MAX_KEPT = 20

const list = atom({ plugin: 'diagrams', key: 'list' } as const, [])
const shown = atom({ plugin: 'diagrams', key: 'shown' } as const, 0)
const path = atom({ plugin: 'diagrams', key: 'path' } as const, [])

const TOOL_DESCRIPTION = [
  'Draw a mermaid diagram in the side pane beside the conversation.',
  'Use it when a flow, a sequence, states, classes or tables are easier to see than read.',
  'Supported: flowchart/graph (TD or LR), sequenceDiagram, stateDiagram-v2,',
  'classDiagram, erDiagram, xychart-beta. Pie charts and other types are not supported.',
  'Keep labels short; the pane is about 40 to 60 columns wide, so prefer TD over LR',
  'for anything with more than four nodes in a row.',
  'Avoid arrows that point back up to an earlier node: in text they squeeze between boxes and tangle.',
  'In labels, avoid * and ~ (read as markdown) and = (fonts may merge it with the character before).',
  'For a layered, C4-style view, pass zoom: it maps a node id of this diagram to the diagram inside that node',
  '({ title, mermaid, zoom }, nested as deep as needed). The person clicks the node to go one level in.',
].join(' ')

const NBSP = '\u00a0'

/** Pads each line of a flowchart's [box] and {diamond} labels with a no-break space, so text never touches the border. */
export function padLabels(source: string): string {
  if (!/^\s*(graph|flowchart)\b/.test(source)) return source
  const pad = (inner: string) => {
    if (/^[([/\\>{]/.test(inner)) return null
    const quoted = /^".*"$/s.test(inner)
    const body = quoted ? inner.slice(1, -1) : inner
    const padded = body
      .split(/(<br\s*\/?>)/i)
      .map(part => (/^<br/i.test(part) ? part : `${NBSP}${part.trim()}${NBSP}`))
      .join('')

    return quoted ? `"${padded}"` : padded
  }

  return source
    .replace(/(\w)\[([^\]\n]*)\]/g, (whole, id: string, inner: string) => {
      const padded = pad(inner)
      return padded === null ? whole : `${id}[${padded}]`
    })
    .replace(/(\w)\{([^}\n]*)\}/g, (whole, id: string, inner: string) => {
      const padded = pad(inner)
      return padded === null ? whole : `${id}{${padded}}`
    })
}

export const ZOOM_MARK = ' ▸'

/** The first line of a node's [box] or {diamond} label, or undefined. */
export function labelOf(source: string, id: string): string | undefined {
  const m = new RegExp(`(?:^|[^\\w])${id}\\s*(?:\\[|\\{)"?([^"\\]}\\n]*)`, 'm').exec(source)
  if (!m) return undefined
  const first = (m[1] ?? '').split(/<br\s*\/?>/i)[0]?.trim()

  return first === '' ? undefined : first
}

/** Adds the zoom mark after the first label line of each node that opens a level. */
export function markZoomable(source: string, ids: string[]): string {
  return ids.reduce((text, id) => {
    const label = labelOf(text, id)
    if (label === undefined) return text
    const at = new RegExp(`((?:^|[^\\w])${id}\\s*(?:\\[|\\{)"?\\s*)`, 'm').exec(text)
    if (!at) return text
    const start = at.index + at[0].length
    const end = text.indexOf(label, start) + label.length

    return text.slice(0, end) + ZOOM_MARK + text.slice(end)
  }, source)
}

/** Mermaid source as monospace text art, or the parser's complaint. */
export function drawMermaid(source: string): { art: string } | { error: string } {
  try {
    const art = renderMermaidAscii(padLabels(source.replace(/^(\s*%%[^\n]*\n)+/, '')), {
      colorMode: 'none',
      paddingX: 2,
      // Three rows between nodes leave room for a stem, a fork and the arrowhead.
      paddingY: 3,
      boxBorderPadding: 0,
    })
      .replace(/[ \t]+$/gm, '')
      .trimEnd()
    if (art === '') return { error: 'The diagram drew nothing.' }

    return { art: roundCorners(joinStems(art)) }
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

/** Reads one level of tool input (title, mermaid, zoom) into a Diagram, collecting every problem. */
export function parseLevel(raw: unknown, where: string): { diagram: Diagram } | { errors: string[] } {
  const input = (raw ?? {}) as { title?: unknown; mermaid?: unknown; zoom?: unknown }
  const source = typeof input.mermaid === 'string' ? input.mermaid.replace(/^```(?:mermaid)?\s*\n|\n```\s*$/g, '').trim() : ''
  const title = typeof input.title === 'string' && input.title.trim() !== '' ? input.title.trim() : guessTitle(source)
  const errors: string[] = []
  const drawn = drawMermaid(source)
  if ('error' in drawn) errors.push(`The ${where} diagram did not parse: ${drawn.error}.`)

  const zoom: Record<string, Diagram> = {}
  if (input.zoom !== undefined && (typeof input.zoom !== 'object' || input.zoom === null)) {
    errors.push(`zoom in the ${where} diagram must be an object of node id to diagram.`)
  }
  for (const [id, child] of Object.entries((input.zoom ?? {}) as Record<string, unknown>)) {
    if (labelOf(source, id) === undefined) {
      errors.push(`zoom names ${id}, but the ${where} diagram has no [box] or {diamond} node with that id.`)
      continue
    }
    const level = parseLevel(child, `${where} > ${id}`)
    if ('errors' in level) errors.push(...level.errors)
    else zoom[id] = level.diagram
  }
  if (errors.length > 0) return { errors }

  return { diagram: { id: newId(), title, source, ...(Object.keys(zoom).length > 0 ? { zoom } : {}) } }
}

function countLevels(diagram: Diagram): number {
  return 1 + Object.values(diagram.zoom ?? {}).reduce((sum, child) => sum + countLevels(child), 0)
}

/** The diagram at the end of a zoom path, and the titles along the way; a stale path stops where it breaks. */
export function follow(top: Diagram, ids: string[]): { diagram: Diagram; trail: string[]; depth: number } {
  let diagram = top
  const trail = [top.title]
  let depth = 0
  for (const id of ids) {
    const child = diagram.zoom?.[id]
    if (child === undefined) break
    diagram = child
    trail.push(child.title)
    depth += 1
  }

  return { diagram, trail, depth }
}

/** Where each zoomable node's first label line sits in the art: row and character columns. */
export function zoomSpans(lines: string[], diagram: Diagram, ids: string[]): { id: string; row: number; start: number; end: number }[] {
  const spans: { id: string; row: number; start: number; end: number }[] = []
  for (const id of ids) {
    const label = labelOf(diagram.source, id)
    if (label === undefined) continue
    const target = [...`${label}${ZOOM_MARK}`]
    for (let row = 0; row < lines.length; row++) {
      const chars = [...(lines[row] ?? '')].map(ch => (ch === NBSP ? ' ' : ch))
      const start = chars.findIndex((_, c) => target.every((t, k) => chars[c + k] === t))
      if (start === -1) continue
      spans.push({ id, row, start, end: start + target.length })
      break
    }
  }

  return spans.sort((a, b) => a.row - b.row || a.start - b.start)
}

function newId(): string {
  return Math.random().toString(36).slice(2, 10)
}

/** Two diagrams are the same when everything but their ids matches, zoom levels included. */
function sameness(diagram: Diagram): string {
  return JSON.stringify(diagram, (key, value: unknown) => (key === 'id' ? undefined : value))
}

async function addDiagrams($: EngineInterface, fresh: Diagram[]) {
  if (fresh.length === 0) return
  const known = new Set((await read($, list)).map(sameness))
  const unseen = fresh.filter(d => !known.has(sameness(d)))
  if (unseen.length === 0) return
  const kept = await update($, list, old => [...old, ...unseen].slice(-MAX_KEPT))
  await update($, shown, () => kept.length - 1)
  await update($, path, () => [])
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
  await update($, path, () => [])
}

async function zoomIn($: EngineInterface, id: string) {
  await update($, path, ids => [...ids, id])
}

async function zoomOut($: EngineInterface, depth: number) {
  await update($, path, ids => ids.slice(0, depth))
}

async function forget($: EngineInterface) {
  const index = await read($, shown)
  const left = await update($, list, old => old.filter((_, i) => i !== index))
  await update($, shown, i => Math.min(i, Math.max(left.length - 1, 0)))
  await update($, path, () => [])
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
          zoom: {
            type: 'object',
            description: 'Optional. Node id of this diagram -> { title, mermaid, zoom } for the level inside that node.',
            additionalProperties: { type: 'object' },
          },
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
    const parsed = parseLevel(e, 'top')
    if ('errors' in parsed) {
      return { isError: true, result: `Nothing was shown. ${parsed.errors.join(' ')}` }
    }
    const top = parsed.diagram
    await addDiagrams($, [top])
    const drawn = drawMermaid(markZoomable(top.source, Object.keys(top.zoom ?? {})))
    const size = 'art' in drawn ? drawn.art.split('\n') : []
    const width = Math.max(0, ...size.map(line => [...line].length))
    const levels = countLevels(top) - 1
    const inside = levels > 0 ? ` with ${levels} zoomed level${levels === 1 ? '' : 's'} inside` : ''

    return { result: `Shown in the diagrams pane as "${top.title}"${inside}, ${width} columns wide and ${size.length} rows tall.` }
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
    const top = diagrams[index]
    const width = e.props.bodyColumns

    if (top === undefined) {
      return (
        <Box flexDirection="column" width={width}>
          <Text bold>Diagrams</Text>
          <Text dimColor wrap="wrap">No diagrams yet. Ask the agent to draw one, or it can write a mermaid block in a reply.</Text>
        </Box>
      )
    }

    const { diagram, trail, depth } = follow(top, await read($, path))
    const zoomIds = Object.keys(diagram.zoom ?? {})
    const drawn = drawMermaid(markZoomable(diagram.source, zoomIds))
    const lines = 'art' in drawn ? drawn.art.split('\n') : []
    const colors = 'art' in drawn ? paint(drawn.art) : []
    const spans = zoomSpans(lines, diagram, zoomIds)
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
            {top.title}
          </Text>
        </Box>
        {depth > 0 && (
          <Box flexDirection="row" gap={1}>
            <Button key="up" label="‹ up" hotkey="u" plain onPress={() => void zoomOut($, depth - 1)} />
            <Text wrap="truncate-end">{trail.slice(1).join(' › ')}</Text>
          </Box>
        )}
        <Box flexDirection="column" marginTop={1}>
          {'art' in drawn ? (
            lines.map((line, i) => {
              const parts = runs(line, colors[i])
              const row = spans.filter(span => span.row === i)
              if (row.length === 0) {
                return (
                  <Text key={`l${i}`} wrap="truncate-end">
                    {line === '' ? ' ' : parts.map((run, k) => <Text key={`r${k}`} color={run.color}>{run.text}</Text>)}
                  </Text>
                )
              }
              const chars = [...line]
              const pieces: { text: string; color?: string; zoom?: string }[] = []
              let at = 0
              for (const span of row) {
                pieces.push(...runs(chars.slice(at, span.start).join(''), colors[i]?.slice(at, span.start)))
                pieces.push({ text: chars.slice(span.start, span.end).join(''), zoom: span.id })
                at = span.end
              }
              pieces.push(...runs(chars.slice(at).join(''), colors[i]?.slice(at)))

              return (
                <Box key={`l${i}`} flexDirection="row">
                  {pieces.map((piece, k) =>
                    piece.zoom !== undefined ? (
                      <Button key={`zoom-${piece.zoom}`} label={piece.text} plain onPress={() => void zoomIn($, piece.zoom!)} />
                    ) : (
                      <Text key={`r${k}`} color={piece.color}>
                        {piece.text}
                      </Text>
                    ),
                  )}
                </Box>
              )
            })
          ) : (
            <Text color="red" wrap="wrap">{`Could not draw it: ${drawn.error}`}</Text>
          )}
        </Box>
        {isTooWide && (
          <Text dimColor wrap="wrap">
            Cut off at the right edge. Widen the window, or ask for a top-down layout.
          </Text>
        )}
        {zoomIds.length > 0 && (
          <Box flexDirection="column" marginTop={1}>
            <Text dimColor>Click a ▸ box, or press its number, to look inside:</Text>
            {zoomIds.slice(0, 9).map((id, k) => (
              <Button
                key={`key-${id}`}
                label={labelOf(diagram.source, id) ?? id}
                hotkey={String(k + 1)}
                plain
                onPress={() => void zoomIn($, id)}
              />
            ))}
          </Box>
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
