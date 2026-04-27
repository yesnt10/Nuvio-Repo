/**
 * DiziMag Nuvio Scraper
 * Converted from CloudStream .cs3 plugin
 * Version: 44
 */

var cheerio = require("cheerio-without-node-native");
var crypto = require("crypto");

const BASE_URL = "https://dizimag.pw";

const WORKING_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Referer': BASE_URL + '/',
    'Origin': BASE_URL
};

// OpenSSL KDF implementation for key derivation
function opensslKdf(password, salt) {
    const md5 = (data) => {
        const hash = crypto.createHash('md5');
        hash.update(data);
        return hash.digest();
    };
    
    const passBytes = Buffer.from(password, 'utf8');
    let keyIv = Buffer.alloc(0);
    let prev = Buffer.alloc(0);
    
    while (keyIv.length < 48) {
        prev = md5(Buffer.concat([prev, passBytes, salt]));
        keyIv = Buffer.concat([keyIv, prev]);
    }
    
    return keyIv;
}

// Convert hex string to bytes
function hexToBytes(hex) {
    const bytes = [];
    for (let i = 0; i < hex.length; i += 2) {
        bytes.push(parseInt(hex.substr(i, 2), 16));
    }
    return Buffer.from(bytes);
}

// AES-256-CBC decryption
function decryptAES(ciphertext, key, iv) {
    try {
        const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
        decipher.setAutoPadding(true);
        let decrypted = decipher.update(ciphertext);
        decrypted = Buffer.concat([decrypted, decipher.final()]);
        return decrypted.toString('utf8');
    } catch (e) {
        console.error("Decryption error:", e);
        return null;
    }
}

// Extract video location from encrypted JSON
async function extractVideoLocation(iframeUrl) {
    try {
        const response = await fetch(iframeUrl, { headers: WORKING_HEADERS });
        const html = await response.text();
        const $ = cheerio.load(html);
        
        // Find the encrypted data in the page
        const scriptContent = $('script').filter(function() {
            return $(this).html().includes('ct') || $(this).html().includes('iv');
        }).html();
        
        if (!scriptContent) return null;
        
        // Try to extract the cipher data
        const ctMatch = scriptContent.match(/"ct"\s*:\s*"([^"]+)"/);
        const ivMatch = scriptContent.match(/"iv"\s*:\s*"([^"]+)"/);
        const sMatch = scriptContent.match(/"s"\s*:\s*"([^"]+)"/);
        
        if (!ctMatch || !ivMatch || !sMatch) return null;
        
        const ct = ctMatch[1];
        const iv = ivMatch[1];
        const s = sMatch[1];
        
        // Decrypt using the key
        const salt = hexToBytes(iv);
        const keyIv = opensslKdf(s, salt);
        const key = keyIv.slice(0, 32);
        const ivBytes = keyIv.slice(32, 48);
        
        const ciphertext = hexToBytes(ct);
        const decryptedJson = decryptAES(ciphertext, key, ivBytes);
        
        if (!decryptedJson) return null;
        
        const jsonData = JSON.parse(decryptedJson);
        return jsonData.video_location || jsonData.link || null;
    } catch (e) {
        console.error("Extract video location error:", e);
        return null;
    }
}

// Search for content on DiziMag
async function searchContent(query) {
    try {
        const searchUrl = `${BASE_URL}/arama/${encodeURIComponent(query)}`;
        const response = await fetch(searchUrl, { headers: WORKING_HEADERS });
        const html = await response.text();
        const $ = cheerio.load(html);
        
        const results = [];
        
        $('.film-listesi li, .item').each(function() {
            const $item = $(this);
            const title = $item.find('h2, h3, .title').text().trim();
            const link = $item.find('a').attr('href');
            const poster = $item.find('img').attr('data-src') || $item.find('img').attr('src');
            
            if (title && link) {
                results.push({
                    title: title,
                    url: link.startsWith('http') ? link : BASE_URL + link,
                    poster: poster ? (poster.startsWith('http') ? poster : BASE_URL + poster) : null
                });
            }
        });
        
        return results;
    } catch (e) {
        console.error("Search error:", e);
        return [];
    }
}

