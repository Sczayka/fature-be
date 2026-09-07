# Documentação de Autenticação - Fature Backend

Este documento descreve como a autenticação e a gestão de organizações (multi-tenant) estão implementadas no projeto **Fature Backend**.

## Arquitetura

Utilizamos o **Better Auth** perfeitamente integrado ao **NestJS** e ao banco de dados via **Prisma ORM** (com o driver adapter `PrismaPg` para o Supabase).

### 1. Better Auth (Core)
O arquivo central de configuração é o `src/auth/auth.config.ts`. Ele é responsável por:
- Inicializar o `betterAuth` com a conexão do banco de dados (usando o `pg.Pool` para habilitar a conexão SSL via pooler do Supabase).
- Configurar o módulo de **Email e Senha** (`emailAndPassword`).
- Configurar cache de sessão (`cookieCache`).
- Integrar o plugin de **Organizações** (`organization()`) do Better Auth.

### 2. Integração com NestJS
Como o Better Auth funciona nativamente com o padrão Node.js/Express, a integração foi feita em `src/main.ts`:
- O body parser do NestJS foi **desativado globalmente** na inicialização (`bodyParser: false`).
- O handler do Better Auth (`toNodeHandler(auth)`) foi montado na rota `/api/auth`.
- O parser de JSON (`express.json()`) foi reativado para o restante da aplicação após as rotas do Better Auth.

### 3. Guards e Decorators
Para proteger as rotas do NestJS, foram criados utilitários em `src/auth/`:
- **`BetterAuthGuard`**: Protege rotas verificando se há uma sessão válida ativa através dos headers enviados. Ativado globalmente via `APP_GUARD`.
- **`OrganizationGuard`**: Um Guard adicional para garantir que o usuário escolheu uma Organização Ativa no momento (Multi-tenant).
- **Decorators (`src/auth/decorators.ts`)**:
  - `@Public()`: Marca uma rota como pública, ignorando a verificação de sessão.
  - `@CurrentUser()`: Extrai as informações do usuário atual da requisição.
  - `@CurrentSession()`: Extrai a sessão atual.
  - `@ActiveOrgId()`: Pega o `activeOrganizationId` associado à sessão atual.

## Rotas Padrões do Better Auth

As seguintes rotas são injetadas automaticamente no caminho `/api/auth` pelo Better Auth:

### Usuários e Autenticação
- `POST /api/auth/sign-up/email`: Registra um novo usuário (Nome, Email, Senha).
- `POST /api/auth/sign-in/email`: Faz o login (Email, Senha) - Retorna o token/cookie.
- `POST /api/auth/sign-out`: Faz logout da sessão atual.
- `GET /api/auth/get-session`: Recupera os detalhes do usuário atual e da sessão.

### Organizações (Multi-Tenant)
- `POST /api/auth/organization/create`: Cria uma nova organização, tornando o criador um "owner".
- `POST /api/auth/organization/set-active`: Define qual a organização atual está em uso na sessão do usuário.
- `GET /api/auth/organization/get-full-organization`: Traz os dados e todos os membros da organização atual.

## Considerações de Banco de Dados
A comunicação com o Supabase utiliza o esquema padrão do Prisma, mas com uso obrigatório de certificados TLS ignorados (`rejectUnauthorized: false`) injetados dinamicamente, já que a infraestrutura do pooler (porta 5432) atua com certificados auto-assinados/customizados.
As tabelas utilizadas incluem: `User`, `Session`, `Account`, `Verification`, `Organization`, `Member`, e `Invitation`.
