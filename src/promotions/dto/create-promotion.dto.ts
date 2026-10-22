import { Transform } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Min,
} from 'class-validator';
import { IsOptionalNotNull } from '../../common/decorators/is-optional-not-null.decorator.js';
import { trim } from '../../common/dto/transforms.js';
import {
  IsOptionalDateOnly,
  IsPercentWithinLimit,
} from '../../invoices/dto/invoice-sections.dto.js';
import {
  AMOUNT_TYPES,
  PROMOTION_APPLICATIONS,
  type AmountType,
  type PromotionApplication,
} from '../../invoices/invoices.constants.js';

export class CreatePromotionDto {
  /** Único na organização sem diferenciar maiúsculas. */
  @Transform(trim)
  @IsString({ message: 'Informe o nome da promoção' })
  @IsNotEmpty({ message: 'Informe o nome da promoção' })
  name: string;

  @IsIn(AMOUNT_TYPES, {
    message: 'Tipo inválido: use FIXED (R$) ou PERCENTAGE (%)',
  })
  type: AmountType;

  @IsNumber({}, { message: 'O valor do desconto deve ser um número' })
  @IsPositive({ message: 'O valor do desconto deve ser maior que zero' })
  @IsPercentWithinLimit('type')
  value: number;

  @IsIn(PROMOTION_APPLICATIONS, {
    message:
      'Aplicação inválida: use UNIT (por unidade) ou TOTAL (no valor total)',
  })
  application: PromotionApplication;

  /** Teto do desconto na linha, em R$; null (ou ausente) = sem teto. */
  @IsOptional()
  @IsNumber({}, { message: 'O desconto máximo deve ser um número' })
  @IsPositive({ message: 'O desconto máximo deve ser maior que zero' })
  maxAmount?: number | null;

  /** Unidades da linha que a promoção atinge; null (ou ausente) = todas. */
  @IsOptional()
  @IsInt({ message: 'A quantidade máxima deve ser um número inteiro' })
  @Min(1, { message: 'A quantidade máxima deve ser de pelo menos 1' })
  maxQuantity?: number | null;

  /** Primeiro dia (YYYY-MM-DD); vazio ou null = já vale. */
  @IsOptionalDateOnly()
  startsAt?: string | null;

  /** Último dia, inclusive (YYYY-MM-DD); vazio ou null = sem prazo. */
  @IsOptionalDateOnly()
  endsAt?: string | null;

  /** Ausente no cadastro: ativa. */
  @IsOptionalNotNull()
  @IsBoolean({ message: 'Informe se a promoção está ativa' })
  active?: boolean;

  /** Produtos e serviços em que a promoção pode ser usada; substitui a lista no update. */
  @IsArray({ message: 'Envie os itens atendidos em uma lista' })
  @ArrayMinSize(1, { message: 'Escolha pelo menos um produto ou serviço' })
  @ArrayUnique({ message: 'O mesmo item aparece mais de uma vez' })
  @IsString({ each: true, message: 'Item inválido' })
  itemIds: string[];
}
