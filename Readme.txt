SeuProjeto/
│
├── src/
│   ├── Yasar.java
│   ├── ClienteControl.java
│   ├── FinancialControl.java
│   ├── CalendarControl.java
│   ├── ItemsStoreControl.java
│   ├── StockControl.java
│   ├── SalesControl.java
│   ├── DeliveryControl.java
│   └── DashboardControl.java
│
└── txt/
    ├── Controle_Clientes.txt
    ├── Controle_Financeiro.txt
    ├── Controle_Vendas.txt
    ├── Controle_Entregas.txt
    ├── Controle_Estoque.txt
    ├── Tipos_Despesas.txt
    └── Calendario_Eventos.txt

Estrutura da chamada de Arquivos:

├ Yasar.java                 ├ Controle Clientes.txt
  ├ ClienteControl.java      ├ FileUtil.java  ├ Controle Clientes.txt   			(1)
  ├ ItemsStoreControl.java   ├ FileUtil.java  ├ Controle Itens da Loja.txt			(2)
  ├ StockControl.java        ├ FileUtil.java  ├ Controle Estoque.txt				(3)
  ├ SalesControl.java        ├ FileUtil.java  ├ Controle Estoque.txt, Controle Vendas.txt, Forma de entrega.txt
  ├ DeliveryControl.java     ├ FileUtil.java  ├ Controle Entregas.txt, Controle Vendas.txt, Controle Clientes.txt
  ├ FinancialControl.java    ├ FileUtil.java  ├ Controle Financeiro.txt
  ├ CalendarControl.java     ├ EmailConfigDialog.java ├ FileUtil.java  ├ config_email.txt
  ├ Dashboard.java  
  ├ /images/

DeliveryControl.java


Estrutura de Arquivos:

*├ Yasar.java
*  ├ StockControl.java (Estoque dos itens cadastrados)        
*  ├ FileUtil.java  (controle de gravação de dados nos arquivos .txt)
  ├ FinancialControl.java (Controle de pagamentos de contas, gastos e ganhos)   
  ├ CalendarControl.java (Controle de eventos, aniversários, feriados)   
  ├ ItemsStoreControl.java (Itens cadastrados para venda na loja)   
*  ├ SalesControl.java (Controle de vendas)
  ├ DeliveryControl.java (Controle de entrega das vendas)
  ├ Dashboard.java  (Visualização gráfica para acompanhamento da empresa)
*  ├ Controle Vendas.txt (Arquivo de armazenamento de dados)
*  ├ Controle Itens da Loja.txt (Arquivo de armazenamento de dados)
*  ├ Controle Calendario.txt (Arquivo de armazenamento de dados)
*  ├ Controle Estoque.txt (Arquivo de armazenamento de dados)
*  ├ Controle Financeiro.txt (Arquivo de armazenamento de dados)
*  ├ /images/
   ├ /txt/



Instruções para Compilar e Executar:

Abra o terminal ou prompt de comando.

Navegue até o diretório raiz do projeto (onde está a pasta src).

Compile todos os arquivos Java:


javac -cp ".;lib/*" Yasar.java

E para executar:

java -cp ".;lib/*" Yasar


javac -Xlint:deprecation Yasar.java