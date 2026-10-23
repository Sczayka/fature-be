import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  type ValidationArguments,
} from 'class-validator';
import { trimToNull } from '../../common/dto/transforms.js';
import {
  MANUAL_STOCK_MOVEMENT_TYPES,
  STOCK_MOVEMENT_TYPE,
  STOCK_NOTES_MAX_LENGTH,
  STOCK_QUANTITY_MAX,
  type ManualStockMovementType,
} from '../stock.constants.js';

const isAdjustment = (dto: CreateStockMovementDto) =>
  dto.type === STOCK_MOVEMENT_TYPE.ADJUSTMENT;

/** Ajuste sem motivo; nos outros tipos, a observação é opcional. */
const notesMessage = ({ object }: ValidationArguments) =>
  isAdjustment(object as CreateStockMovementDto)
    ? 'Informe o motivo do ajuste'
    : 'A observação deve ser um texto';

/**
 * POST /items/:itemId/stock-movements: entrada e devolução somam `quantity` ao saldo; o ajuste
 * troca o saldo pelo contado (`balance`) e grava a diferença.
 */
export class CreateStockMovementDto {
  @IsIn(MANUAL_STOCK_MOVEMENT_TYPES, {
    message:
      'Tipo inválido: use ENTRY (entrada), RETURN (devolução) ou ADJUSTMENT (ajuste)',
  })
  type: ManualStockMovementType;

  /** Entrada e devolução: as unidades que voltam ao estoque. */
  @ValidateIf((dto: CreateStockMovementDto) => !isAdjustment(dto))
  @IsInt({ message: 'A quantidade deve ser um número inteiro' })
  @Min(1, { message: 'A quantidade deve ser maior que zero' })
  @Max(STOCK_QUANTITY_MAX, {
    message: `A quantidade deve ser de no máximo ${STOCK_QUANTITY_MAX}`,
  })
  quantity?: number;

  /** Ajuste: o saldo contado, que passa a ser o do estoque. */
  @ValidateIf(isAdjustment)
  @IsInt({ message: 'O saldo contado deve ser um número inteiro' })
  @Min(0, { message: 'O saldo contado não pode ser negativo' })
  @Max(STOCK_QUANTITY_MAX, {
    message: `O saldo contado deve ser de no máximo ${STOCK_QUANTITY_MAX}`,
  })
  balance?: number;

  /** Obrigatória no ajuste (o motivo); vazia vira null. */
  @Transform(trimToNull)
  @ValidateIf(
    (dto: CreateStockMovementDto) => isAdjustment(dto) || dto.notes != null,
  )
  @IsString({ message: notesMessage })
  @IsNotEmpty({ message: notesMessage })
  @MaxLength(STOCK_NOTES_MAX_LENGTH, {
    message: `A observação deve ter no máximo ${STOCK_NOTES_MAX_LENGTH} caracteres`,
  })
  notes?: string | null;
}
