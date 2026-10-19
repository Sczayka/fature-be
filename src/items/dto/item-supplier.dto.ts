import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { trimToNull } from '../../common/dto/transforms.js';

/** Fornecedor do item: o código e o preço de compra valem só para ele. */
export class ItemSupplierDto {
  @IsString({ message: 'Informe o fornecedor' })
  @IsNotEmpty({ message: 'Informe o fornecedor' })
  supplierId: string;

  /** Código do item no fornecedor. */
  @Transform(trimToNull)
  @IsOptional()
  @IsString({ message: 'O código no fornecedor deve ser um texto' })
  supplierCode?: string | null;

  /** Arredondado em 2 casas como o preço do item. */
  @IsOptional()
  @IsNumber({}, { message: 'O preço de compra deve ser um número' })
  @Min(0, { message: 'O preço de compra não pode ser negativo' })
  purchasePrice?: number | null;

  @IsOptional()
  @IsBoolean({ message: 'Informe se é o fornecedor principal' })
  isMain?: boolean;
}
