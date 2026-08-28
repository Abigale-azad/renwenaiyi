import { kvGet, kvSet, registerKvMigration } from "../kv-db";

/** Fixed bucket name — users never type this; the app auto-creates it via the service_role key. */
export const CLOUD_BACKUP_BUCKET = "ai-phone-backup";

const CLOUD_BACKUP_CONFIG_KEY = "ai_phone_cloud_backup_config_v1";
registerKvMigration(CLOUD_BACKUP_CONFIG_KEY);

/**
 * Hosted/account deployments are the safe default. A self-hosted installation
 * must opt out explicitly with NEXT_PUBLIC_SELF_HOSTED_MODE=true.
 *
 * Netlify can omit a public env value from an older client bundle. Treating an
 * omitted value as self-hosted used to expose the legacy service-role form and
 * let imported backups downgrade an authenticated account to manual mode.
 */
export function isAccountManagedBackupDeployment(): boolean {
  return process.env.NEXT_PUBLIC_SELF_HOSTED_MODE !== "true";
}

export type CloudBackupConfig = {
  /** Account-bound server managed storage. The browser never receives a Supabase secret. */
  managed?: boolean;
  /** User's Supabase project URL, e.g. https://xxxx.supabase.co */
  url: string;
  /** User's Supabase service_role key (needed to auto-create the bucket). */
  key: string;
  /** Auto-backup on/off (engine wired in a later step). */
  enabled: boolean;
  /** Auto-backup interval in hours. */
  intervalHours: number;
  /** How many healthy backups to keep (rolling). */
  keepCount: number;
  /** Strip images/multimedia from backups (local + cloud) to keep them small. */
  excludeMedia: boolean;
};

export const DEFAULT_CLOUD_BACKUP_CONFIG: CloudBackupConfig = {
  managed: false,
  url: "",
  key: "",
  enabled: false,
  intervalHours: 6,
  keepCount: 3,
  excludeMedia: true,
};

/** Strip trailing slashes; tolerate a pasted URL with or without protocol. */
export function normalizeBackupUrl(url: string): string {
  const trimmed = (url || "").trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export function loadCloudBackupConfig(): CloudBackupConfig {
  try {
    const raw = kvGet(CLOUD_BACKUP_CONFIG_KEY);
    const accountManaged = isAccountManagedBackupDeployment();
    if (!raw) {
      return accountManaged
        ? { ...DEFAULT_CLOUD_BACKUP_CONFIG, managed: true, enabled: true, intervalHours: 1, excludeMedia: false }
        : { ...DEFAULT_CLOUD_BACKUP_CONFIG };
    }
    const parsed = JSON.parse(raw) as Partial<CloudBackupConfig>;
    const loaded: CloudBackupConfig = {
      managed: Boolean(parsed.managed),
      url: typeof parsed.url === "string" ? parsed.url : "",
      key: typeof parsed.key === "string" ? parsed.key : "",
      enabled: Boolean(parsed.enabled),
      intervalHours: clampInterval(parsed.intervalHours),
      keepCount: clampKeepCount(parsed.keepCount),
      excludeMedia: parsed.excludeMedia !== false,
    };
    return accountManaged
      ? { ...loaded, managed: true, enabled: true, intervalHours: 1, excludeMedia: false }
      : loaded;
  } catch {
    return isAccountManagedBackupDeployment()
      ? { ...DEFAULT_CLOUD_BACKUP_CONFIG, managed: true, enabled: true, intervalHours: 1, excludeMedia: false }
      : { ...DEFAULT_CLOUD_BACKUP_CONFIG };
  }
}

export function saveCloudBackupConfig(config: CloudBackupConfig): void {
  const accountManaged = isAccountManagedBackupDeployment();
  kvSet(CLOUD_BACKUP_CONFIG_KEY, JSON.stringify({
    ...config,
    managed: accountManaged || config.managed === true,
    // Secrets belong on the deployment server. Never retain an imported or
    // previously pasted service_role key in an account-managed browser.
    url: accountManaged ? "" : normalizeBackupUrl(config.url),
    key: accountManaged ? "" : (config.key || "").trim(),
    enabled: accountManaged ? true : Boolean(config.enabled),
    intervalHours: accountManaged ? 1 : clampInterval(config.intervalHours),
    keepCount: clampKeepCount(config.keepCount),
    excludeMedia: accountManaged ? false : config.excludeMedia !== false,
  }));
}

export function isCloudBackupConfigured(config: CloudBackupConfig): boolean {
  return Boolean(config.managed || (normalizeBackupUrl(config.url) && config.key.trim()));
}

function clampInterval(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_CLOUD_BACKUP_CONFIG.intervalHours;
  // Floor at 0.5h to avoid hammering; cap at a week.
  return Math.min(168, Math.max(0.5, n));
}

function clampKeepCount(value: unknown): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return DEFAULT_CLOUD_BACKUP_CONFIG.keepCount;
  return Math.min(5, Math.max(2, n));
}
