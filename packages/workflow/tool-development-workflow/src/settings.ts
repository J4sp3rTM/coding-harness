/** Host-owned settings namespace for delegated development-agent routes. */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'

/** A partial provider/model route stored for one development tier. */
export interface DevelopmentTierRoute {
  /** Optional provider route override. */
  provider?: string
  /** Optional model id override. */
  model?: string
  /** Optional adapter-owned reasoning effort for the selected model. */
  reasoningEffort?: string
}

/** User-configurable routes for T1, T2, and T3 delegated work. */
export interface DevelopmentWorkflowSettings {
  /** Per-tier route overrides; omitted fields inherit the parent route. */
  tiers?: {
    /** Exceptional review. */
    t1?: DevelopmentTierRoute
    /** Implementation, inspection, and validation. */
    t2?: DevelopmentTierRoute
    /** Simple low-risk repetition. */
    t3?: DevelopmentTierRoute
  }
}

/** The settings namespace read by the development workflow consumer. */
export const DEVELOPMENT_WORKFLOW_SETTINGS_NAMESPACE = settingsNamespace('development-workflow')

const route = z.object({ provider: z.string(), model: z.string(), reasoningEffort: z.string() })

/** Schema for the host settings section. */
export const SettingsConfig: z<DevelopmentWorkflowSettings> = z.object({
  tiers: z.object({ t1: route, t2: route, t3: route }),
})

/** Loader-facing schema export for the settings subpath. */
export const Config = SettingsConfig

/** Plugin name used by the host singleton row. */
export const name = 'tool-development-workflow-settings'
export const inject: string[] = []

/**
 * Register the host singleton settings namespace. The empty composition entry
 * leaves every tier inherited until a user settings layer supplies a route.
 * @param ctx - host plugin context.
 * @param config - composition defaults, normally empty in the base bundle.
 */
export function apply(ctx: Context, config: DevelopmentWorkflowSettings): void {
  installSettingsSection(ctx, DEVELOPMENT_WORKFLOW_SETTINGS_NAMESPACE, SettingsConfig, config, {
    setSource: () => {},
    onChange: () => {},
  })
}
