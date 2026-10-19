import { formatBRL } from '../../common/utils/format.js';
import type { RenderedEmail } from '../email.types.js';
import { sanitizeSubject } from '../sender.js';
import type { EmailBrand } from './brand.js';
import { escapeHtml, safeUrl } from './html.js';

/**
 * Layout em tabelas com estilos inline (o que os clientes de e-mail entendem). Cada bloco vira
 * HTML e texto puro: a versão em texto tem todos os links.
 */

const FONT_FAMILY =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const TEXT_COLOR = '#1f2937';
const MUTED_COLOR = '#6b7280';
const BORDER_COLOR = '#e5e7eb';
const MAX_ITEMS = 10;

export interface DetailRow {
  label: string;
  value: string;
}

export interface EmailItem {
  name: string;
  quantity: number;
  total: number;
}

export type EmailBlock =
  | { kind: 'heading'; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'note'; text: string }
  | { kind: 'details'; rows: DetailRow[] }
  | { kind: 'items'; items: EmailItem[] }
  | { kind: 'button'; label: string; url: string }
  | { kind: 'link'; label: string; url: string }
  | { kind: 'code'; label: string; value: string };

export const heading = (text: string): EmailBlock => ({
  kind: 'heading',
  text,
});

export const paragraph = (text: string): EmailBlock => ({
  kind: 'paragraph',
  text,
});

/** Texto menor e acinzentado (avisos e validade de links). */
export const note = (text: string): EmailBlock => ({ kind: 'note', text });

export const details = (rows: DetailRow[]): EmailBlock => ({
  kind: 'details',
  rows,
});

export const items = (list: EmailItem[]): EmailBlock | null =>
  list.length > 0 ? { kind: 'items', items: list } : null;

/** Botão principal; some se o link não for http(s). */
export function button(label: string, url: string | null): EmailBlock | null {
  const safe = safeUrl(url);

  return safe ? { kind: 'button', label, url: safe } : null;
}

export function link(label: string, url: string | null): EmailBlock | null {
  const safe = safeUrl(url);

  return safe ? { kind: 'link', label, url: safe } : null;
}

/** Valor para copiar, como a linha digitável do boleto. */
export const code = (label: string, value: string): EmailBlock => ({
  kind: 'code',
  label,
  value,
});

export interface EmailLayout {
  brand: EmailBrand;
  subject: string;
  /** Resumo exibido pela caixa de entrada ao lado do assunto. */
  preheader: string;
  blocks: Array<EmailBlock | null>;
  footer: string[];
}

export function renderEmail(layout: EmailLayout): RenderedEmail {
  const subject = sanitizeSubject(layout.subject);
  const blocks = layout.blocks.filter(
    (block): block is EmailBlock => block !== null,
  );

  return {
    subject,
    html: renderHtml({ ...layout, subject }, blocks),
    text: renderText(layout, blocks),
  };
}

