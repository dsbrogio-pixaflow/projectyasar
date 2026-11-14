// -----------------------------
// File: SalesControl.java
// -----------------------------

import javax.swing.*;
import javax.swing.table.DefaultTableCellRenderer;
import javax.swing.table.DefaultTableModel;
import java.awt.*;
import java.awt.event.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.text.NumberFormat;
import java.util.Locale;

public class SalesControl extends JFrame {
  private DefaultTableModel model;
  private DefaultTableModel totalModel;
  private JComboBox<String> comboProd;
  private JComboBox<String> comboClientes;
  private JComboBox<String> comboEntrega;
  private final String filename = "txt/Controle_Vendas.txt";
  private final String estoqueFile = "txt/Controle_Estoque.txt";
  private final String entregaFile = "txt/Controle_Forma_Entrega.txt";
  private int proximoId = 1;
  private JTable table;
  private JTable totalTable;

  public SalesControl() {
    setTitle("Controle de Vendas");
    setSize(1300, 700);
    setDefaultCloseOperation(JFrame.DISPOSE_ON_CLOSE);
    setLocationRelativeTo(null);
    setLayout(new BorderLayout());

    DateTimeFormatter df = DateTimeFormatter.ofPattern("dd/MM/yyyy");
    JTextField txtDate = new JTextField(LocalDate.now().format(df), 10);

    comboClientes = new JComboBox<>();
    comboProd = new JComboBox<>();
    comboEntrega = new JComboBox<>();

    JSpinner spinnerQty = new JSpinner(new SpinnerNumberModel(1, 1, 1000, 1));
    JTextField txtPrice = new JTextField(6);
    JButton btnAdd = new JButton("Registrar Venda");
    JButton btnRemover = new JButton("Remover Venda");
    JButton btnAddCliente = new JButton("Cadastrar Cliente");
    JButton btnAddEntrega = new JButton("+ Nova Forma de Entrega");
    
    // Define que a tecla ENTER aciona a ação de clique no botão
    InputMap inputMap = btnAdd.getInputMap(JComponent.WHEN_IN_FOCUSED_WINDOW);
    ActionMap actionMap = btnAdd.getActionMap();

    inputMap.put(KeyStroke.getKeyStroke(KeyEvent.VK_ENTER, 0), "enterAction");
    actionMap.put("enterAction", new AbstractAction() {
    @Override
    public void actionPerformed(ActionEvent e) {
        btnAdd.doClick(); // Simula o clique no botão Registrar Venda
      }});

    loadClientes();
    loadProducts();
    loadFormasEntrega();

    // ---- Tabela principal ----
    model = new DefaultTableModel(new String[]{
        "ID Venda", "Data", "Cliente", "Produto", "Quantidade", "Valor Unitário", "Forma de Entrega", "Total"
    }, 0) {
      @Override
      public Class<?> getColumnClass(int column) {
        switch (column) {
          case 0: return Integer.class;
          case 4: return Integer.class;
          case 5:
          case 7: return Double.class;
          default: return String.class;
        }
      }

      @Override
      public boolean isCellEditable(int row, int column) { return false; }
    };

    table = new JTable(model);
    table.setRowHeight(30);
    add(new JScrollPane(table), BorderLayout.CENTER);

    // ---- Tabela de totais ----
    totalModel = new DefaultTableModel(new String[]{"Produto", "Quantidade Total", "Total Vendido"}, 0) {
      @Override
      public boolean isCellEditable(int row, int column) { return false; }
      @Override
      public Class<?> getColumnClass(int columnIndex) {
        if (columnIndex == 1) return Integer.class;
        if (columnIndex == 2) return Double.class;
        return String.class;
      }
    };
    totalTable = new JTable(totalModel);
    totalTable.setRowHeight(25);

    JPanel bottomPanel = new JPanel(new BorderLayout());
    bottomPanel.setBorder(BorderFactory.createTitledBorder("Resumo de Vendas"));
    bottomPanel.add(new JScrollPane(totalTable), BorderLayout.CENTER);
    bottomPanel.setPreferredSize(new Dimension(0, 200));
    add(bottomPanel, BorderLayout.SOUTH);

    // ---- Painel superior ----
    JPanel top = new JPanel(new GridLayout(2, 1));
    JPanel linha1 = new JPanel(new FlowLayout(FlowLayout.LEFT));
    JPanel linha2 = new JPanel(new FlowLayout(FlowLayout.LEFT));

    linha1.add(new JLabel("Data:")); linha1.add(txtDate);
    linha1.add(new JLabel("Cliente:")); linha1.add(comboClientes);
    linha1.add(new JLabel("Produto:")); linha1.add(comboProd);
    linha1.add(new JLabel("Qtd:")); linha1.add(spinnerQty);
    linha1.add(new JLabel("Valor Unit.:")); linha1.add(txtPrice);
    linha1.add(new JLabel("Forma de Entrega:")); linha1.add(comboEntrega);

    linha2.add(btnAddCliente); linha2.add(btnAddEntrega); linha2.add(btnAdd); linha2.add(btnRemover);

    top.add(linha1); top.add(linha2); add(top, BorderLayout.NORTH);






    // ---- Renderizador centralizado e monetário ----
    DefaultTableCellRenderer centerRenderer = new DefaultTableCellRenderer() {
      private final NumberFormat moneyFormat =
    NumberFormat.getCurrencyInstance(Locale.of("pt", "BR"));
      @Override
      public Component getTableCellRendererComponent(JTable table, Object value,
                             boolean isSelected, boolean hasFocus,
                            int row, int column) {
        Component c = super.getTableCellRendererComponent(table, value, isSelected, hasFocus, row, column);
        setHorizontalAlignment(SwingConstants.CENTER);
        if (value instanceof Double) {
         
          double val = (Double) value;
          setText(moneyFormat.format(val)); // Usa o formato brasileiro (vírgula decimal)


      // Lógica de cores
      if ((table == SalesControl.this.totalTable && column == 2) || (table == SalesControl.this.table && column == 7)) {
        if (val < 0) {
          c.setBackground(new Color(255, 200, 200));
          c.setForeground(Color.RED.darker());
        }
        else {
          c.setBackground(new Color(200, 255, 200));
          c.setForeground(new Color(0, 128, 0));
        }
      } else { c.setBackground(Color.WHITE); c.setForeground(Color.BLACK); }
     
    } else { c.setBackground(Color.WHITE); c.setForeground(Color.BLACK); }
    return c;
      }
    };

    for (int i = 0; i < table.getColumnCount(); i++) table.getColumnModel().getColumn(i).setCellRenderer(centerRenderer);
    for (int i = 0; i < totalTable.getColumnCount(); i++) totalTable.getColumnModel().getColumn(i).setCellRenderer(centerRenderer);
    ((DefaultTableCellRenderer) table.getTableHeader().getDefaultRenderer()).setHorizontalAlignment(SwingConstants.CENTER);
    ((DefaultTableCellRenderer) totalTable.getTableHeader().getDefaultRenderer()).setHorizontalAlignment(SwingConstants.CENTER);

    // ---- Carrega dados existentes ----
    load();
    definirProximoId();

    // ---- Ação principal: registrar venda ----
    btnAdd.addActionListener(e -> {
      String date = txtDate.getText().trim();
      String cliente = (String) comboClientes.getSelectedItem();
      String prod = (String) comboProd.getSelectedItem();
      String entrega = (String) comboEntrega.getSelectedItem();
      int qty = (Integer) spinnerQty.getValue();
      double price;

      if (date.isEmpty() || cliente == null || prod == null || entrega == null) {
        JOptionPane.showMessageDialog(this, "Preencha todos os campos obrigatórios!");
        return;
      }

      try {
        // CORREÇÃO APLICADA: Estrutura correta do try/catch
        String priceText = txtPrice.getText().trim().replace(",", ".");
        price = Double.parseDouble(priceText);
      } 
      catch (Exception ex) {
        JOptionPane.showMessageDialog(this, "Informe um valor válido! (Ex: 100,50)");
        return;
      }

      if (qty <= 0) {
        JOptionPane.showMessageDialog(this, "Quantidade deve ser maior que zero!"); return; }

      int estoqueAtual = getEstoqueAtual(prod);
      if (qty > estoqueAtual) {
        JOptionPane.showMessageDialog(this, "Estoque insuficiente! Estoque atual: " + estoqueAtual, "Erro", JOptionPane.ERROR_MESSAGE);
        return;
      }

      double total = qty * price;
      int idVenda = proximoId++;
      model.addRow(new Object[]{idVenda, date, cliente, prod, qty, price, entrega, total});

      atualizarTotais(prod, qty, total);
      registrarSaidaEstoque(date, prod, qty);
      autoSave();

      txtDate.setText(LocalDate.now().format(df));
      spinnerQty.setValue(1);
      txtPrice.setText("");
    });

    btnRemover.addActionListener(e -> removerVenda(table));
    btnAddCliente.addActionListener(e -> new ClienteControl().setVisible(true));
    btnAddEntrega.addActionListener(e -> abrirTelaNovaFormaEntrega());

    addWindowListener(new WindowAdapter() {
      @Override
      public void windowClosing(WindowEvent e) { autoSave(); }
    });
  }

