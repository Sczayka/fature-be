import { PartialType } from '@nestjs/mapped-types';
import { CreateInvoiceDraftDto } from './create-invoice-draft.dto.js';

export class UpdateInvoiceDraftDto extends PartialType(CreateInvoiceDraftDto) {}
