// DiziPal Nuvio Provider v2
// Hermes engine uyumlu - Promise chain, async/await YOK

var BASE_URL = "https://dizipal.im";

// TMDB'den başlık bilgisi çek
function getTmdbTitle(tmdbId, mediaType) {
  var type = mediaType === "tv" ? "tv" : "movie";
  var url = "https://api.themoviedb.org/3/" + type + "/" + tmdbId + "?language=tr-TR";
  return fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" }
  })
    .then(function(r) { return r.json(); })
    .then(function(d) {
      return {
        title: d.name || d.title || "",
        originalTitle: d.original_name || d.original_title || ""
      };
    })
    .catch(function() { return { title: "", originalTitle: "" }; });
}

// Slug oluştur: "Breaking Bad" -> "breaking-bad"
function toSlug(str) {
  return str
    .toLowerCase()
    .replace(/ğ/g, "g").replace(/ü/g, "u").replace(/ş/g, "s")
    .replace(/ı/g, "i").replace(/ö/g, "o").replace(/ç/g, "c")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// DiziPal arama
function searchDizipal(query, mediaType) {
  var searchUrl = BASE_URL + "/?s=" + encodeURIComponent(query);
  return fetch(searchUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Referer": BASE_URL + "/"
    }
  })
    .then(function(r) { return r.text(); })
    .then(function(html) {
      // href="/dizi/..." veya href="/film/..." pattern
      var type = mediaType === "tv" ? "dizi" : "film";
      var re = new RegExp('href="(' + BASE_URL + '\\/' + type + '\\/[^\\"]+?)\\"', 'gi');
      var match = re.exec(html);
      if (match) return match[1];

      // BASE_URL olmadan da dene
      var re2 = new RegExp('href="(\\/' + type + '\\/[^\\"]+?)\\"', 'i');
      var m2 = html.match(re2);
      if (m2) return BASE_URL + m2[1];

      return null;
    })
    .catch(function() { return null; });
}

// Dizi sayfasından bölüm URL'si bul
function getEpisodeUrl(seriesUrl, season, episode) {
  return fetch(seriesUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Referer": BASE_URL + "/"
    }
  })
    .then(function(r) { return r.text(); })
    .then(function(html) {
      // Pattern: /dizi/breaking-bad/1-sezon-1-bolum
      var re = new RegExp(
        'href="([^"]*\\/' + season + '-sezon-' + episode + '-bolum[^"]*)"',
        'i'
      );
      var m = html.match(re);
      if (m) {
        return m[1].startsWith('http') ? m[1] : BASE_URL + m[1];
      }

      // Alternatif: sezon-1-bolum-1
      var re2 = new RegExp(
        'href="([^"]*sezon-' + season + '[^"]*bolum-' + episode + '[^"]*)"',
        'i'
      );
      var m2 = html.match(re2);
      if (m2) {
        return m2[1].startsWith('http') ? m2[1] : BASE_URL + m2[1];
      }

      // Direkt URL tahmini
      var slugMatch = seriesUrl.match(/\/dizi\/([^\/]+)/);
      if (slugMatch) {
        return BASE_URL + "/dizi/" + slugMatch[1] + "/" + season + "-sezon-" + episode + "-bolum";
      }

      return null;
    })
    .catch(function() { return null; });
}

