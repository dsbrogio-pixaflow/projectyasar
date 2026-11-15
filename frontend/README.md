# Frontend

Aplicacao React, TypeScript e Vite. Os incrementos atuais cobrem cadastro, login, consulta da sessao, logout, gestao de clientes e produtos, controle de estoque, vendas, entregas e financeiro pelo backend FastAPI.

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

O cliente usa cookies de sessao HttpOnly com `credentials: "include"` e nao persiste tokens no armazenamento do navegador. Clientes podem ser pesquisados, paginados, cadastrados, editados, arquivados e restaurados; o aniversario e informado como `DD/MM` sem ano. Produtos podem ser pesquisados, paginados, cadastrados, editados, arquivados e restaurados, com preco em BRL e URL externa opcional de imagem. O estoque permite registrar entradas e saidas, consultar saldos/historico paginado e reverter movimentos manuais com motivo. Se uma saida projetar saldo negativo, a tela mostra um alerta antecipado, mas permite concluir o lancamento; a confirmacao tambem sinaliza o saldo negativo. Vendas aceitam varios produtos por pedido, preco editavel por item (inclusive negativo), formas de entrega configuraveis, consulta/resumo por produto e cancelamento com motivo, mantendo o historico e compensando o estoque. O frontend nao autoriza vendas sem produtos, clientes e formas de entrega ativos; o backend valida o saldo de forma atomica. Entregas podem ser buscadas por cliente, filtradas por status, alteradas diretamente entre os status permitidos e ter o codigo de rastreio editado. O cancelamento da venda cancela uma entrega pendente e e bloqueado se ela ja saiu ou foi concluida. O financeiro permite criar categorias, registrar despesas com valor positivo, buscar e filtrar os lancamentos e cancelar uma despesa com justificativa, preservando o historico. O resumo subtrai despesas ativas das vendas concluidas; vendas ou despesas canceladas nao entram nos totais. Para deploy, configure `VITE_API_BASE_URL` com a URL HTTPS real da API; o backend deve receber a origem HTTPS real do frontend em `CORS_ORIGINS`. Como a sessao usa `SameSite=Lax`, os dominios do frontend e da API precisam pertencer ao mesmo site (por exemplo, subdominios do mesmo dominio proprio). URLs padrao distintas `*.vercel.app` podem ser cross-site e nao devem ser presumidas compativeis com o cookie. Nenhum valor de producao esta configurado neste projeto.
