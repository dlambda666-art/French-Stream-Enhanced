// Teste le detecteur de langue sans reseau : TMDB et French Stream sont simules.
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

const searches = [];
const fakeSearchResults = {
    'Le Comte de Monte-Cristo': [
        { searchTitle: 'Le Comte de Monte-Cristo', languageTag: 'DUB' },
        { searchTitle: 'Le Comte de Monte-Cristo', languageTag: 'SUB' }
    ],
    'Inconnu au bataillon': [{ searchTitle: 'Inconnu au bataillon 2', languageTag: 'DUB' }],
    'Shogun': [{ searchTitle: 'Shogun', languageTag: 'SUB' }],
    'Conjuring : Les Dossiers Warren': [{ searchTitle: 'Conjuring 1 : Les Dossiers Warren', languageTag: 'DUB', rawText: 'Conjuring 1 : Les Dossiers Warren (2013)' }],
    'Scream': [{ searchTitle: 'Scream 2', languageTag: 'DUB', rawText: 'Scream 2 (1997)' }],
    'The Substance': [{ searchTitle: 'The Substance', languageTag: 'NONE', rawText: 'The Substance (2024)', href: '/15118576-the-substance.html' }],
    'Halloween': [{ searchTitle: 'Halloween', languageTag: 'DUB', rawText: 'Halloween (2018)' }]
};

const fakeTmdb = {
    '/find/tt0000001': { movie_results: [{ title: 'Le Comte de Monte-Cristo', original_title: 'Le Comte de Monte-Cristo', poster_path: '/a.jpg' }], tv_results: [] },
    '/find/tt0000002': { movie_results: [{ title: 'Inconnu au bataillon', original_title: 'Unknown', poster_path: null }], tv_results: [] },
    '/find/tt0077651': { movie_results: [{ title: 'Halloween', original_title: 'Halloween', release_date: '1978-10-25' }], tv_results: [] },
    '/find/tt1502407': { movie_results: [{ title: 'Halloween', original_title: 'Halloween', release_date: '2018-10-18' }], tv_results: [] },
    '/find/tt1457767': { movie_results: [{ title: 'Conjuring : Les Dossiers Warren', original_title: 'The Conjuring', release_date: '2013-07-18' }], tv_results: [] },
    '/find/tt0117571': { movie_results: [{ title: 'Scream', original_title: 'Scream', release_date: '1996-12-20' }], tv_results: [] },
    '/find/tt17526714': { movie_results: [{ title: 'The Substance', original_title: 'The Substance', release_date: '2024-09-07' }], tv_results: [] },
    '/find/tt0000666': { movie_results: [{ title: 'Site bloque', original_title: 'Site bloque', release_date: '2020-01-01' }], tv_results: [] },
    '/find/tt0000900': { movie_results: [{ id: 900, title: 'Film Netflix', original_title: 'Netflix Movie', release_date: '2023-01-01' }], tv_results: [] },
    '/movie/900/watch/providers': { results: { FR: { flatrate: [{ provider_name: 'Netflix' }] } } },
    '/find/tt0000901': { movie_results: [{ id: 901, title: 'Film en location', original_title: 'Rental Movie', release_date: '2023-01-01' }], tv_results: [] },
    '/movie/901/watch/providers': { results: { FR: { rent: [{ provider_name: 'Apple TV' }] } } },
    '/tv/42': { name: 'Shogun', original_name: 'Shōgun', poster_path: '/s.jpg', external_ids: { imdb_id: 'tt0000042' } }
};

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
    if (request === 'node-fetch') {
        return async url => {
            if (url.includes('french-stream')) {
                return { ok: true, text: async () => '<li><span>Version:</span><span id="film_lang"><a href="/x">VF+VOSTFR</a></span></li>' };
            }
            const route = new URL(url).pathname.replace('/3', '');
            const body = fakeTmdb[route] || (route.startsWith('/find/') ? { movie_results: [], tv_results: [] } : null);
            return { ok: Boolean(body), status: body ? 200 : 404, json: async () => body };
        };
    }
    if (request === './addon') {
        return {
            getLanguageTag: ({ languageText }) => (/\bVF\b/i.test(languageText) ? (/VOSTFR/i.test(languageText) ? 'DUB_SUB' : 'DUB') : (/VOSTFR/i.test(languageText) ? 'SUB' : 'NONE')),
            normalizeSearchValue: value => value.normalize('NFD').replace(/[^a-zA-Z0-9\s]/g, ' ').replace(/\s+/g, ' ').replace(/[̀-ͯ]/g, '').toLowerCase().trim(),
            searchFrenchStreamStrict: async (title, type) => {
                searches.push(`${type}:${title}`);
                if (title === 'Site bloque') throw new Error('French Stream HTTP 429');
                return fakeSearchResults[title] || [];
            }
        };
    }
    return originalLoad.apply(this, arguments);
};

