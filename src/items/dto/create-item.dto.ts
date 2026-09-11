export class CreateItemDto {
  name: string;
  type: string;
  price: number;
  stock: number;
  description?: string;
}
