import { Transform } from 'class-transformer';
import { IsIn, IsString, Length, Matches, ValidateIf } from 'class-validator';
import {
  HEX_COLOR_PATTERN,
  SLUG_MAX_LENGTH,
  SLUG_MIN_LENGTH,
  SLUG_PATTERN,
  WALLPAPERS,
  type Wallpaper,
} from '../customization.constants.js';

const normalize = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

/**
 * "Salvar modelo" da aba Customização: tudo de uma vez, com null voltando ao padrão do Fature.
 * O logo tem rotas próprias (upload de arquivo).
 */
export class UpdateCustomizationDto {
  @Transform(normalize)
  @IsString({ message: 'Informe a URL customizada' })
  @Length(SLUG_MIN_LENGTH, SLUG_MAX_LENGTH, {
    message: `A URL deve ter entre ${SLUG_MIN_LENGTH} e ${SLUG_MAX_LENGTH} caracteres`,
  })
  @Matches(SLUG_PATTERN, {
    message: 'URL inválida: use letras minúsculas, números e hífens',
  })
  slug: string;

  @ValidateIf((_dto, value) => value !== null)
  @IsIn(WALLPAPERS, { message: 'Papel de parede inválido' })
  wallpaper: Wallpaper | null;

  @Transform(normalize)
  @ValidateIf((_dto, value) => value !== null)
  @Matches(HEX_COLOR_PATTERN, {
    message: 'Cor de fundo inválida: use o formato #RRGGBB',
  })
  backgroundColor: string | null;

  @Transform(normalize)
  @ValidateIf((_dto, value) => value !== null)
  @Matches(HEX_COLOR_PATTERN, {
    message: 'Cor do botão inválida: use o formato #RRGGBB',
  })
  buttonColor: string | null;
}
