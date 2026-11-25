export type Mark = { percent: number; limit: number }

declare module 'claude-code' {
  interface PluginState {
    'wrap-up': { mark: Mark | null; isHidden: boolean }
  }
}
