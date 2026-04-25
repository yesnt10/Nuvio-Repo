/**
 * Yabancidizi.life Scraper - Nuvio Plugin
 * AES decryption based on provided embed code
 */

const cheerio = require('cheerio-without-node-native');
const CryptoJS = require('crypto-js');  // Required for AES decryption

const BASE_URL = 'https://yabancidizi.life';
const SEARCH_URL = BASE_URL + '/?s=';

const WORKING_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Referer': BASE_URL + '/',
    'Origin': BASE_URL
};

/**
 * Decrypts the AES-encrypted video frame code
 * @param {string} encryptedData - The ciphertext
 * @param {string} key - The encryption key (also AES encrypted)
 * @returns {string|null} - Decrypted HTML/URL
 */
function decryptVideoFrame(encryptedData, key) {
    try {
        // First decrypt the key (it's also AES encrypted)
        const decryptedKey = CryptoJS.AES.decrypt(key, key).toString(CryptoJS.enc.Utf8);
        // Then decrypt the data using the decrypted key
        const bytes = CryptoJS.AES.decrypt(encryptedData, decryptedKey);
        const result = bytes.toString(CryptoJS.enc.Utf8);
        return result || null;
    } catch (e) {
        console.error('Decryption failed:', e);
        return null;
    }
}

/**
 * Extracts m3u8 URL from the decrypted frame content
 * @param {string} html - Decrypted HTML/JavaScript
 * @returns {string|null}
 */
function extractM3u8FromFrame(html) {
    if (!html) return null;
    // Try to find an iframe src first
    let iframeMatch = html.match(/<iframe[^>]+src=["']([^"']+\.m3u8[^"']*)["']/i);
    if (iframeMatch) return iframeMatch[1];
    // Try to find file: "..." in script
    let fileMatch = html.match(/file:\s*["']([^"']+\.m3u8[^"']*)["']/i);
    if (fileMatch) return fileMatch[1];
    // Try to find raw m3u8 URL
    let urlMatch = html.match(/(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/i);
    if (urlMatch) return urlMatch[1];
    return null;
}

/**
 * Gets video stream from a movie page
 * @param {string} pageUrl - Full URL of the movie page
 * @returns {Promise<Object|null>}
 */
async function getStreamFromMoviePage(pageUrl, movieTitle) {
    try {
        let res = await fetch(pageUrl, { headers: WORKING_HEADERS });
        let html = await res.text();
        let $ = cheerio.load(html);

        // Find the script that contains the AES decryption code
        // Usually looks like: CryptoJS.AES.decrypt("ciphertext", "key")
        let decryptScript = null;
        $('script').each((i, el) => {
            let scriptContent = $(el).html();
            if (scriptContent && scriptContent.includes('CryptoJS.AES.decrypt')) {
                decryptScript = scriptContent;
                return false;
            }
        });

        if (!decryptScript) return null;

        // Extract ciphertext and key from the script
        // Pattern: CryptoJS.AES.decrypt("ciphertext", "key")
        let match = decryptScript.match(/CryptoJS\.AES\.decrypt\(["']([^"']+)["'],\s*["']([^"']+)["']\)/);
        if (!match) return null;

        const ciphertext = match[1];
        const key = match[2];

        const decryptedHtml = decryptVideoFrame(ciphertext, key);
        const m3u8Url = extractM3u8FromFrame(decryptedHtml);

        if (m3u8Url && (m3u8Url.startsWith('http') || m3u8Url.startsWith('//'))) {
            let fullUrl = m3u8Url.startsWith('//') ? 'https:' + m3u8Url : m3u8Url;
            return {
                name: movieTitle,
                title: '🎬 Yabancidizi.life | Türkçe Dublaj/Altyazı',
                url: fullUrl,
                quality: 'Auto',
                headers: {
                    'User-Agent': WORKING_HEADERS['User-Agent'],
                    'Referer': pageUrl,
                    'Origin': BASE_URL
                },
                provider: 'yabancidizi_scraper'
            };
        }
        return null;
    } catch (e) {
        console.error('Error extracting stream:', e);
        return null;
    }
}

/**
 * Main function exported for Nuvio
 * @param {string} tmdbId - TMDB ID of the movie
 * @param {string} mediaType - 'movie' or 'tv'
 * @param {number} seasonNum - Not used for movies
 * @param {number} episodeNum - Not used for movies
 */
function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
    return new Promise((resolve) => {
        if (mediaType !== 'movie') {
            return resolve([]); // Only movies supported for now
        }

        // 1. Get movie details from TMDB (title, year)
        fetch(`https://api.themoviedb.org/3/movie/${tmdbId}?language=tr-TR&api_key=4ef0d7355d9ffb5151e987764708ce96`)
            .then(res => res.json())
            .then(movieData => {
                const year = movieData.release_date ? movieData.release_date.split('-')[0] : '';
                const movieTitle = movieData.title || movieData.original_title;
                const searchQuery = encodeURIComponent(movieTitle);

                // 2. Search on yabancidizi.life
                return fetch(SEARCH_URL + searchQuery, { headers: WORKING_HEADERS })
                    .then(res => res.text())
                    .then(searchHtml => ({ searchHtml, year, movieTitle }));
            })
            .then(({ searchHtml, year, movieTitle }) => {
                let $ = cheerio.load(searchHtml);
                let movieLink = null;

                // Try to find the correct movie link by year and title
                $('a').each((i, el) => {
                    let href = $(el).attr('href');
                    let text = $(el).text();
                    if (href && href.includes('/film/') && (year === '' || text.includes(year))) {
                        movieLink = href;
                        return false;
                    }
                });

                if (!movieLink) {
                    // Fallback: first film link
                    movieLink = $('a[href*="/film/"]').first().attr('href');
                }

                if (!movieLink) throw new Error('Film bulunamadı');

                const fullMovieUrl = movieLink.startsWith('http') ? movieLink : BASE_URL + movieLink;
                return getStreamFromMoviePage(fullMovieUrl, movieTitle);
            })
            .then(stream => {
                if (stream) resolve([stream]);
                else resolve([]);
            })
            .catch(err => {
                console.error('Yabancidizi scraper error:', err);
                resolve([]);
            });
    });
}

// Export for Nuvio environment
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { getStreams: getStreams };
} else {
    globalThis.getStreams = getStreams;
}
