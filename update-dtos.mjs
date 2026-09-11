import fs from 'fs';

let content = fs.readFileSync('src/items/dto/create-item.dto.ts', 'utf8');
content = content.replace(/name: string;/, 'name: string;\n  type: string;');
fs.writeFileSync('src/items/dto/create-item.dto.ts', content);

content = fs.readFileSync('src/items/dto/update-item.dto.ts', 'utf8');
content = content.replace(/name\?: string;/, 'name?: string;\n  type?: string;');
fs.writeFileSync('src/items/dto/update-item.dto.ts', content);

content = fs.readFileSync('src/app.module.ts', 'utf8');
content = content.replace(/ProductsModule/g, 'ItemsModule');
content = content.replace(/ServicesModule/g, '');
content = content.replace(/import \{ ItemsModule \} from '.\/products\/products.module.js';/g, "import { ItemsModule } from './items/items.module.js';");
content = content.replace(/import \{  \} from '.\/services\/services.module.js';\n/g, "");
fs.writeFileSync('src/app.module.ts', content);
