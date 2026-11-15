# Backend

API REST em FastAPI. O endpoint `GET /health` verifica se a aplicacao esta respondendo; ele nao testa a conexao com o banco.

## Executar no Windows

No PowerShell do VS Code:

```powershell
cd "C:\curso java\SY-Final\backend"
py -3.14 -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -e ".[dev]"
.\.venv\Scripts\python.exe -m pytest
.\.venv\Scripts\python.exe -m uvicorn app:app --reload
```

Com o servidor ativo, abra `http://127.0.0.1:8000/health` ou `http://127.0.0.1:8000/docs`.

## Banco local e migracoes

As migracoes exigem uma variavel `DATABASE_URL`. Para criar um banco SQLite de desenvolvimento:

```powershell
$env:DATABASE_URL = "sqlite:///./dev.db"
.\.venv\Scripts\python.exe -m alembic upgrade head
```

Para PostgreSQL, use a string de conexao do provedor em `DATABASE_URL`; URLs `postgres://` e `postgresql://` sao adaptadas para o driver psycopg 3 instalado pelo projeto.

Para gerar SQL PostgreSQL sem executar a migracao, configure uma URL PostgreSQL em `DATABASE_URL` e use:

```powershell
.\.venv\Scripts\python.exe -m alembic upgrade head --sql
```

Nao coloque senhas, URLs de conexao ou chaves no GitHub. Este esqueleto ainda nao conecta ao Supabase e nao deve receber dados reais. As migracoes podem ser testadas localmente com SQLite, mas devem tambem ser revisadas contra PostgreSQL antes de aplicar no ambiente remoto.

Para a Vercel, configure `backend/` como diretorio raiz do projeto Python; o runtime detecta a aplicacao `app` neste diretorio. `backend/vercel.json` fixa a regiao das funcoes em `iad1`, proxima ao projeto Supabase atual em Virginia.

## CORS e dominios

Em desenvolvimento, a API aceita por padrao somente `http://localhost:5173` e `http://127.0.0.1:5173` (Vite). Em producao e na Vercel, defina `CORS_ORIGINS` nas variaveis de ambiente do projeto do backend, com uma lista separada por virgulas contendo as origens HTTPS reais do frontend, sem caminhos. Exemplo de formato: `https://<dominio-real-do-frontend>,https://<dominio-customizado>`. O aplicativo falha ao iniciar se essa variavel nao estiver definida em producao, rejeita wildcard e origens HTTP que nao sejam localhost.

O CORS aceita credenciais de cookie, os metodos REST usuais, `Content-Type` e expoe `Retry-After` para o navegador. O frontend envia requisicoes autenticadas com `credentials: "include"`. Em producao, o frontend usa o proprio dominio e `frontend/vercel.json` encaminha `/api/v1/*` e `/health` ao projeto da API; isso evita cookies cross-site entre dominios `*.vercel.app` independentes. Configure `CORS_ORIGINS` com a origem HTTPS do frontend e nao use `*`. CORS nao substitui protecao CSRF. **Ainda nao use dados reais: a estrategia de backup e restauracao precisa ser definida e testada.**

## Staging na Vercel

Os projetos `projectyasar-staging-frontend` e `projectyasar-staging-api` usam as raizes `frontend/` e `backend/` deste repositorio. O frontend encaminha chamadas ao dominio `projectyasar-staging-api.vercel.app`; o cliente usa `/api/v1` relativo em producao, preservando sessoes `HttpOnly`, `Secure` e `SameSite=Lax` no mesmo dominio.

Cadastre segredos somente nas variaveis de ambiente do projeto da API na Vercel. A API precisa de `DATABASE_URL`, `RATE_LIMIT_HMAC_KEY` (chave aleatoria estavel, com pelo menos 32 bytes) e `CORS_ORIGINS` (origem HTTPS do frontend). Nao configure `CRON_SECRET` ou variaveis SMTP no staging: a rota agendada rejeitara a chamada antes de consultar o banco ou enviar e-mails. O bootstrap de administrador e executado uma unica vez por operador, fora da Vercel, somente depois de aprovada e isolada a base de staging; nao mantenha as credenciais de bootstrap nas variaveis do deploy.

Antes de conectar o staging ao PostgreSQL, confirme que a base e isolada da base de qualquer ambiente com dados existentes. Nao execute migracoes nem bootstrap em uma base compartilhada ou sem backup/restauracao verificados. Use somente dados ficticios; a Issue #5 continua pendente e nao ha autorizacao para uso de dados reais.

## Autenticacao

Os endpoints `POST /api/v1/auth/register`, `POST /api/v1/auth/login`, `POST /api/v1/auth/logout` e `GET /api/v1/auth/me` usam sessoes revogaveis. A senha e armazenada com Argon2id e o banco guarda somente o hash do token de sessao. O cadastro publico sempre cria perfil `user`.

