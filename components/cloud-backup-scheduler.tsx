"use client";

import { useEffect } from "react";

import { useAccount } from "@/lib/account-context";
import { isCloudBackupConfigured, loadCloudBackupConfig } from "@/lib/cloud-backup/config";
import { listCloudBackups, loadCloudBackupState, restoreFromCloudManifest, runCloudBackup } from "@/lib/cloud-backup/engine";
import { inspectData } from "@/lib/data-management/backup";

// Module-level guard so overlapping timers/mounts never run two backups at once.
let backupRunning = false;

/**
 * Invisible component that drives auto cloud backup. Mounted once at the app
 * root. It checks every few minutes whether a backup is due (per the user's
 * interval) and, when idle, runs an incremental backup in the background. The
 * engine skips when nothing changed and processes module-by-module with awaits,
 * so it stays off the critical path and doesn't freeze the UI.
 */
export function CloudBackupScheduler() {
  const { account } = useAccount();

  useEffect(() => {
    let cancelled = false;
    const restoreMarker = `ai-phone-account-cloud-ready:${account.id}`;

    const runWhenIdle = (fn: () => void) => {
      if (typeof window.requestIdleCallback === "function") {
        window.requestIdleCallback(() => fn(), { timeout: 4000 });
      } else {
        window.setTimeout(fn, 400);
      }
    };

    const bootstrap = async () => {
      const config = loadCloudBackupConfig();
      if (!config.managed || !isCloudBackupConfigured(config)) return;
      if (window.localStorage.getItem(restoreMarker) === "1") return;
      try {
        const [local, backups] = await Promise.all([inspectData(), listCloudBackups(config)]);
        const latest = backups.find(item => !item.quarantine);
        // A cleared browser often recreates a few default rows. Compare it with
        // the cloud backup instead of requiring a literal zero-record database.
        const cloudIsClearlyRicher = Boolean(latest && latest.totalRecords > Math.max(20, local.totalRecords * 2));
        if (latest && (local.totalRecords === 0 || cloudIsClearlyRicher)) {
          await restoreFromCloudManifest(config, latest.name, { overwrite: true });
          window.localStorage.setItem(restoreMarker, "1");
          window.location.reload();
          return;
        }
        if (!latest && local.totalRecords > 0) {
          await runCloudBackup(config, { force: true, excludeMedia: false });
        }
        window.localStorage.setItem(restoreMarker, "1");
      } catch {
        // Leave the marker unset: a later tick/reload will retry safely.
      }
    };

    const tick = () => {
      if (cancelled || backupRunning) return;
      const config = loadCloudBackupConfig();
      if (!config.enabled || !isCloudBackupConfigured(config)) return;

      const state = loadCloudBackupState();
      const dueMs = config.intervalHours * 3600_000;
      const last = state.lastCreatedAt ? Date.parse(state.lastCreatedAt) : 0;
      if (Number.isFinite(last) && last > 0 && Date.now() - last < dueMs) return;

      runWhenIdle(async () => {
        if (cancelled || backupRunning) return;
        backupRunning = true;
        try {
          // Cloud uploads are chunked, so large media is fine — always back up in full.
          await runCloudBackup(config, { excludeMedia: false });
        } catch {
          /* silent — surfaced in the data page status on next open */
        } finally {
          backupRunning = false;
        }
      });
    };

    const bootstrapTimer = window.setTimeout(() => { void bootstrap(); }, 1500);
    const interval = window.setInterval(tick, 5 * 60_000);
    const initial = window.setTimeout(tick, 30_000);
    return () => {
      cancelled = true;
      window.clearTimeout(bootstrapTimer);
      window.clearInterval(interval);
      window.clearTimeout(initial);
    };
  }, [account.id]);

  return null;
}
