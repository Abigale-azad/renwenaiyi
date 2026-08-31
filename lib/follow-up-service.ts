/**
 * Background follow-up service.
 * Runs independently of any React component — fires follow-ups
 * even when the user is not inside the chat room.
 * Messages are saved to storage; UI is notified via CustomEvent.
 */

import {
    loadChatSessions,
    loadChatMessages,
    pushChatMessage,
    loadAllFollowUpSchedules,
    saveFollowUpSchedule,
    clearFollowUpSchedule,
    updateMessageMediaStatus,
    updateMessageMediaData,
    createResponseBatchId,
    getLatestCharacterStateValues,
} from "./chat-storage";
import type { ChatMessage, StateValue } from "./chat-storage";
import { generateChatCompletion, flattenCompletionResult } from "./chat-engine";
import { loadFollowUpConfig } from "./settings-storage";
import { parseAIResponse } from "./rich-message-parser";
import type { ParsedMessagePart } from "./rich-message-parser";
import { isKnownStickerLabel } from "./sticker-data";
import { loadCharacters } from "./character-storage";
import { bgSetInterval } from "./bg-timer";
import { dispatchChatMessageNotice } from "./chat-notification-events";
import { settleShoppingPaymentRequest } from "./shopping-payment-request";
import {
    createPendingChatGeneratedImageData,
    generateAndApplyChatGeneratedImage,
    isPendingChatGeneratedImageMessage,
} from "./generated-image-retry";
import {
    loadTimedWakeSchedules,
    removeTimedWakeSchedule,
    type TimedWakeSchedule,
} from "./timed-wake-storage";
import {
    getMenstrualPeriodCareEvent,
    hasMenstrualPeriodCareTriggered,
    loadMenstrualConfig,
    loadMenstrualRecords,
    saveMenstrualPeriodCareTrigger,
    type MenstrualPeriodCareEvent,
} from "./menstrual-storage";
import {
    MUSIC_COMPANION_REQUEST_EVENT,
    MUSIC_COMPANION_PROGRESS_EVENT,
    MUSIC_TRACK_CHANGED_EVENT,
    loadMusicCompanion,
    updateMusicCompanion,
    type MusicTrackChangedDetail,
    type MusicCompanionRequestDetail,
} from "./music-companion-storage";
import { chooseLibraryCandidates, ensureLyrics, filterPlayableTracks, representativeLyrics, saveRoleSongMemories, syncCompanionLibrary, type CompanionLibraryTrack } from "./music-companion-library";
import { getMusicControlBridge } from "./music-control-bridge";
import type { MusicTrack } from "./music-storage";

// ── Constants ──────────────────────────────────────────────
const MAX_FOLLOW_UPS = 10;
const POLL_INTERVAL_MS = 3000; // check every 3 s
const PERIOD_CARE_POLL_INTERVAL_MS = 60_000;
const BACKGROUND_MESSAGE_STAGGER_MS = 800;

function resolveFollowUpSenderName(sessionId: string): string {
    const sess = loadChatSessions().find(s => s.id === sessionId);
    if (!sess) return "角色";
    if (sess.isGroup) return sess.groupName?.trim() || "群聊";
    const alias = sess.alias?.trim();
    if (alias) return alias;
    return loadCharacters().find(character => character.id === sess.contactId)?.name?.trim() || "角色";
}

// ── Module state ───────────────────────────────────────────
let stopInterval: (() => void) | null = null;
let periodCareUpdateHandler: (() => void) | null = null;
let musicTrackChangedHandler: ((event: Event) => void) | null = null;
let musicCompanionRequestHandler: ((event: Event) => void) | null = null;
let musicReactionTimer: ReturnType<typeof setTimeout> | null = null;
let musicPlanningFiring = false;
const firingSet = new Set<string>(); // sessions currently mid-API-call
const cancelledWhileFiring = new Set<string>(); // cancelled during in-flight API call
const timedWakeFiringSet = new Set<string>();
const periodCareFiringSet = new Set<string>();
const backgroundReplyFiringSet = new Set<string>();
let lastPeriodCarePollAt = 0;

// ── Public API ─────────────────────────────────────────────

export function startFollowUpService() {
    if (stopInterval) return; // already running
    console.log("[FollowUp] Service started, polling every", POLL_INTERVAL_MS, "ms");
    stopInterval = bgSetInterval(pollSchedules, POLL_INTERVAL_MS);
    if (typeof window !== "undefined") {
        periodCareUpdateHandler = () => {
            lastPeriodCarePollAt = 0;
            pollMenstrualPeriodCare(Date.now());
        };
        window.addEventListener("menstrual-period-care-updated", periodCareUpdateHandler);
        musicTrackChangedHandler = handleMusicTrackChanged;
        window.addEventListener(MUSIC_TRACK_CHANGED_EVENT, musicTrackChangedHandler);
        musicCompanionRequestHandler = handleMusicCompanionRequest;
        window.addEventListener(MUSIC_COMPANION_REQUEST_EVENT, musicCompanionRequestHandler);
    }
}

