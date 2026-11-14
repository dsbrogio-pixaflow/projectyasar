// -----------------------------
// File: ClienteControl.java
// -----------------------------

import javax.swing.*;
import javax.swing.table.DefaultTableCellRenderer;
import javax.swing.table.DefaultTableModel;
import javax.swing.table.TableRowSorter;
import java.awt.*;
import java.awt.event.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

public class ClienteControl extends JFrame {
    private DefaultTableModel model;
    private final String filename = "txt/Controle_Clientes.txt";

    private JTextField txtNome;
    private JTextField txtEmail;
    private JTextField txtTelefone;
    private JTextField txtAniversario;
    private JTextField txtEnderecoEntrega;
    private JTextField txtBuscar;
    private TableRowSorter<DefaultTableModel> sorter;
    private int clienteIdEmEdicao = -1; // -1 significa que está em modo de adição

    public ClienteControl() {
        setTitle("Controle de Clientes");
        setSize(1300, 700);
        setDefaultCloseOperation(JFrame.DISPOSE_ON_CLOSE);
        setLocationRelativeTo(null);
        setLayout(new BorderLayout());

        // Modelo da tabela
        model = new DefaultTableModel(
        new String[]{"ID", "Nome", "E-mail", "Telefone", "Aniversário", "Endereço de Entrega"}, 0) {
        @Override
        public boolean isCellEditable(int row, int column) {
        return false;
        }
        };

        JTable table = new JTable(model);
        table.setRowHeight(28);
        sorter = new TableRowSorter<>(model);
        table.setRowSorter(sorter);

        // --- CENTRALIZAR CONTEÚDO DAS CÉLULAS ---
        DefaultTableCellRenderer centerRenderer = new DefaultTableCellRenderer();
        centerRenderer.setHorizontalAlignment(SwingConstants.CENTER);
        centerRenderer.setVerticalAlignment(SwingConstants.CENTER);
        for (int i = 0; i < table.getColumnCount(); i++) {
        table.getColumnModel().getColumn(i).setCellRenderer(centerRenderer);
        }

        // --- CENTRALIZAR CABEÇALHO ---
        ((DefaultTableCellRenderer) table.getTableHeader().getDefaultRenderer())
                .setHorizontalAlignment(SwingConstants.CENTER);

        // --- AJUSTAR LARGURA AUTOMÁTICA DAS COLUNAS ---
        table.setAutoResizeMode(JTable.AUTO_RESIZE_ALL_COLUMNS);
        table.setFillsViewportHeight(true);

        JScrollPane scrollPane = new JScrollPane(table);
        add(scrollPane, BorderLayout.CENTER);


        // Painel principal (campos + botões)
        JPanel panelTop = new JPanel(new BorderLayout());

        // Linha 1 – Campos
        JPanel panelCampos = new JPanel(new FlowLayout(FlowLayout.LEFT));
        txtNome = new JTextField(15);
        txtEmail = new JTextField(15);
        txtTelefone = new JTextField(10);
        txtAniversario = new JTextField(8);
        txtEnderecoEntrega = new JTextField(20);

        panelCampos.add(new JLabel("Nome:"));
        panelCampos.add(txtNome);
        panelCampos.add(new JLabel("E-mail:"));
        panelCampos.add(txtEmail);
        panelCampos.add(new JLabel("Telefone:"));
        panelCampos.add(txtTelefone);
        panelCampos.add(new JLabel("Aniversário sem o Ano (DD/MM):"));
        panelCampos.add(txtAniversario);
        panelCampos.add(new JLabel("Endereço de Entrega:"));
        panelCampos.add(txtEnderecoEntrega);

        // Linha 2 – Botões e Busca (MODIFICADO)
        // ✅ Alteração: Usaremos um novo painel para organizar os botões à esquerda e a busca à direita
        JPanel panelAcoes = new JPanel(new BorderLayout());
        
        // Painel para os botões (mantido FlowLayout.LEFT)
        JPanel panelBotoes = new JPanel(new FlowLayout(FlowLayout.LEFT));
        JButton btnAdd = new JButton("Adicionar Cliente");
        JButton btnEdit = new JButton("Editar Cliente");
        JButton btnDelete = new JButton("Remover Cliente");

        panelBotoes.add(btnAdd);
        panelBotoes.add(btnEdit);
        panelBotoes.add(btnDelete);
        
        // Painel para a busca (MODIFICADO)
        // ✅ Alteração: Criamos um painel que alinha a busca à direita (FlowLayout.RIGHT)
        JPanel panelBusca = new JPanel(new FlowLayout(FlowLayout.RIGHT));
        txtBuscar = new JTextField(20);
        panelBusca.add(new JLabel("Buscar por nome:"));
        panelBusca.add(txtBuscar);

        // Adiciona os sub-painéis ao painel de ações
        panelAcoes.add(panelBotoes, BorderLayout.WEST);
        panelAcoes.add(panelBusca, BorderLayout.EAST);
        
        
        panelTop.add(panelCampos, BorderLayout.NORTH);
        // ✅ Alteração: Adiciona o novo painel de ações (Botões + Busca) no SOUTH de panelTop
        panelTop.add(panelAcoes, BorderLayout.SOUTH);
        add(panelTop, BorderLayout.NORTH);

        // Painel inferior - busca (REMOVIDO)
        /*
        JPanel panelBottom = new JPanel(new FlowLayout(FlowLayout.LEFT));
        txtBuscar = new JTextField(20);
        panelBottom.add(new JLabel("Buscar por nome:"));
        panelBottom.add(txtBuscar);
        add(panelBottom, BorderLayout.SOUTH); // ESTE CÓDIGO FOI REMOVIDO
        */

        // Eventos
        btnAdd.addActionListener(e -> adicionarCliente());
        btnEdit.addActionListener(e -> editarCliente(table));
        btnDelete.addActionListener(e -> excluirCliente(table));

        // ✅ Ação do Enter para adicionar cliente
        ActionListener enterListener = e -> executarAcaoEnter(table); 

        txtNome.addActionListener(enterListener);
        txtEmail.addActionListener(enterListener);
        txtTelefone.addActionListener(enterListener);
        txtAniversario.addActionListener(enterListener);
        txtEnderecoEntrega.addActionListener(enterListener); 
        
        txtBuscar.getDocument().addDocumentListener(new javax.swing.event.DocumentListener() {
            public void changedUpdate(javax.swing.event.DocumentEvent e) { filtrar(); }
            public void removeUpdate(javax.swing.event.DocumentEvent e) { filtrar(); }
            public void insertUpdate(javax.swing.event.DocumentEvent e) { filtrar(); }
        });

        table.addMouseListener(new MouseAdapter() {
            public void mouseClicked(MouseEvent e) {
                if (e.getClickCount() == 2 && table.getSelectedRow() != -1) {
                    preencherCamposParaEdicao(table);
                }
            }
        });

        load();

        addWindowListener(new WindowAdapter() {
            @Override
            public void windowClosing(WindowEvent e) {
                autoSave();
            }
        });
    }

