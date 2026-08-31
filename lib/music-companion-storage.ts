import { kvGet, kvSet, registerKvMigration } from "./kv-db";

const MUSIC_COMPANION_KEY = "ai_phone_music_companion_v1";
export const MUSIC_TRACK_CHANGED_EVENT = "music-track-changed";
export const MUSIC_COMPANION_REQUEST_EVENT = "music-companion-requested";
export const MUSIC_COMPANION_PROGRESS_EVENT = "music-companion-progress";
registerKvMigration(MUSIC_COMPANION_KEY);

export type MusicCompanionState = { active: boolean; sessionId: string; characterId: string; startedAt: number; lastTrackId?: string; lastReactedAt?: number; plans?: Record<string, MusicCompanionPlan>; status?: "preparing" | "ready" | "playing" | "error"; selectedTrackIds?: string[]; error?: string };
export type MusicCompanionPlan = { trackId: string; silent: boolean; message?: string; cue?: string; expiresAt: number };
export type MusicCompanionRequestDetail = { sessionId: string; characterId: string; requestedAt: number; mode: "curated" | "shuffle"; count: number };
export type MusicTrackChangedDetail = { trackId: string; title: string; artist: string; lyrics?: string; changedAt: number };

export function loadMusicCompanion(): MusicCompanionState | null { if (typeof window === "undefined") return null; try { const raw = kvGet(MUSIC_COMPANION_KEY); const value = raw ? JSON.parse(raw) as Partial<MusicCompanionState> : null; if (!value?.active || !value.sessionId || !value.characterId || !value.startedAt) return null; return value as MusicCompanionState; } catch { return null; } }
export function startMusicCompanion(sessionId: string, characterId: string): MusicCompanionState { const state: MusicCompanionState = { active: true, sessionId, characterId, startedAt: Date.now(), status: "preparing", selectedTrackIds: [], plans: {} }; kvSet(MUSIC_COMPANION_KEY, JSON.stringify(state)); return state; }
export function updateMusicCompanion(patch: Partial<MusicCompanionState>): MusicCompanionState | null { const current = loadMusicCompanion(); if (!current) return null; const next = { ...current, ...patch }; kvSet(MUSIC_COMPANION_KEY, JSON.stringify(next)); return next; }
export function stopMusicCompanion(): void { kvSet(MUSIC_COMPANION_KEY, ""); }
