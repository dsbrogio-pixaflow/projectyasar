// -----------------------------
// File: StockControl.java
// -----------------------------

import javax.swing.*;
import javax.swing.table.DefaultTableCellRenderer;
import javax.swing.table.DefaultTableModel;
import java.awt.*;
import java.awt.event.WindowAdapter;
import java.awt.event.WindowEvent;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.*;

public class StockControl extends JFrame {
    private DefaultTableModel model;
    private DefaultTableModel totalsModel;
    private final String filename = "txt/Controle_Estoque.txt";
    private JComboBox<String> comboProd;
    private boolean updating = false; // evita loop infinito

    public StockControl() {
        setTitle("Controle de Estoque");
        setSize(1300, 700);
        setDefaultCloseOperation(JFrame.DISPOSE_ON_CLOSE);
        setLocationRelativeTo(null);

        // ----- Modelo da tabela principal -----
        model = new DefaultTableModel(new String[]{"Data", "Produto", "Entrada/Saída", "Quantidade"}, 0) {
            @Override
            public Class<?> getColumnClass(int columnIndex) {
                return (columnIndex == 3) ? Integer.class : Object.class;
            }

            @Override
            public boolean isCellEditable(int row, int column) {
                return column == 2 || column == 3;
            }
        };

        JTable table = new JTable(model);
        table.setRowHeight(30);

        // ----- Centralização -----
        DefaultTableCellRenderer centerRenderer = new DefaultTableCellRenderer();
        centerRenderer.setHorizontalAlignment(SwingConstants.CENTER);
        for (int i = 0; i < table.getColumnCount(); i++) {
            table.getColumnModel().getColumn(i).setCellRenderer(centerRenderer);
        }
        ((DefaultTableCellRenderer) table.getTableHeader().getDefaultRenderer())
                .setHorizontalAlignment(SwingConstants.CENTER);

        // ----- Adiciona ComboBox nas linhas da coluna "Entrada/Saída" -----
        JComboBox<String> comboTipo = new JComboBox<>(new String[]{"Entrada", "Saída"});
        table.getColumnModel().getColumn(2).setCellEditor(new DefaultCellEditor(comboTipo));

        // ----- Renderer colorido para coluna Quantidade -----
        DefaultTableCellRenderer qtyRenderer = new DefaultTableCellRenderer() {
            @Override
            public Component getTableCellRendererComponent(JTable table, Object value,
                                                           boolean isSelected, boolean hasFocus,
                                                           int row, int column) {
                Component c = super.getTableCellRendererComponent(table, value, isSelected, hasFocus, row, column);
                c.setFont(c.getFont().deriveFont(Font.BOLD));
                setHorizontalAlignment(SwingConstants.CENTER);

                String tipo = (String) table.getValueAt(row, 2);
                if ("Entrada".equalsIgnoreCase(tipo)) {
                    setForeground(new Color(0, 128, 0)); // verde
                } else if ("Saída".equalsIgnoreCase(tipo)) {
                    setForeground(Color.RED); // vermelho
                } else {
                    setForeground(Color.BLACK);
                }

                if (isSelected) c.setBackground(table.getSelectionBackground());
                else c.setBackground(Color.WHITE);

                return c;
            }
        };
        table.getColumnModel().getColumn(3).setCellRenderer(qtyRenderer);

        add(new JScrollPane(table), BorderLayout.CENTER);

        // ----- Painel superior com checkboxes (mantidos) -----
        JPanel top = new JPanel(new FlowLayout());
        DateTimeFormatter df = DateTimeFormatter.ofPattern("dd/MM/yyyy");
        JTextField txtDate = new JTextField(LocalDate.now().format(df), 10);

        comboProd = new JComboBox<>();
        loadProducts();

        JSpinner spinnerQty = new JSpinner(new SpinnerNumberModel(1, 1, 1000, 1));
        JCheckBox cbEntrada = new JCheckBox("Entrada", true);
        JCheckBox cbSaida = new JCheckBox("Saída");

        // Exclusividade no cabeçalho
        cbEntrada.addActionListener(e -> {
            if (cbEntrada.isSelected()) cbSaida.setSelected(false);
            else cbEntrada.setSelected(true);
        });
        cbSaida.addActionListener(e -> {
            if (cbSaida.isSelected()) cbEntrada.setSelected(false);
            else cbSaida.setSelected(true);
        });

        JButton btnAdd = new JButton("Registrar");
        JButton btnRemove = new JButton("Remover Linha");

        top.add(new JLabel("Data"));
        top.add(txtDate);
        top.add(new JLabel("Produto"));
        top.add(comboProd);
        top.add(new JLabel("Qtd"));
        top.add(spinnerQty);
        top.add(cbEntrada);
        top.add(cbSaida);
        top.add(btnAdd);
        top.add(btnRemove);

        add(top, BorderLayout.NORTH);

        // ----- Tabela inferior (totais) -----
        totalsModel = new DefaultTableModel(new String[]{"Produto", "Total Entradas", "Total Saídas", "Saldo"}, 0) {
            @Override
            public Class<?> getColumnClass(int columnIndex) {
                return (columnIndex >= 1) ? Integer.class : String.class;
            }

            @Override
            public boolean isCellEditable(int row, int column) {
                return false;
            }
        };

        JTable totalsTable = new JTable(totalsModel);
        totalsTable.setRowHeight(25);
        for (int i = 0; i < totalsTable.getColumnCount(); i++) {
            totalsTable.getColumnModel().getColumn(i).setCellRenderer(centerRenderer);
        }
        ((DefaultTableCellRenderer) totalsTable.getTableHeader().getDefaultRenderer())
                .setHorizontalAlignment(SwingConstants.CENTER);

        JScrollPane totalsScroll = new JScrollPane(totalsTable);
        totalsScroll.setPreferredSize(new Dimension(0, 150));

        JPanel bottom = new JPanel(new BorderLayout());
        bottom.setBorder(BorderFactory.createTitledBorder("Totais por Produto"));
        bottom.add(totalsScroll, BorderLayout.CENTER);
        add(bottom, BorderLayout.SOUTH);

        // ----- Botão Registrar -----
        btnAdd.addActionListener(e -> {
            String date = txtDate.getText().trim();
            String prod = (String) comboProd.getSelectedItem();
            int qty = (Integer) spinnerQty.getValue();
            String tipo = cbEntrada.isSelected() ? "Entrada" : "Saída";

            if (date.isEmpty() || prod == null) {
                JOptionPane.showMessageDialog(this, "Preencha data e selecione um produto!");
                return;
            }

            model.addRow(new Object[]{date, prod, tipo, qty});
            updateTotals();

            txtDate.setText(LocalDate.now().format(df));
            spinnerQty.setValue(1);
            cbEntrada.setSelected(true);
            cbSaida.setSelected(false);
            autoSave();
        });

        // ----- Botão Remover -----
        btnRemove.addActionListener(e -> {
            int selectedRow = table.getSelectedRow();
            if (selectedRow == -1) {
                JOptionPane.showMessageDialog(this, "Selecione uma linha para remover.");
                return;
            }
            int confirm = JOptionPane.showConfirmDialog(this,
                    "Tem certeza que deseja remover esta linha?",
                    "Confirmar Remoção", JOptionPane.YES_NO_OPTION);
            if (confirm == JOptionPane.YES_OPTION) {
                model.removeRow(selectedRow);
                updateTotals();
                autoSave();
            }
        });

        // ----- Carrega e atualiza -----
        load();
        updateTotals();

        addWindowListener(new WindowAdapter() {
            @Override
            public void windowClosing(WindowEvent e) {
                autoSave();
            }
        });
    }

