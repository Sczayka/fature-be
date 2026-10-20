import PDFDocument from 'pdfkit';
import { roundCurrency } from '../../common/utils/currency.js';
import {
  formatBRL,
  formatDateBR,
  formatInstantDateBR,
} from '../../common/utils/format.js';
import type { QuoteDocument, QuoteLine } from './quote-document.js';

const MARGIN = 48;
const FOOTER_HEIGHT = 36;
const CELL_PADDING = 8;
const LOGO_BOX: [number, number] = [160, 56];

const FONT = { regular: 'Helvetica', bold: 'Helvetica-Bold' };
const COLOR = {
  text: '#111827',
  muted: '#6b7280',
  border: '#e5e7eb',
  tableHeader: '#f3f4f6',
};

/** Glifos fora do Latin-1 que a codificação WinAnsi das fontes padrão do PDF tem (–, —, “, ”, •, € etc.). */
const WIN_ANSI_EXTRA = new Set([
  338, 339, 352, 353, 376, 381, 382, 402, 710, 732, 8211, 8212, 8216, 8217,
  8218, 8220, 8221, 8222, 8224, 8225, 8226, 8230, 8240, 8249, 8250, 8364, 8482,
]);

interface TextStyle {
  font: string;
  size: number;
  color: string;
  align: 'left' | 'right';
}

const BODY: TextStyle = {
  font: FONT.regular,
  size: 10,
  color: COLOR.text,
  align: 'left',
};
const LABEL: TextStyle = {
  font: FONT.bold,
  size: 8,
  color: COLOR.muted,
  align: 'left',
};

interface TableColumn {
  title: string;
  width: number;
  value: (line: QuoteLine) => string;
}

/**
 * As fontes padrão do PDF só têm os caracteres WinAnsi: os demais perdem o acento ou saem do
 * texto (ex.: emojis no nome de um item), em vez de virarem símbolos quebrados.
 */
export function pdfText(value: string): string {
  return [...value.normalize('NFC')]
    .map((char) => {
      if (isWinAnsi(char)) return char;

      const base = char.normalize('NFD').replace(/[̀-ͯ]/g, '');

      return [...base].every(isWinAnsi) ? base : '';
    })
    .join('');
}

function isWinAnsi(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;

  return code <= 0xff || WIN_ANSI_EXTRA.has(code);
}

function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 60)
    .replace(/^-+|-+$/g, '');
}

/** Nome do arquivo (ASCII, vai no Content-Disposition e no anexo do e-mail). */
export function quotePdfFilename(quote: QuoteDocument): string {
  const slug = slugify(quote.client.name ?? quote.organization.name);

  return slug ? `orcamento-${slug}.pdf` : 'orcamento.pdf';
}

