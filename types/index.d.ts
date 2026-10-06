/** One diagram the pane can show: its mermaid source and a short title. */
export type Diagram = { id: string; title: string; source: string }

declare module 'claude-code' {
  interface PluginState {
    diagrams: {
      list: Diagram[]
      shown: number
    }
  }
}
