const { addonBuilder, serveHTTP, getRouter } = require('stremio-addon-sdk');
const cheerio = require('cheerio');
const fetch = require('node-fetch');

// ============================================================================
// CONFIGURATION & CATALOGS
// ============================================================================

const CACHE_TTL = 60 * 60 * 1000; // 1 heure
const cache = new Map();
const metaCache = new Map();
const SEARCH_ENRICH_LIMIT = 12;
const BETTERPOSTER_BASE = 'https://btttr.cc/poster/imdb/poster-default/';
const ENHANCED_ID = 'community.french-stream-enhanced';
const ENHANCED_NAME = 'French Stream Enhanced';

const ALL_CATALOGS = {
    'derniers-films': { name: 'FS - Derniers Films', type: 'movie', baseUrl: 'https://french-stream.pink/films/', pageUrl: 'https://french-stream.pink/films/page/{page}/' },
    'films-action': { name: 'FS - Films Action', type: 'movie', baseUrl: 'https://french-stream.pink/films/actions/', pageUrl: 'https://french-stream.pink/films/actions/page/{page}/' },
    'dernieres-series': { name: 'FS - Dernières Séries', type: 'series', baseUrl: 'https://french-stream.pink/s-tv/', pageUrl: 'https://french-stream.pink/s-tv/page/{page}/' },
    'series-netflix': { name: 'FS - Séries Netflix', type: 'series', baseUrl: 'https://french-stream.pink/s-tv/netflix-series-/', pageUrl: 'https://french-stream.pink/s-tv/netflix-series-/page/{page}/' },
    'series-appletv': { name: 'FS - Séries Apple TV+', type: 'series', baseUrl: 'https://french-stream.pink/s-tv/series-apple-tv/', pageUrl: 'https://french-stream.pink/s-tv/series-apple-tv/page/{page}/' },
    'series-prime': { name: 'FS - Séries Prime Video', type: 'series', baseUrl: 'https://french-stream.pink/s-tv/serie-amazon-prime-videos/', pageUrl: 'https://french-stream.pink/s-tv/serie-amazon-prime-videos/page/{page}/' },
    'series-disneyplus': { name: 'FS - Séries Disney+', type: 'series', baseUrl: 'https://french-stream.pink/s-tv/series-disney-plus/', pageUrl: 'https://french-stream.pink/s-tv/series-disney-plus/page/{page}/' },
    'series-action': { name: 'FS - Séries Action', type: 'series', baseUrl: 'https://french-stream.pink/action-serie-/', pageUrl: 'https://french-stream.pink/action-serie-/page/{page}/' },
    'series-aventure': { name: 'FS - Séries Aventure', type: 'series', baseUrl: 'https://french-stream.pink/aventure-series-/', pageUrl: 'https://french-stream.pink/aventure-series-/page/{page}/' },
    'series-animation': { name: 'FS - Séries Animation', type: 'series', baseUrl: 'https://french-stream.pink/animation-serie-/', pageUrl: 'https://french-stream.pink/animation-serie-/page/{page}/' },
    'series-biopic': { name: 'FS - Séries Biopic', type: 'series', baseUrl: 'https://french-stream.pink/serie-biopic-/', pageUrl: 'https://french-stream.pink/serie-biopic-/page/{page}/' },
    'series-comedie': { name: 'FS - Séries Comédie', type: 'series', baseUrl: 'https://french-stream.pink/comedie-serie-/', pageUrl: 'https://french-stream.pink/comedie-serie-/page/{page}/' },
    'series-drame': { name: 'FS - Séries Drame', type: 'series', baseUrl: 'https://french-stream.pink/drame-serie-/', pageUrl: 'https://french-stream.pink/drame-serie-/page/{page}/' },
    'series-documentaire': { name: 'FS - Séries Documentaire', type: 'series', baseUrl: 'https://french-stream.pink/documentaire-serie-/', pageUrl: 'https://french-stream.pink/documentaire-serie-/page/{page}/' },
    'series-familles': { name: 'FS - Séries Famille', type: 'series', baseUrl: 'https://french-stream.pink/familles-series-/', pageUrl: 'https://french-stream.pink/familles-series-/page/{page}/' },
    'series-fantastique': { name: 'FS - Séries Fantastique', type: 'series', baseUrl: 'https://french-stream.pink/fantastique-series-/', pageUrl: 'https://french-stream.pink/fantastique-series-/page/{page}/' },
    'series-thriller': { name: 'FS - Séries Thriller', type: 'series', baseUrl: 'https://french-stream.pink/thriller-series-/', pageUrl: 'https://french-stream.pink/thriller-series-/page/{page}/' },
    'series-romance': { name: 'FS - Séries Romance', type: 'series', baseUrl: 'https://french-stream.pink/romance-series-/', pageUrl: 'https://french-stream.pink/romance-series-/page/{page}/' },
    'series-judiciaire': { name: 'FS - Séries Judiciaire', type: 'series', baseUrl: 'https://french-stream.pink/judiciare-series-/', pageUrl: 'https://french-stream.pink/judiciare-series-/page/{page}/' },
    'series-science-fiction': { name: 'FS - Séries Science-Fiction', type: 'series', baseUrl: 'https://french-stream.pink/science-fiction-series-/', pageUrl: 'https://french-stream.pink/science-fiction-series-/page/{page}/' },
    'series-historiques': { name: 'FS - Séries Historiques', type: 'series', baseUrl: 'https://french-stream.pink/serie-historiques-/', pageUrl: 'https://french-stream.pink/serie-historiques-/page/{page}/' },
    'series-medical': { name: 'FS - Séries Médical', type: 'series', baseUrl: 'https://french-stream.pink/medical-series-/', pageUrl: 'https://french-stream.pink/medical-series-/page/{page}/' },
    'series-policier': { name: 'FS - Séries Policier', type: 'series', baseUrl: 'https://french-stream.pink/policier-series-/', pageUrl: 'https://french-stream.pink/policier-series-/page/{page}/' },
    'series-horreur': { name: 'FS - Séries Horreur', type: 'series', baseUrl: 'https://french-stream.pink/horreur-serie-/', pageUrl: 'https://french-stream.pink/horreur-serie-/page/{page}/' },
    'series-western': { name: 'FS - Séries Western', type: 'series', baseUrl: 'https://french-stream.pink/western-series-/', pageUrl: 'https://french-stream.pink/western-series-/page/{page}/' },
    'series-k-drama': { name: 'FS - K-Drama', type: 'series', baseUrl: 'https://french-stream.pink/k-drama-/', pageUrl: 'https://french-stream.pink/k-drama-/page/{page}/' },
    'series-tv-realite': { name: 'FS - Télé-Réalité', type: 'series', baseUrl: 'https://french-stream.pink/streaming-tv-realits/', pageUrl: 'https://french-stream.pink/streaming-tv-realits/page/{page}/' },
    'series-tag-adult-animation': { name: 'FS - Animation pour adultes', type: 'series', baseUrl: 'https://french-stream.pink/xfsearch/xx89/adult+animation/', pageUrl: 'https://french-stream.pink/xfsearch/xx89/adult+animation/page/{page}/' },
    'series-tag-anthology': { name: 'FS - Anthologie', type: 'series', baseUrl: 'https://french-stream.pink/xfsearch/xx89/anthology/', pageUrl: 'https://french-stream.pink/xfsearch/xx89/anthology/page/{page}/' },
    'series-tag-based-on-comic': { name: 'FS - Adapté d’une BD', type: 'series', baseUrl: 'https://french-stream.pink/xfsearch/xx89/based+on+comic/', pageUrl: 'https://french-stream.pink/xfsearch/xx89/based+on+comic/page/{page}/' },
    'series-tag-based-on-novel': { name: 'FS - Adapté d’un roman', type: 'series', baseUrl: 'https://french-stream.pink/xfsearch/xx89/based+on+novel+or+book/', pageUrl: 'https://french-stream.pink/xfsearch/xx89/based+on+novel+or+book/page/{page}/' },
    'series-tag-california': { name: 'FS - Californie', type: 'series', baseUrl: 'https://french-stream.pink/xfsearch/xx89/california/', pageUrl: 'https://french-stream.pink/xfsearch/xx89/california/page/{page}/' },
    'series-tag-crime': { name: 'FS - Crime', type: 'series', baseUrl: 'https://french-stream.pink/xfsearch/xx89/crime/', pageUrl: 'https://french-stream.pink/xfsearch/xx89/crime/page/{page}/' },
    'series-tag-detective': { name: 'FS - Enquêtes', type: 'series', baseUrl: 'https://french-stream.pink/xfsearch/xx89/detective/', pageUrl: 'https://french-stream.pink/xfsearch/xx89/detective/page/{page}/' },
    'series-tag-espionage': { name: 'FS - Espionnage', type: 'series', baseUrl: 'https://french-stream.pink/xfsearch/xx89/espionage/', pageUrl: 'https://french-stream.pink/xfsearch/xx89/espionage/page/{page}/' },
    'series-tag-friendship': { name: 'FS - Amitié', type: 'series', baseUrl: 'https://french-stream.pink/xfsearch/xx89/friendship/', pageUrl: 'https://french-stream.pink/xfsearch/xx89/friendship/page/{page}/' },
    'series-tag-high-school': { name: 'FS - Lycée', type: 'series', baseUrl: 'https://french-stream.pink/xfsearch/xx89/high+school/', pageUrl: 'https://french-stream.pink/xfsearch/xx89/high+school/page/{page}/' },
    'series-tag-hospital': { name: 'FS - Hôpital', type: 'series', baseUrl: 'https://french-stream.pink/xfsearch/xx89/hospital/', pageUrl: 'https://french-stream.pink/xfsearch/xx89/hospital/page/{page}/' },
    'series-tag-journalism': { name: 'FS - Journalisme', type: 'series', baseUrl: 'https://french-stream.pink/xfsearch/xx89/journalism/', pageUrl: 'https://french-stream.pink/xfsearch/xx89/journalism/page/{page}/' },
    'series-tag-lawyer': { name: 'FS - Avocats', type: 'series', baseUrl: 'https://french-stream.pink/xfsearch/xx89/lawyer/', pageUrl: 'https://french-stream.pink/xfsearch/xx89/lawyer/page/{page}/' },
    'series-tag-military': { name: 'FS - Militaire', type: 'series', baseUrl: 'https://french-stream.pink/xfsearch/xx89/military/', pageUrl: 'https://french-stream.pink/xfsearch/xx89/military/page/{page}/' },
    'series-tag-miniseries': { name: 'FS - Mini-série', type: 'series', baseUrl: 'https://french-stream.pink/xfsearch/xx89/miniseries/', pageUrl: 'https://french-stream.pink/xfsearch/xx89/miniseries/page/{page}/' },
    'series-tag-murder': { name: 'FS - Meurtre', type: 'series', baseUrl: 'https://french-stream.pink/xfsearch/xx89/murder/', pageUrl: 'https://french-stream.pink/xfsearch/xx89/murder/page/{page}/' },
    'series-tag-new-york-city': { name: 'FS - New York', type: 'series', baseUrl: 'https://french-stream.pink/xfsearch/xx89/new+york+city/', pageUrl: 'https://french-stream.pink/xfsearch/xx89/new+york+city/page/{page}/' },
    'series-tag-political': { name: 'FS - Politique', type: 'series', baseUrl: 'https://french-stream.pink/xfsearch/xx89/political/', pageUrl: 'https://french-stream.pink/xfsearch/xx89/political/page/{page}/' },
    'series-tag-religion': { name: 'FS - Religion', type: 'series', baseUrl: 'https://french-stream.pink/xfsearch/xx89/religion/', pageUrl: 'https://french-stream.pink/xfsearch/xx89/religion/page/{page}/' },
    'series-tag-revenge': { name: 'FS - Vengeance', type: 'series', baseUrl: 'https://french-stream.pink/xfsearch/xx89/revenge/', pageUrl: 'https://french-stream.pink/xfsearch/xx89/revenge/page/{page}/' },
    'series-tag-romance': { name: 'FS - Romance', type: 'series', baseUrl: 'https://french-stream.pink/xfsearch/xx89/romance/', pageUrl: 'https://french-stream.pink/xfsearch/xx89/romance/page/{page}/' },
    'series-tag-sitcom': { name: 'FS - Sitcom', type: 'series', baseUrl: 'https://french-stream.pink/xfsearch/xx89/sitcom/', pageUrl: 'https://french-stream.pink/xfsearch/xx89/sitcom/page/{page}/' },
    'series-tag-supernatural': { name: 'FS - Surnaturel', type: 'series', baseUrl: 'https://french-stream.pink/xfsearch/xx89/supernatural/', pageUrl: 'https://french-stream.pink/xfsearch/xx89/supernatural/page/{page}/' },
    'series-tag-survival': { name: 'FS - Survie', type: 'series', baseUrl: 'https://french-stream.pink/xfsearch/xx89/survival/', pageUrl: 'https://french-stream.pink/xfsearch/xx89/survival/page/{page}/' },
    'series-tag-time-travel': { name: 'FS - Voyage dans le temps', type: 'series', baseUrl: 'https://french-stream.pink/xfsearch/xx89/time+travel/', pageUrl: 'https://french-stream.pink/xfsearch/xx89/time+travel/page/{page}/' },
    'series-tag-vampire': { name: 'FS - Vampire', type: 'series', baseUrl: 'https://french-stream.pink/xfsearch/xx89/vampire/', pageUrl: 'https://french-stream.pink/xfsearch/xx89/vampire/page/{page}/' },
    'documentaires': { name: 'FS - Documentaires', type: 'movie', baseUrl: 'https://french-stream.pink/films/documentaires/', pageUrl: 'https://french-stream.pink/films/documentaires/page/{page}/' },
    'horreur': { name: 'FS - Horreur', type: 'movie', baseUrl: 'https://french-stream.pink/films/epouvante-horreurs/', pageUrl: 'https://french-stream.pink/films/epouvante-horreurs/page/{page}/' },
    'animations': { name: 'FS - Animations', type: 'movie', baseUrl: 'https://french-stream.pink/films/animations/', pageUrl: 'https://french-stream.pink/films/animations/page/{page}/' },
    'aventures': { name: 'FS - Aventures', type: 'movie', baseUrl: 'https://french-stream.pink/films/aventures/', pageUrl: 'https://french-stream.pink/films/aventures/page/{page}/' },
    'art-martiaux': { name: 'FS - Arts Martiaux', type: 'movie', baseUrl: 'https://french-stream.pink/art-martiaux/', pageUrl: 'https://french-stream.pink/art-martiaux/page/{page}/' },
    'biopics': { name: 'FS - Biopics', type: 'movie', baseUrl: 'https://french-stream.pink/films/biopics/', pageUrl: 'https://french-stream.pink/films/biopics/page/{page}/' },
    'comedies': { name: 'FS - Comédies', type: 'movie', baseUrl: 'https://french-stream.pink/films/comedies/', pageUrl: 'https://french-stream.pink/films/comedies/page/{page}/' },
    'espionnages': { name: 'FS - Espionnages', type: 'movie', baseUrl: 'https://french-stream.pink/films/espionnages/', pageUrl: 'https://french-stream.pink/films/espionnages/page/{page}/' },
    'familles': { name: 'FS - Familles', type: 'movie', baseUrl: 'https://french-stream.pink/films/familles/', pageUrl: 'https://french-stream.pink/films/familles/page/{page}/' },
    'fantastiques': { name: 'FS - Fantastiques', type: 'movie', baseUrl: 'https://french-stream.pink/films/fantastiques/', pageUrl: 'https://french-stream.pink/films/fantastiques/page/{page}/' },
    'policiers': { name: 'FS - Policiers', type: 'movie', baseUrl: 'https://french-stream.pink/films/policiers/', pageUrl: 'https://french-stream.pink/films/policiers/page/{page}/' },
    'thrillers': { name: 'FS - Thrillers', type: 'movie', baseUrl: 'https://french-stream.pink/films/thrillers/', pageUrl: 'https://french-stream.pink/films/thrillers/page/{page}/' },
    'westerns': { name: 'FS - Westerns', type: 'movie', baseUrl: 'https://french-stream.pink/films/westerns/', pageUrl: 'https://french-stream.pink/films/westerns/page/{page}/' },
    'drames': { name: 'FS - Drames', type: 'movie', baseUrl: 'https://french-stream.pink/films/drames/', pageUrl: 'https://french-stream.pink/films/drames/page/{page}/' },
    'historiques': { name: 'FS - Historiques', type: 'movie', baseUrl: 'https://french-stream.pink/films/historiques/', pageUrl: 'https://french-stream.pink/films/historiques/page/{page}/' },
    'guerres': { name: 'FS - Guerres', type: 'movie', baseUrl: 'https://french-stream.pink/films/guerres/', pageUrl: 'https://french-stream.pink/films/guerres/page/{page}/' },
    'romances': { name: 'FS - Romances', type: 'movie', baseUrl: 'https://french-stream.pink/films/romances/', pageUrl: 'https://french-stream.pink/films/romances/page/{page}/' },
    'science-fictions': { name: 'FS - Science Fictions', type: 'movie', baseUrl: 'https://french-stream.pink/films/science-fictions/', pageUrl: 'https://french-stream.pink/films/science-fictions/page/{page}/' },
    'spectacle': { name: 'FS - Spectacle', type: 'movie', baseUrl: 'https://french-stream.pink/xfsearch/genre-1/spectacle/', pageUrl: 'https://french-stream.pink/xfsearch/genre-1/spectacle/page/{page}/' },
    'lang-arabe': { name: 'FS - Pays Arabe', type: 'movie', baseUrl: 'https://french-stream.pink/xfsearch/lang/Arabe/', pageUrl: 'https://french-stream.pink/xfsearch/lang/Arabe/page/{page}/' },
    'lang-turc': { name: 'FS - Pays Turc', type: 'movie', baseUrl: 'https://french-stream.pink/xfsearch/lang/Turc/', pageUrl: 'https://french-stream.pink/xfsearch/lang/Turc/page/{page}/' },
    'lang-thai': { name: 'FS - Pays Thaï', type: 'movie', baseUrl: 'https://french-stream.pink/xfsearch/lang/Tha%C3%AF/', pageUrl: 'https://french-stream.pink/xfsearch/lang/Tha%C3%AF/page/{page}/' },
    'lang-suedois': { name: 'FS - Pays Suédois', type: 'movie', baseUrl: 'https://french-stream.pink/xfsearch/lang/Su%C3%A9dois/', pageUrl: 'https://french-stream.pink/xfsearch/lang/Su%C3%A9dois/page/{page}/' },
    'lang-hindi': { name: 'FS - Pays Hindi', type: 'movie', baseUrl: 'https://french-stream.pink/xfsearch/lang/Hindi/', pageUrl: 'https://french-stream.pink/xfsearch/lang/Hindi/page/{page}/' },
    'lang-polonais': { name: 'FS - Pays Polonais', type: 'movie', baseUrl: 'https://french-stream.pink/xfsearch/lang/Polonais/', pageUrl: 'https://french-stream.pink/xfsearch/lang/Polonais/page/{page}/' },
    'lang-danois': { name: 'FS - Pays Danois', type: 'movie', baseUrl: 'https://french-stream.pink/xfsearch/lang/Danois/', pageUrl: 'https://french-stream.pink/xfsearch/lang/Danois/page/{page}/' },
    'lang-portugais': { name: 'FS - Pays Portugais', type: 'movie', baseUrl: 'https://french-stream.pink/xfsearch/lang/Portugais/', pageUrl: 'https://french-stream.pink/xfsearch/lang/Portugais/page/{page}/' },
    'lang-norvegien': { name: 'FS - Pays Norvégien', type: 'movie', baseUrl: 'https://french-stream.pink/xfsearch/lang/Norv%C3%A9gien/', pageUrl: 'https://french-stream.pink/xfsearch/lang/Norv%C3%A9gien/page/{page}/' },
    'lang-neerlandais': { name: 'FS - Pays Néerlandais', type: 'movie', baseUrl: 'https://french-stream.pink/xfsearch/lang/N%C3%A9erlandais/', pageUrl: 'https://french-stream.pink/xfsearch/lang/N%C3%A9erlandais/page/{page}/' },
    'lang-russe': { name: 'FS - Pays Russe', type: 'movie', baseUrl: 'https://french-stream.pink/xfsearch/lang/Russe/', pageUrl: 'https://french-stream.pink/xfsearch/lang/Russe/page/{page}/' },
    'lang-chinois': { name: 'FS - Pays Chinois', type: 'movie', baseUrl: 'https://french-stream.pink/xfsearch/lang/Chinois/', pageUrl: 'https://french-stream.pink/xfsearch/lang/Chinois/page/{page}/' },
    'lang-coreen': { name: 'FS - Pays Coréen', type: 'movie', baseUrl: 'https://french-stream.pink/xfsearch/lang/Cor%C3%A9en/', pageUrl: 'https://french-stream.pink/xfsearch/lang/Cor%C3%A9en/page/{page}/' },
    'lang-italien': { name: 'FS - Pays Italien', type: 'movie', baseUrl: 'https://french-stream.pink/xfsearch/lang/Italien/', pageUrl: 'https://french-stream.pink/xfsearch/lang/Italien/page/{page}/' },
    'lang-allemand': { name: 'FS - Pays Allemand', type: 'movie', baseUrl: 'https://french-stream.pink/xfsearch/lang/Allemand/', pageUrl: 'https://french-stream.pink/xfsearch/lang/Allemand/page/{page}/' },
    'lang-japonais': { name: 'FS - Pays Japonais', type: 'movie', baseUrl: 'https://french-stream.pink/xfsearch/lang/Japonais/', pageUrl: 'https://french-stream.pink/xfsearch/lang/Japonais/page/{page}/' },
    'lang-espagnol': { name: 'FS - Pays Espagnol', type: 'movie', baseUrl: 'https://french-stream.pink/xfsearch/lang/Espagnol/', pageUrl: 'https://french-stream.pink/xfsearch/lang/Espagnol/page/{page}/' },
    'lang-francais': { name: 'FS - Pays Français', type: 'movie', baseUrl: 'https://french-stream.pink/xfsearch/lang/Fran%C3%A7ais/', pageUrl: 'https://french-stream.pink/xfsearch/lang/Fran%C3%A7ais/page/{page}/' },
    'lang-anglais': { name: 'FS - Pays Anglais', type: 'movie', baseUrl: 'https://french-stream.pink/xfsearch/lang/Anglais/', pageUrl: 'https://french-stream.pink/xfsearch/lang/Anglais/page/{page}/' },
    'tag-alien': { name: 'FS - Aliens', type: 'movie', baseUrl: 'https://french-stream.pink/xfsearch/ftagz/alien/', pageUrl: 'https://french-stream.pink/xfsearch/ftagz/alien/page/{page}/' },
    'tag-ai': { name: 'FS - Intelligence Artificielle', type: 'movie', baseUrl: 'https://french-stream.pink/xfsearch/ftagz/artificial+intelligence+%28a.i.%29/', pageUrl: 'https://french-stream.pink/xfsearch/ftagz/artificial+intelligence+%28a.i.%29/page/{page}/' },
    'tag-autism': { name: 'FS - Autisme', type: 'movie', baseUrl: 'https://french-stream.pink/xfsearch/ftagz/autism/', pageUrl: 'https://french-stream.pink/xfsearch/ftagz/autism/page/{page}/' },
    'tag-true-story': { name: 'FS - Inspiré d’une histoire vraie', type: 'movie', baseUrl: 'https://french-stream.pink/xfsearch/ftagz/based+on+true+story/', pageUrl: 'https://french-stream.pink/xfsearch/ftagz/based+on+true+story/page/{page}/' },
    'tag-coming-of-age': { name: 'FS - Passage à l’âge adulte', type: 'movie', baseUrl: 'https://french-stream.pink/xfsearch/ftagz/coming+of+age/', pageUrl: 'https://french-stream.pink/xfsearch/ftagz/coming+of+age/page/{page}/' },
    'tag-drug-trafficking': { name: 'FS - Trafic de drogue', type: 'movie', baseUrl: 'https://french-stream.pink/xfsearch/ftagz/drug+trafficking/', pageUrl: 'https://french-stream.pink/xfsearch/ftagz/drug+trafficking/page/{page}/' },
    'tag-disaster': { name: 'FS - Catastrophe', type: 'movie', baseUrl: 'https://french-stream.pink/xfsearch/ftagz/disaster/', pageUrl: 'https://french-stream.pink/xfsearch/ftagz/disaster/page/{page}/' },
    'tag-dystopia': { name: 'FS - Dystopie', type: 'movie', baseUrl: 'https://french-stream.pink/xfsearch/ftagz/dystopia/', pageUrl: 'https://french-stream.pink/xfsearch/ftagz/dystopia/page/{page}/' },
    'tag-friendship': { name: 'FS - Amitié', type: 'movie', baseUrl: 'https://french-stream.pink/xfsearch/ftagz/friendship/', pageUrl: 'https://french-stream.pink/xfsearch/ftagz/friendship/page/{page}/' },
    'tag-heist': { name: 'FS - Braquage', type: 'movie', baseUrl: 'https://french-stream.pink/xfsearch/ftagz/heist/', pageUrl: 'https://french-stream.pink/xfsearch/ftagz/heist/page/{page}/' },
    'tag-lgbt': { name: 'FS - LGBT', type: 'movie', baseUrl: 'https://french-stream.pink/xfsearch/ftagz/lgbt/', pageUrl: 'https://french-stream.pink/xfsearch/ftagz/lgbt/page/{page}/' },
    'tag-martial-arts': { name: 'FS - Arts martiaux', type: 'movie', baseUrl: 'https://french-stream.pink/xfsearch/ftagz/martial+arts/', pageUrl: 'https://french-stream.pink/xfsearch/ftagz/martial+arts/page/{page}/' },
    'tag-haunted-house': { name: 'FS - Maison hantée', type: 'movie', baseUrl: 'https://french-stream.pink/xfsearch/ftagz/haunted+house/', pageUrl: 'https://french-stream.pink/xfsearch/ftagz/haunted+house/page/{page}/' },
    'tag-love': { name: 'FS - Romance', type: 'movie', baseUrl: 'https://french-stream.pink/xfsearch/ftagz/love/', pageUrl: 'https://french-stream.pink/xfsearch/ftagz/love/page/{page}/' },
    'tag-love-triangle': { name: 'FS - Triangle amoureux', type: 'movie', baseUrl: 'https://french-stream.pink/xfsearch/ftagz/love+triangle/', pageUrl: 'https://french-stream.pink/xfsearch/ftagz/love+triangle/page/{page}/' },
    'tag-religion': { name: 'FS - Religion', type: 'movie', baseUrl: 'https://french-stream.pink/xfsearch/ftagz/religion/', pageUrl: 'https://french-stream.pink/xfsearch/ftagz/religion/page/{page}/' },
    'tag-revenge': { name: 'FS - Vengeance', type: 'movie', baseUrl: 'https://french-stream.pink/xfsearch/ftagz/revenge/', pageUrl: 'https://french-stream.pink/xfsearch/ftagz/revenge/page/{page}/' },
    'tag-serial-killer': { name: 'FS - Tueur en série', type: 'movie', baseUrl: 'https://french-stream.pink/xfsearch/ftagz/serial+killer/', pageUrl: 'https://french-stream.pink/xfsearch/ftagz/serial+killer/page/{page}/' },
    'tag-slasher': { name: 'FS - Slasher', type: 'movie', baseUrl: 'https://french-stream.pink/xfsearch/ftagz/slasher/', pageUrl: 'https://french-stream.pink/xfsearch/ftagz/slasher/page/{page}/' },
    'tag-space-travel': { name: 'FS - Voyage spatial', type: 'movie', baseUrl: 'https://french-stream.pink/xfsearch/ftagz/space+travel/', pageUrl: 'https://french-stream.pink/xfsearch/ftagz/space+travel/page/{page}/' },
    'tag-superhero': { name: 'FS - Super-héros', type: 'movie', baseUrl: 'https://french-stream.pink/xfsearch/ftagz/superhero/', pageUrl: 'https://french-stream.pink/xfsearch/ftagz/superhero/page/{page}/' },
    'tag-survival': { name: 'FS - Survie', type: 'movie', baseUrl: 'https://french-stream.pink/xfsearch/ftagz/survival/', pageUrl: 'https://french-stream.pink/xfsearch/ftagz/survival/page/{page}/' },
    'tag-time-loop': { name: 'FS - Boucle temporelle', type: 'movie', baseUrl: 'https://french-stream.pink/xfsearch/ftagz/time+loop/', pageUrl: 'https://french-stream.pink/xfsearch/ftagz/time+loop/page/{page}/' },
    'tag-time-travel': { name: 'FS - Voyage temporel', type: 'movie', baseUrl: 'https://french-stream.pink/xfsearch/ftagz/time%20travel/', pageUrl: 'https://french-stream.pink/xfsearch/ftagz/time%20travel/page/{page}/' },
    'tag-vampire': { name: 'FS - Vampires', type: 'movie', baseUrl: 'https://french-stream.pink/xfsearch/ftagz/vampire/', pageUrl: 'https://french-stream.pink/xfsearch/ftagz/vampire/page/{page}/' },
    'tag-zombie': { name: 'FS - Zombies', type: 'movie', baseUrl: 'https://french-stream.pink/xfsearch/ftagz/zombie/', pageUrl: 'https://french-stream.pink/xfsearch/ftagz/zombie/page/{page}/' }
};

