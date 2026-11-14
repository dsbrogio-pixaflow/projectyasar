# Especificacao de arquitetura e migracao

**Status:** proposta aprovada para orientar o planejamento; ainda nao e uma implementacao.  
**Sistema legado analisado:** SY-Final, aplicacao Java Swing com persistencia em arquivos TXT.  
**Escopo de dados:** os registros dos arquivos TXT sao dados de teste e nao serao importados. As configuracoes visuais e de e-mail serao tratadas separadamente; credenciais nao serao copiadas para o codigo, banco ou GitHub.

## 1. Arquitetura alvo

Um unico repositorio GitHub, com frontend e backend em diretorios separados e projetos Vercel independentes:

```text
repositorio/
  frontend/   React + TypeScript + Vite -> projeto Vercel do frontend
  backend/    Python + FastAPI           -> projeto Vercel da API
  docs/       especificacoes e decisoes
```

O PostgreSQL sera gerenciado pelo Supabase. O unico projeto mantido e `projectyasar`, em East US / North Virginia (`us-east-1`), escolhido pela opcao geral Americas exibida no painel; a criacao de um segundo projeto foi cancelada e nenhum schema ou dado foi criado. Embora a documentacao liste Sao Paulo (`sa-east-1`) como regiao especifica, essa opcao nao apareceu no fluxo de criacao observado. Se o banco permanecer em Virginia, `iad1` e a candidata para a API Vercel, reduzindo latencia entre API e banco; considerar a latencia para usuarios no Brasil. Usuarios principais estao no Brasil. O plano atual do Supabase nao oferece backups gerenciados: o desenvolvimento pode prosseguir com dados ficticios, mas dados reais nao devem ser usados em producao antes de definir, automatizar e testar uma estrategia de backup/restauracao externa ou mudar de plano. A autenticacao sera propria do FastAPI; o Supabase sera usado como banco PostgreSQL, nao como provedor de identidade. As migracoes serao versionadas com Alembic. O frontend chamara a API HTTPS; a API usara uma lista explicita de origens CORS autorizadas. Variaveis de ambiente e credenciais SMTP existirao somente no ambiente do backend.

Vercel Functions suporta aplicacoes ASGI como FastAPI. O banco, o armazenamento persistente de imagens e o envio de e-mail continuam sendo servicos separados. A API deve usar conexoes PostgreSQL compatíveis com o modelo serverless e a regiao do banco deve ser escolhida considerando a regiao das funcoes.

O repositorio GitHub `projectyasar` e privado. A tentativa de configurar branch protection foi recusada pelo GitHub no plano atual; a resposta indicou GitHub Pro ou repositorio publico. A visibilidade nao sera alterada sem autorizacao. Ate uma decisao sobre o plano, o fluxo sera operacional: branches de tarefa, PRs para `main`, revisao manual e sem commits diretos em `main`.

## 2. Diagrama de entidades

```mermaid
erDiagram
    USERS ||--o{ SALES : creates
    USERS ||--o{ EXPENSES : creates
    USERS ||--o{ INVENTORY_MOVEMENTS : creates
    USERS ||--o{ CALENDAR_EVENTS : creates
    CUSTOMERS ||--o{ SALES : places
    SALES ||--|{ SALE_ITEMS : contains
    PRODUCTS ||--o{ SALE_ITEMS : sold_as
    PRODUCTS ||--o{ INVENTORY_MOVEMENTS : tracks
    SALE_ITEMS ||--o{ INVENTORY_MOVEMENTS : causes
    SALES ||--o| DELIVERIES : has
    DELIVERY_METHODS ||--o{ SALES : selected_for
    EXPENSE_CATEGORIES ||--o{ EXPENSES : categorizes
    CUSTOMERS ||--o{ BIRTHDAY_EMAIL_LOGS : receives
    USERS ||--o{ USER_SESSIONS : owns
```

## 3. Tabelas e regras de persistencia

Os nomes abaixo sao conceituais; a convencao final de nomes e tipos sera aplicada nas migracoes.

