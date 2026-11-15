# Frontend

Aplicacao React, TypeScript e Vite. Os incrementos atuais cobrem cadastro, login, consulta da sessao, logout, gestao de clientes e produtos, controle de estoque, vendas, entregas, financeiro, painel e calendario pelo backend FastAPI.

## Desenvolvimento local

No PowerShell:

```powershell
cd "C:\curso java\SY-Final\frontend"
npm ci
Copy-Item .env.example .env
npm run dev
```

O endereco local da API pode ser alterado em `VITE_API_BASE_URL`; o padrao e `http://127.0.0.1:8000`. Em producao, o cliente usa uma URL relativa (`/api/v1`) por padrao. O Vite local continua chamando `http://127.0.0.1:8000` para manter o mesmo host do cookie da API. Configure e execute o backend conforme [backend/README.md](../backend/README.md); por padrao, ele autoriza as origens locais do Vite.

## Validacao

```powershell
npm test
npm run lint
npm run build
```

O cliente usa cookies de sessao HttpOnly com `credentials: "include"` e nao persiste tokens no armazenamento do navegador. Clientes podem ser pesquisados, paginados, cadastrados, editados, arquivados e restaurados; o aniversario e informado como `DD/MM` sem ano. Produtos podem ser pesquisados, paginados, cadastrados, editados, arquivados e restaurados, com preco em BRL e URL externa opcional de imagem. O estoque permite registrar entradas e saidas, consultar saldos/historico paginado e reverter movimentos manuais com motivo. Se uma saida projetar saldo negativo, a tela mostra um alerta antecipado, mas permite concluir o lancamento; a confirmacao tambem sinaliza o saldo negativo. Vendas aceitam varios produtos por pedido, preco editavel por item (inclusive negativo), formas de entrega configuraveis, consulta/resumo por produto e cancelamento com motivo, mantendo o historico e compensando o estoque. O frontend nao autoriza vendas sem produtos, clientes e formas de entrega ativos; o backend valida o saldo de forma atomica. Entregas podem ser buscadas por cliente, filtradas por status, alteradas diretamente entre os status permitidos e ter o codigo de rastreio editado. O cancelamento da venda cancela uma entrega pendente e e bloqueado se ela ja saiu ou foi concluida. O financeiro permite criar categorias, registrar despesas com valor positivo, buscar e filtrar os lancamentos e cancelar uma despesa com justificativa, preservando o historico. O resumo subtrai despesas ativas das vendas concluidas; vendas ou despesas canceladas nao entram nos totais. O painel mostra entradas e saidas mensais de estoque, unidades vendidas e despesas ativas nos ultimos 12 meses, alem do saldo agregado do estoque ativo. O calendario permite consultar eventos e aniversarios dos clientes ativos, criar eventos manuais e remove-los individualmente; aniversarios de 29/02 ocorrem em 01/03 nos anos nao bissextos. Em producao, o cliente usa o dominio do proprio frontend para `/api/v1`; [vercel.json](vercel.json) encaminha API e health check ao backend, mantendo navegador, cookie e aplicacao no mesmo dominio. Configure `CORS_ORIGINS` no backend com a origem HTTPS do frontend. Para staging, use somente dados ficticios e nao configure `CRON_SECRET` nem SMTP. Nenhum valor secreto de producao deve ser registrado neste projeto.