    // ----- Atualiza totais -----
    private void updateTotals() {
        updating = true;
        Map<String, Integer> entradas = new HashMap<>();
        Map<String, Integer> saidas = new HashMap<>();

        for (int r = 0; r < model.getRowCount(); r++) {
            String produto = (String) model.getValueAt(r, 1);
            String tipo = (String) model.getValueAt(r, 2);
            int qty = (Integer) model.getValueAt(r, 3);

            if ("Entrada".equalsIgnoreCase(tipo))
                entradas.put(produto, entradas.getOrDefault(produto, 0) + qty);
            else if ("Saída".equalsIgnoreCase(tipo))
                saidas.put(produto, saidas.getOrDefault(produto, 0) + qty);
        }

        totalsModel.setRowCount(0);
        Set<String> produtos = new HashSet<>();
        produtos.addAll(entradas.keySet());
        produtos.addAll(saidas.keySet());

        for (String prod : produtos) {
            int totalEnt = entradas.getOrDefault(prod, 0);
            int totalSai = saidas.getOrDefault(prod, 0);
            totalsModel.addRow(new Object[]{prod, totalEnt, totalSai, totalEnt - totalSai});
        }

        updating = false;
    }

    // ----- Carrega produtos -----
    private void loadProducts() {
        java.util.List<String> lines = FileUtil.readLines("txt/Controle_Loja.txt");
        comboProd.removeAllItems();
        for (String line : lines) {
            String[] parts = line.split(";");
            if (parts.length >= 2) comboProd.addItem(parts[1]);
        }
    }