  // ---------------------------
  // Funções auxiliares
  // ---------------------------

  private void removerVenda(JTable table) {
    int row = table.getSelectedRow();
    if (row == -1) { JOptionPane.showMessageDialog(this, "Selecione uma venda para remover!"); return; }

    int confirm = JOptionPane.showConfirmDialog(this, "Tem certeza que deseja remover esta venda?", "Confirmar remoção", JOptionPane.YES_NO_OPTION);
    if (confirm == JOptionPane.YES_OPTION) {
      String produto = (String) model.getValueAt(row, 3);
      int quantidade = (Integer) model.getValueAt(row, 4);
      double total = (Double) model.getValueAt(row, 7);

      for (int r = 0; r < totalModel.getRowCount(); r++) {
        if (totalModel.getValueAt(r, 0).equals(produto)) {
          totalModel.setValueAt(Math.max(0, (Integer)totalModel.getValueAt(r,1) - quantidade), r, 1);
          totalModel.setValueAt(Math.max(0, (Double)totalModel.getValueAt(r,2) - total), r, 2);
          break;
        }
      }
      model.removeRow(row);
      autoSave();
    }
  }

  private void abrirTelaNovaFormaEntrega() {
    String novaForma = JOptionPane.showInputDialog(this, "Digite o nome da nova forma de entrega:");
    if (novaForma != null && !novaForma.trim().isEmpty()) {
      novaForma = novaForma.trim();
      comboEntrega.addItem(novaForma);
      salvarFormaEntrega(novaForma);
      JOptionPane.showMessageDialog(this, "Nova forma de entrega adicionada!");
    }
  }

