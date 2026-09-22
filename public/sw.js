// The root page is build-time, anonymous HTML. Private data lives in account-scoped
// IndexedDB; auth, APIs, RSC requests, and Drive traffic never enter this cache.
const CACHE = "gropbox-shell-v4";
let refreshing;
async function asset(cache, request) {
  const saved = await cache.match(request);
  if (saved) return saved;
  const response = await fetch(request);
  if (!response.ok || response.redirected || response.headers.get("content-type")?.includes("text/html")) throw new Error("Asset unavailable");
  await cache.put(request, response.clone());
  return response;
}
function refreshShell(cache) {
  if (!refreshing) refreshing = (async () => {
    const response = await fetch(new URL("/", self.location.origin), { credentials: "omit", redirect: "error", cache: "no-cache", signal: AbortSignal.timeout(8000) });
    if (!response.ok || response.headers.get("X-GropBox-Shell") !== "public" || !response.headers.get("content-type")?.includes("text/html")) throw new Error("App unavailable");
    const html = await response.clone().text();
    const paths = [...new Set([...html.matchAll(/(?:src|href)="(\/_next\/static\/[^\"]+)"/g)].map(match => match[1].replaceAll("&amp;", "&")))];
    if (!paths.length) throw new Error("App assets unavailable");
    // Publish HTML only after its boot assets are available, so a failed update
    // cannot replace a usable offline shell with one referencing missing chunks.
    await Promise.all(paths.map(path => asset(cache, new Request(new URL(path, self.location.origin), { credentials: "omit", signal: AbortSignal.timeout(8000) }))));
    await cache.put("/", response.clone());
    return response;
  })().finally(() => { refreshing = undefined; });
  return refreshing;
}
self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(["/offline.html", "/gropbox-mark.png", "/gropbox-icon.png", "/gropbox-apple-icon.png"]);
    await refreshShell(cache).catch(() => console.warn("App cache will retry when reachable."));
    await self.skipWaiting();
  })());
});
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith("gropbox-shell-") && key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/_next/static/") || ["/gropbox-mark.png", "/gropbox-icon.png", "/gropbox-apple-icon.png"].includes(url.pathname)) {
    event.respondWith(caches.open(CACHE).then(cache => asset(cache, event.request)));
  } else if (event.request.mode === "navigate" && url.pathname === "/") {
    const cache = caches.open(CACHE);
    const fresh = cache.then(refreshShell);
    event.waitUntil(fresh.catch(() => console.warn("App unreachable; keeping the cached shell.")));
    event.respondWith(cache.then(async store => (await store.match("/")) ?? await fresh.catch(async () => (await store.match("/offline.html")) ?? Response.error())));
  }
});