function renderHtml(layout: EmailLayout, blocks: EmailBlock[]): string {
  const { brand } = layout;
  const footerColor =
    brand.backgroundTextColor === '#ffffff' ? '#e5e7eb' : MUTED_COLOR;
  const header = brand.logoUrl
    ? `<img src="${escapeHtml(brand.logoUrl)}" alt="${escapeHtml(brand.name)}" height="48" style="display:block;height:48px;width:auto;max-width:240px;border:0;outline:none;text-decoration:none;">`
    : `<span style="font-family:${FONT_FAMILY};font-size:22px;font-weight:700;color:${brand.backgroundTextColor};">${escapeHtml(brand.name)}</span>`;
  const footer = layout.footer
    .map((line) => `<p style="margin:0 0 6px;">${escapeHtml(line)}</p>`)
    .join('');

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(layout.subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:${brand.backgroundColor};">
<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;">${escapeHtml(layout.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${brand.backgroundColor};">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">
<tr><td align="center" style="padding:0 0 24px;">${header}</td></tr>
<tr><td style="background-color:#ffffff;border-radius:12px;padding:32px;font-family:${FONT_FAMILY};font-size:15px;line-height:1.6;color:${TEXT_COLOR};">
${blocks.map((block) => blockHtml(block, brand)).join('\n')}
</td></tr>
<tr><td align="center" style="padding:24px 16px 0;font-family:${FONT_FAMILY};font-size:12px;line-height:1.5;color:${footerColor};">${footer}</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

function blockHtml(block: EmailBlock, brand: EmailBrand): string {
  switch (block.kind) {
    case 'heading':
      return `<h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;color:#111827;">${escapeHtml(block.text)}</h1>`;

    case 'paragraph':
      return `<p style="margin:0 0 16px;">${escapeHtml(block.text)}</p>`;

    case 'note':
      return `<p style="margin:0 0 16px;font-size:13px;color:${MUTED_COLOR};">${escapeHtml(block.text)}</p>`;

    case 'details':
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;border-top:1px solid ${BORDER_COLOR};">${block.rows
        .map(
          (row) =>
            `<tr><td style="padding:10px 12px 10px 0;border-bottom:1px solid ${BORDER_COLOR};color:${MUTED_COLOR};font-size:14px;">${escapeHtml(row.label)}</td><td align="right" style="padding:10px 0;border-bottom:1px solid ${BORDER_COLOR};font-weight:600;font-size:14px;">${escapeHtml(row.value)}</td></tr>`,
        )
        .join('')}</table>`;

    case 'items': {
      const visible = block.items.slice(0, MAX_ITEMS);
      const hidden = block.items.length - visible.length;
      const rows = visible
        .map(
          (item) =>
            `<tr><td style="padding:8px 12px 8px 0;border-bottom:1px solid ${BORDER_COLOR};font-size:14px;">${escapeHtml(item.name)}</td><td align="center" style="padding:8px 12px;border-bottom:1px solid ${BORDER_COLOR};font-size:14px;color:${MUTED_COLOR};white-space:nowrap;">${item.quantity}x</td><td align="right" style="padding:8px 0;border-bottom:1px solid ${BORDER_COLOR};font-size:14px;white-space:nowrap;">${escapeHtml(formatBRL(item.total))}</td></tr>`,
        )
        .join('');
      const more =
        hidden > 0
          ? `<tr><td colspan="3" style="padding:8px 0;font-size:13px;color:${MUTED_COLOR};">${escapeHtml(moreItemsLabel(hidden))}</td></tr>`
          : '';

      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;"><tr><td colspan="3" style="padding:0 0 6px;font-size:13px;font-weight:600;color:${MUTED_COLOR};text-transform:uppercase;letter-spacing:0.04em;">Itens</td></tr>${rows}${more}</table>`;
    }

    case 'button':
      return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;"><tr><td align="center" bgcolor="${brand.buttonColor}" style="border-radius:8px;background-color:${brand.buttonColor};"><a href="${escapeHtml(block.url)}" target="_blank" style="display:inline-block;padding:12px 28px;font-family:${FONT_FAMILY};font-size:15px;font-weight:600;color:${brand.buttonTextColor};text-decoration:none;border-radius:8px;">${escapeHtml(block.label)}</a></td></tr></table>`;

    case 'link':
      return `<p style="margin:0 0 16px;font-size:14px;"><a href="${escapeHtml(block.url)}" target="_blank" style="color:${TEXT_COLOR};text-decoration:underline;">${escapeHtml(block.label)}</a></p>`;

    case 'code':
      return `<p style="margin:0 0 6px;font-size:13px;color:${MUTED_COLOR};">${escapeHtml(block.label)}</p><p style="margin:0 0 20px;padding:12px;background-color:#f3f4f6;border-radius:8px;font-family:Menlo,Consolas,monospace;font-size:13px;word-break:break-all;">${escapeHtml(block.value)}</p>`;
  }
}

function renderText(layout: EmailLayout, blocks: EmailBlock[]): string {
  const body = blocks.map(blockText).join('\n\n');

  return `${body}\n\n--\n${layout.footer.join('\n')}\n`;
}

function blockText(block: EmailBlock): string {
  switch (block.kind) {
    case 'heading':
    case 'paragraph':
    case 'note':
      return block.text;

    case 'details':
      return block.rows.map((row) => `${row.label}: ${row.value}`).join('\n');

    case 'items': {
      const visible = block.items.slice(0, MAX_ITEMS);
      const hidden = block.items.length - visible.length;
      const lines = visible.map(
        (item) =>
          `- ${item.name} (${item.quantity}x): ${formatBRL(item.total)}`,
      );

      return [
        'Itens:',
        ...lines,
        ...(hidden > 0 ? [moreItemsLabel(hidden)] : []),
      ].join('\n');
    }

    case 'button':
    case 'link':
      return `${block.label}: ${block.url}`;

    case 'code':
      return `${block.label}:\n${block.value}`;
  }
}

function moreItemsLabel(hidden: number): string {
  return hidden === 1 ? '+ 1 item' : `+ ${hidden} itens`;
}
