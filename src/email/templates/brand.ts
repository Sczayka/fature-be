import { frontendUrl } from '../../common/utils/public-url.js';
import { DEFAULT_EMAIL_FROM_NAME } from '../email.constants.js';

/** Mesmos padrões do checkout (fature-fe/lib/constants/customization.ts). */
export const DEFAULT_BACKGROUND_COLOR = '#f5f5f5';
export const DEFAULT_BUTTON_COLOR = '#2bc4a0';

const DARK_TEXT = '#111827';
const LIGHT_TEXT = '#ffffff';
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/** O Outlook para desktop não exibe WebP: esses logos dão lugar ao nome da empresa. */
const EMAIL_LOGO_MIME_TYPES = /^image\/(png|jpeg)$/;

/** Visual do e-mail: o papel de parede do checkout é arte do fature-fe e fica de fora. */
export interface EmailBrand {
  name: string;
  logoUrl: string | null;
  backgroundColor: string;
  /** Cor do texto sobre o fundo (cabeçalho sem logo e rodapé). */
  backgroundTextColor: string;
  buttonColor: string;
  buttonTextColor: string;
}

/** Luminância relativa (WCAG) de uma cor #rrggbb: 0 = preto, 1 = branco. */
function relativeLuminance(hex: string): number {
  const [red, green, blue] = [1, 3, 5].map((start) => {
    const channel = parseInt(hex.slice(start, start + 2), 16) / 255;

    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });

  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

/** Cor em que texto claro tem mais contraste que texto escuro (igual a fature-fe/lib/utils/color.ts). */
export function isDarkColor(hex: string): boolean {
  return relativeLuminance(hex) < 0.179;
}

function contrastText(hex: string): string {
  return isDarkColor(hex) ? LIGHT_TEXT : DARK_TEXT;
}

function colorOr(value: string | null, fallback: string): string {
  return value && HEX_COLOR.test(value) ? value.toLowerCase() : fallback;
}

export function createBrand(input: {
  name: string;
  logoUrl: string | null;
  backgroundColor: string | null;
  buttonColor: string | null;
}): EmailBrand {
  const backgroundColor = colorOr(
    input.backgroundColor,
    DEFAULT_BACKGROUND_COLOR,
  );
  const buttonColor = colorOr(input.buttonColor, DEFAULT_BUTTON_COLOR);

  return {
    name: input.name,
    logoUrl: input.logoUrl,
    backgroundColor,
    backgroundTextColor: contrastText(backgroundColor),
    buttonColor,
    buttonTextColor: contrastText(buttonColor),
  };
}

export interface BrandOrganization {
  name: string;
  logo: string | null;
  backgroundColor: string | null;
  buttonColor: string | null;
  logoImage: { mimeType: string } | null;
}

/** Personalização da organização (aba Customização), a mesma do checkout. */
export function brandFromOrganization(
  organization: BrandOrganization,
): EmailBrand {
  const hasEmailLogo =
    !!organization.logo &&
    !!organization.logoImage &&
    EMAIL_LOGO_MIME_TYPES.test(organization.logoImage.mimeType);

  return createBrand({
    name: organization.name,
    logoUrl: hasEmailLogo ? organization.logo : null,
    backgroundColor: organization.backgroundColor,
    buttonColor: organization.buttonColor,
  });
}

/** Visual dos e-mails do próprio Fature (senha, verificação e convite). */
export function fatureBrand(): EmailBrand {
  return createBrand({
    name: DEFAULT_EMAIL_FROM_NAME,
    logoUrl: `${frontendUrl()}/logo.png`,
    backgroundColor: null,
    buttonColor: null,
  });
}
