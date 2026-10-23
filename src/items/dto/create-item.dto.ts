import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { IsOptionalNotNull } from '../../common/decorators/is-optional-not-null.decorator.js';
import { trim, trimToNull } from '../../common/dto/transforms.js';
import {
  ITEM_TYPES,
  type ItemType,
} from '../../invoices/invoices.constants.js';
import { STOCK_QUANTITY_MAX } from '../../stock/stock.constants.js';
import { ItemSupplierDto } from './item-supplier.dto.js';

export class CreateItemDto {
  @Transform(trim)
  @IsString({ message: 'Informe o nome' })
  @IsNotEmpty({ message: 'Informe o nome' })
  name: string;

  @IsIn(ITEM_TYPES, {
    message: 'Tipo inválido: use product (produto) ou service (serviço)',
  })
  type: ItemType;

  @IsNumber({}, { message: 'O preço deve ser um número' })
  @IsPositive({ message: 'O preço deve ser maior que zero' })
  price: number;

  /**
   * Só produto: o saldo inicial, gravado como a primeira entrada do estoque. Ausente no cadastro:
   * zero. Depois do cadastro, o saldo muda só pelas movimentações.
   */
  @IsOptionalNotNull()
  @IsInt({ message: 'O estoque deve ser um número inteiro' })
  @Min(0, { message: 'O estoque não pode ser negativo' })
  @Max(STOCK_QUANTITY_MAX, {
    message: `O estoque deve ser de no máximo ${STOCK_QUANTITY_MAX}`,
  })
  stock?: number;

  /** Só produto: com o saldo nele ou abaixo, o produto entra no alerta de reposição; null = sem alerta. */
  @IsOptional()
  @IsInt({ message: 'O estoque mínimo deve ser um número inteiro' })
  @Min(0, { message: 'O estoque mínimo não pode ser negativo' })
  @Max(STOCK_QUANTITY_MAX, {
    message: `O estoque mínimo deve ser de no máximo ${STOCK_QUANTITY_MAX}`,
  })
  minStock?: number | null;

  @IsOptional()
  @IsString({ message: 'A descrição deve ser um texto' })
  description?: string | null;

  /** Só produto; null (ou vazio) tira a marca. */
  @Transform(trimToNull)
  @IsOptional()
  @IsString({ message: 'Marca inválida' })
  brandId?: string | null;

  /** Substitui os fornecedores do item; [] remove todos. */
  @IsOptionalNotNull()
  @IsArray({ message: 'Envie os fornecedores em uma lista' })
  @ValidateNested({ each: true })
  @Type(() => ItemSupplierDto)
  suppliers?: ItemSupplierDto[];
}
