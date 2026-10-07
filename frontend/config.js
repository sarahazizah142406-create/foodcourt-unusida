// Alamat backend. Diatur otomatis:
//  - dibuka dari server backend sendiri (port 3000 / Render) -> pakai alamat yang sama
//  - dibuka lokal / jaringan LAN -> http://<host>:3000
//  - dibuka dari hosting frontend terpisah (Vercel, dll) -> PRODUCTION_API di bawah
// Setelah backend di-deploy, ganti PRODUCTION_API dengan URL service Render kamu.
(function () {
  if (window.FOODCOURT_API_BASE) return;

  var PRODUCTION_API = "https://foodcourt-api.onrender.com";
  var loc = window.location;
  var host = loc.hostname;

  var isPrivateHost =
    host === "localhost" || host === "127.0.0.1" ||
    /^192\.168\./.test(host) || /^10\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host);

  if (loc.protocol === "file:") {
    window.FOODCOURT_API_BASE = "http://localhost:3000";
  } else if (loc.port === "3000" || /onrender\.com$/.test(host)) {
    window.FOODCOURT_API_BASE = loc.origin;
  } else if (isPrivateHost) {
    window.FOODCOURT_API_BASE = "http://" + host + ":3000";
  } else {
    window.FOODCOURT_API_BASE = PRODUCTION_API;
  }
})();