O cadastro permite 5 tentativas por IP por hora; o login permite 10 por e-mail e 20 por IP em 15 minutos. Os contadores sao atomicos e persistidos na tabela `auth_rate_limits`; IPs e e-mails sao convertidos em fingerprints HMAC, nunca gravados em texto puro. Tentativas excedentes retornam `429` e `Retry-After`. Em Vercel, a API usa o `X-Forwarded-For` fornecido pela plataforma, que sobrescreve esse cabecalho para evitar falsificacao; fora dela usa o endereco do cliente ASGI.

Configure uma chave HMAC aleatoria de pelo menos 32 bytes, igual em todas as instancias da API, como `RATE_LIMIT_HMAC_KEY`. Exemplo local no PowerShell:

```powershell
$bytes = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$env:RATE_LIMIT_HMAC_KEY = [Convert]::ToBase64String($bytes)
```

Antes de executar a API, aplique as migracoes no banco de desenvolvimento com `alembic upgrade head`. Para provisionar o administrador inicial, defina `ADMIN_BOOTSTRAP_EMAIL` e `ADMIN_BOOTSTRAP_PASSWORD` no ambiente e execute:

```powershell
.\.venv\Scripts\python.exe .\bootstrap_admin.py
```

O comando exige que as migracoes ja tenham sido aplicadas, valida a mesma politica de senha do cadastro, cria a conta como `admin` ativa com hash Argon2id e recusa execucoes posteriores se ja houver qualquer administrador. Em PostgreSQL usa bloqueio transacional para impedir dois bootstraps concorrentes. Remova os segredos temporarios do ambiente assim que concluir. O comando nao e endpoint HTTP e nao executa migracoes automaticamente.

`CORS_ORIGINS` deve conter a origem HTTPS do frontend cadastrada na Vercel. Protecao CSRF e o plano de backup/restauracao tambem estao pendentes. **Nao cadastre dados reais ate essas etapas estarem concluidas.**

## Clientes

Os endpoints `/api/v1/customers` exigem uma sessao ativa. `GET /customers` lista clientes ativos com paginação (`limit` ate 100, `offset`), busca opcional por nome/e-mail/telefone e opção `include_archived=true`. `POST /customers` cria; `GET /customers/{id}` consulta; `PUT /customers/{id}` substitui os campos editáveis; `POST /customers/{id}/archive` arquiva e `POST /customers/{id}/restore` restaura.

Nome é obrigatório; e-mail, telefone, endereço e aniversário são opcionais. Aniversário armazena somente dia e mês, valida a combinação completa e permite 29/02. Cadastros são arquivados em vez de excluídos para preservar futuras referências históricas. A tabela já existe na migração `0001`; não é necessária nova migração para esta funcionalidade.

## Produtos

Os endpoints `/api/v1/products` também exigem sessão ativa. `GET /products` pesquisa pelo nome, pagina (`limit` até 100, `offset`) e omite arquivados por padrão; `include_archived=true` inclui o histórico. `POST /products` cria; `GET /products/{id}` consulta; `PUT /products/{id}` atualiza; `POST /products/{id}/archive` arquiva e `POST /products/{id}/restore` restaura.

Preço atual usa `NUMERIC(12,2)`, deve ser não negativo e aceitar no máximo duas casas decimais. Imagem é apenas uma URL HTTP/HTTPS opcional; a API não busca nem armazena arquivos. Produtos são arquivados em vez de excluídos para preservar futuras referências de vendas. A tabela já existe na migração `0001`.

## Estoque

Os endpoints autenticados `/api/v1/inventory/summary` e `/api/v1/inventory/movements` consultam saldos e histórico paginado. O resumo aceita `product_id` para consultar o saldo individual. `POST /inventory/movements` registra entrada ou saída manual; quantidades devem ser positivas, mas uma saída pode deixar o saldo negativo para preservar o comportamento legado. A API e a interface avisam antes e depois do lançamento sem bloquear a saída. Produtos arquivados não aceitam novos movimentos.

Movimentos são imutáveis. `POST /inventory/movements/{movement_id}/reverse` exige um motivo e cria um movimento compensatório; uma movimentação manual só pode ser revertida uma vez. Movimentos ligados a vendas são corrigidos exclusivamente pelo cancelamento da venda. A estrutura e os índices foram adicionados pela migração `0004_inventory_movements`; revise e aplique migracoes apenas em bancos locais/de teste nesta etapa.

## Vendas

Os endpoints autenticados `/api/v1/sales` permitem registrar vendas com até 50 itens, consultar o histórico paginado, buscar por nome do cliente e filtrar por situação. Cada item preserva o nome do produto, quantidade e preço unitário aplicado; preços negativos são permitidos para manter a regra do sistema legado. A venda, seus itens e as baixas de estoque são gravados na mesma transação, e a criação é recusada quando não há saldo suficiente.