| Tabela | Campos e regras principais |
|---|---|
| `users` | `id`, nome completo, e-mail normalizado e unico, hash de senha, perfil (`admin`/`user`), estado (`active`/`inactive`), datas de criacao e alteracao. O hash nunca e retornado pela API. |
| `user_sessions` | Sessoes revogaveis vinculadas ao usuario; excluir/desativar a conta revoga suas sessoes. |
| `customers` | Nome, e-mail, telefone, endereco, `birthday_day`, `birthday_month`, `archived_at` e autoria opcional. Dia e mes sao ambos nulos ou ambos validos; 29/02 e permitido. |
| `products` | Nome, preco atual (`NUMERIC`), referencia de imagem externa, estado/arquivamento e autoria opcional. Imagens nao serao armazenadas no filesystem efemero das funcoes. |
| `delivery_methods` | Opcoes configuraveis de entrega, incluindo as existentes como dados iniciais de configuracao quando aprovadas. |
| `sales` | Cliente, data/hora, estado, forma de entrega e snapshots do nome/endereco relevantes ao historico. Vendas confirmadas nao sao apagadas para corrigir o estoque. |
| `sale_items` | Venda, produto, quantidade positiva, preco unitario aplicado (`NUMERIC`) e total calculado. O preco praticado fica preservado mesmo quando o preco atual do produto muda. |
| `inventory_movements` | Produto, instante, tipo (`in`, `out`, `reversal`), quantidade positiva, origem e autoria opcional. Movimentos de saida de venda referenciam o item da venda; restricao unica impede gerar a mesma saida mais de uma vez. |
| `deliveries` | Uma entrega no maximo por venda; status, codigo de rastreio e snapshot do endereco usado. Status inicial `pending`; cancelamento de entrega nao cancela a venda automaticamente. |
| `expense_categories` | Categorias configuraveis de lancamentos financeiros. |
| `expenses` | Data, categoria, valor positivo (`NUMERIC`), descricao opcional e autoria. Preserva a interpretacao observada no Java: lancamentos financeiros sao despesas/pagamentos. |
| `calendar_events` | Eventos manuais com data, descricao, tipo e autoria opcional. Aniversarios nao sao copiados para esta tabela. |
| `birthday_email_logs` | Cliente, ano celebrado, data/hora de tentativa, status, quantidade de tentativas e erro sanitizado. Restricao unica por cliente/ano torna o envio idempotente. |

### Integridade e exclusoes

- Chaves estrangeiras protegem relacionamentos. Valores monetarios usam `NUMERIC`, datas de negocio usam `DATE`/`TIMESTAMPTZ` e quantidades sao inteiros positivos.
- Criar uma venda e as respectivas saidas de estoque deve ocorrer na mesma transacao. Estoque disponivel e calculado pelos movimentos.
- Cancelar uma venda registra estado de cancelamento e movimento compensatorio; nao apaga a venda nem os movimentos originais.
- Cliente ou produto sem historico pode ser excluido. Com historico, deve ser arquivado e permanecer referenciavel.
- A exclusao administrativa de usuario remove a conta, sessoes e referencias de autoria/auditoria associadas. Registros de negocio (vendas, despesas, estoque, entregas e eventos) sao preservados; referencias opcionais ao autor ficam nulas.
- O ultimo administrador ativo nao pode ser desativado nem rebaixado. A verificacao deve ser feita no backend dentro de uma transacao.

## 4. Autenticacao e autorizacao

### Cadastro e login

