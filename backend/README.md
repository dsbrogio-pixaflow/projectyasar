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

## Autenticacao

Os endpoints `POST /api/v1/auth/register`, `POST /api/v1/auth/login`, `POST /api/v1/auth/logout` e `GET /api/v1/auth/me` usam sessoes revogaveis. A senha e armazenada com Argon2id e o banco guarda somente o hash do token de sessao. O cadastro publico sempre cria perfil `user`.

O rate limiting persistente, CORS com dominios finais, provisionamento seguro do administrador inicial e configuracao de producao ainda nao estao implementados. **Nao exponha os endpoints de autenticacao publicamente nem cadastre dados reais ate esses controles e o plano de backup/restauracao estarem concluidos.**
