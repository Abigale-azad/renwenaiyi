"use client";

import { useEffect, useState } from "react";
import { RefreshCw, Download, CheckCircle2 } from "lucide-react";

/**
 * PWA 一键更新按钮：
 * - 检测 Service Worker 是否有新版本待激活
 * - 有新版本时显示"立即更新"，点一下 skipWaiting 并刷新
 * - 没更新时也可以手动"检查更新"
 */
export function PwaUpdateButton({ compact = false }: { compact?: boolean }) {
    const [status, setStatus] = useState<"idle" | "checking" | "ready" | "up-to-date" | "unsupported">("idle");
    const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);

    useEffect(() => {
        if (!("serviceWorker" in navigator)) {
            setStatus("unsupported");
            return;
        }

        let cancelled = false;

        async function init() {
            try {
                const reg = await navigator.serviceWorker.getRegistration();
                if (cancelled) return;
                setRegistration(reg ?? null);
                if (reg?.waiting) {
                    setStatus("ready");
                } else {
                    setStatus("idle");
                }

                // 监听 updatefound
                reg?.addEventListener?.("updatefound", () => {
                    const newWorker = reg.installing;
                    if (!newWorker) return;
                    newWorker.addEventListener("statechange", () => {
                        if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
                            setStatus("ready");
                        }
                    });
                });
            } catch {
                if (!cancelled) setStatus("unsupported");
            }
        }

        init();

        // 控制器变化时刷新
        const onControllerChange = () => {
            window.location.reload();
        };
        navigator.serviceWorker.addEventListener?.("controllerchange", onControllerChange);

        return () => {
            cancelled = true;
            navigator.serviceWorker.removeEventListener?.("controllerchange", onControllerChange);
        };
    }, []);

    async function checkUpdate() {
        if (!registration) {
            setStatus("unsupported");
            return;
        }
        setStatus("checking");
        try {
            await registration.update();
            // 等一下让状态传播
            setTimeout(() => {
                if (registration.waiting) {
                    setStatus("ready");
                } else {
                    setStatus("up-to-date");
                    setTimeout(() => setStatus("idle"), 2500);
                }
            }, 3000);
        } catch {
            setStatus("idle");
        }
    }

    function applyUpdate() {
        if (!registration?.waiting) return;
        registration.waiting.postMessage({ type: "SKIP_WAITING" });
    }

    if (status === "unsupported") return null;

    if (status === "ready") {
        return (
            <button
                type="button"
                className="g-card flex-row items-center gap-3 !border-l-4 !border-l-amber-500"
                onClick={applyUpdate}
            >
                <Download size={20} className="shrink-0 text-amber-500" />
                <div className="flex-1 min-w-0">
                    <span className="menu-label font-semibold">有新版本可用</span>
                    <p className="menu-desc ts-13 !mt-0 truncate">点一下立即更新到最新版</p>
                </div>
                <span className="ui-chip ui-chip-warning">立即更新</span>
            </button>
        );
    }

    if (status === "up-to-date") {
        return (
            <div className="g-card flex-row items-center gap-3 opacity-80">
                <CheckCircle2 size={20} className="shrink-0 text-emerald-500" />
                <span className="menu-label flex-1">已是最新版本</span>
            </div>
        );
    }

    return (
        <button
            type="button"
            className={`g-card flex-row items-center gap-3 ${compact ? "!py-3" : ""}`}
            onClick={checkUpdate}
            disabled={status === "checking"}
        >
            <RefreshCw size={20} className={`shrink-0 text-[var(--c-icon-active)] ${status === "checking" ? "animate-spin" : ""}`} />
            <span className="menu-label flex-1">{status === "checking" ? "正在检查更新…" : "检查更新"}</span>
            {status !== "checking" && <span className="menu-desc !mt-0">手动刷新版本</span>}
        </button>
    );
}