    // ----------------------------
    // MÉTODOS DE FUNCIONALIDADE
    // ----------------------------

    private void filtrar() {
        String texto = txtBuscar.getText().trim();
        if (texto.isEmpty()) {
            sorter.setRowFilter(null);
        } else {
            // Filtra por nome (coluna 1) ignorando case (?i)
            sorter.setRowFilter(RowFilter.regexFilter("(?i)" + texto, 1));
        }
    }

    private String formatarAniversario(String aniversario) {
        if (aniversario == null || aniversario.isEmpty()) return "";
        aniversario = aniversario.trim();
        try {
            // Tenta capturar dd/MM/yyyy e transforma em dd/MM
            if (aniversario.matches("\\d{2}/\\d{2}/\\d{4}")) {
                return aniversario.substring(0, 5);
            }
            // Já está no formato certo
            else if (aniversario.matches("\\d{2}/\\d{2}")) {
                return aniversario;
            }
            // Outros formatos: tenta separar e reconstruir
            else {
                String[] partes = aniversario.split("[/-]");
                if (partes.length >= 2) {
                    return String.format("%02d/%02d",
                        Integer.parseInt(partes[0]), Integer.parseInt(partes[1]));
                }
            }
        } catch (Exception e) {
            // Caso qualquer erro, devolve como está
            return aniversario;
        }
        return aniversario;
    }

    private void adicionarCliente() {
        String nome = txtNome.getText().trim();
        String email = txtEmail.getText().trim();
        String telefone = txtTelefone.getText().trim();
        String aniversario = formatarAniversario(txtAniversario.getText().trim());
        String endereco = txtEnderecoEntrega.getText().trim();

        if (nome.isEmpty()) {
            JOptionPane.showMessageDialog(this, "O campo Nome é obrigatório.");
            return;
        }

        int id = gerarProximoId();
        model.addRow(new Object[]{id, nome, email, telefone, aniversario, endereco});
        autoSave();
        limparCampos();
        // Reseta o modo de edição para Adição
        clienteIdEmEdicao = -1; 
        // Foca no primeiro campo após a inserção
        txtNome.requestFocusInWindow();
    }

