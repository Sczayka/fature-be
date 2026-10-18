import type { Prisma } from '@prisma/client';

/** Papéis de parede das páginas enviadas aos clientes (as artes ficam no fature-fe). */
export const WALLPAPERS = ['WAVES', 'TOPOGRAPHIC', 'ARCS', 'LETTERS'] as const;

export type Wallpaper = (typeof WALLPAPERS)[number];

/** Cores sempre gravadas como #rrggbb (o DTO converte para minúsculas). */
export const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/;

/** URL customizada: letras minúsculas e números, com hífens só entre eles. */
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SLUG_MIN_LENGTH = 3;
/** Limite de um rótulo de subdomínio, caso a URL vire subdomínio. */
export const SLUG_MAX_LENGTH = 63;

/** O fature-fe envia o logo já recortado (256 px); o limite só barra abusos. */
export const LOGO_MAX_BYTES = 512 * 1024;
/** Conferido pelos bytes do arquivo, não pelo tipo informado pelo navegador. */
export const LOGO_MIME_TYPES = /^image\/(png|jpeg|webp)$/;

export const CUSTOMIZATION_SELECT = {
  name: true,
  slug: true,
  logo: true,
  wallpaper: true,
  backgroundColor: true,
  buttonColor: true,
} satisfies Prisma.OrganizationSelect;
