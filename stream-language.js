// ============================================================================
// DETECTION VF PAR LES STREAMS (AIOStreams)
// ----------------------------------------------------------------------------
// Dernier recours, en arriere-plan : quand French Stream et les plateformes
// n'ont pas trouve de VF, on regarde les noms de fichiers renvoyes par
// l'AIOStreams de l'utilisateur. On ne se fie pas a l'etiquette de langue
// d'AIOStreams (elle confond souvent audio et sous-titres) : on relit les noms
// avec les conventions de la scene francaise.
// Ne peut qu'ajouter une VF, jamais en retirer.
// Adresse dans la variable FRANK_STREAMS_URL (manifest de l'AIOStreams).
// ============================================================================

const fetch = require('node-fetch');

const TIMEOUT_MS = 25000;
const GAP_MS = 3000;
const MAX_QUEUE = 300;

const status = { enabled: false, checked: 0, found: 0, lastError: null };
const queue = [];
const queued = new Set();
let running = false;

function baseUrl() {
    const raw = (process.env.FRANK_STREAMS_URL || '').trim();
    if (!/^https?:\/\//i.test(raw)) return '';
    return raw.replace(/\/manifest\.json.*$/i, '').replace(/\/+$/, '');
}

function isEnabled() {
    status.enabled = Boolean(baseUrl());
    return status.enabled;
}

// Sous-titres seulement : le fichier ne compte jamais pour la VF.
const SUBTITLE_ONLY = /\bVOST(?:FR)?\b|\bSTFR\b|\bSUB\.?FR(?:ENCH)?\b|\bSUBFRENCH\b|\bFRENCH[ ._-]*SUB(?:S|BED|TITLE[SD]?)?\b|\bSOUS[ ._-]*TITR/i;
// Audio francais.
// (Le drapeau 🇫🇷 d'AIOStreams est ignore : c'est son etiquette de langue,
// qui confond audio et sous-titres.)
const FRENCH_AUDIO = /\bVF[FQI2]?\b|\bTRUE[ ._-]*FRENCH\b|\bFRENCH\b|\bVERSION FRAN[CÇ]AISE\b/i;
// MULTI = VO + VF seulement chez les sources francaises, et si AIOStreams y a
// vu du francais (drapeau 🇫🇷) : un MULTI sans drapeau peut etre VO + autres
// langues (ex. The Yeti, MULTi AMZN sans piste francaise).
const FRENCH_FLAG = /\u{1F1EB}\u{1F1F7}/u;
const MULTI = /\bMULTI(?:[ ._-]*(?:VFF|VFQ|VF2|TRUEFRENCH|FRENCH))?\b/i;
const FRENCH_SOURCE = /frenchio|stream ?fusion|lumio|french ?stream|wawacity|zone ?telechargement|darki|yggtorrent|ygg/i;

function streamText(stream) {
    return [
        stream.name,
        stream.title,
        stream.description,
        stream.behaviorHints?.filename,
        stream.behaviorHints?.bingeGroup
    ].filter(Boolean).join(' \n ');
}

// true si ce stream a de l'audio francais
function hasFrenchAudio(stream) {
    const text = streamText(stream);
    if (SUBTITLE_ONLY.test(text)) return false;
    if (FRENCH_AUDIO.test(text)) return true;
    return MULTI.test(text) && FRENCH_SOURCE.test(text) && FRENCH_FLAG.test(text);
}

function streamId(imdbId, type) {
    // Series : on regarde le premier episode.
    return type === 'series' ? `${imdbId}:1:1` : imdbId;
}

async function fetchStreams(imdbId, type) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
        const response = await fetch(`${baseUrl()}/stream/${type}/${encodeURIComponent(streamId(imdbId, type))}.json`, {
            headers: { 'User-Agent': 'Mozilla/5.0 FrenchStreamEnhanced' },
            signal: controller.signal
        });
        if (!response.ok) throw new Error(`AIOStreams HTTP ${response.status}`);
        const data = await response.json();
        return Array.isArray(data.streams) ? data.streams : [];
    } finally {
        clearTimeout(timer);
    }
}

async function hasVfStream(imdbId, type) {
    const streams = await fetchStreams(imdbId, type);
    return streams.some(hasFrenchAudio);
}

// Ajoute un titre a la file d'arriere-plan. onVf est appele si une VF est trouvee.
function enqueue(imdbId, type, onVf) {
    if (!isEnabled() || !/^tt\d+$/i.test(imdbId) || queued.has(imdbId)) return;
    if (queue.length >= MAX_QUEUE) return;
    queued.add(imdbId);
    queue.push({ imdbId, type, onVf });
    pump();
}

async function pump() {
    if (running) return;
    running = true;
    while (queue.length) {
        const job = queue.shift();
        try {
            status.checked++;
            if (await hasVfStream(job.imdbId, job.type)) {
                status.found++;
                job.onVf();
            }
        } catch (error) {
            status.lastError = error.message;
            console.error('Streams VF:', job.imdbId, error.message);
        }
        queued.delete(job.imdbId);
        await new Promise(resolve => setTimeout(resolve, GAP_MS));
    }
    running = false;
}

// Diagnostic : noms des streams et verdict pour chacun.
async function explain(imdbId, type) {
    if (!isEnabled()) return { enabled: false };
    try {
        const streams = await fetchStreams(imdbId, type);
        return {
            enabled: true,
            count: streams.length,
            vf: streams.some(hasFrenchAudio),
            sample: streams.slice(0, 15).map(stream => ({
                vf: hasFrenchAudio(stream),
                text: streamText(stream).replace(/\s+/g, ' ').slice(0, 220)
            }))
        };
    } catch (error) {
        return { enabled: true, error: error.message };
    }
}

module.exports = { enqueue, explain, hasFrenchAudio, isEnabled, status };
