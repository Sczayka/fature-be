const fs = require('fs');
const glob = require('glob');

function fixCasing(file) {
  let content = fs.readFileSync(file, 'utf8');
  content = content.replace(/itemsService/g, 'ItemsService');
  content = content.replace(/CreateitemDto/g, 'CreateItemDto');
  content = content.replace(/UpdateitemDto/g, 'UpdateItemDto');
  content = content.replace(/itemsController/g, 'ItemsController');
  content = content.replace(/itemsModule/g, 'ItemsModule');
  content = content.replace(/itemModule/g, 'ItemModule');
  fs.writeFileSync(file, content);
}

const files = glob.sync('src/items/**/*.ts');
files.forEach(fixCasing);
