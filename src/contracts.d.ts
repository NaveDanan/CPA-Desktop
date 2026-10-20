interface CopilotModel { id: string; display_name?: string; owned_by?: string; clients?: string[] }
interface CliSelection { enabled: boolean; path: string; all: boolean; models: string[]; defaultModel?: string; appsManaged?: boolean }
type CliSelections = Record<string, CliSelection>;
interface HarnessTheme { name: string; tokens: Record<string, string> }
interface HarnessLoad { defaults: Record<string, string>; saved: CliSelections; models: CopilotModel[]; modelError?: string }
interface HarnessPath { path: string; exists: boolean }
interface HarnessSave { paths: string[]; backups: string[] }
interface HarnessRestore extends HarnessSave { restored: CliSelections }
interface CopilotUsageModel { model: string; requests: number; input_tokens: number; output_tokens: number; total_tokens: number; cost_usd: number; ai_credits: number; unpriced_requests: number; estimated_requests?: number }
interface CopilotUsageSummary { pricing?: { updated_at: string; models: number; error?: string }; start: string; end: string; by_model: CopilotUsageModel[]; days: { date: string; by_model: CopilotUsageModel[] }[] }
interface UsageTotals {
  requests: number; total_tokens: number; input_tokens: number; cache_read_tokens: number; cache_write_tokens: number; output_tokens: number;
  cost_usd: number; input_cost_usd: number; cache_read_cost_usd: number; cache_write_cost_usd: number; output_cost_usd: number; other_cost_usd: number; cache_savings_usd: number;
  unpriced_requests: number; estimated_requests: number;
}
interface UsageSeries extends UsageTotals { model: string; harness: string }
interface UsageBucketPoint { series: number; requests: number; total_tokens: number; cost_usd: number }
interface ProviderUsage extends UsageTotals { provider: string; series: UsageSeries[]; buckets: UsageBucketPoint[][] }
// Rates are USD per million tokens. Prompts over threshold input tokens use long_context.
interface UsageRate { input: number; cached: number; write: number; output: number; category?: string; threshold?: number; long_context?: UsageRate }
interface ModelPricing extends UsageRate { name?: string; prompt_tokens?: number }
interface UsageDashboard { start: string; end: string; pricing?: { updated_at: string; models: number; error?: string }; providers: ProviderUsage[]; rates?: Record<string, ModelPricing> }
interface HarnessAPI {
  load(): Promise<HarnessLoad>;
  inspect(name: string, file: string): Promise<HarnessPath>;
  browse(name: string, file: string): Promise<HarnessPath | null>;
  apply(selection: CliSelections): Promise<HarnessSave>;
  restore(selection: Record<string, Pick<CliSelection, 'path' | 'enabled'>>): Promise<HarnessRestore>;
  theme(): Promise<HarnessTheme>;
  usage(period: string, start?: string, end?: string, refreshPricing?: boolean): Promise<CopilotUsageSummary>;
  dashboard(boundaries: number[], refreshPricing?: boolean): Promise<UsageDashboard>;
  onTheme(callback: (theme: HarnessTheme) => void): void;
}
interface Window { harness: HarnessAPI }
interface CatalogModel { slug: string; supported_reasoning_levels?: { effort: string }[]; [key: string]: unknown }
interface AuthAccount { name: string; provider?: string; type?: string; disabled?: boolean }
interface DiscoveryResponse { files?: AuthAccount[]; models?: (CopilotModel & CatalogModel)[] }
