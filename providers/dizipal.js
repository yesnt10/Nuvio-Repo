// DiziPal Nuvio Provider
// Kaynak: dizipal[N].com (sürekli değişen domain)
// Yazar: cs-kraptor portunu Nuvio JS'e çeviri
// Not: Hermes engine uyumlu - async/await YOK, Promise chain kullanılıyor

var DIZIPAL_BASE = "https://dizipal1206.com";

// DiziPal domain'i sık değiştiğinden, redirect takip ederek güncel adresi buluyoruz
function resolveBaseUrl() {
  var candidates = [
    "https://dizipal1206.com",
    "https://dizipal1999.com",
    "https://dizipal810.site",
    "https://dizipalorjinal.com"
  ];

  function tryNext(index) {
    if (index >= candidates.length) {
      return Promise.resolve(DIZIPAL_BASE);
    }
    return fetch(candidates[index], {
      method: "HEAD",
      redirect: "follow"
    })
      .then(function(res) {
        if (res.ok || res.status === 200) {
          var finalUrl = res.url || candidates[index];
          var match = finalUrl.match(/^(https?:\/\/[^\/]+)/);
          DIZIPAL_BASE = match ? match[1] : candidates[index];
          return DIZIPAL_BASE;
        }
        return tryNext(index + 1);
      })
      .catch(function() {
        return tryNext(index + 1);
      });
  }

  return tryNext(0);
}

// TMDB ID'den DiziPal sayfasını bul
function searchByTmdb(tmdbId, mediaType, baseUrl) {
  var apiUrl = baseUrl + "/api/search?tmdb=" + tmdbId + "&type=" + (mediaType === "tv" ? "series" : "movie");

  return fetch(apiUrl, {
    headers: {
      "Referer": baseUrl + "/",
      "X-Requested-With": "XMLHttpRequest",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    }
  })
    .then(function(res) { return res.json(); })
    .then(function(data) {
      if (data && data.results && data.results.length > 0) {
        return data.results[0].slug || data.results[0].url || null;
      }
      return null;
    })
    .catch(function() { return null; });
}

// Siteyi HTML arama ile tara (API çalışmazsa fallback)
function searchByHtml(title, mediaType, baseUrl) {
  var searchUrl = baseUrl + "/?s=" + encodeURIComponent(title);

  return fetch(searchUrl, {
    headers: {
      "Referer": baseUrl + "/",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    }
  })
    .then(function(res) { return res.text(); })
    .then(function(html) {
      // İlk sonuç kartının URL'sini çek
      var match = html.match(/href="(https?:\/\/[^"]*dizipal[^"]*\/(?:dizi|film)\/[^"]+)"/i);
      if (match) return match[1];

      // Alternatif pattern
      var match2 = html.match(/class="[^"]*poster[^"]*"[^>]*href="([^"]+)"/i);
      if (match2) return match2[1];

      return null;
    })
    .catch(function() { return null; });
}

// Dizi sayfasından belirli sezon/bölüm URL'sini bul
function getEpisodeUrl(seriesPageUrl, season, episode, baseUrl) {
  return fetch(seriesPageUrl, {
    headers: {
      "Referer": baseUrl + "/",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    }
  })
    .then(function(res) { return res.text(); })
    .then(function(html) {
      // Bölüm linkleri genellikle /dizi/[slug]/[sezon]-sezon-[bolum]-bolum şeklinde
      var pattern = new RegExp(
        'href="([^"]*/' + season + '-sezon-' + episode + '-bolum[^"]*)"',
        'i'
      );
      var match = html.match(pattern);
      if (match) return match[1];

      // Alternatif: data-* attribute
      var pattern2 = new RegExp(
        'data-url="([^"]*sezon-' + season + '[^"]*bolum-' + episode + '[^"]*)"',
        'i'
      );
      var match2 = html.match(pattern2);
      if (match2) return match2[1];

      // Alternatif: episode listesi
      var epPattern = /href="([^"]+)" [^>]*class="[^"]*episode[^"]*"/gi;
      var allEps = [];
      var m;
      while ((m = epPattern.exec(html)) !== null) {
        allEps.push(m[1]);
      }
      // Season/episode hesapla - genelde lineer sıralama
      var epIndex = (season - 1) * 100 + (episode - 1);
      if (allEps[epIndex]) return allEps[epIndex];

      return null;
    })
    .catch(function() { return null; });
}

