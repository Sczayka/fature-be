export class UpdateClientDto {
  name?: string;
  email?: string;
  phone?: string;
  mobile?: string;
  cpfCnpj?: string;
  cep?: string;
  addressLine?: string;
  addressNumber?: string;
  complement?: string;
  district?: string;
  state?: string;
  city?: string;
  municipalInscription?: string;
  stateInscription?: string;
  metadata?: Record<string, any>;
}
