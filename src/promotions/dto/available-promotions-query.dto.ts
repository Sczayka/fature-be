import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsString } from 'class-validator';
import { AVAILABLE_PROMOTIONS_MAX_ITEMS } from '../promotions.constants.js';

/** Ids separados por vírgula ("a,b") ou repetidos na query (itemIds=a&itemIds=b). */
const toIdList = ({ value }: { value: unknown }) => {
  const values = Array.isArray(value) ? value : [value];

  return values
    .flatMap((entry) => (typeof entry === 'string' ? entry.split(',') : []))
    .map((id) => id.trim())
    .filter(Boolean);
};

/** GET /promotions/available: os itens da cobrança. */
export class AvailablePromotionsQueryDto {
  @Transform(toIdList)
  @IsArray()
  @ArrayMaxSize(AVAILABLE_PROMOTIONS_MAX_ITEMS, {
    message: `Consulte no máximo ${AVAILABLE_PROMOTIONS_MAX_ITEMS} itens por vez`,
  })
  @IsString({ each: true })
  itemIds: string[] = [];
}