- Cadastro publico recebe nome completo, e-mail e senha; perfil e estado nunca sao aceitos do formulario. Toda nova conta e criada como `user` e `active`, sem verificacao de e-mail.
- A senha permanece conforme solicitado: minimo de seis caracteres e primeiro caractere maiusculo. A senha informada anteriormente para a conta inicial foi exposta e nao deve ser reutilizada.
- Autenticacao e sessoes sao implementadas no FastAPI e PostgreSQL, sem Supabase Auth. Senhas sao armazenadas com hash dedicado para senhas (Argon2id ou bcrypt), nunca em texto puro. Rate limit e respostas de erro sem revelar se um e-mail existe protegem o login sem alterar a regra de senha escolhida.
- A conta inicial de administrador sera provisionada uma unica vez por mecanismo seguro de bootstrap, usando `ADMIN_BOOTSTRAP_EMAIL` e `ADMIN_BOOTSTRAP_PASSWORD` como configuracoes de ambiente. A senha sera fornecida como segredo de ambiente, nao incorporada ao repositorio; depois do bootstrap, o segredo temporario deve ser removido/rotacionado.
- Recomendacao de sessao web: cookies `Secure`, `HttpOnly` e `SameSite`, com expiracao e revogacao no servidor. A escolha final do mecanismo de sessao e detalhe tecnico a fechar na implementacao.

### Matriz de acesso

| Operacao | `user` | `admin` |
|---|---:|---:|
| Usar clientes, produtos, estoque, vendas, entregas, financeiro, calendario e painel de negocio | Sim | Sim |
| Consultar painel administrativo de usuarios | Nao | Sim |
| Listar e editar usuarios | Nao | Sim |
| Promover/rebaixar perfil e ativar/desativar conta | Nao | Sim |
| Excluir conta elegivel | Nao | Sim |

As permissoes sao aplicadas em cada endpoint da API, nao apenas pela visibilidade dos botoes React. Alteracao de perfil, desativacao e exclusao revogam sessoes afetadas. Administradores nao podem consultar senhas ou hashes.

### Exclusao no painel

A exclusao permanente exige que o administrador digite o e-mail da conta alvo e confirme. O backend valida a correspondencia, remove a conta e suas sessoes, mas preserva os registros de negocio. A interface deve explicar que a operacao e irreversivel.

## 5. Contrato inicial da API

Prefixo: `/api/v1`. JSON em UTF-8; erros seguem um formato consistente com codigo e mensagem segura. IDs sao opacos para a interface; listas administrativas e de negocio usam paginacao.

| Metodo e rota | Acesso | Proposito |
|---|---|---|
| `POST /auth/register` | Publico | Criar conta ativa `user`; rejeitar campos de perfil/estado no corpo. |
| `POST /auth/login` | Publico | Autenticar e estabelecer sessao segura. |
| `POST /auth/logout` | Autenticado | Revogar a sessao atual. |
| `GET /auth/me` | Autenticado | Retornar identidade, perfil e estado sem dados secretos. |
| `GET /admin/users` | `admin` | Listar usuarios com pagina, filtro e ordenacao limitados. |
| `PATCH /admin/users/{user_id}` | `admin` | Editar nome/e-mail, perfil e estado; proteger ultimo administrador ativo. |
| `DELETE /admin/users/{user_id}` | `admin` | Excluir conta; exigir `confirm_email` igual ao e-mail alvo. |
| `/customers` | `user` ou `admin` | Listar, criar, consultar, editar, arquivar e excluir quando sem historico. |
| `/products` | `user` ou `admin` | Listar, criar, consultar, editar, arquivar e excluir quando sem historico. |
| `/inventory/movements` e `/inventory/balances` | `user` ou `admin` | Registrar/consultar movimentos e saldos; saidas manuais nao podem deixar saldo negativo. |
| `/sales` e `/sales/{sale_id}` | `user` ou `admin` | Criar venda com um ou mais itens, consultar e cancelar preservando historico. |
| `/deliveries` e `/deliveries/{sale_id}` | `user` ou `admin` | Consultar/atualizar status e rastreio da entrega. |
| `/expense-categories` e `/expenses` | `user` ou `admin` | Gerir categorias e lancamentos financeiros. |
| `/calendar/events` | `user` ou `admin` | Gerir eventos manuais; aniversarios sao derivados de clientes. |
| `/dashboard` | `user` ou `admin` | Retornar indicadores de vendas, estoque e financeiro. |