export function stopFollowUpService() {
    if (stopInterval) { stopInterval(); stopInterval = null; }
    if (typeof window !== "undefined" && musicTrackChangedHandler) { window.removeEventListener(MUSIC_TRACK_CHANGED_EVENT, musicTrackChangedHandler); musicTrackChangedHandler = null; }
    if (typeof window !== "undefined" && musicCompanionRequestHandler) { window.removeEventListener(MUSIC_COMPANION_REQUEST_EVENT, musicCompanionRequestHandler); musicCompanionRequestHandler = null; }
    if (musicReactionTimer) { clearTimeout(musicReactionTimer); musicReactionTimer = null; }
    if (typeof window !== "undefined" && periodCareUpdateHandler) {
        window.removeEventListener("menstrual-period-care-updated", periodCareUpdateHandler);
        periodCareUpdateHandler = null;
    }
}

function compactMusicLyrics(raw: string | undefined, maxChars = 3200): string { if (!raw) return "（暂无歌词）"; const lines = raw.split(/\r?\n/).map(line => line.replace(/^(?:\[[^\]]+\])+\s*/, "").trim()).filter(line => line.length >= 2 && !/^(作词|作曲|编曲|制作人|纯音乐)/.test(line)); if (lines.length === 0) return "（暂无歌词）"; return lines.join("\n").slice(0, maxChars); }
function parsePlannerJson<T>(raw: string): T | null { const cleaned = raw.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim(); const start = cleaned.indexOf("{"); const end = cleaned.lastIndexOf("}"); if (start < 0 || end <= start) return null; try { return JSON.parse(cleaned.slice(start, end + 1)) as T; } catch { return null; } }
function plannerInstruction(sessionId: string, content: string): ChatMessage { return { id: `music_planner_${Date.now()}`, sessionId, role: "system", status: "sent", createdAt: new Date().toISOString(), mediaType: "system_instruction", content }; }
function handleMusicCompanionRequest(event: Event): void { const detail = (event as CustomEvent<MusicCompanionRequestDetail>).detail; if (!detail?.sessionId || musicPlanningFiring) return; setTimeout(() => void prepareMusicCompanion(detail), 0); }
function dispatchMusicProgress(request: MusicCompanionRequestDetail, percent: number, text: string, status = "running"): void { window.dispatchEvent(new CustomEvent(MUSIC_COMPANION_PROGRESS_EVENT, { detail: { sessionId: request.sessionId, characterId: request.characterId, percent: Math.max(0, Math.min(100, Math.round(percent))), text, status } })); }

