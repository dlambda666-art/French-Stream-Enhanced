const CINEMETA_ORIGIN = 'https://v3-cinemeta.strem.io';

function normalizeTitle(value) {
    return (value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/\(?\d{4}\)?/g, '')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

export function chooseBestCinemetaMatch(title, type, metas = []) {
    const expectedTitle = normalizeTitle(title);
    const candidates = metas.filter(meta => meta?.id?.startsWith('tt') && meta.type === type);
    if (!expectedTitle || !candidates.length) return null;

    return candidates.find(meta => normalizeTitle(meta.name) === expectedTitle) || candidates[0];
}

export function createMetaFromCinemetaMatch(match, type, fallbackTitle) {
    if (!match?.id?.startsWith('tt')) return null;

    return {
        id: match.id,
        type,
        name: match.name || fallbackTitle,
        poster: match.poster,
        background: match.background,
        description: match.description,
        releaseInfo: match.year || match.releaseInfo,
        imdbRating: match.imdbRating,
        genres: match.genres,
        runtime: match.runtime,
        behaviorHints: type === 'movie' ? { defaultVideoId: match.id, hasScheduledVideos: false } : undefined
    };
}

export async function resolveCinemetaMeta(title, type, fetchImpl = fetch) {
    if (!title) return null;

    try {
        const response = await fetchImpl(`${CINEMETA_ORIGIN}/catalog/${type}/top/search=${encodeURIComponent(title)}.json`);
        if (!response.ok) return null;

        const data = await response.json();
        const match = chooseBestCinemetaMatch(title, type, data.metas);
        if (!match) return null;

        const detailResponse = await fetchImpl(`${CINEMETA_ORIGIN}/meta/${type}/${match.id}.json`);
        if (!detailResponse.ok) return createMetaFromCinemetaMatch(match, type, title);

        const detailData = await detailResponse.json();
        return createMetaFromCinemetaMatch(detailData.meta || match, type, title);
    } catch (error) {
        return null;
    }
}
