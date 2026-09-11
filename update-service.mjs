import fs from 'fs';

let content = fs.readFileSync('src/items/items.service.ts', 'utf8');
content = content.replace(/price: dto.price,/, 'price: dto.price,\n        type: dto.type,');
content = content.replace(/Produto não encontrado/g, 'Item não encontrado');
fs.writeFileSync('src/items/items.service.ts', content);