async function prepareMusicCompanion(request: MusicCompanionRequestDetail): Promise<void> {
    if (musicPlanningFiring) return; musicPlanningFiring = true; updateMusicCompanion({ status: "preparing", error: undefined });
    try {
        const session = loadChatSessions().find(item => item.id === request.sessionId); if (!session || session.isGroup || session.contactId !== request.characterId) throw new Error("陪听仅支持当前一对一角色");
        const bridge = getMusicControlBridge(); if (!bridge) throw new Error("音乐播放器尚未加载，请先打开一次音乐App");
        const latestMessages = loadChatMessages(session.id); const library = await syncCompanionLibrary(progress => { const ratio = progress.total > 0 ? progress.current / progress.total : 1; dispatchMusicProgress(request, progress.stage === "metadata" ? 5 : progress.stage === "lyrics" ? 10 + ratio * 40 : 50, progress.text); }); let candidates = await chooseLibraryCandidates(library, request.characterId, 80); if (candidates.length < 15) throw new Error("网易云曲库歌曲不足，请先登录并同步歌单"); candidates = await ensureLyrics(candidates);
        const candidateText = candidates.map(track => [`ID=${track.id}｜${track.title}—${track.artist}`, `歌单=${track.playlistNames.slice(0, 3).join("/") || "未分类"}｜红心=${track.liked ? "是" : "否"}｜播放=${track.playCount}`, `歌词跨段摘录：${representativeLyrics(track.lyrics, 14) || "（无歌词/纯音乐）"}`].join("\n")).join("\n\n");
        dispatchMusicProgress(request, 55, `当前角色正在阅读 ${candidates.length} 首歌词`);
        const first = flattenCompletionResult(await generateChatCompletion(session, [...latestMessages, plannerInstruction(session.id, ["【角色陪听选歌｜第一轮】", "你就是当前人物卡中的角色。根据你自己的审美、你们刚才的聊天、时间与关系，从下面约80首真实曲库候选中亲自筛选25首。", "你已经看到每首歌跨主歌/副歌/桥段/结尾的真实歌词摘录，不要只凭标题。兼顾情绪推进、歌手多样性与可听性。", "只输出严格JSON：{\"shortlist\":[歌曲数字ID...]}。不得调用工具，不得输出解释。", candidateText].join("\n\n"))], { appTags: ["chat", "text", "music_companion_planner"] }));
        const parsedFirst = parsePlannerJson<{ shortlist?: Array<number | string> }>(first); const candidateMap = new Map(candidates.map(track => [String(track.id), track])); const shortlist = [...new Set((parsedFirst?.shortlist || []).map(String))].map(id => candidateMap.get(id)).filter(Boolean).slice(0, 30) as CompanionLibraryTrack[]; if (shortlist.length < request.count) throw new Error("角色没有成功选出足够候选，请重试一次");
        dispatchMusicProgress(request, 70, `初选完成，正在检查 ${shortlist.length} 首音源`); const playableShortlist = await filterPlayableTracks(shortlist); if (playableShortlist.length < request.count) throw new Error("入围歌曲中可播放数量不足，请重新选一批");
        const fullLyricsText = playableShortlist.map(track => [`ID=${track.id}｜${track.title}—${track.artist}`, compactMusicLyrics(track.lyrics, 3600) || "（无歌词/纯音乐）"].join("\n")).join("\n\n---\n\n");
        dispatchMusicProgress(request, 80, "正在阅读完整歌词并编排顺序");
        const second = flattenCompletionResult(await generateChatCompletion(session, [...latestMessages, plannerInstruction(session.id, ["【角色陪听选歌｜最终编排】", `你已初筛这些歌曲，现在阅读完整歌词并最终挑选${request.count}首。顺序就是实际播放顺序，要像你亲自为对方编排一段完整的陪听过程。`, "多数歌曲应安静陪听。只有确实值得开口时才写message，最多28个汉字；不要介绍歌或分析歌词。", `只输出严格JSON：{\"tracks\":[{\"id\":数字ID,\"understanding\":\"你对这首歌的一句理解\",\"silent\":true或false,\"message\":\"可选\"}]}。tracks必须恰好${request.count}首，不得调用工具。`, fullLyricsText].join("\n\n"))], { appTags: ["chat", "text", "music_companion_planner"] }));
        const parsedSecond = parsePlannerJson<{ tracks?: Array<{ id: number | string; understanding?: string; silent?: boolean; message?: string }> }>(second); const selectedRaw = parsedSecond?.tracks || []; const selected = selectedRaw.map(item => ({ item, track: candidateMap.get(String(item.id)) })).filter(entry => entry.track).slice(0, request.count) as Array<{ item: { id: number | string; understanding?: string; silent?: boolean; message?: string }; track: CompanionLibraryTrack }>; if (selected.length !== request.count) throw new Error("角色最终编排不完整，请重试一次");
        if (request.mode === "shuffle") for (let i = selected.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [selected[i], selected[j]] = [selected[j], selected[i]]; }
        const now = Date.now(); const queue: MusicTrack[] = selected.map(({ track }) => ({ id: `netease_${track.id}`, title: track.title, artist: track.artist, album: track.album, duration: 0, coverUrl: track.coverUrl, lyrics: track.lyrics, liked: track.liked, addedAt: new Date().toISOString() })); const plans = Object.fromEntries(selected.map(({ item, track }) => [`netease_${track.id}`, { trackId: `netease_${track.id}`, silent: item.silent !== false || !item.message?.trim(), ...(item.message?.trim() ? { message: item.message.trim().slice(0, 56) } : {}), expiresAt: now + 7 * 86_400_000 }]));
        await saveRoleSongMemories(request.characterId, selected.map(({ item, track }) => ({ trackId: String(track.id), understanding: item.understanding?.trim(), selectedCount: 1, lastSelectedAt: now }))); bridge.setPlayMode("sequence"); await bridge.addToQueue(queue, { replace: true, playFirst: true }); updateMusicCompanion({ status: "ready", selectedTrackIds: queue.map(track => track.id), plans }); dispatchMusicProgress(request, 100, `已选好 ${queue.length} 首，开始播放`, "ready");
    } catch (error) { const message = error instanceof Error ? error.message : String(error); console.warn("[MusicCompanion] Planning failed:", error); updateMusicCompanion({ status: "error", error: message }); pushChatMessage({ sessionId: request.sessionId, role: "system", content: `陪听准备失败：${message}` }); dispatchMusicProgress(request, 100, `陪听准备失败：${message}`, "error"); } finally { musicPlanningFiring = false; }
}

function handleMusicTrackChanged(event: Event): void { const detail = (event as CustomEvent<MusicTrackChangedDetail>).detail; if (!detail?.trackId) return; const companion = loadMusicCompanion(); if (!companion?.active) return; updateMusicCompanion({ lastTrackId: detail.trackId }); if (musicReactionTimer) clearTimeout(musicReactionTimer); musicReactionTimer = setTimeout(() => { musicReactionTimer = null; fireCachedMusicCompanionReaction(detail); }, 28_000); }
function fireCachedMusicCompanionReaction(detail: MusicTrackChangedDetail): void { const companion = loadMusicCompanion(); if (!companion?.active || companion.lastTrackId !== detail.trackId) return; const session = loadChatSessions().find(item => item.id === companion.sessionId); if (!session || session.isGroup || session.contactId !== companion.characterId) return; const latestMessages = loadChatMessages(session.id); const latestUser = [...latestMessages].reverse().find(message => message.role === "user"); if (latestUser && Date.parse(latestUser.createdAt) > detail.changedAt) return; const plan = companion.plans?.[detail.trackId]; if (!plan || plan.silent || !plan.message || plan.expiresAt < Date.now()) return; pushChatMessage({ sessionId: session.id, role: "assistant", content: plan.message, responseBatchId: createResponseBatchId(), rawResponseText: plan.message }); updateMusicCompanion({ lastReactedAt: Date.now() }); window.dispatchEvent(new CustomEvent("followup-fired", { detail: { sessionId: session.id } })); }

