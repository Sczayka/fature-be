/** URL pública do backend, base dos links que saem do Fature (ex.: o logo das organizações). */
export function backendPublicUrl(): string {
  return (
    process.env.BACKEND_PUBLIC_URL ||
    process.env.BETTER_AUTH_URL ||
    'http://localhost:3000'
  ).replace(/\/$/, '');
}

/** URL do fature-fe, base das páginas abertas pelos links do Fature (checkout, e-mails). */
export function frontendUrl(): string {
  return (process.env.FRONTEND_URL || 'http://localhost:5173').replace(
    /\/$/,
    '',
  );
}
