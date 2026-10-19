import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { CreateSupplierDto } from './dto/create-supplier.dto.js';
import type { ListSuppliersQueryDto } from './dto/list-suppliers-query.dto.js';
import {
  SUPPLIER_DETAIL_SELECT,
  SUPPLIER_SUMMARY_SELECT,
} from './suppliers.constants.js';
import { SuppliersService } from './suppliers.service.js';

// PrismaService abre o pool do banco ao ser importado; os testes usam mocks
vi.mock('../prisma/prisma.service.js', () => ({ PrismaService: class {} }));

const pixAccount = {
  pixKeyType: 'EMAIL' as const,
  pixKey: 'financeiro@alfa.com.br',
};

const supplier: CreateSupplierDto = {
  name: 'Distribuidora Alfa',
  cpfCnpj: '11222333000181',
  paymentTermDays: [30, 60],
  brandIds: ['brand-1'],
  contacts: [{ name: 'Ana', isMain: true }, { name: 'Bruno' }],
  bankAccounts: [{ ...pixAccount, isMain: true }],
};

const detailRow = {
  id: 'supplier-1',
  name: 'Distribuidora Alfa',
  brands: [{ brand: { id: 'brand-1', name: 'Logitech', active: true } }],
  contacts: [],
  bankAccounts: [],
};

const uniqueError = () =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '7.10.0',
  });

