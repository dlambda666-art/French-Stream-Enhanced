// Teste la memoire durable (Neon) sans reseau : l'API SQL HTTP est simulee.
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

const calls = [];
const table = new Map();

const originalLoad = Module._load;
Module._load = function (request) {
    if (request === 'node-fetch') {
        return async (url, options) => {
            const body = JSON.parse(options.body);
            calls.push({ url, headers: options.headers, query: body.query, params: body.params });
            let rows = [];
            if (/^INSERT/i.test(body.query.trim())) table.set(body.params[0], body.params);
            if (/^SELECT/i.test(body.query.trim())) {
                rows = [...table.values()].filter(row => Number(row[4]) > Number(body.params[0]));
            }
            return { ok: true, json: async () => ({ rows }) };
        };
    }
    return originalLoad.apply(this, arguments);
};

process.env.FRANK_DATABASE_URL = 'postgresql://user:pass@ep-test-123.eu-central-1.aws.neon.tech/neondb?sslmode=require';
const store = require(path.join(__dirname, '..', 'language-store.js'));

(async () => {
    store.save('tt0327597', { tag: 'DUB', poster: null, imdbId: 'tt0327597', expires: Date.now() + 60000 });
    store.save('tt0000001', { tag: 'NONE', poster: null, imdbId: null, expires: Date.now() - 1000 }); // expire
    await new Promise(resolve => setTimeout(resolve, 50));

    // Requetes envoyees a l'API SQL de Neon, avec la chaine de connexion
    assert.equal(calls[0].url, 'https://ep-test-123.eu-central-1.aws.neon.tech/sql');
    assert.equal(calls[0].headers['Neon-Connection-String'], process.env.FRANK_DATABASE_URL);
    assert.match(calls[0].query, /CREATE TABLE IF NOT EXISTS frank_language_v2/);

    // Au redemarrage : seuls les resultats encore valides reviennent
    const rows = await store.loadAll();
    assert.deepEqual(rows.map(row => [row.key, row.tag]), [['tt0327597', 'DUB']]);
    assert.equal(store.status.enabled, true);
    assert.equal(store.status.saved, 2);

    console.log('language-store: OK');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