// Load content details
async function loadContent(url) {
    try {
        const response = await fetch(url.startsWith('http') ? url : BASE_URL + url, { headers: WORKING_HEADERS });
        const html = await response.text();
        const $ = cheerio.load(html);
        
        const title = $('h1, .title').first().text().trim();
        const description = $('.description, .plot, .summary').first().text().trim();
        const poster = $('.poster img, .cover img').attr('data-src') || $('.poster img, .cover img').attr('src');
        const year = $('.year, .date').first().text().match(/\d{4}/)?.[0];
        
        const episodes = [];
        
        $('.episode-list a, .bolum-list a').each(function() {
            const $ep = $(this);
            const epTitle = $ep.text().trim();
            const epUrl = $ep.attr('href');
            const seasonMatch = epTitle.match(/Sezon\s*(\d+)/i);
            const epMatch = epTitle.match(/Bölüm\s*(\d+)/i);
            
            if (epTitle && epUrl) {
                episodes.push({
                    name: epTitle,
                    url: epUrl.startsWith('http') ? epUrl : BASE_URL + epUrl,
                    season: seasonMatch ? parseInt(seasonMatch[1]) : 1,
                    episode: epMatch ? parseInt(epMatch[1]) : episodes.length + 1
                });
            }
        });
        
        return {
            title: title,
            description: description,
            poster: poster ? (poster.startsWith('http') ? poster : BASE_URL + poster) : null,
            year: year ? parseInt(year) : null,
            episodes: episodes,
            isTvSeries: url.includes('/dizi/')
        };
    } catch (e) {
        console.error("Load content error:", e);
        return null;
    }
}

// Main getStreams function for Nuvio
async function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
    try {
        // First, get TMDB data to find the title
        const tmdbUrl = `https://api.themoviedb.org/3/${mediaType === 'tv' ? 'tv' : 'movie'}/${tmdbId}?language=tr-TR&api_key=4ef0d7355d9ffb5151e987764708ce96`;
        const tmdbResponse = await fetch(tmdbUrl);
        const tmdbData = await tmdbResponse.json();
        
        const title = tmdbData.title || tmdbData.name || tmdbData.original_title || tmdbData.original_name;
        const year = tmdbData.release_date?.split('-')[0] || tmdbData.first_air_date?.split('-')[0];
        
        if (!title) return [];
        
        // Search on DiziMag
        const searchResults = await searchContent(title);
        
        if (searchResults.length === 0) return [];
        
        // Find the best match (prefer matching year)
        let bestMatch = searchResults[0];
        if (year) {
            const yearMatch = searchResults.find(r => r.title.includes(year));
            if (yearMatch) bestMatch = yearMatch;
        }
        
        // Load content details
        const contentData = await loadContent(bestMatch.url);
        
        if (!contentData) return [];
        
        const streams = [];
        
        if (mediaType === 'tv' && seasonNum && episodeNum) {
            // TV Series - find specific episode
            const episode = contentData.episodes.find(ep => 
                ep.season === seasonNum && ep.episode === episodeNum
            );
            
            if (episode) {
                const videoLocation = await extractVideoLocation(episode.url);
                if (videoLocation) {
                    streams.push({
                        name: contentData.title,
                        title: `S${seasonNum} E${episodeNum} - ${episode.name}`,
                        url: videoLocation,
                        quality: "Auto",
                        headers: WORKING_HEADERS,
                        provider: "dizimag"
                    });
                }
            }
        } else {
            // Movie - use first episode or extract from main page
            if (contentData.episodes.length > 0) {
                const videoLocation = await extractVideoLocation(contentData.episodes[0].url);
                if (videoLocation) {
                    streams.push({
                        name: contentData.title,
                        title: contentData.title,
                        url: videoLocation,
                        quality: "Auto",
                        headers: WORKING_HEADERS,
                        provider: "dizimag"
                    });
                }
            } else {
                // Try to extract from main page
                const videoLocation = await extractVideoLocation(bestMatch.url);
                if (videoLocation) {
                    streams.push({
                        name: contentData.title,
                        title: contentData.title,
                        url: videoLocation,
                        quality: "Auto",
                        headers: WORKING_HEADERS,
                        provider: "dizimag"
                    });
                }
            }
        }
        
        return streams;
    } catch (e) {
        console.error("Get streams error:", e);
        return [];
    }
}

// Export for Nuvio
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { getStreams: getStreams };
} else {
    globalThis.getStreams = getStreams;
}
