// --------------------------------------
// Arquivo: DeliveryControl.java
// --------------------------------------

import javax.swing.*;
import javax.swing.table.*;
import java.awt.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

public class DeliveryControl extends JFrame {
    private DefaultTableModel model;
    private JTable table;
    private final String arquivoEntregas = "txt/Controle_Entregas.txt";
    private final String arquivoClientes = "txt/Controle_Clientes.txt";
    private final String arquivoVendas = "txt/Controle_Vendas.txt";

    public DeliveryControl() {
        setTitle("Controle de Entregas");
        setSize(1300, 700);
        setDefaultCloseOperation(JFrame.DISPOSE_ON_CLOSE);
        setLocationRelativeTo(null);
        setLayout(new BorderLayout());

        model = new DefaultTableModel(new String[]{
                "ID de Venda", "Cliente", "Endereço de Entrega", "Forma de Entrega",
                "Status da Entrega", "Código rastreio das entregas"
        }, 0) {
            @Override
            public boolean isCellEditable(int row, int column) {
                return column == 4 || column == 5;
            }
        };

        table = new JTable(model);
        table.setRowHeight(28);

        // -----------------------
        // Centralizar colunas
        // -----------------------
        DefaultTableCellRenderer centerRenderer = new DefaultTableCellRenderer();
        centerRenderer.setHorizontalAlignment(SwingConstants.CENTER);
        for (int i = 0; i < table.getColumnCount(); i++) {
            table.getColumnModel().getColumn(i).setCellRenderer(centerRenderer);
        }

        // Centralizar cabeçalho
        ((DefaultTableCellRenderer) table.getTableHeader().getDefaultRenderer())
                .setHorizontalAlignment(SwingConstants.CENTER);

        // Coluna Status com ComboBox
        JComboBox<String> comboStatus = new JComboBox<>(new String[]{
                "Pendente", "Saiu para entrega", "Entregue", "Cancelada"
        });
        table.getColumnModel().getColumn(4).setCellEditor(new DefaultCellEditor(comboStatus));

        // Renderer com cores automáticas para Status
        table.getColumnModel().getColumn(4).setCellRenderer(new DefaultTableCellRenderer() {
            @Override
            public Component getTableCellRendererComponent(JTable t, Object value, boolean isSelected, boolean hasFocus, int row, int column) {
                Component c = super.getTableCellRendererComponent(t, value, isSelected, hasFocus, row, column);
                String status = value != null ? value.toString() : "";
                switch (status) {
                    case "Entregue":
                        c.setBackground(Color.GREEN);
                        c.setForeground(Color.BLACK);
                        break;
                    case "Saiu para entrega":
                        c.setBackground(Color.YELLOW);
                        c.setForeground(Color.BLACK);
                        break;
                    case "Cancelada":
                        c.setBackground(Color.RED);
                        c.setForeground(Color.WHITE);
                        break;
                    case "Pendente":
                    default:
                        c.setBackground(Color.LIGHT_GRAY);
                        c.setForeground(Color.BLACK);
                        break;
                }
                if (isSelected) c.setBackground(c.getBackground().darker());
                return c;
            }
        });

        // Renderer e Editor para coluna rastreio
        table.getColumnModel().getColumn(5).setCellRenderer(new RastreioCellRenderer());
        table.getColumnModel().getColumn(5).setCellEditor(new RastreioCellEditor());

        add(new JScrollPane(table), BorderLayout.CENTER);

        carregarDados();

        addWindowListener(new java.awt.event.WindowAdapter() {
            @Override
            public void windowClosing(java.awt.event.WindowEvent e) {
                autoSave();
            }
        });

        new javax.swing.Timer(30000, e -> autoSave()).start();
        model.addTableModelListener(e -> autoSave());
    }

    // -----------------------------
    // Métodos principais
    // -----------------------------
    private void carregarDados() {
        model.setRowCount(0);
        Map<String, String> enderecos = carregarEnderecosClientes();
        java.util.List<String[]> vendas = carregarVendas();
        Map<String, String[]> entregasSalvas = carregarEntregasSalvas();

        for (String[] venda : vendas) {
            if (venda.length >= 8) {
                String idVenda = venda[0].trim();
                String cliente = venda[2].trim();
                String formaEntrega = venda[6].trim();
                String endereco = enderecos.getOrDefault(cliente, "Endereço não encontrado");

                String status = "Pendente";
                String rastreio = "";
                if (entregasSalvas.containsKey(idVenda)) {
                    status = entregasSalvas.get(idVenda)[0];
                    rastreio = entregasSalvas.get(idVenda)[1];
                }

                model.addRow(new Object[]{idVenda, cliente, endereco, formaEntrega, status, rastreio});
            }
        }
        autoSave();
    }

