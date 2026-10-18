export type LocalizedText = { en: string; zh: string }

export interface PatchRenderOptions {
  /** Env-var names per tier field; defaults to the shipped names. */
  readonly tierEnv?: Record<string, { model: string; maxTokens: string }>
}

export declare function renderPatch(options?: PatchRenderOptions): string
export declare const TIER_ENV: Record<string, { model: string; maxTokens: string }>
