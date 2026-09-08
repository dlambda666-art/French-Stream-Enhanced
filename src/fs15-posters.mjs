export const BETTERPOSTER_BASE = 'https://btttr.cc/poster-qa/imdb/poster-default/';

export function betterPosterUrl(imdbId) {
    if (!imdbId || !/^tt\d+$/i.test(imdbId)) return null;
    return `${BETTERPOSTER_BASE}${encodeURIComponent(imdbId)}.jpg?lang=fr`;
}

export function choosePoster({ imdbId, tmdbPoster = null, fsPoster = null } = {}) {
    return betterPosterUrl(imdbId) || tmdbPoster || fsPoster || null;
}
