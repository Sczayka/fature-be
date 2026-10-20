import { ValidateBy } from 'class-validator';
import { isPixKeyType, isValidPixKey } from '../utils/pix-key.js';

/** Chave Pix já normalizada (`pixKeyToNull`) válida para o tipo enviado junto (`pixKeyType`). */
export function IsPixKeyOfType() {
  return ValidateBy({
    name: 'isPixKeyOfType',
    validator: {
      validate: (value, args) => {
        const type = (args?.object as { pixKeyType?: unknown } | undefined)
          ?.pixKeyType;

        return (
          typeof value === 'string' &&
          isPixKeyType(type) &&
          isValidPixKey(type, value)
        );
      },
      defaultMessage: () =>
        'Informe uma chave Pix válida para o tipo escolhido',
    },
  });
}
