// Teste les catalogues externes passes au detecteur VF, sans reseau.
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

const externalCatalog = {
    metas: [
        { id: 'tt0000001', type: 'movie', name: 'Film doublé', poster: 'https://x/1.jpg' },
        { id: 'tt0000002', type: 'movie', name: 'Film sous-titré', poster: 'https://x/2.jpg' },
        { id: 'tt0000003', type: 'movie', name: 'Film introuvable', poster: 'https://x/3.jpg' },
        { id: 'tmdb:44', type: 'movie', name: 'Film id TMDB', poster: 'https://x/4.jpg' },
        { id: 'tt0000005', type: 'movie', name: 'Film encore inconnu', poster: 'https://x/5.jpg' }
    ]
};
const tags = { tt0000001: 'DUB', tt0000002: 'SUB', tt0000003: 'NONE', 44: 'DUB_SUB' };
const fetched = [];
let handlers = {};

const originalLoad = Module._load;
Module._load = function (request) {
    if (request === 'node-fetch') {
        return async url => {
            fetched.push(url);
            if (url.endsWith('/manifest.json')) {
                return { ok: true, json: async () => ({ catalogs: [
                    { type: 'movie', id: 'scary-movies', name: 'Scary Only' },
                    { type: 'movie', id: 'scary-search', name: 'Recherche', extra: [{ name: 'search', isRequired: true }] }
                ] }) };
            }
            return { ok: true, json: async () => externalCatalog };
        };
    }
    if (request === 'cheerio') return {};
    if (request === 'stremio-addon-sdk') {
        return {
            addonBuilder: class {
                constructor(manifest) { this.manifest = manifest; }
                defineCatalogHandler(fn) { handlers.catalog = fn; }
                defineMetaHandler(fn) { handlers.meta = fn; }
                getInterface() { return { manifest: this.manifest }; }
            }
        };
    }
    if (request === './language-detector') {
        return {
            remember() {},
            useTmdbKey() {},
            detectWithin: async id => (id in tags ? { tag: tags[id] } : null)
        };
    }
    return originalLoad.apply(this, arguments);
};

const { getAddonInterface, prepareExternalCatalogs } = require(path.join(__dirname, '..', 'addon.js'));

function configString(config) {
    return Buffer.from(JSON.stringify(config)).toString('base64');
}

(async () => {
    const externals = ['https://scary.example/abc/manifest.json'];
    await prepareExternalCatalogs(configString({ t: 'k', c: [], x: externals }));
    // Le catalogue a filtre obligatoire (recherche) n'est pas repris
    assert.equal(getAddonInterface(configString({ t: 'k', c: [], x: externals })).manifest.catalogs.filter(c => c.id.startsWith('fs-ext-')).length, 1);

    // VF uniquement : seuls les titres dispo en VF restent
    const vfOnly = getAddonInterface(configString({ t: 'k', c: [], v: true, x: externals }), 'https://frank.example');
    const catalogEntry = vfOnly.manifest.catalogs.find(c => c.id === 'fs-ext-0');
    assert.deepEqual(catalogEntry, { type: 'movie', id: 'fs-ext-0', name: 'VF · Scary Only' });

    const result = await handlers.catalog({ type: 'movie', id: 'fs-ext-0', extra: {} });
    assert.equal(fetched[1], 'https://scary.example/abc/catalog/movie/scary-movies.json');
    assert.deepEqual(result.metas.map(m => m.name), ['[VF] Film doublé', '[VF+VOSTFR] Film id TMDB']);
    assert.equal(result.metas[0].poster, 'https://frank.example/poster/movie/tt0000001.jpg');
    assert.equal(result.metas[1].poster, 'https://frank.example/poster/movie/44.jpg');
    // Un titre encore inconnu -> resultat garde peu de temps
    assert.equal(result.cacheMaxAge, 60);

    // Sans "VF uniquement" : tout reste, avec les badges connus
    getAddonInterface(configString({ t: 'k', c: [], v: false, x: externals }));
    const all = await handlers.catalog({ type: 'movie', id: 'fs-ext-0', extra: {} });
    assert.deepEqual(all.metas.map(m => m.name), [
        '[VF] Film doublé',
        '[VOSTFR] Film sous-titré',
        'Film introuvable',
        '[VF+VOSTFR] Film id TMDB',
        'Film encore inconnu'
    ]);

    // Config invalide ou index hors limites : pas de plantage
    getAddonInterface(configString({ t: 'k', c: [], x: ['pas-une-url'] }));
    assert.deepEqual(await handlers.catalog({ type: 'movie', id: 'fs-ext-0', extra: {} }), { metas: [] });

    console.log('external-catalogs: OK');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