/** Schedule a follow-up for a session (called by ChatRoom after AI replies).
 *  Purely anxiety-driven: no anxiety field or below threshold → no follow-up. */
export function scheduleFollowUp(sessionId: string, count: number, stateValues?: StateValue[]) {
    const config = loadFollowUpConfig();

    if (!stateValues || stateValues.length === 0) {
        console.log(`[FollowUp] No state values, not scheduling.`);
        clearFollowUpSchedule(sessionId);
        return;
    }

    const anxietyEntry = stateValues.find(sv => sv.name === config.anxietyFieldName);
    if (!anxietyEntry) {
        console.log(`[FollowUp] No "${config.anxietyFieldName}" field found, not scheduling.`);
        clearFollowUpSchedule(sessionId);
        return;
    }

    if (anxietyEntry.value < config.anxietyThreshold) {
        console.log(`[FollowUp] Anxiety ${anxietyEntry.value} < threshold ${config.anxietyThreshold}, not scheduling.`);
        clearFollowUpSchedule(sessionId);
        return;
    }

    // Linear interpolation: threshold → maxDelay, 100 → minDelay
    const range = 100 - config.anxietyThreshold;
    const t = range > 0 ? (anxietyEntry.value - config.anxietyThreshold) / range : 1;
    const delaySec = Math.round(config.anxietyMaxDelay + t * (config.anxietyMinDelay - config.anxietyMaxDelay));
    const fireAt = Date.now() + delaySec * 1000;
    console.log(`[FollowUp] Anxiety-driven: value=${anxietyEntry.value}, delay=${delaySec}s, session=${sessionId}, count=${count}`);
    saveFollowUpSchedule({ sessionId, fireAt, count, delaySec });
}

export async function requestBackgroundChatReply(sessionId: string): Promise<{ ok: boolean; skipped?: string }> {
    if (backgroundReplyFiringSet.has(sessionId)) return { ok: false, skipped: "already_running" };
    const session = loadChatSessions().find(s => s.id === sessionId);
    if (!session) return { ok: false, skipped: "missing_session" };

    backgroundReplyFiringSet.add(sessionId);
    try {
        const latestMessages = loadChatMessages(session.id);
        window.dispatchEvent(new CustomEvent("followup-started", { detail: { sessionId: session.id } }));
        let reasoning: string | undefined;
        const aiResponseText = flattenCompletionResult(await generateChatCompletion(
            session,
            latestMessages,
            { appTags: session.isGroup ? undefined : ["chat", "text"] },
            { onReasoning: (t) => { reasoning = t; } },
        ));
        const { hasVisible, stateValues } = await parseAndSaveResponse(
            aiResponseText,
            session.id,
            0,
            undefined,
            latestMessages,
            { reasoningText: reasoning },
        );
        if (hasVisible) scheduleFollowUp(session.id, 0, stateValues);
        window.dispatchEvent(new CustomEvent("followup-fired", { detail: { sessionId: session.id } }));
        return { ok: true };
    } catch (error: any) {
        console.error("[BackgroundReply] Error:", error);
        pushChatMessage({
            sessionId,
            role: "system",
            content: `⚠️ 后台回复失败: ${error?.message || String(error)}`,
        });
        window.dispatchEvent(new CustomEvent("followup-fired", { detail: { sessionId } }));
        return { ok: false };
    } finally {
        backgroundReplyFiringSet.delete(sessionId);
    }
}

/** Cancel any pending follow-up for a session (called when user sends a message). */
export function cancelFollowUp(sessionId: string) {
    clearFollowUpSchedule(sessionId);
    // If an API call is already in-flight, mark it for cancellation
    if (firingSet.has(sessionId)) {
        cancelledWhileFiring.add(sessionId);
    }
}

// ── Internals ──────────────────────────────────────────────

function delay(ms: number): Promise<void> {
    return new Promise(resolve => window.setTimeout(resolve, ms));
}

async function dispatchBackgroundMessagesOneByOne(sessionId: string, messages: ChatMessage[]) {
    for (let index = 0; index < messages.length; index += 1) {
        if (index > 0) await delay(BACKGROUND_MESSAGE_STAGGER_MS);
        window.dispatchEvent(new CustomEvent("followup-message-saved", {
            detail: { sessionId, message: messages[index] },
        }));
    }
}

function pollSchedules() {
    try {
        const schedules = loadAllFollowUpSchedules();
        const now = Date.now();
        for (const sched of schedules) {
            if (sched.fireAt > now) {
                const remainSec = Math.round((sched.fireAt - now) / 1000);
                if (remainSec % 10 === 0) console.log(`[FollowUp] Waiting: session=${sched.sessionId}, ${remainSec}s remaining`);
                continue;
            }
            if (firingSet.has(sched.sessionId)) continue; // already in-flight
            console.log(`[FollowUp] Firing now for session=${sched.sessionId}, count=${sched.count}`);
            fireFollowUp(sched); // intentionally not awaited — fire & forget
        }
        pollTimedWakeSchedules(now);
        pollMenstrualPeriodCare(now);
    } catch (e) {
        console.error("[FollowUp] pollSchedules error:", e);
    }
}