process.env.TMDB_API_KEY = 'test';
const detector = require(path.join(__dirname, '..', 'language-detector.js'));

(async () => {
    // VF et VOSTFR trouves pour le meme titre -> DUB_SUB
    const monteCristo = await detector.detect('tt0000001', 'movie');
    assert.equal(monteCristo.tag, 'DUB_SUB');
    assert.equal(monteCristo.poster, 'https://image.tmdb.org/t/p/w500/a.jpg');

    // Deuxieme appel : resultat en memoire, pas de nouvelle recherche
    const before = searches.length;
    await detector.detect('tt0000001', 'movie');
    assert.equal(searches.length, before);

    // Titre proche mais different ("... 2") -> pas de badge
    assert.equal((await detector.detect('tt0000002', 'movie')).tag, 'NONE');

    // Id TMDB d'une serie -> retrouve l'IMDb
    const shogun = await detector.detect('42', 'series');
    assert.equal(shogun.tag, 'SUB');
    assert.equal(shogun.imdbId, 'tt0000042');

    // Remake : meme titre, annee differente -> pas confondu
    assert.equal((await detector.detect('tt0077651', 'movie')).tag, 'NONE');
    assert.equal((await detector.detect('tt1502407', 'movie')).tag, 'DUB');

    // "1" ajoute par French Stream -> trouve ; une suite ("Scream 2") -> non
    assert.equal((await detector.detect('tt1457767', 'movie')).tag, 'DUB');
    assert.equal((await detector.detect('tt0117571', 'movie')).tag, 'NONE');

    // Langue absente de l'adresse -> lue sur la fiche ("Version : VF+VOSTFR")
    assert.equal((await detector.detect('tt17526714', 'movie')).tag, 'DUB_SUB');

    // French Stream ne repond pas : pas de resultat, et rien n'est retenu
    assert.equal(await detector.detect('tt0000666', 'movie'), null);
    assert.equal(detector._results.has('tt0000666'), false);

    // Titre identique en francais et en original : une seule recherche
    const beforeOne = searches.length;
    await detector.detect('tt17526714', 'movie');
    assert.equal(searches.length, beforeOne); // deja en memoire

    // Priorite : une affiche affichee passe devant les titres d'arriere-plan
    const order = [];
    const background = ['tt0000101', 'tt0000102', 'tt0000103'].map(id => detector.detect(id, 'movie').then(() => order.push(id)));
    const shown = detector.detect('tt0000104', 'movie', { priority: true }).then(() => order.push('tt0000104'));
    await Promise.all([...background, shown]);
    assert.ok(order.indexOf('tt0000104') <= 1, `ordre: ${order}`);

    // Dispo en abonnement en France -> VF sans interroger French Stream
    const beforePlatform = searches.length;
    assert.equal((await detector.detect('tt0000900', 'movie')).tag, 'DUB');
    assert.equal(searches.length, beforePlatform);
    // Seulement en location -> on passe par French Stream (ici : rien)
    assert.equal((await detector.detect('tt0000901', 'movie')).tag, 'NONE');
    assert.equal(searches.length, beforePlatform + 2);

    // Titre absent de TMDB -> NONE, sans planter
    assert.equal((await detector.detect('tt9999999', 'movie')).tag, 'NONE');

    // Les catalogues Frank renseignent directement, sans recherche
    detector.remember('tt0000077', 'DUB');
    const searchesBefore = searches.length;
    assert.equal((await detector.detect('tt0000077', 'movie')).tag, 'DUB');
    assert.equal(searches.length, searchesBefore);

    // Sans cle TMDB : detecteur desactive
    delete process.env.TMDB_API_KEY;
    assert.equal(await detector.detect('tt0000555', 'movie'), null);

    console.log('language-detector: OK');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