O contrato detalhado de campos, codigos de erro e validacoes sera refinado junto com as telas e publicado no OpenAPI do FastAPI. Criacao de venda deve validar todos os itens e estoque e gravar venda, itens e movimentos em uma unica transacao.

## 6. Regra de aniversarios e e-mail

- Aniversario e armazenado apenas por dia e mes no cliente.
- Um agendamento diario tenta executar as felicitações as 09:00 em `America/Sao_Paulo`; envia para clientes ativos com e-mail valido e aniversario do dia.
- Para 29/02, enviar em 29 de fevereiro quando o ano for bissexto; nos demais anos, em 28 de fevereiro.
- O envio deve ser idempotente por cliente/ano; falhas sao registradas e podem ser reprocessadas sem duplicar envios concluidos.
- SMTP e credenciais ficam em variaveis de ambiente do projeto backend. Nao migrar a senha contida no arquivo TXT; rotacionar qualquer credencial ja compartilhada.
- Vercel Schedules oferece fuso IANA, adequado para `America/Sao_Paulo`. A precisao/jitter do horario depende do plano; no plano Hobby a documentacao atual indica uma janela de ate 15 minutos. Confirmar plano e comportamento antes de prometer execucao exatamente as 09:00.
- Endpoint agendado deve ser privado/autenticado e seguro contra chamadas repetidas. O envio propriamente dito pode ser dividido em lotes para respeitar limites de duracao.

## 7. Configuracoes, arquivos e dados de teste

- Nao importar os registros dos demais TXT: foram usados somente para testes.
- Em `configuracoes.txt`, a cor visual pode ser reaproveitada. O caminho da imagem de fundo e local a uma maquina; obter a imagem e armazenar em servico persistente antes de disponibiliza-la na web.
- Em `Controle_config_email.txt`, servidor, porta e remetente podem orientar a configuracao SMTP; segredo sera rotacionado e guardado somente no ambiente seguro da Vercel.
- Imagens de produtos existentes permanecem como arquivos de origem. O catalogo web inicia sem produtos importados; associar/reutilizar imagens sera uma operacao explicita de cadastro.

## 8. Responsividade e criterios de aceite

Todas as telas, inclusive cadastro, login, vendas e painel administrativo, devem funcionar em desktop e smartphone: layout fluido, formularios acessiveis, tabelas adaptadas para cartoes/rolagem apropriada, botoes acionaveis por toque e mensagens legiveis. Administracao continua restrita ao perfil `admin` tanto na interface quanto na API.

Antes de considerar o desenho pronto para implementacao, os criterios sao:

1. Migracoes criam chaves, restricoes e indices sem conter dados ou segredos reais.
2. Cadastro publico nunca consegue atribuir perfil de administrador.
3. API rejeita usuario inativo e acessos administrativos de `user`.
4. Exclusao exige confirmacao do e-mail, revoga sessoes e preserva registros de negocio.
5. Nao e possivel remover/desativar o ultimo administrador ativo.
6. Venda e baixa de estoque sao atomicas; cancelamento compensa o estoque sem apagar historico.
7. Uma venda pode conter varios itens; historico preserva precos aplicados.
8. Reexecucao do agendamento nao duplica felicitações concluidas; regra de 29/02 e testada.
9. Fluxos principais sao utilizaveis em resolucoes desktop e mobile.
10. Frontend e API implantam como projetos Vercel separados a partir do mesmo repositorio, conectando a um PostgreSQL gerenciado.

## 9. Etapas seguintes

1. Revisar esta especificacao e registrar eventuais ajustes.
2. Confirmar se a regiao especifica Sao Paulo esta disponivel no fluxo Supabase ou via suporte; se nao estiver, manter o projeto atual em Virginia e alinhar a API Vercel; confirmar plano e estrategia de backup/restauracao.
3. Criar e configurar o repositorio unico com `frontend/`, `backend/` e protecao da branch principal.
4. Implementar estrutura e testes do backend e frontend em entregas pequenas, com Issues, branches e PRs.
5. Cadastrar dados reais somente depois de autenticar o ambiente, configurar segredos e validar backups.
