const { addonBuilder } = require('stremio-addon-sdk');
const fetch = require('node-fetch');

const TMDB_BASE = 'https://api.themoviedb.org/3';
const IMAGE_BASE = 'https://image.tmdb.org/t/p/w500';
const BACKDROP_BASE = 'https://image.tmdb.org/t/p/w1280';
const MAX_RESULTS = 40;
const MOVIE_PAGES = 8;
const SERIES_PAGES = 8;
const CACHE_TTL = 30 * 60 * 1000;
const cache = new Map();

const MOVIE_EXCLUDED_GENRES = new Set([99, 10402, 10770]);
const SERIES_EXCLUDED_GENRES = new Set([99, 10763, 10764, 10767]);

function parseConfig(configStr) {
  if (!configStr) return { tmdbKey: process.env.TMDB_API_KEY || null };
  try {
    const decoded = Buffer.from(configStr, 'base64').toString('utf8');
    const cfg = JSON.parse(decoded);
    return { tmdbKey: cfg.t || cfg.tmdbKey || process.env.TMDB_API_KEY || null };
  } catch {
    return { tmdbKey: process.env.TMDB_API_KEY || null };
  }
}

async function tmdb(path, params, config) {
  if (!config.tmdbKey) throw new Error('TMDB_API_KEY manquante');
  const qs = new URLSearchParams({ api_key: config.tmdbKey, language: 'fr-FR', ...params });
  const url = `${TMDB_BASE}${path}?${qs.toString()}`;
  const cached = cache.get(url);
  if (cached && cached.expires > Date.now()) return cached.value;
  const response = await fetch(url, { headers: { 'User-Agent': 'French-Stream-Enhanced/1.0' } });
  if (!response.ok) throw new Error(`TMDB ${response.status}`);
  const data = await response.json();
  cache.set(url, { value: data, expires: Date.now() + CACHE_TTL });
  return data;
}

const poster = path => path ? `${IMAGE_BASE}${path}` : null;
const backdrop = path => path ? `${BACKDROP_BASE}${path}` : null;
const today = () => new Date().toISOString().slice(0, 10);