    // ----- Salvamento -----
    private void autoSave() {
    java.util.List<String> lines = new ArrayList<>();
    DateTimeFormatter df = DateTimeFormatter.ofPattern("dd/MM/yyyy");

    // Copia os dados da tabela para uma lista de arrays
    java.util.List<String[]> registros = new ArrayList<>();
    for (int r = 0; r < model.getRowCount(); r++) {
        String[] row = new String[model.getColumnCount()];
        for (int c = 0; c < model.getColumnCount(); c++) {
            Object val = model.getValueAt(r, c);
            row[c] = val == null ? "" : val.toString();
        }
        registros.add(row);
    }

    // Ordena por data (mais recente primeiro)
    registros.sort((a, b) -> {
        try {
            LocalDate da = LocalDate.parse(a[0], df);
            LocalDate db = LocalDate.parse(b[0], df);
            return db.compareTo(da); // decrescente
        } catch (Exception e) {
            return 0;
        }
    });

    // Converte de volta para texto
    for (String[] reg : registros) {
        StringBuilder sb = new StringBuilder();
        for (String p : reg) sb.append(p).append(";");
        lines.add(sb.toString());
    }

    // Salva no arquivo
    FileUtil.saveLines(filename, lines);
}

    // ----- Carrega dados salvos -----
    private void load() {
    java.util.List<String> lines = FileUtil.readLines(filename);
    DateTimeFormatter df = DateTimeFormatter.ofPattern("dd/MM/yyyy");

    // Lista de arrays para ordenar
    java.util.List<String[]> registros = new ArrayList<>();
    for (String l : lines) {
        String[] parts = l.split(";");
        if (parts.length >= 4) {
            registros.add(new String[]{parts[0], parts[1], parts[2], parts[3]});
        }
    }

    // Ordena por data (mais recente primeiro)
    registros.sort((a, b) -> {
        try {
            LocalDate da = LocalDate.parse(a[0], df);
            LocalDate db = LocalDate.parse(b[0], df);
            return db.compareTo(da); // decrescente
        } catch (Exception e) {
            return 0;
        }
    });

    // Adiciona à tabela
    for (String[] reg : registros) {
        int qty = 0;
        try {
            qty = Integer.parseInt(reg[3]);
        } catch (Exception ignored) {}
        model.addRow(new Object[]{reg[0], reg[1], reg[2], qty});
    }
    }

    public static void main(String[] args) {
        SwingUtilities.invokeLater(() -> new StockControl().setVisible(true));
    }
}