  private void salvarFormaEntrega(String forma) {
    try (BufferedWriter bw = new BufferedWriter(new OutputStreamWriter(new FileOutputStream(entregaFile,true), StandardCharsets.UTF_8))) {
      bw.write(forma); bw.newLine();
    } catch (IOException e) { JOptionPane.showMessageDialog(this, "Erro ao salvar forma de entrega: " + e.getMessage()); }
  }

  private void loadFormasEntrega() {
    comboEntrega.removeAllItems();
    File file = new File(entregaFile);
    if (!file.exists()) {
      try (BufferedWriter bw = new BufferedWriter(new OutputStreamWriter(new FileOutputStream(file), StandardCharsets.UTF_8))) {
        bw.write("Sedex\nTransportadora\nRetirada na loja\nEntregar pessoalmente\n");
      } catch (IOException ignored) {}
    }
    try (BufferedReader br = new BufferedReader(new InputStreamReader(new FileInputStream(file), StandardCharsets.UTF_8))) {
      String line; while ((line = br.readLine()) != null) if (!line.trim().isEmpty()) comboEntrega.addItem(line.trim());
    } catch (IOException e) { JOptionPane.showMessageDialog(this, "Erro ao carregar formas de entrega: " + e.getMessage()); }
  }

  private void loadClientes() {
    File file = new File("txt/Controle_Clientes.txt");
    comboClientes.removeAllItems();
    if (!file.exists()) return;
    try (BufferedReader br = new BufferedReader(new InputStreamReader(new FileInputStream(file), StandardCharsets.UTF_8))) {
      String linha; while ((linha = br.readLine()) != null) { String[] parts = linha.split(";"); if (parts.length>=2) comboClientes.addItem(parts[1]); }
    } catch (IOException e) { JOptionPane.showMessageDialog(this, "Erro ao carregar clientes: " + e.getMessage()); }
  }

  private void loadProducts() {
    List<String> lines = FileUtil.readLines("txt/Controle_Loja.txt");
    comboProd.removeAllItems();
    for (String line : lines) { String[] parts = line.split(";"); if (parts.length>=2) comboProd.addItem(parts[1]); }
  }