// Sayfadan stream URL çıkar
function extractFromPage(pageUrl) {
  return fetch(pageUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Referer": BASE_URL + "/"
    }
  })
    .then(function(r) { return r.text(); })
    .then(function(html) {
      var streams = [];

      // iframe src
      var iframes = [];
      var iRe = /<iframe[^>]+src=["']([^"']+)["']/gi;
      var im;
      while ((im = iRe.exec(html)) !== null) {
        var src = im[1];
        if (!src.startsWith('http')) src = BASE_URL + src;
        iframes.push(src);
      }

      if (iframes.length === 0) {
        // m3u8/mp4 direkt
        var d1 = html.match(/["']([^"']*\.m3u8[^"']*?)["']/);
        if (d1 && d1[1].startsWith('http')) {
          streams.push({ name: "DiziPal", title: "HD", url: d1[1], quality: "HD", headers: { "Referer": pageUrl } });
        }
        var d2 = html.match(/file\s*:\s*["']([^"']+)["']/);
        if (d2 && d2[1].startsWith('http')) {
          streams.push({ name: "DiziPal", title: "HD", url: d2[1], quality: "HD", headers: { "Referer": pageUrl } });
        }
        return streams;
      }

      // İlk iframe'i fetch et
      var iframeSrc = iframes[0];
      return fetch(iframeSrc, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "Referer": pageUrl
        }
      })
        .then(function(r2) { return r2.text(); })
        .then(function(iHtml) {
          var origin = iframeSrc.match(/^(https?:\/\/[^\/]+)/);
          var ref = origin ? origin[1] : iframeSrc;

          // m3u8
          var ms = iHtml.match(/["']([^"']*\.m3u8[^"']*?)["']/g) || [];
          ms.forEach(function(u) {
            var url = u.replace(/["']/g, '');
            if (url.startsWith('http')) {
              streams.push({
                name: "DiziPal",
                title: url.indexOf('1080') !== -1 ? '1080p' : url.indexOf('720') !== -1 ? '720p' : 'HD',
                url: url,
                quality: url.indexOf('1080') !== -1 ? '1080p' : 'HD',
                headers: { "Referer": ref, "Origin": ref }
              });
            }
          });

          // mp4
          var mp = iHtml.match(/["']([^"']*\.mp4[^"']*?)["']/g) || [];
          mp.forEach(function(u) {
            var url = u.replace(/["']/g, '');
            if (url.startsWith('http')) {
              streams.push({
                name: "DiziPal",
                title: 'MP4',
                url: url,
                quality: url.indexOf('1080') !== -1 ? '1080p' : 'HD',
                headers: { "Referer": ref }
              });
            }
          });

          // jwplayer file
          var jw = iHtml.match(/file\s*:\s*["']([^"']+)["']/);
          if (jw && jw[1].startsWith('http')) {
            streams.push({
              name: "DiziPal",
              title: "JW",
              url: jw[1],
              quality: "HD",
              headers: { "Referer": ref }
            });
          }

          // sources array
          var sa = iHtml.match(/sources\s*:\s*\[([\s\S]*?)\]/);
          if (sa) {
            var su = sa[1].match(/["']([^"']*https[^"']+\.(?:m3u8|mp4)[^"']*)["']/g) || [];
            su.forEach(function(u) {
              var url = u.replace(/["']/g, '');
              streams.push({
                name: "DiziPal",
                title: "Source",
                url: url,
                quality: "HD",
                headers: { "Referer": ref }
              });
            });
          }

          return streams;
        })
        .catch(function() { return streams; });
    })
    .catch(function() { return []; });
}

// Ana fonksiyon
function getStreams(tmdbId, mediaType, season, episode) {
  console.log("[DiziPal] tmdb=" + tmdbId + " type=" + mediaType +
    (season ? " S" + season + "E" + episode : ""));

  return getTmdbTitle(tmdbId, mediaType)
    .then(function(info) {
      var title = info.title || info.originalTitle;
      if (!title) {
        console.log("[DiziPal] Baslik alinamadi");
        return [];
      }
      console.log("[DiziPal] Baslik: " + title);

      // Önce Türkçe başlıkla ara, bulamazsa orijinalle
      return searchDizipal(title, mediaType)
        .then(function(url) {
          if (!url && info.originalTitle && info.originalTitle !== title) {
            return searchDizipal(info.originalTitle, mediaType);
          }
          return url;
        })
        .then(function(contentUrl) {
          if (!contentUrl) {
            // Slug tahmini ile direkt dene
            var slug = toSlug(info.originalTitle || title);
            var type = mediaType === "tv" ? "dizi" : "film";
            contentUrl = BASE_URL + "/" + type + "/" + slug;
            console.log("[DiziPal] Slug tahmini: " + contentUrl);
          }

          if (mediaType === "movie") {
            return extractFromPage(contentUrl);
          }

          return getEpisodeUrl(contentUrl, season, episode)
            .then(function(epUrl) {
              if (!epUrl) {
                console.log("[DiziPal] Bolum bulunamadi");
                return [];
              }
              console.log("[DiziPal] Bolum URL: " + epUrl);
              return extractFromPage(epUrl);
            });
        });
    })
    .catch(function(e) {
      console.error("[DiziPal] Hata: " + (e.message || e));
      return [];
    });
}

module.exports = { getStreams: getStreams };
