import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsString } from 'class-validator';
import { idList } from '../../common/dto/transforms.js';
import { ITEM_STOCK_MAX_ITEMS } from '../items.constants.js';

/** GET /items/stock: os itens da cobrança. */
export class ItemStockQueryDto {
  @Transform(idList)
  @IsArray()
  @ArrayMaxSize(ITEM_STOCK_MAX_ITEMS, {
    message: `Consulte no máximo ${ITEM_STOCK_MAX_ITEMS} itens por vez`,
  })
  @IsString({ each: true })
  ids: string[] = [];
}
