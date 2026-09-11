import fs from 'fs';
import path from 'path';

function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(function(file) {
    file = path.join(dir, file);
    const stat = fs.statSync(file);
    if (stat && stat.isDirectory()) { 
      results = results.concat(walk(file));
    } else { 
      results.push(file);
    }
  });
  return results;
}

const files = walk('src/items').filter(f => f.endsWith('.ts'));
files.forEach(file => {
  let content = fs.readFileSync(file, 'utf8');
  content = content.replace(/itemsService/g, 'ItemsService');
  content = content.replace(/CreateitemDto/g, 'CreateItemDto');
  content = content.replace(/UpdateitemDto/g, 'UpdateItemDto');
  content = content.replace(/itemsController/g, 'ItemsController');
  content = content.replace(/itemsModule/g, 'ItemsModule');
  content = content.replace(/itemModule/g, 'ItemModule');
  content = content.replace(/export class items/g, 'export class Items');
  content = content.replace(/this\.items/g, 'this.items');
  content = content.replace(/private readonly itemsService: ItemsService/g, 'private readonly itemsService: ItemsService');
  fs.writeFileSync(file, content);
});
