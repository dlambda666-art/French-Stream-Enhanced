const { addonBuilder } = require('stremio-addon-sdk');
const fetch = require('node-fetch');

const TMDB_BASE = 'https://api.themoviedb.org/3';
const IMAGE_BASE = 'https://image.tmdb.org/t/p/w500';
const BACKDROP_BASE = 'https://image.tmdb.org/t/p/w1280';
const CACHE_TTL = 30 * 60 * 1000;
const cache = new Map();

const MOVIE_GENRES = {
  action: [28, 'Action'], adventure: [12, 'Aventure'], animation: [16, 'Animation'],
  comedy: [35, 'Comédie'], crime: [80, 'Crime'], documentary: [99, 'Documentaire'],
  drama: [18, 'Drame'], family: [10751, 'Famille'], fantasy: [14, 'Fantastique'],
  history: [36, 'Historique'], horror: [27, 'Horreur'], mystery: [9648, 'Mystère'],
  romance: [10749, 'Romance'], scifi: [878, 'Science-fiction'], thriller: [53, 'Thriller'],
  war: [10752, 'Guerre'], western: [37, 'Western']
};

const TV_GENRES = {
  action: [10759, 'Action & Aventure'], animation: [16, 'Animation'], comedy: [35, 'Comédie'],
  crime: [80, 'Crime'], documentary: [99, 'Documentaire'], drama: [18, 'Drame'],
  family: [10751, 'Famille'], fantasy: [10765, 'Fantastique & SF'], mystery: [9648, 'Mystère'],
  romance: [10749, 'Romance'], scifi: [10765, 'Science-fiction'], thriller: [9648, 'Thriller'],
  war: [10768, 'Guerre & Politique'], western: [37, 'Western']
};

const LANGUAGES = [
  ['fr', 'Français'], ['en', 'Anglais'], ['es', 'Espagnol'],
  ['ko', 'Coréen'], ['ja', 'Japonais'], ['it', 'Italien'], ['de', 'Allemand']
];

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

  const response = await fetch(url, { headers: { 'User-Agent': 'FS15-Catalog/2.0' } });
  if (!response.ok) throw new Error(`TMDB ${response.status}`);
  const data = await response.json();
  cache.set(url, { value: data, expires: Date.now() + CACHE_TTL });
  return data;
}

const poster = path => path ? `${IMAGE_BASE}${path}` : null;
const backdrop = path => path ? `${BACKDROP_BASE}${path}` : null;
const idFor = (type, id) => type === 'movie' ? `tmdbm:${id}` : `tmdbs:${id}`;
const releaseDate = (item, type) => type === 'movie' ? item.release_date : item.first_air_date;
const today = () => new Date().toISOString().slice(0, 10);

