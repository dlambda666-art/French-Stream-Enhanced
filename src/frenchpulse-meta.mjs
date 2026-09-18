/**
 * FrenchPulse shared metadata contract.
 *
 * Additive only: consumers can ignore these fields safely.
 * IDs are stable across FrenchPulse and French Stream Enhanced.
 */

export const FRENCHPULSE_META_VERSION = 1;

export function buildFrenchPulseMeta({
    tmdbId = null,
    imdbId = null,
    title = null,
    year = null,
    poster = null,
    backdrop = null,
    originalTitle = null,
    vf = false,
    vfSource = null,
    vfVerified = false,
    quality = null,
    status = null,
    reason = null,
    digitalReleaseDate = null
} = {}) {
    return {
        frenchpulse_meta_version: FRENCHPULSE_META_VERSION,
        tmdb_id: tmdbId,
        imdb_id: imdbId,
        title,
        year,
        poster,
        backdrop,
        original_title: originalTitle,
        vf: Boolean(vf),
        vf_source: vfSource,
        vf_verified: Boolean(vfVerified),
        quality,
        status,
        reason,
        digital_release_date: digitalReleaseDate
    };
}

export function normalizeFrenchPulseStatus(value) {
    if (!value) return null;
    const allowed = new Set([
        'nouveaute_vf',
        'a_surveiller',
        'unresolved'
    ]);
    return allowed.has(value) ? value : null;
}
