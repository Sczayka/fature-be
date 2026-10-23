import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module.js';
import { FinancialAccountsController } from './accounts/financial-accounts.controller.js';
import { FinancialAccountsService } from './accounts/financial-accounts.service.js';
import { FinancialCategoriesController } from './categories/financial-categories.controller.js';
import { FinancialCategoriesService } from './categories/financial-categories.service.js';
import { EmployeesController } from './employees/employees.controller.js';
import { EmployeesService } from './employees/employees.service.js';
import { PayablesController } from './payables/payables.controller.js';
import { PayablesService } from './payables/payables.service.js';
import { PayrollController } from './payroll/payroll.controller.js';
import { PayrollService } from './payroll/payroll.service.js';
import { ReceiptsController } from './receipts/receipts.controller.js';
import { ReceiptsService } from './receipts/receipts.service.js';
import { FinancialSetupService } from './setup/financial-setup.service.js';
import { TransfersController } from './transfers/transfers.controller.js';
import { TransfersService } from './transfers/transfers.service.js';

/**
 * Financeiro: caixa (contas, saldo e extrato), recebimentos, contas a pagar, transferências e
 * folha. Os recebimentos das faturas são gravados pelo InvoiceReceiptsService, no núcleo de
 * pagamentos; daqui vem só o saldo do provedor (PaymentProviderRegistry).
 */
@Module({
  imports: [PaymentsModule],
  // Rotas fixas (ex.: /financial/employees/search) ficam antes de /:id dentro de cada controller
  controllers: [
    FinancialAccountsController,
    FinancialCategoriesController,
    ReceiptsController,
    PayablesController,
    TransfersController,
    EmployeesController,
    PayrollController,
  ],
  providers: [
    FinancialSetupService,
    FinancialAccountsService,
    FinancialCategoriesService,
    ReceiptsService,
    PayablesService,
    TransfersService,
    EmployeesService,
    PayrollService,
  ],
})
export class FinancialModule {}