function daysAgo(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function daysUntil(date) {
  if (!date) return 9999;
  const t = Date.parse(`${date}T00:00:00Z`);
  return Math.round((t - Date.now()) / 86400000);
}

function movieScore(item, digitalDate) {
  const days = digitalDate ? Math.max(0, Math.floor((Date.now() - Date.parse(`${digitalDate}T00:00:00Z`)) / 86400000)) : 9999;
  let score = 0;
  if (days <= 7) score += 1500;
  else if (days <= 14) score += 1200;
  else if (days <= 30) score += 900;
  else if (days <= 60) score += 600;
  else if (days <= 90) score += 350;
  else if (days <= 180) score += 150;
  score += Math.min(Number(item.popularity || 0) * 4, 500);
  score += Number(item.vote_average || 0) * 10;
  const votes = Number(item.vote_count || 0);
  if (votes >= 1000) score += 120;
  else if (votes >= 500) score += 80;
  else if (votes >= 100) score += 40;
  else if (votes >= 20) score += 15;
  return score;
}

function seriesScore(item) {
  const last = daysUntil(item.last_air_date);
  const first = daysUntil(item.first_air_date);
  let score = 0;
  const recent = Math.min(Math.abs(last), Math.abs(first));
  if (recent <= 7) score += 1500;
  else if (recent <= 14) score += 1200;
  else if (recent <= 30) score += 900;
  else if (recent <= 60) score += 600;
  else if (recent <= 90) score += 350;
  else if (recent <= 180) score += 150;
  score += Math.min(Number(item.popularity || 0) * 4, 600);
  score += Number(item.vote_average || 0) * 10;
  const votes = Number(item.vote_count || 0);
  if (votes >= 1000) score += 120;
  else if (votes >= 500) score += 80;
  else if (votes >= 100) score += 40;
  return score;
}

function movieMeta(item, digitalDate) {
  return {
    id: `tmdbm:${item.id}`,
    type: 'movie',
    name: item.title || item.original_title || 'Sans titre',
    poster: poster(item.poster_path),
    background: backdrop(item.backdrop_path),
    description: item.overview || undefined,
    releaseInfo: digitalDate || item.release_date || undefined,
    imdbRating: item.vote_average ? Number(item.vote_average.toFixed(1)) : undefined
  };
}

function seriesMeta(item) {
  return {
    id: `tmdbs:${item.id}`,
    type: 'series',
    name: item.name || item.original_name || 'Sans titre',
    poster: poster(item.poster_path),
    background: backdrop(item.backdrop_path),
    description: item.overview || undefined,
    releaseInfo: item.first_air_date ? item.first_air_date.slice(0, 4) : undefined,
    imdbRating: item.vote_average ? Number(item.vote_average.toFixed(1)) : undefined
  };
}

async function getDigitalDate(movieId, config) {
  const data = await tmdb(`/movie/${movieId}/release_dates`, {}, config);
  const releases = data.results?.find(x => x.iso_3166_1 === 'FR')?.release_dates || [];
  const digital = releases
    .filter(x => Number(x.type) === 4 && x.release_date)
    .map(x => x.release_date.slice(0, 10))
    .sort()
    .pop();
  return digital || null;
}

async function discoverMovies(config) {
  const candidates = new Map();
  for (let page = 1; page <= MOVIE_PAGES; page++) {
    const data = await tmdb('/discover/movie', {
      include_adult: 'false',
      region: 'FR',
      sort_by: 'primary_release_date.desc',
      'primary_release_date.gte': daysAgo(365),
      'primary_release_date.lte': today(),
      with_release_type: '4',
      'vote_count.gte': '1',
      page: String(page)
    }, config);
    for (const item of data.results || []) {
      if (!item.poster_path || (item.genre_ids || []).some(g => MOVIE_EXCLUDED_GENRES.has(g))) continue;
      candidates.set(item.id, item);
    }
  }

  const items = [...candidates.values()];
  let cursor = 0;
  const enriched = [];
  async function worker() {
    while (cursor < items.length) {
      const item = items[cursor++];
      try {
        const digitalDate = await getDigitalDate(item.id, config);
        if (!digitalDate || digitalDate > today()) continue;
        enriched.push({ item, digitalDate, score: movieScore(item, digitalDate) });
      } catch (e) {
        console.log(`[TMDB] release_dates ${item.id}: ${e.message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(8, items.length) }, worker));
  enriched.sort((a, b) => b.score - a.score || String(b.digitalDate).localeCompare(String(a.digitalDate)));
  return enriched.slice(0, MAX_RESULTS).map(x => movieMeta(x.item, x.digitalDate));
}

async function discoverSeries(config) {
  const candidates = new Map();
  for (let page = 1; page <= SERIES_PAGES; page++) {
    const data = await tmdb('/discover/tv', {
      include_adult: 'false',
      sort_by: 'first_air_date.desc',
      'first_air_date.gte': daysAgo(365),
      'first_air_date.lte': today(),
      'vote_count.gte': '1',
      page: String(page)
    }, config);
    for (const item of data.results || []) {
      if (!item.poster_path || (item.genre_ids || []).some(g => SERIES_EXCLUDED_GENRES.has(g))) continue;
      candidates.set(item.id, item);
    }
  }
  return [...candidates.values()]
    .sort((a, b) => seriesScore(b) - seriesScore(a))
    .slice(0, MAX_RESULTS)
    .map(seriesMeta);
}

function createManifest() {
  return {
    id: 'community.french-stream-enhanced',
    version: '3.0.0',
    name: 'French Stream Enhanced',
    description: 'Releases françaises dynamiques alimentées par TMDB.',
    resources: ['catalog', 'meta'],
    types: ['movie', 'series'],
    idPrefixes: ['tmdbm:', 'tmdbs:'],
    catalogs: [
      { type: 'movie', id: 'films-releases-fr', name: 'Films — Releases FR' },
      { type: 'series', id: 'series-releases-fr', name: 'Séries — Releases FR' }
    ],
    behaviorHints: { configurable: true }
  };
}

function getAddonInterface(configStr) {
  const config = parseConfig(configStr);
  const builder = new addonBuilder(createManifest());

  builder.defineCatalogHandler(async ({ type, id }) => {
    try {
      if (type === 'movie' && id === 'films-releases-fr') return { metas: await discoverMovies(config) };
      if (type === 'series' && id === 'series-releases-fr') return { metas: await discoverSeries(config) };
      return { metas: [] };
    } catch (err) {
      console.error(`[catalog:${id}]`, err.message);
      return { metas: [] };
    }
  });

  builder.defineMetaHandler(async ({ type, id }) => {
    try {
      const numeric = String(id).replace(/^tmdb[ms]:/, '');
      const endpoint = type === 'movie' ? 'movie' : 'tv';
      const data = await tmdb(`/${endpoint}/${encodeURIComponent(numeric)}`, { append_to_response: 'credits' }, config);
      const crew = data.credits?.crew || [];
      const cast = (data.credits?.cast || []).slice(0, 12).map(p => ({ name: p.name, character: p.character }));
      return { meta: {
        id: type === 'movie' ? `tmdbm:${data.id}` : `tmdbs:${data.id}`,
        type,
        name: type === 'movie' ? (data.title || data.original_title) : (data.name || data.original_name),
        poster: poster(data.poster_path),
        background: backdrop(data.backdrop_path),
        description: data.overview || '',
        releaseInfo: type === 'movie' ? (data.release_date || '').slice(0, 4) : (data.first_air_date || '').slice(0, 4),
        imdbRating: data.vote_average ? Number(data.vote_average.toFixed(1)) : undefined,
        genres: (data.genres || []).map(g => g.name),
        runtime: type === 'movie' ? data.runtime : data.episode_run_time?.[0],
        director: type === 'movie' ? crew.filter(x => x.job === 'Director').map(x => x.name) : undefined,
        cast
      }};
    } catch (err) {
      console.error(`[meta:${id}]`, err.message);
      return { meta: null };
    }
  });

  return builder.getInterface();
}

async function testTMDBKey(key) {
  try {
    const tmdbKey = key || process.env.TMDB_API_KEY;
    if (!tmdbKey) return { ok: false, error: 'TMDB_API_KEY manquante' };
    const data = await tmdb('/configuration', {}, { tmdbKey });
    return { ok: !!data?.images, error: null };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = { getAddonInterface, testTMDBKey };
