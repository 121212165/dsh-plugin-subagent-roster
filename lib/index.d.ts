import type { Context } from '@deepseek-ai/cordis'

export interface LocalizedText {
  en: string
  zh: string
}

export type TierId = 'batch' | 'build' | 'review' | 'team'

export interface TierSpec {
  title: LocalizedText
  description: LocalizedText
  model: string
  maxTokens: number
  reasoningEffort: string | null
}

export type ToolsetId = 'none' | 'read' | 'write' | 'web'

export interface RoleSpec {
  id: string
  position: 'batch-worker' | 'batch-checker' | 'lead' | 'builder' | 'reviewer' | 'researcher' | 'scribe'
  temperament: string
  line: 'bulk' | 'team'
  tier: TierId
  tools: ToolsetId
  order: number
  title: LocalizedText
  description: LocalizedText
  prompt: string
}

export interface DelegationSpec {
  id: string
  toolName: string
  line: 'bulk' | 'team'
  tier: TierId
  order: number
  maxDepth: number
  presets: string[]
  defaultPreset: string
  title: LocalizedText
  description: LocalizedText
}

export interface RosterConfig {
  mode?: 'advisory' | 'strict'
  provider?: string
  allowedModels?: string[]
  routingGuidance?: boolean
}

export declare const name: 'subagent-roster'
export declare const inject: readonly string[]
export declare const Config: unknown
export declare const PROVIDER: string
export declare const TIERS: Record<TierId, TierSpec>
export declare const ROLES: readonly RoleSpec[]
export declare const DELEGATIONS: readonly DelegationSpec[]

export declare function agentOptionsFor(
  tier: TierId,
  options?: { provider?: string },
): { provider: string; model: string; maxTokens: number; reasoningEffort?: string }
export declare function presetIds(): string[]
export declare function toolsFor(role: RoleSpec): string[]
export declare function byLine(): Record<string, DelegationSpec[]>
export declare function validateRoster(options?: { allowedModels?: string[]; provider?: string }): string[]
export declare function routingText(options?: { delegations?: readonly DelegationSpec[]; roles?: readonly RoleSpec[] }): string
export declare function apply(ctx: Context, config: RosterConfig): void
