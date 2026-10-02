// Teste le prechauffage des badges, sans reseau.
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

const responses = {
    'https://cat.example/u1/manifest.json': {
        catalogs: [
            { type: 'movie', id: 'news' },
            { type: 'series', id: 'shows' },
            { type: 'movie', id: 'search', extra: [{ name: 'search', isRequired: true }] },
            { type: 'channel', id: 'tv' }
        ]
    },
    'https://cat.example/u1/catalog/movie/news.json': {
        metas: [{ id: 'tt0000001' }, { id: 'tmdb:42' }, { id: 'kitsu:7' }, { imdb_id: 'tt0000002', id: 'x' }]
    },
    'https://cat.example/u1/catalog/series/shows.json': { metas: [{ id: 'tt0000003:1:1' }] }
};

const fetched = [];
const originalLoad = Module._load;
Module._load = function (request) {
    if (request === 'node-fetch') {
        return async url => {
            fetched.push(url);
            const body = responses[url];
            return body ? { ok: true, json: async () => body } : { ok: false, status: 404 };
        };
    }
    return originalLoad.apply(this, arguments);
};

const warmup = require(path.join(__dirname, '..', 'warmup.js'));

(async () => {
    // Sans variable : rien
    delete process.env.FRANK_WARMUP_MANIFESTS;
    const none = [];
    await warmup.runOnce((id, type) => { none.push(id); return Promise.resolve(null); }, { gapMs: 0 });
    assert.equal(warmup.status.enabled, false);
    assert.deepEqual(none, []);

    // Avec un manifest (plus une adresse invalide ignoree, plus une en panne)
    process.env.FRANK_WARMUP_MANIFESTS = 'https://cat.example/u1/manifest.json, pas-une-url\nhttps://down.example/manifest.json';
    const calls = [];
    await warmup.runOnce((id, type) => { calls.push(`${type}:${id}`); return Promise.resolve(null); }, { gapMs: 0 });

    // Recherche et types non film/serie ignores
    assert.ok(!fetched.some(url => /search|channel/.test(url)));
    assert.deepEqual(calls, ['movie:tt0000001', 'movie:42', 'movie:tt0000002', 'series:tt0000003']);
    assert.equal(warmup.status.enabled, true);
    assert.equal(warmup.status.catalogs, 2);
    assert.equal(warmup.status.titles, 4);
    assert.equal(warmup.status.runs, 1);
    assert.match(warmup.status.lastError, /down\.example/);

    console.log('warmup: ok');
})().catch(error => { console.error(error); process.exit(1); });