function daysAgo(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function catalogItem(item, type) {
  const title = type === 'movie' ? item.title : item.name;
  const date = releaseDate(item, type);
  return {
    id: idFor(type, item.id),
    type,
    name: title || item.original_title || item.original_name || 'Sans titre',
    poster: poster(item.poster_path),
    background: backdrop(item.backdrop_path),
    description: item.overview || undefined,
    releaseInfo: date ? date.slice(0, 4) : undefined,
    imdbRating: item.vote_average ? Number(item.vote_average.toFixed(1)) : undefined
  };
}

const catalogs = [
  { id: 'films-nouveautes', type: 'movie', name: 'FS15 — Films Nouveautés', kind: 'movie-new' },
  { id: 'films-sorties-fr', type: 'movie', name: 'FS15 — Films Sorties FR', kind: 'movie-fr-release' },
  { id: 'films-populaires', type: 'movie', name: 'FS15 — Films Populaires', kind: 'movie-popular' },
  { id: 'films-mieux-notes', type: 'movie', name: 'FS15 — Films Mieux notés', kind: 'movie-top' },
  { id: 'films-francais', type: 'movie', name: 'FS15 — Films Français', kind: 'movie-lang', lang: 'fr' },
  { id: 'series-nouveautes', type: 'series', name: 'FS15 — Séries Nouveautés', kind: 'tv-new' },
  { id: 'series-populaires', type: 'series', name: 'FS15 — Séries Populaires', kind: 'tv-popular' },
  { id: 'series-mieux-notees', type: 'series', name: 'FS15 — Séries Mieux notées', kind: 'tv-top' },
  { id: 'series-francaises', type: 'series', name: 'FS15 — Séries Françaises', kind: 'tv-lang', lang: 'fr' }
];

for (const [key, [gid, label]] of Object.entries(MOVIE_GENRES)) {
  catalogs.push({ id: `films-${key}`, type: 'movie', name: `FS15 — Films ${label}`, kind: 'movie-genre', genre: gid });
}
for (const [key, [gid, label]] of Object.entries(TV_GENRES)) {
  catalogs.push({ id: `series-${key}`, type: 'series', name: `FS15 — Séries ${label}`, kind: 'tv-genre', genre: gid });
}
for (const [lang, label] of LANGUAGES) {
  catalogs.push({ id: `films-lang-${lang}`, type: 'movie', name: `FS15 — Films ${label}`, kind: 'movie-lang', lang });
  catalogs.push({ id: `series-lang-${lang}`, type: 'series', name: `FS15 — Séries ${label}`, kind: 'tv-lang', lang });
}

function createManifest() {
  return {
    id: 'community.fs15-catalog',
    version: '2.0.0',
    name: 'FS15 Catalog',
    description: 'Catalogue dynamique films et séries alimenté par TMDB. Les flux sont gérés séparément par votre agrégateur.',
    resources: ['catalog', 'meta'],
    types: ['movie', 'series'],
    idPrefixes: ['tmdbm:', 'tmdbs:'],
    catalogs: catalogs.map(c => ({ type: c.type, id: c.id, name: c.name })),
    behaviorHints: { configurable: true }
  };
}

async function discover(c, config) {
  const common = { include_adult: 'false', page: '1', region: 'FR' };
  let path;
  let params = { ...common };

  switch (c.kind) {
    case 'movie-new':
      path = '/discover/movie';
      params = { ...params, sort_by: 'release_date.desc', 'release_date.gte': daysAgo(180), 'release_date.lte': today(), with_release_type: '2|3|4|5|6', 'vote_count.gte': '3' };
      break;
    case 'movie-fr-release':
      path = '/discover/movie';
      params = { ...params, sort_by: 'release_date.desc', 'release_date.gte': daysAgo(180), 'release_date.lte': today(), with_release_type: '4', 'vote_count.gte': '1' };
      break;
    case 'movie-popular': path = '/movie/popular'; break;
    case 'movie-top': path = '/movie/top_rated'; break;
    case 'movie-genre':
      path = '/discover/movie';
      params = { ...params, sort_by: 'popularity.desc', with_genres: String(c.genre), 'vote_count.gte': '5' };
      break;
    case 'movie-lang':
      path = '/discover/movie';
      params = { ...params, sort_by: 'popularity.desc', with_original_language: c.lang, 'vote_count.gte': '3' };
      break;
    case 'tv-new':
      path = '/discover/tv';
      params = { ...params, sort_by: 'first_air_date.desc', 'first_air_date.gte': daysAgo(180), 'first_air_date.lte': today(), 'vote_count.gte': '1' };
      break;
    case 'tv-popular': path = '/tv/popular'; break;
    case 'tv-top': path = '/tv/top_rated'; break;
    case 'tv-genre':
      path = '/discover/tv';
      params = { ...params, sort_by: 'popularity.desc', with_genres: String(c.genre), 'vote_count.gte': '3' };
      break;
    case 'tv-lang':
      path = '/discover/tv';
      params = { ...params, sort_by: 'popularity.desc', with_original_language: c.lang, 'vote_count.gte': '3' };
      break;
    default: return [];
  }

  const data = await tmdb(path, params, config);
  return (data.results || []).filter(x => x.poster_path).slice(0, 40).map(x => catalogItem(x, c.type));
}

async function getMeta(type, id, config) {
  const numeric = String(id).replace(/^tmdb[ms]:/, '');
  const endpoint = type === 'movie' ? 'movie' : 'tv';
  const data = await tmdb(`/${endpoint}/${encodeURIComponent(numeric)}`, { append_to_response: 'credits' }, config);
  const title = type === 'movie' ? data.title : data.name;
  const date = releaseDate(data, type);
  const crew = data.credits?.crew || [];
  const cast = (data.credits?.cast || []).slice(0, 12).map(p => ({ name: p.name, character: p.character }));

  return {
    id: idFor(type, data.id), type,
    name: title || data.original_title || data.original_name,
    poster: poster(data.poster_path), background: backdrop(data.backdrop_path),
    description: data.overview || '', releaseInfo: date ? date.slice(0, 4) : undefined,
    imdbRating: data.vote_average ? Number(data.vote_average.toFixed(1)) : undefined,
    genres: (data.genres || []).map(g => g.name),
    runtime: type === 'movie' ? data.runtime : data.episode_run_time?.[0],
    director: type === 'movie' ? crew.filter(x => x.job === 'Director').map(x => x.name) : undefined,
    cast
  };
}

function getAddonInterface(configStr) {
  const config = parseConfig(configStr);
  const builder = new addonBuilder(createManifest());

  builder.defineCatalogHandler(async ({ type, id }) => {
    const c = catalogs.find(x => x.id === id && x.type === type);
    if (!c) return { metas: [] };
    try { return { metas: await discover(c, config) }; }
    catch (err) { console.error(`[catalog:${id}]`, err.message); return { metas: [] }; }
  });

  builder.defineMetaHandler(async ({ type, id }) => {
    try { return { meta: await getMeta(type, id, config) }; }
    catch (err) { console.error(`[meta:${id}]`, err.message); return { meta: null }; }
  });

  return builder.getInterface();
}

async function testTMDBKey(key) {
  try {
    const tmdbKey = key || process.env.TMDB_API_KEY;
    if (!tmdbKey) return { ok: false, error: 'TMDB_API_KEY manquante' };
    const data = await tmdb('/configuration', {}, { tmdbKey });
    return { ok: !!data?.images, error: null };
  } catch (e) { return { ok: false, error: e.message }; }
}

module.exports = { getAddonInterface, testTMDBKey };
