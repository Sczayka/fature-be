import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsString } from 'class-validator';
import { idList } from '../../common/dto/transforms.js';
import { AVAILABLE_PROMOTIONS_MAX_ITEMS } from '../promotions.constants.js';

/** GET /promotions/available: os itens da cobrança. */
export class AvailablePromotionsQueryDto {
  @Transform(idList)
  @IsArray()
  @ArrayMaxSize(AVAILABLE_PROMOTIONS_MAX_ITEMS, {
    message: `Consulte no máximo ${AVAILABLE_PROMOTIONS_MAX_ITEMS} itens por vez`,
  })
  @IsString({ each: true })
  itemIds: string[] = [];
}