const DEFAULT_CATALOGS = ['derniers-films', 'films-action', 'dernieres-series', 'series-netflix', 'series-appletv', 'series-prime', 'series-disneyplus'];

// ============================================================================
// UTILS
// ============================================================================

function parseConfig(configStr) {
    if (!configStr) return { tmdbKey: null, rpdbKey: null, catalogs: DEFAULT_CATALOGS, vfOnly: false };
    try {
        const decoded = Buffer.from(configStr, 'base64').toString();
        const config = JSON.parse(decoded);
        return {
            tmdbKey: config.t || null,
            rpdbKey: config.r ? 't0-free-rpdb' : null,
            catalogs: Array.isArray(config.c) ? config.c.filter(id => ALL_CATALOGS[id]) : DEFAULT_CATALOGS,
            vfOnly: config.v || false
        };
    } catch (e) {
        return { tmdbKey: null, rpdbKey: null, catalogs: DEFAULT_CATALOGS, vfOnly: false };
    }
}

function cleanSeriesTitle(title) {
    return title
        .replace(/[\s\-–]+(Saison|S|Season)\s*\d+/gi, '')
        .replace(/\s+\d+$/, '')
        .trim();
}

function cleanSearchTitle(title) {
    return (title || '')
        .replace(/\(?\d{4}\)?/g, '')
        .replace(/\b(VF|VOSTFR|TRUEFRENCH|FRENCH|HD|HDRIP|WEBRIP|BLURAY)\b/gi, '')
        .replace(/[^\w\s\u00C0-\u017F'’:-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function getLanguageTag(item) {
    const text = `${item?.languageText || ''} ${item?.title || ''}`.toUpperCase();

    const hasDub =
        /\bVF\b/.test(text) ||
        /\bFRENCH\b/.test(text) ||
        /\bTRUEFRENCH\b/.test(text) ||
        /\bDUB\b/.test(text);

    const hasSub =
        /\bVOSTFR\b/.test(text) ||
        /\bSUB\b/.test(text);

    if (hasDub && hasSub) return 'DUB_SUB';
    if (hasDub) return 'DUB';
    if (hasSub) return 'SUB';

    return 'NONE';
}
function betterPosterUrl(imdbId, languageTag, baseUrl = '') {
    if (!imdbId || !/^tt\d+$/i.test(imdbId)) return null;
    const safeId = encodeURIComponent(imdbId);
    if (!languageTag || languageTag === 'NONE') return `${BETTERPOSTER_BASE}${safeId}.jpg`;
    const root = String(baseUrl || '').replace(/\/$/, '');
    if (!root) return `${BETTERPOSTER_BASE}${safeId}.jpg`;
    return `${root}/poster/${safeId}/${languageTag.toLowerCase()}.svg`;
}

// ============================================================================
// TMDB & SCRAPER
// ============================================================================

function getFrenchPoster(details) {
    const posters = details.images?.posters || [];
    const frenchPoster = posters.find(poster => poster.iso_639_1 === 'fr');
    const fallbackPoster = posters.find(poster => !poster.iso_639_1);
    const posterPath = frenchPoster?.file_path || details.poster_path || fallbackPoster?.file_path;
    return posterPath ? `https://image.tmdb.org/t/p/w500${posterPath}` : null;
}

async function searchTMDB(title, type, tmdbKey) {
    if (!tmdbKey) return null;
    try {
        let cleanTitle = title.replace(/\(?\d{4}\)?/g, '').replace(/[^\w\s\u00C0-\u017F]/g, ' ').replace(/\s+/g, ' ').trim();
        const mediaType = type === 'movie' ? 'movie' : 'tv';
        const searchUrl = `https://api.themoviedb.org/3/search/${mediaType}?api_key=${tmdbKey}&query=${encodeURIComponent(cleanTitle)}&language=fr-FR`;
        const searchResponse = await fetch(searchUrl);
        const searchData = await searchResponse.json();
        if (searchData.results && searchData.results.length > 0) {
            let result = searchData.results[0];
            for (const r of searchData.results.slice(0, 5)) {
                if ((r.title || r.name || '').toLowerCase() === cleanTitle.toLowerCase()) { result = r; break; }
            }
            const detailsResponse = await fetch(`https://api.themoviedb.org/3/${mediaType}/${result.id}?api_key=${tmdbKey}&language=fr-FR&append_to_response=external_ids,images&include_image_language=fr,null`);
            const details = await detailsResponse.json();
            return {
                tmdbId: result.id,
                imdbId: details.external_ids?.imdb_id || details.imdb_id || null,
                poster: getFrenchPoster(details),
                backdrop: details.backdrop_path ? `https://image.tmdb.org/t/p/original${details.backdrop_path}` : null,
                year: details.release_date?.substring(0, 4) || details.first_air_date?.substring(0, 4),
                title: details.title || details.name,
                description: details.overview,
                rating: details.vote_average,
                genres: details.genres?.map(g => g.name) || [],
                runtime: details.runtime
            };
        }
    } catch (e) { console.error('TMDB Error:', e.message); }
    return null;
}

async function testTMDBKey(tmdbKey) {
    if (!tmdbKey) return { valid: false, error: 'missing_key' };

    try {
        const response = await fetch(`https://api.themoviedb.org/3/configuration?api_key=${encodeURIComponent(tmdbKey)}`);
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            return { valid: false, error: data.status_message || 'invalid_key' };
        }
        return { valid: Boolean(data.images?.secure_base_url) };
    } catch (e) {
        return { valid: false, error: 'tmdb_unreachable' };
    }
}

async function fetchPage(url) {
    try {
        const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        return await response.text();
    } catch (e) { return null; }
}

async function fetchSearchPage(query, page = 1) {
    try {
        const response = await fetch('https://french-stream.pink/engine/ajax/search.php', {
            method: 'POST',
            headers: {
                'User-Agent': 'Mozilla/5.0',
                'Referer': 'https://french-stream.pink/',
                'Origin': 'https://french-stream.pink',
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: `query=${encodeURIComponent(query)}&page=${page}`
        });
        return await response.text();
    } catch (e) { return null; }
}

async function scrapeItems(html, type) {
    const $ = cheerio.load(html);
    const items = [];
    const $items = $('.short-in, .movie-item, .short, article.short, .th-item');
    $items.each((i, el) => {
        const $link = $(el).find('a[href]').first();
        let title = $(el).find('.short-title, .th-title, h3, h4, .title').text().trim() || $link.attr('title') || '';
        let poster = $(el).find('img').first().attr('src') || '';
        if (poster && !poster.startsWith('http')) poster = 'https://french-stream.pink' + poster;

        // Conserver la version linguistique de FS pour notre couche DUB/SUB.
        const languageText = $(el).text().replace(/\s+/g, ' ').trim();
        const languageTag = getLanguageTag({ title, languageText });
        const isVostfrOnly = languageTag === 'SUB';

        if (title && $link.attr('href')) items.push({ title, poster, href: $link.attr('href'), type, languageText, languageTag, isVostfrOnly });
    });
    return items;
}

function scrapeSearchItems(html, type) {
    const $ = cheerio.load(html);
    const items = [];

    $('.search-item').each((i, el) => {
        const $item = $(el);
        const title = $item.find('.search-title').first().text().trim();
        let poster = $item.find('img').first().attr('src') || '';
        const onclick = $item.attr('onclick') || '';
        const hrefMatch = onclick.match(/location\.href=['"]([^'"]+)['"]/i);
        const href = hrefMatch ? hrefMatch[1] : $item.find('a[href]').first().attr('href');
        const itemType = inferSearchItemType(title, href);

        if (!title || !href || itemType !== type) return;
        if (poster && !poster.startsWith('http')) poster = 'https://french-stream.pink' + poster;
        const languageTag = getLanguageTag({ title, languageText: title });
        items.push({ title, poster, href, type: itemType, languageText: title, languageTag, isVostfrOnly: languageTag === 'SUB' });
    });

    return items;
}

function inferSearchItemType(title, href = '') {
    const value = `${title} ${href}`.toLowerCase();
    return /saison|season|\/s-tv\//i.test(value) ? 'series' : 'movie';
}

async function getCatalogItems(catalogId, config) {
    const cacheKey = `${catalogId}_${JSON.stringify(config)}`;
    if (cache.has(cacheKey)) return cache.get(cacheKey);

    const catalog = ALL_CATALOGS[catalogId];
    if (!catalog) return [];

    const pagePromises = Array.from({ length: 3 }, (_, i) => {
        const url = i === 0 ? catalog.baseUrl : catalog.pageUrl.replace('{page}', i + 1);
        return fetchPage(url).then(html => html ? scrapeItems(html, catalog.type) : []);
    });

    const pages = await Promise.all(pagePromises);
    const seen = new Set();
    const allItems = [];
    pages.flat().forEach(item => {
        // Filtrage VF si l'option est activée
        if (config.vfOnly && item.isVostfrOnly) return;

        const sTitle = catalog.type === 'series' ? cleanSeriesTitle(item.title) : item.title;
        if (!seen.has(sTitle.toLowerCase())) {
            seen.add(sTitle.toLowerCase());
            allItems.push({ ...item, searchTitle: sTitle });
        }
    });

    const enriched = [];
    const BATCH_SIZE = 10;
    for (let i = 0; i < allItems.length; i += BATCH_SIZE) {
        const batch = allItems.slice(i, i + BATCH_SIZE);
        const batchResults = await Promise.all(batch.map(async item => {
            const tmdb = await searchTMDB(item.searchTitle, item.type, config.tmdbKey);
            let id = `fs:${Buffer.from(item.searchTitle).toString('base64').substring(0, 20)}`;
            let poster = item.poster;
            if (tmdb) {
                id = tmdb.imdbId || `tmdb:${tmdb.tmdbId}`;
                poster = betterPosterUrl(tmdb.imdbId, item.languageTag, config.posterBaseUrl) || tmdb.poster || poster;
                metaCache.set(`${item.type}:${id}`, {
                    id, type: item.type, name: tmdb.title || item.searchTitle || item.title, poster, background: tmdb.backdrop,
                    languageTag: item.languageTag,
                    description: tmdb.description, releaseInfo: tmdb.year, imdbRating: tmdb.rating,
                    genres: tmdb.genres, runtime: tmdb.runtime ? `${tmdb.runtime} min` : undefined,
                    behaviorHints: item.type === 'movie' ? { defaultVideoId: id, hasScheduledVideos: false } : undefined
                });
            }
            return { id, type: item.type, name: item.searchTitle || item.title, poster, posterShape: 'poster' };
        }));
        enriched.push(...batchResults);
    }
    cache.set(cacheKey, enriched);
    return enriched;
}

// ============================================================================
// SEARCH FEATURE (INNOVATIVE)
// ============================================================================

function buildSearchQueries(query) {
    const cleanQuery = cleanSearchTitle(query);
    const withoutAccents = cleanQuery.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const compact = withoutAccents.replace(/[^a-zA-Z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
    return Array.from(new Set([query.trim(), cleanQuery, withoutAccents, compact].filter(Boolean))).slice(0, 3);
}

function normalizeSearchValue(value) {
    return (value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function isRelevantSearchResult(title, query) {
    const queryTokens = normalizeSearchValue(query).split(' ').filter(token => token.length > 1);
    if (queryTokens.length <= 1) return true;
    const titleValue = normalizeSearchValue(title);
    return queryTokens.every(token => titleValue.includes(token));
}

async function searchFrenchStream(query, type) {
    const searches = await Promise.all(buildSearchQueries(query).map(async searchQuery => {
        const html = await fetchSearchPage(searchQuery);
        if (html) return scrapeSearchItems(html, type);

        const searchUrl = `https://french-stream.pink/index.php?do=search&subaction=search&story=${encodeURIComponent(searchQuery)}`;
        const fallbackHtml = await fetchPage(searchUrl);
        return fallbackHtml ? scrapeItems(fallbackHtml, type) : [];
    }));

    const seen = new Set();
    const results = [];
    searches.flat().forEach(item => {
        const cleanTitle = item.type === 'series' ? cleanSeriesTitle(item.title) : cleanSearchTitle(item.title);
        const key = `${item.type}:${cleanTitle.toLowerCase()}`;
        if (!cleanTitle || seen.has(key) || !isRelevantSearchResult(cleanTitle, query)) return;
        seen.add(key);
        results.push({ ...item, searchTitle: cleanTitle });
    });

    return results;
}

async function enrichSearchResults(items, config) {
    const metas = [];
    const BATCH_SIZE = 6;

    for (let i = 0; i < items.length; i += BATCH_SIZE) {
        const batch = items.slice(i, i + BATCH_SIZE);
        const batchResults = await Promise.all(batch.map(async (item, index) => {
            let id = `fs:${Buffer.from(item.searchTitle).toString('base64').substring(0, 20)}`;
            let poster = item.poster;
            const tmdb = i + index < SEARCH_ENRICH_LIMIT ? await searchTMDB(item.searchTitle, item.type, config.tmdbKey) : null;

            if (tmdb) {
                id = tmdb.imdbId || `tmdb:${tmdb.tmdbId}`;
                poster = betterPosterUrl(tmdb.imdbId, item.languageTag, config.posterBaseUrl) || tmdb.poster || poster;
                metaCache.set(`${item.type}:${id}`, {
                    id, type: item.type, name: tmdb.title || item.searchTitle || item.title, poster, background: tmdb.backdrop,
                    languageTag: item.languageTag,
                    description: tmdb.description, releaseInfo: tmdb.year, imdbRating: tmdb.rating,
                    genres: tmdb.genres, runtime: tmdb.runtime ? `${tmdb.runtime} min` : undefined,
                    behaviorHints: item.type === 'movie' ? { defaultVideoId: id, hasScheduledVideos: false } : undefined
                });
            }

            return { id, type: item.type, name: item.searchTitle || item.title, poster, posterShape: 'poster' };
        }));
        metas.push(...batchResults);
    }

    return metas;
}

// ============================================================================
// ADDON BUILDER
// ============================================================================

function createManifest(config) {
    const selected = config.catalogs.map(id => ({
        type: ALL_CATALOGS[id].type,
        id: `fs-${id}`,
        name: ALL_CATALOGS[id].name
    }));

    return {
        id: ENHANCED_ID,
        version: '0.1.0',
        name: ENHANCED_NAME,
        description: 'Version publique configurable avec recherche et nouvelles catégories.',
        logo: 'https://french-stream.pink/templates/flavor/dleflavour/assets/images/x325_logo.png.pagespeed.ic.hpZlJOA7lE.webp',
        resources: ['catalog', 'meta'],
        types: ['movie', 'series'],
        idPrefixes: ['tt', 'tmdb:', 'fs:'],
        catalogs: [
            ...selected,
            { type: 'movie', id: 'fs-search', name: 'Recherche French Stream - Films', extra: [{ name: 'search', isRequired: true }] },
            { type: 'series', id: 'fs-search', name: 'Recherche French Stream - Séries', extra: [{ name: 'search', isRequired: true }] }
        ],
        behaviorHints: { configurable: true, configurationRequired: false }
    };
}

const getAddonInterface = (configStr, posterBaseUrl = process.env.PUBLIC_BASE_URL || '') => {
    const config = parseConfig(configStr);
    config.posterBaseUrl = posterBaseUrl;
    const builder = new addonBuilder(createManifest(config));

    builder.defineCatalogHandler(async ({ type, id, extra }) => {
        if (id === 'fs-search' && extra.search) {
            const results = await searchFrenchStream(extra.search, type);
            return { metas: await enrichSearchResults(results, config) };
        }
        const catalogId = id.replace('fs-', '');
        const items = await getCatalogItems(catalogId, config);
        return { metas: items };
    });

    builder.defineMetaHandler(async ({ type, id }) => {
        if (id.startsWith('tt') || id.startsWith('tmdb:')) return { meta: null };
        return { meta: metaCache.get(`${type}:${id}`) || null };
    });

    return builder.getInterface();
};

module.exports = { getAddonInterface, ALL_CATALOGS, testTMDBKey, betterPosterUrl, getLanguageTag };
