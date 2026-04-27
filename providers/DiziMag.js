/**
 * DiziMag Nuvio Scraper
 * Converted from CloudStream .cs3 plugin
 * Version: 44
 */

var cheerio = require("cheerio-without-node-native");

const BASE_URL = "https://dizimag.pw";

const WORKING_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Referer': BASE_URL + '/',
    'Origin': BASE_URL
};

// Base64 decode helper
function base64Decode(str) {
    try {
        return atob(str);
    } catch (e) {
        return null;
    }
}

// Extract video location from page (simplified without crypto)
async function extractVideoLocation(iframeUrl) {
    try {
        const response = await fetch(iframeUrl, { headers: WORKING_HEADERS });
        const html = await response.text();
        const $ = cheerio.load(html);
        
        // Try to find direct video URLs in the page
        // Method 1: Look for video sources in video tags
        const videoSrc = $('video source').attr('src');
        if (videoSrc) {
            return videoSrc.startsWith('http') ? videoSrc : (videoSrc.startsWith('//') ? 'https:' + videoSrc : null);
        }
        
        // Method 2: Look for iframe src
        const iframeSrc = $('iframe').attr('src');
        if (iframeSrc) {
            return iframeSrc.startsWith('http') ? iframeSrc : (iframeSrc.startsWith('//') ? 'https:' + iframeSrc : null);
        }
        
        // Method 3: Look for m3u8 URLs in scripts
        const scripts = $('script').map(function() {
            return $(this).html();
        }).get();
        
        for (const script of scripts) {
            if (script) {
                const m3u8Match = script.match(/https?:[^"'\s]+\.m3u8[^"'\s]*/);
                if (m3u8Match) {
                    return m3u8Match[0];
                }
                const mp4Match = script.match(/https?:[^"'\s]+\.mp4[^"'\s]*/);
                if (mp4Match) {
                    return mp4Match[0];
                }
            }
        }
        
        // Method 4: Try to find JSON data with video_location
        const jsonMatch = html.match(/"video_location"\s*:\s*"([^"]+)"/);
        if (jsonMatch) {
            return jsonMatch[1];
        }
        
        const linkMatch = html.match(/"link"\s*:\s*"([^"]+)"/);
        if (linkMatch) {
            return linkMatch[1];
        }
        
        return null;
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
