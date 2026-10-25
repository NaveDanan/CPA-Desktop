interface CopilotModel { id: string; display_name?: string; owned_by?: string; clients?: string[] }
interface CliSelection { enabled: boolean; path: string; all: boolean; models: string[]; defaultModel?: string; appsManaged?: boolean }
type PortableSelections = Record<string, Pick<CliSelection, 'enabled' | 'all' | 'models' | 'defaultModel'>>;
interface EnvironmentInfo { protocol: 1; id: string; name: string; version: string; platform: string; arch: string; updateError?: string }
interface EnvironmentView { id: string; name: string; address: string; version?: string; status: 'connected' | 'offline' | 'unchecked'; error?: string; checkedAt?: string; updateError?: string }
interface EnvironmentOutcome { id: string; ok: boolean; message: string }
interface ProviderAccount { name: string; provider: string; disabled: boolean; status?: string }
interface ProviderBundle { files: { name: string; content: Record<string, unknown> }[] }
interface EnvironmentDetails { models: CopilotModel[]; selection: PortableSelections; providers: ProviderAccount[]; modelError?: string }
interface ProviderAction { action: 'start' | 'status' | 'callback' | 'cancel' | 'toggle'; provider?: string; state?: string; redirect?: string; name?: string; disabled?: boolean }
interface ProviderResult { status?: string; url?: string; state?: string; flow?: string; user_code?: string }
interface ComputerConnection { enabled: boolean; port: number; addresses: string[]; token?: string; error?: string }
interface EnvironmentUsage { id: string; name: string; available: boolean; error?: string; checkedAt: string }
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
interface UsageDashboard { start: string; end: string; pricing?: { updated_at: string; models: number; error?: string }; providers: ProviderUsage[]; rates?: Record<string, ModelPricing>; environments?: EnvironmentUsage[]; partial?: boolean }
interface HarnessAPI {
  load(): Promise<HarnessLoad>;
  inspect(name: string, file: string): Promise<HarnessPath>;
  browse(name: string, file: string): Promise<HarnessPath | null>;
  apply(selection: CliSelections): Promise<HarnessSave>;
  restore(selection: Record<string, Pick<CliSelection, 'path' | 'enabled'>>): Promise<HarnessRestore>;
  theme(): Promise<HarnessTheme>;
  usage(period: string, start?: string, end?: string, refreshPricing?: boolean): Promise<CopilotUsageSummary>;
  environments(): Promise<EnvironmentView[]>;
  connectEnvironment(value: {name: string; address: string; token: string}): Promise<EnvironmentView[]>;
  editEnvironment(id: string, value: {name: string; address: string; token?: string}): Promise<EnvironmentView[]>;
  environmentDetails(id: string): Promise<EnvironmentDetails>;
  providerAction(id: string, value: ProviderAction): Promise<ProviderResult>;
  openProviderURL(url: string): Promise<void>;
  computerConnection(showToken?: boolean): Promise<ComputerConnection>;
  configureComputerConnection(enabled: boolean, port: number): Promise<ComputerConnection>;
  removeEnvironment(id: string): Promise<EnvironmentView[]>;
  refreshEnvironments(): Promise<EnvironmentView[]>;
  bulkEnvironments(action: 'models' | 'version' | 'providers', ids: string[], source?: string): Promise<EnvironmentOutcome[]>;
  dashboard(boundaries: number[], refreshPricing?: boolean, scope?: string): Promise<UsageDashboard>;
  onTheme(callback: (theme: HarnessTheme) => void): void;
}
interface Window { harness: HarnessAPI }
interface CatalogModel { slug: string; supported_reasoning_levels?: { effort: string }[]; [key: string]: unknown }
interface AuthAccount { name: string; provider?: string; type?: string; disabled?: boolean }
interface DiscoveryResponse { files?: AuthAccount[]; models?: (CopilotModel & CatalogModel)[]; data?: CopilotModel[] }