    private void editarCliente(JTable table) {
        
        int modelRow = -1;
        // Encontra a linha no modelo da tabela que corresponde ao ID em edição
        for(int i = 0; i < model.getRowCount(); i++) {
            if(Integer.parseInt(model.getValueAt(i, 0).toString()) == clienteIdEmEdicao) {
                modelRow = i;
                break;
            }
        }

        if (modelRow == -1) {
             JOptionPane.showMessageDialog(this, "Erro: Cliente a ser editado não encontrado. Por favor, selecione novamente na tabela.");
             clienteIdEmEdicao = -1;
             return;
        }
        
        String id = model.getValueAt(modelRow, 0).toString();

        String nome = txtNome.getText().trim();
        String email = txtEmail.getText().trim();
        String telefone = txtTelefone.getText().trim();
        String aniversario = formatarAniversario(txtAniversario.getText().trim());
        String endereco = txtEnderecoEntrega.getText().trim();

        if (nome.isEmpty()) {
            JOptionPane.showMessageDialog(this, "O campo Nome é obrigatório.");
            return;
        }

        // Atualiza a linha existente
        model.setValueAt(nome, modelRow, 1);
        model.setValueAt(email, modelRow, 2);
        model.setValueAt(telefone, modelRow, 3);
        model.setValueAt(aniversario, modelRow, 4);
        model.setValueAt(endereco, modelRow, 5);

        JOptionPane.showMessageDialog(this, "Cliente ID " + id + " atualizado com sucesso!");
        autoSave();
        limparCampos();

        // Sai do modo de edição após a conclusão
        clienteIdEmEdicao = -1;
        
        // Foca no primeiro campo após a edição
        txtNome.requestFocusInWindow();
    }

    private void preencherCamposParaEdicao(JTable table) {
        int selected = table.getSelectedRow();
        if (selected != -1) {
            int modelRow = table.convertRowIndexToModel(selected);
            
            // Entra no modo de edição e salva o ID
            clienteIdEmEdicao = Integer.parseInt(model.getValueAt(modelRow, 0).toString());
            
            // Preenchimento dos campos
            txtNome.setText(model.getValueAt(modelRow, 1).toString());
            txtEmail.setText(model.getValueAt(modelRow, 2).toString());
            txtTelefone.setText(model.getValueAt(modelRow, 3).toString());
            txtAniversario.setText(model.getValueAt(modelRow, 4).toString());
            txtEnderecoEntrega.setText(model.getValueAt(modelRow, 5).toString());
        }
    }
    
    private void excluirCliente(JTable table) {
        int selected = table.getSelectedRow();
        if (selected == -1) {
            JOptionPane.showMessageDialog(this, "Selecione um cliente para excluir.");
            return;
        }

        int confirm = JOptionPane.showConfirmDialog(this,
                "Tem certeza que deseja excluir este cliente?", "Confirmação",
                JOptionPane.YES_NO_OPTION);

        if (confirm == JOptionPane.YES_OPTION) {
            int modelRow = table.convertRowIndexToModel(selected);
            model.removeRow(modelRow);
            autoSave();
            limparCampos();
            // Reseta o modo de edição ao excluir
            clienteIdEmEdicao = -1;
        }
    }

    private void limparCampos() {
        txtNome.setText("");
        txtEmail.setText("");
        txtTelefone.setText("");
        txtAniversario.setText("");
        txtEnderecoEntrega.setText("");
    }

    private int gerarProximoId() {
        int max = 0;
        for (int r = 0; r < model.getRowCount(); r++) {
            try {
                int id = Integer.parseInt(model.getValueAt(r, 0).toString());
                if (id > max) max = id;
            } catch (Exception ignored) {}
        }
        return max + 1;
    }

    private void autoSave() {
        java.util.List<String> linhas = new ArrayList<>();
        for (int r = 0; r < model.getRowCount(); r++) {
            StringBuilder sb = new StringBuilder();
            for (int c = 0; c < model.getColumnCount(); c++) {
                sb.append(model.getValueAt(r, c)).append(";");
            }
            linhas.add(sb.toString());
        }

        File dir = new File("txt");
        if (!dir.exists()) dir.mkdir();

        try (OutputStreamWriter writer = new OutputStreamWriter(
                new FileOutputStream(filename), StandardCharsets.UTF_8);
            PrintWriter pw = new PrintWriter(writer)) {
            for (String linha : linhas) pw.println(linha);
        } catch (IOException e) {
            JOptionPane.showMessageDialog(this, "Erro ao salvar arquivo: " + e.getMessage());
        }
    }

    private void load() {
        File file = new File(filename);
        if (!file.exists()) return;

        try (InputStreamReader reader = new InputStreamReader(
                new FileInputStream(file), StandardCharsets.UTF_8);
            BufferedReader br = new BufferedReader(reader)) {

            String linha;
            while ((linha = br.readLine()) != null) {
                String[] parts = linha.split(";");
                if (parts.length >= 6) {
                    model.addRow(new Object[]{parts[0], parts[1], parts[2], parts[3], parts[4], parts[5]});
                } else if (parts.length == 5) {
                    model.addRow(new Object[]{parts[0], parts[1], parts[2], parts[3], parts[4], ""});
                }
            }
        } catch (IOException e) {
            JOptionPane.showMessageDialog(this, "Erro ao carregar dados: " + e.getMessage());
        }
    }

    // MÉTODO DE DECISÃO DO ENTER
    private void executarAcaoEnter(JTable table) {
        if (clienteIdEmEdicao != -1) {
            // Em modo de edição, chama editar
            editarCliente(table); 
        } else {
            // Em modo de adição, chama adicionar
            adicionarCliente();
        }
    }


    public static void main(String[] args) {
        SwingUtilities.invokeLater(() -> new ClienteControl().setVisible(true));
    }
}