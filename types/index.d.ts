/**
 * One diagram the pane can show: its mermaid source and a short title.
 * `zoom` maps a node id to the diagram one level inside that node, as a C4
 * container opens into its components.
 */
export type Diagram = { id: string; title: string; source: string; zoom?: Record<string, Diagram> }

declare module 'claude-code' {
  interface PluginState {
    'mermaid-c4-zoom': {
      list: Diagram[]
      shown: number
      /** Node ids zoomed into, from the shown top diagram down. */
      path: string[]
    }
  }
}
