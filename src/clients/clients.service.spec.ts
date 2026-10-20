import { ConflictException, NotFoundException } from '@nestjs/common';
import { ClientsService } from './clients.service.js';
import { CreateClientDto } from './dto/create-client.dto.js';
import { UpdateClientDto } from './dto/update-client.dto.js';

// PrismaService abre o pool do banco ao ser importado; os testes usam mocks
vi.mock('../prisma/prisma.service.js', () => ({ PrismaService: class {} }));
vi.mock('../payments/payment-customers.service.js', () => ({
  PaymentCustomersService: class {},
}));

describe('ClientsService', () => {
  const client = { id: 'client-1', organizationId: 'org-1', name: 'Maria' };

  let prisma: any;
  let paymentCustomers: any;
  let service: ClientsService;

  beforeEach(() => {
    prisma = {
      client: {
        findFirst: vi.fn().mockResolvedValue(client),
        findMany: vi.fn().mockResolvedValue([client]),
        count: vi.fn().mockResolvedValue(1),
        create: vi
          .fn()
          .mockImplementation(({ data }) =>
            Promise.resolve({ id: 'client-2', ...data }),
          ),
        update: vi
          .fn()
          .mockImplementation(({ where, data }) =>
            Promise.resolve({ ...client, id: where.id, ...data }),
          ),
        delete: vi.fn(),
      },
    };
    paymentCustomers = {
      syncCustomer: vi.fn().mockResolvedValue(undefined),
      removeCustomer: vi.fn().mockResolvedValue(undefined),
    };

    service = new ClientsService(prisma, paymentCustomers);
  });

  describe('create', () => {
    it('checks the unique data among the clients that were not deleted', async () => {
      prisma.client.findFirst.mockResolvedValue(null);

      await service.create('org-1', {
        name: 'Maria',
        email: 'maria@exemplo.com',
        cpfCnpj: '52998224725',
        phone: null,
      } as CreateClientDto);

      expect(prisma.client.findFirst).toHaveBeenCalledWith({
        where: {
          organizationId: 'org-1',
          deletedAt: null,
          OR: [
            { name: 'Maria' },
            { cpfCnpj: '52998224725' },
            { email: { equals: 'maria@exemplo.com', mode: 'insensitive' } },
          ],
        },
        select: { id: true },
      });
    });

    it('saves only the registration fields, in the active organization', async () => {
      prisma.client.findFirst.mockResolvedValue(null);

      await service.create('org-1', {
        name: 'Maria',
        city: 'São Paulo',
        // Fora do contrato: o pipe descarta, e o service também não grava
        organizationId: 'org-2',
        metadata: { asaas: { id: 'cus_1' } },
      } as unknown as CreateClientDto);

      const { data } = prisma.client.create.mock.calls[0][0];

      expect(data).toMatchObject({
        name: 'Maria',
        city: 'São Paulo',
        organizationId: 'org-1',
      });
      expect(data).not.toHaveProperty('metadata');
    });

    it('rejects a client with the data of another one', async () => {
      await expect(
        service.create('org-1', { name: 'Maria' } as CreateClientDto),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.client.create).not.toHaveBeenCalled();
    });
  });

  it('lists and searches only the clients that were not deleted', async () => {
    await service.findAll('org-1', {
      page: 2,
      limit: 10,
      name: 'mar',
      createdAt: '2026-10-01',
    });
    await service.search('org-1', '529.982');

    expect(prisma.client.findMany.mock.calls[0][0]).toMatchObject({
      where: {
        organizationId: 'org-1',
        deletedAt: null,
        name: { contains: 'mar', mode: 'insensitive' },
        createdAt: {
          gte: new Date('2026-10-01T00:00:00.000Z'),
          lte: new Date('2026-10-01T23:59:59.999Z'),
        },
      },
      skip: 10,
      take: 10,
    });
    expect(prisma.client.findMany.mock.calls[1][0].where).toMatchObject({
      organizationId: 'org-1',
      deletedAt: null,
      OR: [
        { name: { contains: '529.982', mode: 'insensitive' } },
        { cpfCnpj: { contains: '529982', mode: 'insensitive' } },
      ],
    });
  });

  it('does not find a deleted client', async () => {
    prisma.client.findFirst.mockResolvedValue(null);

    await expect(service.findOne('client-1', 'org-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.client.findFirst).toHaveBeenCalledWith({
      where: { id: 'client-1', organizationId: 'org-1', deletedAt: null },
    });
  });

  describe('update', () => {
    it('saves only the registration fields and syncs the payment provider', async () => {
      prisma.client.findFirst
        .mockResolvedValueOnce(client)
        .mockResolvedValueOnce(null);

      await service.update('client-1', 'org-1', {
        email: null,
        phone: '11999998888',
        organizationId: 'org-2',
        metadata: {},
      } as unknown as UpdateClientDto);

      // A checagem de duplicidade ignora o próprio cliente e os excluídos
      expect(prisma.client.findFirst.mock.calls[1][0].where).toEqual({
        organizationId: 'org-1',
        deletedAt: null,
        id: { not: 'client-1' },
        OR: [{ phone: '11999998888' }],
      });

      const { where, data } = prisma.client.update.mock.calls[0][0];

      expect(where).toEqual({ id: 'client-1' });
      expect(data).toMatchObject({ email: null, phone: '11999998888' });
      expect(data).not.toHaveProperty('organizationId');
      expect(data).not.toHaveProperty('metadata');
      expect(paymentCustomers.syncCustomer).toHaveBeenCalled();
    });

    it('does not update a deleted client', async () => {
      prisma.client.findFirst.mockResolvedValue(null);

      await expect(
        service.update('client-1', 'org-1', { name: 'Maria' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.client.update).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('only marks the client as deleted, keeping its history and the provider customer', async () => {
      const deleted = await service.remove('client-1', 'org-1');

      expect(prisma.client.update).toHaveBeenCalledWith({
        where: { id: 'client-1' },
        data: { deletedAt: expect.any(Date) },
      });
      expect(deleted.deletedAt).toBeInstanceOf(Date);
      expect(prisma.client.delete).not.toHaveBeenCalled();
      expect(paymentCustomers.removeCustomer).not.toHaveBeenCalled();
    });

    it('does not delete a client of another organization', async () => {
      prisma.client.findFirst.mockResolvedValue(null);

      await expect(service.remove('client-1', 'org-2')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.client.update).not.toHaveBeenCalled();
    });
  });
});
