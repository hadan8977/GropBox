// Bound database/auth requests, including blackholed networks; Drive transfers use separate limits.
export const supabaseFetch: typeof fetch = (input, init) => fetch(input, {
  ...init,
  signal: init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
});