    private Map<String, String> carregarEnderecosClientes() {
        Map<String, String> mapa = new HashMap<>();
        File file = new File(arquivoClientes);
        if (!file.exists()) return mapa;

        try (BufferedReader br = new BufferedReader(
                new InputStreamReader(new FileInputStream(file), StandardCharsets.UTF_8))) {
            String linha;
            while ((linha = br.readLine()) != null) {
                String[] parts = linha.split(";");
                if (parts.length >= 6) mapa.put(parts[1].trim(), parts[5].trim());
            }
        } catch (IOException e) {
            JOptionPane.showMessageDialog(this, "Erro ao carregar clientes: " + e.getMessage());
        }
        return mapa;
    }

    private java.util.List<String[]> carregarVendas() {
        java.util.List<String[]> lista = new ArrayList<>();
        File file = new File(arquivoVendas);
        if (!file.exists()) return lista;

        try (BufferedReader br = new BufferedReader(
                new InputStreamReader(new FileInputStream(file), StandardCharsets.UTF_8))) {
            String linha;
            while ((linha = br.readLine()) != null) {
                String[] parts = linha.split(";");
                if (parts.length >= 8) lista.add(parts);
            }
        } catch (IOException e) {
            JOptionPane.showMessageDialog(this, "Erro ao carregar vendas: " + e.getMessage());
        }
        return lista;
    }

    private Map<String, String[]> carregarEntregasSalvas() {
        Map<String, String[]> mapa = new HashMap<>();
        File file = new File(arquivoEntregas);
        if (!file.exists()) return mapa;

        try (BufferedReader br = new BufferedReader(
                new InputStreamReader(new FileInputStream(file), StandardCharsets.UTF_8))) {
            String linha;
            while ((linha = br.readLine()) != null) {
                String[] parts = linha.split(";");
                if (parts.length >= 6) {
                    String idVenda = parts[0].trim();
                    String status = parts[4].trim();
                    String rastreio = parts[5].trim();
                    mapa.put(idVenda, new String[]{status, rastreio});
                }
            }
        } catch (IOException e) {
            JOptionPane.showMessageDialog(this, "Erro ao carregar entregas salvas: " + e.getMessage());
        }
        return mapa;
    }

    private void autoSave() {
        File dir = new File("txt");
        if (!dir.exists()) dir.mkdirs();

        try (BufferedWriter bw = new BufferedWriter(
                new OutputStreamWriter(new FileOutputStream(arquivoEntregas), StandardCharsets.UTF_8))) {
            for (int r = 0; r < model.getRowCount(); r++) {
                for (int c = 0; c < model.getColumnCount(); c++) {
                    bw.write(String.valueOf(model.getValueAt(r, c)) + ";");
                }
                bw.newLine();
            }
        } catch (IOException e) {
            JOptionPane.showMessageDialog(this, "Erro ao salvar entregas: " + e.getMessage());
        }
    }

    // -----------------------------
    // Classes internas para rastreio
    // -----------------------------
    private class RastreioCellRenderer extends DefaultTableCellRenderer {
        private final JButton button = new JButton("Adicionar código de rastreio");

        @Override
        public Component getTableCellRendererComponent(JTable table, Object value,
                                                       boolean isSelected, boolean hasFocus,
                                                       int row, int column) {
            if (value == null || value.toString().trim().isEmpty()) {
                return button;
            } else {
                return super.getTableCellRendererComponent(table, value, isSelected, hasFocus, row, column);
            }
        }
    }

    private class RastreioCellEditor extends AbstractCellEditor implements TableCellEditor {
        private final JButton button = new JButton("Adicionar código de rastreio");
        private String rastreio = "";
        private int row;

        public RastreioCellEditor() {
            button.addActionListener(e -> {
                String input = JOptionPane.showInputDialog(DeliveryControl.this,
                        "Digite o código de rastreio:", rastreio);
                if (input != null) {
                    rastreio = input.trim();
                    model.setValueAt(rastreio, row, 5);
                    stopCellEditing();
                } else {
                    cancelCellEditing();
                }
            });
        }

        @Override
        public Object getCellEditorValue() {
            return rastreio;
        }

        @Override
        public Component getTableCellEditorComponent(JTable table, Object value,
                                                     boolean isSelected, int row, int column) {
            this.row = row;
            rastreio = value != null ? value.toString() : "";
            return button;
        }
    }

    // -----------------------------
    // Execução principal
    // -----------------------------
    public static void main(String[] args) {
        SwingUtilities.invokeLater(() -> new DeliveryControl().setVisible(true));
    }
}
