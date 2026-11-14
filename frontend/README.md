# Frontend

Aplicacao React, TypeScript e Vite. O primeiro incremento cobre cadastro, login, consulta da sessao e logout pelo backend FastAPI.

## Desenvolvimento local

No PowerShell:

```powershell
cd "C:\curso java\SY-Final\frontend"
npm ci
Copy-Item .env.example .env
npm run dev
```

O endereco local da API pode ser alterado em `VITE_API_BASE_URL`; o padrao e `http://127.0.0.1:8000`. O Vite usa `http://127.0.0.1:5173` para manter o mesmo host do cookie da API. Configure e execute o backend conforme [backend/README.md](../backend/README.md); por padrao, ele autoriza essa origem local.

## Validacao

```powershell
npm test
npm run lint
npm run build
```

O cliente usa cookies de sessao HttpOnly com `credentials: "include"` e nao persiste tokens no armazenamento do navegador. Para deploy, configure `VITE_API_BASE_URL` com a URL HTTPS real da API; o backend deve receber a origem HTTPS real do frontend em `CORS_ORIGINS`. Como a sessao usa `SameSite=Lax`, os dominios do frontend e da API precisam pertencer ao mesmo site (por exemplo, subdominios do mesmo dominio proprio). URLs padrao distintas `*.vercel.app` podem ser cross-site e nao devem ser presumidas compativeis com o cookie. Nenhum valor de producao esta configurado neste projeto.
