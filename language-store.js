// ============================================================================
// MEMOIRE DURABLE DES LANGUES DANS NEON (Postgres)
// ----------------------------------------------------------------------------
// Les resultats du detecteur sont aussi enregistres dans une table Postgres
// (Neon), pour survivre aux redemarrages du Space. Neon accepte le SQL par
// simple requete HTTPS : pas de dependance en plus.
// Table v2 : repart sans les faux "VF" de la premiere version de la
// verification plateforme (chaines Amazon de niche).
// Sans variable FRANK_DATABASE_URL, ou si la base ne repond pas, Frank continue
// avec sa memoire habituelle : rien ne casse.
// ============================================================================

const fetch = require('node-fetch');

const status = { enabled: false, loaded: 0, saved: 0, lastError: null };

function connectionString() {
    return process.env.FRANK_DATABASE_URL || '';
}

async function sql(query, params = []) {
    const connection = connectionString();
    const host = new URL(connection).hostname;
    const response = await fetch(`https://${host}/sql`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Neon-Connection-String': connection,
            'Neon-Raw-Text-Output': 'true',
            'Neon-Array-Mode': 'true'
        },
        body: JSON.stringify({ query, params })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || `Neon HTTP ${response.status}`);
    return data.rows || [];
}

let ready = null;

function init() {
    if (!connectionString()) return Promise.resolve(false);
    if (!ready) {
        ready = sql(`CREATE TABLE IF NOT EXISTS frank_language_v2 (
                key TEXT PRIMARY KEY,
                tag TEXT NOT NULL,
                poster TEXT,
                imdb_id TEXT,
                expires_at BIGINT NOT NULL
            )`)
            .then(() => {
                status.enabled = true;
                return true;
            })
            .catch(error => {
                status.lastError = error.message;
                console.error('Neon:', error.message);
                ready = null; // on reessaiera
                return false;
            });
    }
    return ready;
}

// Charge tous les resultats encore valides : [{ key, tag, poster, imdbId, expires }]
async function loadAll() {
    if (!(await init())) return [];
    try {
        const rows = await sql('SELECT key, tag, poster, imdb_id, expires_at FROM frank_language_v2 WHERE expires_at > $1', [String(Date.now())]);
        status.loaded = rows.length;
        return rows.map(([key, tag, poster, imdbId, expires]) => ({ key, tag, poster: poster || null, imdbId: imdbId || null, expires: Number(expires) }));
    } catch (error) {
        status.lastError = error.message;
        console.error('Neon (lecture):', error.message);
        return [];
    }
}

function save(key, entry) {
    if (!connectionString()) return;
    init()
        .then(ok => ok && sql(
            `INSERT INTO frank_language_v2 (key, tag, poster, imdb_id, expires_at)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (key) DO UPDATE SET tag = EXCLUDED.tag, poster = EXCLUDED.poster,
                 imdb_id = EXCLUDED.imdb_id, expires_at = EXCLUDED.expires_at`,
            [key, entry.tag, entry.poster || null, entry.imdbId || null, String(entry.expires)]
        ))
        .then(result => { if (result) status.saved++; })
        .catch(error => {
            status.lastError = error.message;
            console.error('Neon (ecriture):', error.message);
        });
}

module.exports = { loadAll, save, status };
