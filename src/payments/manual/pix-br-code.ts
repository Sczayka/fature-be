import QRCode from 'qrcode';

/**
 * PIX copia e cola estático (BR Code) com a chave da empresa, no formato EMV do Manual de Padrões
 * para Iniciação do Pix (BCB). Sem provedor: o dinheiro vai direto para a conta da chave.
 */
export interface StaticPixInput {
  /** Já normalizada (normalizePixKey). */
  key: string;
  /** Nome do titular. */
  merchantName: string;
  /** PIX_MERCHANT_CITY */
  merchantCity: string;
  /** null = o pagador digita o valor. */
  amount: number | null;
  /** '***' (sem identificador). */
  txid: string;
}

const MERCHANT_NAME_MAX_LENGTH = 25;
const MERCHANT_CITY_MAX_LENGTH = 15;
const DATA_URL_PREFIX = 'data:image/png;base64,';

export function buildStaticPixPayload(input: StaticPixInput): string {
  const payload = [
    field('00', '01'),
    field('26', field('00', 'br.gov.bcb.pix') + field('01', input.key)),
    field('52', '0000'),
    field('53', '986'),
    input.amount === null ? '' : field('54', input.amount.toFixed(2)),
    field('58', 'BR'),
    field('59', emvText(input.merchantName, MERCHANT_NAME_MAX_LENGTH)),
    field('60', emvText(input.merchantCity, MERCHANT_CITY_MAX_LENGTH)),
    field('62', field('05', input.txid)),
    // O CRC é calculado sobre o texto inteiro, já com o ID e o tamanho dele
    '6304',
  ].join('');

  return `${payload}${crc16(payload)}`;
}

/** PNG em base64, sem o prefixo data: (o mesmo formato do qrCodeImage do PIX do provedor). */
export async function pixQrCodeImage(payload: string): Promise<string> {
  const dataUrl = await QRCode.toDataURL(payload, { margin: 1, width: 256 });

  return dataUrl.slice(DATA_URL_PREFIX.length);
}

/** ID (2 dígitos) + tamanho (2 dígitos) + valor. */
function field(id: string, value: string): string {
  return `${id}${String(value.length).padStart(2, '0')}${value}`;
}

/** Sem acentos e só com letras, números e espaços, como os bancos esperam no nome e na cidade. */
function emvText(value: string, maxLength: number): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
    .trim();
}

/** CRC16-CCITT-FALSE: polinômio 0x1021, valor inicial 0xFFFF, sem reflexão. */
function crc16(payload: string): string {
  let crc = 0xffff;

  for (const byte of Buffer.from(payload, 'utf8')) {
    crc ^= byte << 8;

    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }

  return crc.toString(16).toUpperCase().padStart(4, '0');
}