`POST /sales/{sale_id}/cancel` exige um motivo, preserva a venda e os movimentos originais e cria movimentos compensatórios; uma venda não pode ser cancelada duas vezes. O cancelamento também cancela a entrega pendente na mesma transação e é bloqueado se a entrega já saiu ou foi concluída. `GET /sales/summary` resume quantidades e valores das vendas concluídas. As formas de entrega são listadas em `/api/v1/delivery-methods`; novas opções podem ser adicionadas e as opções iniciais são inseridas pela migração `0005_sales`.

## Entregas

Os endpoints autenticados `/api/v1/deliveries` listam entregas com busca por cliente, filtro por status e paginação; `GET /deliveries/{sale_id}` consulta uma entrega e `PATCH /deliveries/{sale_id}` atualiza status e/ou código de rastreio. Cada venda tem exatamente uma entrega, criada como `pending` na mesma transação da venda, inclusive vendas para retirada e entrega pessoal. O endereço é um snapshot. Status permitidos: `pending`, `out_for_delivery`, `delivered` e `cancelled`; podem ser selecionados diretamente para manter o comportamento legado. Código de rastreio é opcional, limitado a 200 caracteres e pode ser limpo. Cancelar uma entrega não cancela a venda; vendas canceladas não permitem reabrir ou editar a entrega.

A migração `0006_deliveries` cria a tabela e gera entregas pendentes para vendas existentes; vendas já canceladas recebem entrega cancelada. Nenhum dado dos TXT é importado. Revise e aplique migrações somente em bancos locais/de teste nesta etapa; nenhum banco remoto ou dado real foi alterado.

## Financeiro

Os endpoints autenticados `/api/v1/expense-categories` listam e criam categorias; nomes são aparados e únicos sem diferenciar maiúsculas de minúsculas. `/api/v1/expenses` lista lançamentos com busca por categoria, filtro por situação e paginação, e permite criar despesas com data, categoria e valor maior que zero com até duas casas decimais. O nome da categoria é preservado como snapshot em cada lançamento. Despesas não são editadas nem excluídas: `POST /expenses/{expense_id}/cancel` exige justificativa, registra autor/data do cancelamento e preserva o histórico; lançamentos cancelados não podem ser cancelados novamente.

`GET /api/v1/financial/summary` retorna a soma das vendas concluídas, a soma das despesas ainda registradas e o resultado líquido. Vendas canceladas e despesas canceladas ficam fora dos totais. A migração `0007_finance` cria as tabelas, restrições e índices sem importar categorias ou registros dos arquivos TXT. Revise e aplique migrações somente em bancos locais/de teste nesta etapa; nenhum banco remoto ou dado real foi alterado.

## Painel

`GET /api/v1/dashboard` exige sessão ativa e retorna os 12 meses até o mês atual, com meses sem dados preenchidos com zero. O painel soma entradas e saídas mensais de estoque (incluindo os efeitos de reversões), unidades de vendas concluídas e despesas ainda registradas. Vendas e despesas canceladas não entram nos totais correspondentes. O saldo atual agregado considera produtos ativos e preserva valores negativos. O endpoint é somente leitura e não requer migração de banco.

## Calendário e aniversários

Os endpoints autenticados `GET /api/v1/calendar?year={year}&month={month}`, `POST /api/v1/calendar/events` e `DELETE /api/v1/calendar/events/{event_id}` consultam eventos e aniversários dos clientes ativos, criam eventos manuais e removem eventos individualmente. Aniversários são derivados dos clientes; 29/02 aparece em 01/03 nos anos não bissextos.

O envio de felicitações usa `POST /api/v1/calendar/birthdays/send`, configurado em `backend/vercel.json` para execução diária às 09:00 em `America/Sao_Paulo`. Em ambientes que devem enviar e-mails, configure `CRON_SECRET` na API; o alvo HTTP é público e rejeita chamadas sem `Authorization: Bearer <CRON_SECRET>`. **No staging, nao configure `CRON_SECRET` ou SMTP**: a requisicao agendada retorna `503` antes de consultar o banco ou enviar e-mails. O agendamento tem jitter (15 minutos no plano Hobby; 1 a 15 minutos em Pro/Enterprise) e nao recebe retry automatico da Vercel.

Configure o serviço SMTP exclusivamente nas variáveis do backend: `SMTP_HOST`, `SMTP_PORT` (587 por padrão), `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM`, `BIRTHDAY_EMAIL_SUBJECT` e `BIRTHDAY_EMAIL_BODY`. O envio usa STARTTLS. Logs guardam status, tentativas e classe do erro, e impedem reenvio dos e-mails já concluídos. Testes substituem SMTP por mock; não configure ou execute envios reais durante o desenvolvimento. A migração `0008_calendar` deve ser validada localmente; nenhum banco remoto foi alterado.