  private void atualizarTotais(String produto, int quantidade, double total) {
    boolean encontrado=false;
    for(int r=0;r<totalModel.getRowCount();r++){
      if(totalModel.getValueAt(r,0).equals(produto)){
        totalModel.setValueAt((Integer)totalModel.getValueAt(r,1)+quantidade,r,1);
        totalModel.setValueAt((Double)totalModel.getValueAt(r,2)+total,r,2);
        encontrado=true; break;
      }
    }
    if(!encontrado) totalModel.addRow(new Object[]{produto, quantidade, total});
  }

  // ---------------------------
  // Estoque adaptado para seu arquivo atual
  // ---------------------------
  private int getEstoqueAtual(String produto){
    List<String> lines = FileUtil.readLines(estoqueFile);
    int total = 0;
    for(String l: lines){
      String[] parts = l.split(";");
      if(parts.length >= 4 && parts[1].equals(produto)){
        String tipo = parts[2].trim();
        int qty = 0;
        try{ qty = Integer.parseInt(parts[3].trim()); } catch(Exception ignored){}
        if(tipo.equalsIgnoreCase("Entrada")) total += qty;
        if(tipo.equalsIgnoreCase("Saída")) total -= qty;
      }
    }
    return total;
  }

  private void registrarSaidaEstoque(String date, String produto, int quantidade){
    List<String> lines = FileUtil.readLines(estoqueFile);
    lines.add(date + ";" + produto + ";Saída;" + quantidade + ";");
    FileUtil.saveLines(estoqueFile, lines);
  }

  private void definirProximoId(){
    int maiorId=0;
    for(int r=0;r<model.getRowCount();r++){
      try{ int id=Integer.parseInt(model.getValueAt(r,0).toString()); if(id>maiorId) maiorId=id;}catch(Exception ignored){}
    }
    proximoId=maiorId+1;
  }

  private void load(){
    try(BufferedReader br=new BufferedReader(new InputStreamReader(new FileInputStream(filename),StandardCharsets.UTF_8))){
      String l; while((l=br.readLine())!=null){
        String[] parts=l.split(";");
        if(parts.length>=8){
          try{
            int id=Integer.parseInt(parts[0]);
            int qty=Integer.parseInt(parts[4]);
            double price=Double.parseDouble(parts[5]);
            double total=Double.parseDouble(parts[7]);
            model.addRow(new Object[]{id,parts[1],parts[2],parts[3],qty,price,parts[6],total});
            atualizarTotais(parts[3],qty,total);
          }catch(Exception ignored){}
        }
      }
    }catch(FileNotFoundException ignored){}catch(IOException e){JOptionPane.showMessageDialog(this,"Erro ao carregar vendas: "+e.getMessage());}
  }

  private void autoSave() {
    List<String> lines = new ArrayList<>();
    DateTimeFormatter df = DateTimeFormatter.ofPattern("dd/MM/yyyy");
    List<String[]> registros = new ArrayList<>();

    for (int r = 0; r < model.getRowCount(); r++) {
      String[] parts = new String[model.getColumnCount()];
      for (int c = 0; c < model.getColumnCount(); c++) {
        Object val = model.getValueAt(r, c);
        parts[c] = (val == null ? "" : val.toString());
      }
      registros.add(parts);
    }

    // Ordenar por data (mais recente primeiro)
    registros.sort((a, b) -> {
      try {
        LocalDate da = LocalDate.parse(a[1], df);
        LocalDate db = LocalDate.parse(b[1], df);
        return db.compareTo(da); // Descendente
      } catch (Exception e) { return 0; }
    });

    for (String[] reg : registros) {
      StringBuilder sb = new StringBuilder();
      for (String p : reg) sb.append(p).append(";");
      lines.add(sb.toString());
    }

    try (BufferedWriter bw = new BufferedWriter(new OutputStreamWriter(
        new FileOutputStream(filename), StandardCharsets.UTF_8))) {
      for (String line : lines) {
        bw.write(line);
        bw.newLine();
      }
    } catch (IOException e) {
      JOptionPane.showMessageDialog(this, "Erro ao salvar arquivo: " + e.getMessage());
    }
  }

  public static void main(String[] args){
    SwingUtilities.invokeLater(() -> new SalesControl().setVisible(true));
  }
}