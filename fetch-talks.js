// scripts/fetch-talks.js
// Fetches all videos from the JewishGen Talks YouTube playlist and writes
// talks-data.json to the repository root. Run via GitHub Actions workflow.
// Requires YOUTUBE_API_KEY environment variable (stored in GitHub Secrets).

'use strict';

const fs   = require('fs');
const path = require('path');

const API_KEY    = process.env.YOUTUBE_API_KEY;
const PLAYLIST_ID = 'PL2SY5Vnun7fmaXzzTT-O1ozboh1k3xYyV';
const BASE       = 'https://www.googleapis.com/youtube/v3';

// ---------------------------------------------------------------------------
// Title cleanup: strips "JewishGen Talks:" / "JewishGen Talk:" prefix.
// Applied at build time so the saved JSON has clean titles; the client-side
// cleanTitle() in talks.html is a safety-net no-op for anything that slips.
// ---------------------------------------------------------------------------
function cleanTitle(raw) {
    if (!raw) return '';
    return raw.replace(/^\s*JewishGen\s+Talks?:?\s*/i, '').trim();
}

// ---------------------------------------------------------------------------
// ISO 8601 duration parser: PT1H2M3S -> "1:02:03" / PT51M56S -> "51:56"
// ---------------------------------------------------------------------------
function parseDuration(iso) {
    if (!iso) return '';
    const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!m) return '';
    const h = parseInt(m[1] || '0', 10);
    const min = parseInt(m[2] || '0', 10);
    const s = parseInt(m[3] || '0', 10);
    if (h > 0) {
        return `${h}:${String(min).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
    return `${min}:${String(s).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Step 1: Collect all video IDs from the playlist (paginated, 50 per page).
// Returns IDs in playlist order (newest first, per channel configuration).
// ---------------------------------------------------------------------------
async function fetchPlaylistVideoIds() {
    const ids = [];
    let pageToken = '';

    do {
        const url = new URL(`${BASE}/playlistItems`);
        url.searchParams.set('part', 'contentDetails');
        url.searchParams.set('playlistId', PLAYLIST_ID);
        url.searchParams.set('maxResults', '50');
        url.searchParams.set('key', API_KEY);
        if (pageToken) url.searchParams.set('pageToken', pageToken);

        const res = await fetch(url.toString());
        if (!res.ok) {
            const body = await res.text();
            throw new Error(`playlistItems fetch failed [${res.status}]: ${body}`);
        }
        const data = await res.json();

        for (const item of data.items) {
            // Skip private/deleted videos that appear as placeholders
            const vid = item.contentDetails.videoId;
            if (vid) ids.push(vid);
        }

        pageToken = data.nextPageToken || '';
    } while (pageToken);

    return ids;
}

// ---------------------------------------------------------------------------
// Step 2: Fetch snippet + contentDetails for all IDs (batched at 50).
// Returns a Map keyed by video ID to preserve ordering separately.
// ---------------------------------------------------------------------------
async function fetchVideoDetailMap(ids) {
    const map = new Map();

    for (let i = 0; i < ids.length; i += 50) {
        const batch = ids.slice(i, i + 50);
        const url = new URL(`${BASE}/videos`);
        url.searchParams.set('part', 'snippet,contentDetails');
        url.searchParams.set('id', batch.join(','));
        url.searchParams.set('key', API_KEY);

        const res = await fetch(url.toString());
        if (!res.ok) {
            const body = await res.text();
            throw new Error(`videos fetch failed [${res.status}]: ${body}`);
        }
        const data = await res.json();

        for (const item of data.items) {
            const sn = item.snippet;
            const thumb =
                sn.thumbnails?.maxres?.url ||
                sn.thumbnails?.high?.url   ||
                sn.thumbnails?.medium?.url ||
                sn.thumbnails?.default?.url || '';

            map.set(item.id, {
                id:          item.id,
                title:       cleanTitle(sn.title),
                description: sn.description || '',
                publishedAt: sn.publishedAt ? sn.publishedAt.slice(0, 10) : '',
                duration:    parseDuration(item.contentDetails.duration),
                thumbnail:   thumb
            });
        }
    }

    return map;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
    if (!API_KEY) {
        throw new Error('YOUTUBE_API_KEY environment variable is not set.');
    }

    console.log('Fetching playlist video IDs...');
    const ids = await fetchPlaylistVideoIds();
    console.log(`Found ${ids.length} video IDs in playlist.`);

    console.log('Fetching video details...');
    const detailMap = await fetchVideoDetailMap(ids);
    console.log(`Retrieved details for ${detailMap.size} videos.`);

    // Reconstruct in original playlist order; skip any IDs not returned
    // (e.g. private or deleted videos that slipped through the playlist).
    const videos = ids.map(id => detailMap.get(id)).filter(Boolean);

    const output = {
        generated:  new Date().toISOString(),
        playlistId: PLAYLIST_ID,
        count:      videos.length,
        videos
    };

    const outPath = path.join(__dirname, '..', 'talks-data.json');
    fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf8');
    console.log(`Done. Wrote ${videos.length} videos to ${outPath}`);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