describe('SuppliersService', () => {
  let prisma: any;
  let service: SuppliersService;

  beforeEach(() => {
    prisma = {
      supplier: {
        create: vi.fn().mockResolvedValue(detailRow),
        update: vi.fn().mockResolvedValue(detailRow),
        findFirst: vi.fn().mockImplementation(({ where }) =>
          // Sem duplicados de nome ou documento; o próprio fornecedor existe
          Promise.resolve(where.id ? detailRow : null),
        ),
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
        delete: vi.fn().mockResolvedValue({ id: 'supplier-1' }),
      },
      brand: {
        findMany: vi
          .fn()
          .mockImplementation(({ where }) =>
            Promise.resolve(
              where.id.in.map((id: string) => ({ id, name: id, active: true })),
            ),
          ),
      },
      supplierBrand: {
        findMany: vi.fn().mockResolvedValue([{ brandId: 'brand-1' }]),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        createMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      supplierContact: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ id: 'contact-1' }, { id: 'contact-2' }]),
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
        update: vi.fn().mockResolvedValue({}),
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      supplierBankAccount: {
        findMany: vi.fn().mockResolvedValue([{ id: 'account-1' }]),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        update: vi.fn().mockResolvedValue({}),
        createMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      itemSupplier: { count: vi.fn().mockResolvedValue(0) },
      $transaction: vi.fn().mockImplementation((work) => work(prisma)),
    };

    service = new SuppliersService(prisma);
  });

  describe('create', () => {
    it('creates the supplier with its brands, contacts and bank accounts', async () => {
      const result = await service.create('org-1', supplier);

      expect(prisma.brand.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: { in: ['brand-1'] }, organizationId: 'org-1' },
        }),
      );

      const { data, select } = prisma.supplier.create.mock.calls[0][0];

      expect(select).toBe(SUPPLIER_DETAIL_SELECT);
      expect(data).toMatchObject({
        name: 'Distribuidora Alfa',
        cpfCnpj: '11222333000181',
        paymentTermDays: [30, 60],
        organizationId: 'org-1',
        brands: { create: [{ brandId: 'brand-1' }] },
        contacts: {
          create: [
            { name: 'Ana', role: null, email: null, isMain: true },
            { name: 'Bruno', isMain: false },
          ],
        },
        bankAccounts: {
          create: [{ ...pixAccount, bankCode: null, isMain: true }],
        },
      });
      // As marcas do detalhe vêm sem a tabela de vínculo
      expect(result.brands).toEqual([
        { id: 'brand-1', name: 'Logitech', active: true },
      ]);
    });

    it('rejects a name or document already used, ignoring the case of the name', async () => {
      prisma.supplier.findFirst.mockResolvedValue({
        cpfCnpj: '11222333000181',
        active: true,
      });

      await expect(service.create('org-1', supplier)).rejects.toThrow(
        new ConflictException('Já existe um fornecedor com este CPF/CNPJ.'),
      );
      expect(prisma.supplier.findFirst).toHaveBeenCalledWith({
        where: {
          organizationId: 'org-1',
          OR: [
            { name: { equals: 'Distribuidora Alfa', mode: 'insensitive' } },
            { cpfCnpj: '11222333000181' },
          ],
        },
        select: { cpfCnpj: true, active: true },
      });
      expect(prisma.supplier.create).not.toHaveBeenCalled();
    });

    it('suggests reactivating an inactive supplier with the same name', async () => {
      prisma.supplier.findFirst.mockResolvedValue({
        cpfCnpj: null,
        active: false,
      });

      await expect(service.create('org-1', supplier)).rejects.toThrow(
        'Já existe um fornecedor inativo com este nome: reative-o em vez de cadastrar outro.',
      );
    });

    it('reports a conflict when the name is taken between the check and the insert', async () => {
      prisma.supplier.create.mockRejectedValue(uniqueError());

      await expect(service.create('org-1', supplier)).rejects.toThrow(
        ConflictException,
      );
    });

    it('rejects brands of another organization and new inactive brands', async () => {
      prisma.brand.findMany.mockResolvedValueOnce([]);

      await expect(service.create('org-1', supplier)).rejects.toThrow(
        new NotFoundException('Marca não encontrada'),
      );

      prisma.brand.findMany.mockResolvedValueOnce([
        { id: 'brand-1', name: 'Antiga', active: false },
      ]);

      await expect(service.create('org-1', supplier)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.supplier.create).not.toHaveBeenCalled();
    });

    it('rejects more than one main contact or bank account', async () => {
      await expect(
        service.create('org-1', {
          ...supplier,
          contacts: [
            { name: 'Ana', isMain: true },
            { name: 'Bruno', isMain: true },
          ],
        }),
      ).rejects.toThrow('Marque no máximo um contato principal');
      await expect(
        service.create('org-1', {
          ...supplier,
          bankAccounts: [
            { ...pixAccount, isMain: true },
            { ...pixAccount, isMain: true },
          ],
        }),
      ).rejects.toThrow('Marque no máximo uma conta bancária principal');
    });

    it('requires transfer data or a Pix key in each bank account', async () => {
      await expect(
        service.create('org-1', {
          ...supplier,
          bankAccounts: [pixAccount, { holderName: 'Alfa' }],
        }),
      ).rejects.toThrow(
        'Conta bancária 2: informe os dados bancários (banco, agência, conta e tipo) ou uma chave Pix',
      );
    });

    it('does not accept ids of contacts that do not exist yet', async () => {
      await expect(
        service.create('org-1', {
          ...supplier,
          contacts: [{ id: 'contact-9', name: 'Ana' }],
        }),
      ).rejects.toThrow(new NotFoundException('Contato não encontrado'));
    });
  });

  describe('update', () => {
    it('changes only the fields that were sent', async () => {
      await service.update('supplier-1', 'org-1', { active: false });

      expect(prisma.supplierBrand.deleteMany).not.toHaveBeenCalled();
      expect(prisma.supplierContact.deleteMany).not.toHaveBeenCalled();
      expect(prisma.supplierBankAccount.deleteMany).not.toHaveBeenCalled();
      expect(prisma.supplier.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'supplier-1' },
          data: expect.objectContaining({
            active: false,
            name: undefined,
            cpfCnpj: undefined,
          }),
        }),
      );
    });

    it('scopes the supplier to the organization', async () => {
      prisma.supplier.findFirst.mockResolvedValue(null);

      await expect(
        service.update('supplier-1', 'org-2', { active: false }),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.supplier.findFirst).toHaveBeenCalledWith({
        where: { id: 'supplier-1', organizationId: 'org-2' },
        select: { id: true },
      });
      expect(prisma.supplier.update).not.toHaveBeenCalled();
    });

    it('checks the name and the document against the other suppliers', async () => {
      await service.update('supplier-1', 'org-1', {
        name: 'Alfa',
        cpfCnpj: '11222333000181',
      });

      expect(prisma.supplier.findFirst).toHaveBeenLastCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ NOT: { id: 'supplier-1' } }),
        }),
      );
    });

    it('replaces the brands, keeping the ones that stay', async () => {
      await service.update('supplier-1', 'org-1', { brandIds: ['brand-2'] });

      expect(prisma.supplierBrand.deleteMany).toHaveBeenCalledWith({
        where: { supplierId: 'supplier-1', brandId: { notIn: ['brand-2'] } },
      });
      expect(prisma.supplierBrand.createMany).toHaveBeenCalledWith({
        data: [{ supplierId: 'supplier-1', brandId: 'brand-2' }],
        skipDuplicates: true,
      });
    });

    it('keeps an inactive brand the supplier already had', async () => {
      prisma.brand.findMany.mockResolvedValue([
        { id: 'brand-1', name: 'Antiga', active: false },
      ]);

      await expect(
        service.update('supplier-1', 'org-1', { brandIds: ['brand-1'] }),
      ).resolves.toBeDefined();
    });

    it('syncs the contacts by id: updates, creates and deletes the missing ones', async () => {
      await service.update('supplier-1', 'org-1', {
        contacts: [
          { id: 'contact-1', name: 'Ana Souza', isMain: true },
          { name: 'Carla' },
        ],
      });

      expect(prisma.supplierContact.deleteMany).toHaveBeenCalledWith({
        where: { supplierId: 'supplier-1', id: { notIn: ['contact-1'] } },
      });
      expect(prisma.supplierContact.update).toHaveBeenCalledWith({
        where: { id: 'contact-1' },
        data: expect.objectContaining({ name: 'Ana Souza', isMain: true }),
      });
      expect(prisma.supplierContact.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            name: 'Carla',
            isMain: false,
            supplierId: 'supplier-1',
          }),
        ],
      });
    });

    it('rejects a contact of another supplier', async () => {
      await expect(
        service.update('supplier-1', 'org-1', {
          contacts: [{ id: 'contact-of-other', name: 'Ana' }],
        }),
      ).rejects.toThrow(new NotFoundException('Contato não encontrado'));
      expect(prisma.supplierContact.deleteMany).not.toHaveBeenCalled();
    });

    it('updates the bank account in place, keeping its id', async () => {
      await service.update('supplier-1', 'org-1', {
        bankAccounts: [{ id: 'account-1', ...pixAccount }],
      });

      expect(prisma.supplierBankAccount.deleteMany).toHaveBeenCalledWith({
        where: { supplierId: 'supplier-1', id: { notIn: ['account-1'] } },
      });
      expect(prisma.supplierBankAccount.update).toHaveBeenCalledWith({
        where: { id: 'account-1' },
        data: expect.objectContaining(pixAccount),
      });
      expect(prisma.supplierBankAccount.createMany).toHaveBeenCalledWith({
        data: [],
      });
    });

    it('removes all contacts and bank accounts with empty lists', async () => {
      await service.update('supplier-1', 'org-1', {
        contacts: [],
        bankAccounts: [],
      });

      expect(prisma.supplierContact.deleteMany).toHaveBeenCalledWith({
        where: { supplierId: 'supplier-1', id: { notIn: [] } },
      });
      expect(prisma.supplierBankAccount.deleteMany).toHaveBeenCalledWith({
        where: { supplierId: 'supplier-1', id: { notIn: [] } },
      });
    });

    it('rejects a bank account repeated in the list', async () => {
      await expect(
        service.update('supplier-1', 'org-1', {
          bankAccounts: [
            { id: 'account-1', ...pixAccount },
            { id: 'account-1', ...pixAccount },
          ],
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('findAll', () => {
    it('lists without contacts and bank accounts, with the filters', async () => {
      await service.findAll('org-1', {
        page: 1,
        limit: 10,
        name: 'alfa',
        cpfCnpj: '112223',
        active: true,
      } as ListSuppliersQueryDto);

      expect(prisma.supplier.findMany).toHaveBeenCalledWith({
        where: {
          organizationId: 'org-1',
          OR: [
            { name: { contains: 'alfa', mode: 'insensitive' } },
            { tradeName: { contains: 'alfa', mode: 'insensitive' } },
          ],
          cpfCnpj: { contains: '112223' },
          active: true,
        },
        orderBy: { createdAt: 'desc' },
        skip: 0,
        take: 10,
        select: SUPPLIER_SUMMARY_SELECT,
      });
      expect(SUPPLIER_SUMMARY_SELECT).not.toHaveProperty('bankAccounts');
      expect(SUPPLIER_SUMMARY_SELECT).not.toHaveProperty('contacts');
    });
  });

  describe('search', () => {
    it('searches active suppliers by name, trade name or document', async () => {
      prisma.supplier.findMany.mockResolvedValue([
        {
          id: 'supplier-1',
          name: 'Alfa',
          brands: [{ brandId: 'brand-1' }],
        },
      ]);

      const result = await service.search('org-1', '11.222');

      expect(prisma.supplier.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            organizationId: 'org-1',
            active: true,
            OR: [
              { name: { contains: '11.222', mode: 'insensitive' } },
              { tradeName: { contains: '11.222', mode: 'insensitive' } },
              { cpfCnpj: { contains: '11222' } },
            ],
          },
          orderBy: { name: 'asc' },
          take: 10,
        }),
      );
      expect(result).toEqual([
        { id: 'supplier-1', name: 'Alfa', brandIds: ['brand-1'] },
      ]);
    });

    it('lists first the suppliers of the brand', async () => {
      prisma.supplier.findMany
        .mockResolvedValueOnce([
          { id: 'supplier-1', brands: [{ brandId: 'brand-1' }] },
        ])
        .mockResolvedValueOnce([{ id: 'supplier-2', brands: [] }]);

      const result = await service.search('org-1', '', 'brand-1');

      expect(
        prisma.supplier.findMany.mock.calls.map(([args]: any) => [
          args.where,
          args.take,
        ]),
      ).toEqual([
        [
          {
            organizationId: 'org-1',
            active: true,
            brands: { some: { brandId: 'brand-1' } },
          },
          10,
        ],
        [
          {
            organizationId: 'org-1',
            active: true,
            brands: { none: { brandId: 'brand-1' } },
          },
          9,
        ],
      ]);
      expect(result.map((row) => row.id)).toEqual(['supplier-1', 'supplier-2']);
    });
  });

  describe('remove', () => {
    it('does not delete a supplier linked to items and suggests inactivating it', async () => {
      prisma.itemSupplier.count.mockResolvedValue(1);

      await expect(service.remove('supplier-1', 'org-1')).rejects.toThrow(
        new ConflictException(
          'Este fornecedor está em 1 produto ou serviço e não pode ser excluído. Inative-o para que ele não apareça em novos cadastros.',
        ),
      );
      expect(prisma.supplier.delete).not.toHaveBeenCalled();
    });

    it('deletes a supplier without items, returning no bank data', async () => {
      await service.remove('supplier-1', 'org-1');

      expect(prisma.supplier.delete).toHaveBeenCalledWith({
        where: { id: 'supplier-1' },
        select: SUPPLIER_SUMMARY_SELECT,
      });
    });
  });
});