function pollTimedWakeSchedules(now: number) {
    const schedules = loadTimedWakeSchedules();
    for (const sched of schedules) {
        if (sched.fireAt > now) continue;
        if (timedWakeFiringSet.has(sched.id)) continue;
        console.log(`[TimedWake] Firing now for session=${sched.sessionId}`);
        fireTimedWake(sched);
    }
}

function pollMenstrualPeriodCare(now: number) {
    if (now - lastPeriodCarePollAt < PERIOD_CARE_POLL_INTERVAL_MS) return;
    lastPeriodCarePollAt = now;

    const config = loadMenstrualConfig();
    if (!config.periodCareEnabled || config.periodCareCharacterIds.length === 0) return;

    const records = loadMenstrualRecords();
    const event = getMenstrualPeriodCareEvent(records, config);
    if (!event) return;

    const selectedIds = new Set(config.periodCareCharacterIds);
    const sessions = loadChatSessions()
        .filter(session => !session.isGroup && selectedIds.has(session.contactId))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const latestSessionByCharacter = new Map<string, (typeof sessions)[number]>();
    for (const session of sessions) {
        if (!latestSessionByCharacter.has(session.contactId)) {
            latestSessionByCharacter.set(session.contactId, session);
        }
    }

    for (const characterId of selectedIds) {
        if (hasMenstrualPeriodCareTriggered(characterId, event.cycleKey)) continue;
        const session = latestSessionByCharacter.get(characterId);
        if (!session) continue;
        const firingKey = `${characterId}:${event.cycleKey}`;
        if (periodCareFiringSet.has(firingKey)) continue;
        console.log(`[PeriodCare] Firing now for session=${session.id}, cycle=${event.cycleKey}`);
        fireMenstrualPeriodCare({
            sessionId: session.id,
            characterId,
            event,
        });
    }
}

async function fireFollowUp(sched: { sessionId: string; count: number; delaySec?: number }) {
    if (sched.count >= MAX_FOLLOW_UPS) {
        clearFollowUpSchedule(sched.sessionId);
        return;
    }

    firingSet.add(sched.sessionId);
    clearFollowUpSchedule(sched.sessionId); // clear before firing

    try {
        const sessions = loadChatSessions();
        const session = sessions.find(s => s.id === sched.sessionId);
        if (!session) return;

        const latestMessages = loadChatMessages(session.id);

        const count = sched.count + 1;

        // Find the last user message timestamp to calculate silence duration
        const lastUserMsg = [...latestMessages].reverse().find(m => m.role === "user");
        const lastUserTime = lastUserMsg ? new Date(lastUserMsg.createdAt).getTime() : Date.now();

        // Build message list with follow-up round markers so AI knows its history
        const annotatedMessages: ChatMessage[] = [];
        let currentRound = 0;
        for (const msg of latestMessages) {
            // When we encounter a new follow-up round, insert a marker
            if (msg.role === "assistant" && msg.followUpIndex && msg.followUpIndex > currentRound) {
                currentRound = msg.followUpIndex;
                const markerTime = new Date(msg.createdAt).getTime();
                const silenceSec = Math.round((markerTime - lastUserTime) / 1000);
                annotatedMessages.push({
                    id: `_marker_${currentRound}_${Date.now()}`,
                    sessionId: session.id,
                    role: "user",
                    content: `[对方没有回复你的消息，距上次回复已过约${silenceSec}秒]`,
                    status: "sent",
                    createdAt: msg.createdAt,
                });
            }
            annotatedMessages.push(msg);
        }

        const nowMs = Date.now();
        const finalSilenceSec = Math.round((nowMs - lastUserTime) / 1000);
        const messagesWithHint: ChatMessage[] = [
            ...annotatedMessages,
            {
                id: `_silence_${nowMs}`,
                sessionId: session.id,
                role: "system",
                content: `[对方没有回复你的消息，距上次回复已过约${finalSilenceSec}秒]`,
                status: "sent",
                createdAt: new Date().toISOString(),
            },
        ];

        // Notify UI that follow-up generation is starting (typing indicator)
        console.log("[FollowUp] Dispatching followup-started for session:", session.id);
        window.dispatchEvent(new CustomEvent("followup-started", { detail: { sessionId: session.id } }));

        let reasoning: string | undefined;
        const aiResponseText = flattenCompletionResult(await generateChatCompletion(
            session,
            messagesWithHint,
            { followUpCount: count, followUpDelay: sched.delaySec ?? 60, appTags: ["chat", "text", "followup"] },
            { onReasoning: (t) => { reasoning = t; } },
        ));

        // User sent a message while we were waiting for the API — discard result
        if (cancelledWhileFiring.has(sched.sessionId)) {
            console.log(`[FollowUp] Cancelled during API call, discarding result for session=${sched.sessionId}`);
            cancelledWhileFiring.delete(sched.sessionId);
            return;
        }

        const { hasVisible, newCount, stateValues } = await parseAndSaveResponse(aiResponseText, session.id, sched.count, count, latestMessages, { reasoningText: reasoning });
        console.log(`[FollowUp] Result: hasVisible=${hasVisible}, newCount=${newCount}`);

        if (hasVisible && newCount < MAX_FOLLOW_UPS) {
            scheduleFollowUp(session.id, newCount, stateValues);
        }

        // Notify any mounted UI
        window.dispatchEvent(new CustomEvent("followup-fired", { detail: { sessionId: session.id } }));

    } catch (error: any) {
        console.error(`[FollowUp] Error:`, error);
        pushChatMessage({
            sessionId: sched.sessionId,
            role: "system",
            content: `⚠️ 追发失败: ${error?.message || String(error)}`,
        });
        window.dispatchEvent(new CustomEvent("followup-fired", { detail: { sessionId: sched.sessionId } }));
    } finally {
        firingSet.delete(sched.sessionId);
        cancelledWhileFiring.delete(sched.sessionId);
    }
}

