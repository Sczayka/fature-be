import { PayloadValidationPipe } from '../../common/pipes/payload-validation.pipe.js';
import { UpdateCompanyInfoDto } from './update-company-info.dto.js';

/** Payload enviado pela aba "Dados da empresa" do fature-fe. */
const companyInfo = {
  cnpj: '12345678000190',
  companyType: 'MEI',
  phone: '1133334444',
  mobilePhone: '11999998888',
  incomeValue: null,
  postalCode: '01001000',
  address: 'Praça da Sé',
  addressNumber: '1',
  complement: '',
  province: 'Sé',
};

const validate = (payload: unknown) =>
  PayloadValidationPipe.transform(payload, {
    type: 'body',
    metatype: UpdateCompanyInfoDto,
  });

describe('UpdateCompanyInfoDto', () => {
  it('keeps the company data sent by the settings page', async () => {
    await expect(validate(companyInfo)).resolves.toEqual(companyInfo);
  });

  // O body vai direto para o update da organização: nada além dos dados da empresa pode passar
  it('drops other organization columns and nested writes', async () => {
    const dto = await validate({
      ...companyInfo,
      slug: 'outra-empresa',
      logo: 'https://example.com/logo.png',
      gatewayAccounts: { deleteMany: {} },
    });

    expect(dto).toEqual(companyInfo);
  });
});
