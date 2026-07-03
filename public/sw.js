// Service worker minimal : ne met rien en cache, sert uniquement à rendre
// l'application installable (critère PWA) sans risquer de servir du contenu
// périmé (photos, API Supabase/Stripe...).
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request));
});
