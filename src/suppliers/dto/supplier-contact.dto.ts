import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';
import {
  emailToNull,
  trim,
  trimToNull,
  unmaskToNull,
} from '../../common/dto/transforms.js';
import { PHONE_PATTERN } from '../suppliers.constants.js';

/** Pessoa de contato do fornecedor. Com id, atualiza a já cadastrada; sem id, cria. */
export class SupplierContactDto {
  @IsOptional()
  @IsString({ message: 'Contato inválido' })
  id?: string;

  @Transform(trim)
  @IsString({ message: 'Informe o nome do contato' })
  @IsNotEmpty({ message: 'Informe o nome do contato' })
  name: string;

  /** Cargo ou setor. */
  @Transform(trimToNull)
  @IsOptional()
  @IsString({ message: 'O cargo ou setor do contato deve ser um texto' })
  role?: string | null;

  @Transform(emailToNull)
  @IsOptional()
  @IsEmail({}, { message: 'E-mail do contato inválido' })
  email?: string | null;

  @Transform(unmaskToNull)
  @IsOptional()
  @Matches(PHONE_PATTERN, {
    message: 'Telefone do contato inválido: informe DDD e número',
  })
  phone?: string | null;

  @Transform(unmaskToNull)
  @IsOptional()
  @Matches(PHONE_PATTERN, {
    message: 'Celular do contato inválido: informe DDD e número',
  })
  mobile?: string | null;

  @IsOptional()
  @IsBoolean({ message: 'Informe se é o contato principal' })
  isMain?: boolean;
}
