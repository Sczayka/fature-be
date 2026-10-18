/** URL pública do backend, base dos links que saem do Fature (ex.: o logo das organizações). */
export function backendPublicUrl(): string {
  return (
    process.env.BACKEND_PUBLIC_URL ||
    process.env.BETTER_AUTH_URL ||
    'http://localhost:3000'
  ).replace(/\/$/, '');
}