/** PDF do orçamento: o que o cliente recebe no e-mail e o que a empresa baixa no detalhe. */
export function renderQuotePdf(quote: QuoteDocument): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    margin: MARGIN,
    bufferPages: true,
    info: {
      Title: `Orçamento de ${quote.organization.name}`,
      Author: quote.organization.name,
      Creator: 'Fature',
    },
  });

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];

    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    try {
      new QuotePdfLayout(doc, quote).draw();
      doc.end();
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

/** Desenha o orçamento de cima para baixo; `y` é a posição atual na página. */
class QuotePdfLayout {
  private y = MARGIN;

  constructor(
    private readonly doc: PDFKit.PDFDocument,
    private readonly quote: QuoteDocument,
  ) {}

  private get left(): number {
    return this.doc.page.margins.left;
  }

  private get width(): number {
    const { margins } = this.doc.page;

    return this.doc.page.width - margins.left - margins.right;
  }

  /** Limite do conteúdo: abaixo fica o rodapé. */
  private get bottom(): number {
    return this.doc.page.height - MARGIN - FOOTER_HEIGHT;
  }

  draw(): void {
    this.drawHeader();
    this.drawParties();
    this.drawDescription();
    this.drawItems();
    this.drawTotals();
    this.drawConditions();
    this.drawFooters();
  }

  private drawHeader(): void {
    const { doc, quote } = this;

    doc.rect(0, 0, doc.page.width, 6).fill(quote.organization.accentColor);

    const brandHeight = this.drawBrand();

    this.write('ORÇAMENTO', this.left, this.y, this.width, {
      ...BODY,
      font: FONT.bold,
      size: 20,
      align: 'right',
    });
    this.write(
      `Emitido em ${formatInstantDateBR(quote.issuedAt)}`,
      this.left,
      this.y + 26,
      this.width,
      { ...BODY, size: 9, color: COLOR.muted, align: 'right' },
    );

    this.y += Math.max(brandHeight, 40) + 28;
  }

  /** Logo da empresa ou, sem um logo que o PDF embuta, o nome. Devolve a altura usada. */
  private drawBrand(): number {
    const { logo, name } = this.quote.organization;

    if (logo) {
      try {
        this.doc.image(logo, this.left, this.y, { fit: LOGO_BOX });

        return LOGO_BOX[1];
      } catch {
        // Imagem que o pdfkit não lê: segue com o nome
      }
    }

    return this.write(name, this.left, this.y, this.width * 0.55, {
      ...BODY,
      font: FONT.bold,
      size: 16,
    });
  }

  private drawParties(): void {
    const { organization, client } = this.quote;
    const gap = 24;
    const columnWidth = (this.width - gap) / 2;

    const fromHeight = this.drawParty(
      'DE',
      organization.name,
      [organization.document, organization.email, organization.phone],
      this.left,
      columnWidth,
    );
    const toHeight = this.drawParty(
      'PARA',
      client.name ?? 'Cliente não informado',
      [client.document, client.email, client.phone],
      this.left + columnWidth + gap,
      columnWidth,
    );

    this.y += Math.max(fromHeight, toHeight) + 24;
  }

  private drawParty(
    label: string,
    name: string,
    details: (string | null)[],
    x: number,
    width: number,
  ): number {
    let y = this.y;

    y += this.write(label, x, y, width, LABEL) + 4;
    y += this.write(name, x, y, width, { ...BODY, font: FONT.bold, size: 11 });

    for (const detail of details) {
      if (!detail) continue;

      y +=
        this.write(detail, x, y + 2, width, {
          ...BODY,
          size: 9,
          color: COLOR.muted,
        }) + 2;
    }

    return y - this.y;
  }

  private drawDescription(): void {
    const { description } = this.quote;

    if (!description) return;

    this.ensureSpace(
      this.measure('DESCRIÇÃO', this.width, LABEL) +
        this.measure(description, this.width, BODY) +
        4,
    );

    this.y += this.write('DESCRIÇÃO', this.left, this.y, this.width, LABEL) + 4;
    this.y += this.write(description, this.left, this.y, this.width, BODY) + 24;
  }

  private drawItems(): void {
    const hasDiscount = this.quote.lines.some((line) => line.discount > 0);
    const numericColumns: TableColumn[] = [
      { title: 'QTD.', width: 40, value: (line) => String(line.quantity) },
      {
        title: 'VALOR UNIT.',
        width: 84,
        value: (line) => formatBRL(line.unitPrice),
      },
      ...(hasDiscount
        ? [
            {
              title: 'DESCONTO',
              width: 84,
              value: (line: QuoteLine) =>
                line.discount > 0 ? `- ${formatBRL(line.discount)}` : '—',
            },
          ]
        : []),
      {
        title: 'TOTAL',
        width: 88,
        value: (line) => formatBRL(roundCurrency(line.total - line.discount)),
      },
    ];
    const nameWidth =
      this.width -
      numericColumns.reduce((total, column) => total + column.width, 0);
    const columns: TableColumn[] = [
      { title: 'ITEM', width: nameWidth, value: (line) => line.name },
      ...numericColumns,
    ];

    this.drawTableHeader(columns);

    for (const line of this.quote.lines) {
      const rowHeight =
        Math.max(
          this.measure(line.name, nameWidth - CELL_PADDING * 2, BODY),
          12,
        ) +
        CELL_PADDING * 2;

      if (this.ensureSpace(rowHeight)) this.drawTableHeader(columns);

      let x = this.left;

      columns.forEach((column, index) => {
        this.write(
          column.value(line),
          x + CELL_PADDING,
          this.y + CELL_PADDING,
          column.width - CELL_PADDING * 2,
          { ...BODY, align: index === 0 ? 'left' : 'right' },
        );
        x += column.width;
      });

      this.y += rowHeight;
      this.drawRule(this.y, COLOR.border, 0.75);
    }

    this.y += 16;
  }

  private drawTableHeader(columns: TableColumn[]): void {
    const height = 24;

    this.ensureSpace(height);
    this.doc
      .rect(this.left, this.y, this.width, height)
      .fill(COLOR.tableHeader);

    let x = this.left;

    columns.forEach((column, index) => {
      this.write(
        column.title,
        x + CELL_PADDING,
        this.y + 8,
        column.width - CELL_PADDING * 2,
        { ...LABEL, align: index === 0 ? 'left' : 'right' },
      );
      x += column.width;
    });

    this.y += height;
  }

  private drawTotals(): void {
    const { subtotal, itemsDiscount, total } = this.quote;
    const boxWidth = 240;
    const x = this.left + this.width - boxWidth;
    const rows =
      itemsDiscount > 0
        ? [
            ['Subtotal', formatBRL(subtotal)],
            ['Descontos', `- ${formatBRL(itemsDiscount)}`],
          ]
        : [];

    this.ensureSpace(rows.length * 18 + 40);

    for (const [label, value] of rows) {
      this.write(label, x, this.y, boxWidth, { ...BODY, color: COLOR.muted });
      this.write(value, x, this.y, boxWidth, { ...BODY, align: 'right' });
      this.y += 18;
    }

    this.doc
      .moveTo(x, this.y)
      .lineTo(x + boxWidth, this.y)
      .lineWidth(1.5)
      .strokeColor(this.quote.organization.accentColor)
      .stroke();
    this.y += 10;

    const totalStyle = { ...BODY, font: FONT.bold, size: 13 };

    this.write('Total', x, this.y, boxWidth, totalStyle);
    this.write(formatBRL(total), x, this.y, boxWidth, {
      ...totalStyle,
      align: 'right',
    });
    this.y += 40;
  }

  private drawConditions(): void {
    const { dueDate, paymentMethods, lateCharges } = this.quote;
    const lines = [
      ...(dueDate ? [`Vencimento previsto: ${formatDateBR(dueDate)}`] : []),
      ...(paymentMethods.length > 0
        ? [
            `Formas de pagamento: ${paymentMethods.map((method) => method.label).join(', ')}`,
          ]
        : []),
      ...paymentMethods
        .filter((method) => method.discount > 0)
        .map(
          (method) =>
            `${method.label}: desconto de ${formatBRL(method.discount)}${
              method.discountUntil
                ? ` para pagamento até ${formatDateBR(method.discountUntil)}`
                : ''
            }`,
        ),
      ...(lateCharges ? [lateCharges] : []),
    ];

    if (lines.length === 0) return;

    const style = { ...BODY, size: 9.5 };

    this.ensureSpace(this.measure('CONDIÇÕES', this.width, LABEL) + 4 + 16);
    this.y += this.write('CONDIÇÕES', this.left, this.y, this.width, LABEL) + 6;

    for (const line of lines) {
      this.ensureSpace(this.measure(line, this.width, style));
      this.y += this.write(line, this.left, this.y, this.width, style) + 4;
    }
  }

  /** Rodapé de todas as páginas, desenhado no fim (o total de páginas só é conhecido aí). */
  private drawFooters(): void {
    const { doc, quote } = this;
    const contacts = [quote.organization.email, quote.organization.phone]
      .filter(Boolean)
      .join(' · ');
    const note = `Este orçamento não é uma cobrança. Para aprovar ou tirar dúvidas, fale com ${quote.organization.name}${contacts ? `: ${contacts}` : ''}.`;
    const range = doc.bufferedPageRange();
    const style = { ...BODY, size: 8, color: COLOR.muted };

    for (let index = 0; index < range.count; index++) {
      doc.switchToPage(range.start + index);

      // Texto abaixo da margem inferior faria o pdfkit abrir uma página nova
      const bottomMargin = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;

      const y = doc.page.height - MARGIN - 20;

      this.drawRule(y - 10, COLOR.border, 0.75);
      this.write(note, this.left, y, this.width - 80, style);
      this.write(
        `Página ${index + 1} de ${range.count}`,
        this.left,
        y,
        this.width,
        { ...style, align: 'right' },
      );

      doc.page.margins.bottom = bottomMargin;
    }
  }

  /** Abre uma página nova se o bloco não couber nesta. Devolve se abriu. */
  private ensureSpace(height: number): boolean {
    if (this.y + height <= this.bottom) return false;

    this.doc.addPage();
    this.y = MARGIN;

    return true;
  }

  private drawRule(y: number, color: string, lineWidth: number): void {
    this.doc
      .moveTo(this.left, y)
      .lineTo(this.left + this.width, y)
      .lineWidth(lineWidth)
      .strokeColor(color)
      .stroke();
  }

  private applyStyle(style: TextStyle): void {
    this.doc.font(style.font).fontSize(style.size).fillColor(style.color);
  }

  private measure(text: string, width: number, style: TextStyle): number {
    this.applyStyle(style);

    return this.doc.heightOfString(pdfText(text), { width });
  }

  /** Escreve o texto em (x, y) e devolve a altura ocupada. */
  private write(
    text: string,
    x: number,
    y: number,
    width: number,
    style: TextStyle,
  ): number {
    const content = pdfText(text);

    this.applyStyle(style);
    this.doc.text(content, x, y, { width, align: style.align });

    return this.doc.heightOfString(content, { width });
  }
}