// Video sayfasından stream URL'lerini çıkar
function extractStreams(pageUrl, baseUrl) {
  return fetch(pageUrl, {
    headers: {
      "Referer": baseUrl + "/",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    }
  })
    .then(function(res) { return res.text(); })
    .then(function(html) {
      var streams = [];

      // 1. m3u8 direkt
      var m3u8Matches = html.match(/['"]([^'"]*\.m3u8[^'"]*)['"]/g) || [];
      m3u8Matches.forEach(function(m) {
        var url = m.replace(/['"]/g, '');
        if (url.startsWith('http') && streams.findIndex(function(s){return s.url===url;}) === -1) {
          streams.push({
            name: "DiziPal",
            title: "HLS",
            url: url,
            quality: url.indexOf("1080") !== -1 ? "1080p" : url.indexOf("720") !== -1 ? "720p" : "HD",
            headers: { "Referer": baseUrl + "/" }
          });
        }
      });

      // 2. iframe embed'i - vidmoly, fembed, vk gibi
      var iframeMatch = html.match(/<iframe[^>]+src="([^"]+)"/i);
      if (iframeMatch) {
        var iframeSrc = iframeMatch[1];
        if (!iframeSrc.startsWith('http')) {
          iframeSrc = baseUrl + iframeSrc;
        }
        // Vidmoly, Fembed gibi player'lar için ikincil fetch
        return fetch(iframeSrc, {
          headers: {
            "Referer": pageUrl,
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
          }
        })
          .then(function(r) { return r.text(); })
          .then(function(iframeHtml) {
            // m3u8
            var innerM3u8 = iframeHtml.match(/['"]([^'"]*\.m3u8[^'"]*)['"]/g) || [];
            innerM3u8.forEach(function(m) {
              var url = m.replace(/['"]/g, '');
              if (url.startsWith('http')) {
                streams.push({
                  name: "DiziPal",
                  title: "HLS (embed)",
                  url: url,
                  quality: url.indexOf("1080") !== -1 ? "1080p" : "HD",
                  headers: {
                    "Referer": iframeSrc,
                    "Origin": new URL(iframeSrc).origin
                  }
                });
              }
            });

            // mp4 direkt
            var mp4Matches = iframeHtml.match(/['"]([^'"]*\.mp4[^'"]*)['"]/g) || [];
            mp4Matches.forEach(function(m) {
              var url = m.replace(/['"]/g, '');
              if (url.startsWith('http')) {
                streams.push({
                  name: "DiziPal",
                  title: "MP4",
                  url: url,
                  quality: url.indexOf("1080") !== -1 ? "1080p" : url.indexOf("720") !== -1 ? "720p" : "SD",
                  headers: { "Referer": iframeSrc }
                });
              }
            });

            // jwplayer setup
            var jwMatch = iframeHtml.match(/file\s*:\s*['"]([^'"]+)['"]/);
            if (jwMatch && jwMatch[1].startsWith('http')) {
              streams.push({
                name: "DiziPal",
                title: "JWPlayer",
                url: jwMatch[1],
                quality: "HD",
                headers: { "Referer": iframeSrc }
              });
            }

            return streams;
          })
          .catch(function() { return streams; });
      }

      // 3. jwplayer / videojs direkt sayfada
      var jwDirect = html.match(/file\s*:\s*['"]([^'"]+\.(?:m3u8|mp4)[^'"]*)['"]/);
      if (jwDirect && jwDirect[1].startsWith('http')) {
        streams.push({
          name: "DiziPal",
          title: "Direkt",
          url: jwDirect[1],
          quality: "HD",
          headers: { "Referer": pageUrl }
        });
      }

      // 4. sources array (video.js tarzı)
      var sourcesMatch = html.match(/sources\s*:\s*\[([^\]]+)\]/);
      if (sourcesMatch) {
        var srcBlock = sourcesMatch[1];
        var srcUrls = srcBlock.match(/['"]([^'"]*https[^'"]+\.(?:m3u8|mp4)[^'"]*)['"]/g) || [];
        srcUrls.forEach(function(s) {
          var url = s.replace(/['"]/g, '');
          if (url.startsWith('http')) {
            streams.push({
              name: "DiziPal",
              title: "Source",
              url: url,
              quality: url.indexOf("1080") !== -1 ? "1080p" : "HD",
              headers: { "Referer": pageUrl }
            });
          }
        });
      }

      return streams;
    })
    .catch(function() { return []; });
}

// Ana fonksiyon - Nuvio'nun çağırdığı tek entry point
function getStreams(tmdbId, mediaType, season, episode) {
  console.log("[DiziPal] Araniyor: tmdb=" + tmdbId + " tur=" + mediaType +
    (season ? " S" + season + "E" + episode : ""));

  return resolveBaseUrl()
    .then(function(baseUrl) {
      // Önce TMDB API ile dene
      return searchByTmdb(tmdbId, mediaType, baseUrl)
        .then(function(slug) {
          if (!slug) return null;
          // slug mutlak URL mi yoksa path mi?
          if (slug.startsWith('http')) return slug;
          return baseUrl + "/" + slug.replace(/^\//, '');
        })
        .then(function(contentUrl) {
          if (!contentUrl) {
            // TMDB API çalışmadıysa - şimdilik null döndür
            // İleri aşamada TMDB'den title çekip HTML arama yapılabilir
            console.log("[DiziPal] Icerik bulunamadi: " + tmdbId);
            return [];
          }

          // Film mi dizi mi?
          if (mediaType === "movie") {
            return extractStreams(contentUrl, baseUrl);
          } else {
            // TV: önce dizi ana sayfasına git, sonra bölümü bul
            return getEpisodeUrl(contentUrl, season, episode, baseUrl)
              .then(function(episodeUrl) {
                if (!episodeUrl) {
                  console.log("[DiziPal] Bolum bulunamadi: S" + season + "E" + episode);
                  return [];
                }
                var fullEpUrl = episodeUrl.startsWith('http')
                  ? episodeUrl
                  : baseUrl + "/" + episodeUrl.replace(/^\//, '');
                return extractStreams(fullEpUrl, baseUrl);
              });
          }
        });
    })
    .catch(function(err) {
      console.error("[DiziPal] Hata: " + err.message);
      return [];
    });
}

module.exports = { getStreams: getStreams };