async function fireTimedWake(sched: TimedWakeSchedule) {
    timedWakeFiringSet.add(sched.id);
    removeTimedWakeSchedule(sched.id);

    try {
        const sessions = loadChatSessions();
        const session = sessions.find(s => s.id === sched.sessionId);
        if (!session || session.contactId !== sched.characterId) return;

        const latestMessages = loadChatMessages(session.id);
        const elapsedMinutes = Math.max(1, Math.round((Date.now() - sched.createdAt) / 60000));

        console.log("[TimedWake] Dispatching followup-started for session:", session.id);
        window.dispatchEvent(new CustomEvent("followup-started", { detail: { sessionId: session.id } }));

        let reasoning: string | undefined;
        const aiResponseText = flattenCompletionResult(await generateChatCompletion(
            session,
            latestMessages,
            {
                appTags: ["chat", "text", "timed_wake"],
                timedWakeElapsedMinutes: elapsedMinutes,
                timedWakeIntent: sched.intent,
            },
            { onReasoning: (t) => { reasoning = t; } },
        ));

        const { hasVisible, stateValues } = await parseAndSaveResponse(
            aiResponseText,
            session.id,
            0,
            undefined,
            latestMessages,
            { reasoningText: reasoning },
        );
        console.log(`[TimedWake] Result: hasVisible=${hasVisible}`);

        if (hasVisible) {
            scheduleFollowUp(session.id, 0, stateValues);
        }

        window.dispatchEvent(new CustomEvent("followup-fired", { detail: { sessionId: session.id } }));
    } catch (error: any) {
        console.error("[TimedWake] Error:", error);
        pushChatMessage({
            sessionId: sched.sessionId,
            role: "system",
            content: `⚠️ 稍后主动联系失败: ${error?.message || String(error)}`,
        });
        window.dispatchEvent(new CustomEvent("followup-fired", { detail: { sessionId: sched.sessionId } }));
    } finally {
        timedWakeFiringSet.delete(sched.id);
    }
}

async function fireMenstrualPeriodCare(input: {
    sessionId: string;
    characterId: string;
    event: MenstrualPeriodCareEvent;
}) {
    const firingKey = `${input.characterId}:${input.event.cycleKey}`;
    periodCareFiringSet.add(firingKey);

    try {
        const sessions = loadChatSessions();
        const session = sessions.find(s => s.id === input.sessionId);
        if (!session || session.isGroup || session.contactId !== input.characterId) return;
        if (hasMenstrualPeriodCareTriggered(input.characterId, input.event.cycleKey)) return;

        const latestMessages = loadChatMessages(session.id);

        console.log("[PeriodCare] Dispatching followup-started for session:", session.id);
        window.dispatchEvent(new CustomEvent("followup-started", { detail: { sessionId: session.id } }));

        let reasoning: string | undefined;
        const aiResponseText = flattenCompletionResult(await generateChatCompletion(
            session,
            latestMessages,
            {
                appTags: ["chat", "text", "period_care"],
                periodCareContext: input.event.context,
            },
            { onReasoning: (t) => { reasoning = t; } },
        ));

        const { hasVisible, stateValues } = await parseAndSaveResponse(
            aiResponseText,
            session.id,
            0,
            undefined,
            latestMessages,
            { reasoningText: reasoning },
        );
        saveMenstrualPeriodCareTrigger({
            characterId: input.characterId,
            sessionId: session.id,
            cycleKey: input.event.cycleKey,
        });
        console.log(`[PeriodCare] Result: hasVisible=${hasVisible}`);

        if (hasVisible) {
            scheduleFollowUp(session.id, 0, stateValues);
        }

        window.dispatchEvent(new CustomEvent("followup-fired", { detail: { sessionId: session.id } }));
    } catch (error: any) {
        console.error("[PeriodCare] Error:", error);
        pushChatMessage({
            sessionId: input.sessionId,
            role: "system",
            content: `⚠️ 经期关心失败: ${error?.message || String(error)}`,
        });
        window.dispatchEvent(new CustomEvent("followup-fired", { detail: { sessionId: input.sessionId } }));
    } finally {
        periodCareFiringSet.delete(firingKey);
    }
}

// ── AI media action handler for follow-up context ──

