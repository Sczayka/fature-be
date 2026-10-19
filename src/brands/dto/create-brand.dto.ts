import { Transform } from 'class-transformer';
import { IsBoolean, IsNotEmpty, IsString } from 'class-validator';
import { IsOptionalNotNull } from '../../common/decorators/is-optional-not-null.decorator.js';
import { trim } from '../../common/dto/transforms.js';

export class CreateBrandDto {
  /** Único na organização sem diferenciar maiúsculas. */
  @Transform(trim)
  @IsString({ message: 'Informe o nome da marca' })
  @IsNotEmpty({ message: 'Informe o nome da marca' })
  name: string;

  /** Ausente no cadastro: ativa. */
  @IsOptionalNotNull()
  @IsBoolean({ message: 'Informe se a marca está ativa' })
  active?: boolean;
}
