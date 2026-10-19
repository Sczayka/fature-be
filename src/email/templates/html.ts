const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Todo valor que entra no HTML passa por aqui (nomes, descrições e itens vêm dos usuários). */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);
}

/** Só links http(s): um `javascript:` vindo de dados externos não vira botão. */
export function safeUrl(value: string | null): string | null {
  if (!value) return null;

  try {
    const url = new URL(value);

    return url.protocol === 'https:' || url.protocol === 'http:'
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}
