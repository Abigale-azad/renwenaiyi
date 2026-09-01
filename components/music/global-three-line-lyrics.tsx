"use client";

import { useMemo } from "react";

import { useMusicPlayerOptional } from "@/lib/music-context";

type LyricLine = {
    time: number;
    text: string;
};

function parseLrc(lrc: string): LyricLine[] {
    const rows: LyricLine[] = [];

    for (const rawLine of lrc.split("\n")) {
        const timestamps = [...rawLine.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
        if (!timestamps.length) continue;

        const text = rawLine.replace(/\[[^\]]+\]/g, "").trim();
        if (!text) continue;

        for (const timestamp of timestamps) {
            const minutes = Number(timestamp[1]);
            const seconds = Number(timestamp[2]);
            const time = minutes * 60 + seconds;
            if (Number.isFinite(time)) rows.push({ time, text });
        }
    }

    return rows.sort((a, b) => a.time - b.time);
}

export function GlobalThreeLineLyrics() {
    const player = useMusicPlayerOptional();
    const lyrics = useMemo(
        () => parseLrc(player?.currentTrack?.lyrics || ""),
        [player?.currentTrack?.lyrics],
    );
    const activeIndex = useMemo(() => {
        if (!player || !lyrics.length) return -1;
        for (let index = lyrics.length - 1; index >= 0; index -= 1) {
            if (player.currentTime >= lyrics[index].time) return index;
        }
        return -1;
    }, [lyrics, player?.currentTime]);

    if (!player?.currentTrack || player.showFullPlayer || activeIndex < 0) return null;

    return (
        <aside
            className="global-three-line-lyrics"
            data-playing={player.isPlaying ? "1" : "0"}
            aria-hidden="true"
        >
            <div className="global-lyric-line global-lyric-line-near">
                {lyrics[activeIndex - 1]?.text || "\u00a0"}
            </div>
            <div className="global-lyric-line global-lyric-line-active">
                {lyrics[activeIndex]?.text}
            </div>
            <div className="global-lyric-line global-lyric-line-near">
                {lyrics[activeIndex + 1]?.text || "\u00a0"}
            </div>
        </aside>
    );
}
