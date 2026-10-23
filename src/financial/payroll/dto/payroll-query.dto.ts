import { IsOptional } from 'class-validator';
import { IsCompetence } from '../../dto/financial-validators.js';

/** GET /financial/payroll: sem o mês, o atual. */
export class PayrollQueryDto {
  @IsOptional()
  @IsCompetence()
  competence?: string;
}
