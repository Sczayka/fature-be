import { ValidationPipe } from '@nestjs/common';

/**
 * Valida e transforma o body nos DTOs decorados com class-validator.
 * Aplicado por controller (@UsePipes) para não afetar módulos cujos DTOs não têm decorators.
 */
export const PayloadValidationPipe = new ValidationPipe({
  whitelist: true,
  transform: true,
});
