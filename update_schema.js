const fs = require('fs');
let schema = fs.readFileSync('prisma/schema.prisma', 'utf8');
schema = schema.replace(/products\s+Product\[\]\n\s*services\s+Service\[\]/, 'items Item[]');
schema = schema.replace(/\/\/ Produtos[\s\S]*?(?=\/\/ Servi)/, '');
schema = schema.replace(/\/\/ Servi[^m]*model Service \{[\s\S]*?\}/, // Items da organização
model Item {
  id             String       @id @default(cuid())
  name           String
  price          Float
  type           String
  stock          Int          @default(0)
  description    String?
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt

  @@index([organizationId])
});
fs.writeFileSync('prisma/schema.prisma', schema);