function handleFollowUpMediaAction(
    actionType: string,
    sessionId: string,
    contextMessages: ChatMessage[],
) {
    const targetMediaType = actionType.includes("payment_request")
        ? "payment_request"
        : actionType.includes("red_packet") ? "red_packet" : "transfer";
    const targetMsg = [...contextMessages].reverse().find(
        m => m.role === "user" && m.mediaType === targetMediaType && m.mediaData?.status === "pending"
    );
    if (!targetMsg) return;

    const charName = resolveFollowUpSenderName(sessionId);
    const userName = "你";
    const responseBatchId = createResponseBatchId();

    let newStatus: "opened" | "received" | "declined" | "paid";
    let sysText: string;
    let rawResponseText: string;
    if (actionType === "accept_red_packet") {
        newStatus = "opened";
        sysText = `${charName}领取了${userName}的红包`;
        rawResponseText = `[${charName}领取了${userName}的红包]`;
    } else if (actionType === "decline_red_packet") {
        newStatus = "declined";
        sysText = `${charName}退回了${userName}的红包`;
        rawResponseText = `[${charName}退回了${userName}的红包]`;
    } else if (actionType === "accept_transfer") {
        newStatus = "received";
        sysText = `${charName}已收款`;
        rawResponseText = `[${charName}领取了${userName}的转账]`;
    } else if (actionType === "accept_payment_request") {
        newStatus = "paid";
        sysText = `${charName}接受了${userName}的代付请求`;
        rawResponseText = `[${charName}接受了${userName}的代付]`;
        settleShoppingPaymentRequest({
            orderId: targetMsg.mediaData?.shoppingOrderId,
            requestId: targetMsg.mediaData?.paymentRequestId,
            accepted: true,
            payerCharacterName: charName,
        });
    } else if (actionType === "decline_payment_request") {
        newStatus = "declined";
        sysText = `${charName}拒绝了${userName}的代付请求`;
        rawResponseText = `[${charName}拒绝了${userName}的代付]`;
        settleShoppingPaymentRequest({
            orderId: targetMsg.mediaData?.shoppingOrderId,
            requestId: targetMsg.mediaData?.paymentRequestId,
            accepted: false,
            payerCharacterName: charName,
        });
    } else {
        newStatus = "declined";
        sysText = `${charName}退回了${userName}的转账`;
        rawResponseText = `[${charName}退回了${userName}的转账]`;
    }

    if (targetMediaType === "payment_request") {
        updateMessageMediaData(targetMsg.id, {
            ...targetMsg.mediaData,
            status: newStatus,
            paymentResolvedAt: new Date().toISOString(),
            paymentPayerName: charName,
        });
    } else {
        updateMessageMediaStatus(targetMsg.id, newStatus as "opened" | "received" | "declined");
    }
    pushChatMessage({
        sessionId,
        role: "system",
        content: sysText,
        responseBatchId,
        rawResponseText,
    });
}

// ── Response parser (uses shared parseAIResponse) ──

function buildGeneratedFollowUpImageMessage(
    part: ParsedMessagePart,
): Pick<ChatMessage, "content" | "mediaType" | "mediaUrl" | "mediaData"> {
    const base = {
        content: part.content,
        mediaType: part.mediaType,
        mediaData: part.mediaData,
    };
    if (part.mediaType !== "image") return base;

    const description = part.mediaData?.label?.trim();
    if (!description) return base;

    return {
        ...base,
        mediaData: createPendingChatGeneratedImageData(part.mediaData, description),
    };
}

