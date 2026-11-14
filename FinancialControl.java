// -----------------------------
// File: FinancialControl.java
// -----------------------------
import javax.swing.*;
import javax.swing.table.DefaultTableCellRenderer;
import javax.swing.table.DefaultTableModel;
import java.awt.*;
import java.awt.event.WindowAdapter;
import java.awt.event.WindowEvent;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.*;
import java.util.List;
import java.text.NumberFormat;
import java.util.Locale;
import java.awt.event.ActionEvent;
import java.awt.event.KeyEvent;
import javax.swing.AbstractAction;
import javax.swing.ActionMap;
import javax.swing.InputMap;
import javax.swing.JComponent;
import javax.swing.KeyStroke;

    public class FinancialControl extends JFrame {
    private Map<String, Double> financeiroMensal = new LinkedHashMap<>();
    private DefaultTableModel model;
    private DefaultTableModel totalModel;
    private JComboBox<String> comboPagamento;
    private final String filename = "txt/Controle_Financeiro.txt";
    private final String tiposPagamentoFile = "txt/Controle_Tipo_Pagamento.txt";
    private JTable table;
    private JTable totalTable;
    private SimpleDateFormat sdf = new SimpleDateFormat("dd/MM/yyyy");
    public FinancialControl() {
        setTitle("Controle Financeiro");
        setSize(1300, 700);
        setDefaultCloseOperation(JFrame.DISPOSE_ON_CLOSE);
        setLocationRelativeTo(null);
        setLayout(new BorderLayout());

        // ======= Painel Superior =======
        JPanel topPanel = new JPanel(new FlowLayout(FlowLayout.LEFT));
        JTextField txtData = new JTextField(8);
        comboPagamento = new JComboBox<>();
        carregarTiposPagamento();
        txtData.setText(sdf.format(new Date()));
        JTextField txtValor = new JTextField(8);
        JButton btnRegistrar = new JButton("Registrar Pagamento");
        JButton btnRemover = new JButton("Remover Entrada");
        JButton btnNovoTipo = new JButton("Adicionar Novo Tipo de Despesa");
        
        // Associa a tecla ENTER ao clique do botão btnRegistrar
        InputMap inputMap = btnRegistrar.getInputMap(JComponent.WHEN_IN_FOCUSED_WINDOW);
        ActionMap actionMap = btnRegistrar.getActionMap();

        // Mapeia a tecla ENTER para a ação "enterAction"
        inputMap.put(KeyStroke.getKeyStroke(KeyEvent.VK_ENTER, 0), "enterAction");
        actionMap.put("enterAction", new AbstractAction() {
        @Override
        public void actionPerformed(ActionEvent e) {
        btnRegistrar.doClick(); // Simula o clique no botão
        }});

        topPanel.add(new JLabel("Data:"));
        topPanel.add(txtData);
        topPanel.add(new JLabel("Tipo Despesa:"));
        topPanel.add(comboPagamento);
        topPanel.add(btnNovoTipo);
        topPanel.add(new JLabel("Valor:"));
        topPanel.add(txtValor);
        topPanel.add(btnRegistrar);
        topPanel.add(btnRemover);
        add(topPanel, BorderLayout.NORTH);

        // ======= Tabela principal =======
        model = new DefaultTableModel(new String[]{"Data", "Tipo Pagamento", "Valor"}, 0) {
        @Override
        public boolean isCellEditable(int row, int col) { return false; }
        @Override
        public Class<?> getColumnClass(int col) {
        return col == 2 ? Double.class : String.class;
        }};

        table = new JTable(model);
        table.setRowHeight(28);

        // Renderizador centralizado e formatação monetária
        DefaultTableCellRenderer moneyRenderer = new DefaultTableCellRenderer() {
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
        setText(moneyFormat.format(val));

        // Lógica para cores: Lucro (Verde) ou Prejuízo (Vermelho)
        if (table.getModel() == totalModel && column == 2) { 
        if (val >= 0) { c.setForeground(new Color(0, 153, 0)); } // Verde para Lucro
        else { c.setForeground(Color.RED); }} // Vermelho para Prejuízo
        else { c.setForeground(Color.BLACK); } // Padrão
        c.setBackground(Color.WHITE);
        if (isSelected) c.setBackground(table.getSelectionBackground());
        } else {
        c.setBackground(Color.WHITE);
        c.setForeground(Color.BLACK); }
        return c; }};
        for (int i = 0; i < 3; i++) table.getColumnModel().getColumn(i).setCellRenderer(moneyRenderer);
        add(new JScrollPane(table), BorderLayout.CENTER);

        // ======= Tabela de resumo =======
        totalModel = new DefaultTableModel(new String[]{"Total Vendas", "Total Pagamentos", "Lucro / Prejuízo"}, 0) {
        @Override
        public boolean isCellEditable(int r, int c) { return false; }
        @Override
        public Class<?> getColumnClass(int col) { return Double.class; }};
        totalTable = new JTable(totalModel);
        totalTable.setRowHeight(25);
        for (int i = 0; i < 3; i++) totalTable.getColumnModel().getColumn(i).setCellRenderer(moneyRenderer);
        JPanel bottomPanel = new JPanel(new BorderLayout());
        bottomPanel.setBorder(BorderFactory.createTitledBorder("Resumo Financeiro"));
        bottomPanel.add(new JScrollPane(totalTable), BorderLayout.CENTER);
        bottomPanel.setPreferredSize(new Dimension(0, 120));
        add(bottomPanel, BorderLayout.SOUTH);

        // ======= Ações =======
        btnRegistrar.addActionListener(e -> {
        String data = padronizarData(txtData.getText().trim());
        String tipo = (String) comboPagamento.getSelectedItem();
        double valor;
        if (data.isEmpty() || tipo == null) { JOptionPane.showMessageDialog(this, "Preencha a data e selecione o tipo!"); return; }
        try { 

        // AQUI: Adiciona .replace(",", ".") para aceitar vírgula na entrada
        valor = Double.parseDouble(txtValor.getText().trim().replace(",", ".")); 
        } catch (Exception ex) { 
        JOptionPane.showMessageDialog(this, "Informe um valor válido! Use ponto ou vírgula para separar centavos."); return; 
        }
        valor = Math.round(valor * 100.0) / 100.0;
        model.addRow(new Object[]{data, tipo, valor});
        ordenarTabelaPorDataDesc();
        autoSave();
        atualizarTotais();
        txtValor.setText("");
        txtData.setText(sdf.format(new Date()));});

        btnRemover.addActionListener(e -> {
        int row = table.getSelectedRow();
        if (row == -1) { JOptionPane.showMessageDialog(this, "Selecione uma entrada para remover!"); return; }
        int confirm = JOptionPane.showConfirmDialog(this, "Tem certeza que deseja remover esta entrada?", "Confirmar Remoção", JOptionPane.YES_NO_OPTION);
        if (confirm == JOptionPane.YES_OPTION) {
        model.removeRow(row);
        autoSave();
        atualizarTotais(); }});
        btnNovoTipo.addActionListener(e -> abrirTelaNovoTipoPagamento());
        load();
        padronizarTodasDatas();
        ordenarTabelaPorDataDesc();
        atualizarTotais();
        addWindowListener(new WindowAdapter() {
        @Override
        public void windowClosing(WindowEvent e) {
        autoSave(); }});}

    // ======= Padroniza uma data individual =======
        private String padronizarData(String data) {
        try {
        String[] partes = data.split("/");
        if (partes.length != 3) return data;
        int dia = Integer.parseInt(partes[0].trim());
        int mes = Integer.parseInt(partes[1].trim());
        int ano = Integer.parseInt(partes[2].trim());
        return String.format("%02d/%02d/%04d", dia, mes, ano);
        } catch (Exception e) {
        return data; }}

    // ======= Padroniza todas as datas da tabela =======
    private void padronizarTodasDatas() {
    for (int r = 0; r < model.getRowCount(); r++) {
    String data = (String) model.getValueAt(r, 0);
    model.setValueAt(padronizarData(data), r, 0);}
    autoSave();}

    private void loadFinanceData() {
    File file = new File("txt/Controle_Financeiro.txt");
    if (!file.exists()) return;
    try (BufferedReader br = new BufferedReader(new InputStreamReader(new FileInputStream(file), StandardCharsets.UTF_8))) {
    String linha;
    while ((linha = br.readLine()) != null) {
    String[] p = linha.split(";");
    if (p.length >= 3) {
    try {

    // Padroniza a data para dd/MM/yyyy
    String[] partes = p[0].split("/");
    int dia = Integer.parseInt(partes[0].trim());
    int mes = Integer.parseInt(partes[1].trim());
    int ano = Integer.parseInt(partes[2].trim());
    String data = String.format("%02d/%02d/%04d", dia, mes, ano);
    String mesKey = data.substring(6, 10) + "-" + data.substring(3, 5); // AAAA-MM
    double valor = Double.parseDouble(p[2].trim());
    financeiroMensal.put(mesKey, financeiroMensal.getOrDefault(mesKey, 0.0) + valor);
    } catch (Exception ignored) {}}}
    } catch (IOException e) { e.printStackTrace(); }}

    // ======= Ordena por data decrescente =======
    private void ordenarTabelaPorDataDesc() {
    List<Object[]> linhas = new ArrayList<>();
    for (int r = 0; r < model.getRowCount(); r++) {
    linhas.add(new Object[]{model.getValueAt(r,0), model.getValueAt(r,1), model.getValueAt(r,2)});}
    linhas.sort((a,b) -> {
    try { return sdf.parse((String)b[0]).compareTo(sdf.parse((String)a[0])); }
    catch (Exception e) { return 0; }});
    model.setRowCount(0);
    for (Object[] l : linhas) model.addRow(l);}

    // ======= Salva mantendo ordem decrescente =======
    private void autoSave() {
    ordenarTabelaPorDataDesc();
    try (Writer out = new BufferedWriter(new OutputStreamWriter(new FileOutputStream(filename), StandardCharsets.UTF_8))) {
    for (int r = 0; r < model.getRowCount(); r++) {
    String data = padronizarData((String) model.getValueAt(r, 0));
    out.write(data + ";" + model.getValueAt(r, 1) + ";" + model.getValueAt(r, 2) + ";\n");}
    } catch (IOException e) {
    JOptionPane.showMessageDialog(this, "Erro ao salvar: " + e.getMessage());}}

    // ======= Carrega dados do arquivo =======
    private void load() {
    File file = new File(filename);
    if (!file.exists()) return;
    try (BufferedReader br = new BufferedReader(new InputStreamReader(new FileInputStream(file), StandardCharsets.UTF_8))) {
    String linha;
    while ((linha = br.readLine()) != null) {
    String[] parts = linha.split(";");
    if (parts.length >= 3) {
    try {
    String data = padronizarData(parts[0]);
    model.addRow(new Object[]{data, parts[1], Double.parseDouble(parts[2])});
    } catch (Exception ignored) {}}}
    } catch (IOException e) { JOptionPane.showMessageDialog(this, "Erro ao carregar: " + e.getMessage()); }}

    // ======= Totais =======
    private void atualizarTotais() {
    double totalPagamentos = 0;
    for (int r = 0; r < model.getRowCount(); r++) totalPagamentos += (double) model.getValueAt(r, 2);
    double totalVendas = carregarTotalVendas();
    double lucro = totalVendas - totalPagamentos;
    totalModel.setRowCount(0);
    totalModel.addRow(new Object[]{totalVendas, totalPagamentos, lucro});
    totalTable.repaint();}

    private double carregarTotalVendas() {
    double total = 0;
    File file = new File("txt/Controle_Vendas.txt");
    if (!file.exists()) return total;
    try (BufferedReader br = new BufferedReader(new InputStreamReader(new FileInputStream(file), StandardCharsets.UTF_8))) {
    String linha;
    while ((linha = br.readLine()) != null) {
    String[] parts = linha.split(";");
    if (parts.length >= 8) {
    try { total += Double.parseDouble(parts[7]); } catch (Exception ignored) {}}}
    } catch (IOException e) { JOptionPane.showMessageDialog(this, "Erro ao ler vendas: " + e.getMessage()); }
    return total;}

    // ======= Tipos de Pagamento =======
    private void abrirTelaNovoTipoPagamento() {
    JFrame tipoFrame = new JFrame("Novo Tipo de Pagamento");
    tipoFrame.setSize(400, 150);
    tipoFrame.setLocationRelativeTo(this);
    tipoFrame.setLayout(new FlowLayout());
    JTextField txtTipo = new JTextField(20);
    JButton btnSalvar = new JButton("Salvar");
    tipoFrame.add(new JLabel("Nome do tipo de pagamento:"));
    tipoFrame.add(txtTipo);
    tipoFrame.add(btnSalvar);
    btnSalvar.addActionListener(e -> {
    String novoTipo = txtTipo.getText().trim();
    if (novoTipo.isEmpty()) { JOptionPane.showMessageDialog(tipoFrame, "Digite um nome válido."); return; }
    try (Writer out = new BufferedWriter(new OutputStreamWriter(new FileOutputStream(tiposPagamentoFile, true), StandardCharsets.UTF_8))) {
    out.write(novoTipo + "\n");
    } catch (IOException ex) { JOptionPane.showMessageDialog(tipoFrame, "Erro ao salvar tipo: " + ex.getMessage()); }
    comboPagamento.addItem(novoTipo);
    JOptionPane.showMessageDialog(tipoFrame, "Tipo de pagamento adicionado com sucesso!");
    tipoFrame.dispose();});
    tipoFrame.setVisible(true);}

    private void carregarTiposPagamento() {
    comboPagamento.removeAllItems();
    try (BufferedReader br = new BufferedReader(new InputStreamReader(new FileInputStream(tiposPagamentoFile), StandardCharsets.UTF_8))) {
    String line;
    while ((line = br.readLine()) != null) if (!line.trim().isEmpty()) comboPagamento.addItem(line.trim());
    } catch (IOException ignored) {}}

    public static void main(String[] args) {
    SwingUtilities.invokeLater(() -> new FinancialControl().setVisible(true));}}