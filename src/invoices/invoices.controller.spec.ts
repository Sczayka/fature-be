import { InvoicesController } from './invoices.controller.js';
import { CreateInvoiceDto } from './dto/create-invoice.dto.js';

// PrismaService abre o pool do banco ao ser importado; os testes usam mocks
vi.mock('../prisma/prisma.service.js', () => ({ PrismaService: class {} }));

describe('InvoicesController', () => {
  it('delegates the creation to the service with the active organization', async () => {
    const invoicesService = {
      create: vi.fn().mockResolvedValue({ id: 'inv-1' }),
    };
    const controller = new InvoicesController(invoicesService as any);
    const dto = {} as CreateInvoiceDto;

    await expect(controller.create('org-1', dto)).resolves.toEqual({
      id: 'inv-1',
    });
    expect(invoicesService.create).toHaveBeenCalledWith('org-1', dto);
  });
});
