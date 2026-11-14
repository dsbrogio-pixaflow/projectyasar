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
