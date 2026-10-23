import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsOptional,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  SERIES_MAX_SIZE,
  SERIES_TYPES,
  type SeriesType,
} from '../../financial.constants.js';
import { IsDay, IsFinancialAmount } from '../../dto/financial-validators.js';
import { PayPayableDto } from './pay-payable.dto.js';
import { PayableFieldsDto } from './payable-fields.dto.js';

/** Um vencimento da conta: a única, uma parcela ou um mês da recorrência. */
export class PayableInstallmentDto {
  @IsDay('o vencimento')
  dueDate: string;

  @IsFinancialAmount()
  amount: number;
}

/**
 * POST /financial/payables: uma conta para cada vencimento. Com mais de um, as contas formam uma
 * série (parcelas de uma compra ou recorrência mensal), numeradas na ordem enviada.
 */
export class CreatePayableDto extends PayableFieldsDto {
  @IsArray({ message: 'Envie os vencimentos em uma lista' })
  @ArrayMinSize(1, { message: 'Informe o vencimento e o valor' })
  @ArrayMaxSize(SERIES_MAX_SIZE, {
    message: `A série vai até ${SERIES_MAX_SIZE} vencimentos`,
  })
  @ValidateNested({ each: true })
  @Type(() => PayableInstallmentDto)
  installments: PayableInstallmentDto[];

  /** Obrigatório com mais de um vencimento. */
  @ValidateIf(
    (dto: CreatePayableDto) =>
      Array.isArray(dto.installments) && dto.installments.length > 1,
  )
  @IsIn(SERIES_TYPES, {
    message:
      'Informe se são parcelas (INSTALLMENTS) ou recorrência mensal (RECURRING)',
  })
  seriesType?: SeriesType;

  /** Conta única já paga: o pagamento é registrado junto. */
  @IsOptional()
  @ValidateNested()
  @Type(() => PayPayableDto)
  payment?: PayPayableDto | null;
}
