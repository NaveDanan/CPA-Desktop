interface CopilotModel { id: string; display_name?: string; owned_by?: string; clients?: string[] }
interface CliSelection { enabled: boolean; path: string; all: boolean; models: string[]; defaultModel?: string }
type CliSelections = Record<string, CliSelection>;
interface HarnessTheme { name: string; tokens: Record<string, string> }
interface HarnessLoad { defaults: Record<string, string>; saved: CliSelections; models: CopilotModel[]; modelError?: string }
interface HarnessPath { path: string; exists: boolean }
interface HarnessSave { paths: string[]; backups: string[] }
interface HarnessRestore extends HarnessSave { restored: CliSelections }
interface CopilotUsageModel { model: string; requests: number; input_tokens: number; output_tokens: number; total_tokens: number; cost_usd: number; ai_credits: number; unpriced_requests: number }
interface CopilotUsageSummary { start: string; end: string; by_model: CopilotUsageModel[]; days: { date: string; by_model: CopilotUsageModel[] }[] }
interface HarnessAPI {
  load(): Promise<HarnessLoad>;
  inspect(name: string, file: string): Promise<HarnessPath>;
  browse(name: string, file: string): Promise<HarnessPath | null>;
  apply(selection: CliSelections): Promise<HarnessSave>;
  restore(selection: Record<string, Pick<CliSelection, 'path' | 'enabled'>>): Promise<HarnessRestore>;
  theme(): Promise<HarnessTheme>;
  usage(period: string, start?: string, end?: string): Promise<CopilotUsageSummary>;
  onTheme(callback: (theme: HarnessTheme) => void): void;
}
interface Window { harness: HarnessAPI }
interface CatalogModel { slug: string; supported_reasoning_levels?: { effort: string }[]; [key: string]: unknown }
interface AuthAccount { name: string; provider?: string; type?: string; disabled?: boolean }
interface DiscoveryResponse { files?: AuthAccount[]; models?: (CopilotModel & CatalogModel)[] }
