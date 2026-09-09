interface CopilotModel { id: string; display_name?: string }
interface CliSelection { enabled: boolean; path: string; all: boolean; models: string[]; defaultModel?: string }
type CliSelections = Record<string, CliSelection>;
interface HarnessTheme { name: string; tokens: Record<string, string> }
interface HarnessLoad { defaults: Record<string, string>; saved: CliSelections; models: CopilotModel[]; modelError?: string }
interface HarnessPath { path: string; exists: boolean }
interface HarnessSave { paths: string[]; backups: string[] }
interface HarnessRestore extends HarnessSave { restored: CliSelections }
interface HarnessAPI {
  load(): Promise<HarnessLoad>;
  inspect(name: string, file: string): Promise<HarnessPath>;
  browse(name: string, file: string): Promise<HarnessPath | null>;
  apply(selection: CliSelections): Promise<HarnessSave>;
  restore(selection: Record<string, Pick<CliSelection, 'path' | 'enabled'>>): Promise<HarnessRestore>;
  theme(): Promise<HarnessTheme>;
  onTheme(callback: (theme: HarnessTheme) => void): void;
}
interface Window { harness: HarnessAPI }
interface CatalogModel { slug: string; supported_reasoning_levels?: { effort: string }[]; [key: string]: unknown }
interface AuthAccount { name: string; provider?: string; type?: string; disabled?: boolean }
interface DiscoveryResponse { files?: AuthAccount[]; models?: (CopilotModel & CatalogModel)[] }
