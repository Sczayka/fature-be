import { Transform } from 'class-transformer';
import { IsEmail, IsOptional, MaxLength } from 'class-validator';

/** Envio manual: sem `to`, vai para o e-mail do cliente. */
export class SendEmailDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() || undefined : value,
  )
  @IsOptional()
  @IsEmail({}, { message: 'E-mail do destinatário inválido' })
  @MaxLength(254, { message: 'E-mail do destinatário inválido' })
  to?: string;
}
