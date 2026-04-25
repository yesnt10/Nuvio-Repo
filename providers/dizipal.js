// DiziPal Nuvio Provider v4
// Site: dizipal.im
// Bolum: dizipal.im/bolum/[slug]-[S]-sezon-[E]-bolum-izle/
// Player: x.ag2m4.cfd embed -> /dl?op=get_stream&view_id=X&hash=Y -> d.url
// Hermes uyumlu - Promise chain, async/await YOK

var BASE_URL = "https://dizipal.im";

// TMDB'den baslik al
function getTmdbInfo(tmdbId, mediaType) {
  var type = mediaType === "tv" ? "tv" : "movie";
  return fetch("https://api.themoviedb.org/3/" + type + "/" + tmdbId + "?language=tr-TR", {
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

// Slug: "Breaking Bad" -> "breaking-bad"
function toSlug(str) {
  return str
    .toLowerCase()
    .replace(/ğ/g, "g").replace(/ü/g, "u").replace(/ş/g, "s")
    .replace(/ı/g, "i").replace(/ö/g, "o").replace(/ç/g, "c")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// DiziPal arama - slug bul
function searchSlug(query, mediaType) {
  return fetch(BASE_URL + "/?s=" + encodeURIComponent(query), {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Referer": BASE_URL + "/"
    }
  })
    .then(function(r) { return r.text(); })
    .then(function(html) {
      var type = mediaType === "tv" ? "dizi" : "film";
      var re = new RegExp('href="(?:' + BASE_URL + ')?\\/' + type + '\\/([a-z0-9\\-]+)\\/?[^"]*"', 'i');
      var m = html.match(re);
      return m ? m[1] : null;
    })
    .catch(function() { return null; });
}

// Bolum sayfasindan iframe src al
function getIframeSrc(bolumUrl) {
  return fetch(bolumUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Referer": BASE_URL + "/"
    }
  })
    .then(function(r) { return r.text(); })
    .then(function(html) {
      var m = html.match(/<iframe[^>]+src=["']([^"']+)["']/i);
      return m ? m[1] : null;
    })
    .catch(function() { return null; });
}

// Iframe HTML'inden view_id ve hash cek, sonra stream URL al
function extractFromIframe(iframeSrc, bolumUrl) {
  var originMatch = iframeSrc.match(/^(https?:\/\/[^\/]+)/);
  var iframeOrigin = originMatch ? originMatch[1] : "";

  return fetch(iframeSrc, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Referer": bolumUrl
    }
  })
    .then(function(r) { return r.text(); })
    .then(function(html) {
      // fetch('/dl?op=get_stream&view_id=19350117&hash=1777154298-a83658e1e091f593c067fa7c7c53ac6a')
      var m = html.match(/\/dl\?op=get_stream&view_id=(\d+)&hash=([\w\-]+)/);
      if (!m) {
        console.log("[DiziPal] get_stream parametreleri bulunamadi");
        return [];
      }

      var viewId = m[1];
      var hash = m[2];
      var streamApiUrl = iframeOrigin + "/dl?op=get_stream&view_id=" + viewId + "&hash=" + hash;
      console.log("[DiziPal] Stream API: " + streamApiUrl);

      return fetch(streamApiUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "Referer": iframeSrc,
          "Origin": iframeOrigin,
          "X-Requested-With": "XMLHttpRequest"
        }
      })
        .then(function(r) { return r.json(); })
        .then(function(d) {
          if (!d || !d.url) {
            console.log("[DiziPal] Stream URL bos geldi");
            return [];
          }
          console.log("[DiziPal] Stream bulundu: " + d.url);

          // Altyazilari da ekle
          var subtitles = [];
          // HTML'den subtitle bilgisini cek
          // "subtitle":"[İngilizce]https://...eng.vtt,[Türkçe]https://...tur.vtt"
          var subMatch = html.match(/"subtitle"\s*:\s*"([^"]+)"/);
          if (subMatch) {
            subMatch[1].split(",").forEach(function(s) {
              var sm = s.match(/\[([^\]]+)\](https?:\/\/[^\s,]+)/);
              if (sm) subtitles.push({ language: sm[1], url: sm[2] });
            });
          }

          var quality = d.url.indexOf("1080") !== -1 ? "1080p"
                      : d.url.indexOf("720") !== -1 ? "720p"
                      : "HD";

          var stream = {
            name: "DiziPal",
            title: quality,
            url: d.url,
            quality: quality,
            headers: {
              "Referer": iframeOrigin + "/",
              "Origin": iframeOrigin
            }
          };

          if (subtitles.length > 0) {
            stream.subtitles = subtitles;
          }

          return [stream];
        })
        .catch(function(e) {
          console.error("[DiziPal] Stream API hatasi: " + e.message);
          return [];
        });
    })
    .catch(function() { return []; });
}

// Ana fonksiyon
function getStreams(tmdbId, mediaType, season, episode) {
  console.log("[DiziPal] tmdb=" + tmdbId + " type=" + mediaType +
    (season ? " S" + season + "E" + episode : ""));

  return getTmdbInfo(tmdbId, mediaType)
    .then(function(info) {
      var trTitle = info.title;
      var enTitle = info.originalTitle;
      console.log("[DiziPal] TR=" + trTitle + " EN=" + enTitle);

      return searchSlug(trTitle, mediaType)
        .then(function(slug) {
          if (slug) return slug;
          return searchSlug(enTitle, mediaType);
        })
        .then(function(slug) {
          if (!slug) {
            slug = toSlug(enTitle || trTitle);
            console.log("[DiziPal] Slug tahmin: " + slug);
          } else {
            console.log("[DiziPal] Slug bulundu: " + slug);
          }

          var bolumUrl;
          if (mediaType === "movie") {
            bolumUrl = BASE_URL + "/film/" + slug + "/";
          } else {
            // Ornek: /bolum/phantom-lawyer-1-sezon-12-bolum-izle/
            bolumUrl = BASE_URL + "/bolum/" + slug + "-" + season + "-sezon-" + episode + "-bolum-izle/";
          }
          console.log("[DiziPal] Bolum URL: " + bolumUrl);

          return getIframeSrc(bolumUrl)
            .then(function(iframeSrc) {
              if (!iframeSrc) {
                console.log("[DiziPal] Iframe bulunamadi: " + bolumUrl);
                return [];
              }
              console.log("[DiziPal] Iframe: " + iframeSrc);
              return extractFromIframe(iframeSrc, bolumUrl);
            });
        });
    })
    .catch(function(e) {
      console.error("[DiziPal] Hata: " + (e.message || e));
      return [];
    });
}

module.exports = { getStreams: getStreams };