// options.senderCharacterId/senderName：群聊消息的发言角色（单聊不传）。
export async function parseAndSaveResponse(
    rawText: string,
    sessionId: string,
    currentCount: number,
    followUpIndex: number | undefined,
    contextMessages: ChatMessage[],
    options?: {
        senderCharacterId?: string;
        senderName?: string;
        reasoningText?: string;
    },
): Promise<{ hasVisible: boolean; newCount: number; stateValues: StateValue[] }> {
    const responseBatchId = createResponseBatchId();
    const reasoningText = options?.reasoningText;
    void contextMessages;
    const sessions = loadChatSessions();
    const sess = sessions.find(s => s.id === sessionId);
    const previousState = sess && !sess.isGroup ? getLatestCharacterStateValues(sess.contactId) : [];

    const { parts, stateValues, freshStateValues, statusPanel, innerMonologue } = parseAIResponse(rawText, previousState);

    // Detect call triggers and AI media actions, filter them out (not stored as messages)
    let triggerCall: "voice" | "video" | undefined;
    const charName = resolveFollowUpSenderName(sessionId);

    const pokeSysMessages: ChatMessage[] = [];
    const filteredParts = parts.filter(p => {
        if (p.mediaType === "voice_call") { triggerCall = "voice"; return false; }
        if (p.mediaType === "video_call") { triggerCall = "video"; return false; }
        // 「丢弃角色输出的无效表情包」开关（主动消息路径）
        if (p.mediaType === "sticker" && sess?.discardInvalidStickers === true) {
            const senderIds = sess.isGroup ? (sess.participantIds ?? []) : [sess.contactId];
            if (!isKnownStickerLabel(p.mediaData?.label || "", senderIds)) return false;
        }
        if (p.mediaType === "accept_red_packet" || p.mediaType === "decline_red_packet"
            || p.mediaType === "accept_transfer" || p.mediaType === "decline_transfer"
            || p.mediaType === "accept_payment_request" || p.mediaType === "decline_payment_request") {
            handleFollowUpMediaAction(p.mediaType, sessionId, contextMessages);
            return false;
        }
        // Poke: convert to system message (resolve "我" to character name)
        if (p.mediaType === "poke") {
            const pokeSender = (p.mediaData?.pokeSender === "我" ? charName : p.mediaData?.pokeSender) || charName;
            const pokeTarget = p.mediaData?.pokeTarget || "你";
            pokeSysMessages.push(pushChatMessage({
                sessionId, role: "system",
                content: `${pokeSender} 拍了拍 ${pokeTarget}`,
                mediaType: "poke",
                mediaData: { pokeSender, pokeTarget },
                responseBatchId: createResponseBatchId(),
                rawResponseText: `[${pokeSender}拍了拍${pokeTarget}]`,
            }));
            return false;
        }
        return true;
    });

    // Save call trigger as system message (persists even when user is not in chat room)
    if (triggerCall) {
        const callLabel = triggerCall === "voice" ? "语音通话" : "视频通话";
        pushChatMessage({
            sessionId,
            role: "system",
            content: `[我发起了${callLabel}]`,
            responseBatchId: createResponseBatchId(),
            rawResponseText: `[我发起了${callLabel}]`,
        });
    }

    if (filteredParts.length === 0) {
        if (statusPanel || innerMonologue || reasoningText) {
            pushChatMessage({
                sessionId,
                role: "assistant",
                content: "",
                responseBatchId,
                rawResponseText: rawText,
                statusPanel,
                innerMonologue,
                reasoningText,
                stateValues: stateValues.length > 0 ? stateValues : undefined,
                freshStateValues,
                ...(followUpIndex ? { followUpIndex } : {}),
            });
        }
        // Emit call trigger event for chat-room to pick up
        if (triggerCall && typeof window !== "undefined") {
            window.dispatchEvent(new CustomEvent("ai-call-trigger", { detail: { sessionId, type: triggerCall } }));
        }
        return { hasVisible: false, newCount: MAX_FOLLOW_UPS, stateValues };
    }

    const savedMessages: ChatMessage[] = [];
    const imageReplacementTasks: Promise<unknown>[] = [];
    for (let i = 0; i < filteredParts.length; i++) {
        const generatedPart = buildGeneratedFollowUpImageMessage(filteredParts[i]);
        const saved = pushChatMessage({
            sessionId,
            role: "assistant",
            content: generatedPart.content,
            mediaType: generatedPart.mediaType,
            mediaUrl: generatedPart.mediaUrl,
            mediaData: generatedPart.mediaData,
            responseBatchId,
            rawResponseText: rawText,
            statusPanel: i === 0 && statusPanel ? statusPanel : undefined,
            innerMonologue: i === 0 && innerMonologue ? innerMonologue : undefined,
            reasoningText: i === 0 ? reasoningText : undefined,
            stateValues: i === 0 && stateValues.length > 0 ? stateValues : undefined,
            freshStateValues: i === 0 ? freshStateValues : undefined,
            senderCharacterId: options?.senderCharacterId,
            senderName: options?.senderName,
            ...(followUpIndex ? { followUpIndex } : {}),
        });
        if (isPendingChatGeneratedImageMessage(saved)) {
            imageReplacementTasks.push(
                generateAndApplyChatGeneratedImage(saved, sess?.contactId)
                    .catch(error => {
                        console.warn("[FollowUp] Image generation failed:", error);
                        return null;
                    }),
            );
        }
        savedMessages.push(saved);
    }

    await dispatchBackgroundMessagesOneByOne(sessionId, savedMessages);
    if (imageReplacementTasks.length > 0) {
        await Promise.allSettled(imageReplacementTasks);
    }

    // In-app notice for follow-up messages: rotate through multi-bubble replies.
    if (filteredParts.length > 0) {
        const isGroup = sess?.isGroup === true;
        const bodyPrefix = isGroup && options?.senderName ? `${options.senderName}: ` : "";
        filteredParts.forEach((part, index) => {
            const body = bodyPrefix + ((part.content || "").trim()
                || (part.mediaType === "image" && part.mediaData?.label ? `发了一张照片: ${part.mediaData.label}` : "发来一条消息"));
            window.setTimeout(() => {
                dispatchChatMessageNotice({
                    sessionId,
                    senderName: charName,
                    body: body.slice(0, 80),
                    ...(isGroup ? { isGroup: true } : {}),
                });
            }, index * 1000);
        });
        import("./browser-notification").then(({ sendBrowserNotification }) => {
            const firstPart = filteredParts[0];
            const body = bodyPrefix + (firstPart.content.trim()
                || (firstPart.mediaType === "image" && firstPart.mediaData?.label ? `发了一张照片: ${firstPart.mediaData.label}` : "发来一条消息"));
            sendBrowserNotification(charName, { body: body.slice(0, 50) });
        });
    }

    // Emit call trigger event for chat-room to pick up
    if (triggerCall && typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("ai-call-trigger", { detail: { sessionId, type: triggerCall } }));
    }

    return { hasVisible: true, newCount: currentCount + 1, stateValues };
}
