// Teste la lecture VF des noms de streams et la file d'arriere-plan, sans reseau.
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

const fakeStreams = {
    tt0000001: [{ name: 'Torrentio', title: 'Film.2020.VOSTFR.1080p.WEB' }],
    tt0000002: [{ name: 'Torrentio', title: 'Film.2020.VOSTFR.1080p' }, { name: 'Frenchio', title: 'Film.2020.TRUEFRENCH.1080p.WEB' }],
    'tt0000003:1:1': [{ name: 'StreamFusion 🇫🇷', description: 'Serie.S01E01.MULTI.1080p' }]
};

const originalLoad = Module._load;
Module._load = function (request) {
    if (request === 'node-fetch') {
        return async url => {
            const id = decodeURIComponent(url.match(/\/stream\/\w+\/([^/]+)\.json/)[1]);
            return { ok: true, json: async () => ({ streams: fakeStreams[id] || [] }) };
        };
    }
    return originalLoad.apply(this, arguments);
};

process.env.FRANK_STREAMS_URL = 'https://streams.example/abc/manifest.json';
const streams = require(path.join(__dirname, '..', 'stream-language.js'));
const vf = title => streams.hasFrenchAudio({ title });

// Audio francais
assert.equal(vf('Film.2020.TRUEFRENCH.1080p.WEB-DL'), true);
assert.equal(vf('Film 2020 VFF 1080p'), true);
assert.equal(vf('Film.2020.VFQ.720p'), true);
assert.equal(vf('Film.2020.FRENCH.1080p.BluRay'), true);
assert.equal(vf('Film.2020.VF2.2160p'), true);
// Sous-titres seulement : jamais VF
assert.equal(vf('Film.2020.VOSTFR.1080p'), false);
assert.equal(vf('Film 2020 VOST 720p'), false);
assert.equal(vf('Film.2020.SUBFRENCH.1080p'), false);
assert.equal(vf('Film.2020.FRENCH.SUBBED.1080p'), false);
assert.equal(vf('Film.2020.STFR.720p'), false);
// MULTI : seulement chez une source francaise
assert.equal(vf('Film.2020.MULTI.1080p'), false);
assert.equal(streams.hasFrenchAudio({ name: 'Frenchio 🇫🇷', title: 'Film.2020.MULTI.1080p' }), true);
// MULTI chez une source francaise mais sans drapeau 🇫🇷 : pas de VF (cas The Yeti)
assert.equal(streams.hasFrenchAudio({ name: 'DuckStream | Lumio 🗣️ 🌎', title: 'The.Yeti.2026.MULTi.1080p.AMZN.WEB-DL.H.264.DD2.0-RX.mkv' }), false);
// Le drapeau 🇫🇷 d'AIOStreams seul ne suffit pas
assert.equal(streams.hasFrenchAudio({ name: 'Torrentio 🗣️ 🇫🇷', title: 'Film.2020.1080p.WEB' }), false);
assert.equal(streams.hasFrenchAudio({ name: 'DuckStream | Lumio 🇫🇷', title: 'Film.2020.MULTI.1080p' }), true);
// Pas de faux positif sur un mot qui contient "VF"
assert.equal(vf('Film.2020.1080p.AVFx'), false);

(async () => {
    const upgraded = [];
    streams.enqueue('tt0000001', 'movie', () => upgraded.push('tt0000001')); // VOSTFR seul
    streams.enqueue('tt0000002', 'movie', () => upgraded.push('tt0000002')); // TRUEFRENCH
    streams.enqueue('tt0000003', 'series', () => upgraded.push('tt0000003')); // MULTI StreamFusion, S01E01
    await new Promise(resolve => setTimeout(resolve, 9500));
    assert.deepEqual(upgraded.sort(), ['tt0000002', 'tt0000003']);
    console.log('stream-language: OK');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
