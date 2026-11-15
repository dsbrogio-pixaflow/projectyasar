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

Para a Vercel, configure `backend/` como diretorio raiz do projeto Python; o runtime detecta a aplicacao `app` neste diretorio.

## CORS e dominios

Em desenvolvimento, a API aceita por padrao somente `http://localhost:5173` e `http://127.0.0.1:5173` (Vite). Em producao e na Vercel, defina `CORS_ORIGINS` nas variaveis de ambiente do projeto do backend, com uma lista separada por virgulas contendo as origens HTTPS reais do frontend, sem caminhos. Exemplo de formato: `https://<dominio-real-do-frontend>,https://<dominio-customizado>`. O aplicativo falha ao iniciar se essa variavel nao estiver definida em producao, rejeita wildcard e origens HTTP que nao sejam localhost.

O CORS aceita credenciais de cookie, os metodos REST usuais, `Content-Type` e expoe `Retry-After` para o navegador. O frontend devera enviar requisicoes autenticadas com `credentials: "include"`. Configure apenas os dominios reais escolhidos na Vercel; nao inclua dominios dinamicos de preview nem use `*`. CORS nao substitui protecao CSRF. **Ainda nao use dados reais: a estrategia de backup e restauracao precisa ser definida e testada.**

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

Os dominios reais do frontend ainda precisam ser cadastrados em `CORS_ORIGINS` nas configuracoes da Vercel. Protecao CSRF e o plano de backup/restauracao tambem estao pendentes. **Nao cadastre dados reais ate essas etapas estarem concluidas.**

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
