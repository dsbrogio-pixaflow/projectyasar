// -----------------------------
// File: ItemsStoreControl.java
// -----------------------------

import javax.swing.*;
import javax.swing.table.*;
import java.awt.*;
import java.awt.image.BufferedImage; // NOVO: Para ImageIO
import java.awt.Graphics2D;        // NOVO: Para melhor redimensionamento
import java.awt.RenderingHints;    // NOVO: Para qualidade de redimensionamento
import java.io.File;
import java.io.IOException;        // NOVO: Para tratar exceções do ImageIO
import javax.imageio.ImageIO;      // NOVO: Para leitura de WebP/outros formatos
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.text.NumberFormat;
import java.util.Locale;

public class ItemsStoreControl extends JFrame {
    private JTable table;
    private DefaultTableModel model;
    private JButton btnAdd, btnRemove, btnPreview, btnEdit;
    private String filename = "txt/Controle_Loja.txt";
    private int nextId = 1;

    public ItemsStoreControl() {
        setTitle("Gerenciador de Itens da Loja");
        setSize(1300, 700);
        setDefaultCloseOperation(JFrame.DISPOSE_ON_CLOSE);
        setLocationRelativeTo(null);

        // Garante existência da pasta txt/
        new File("txt").mkdirs();

        // Modelo da tabela
        model = new DefaultTableModel(new Object[]{"ID", "Nome", "Preço", "Thumbnail", "Imagem"}, 0) {
            @Override
            public boolean isCellEditable(int row, int column) {
                return false;
            }

            @Override
            public Class<?> getColumnClass(int columnIndex) {
                if (columnIndex == 3) return ImageIcon.class;
                return super.getColumnClass(columnIndex);
            }
        };

    table = new JTable(model);
    table.setRowHeight(60);

    // Renderer centralizado padrão
    DefaultTableCellRenderer centerRenderer = new DefaultTableCellRenderer();
    centerRenderer.setHorizontalAlignment(SwingConstants.CENTER);

    // Renderer específico para a coluna "Preço" (formato monetário)
    DefaultTableCellRenderer moneyRenderer = new DefaultTableCellRenderer() {
        // CORREÇÃO: Locale Brasileiro (pt-BR)
            private final java.text.NumberFormat moneyFormat = 
    java.text.NumberFormat.getCurrencyInstance(java.util.Locale.forLanguageTag("pt-BR"));
            
        @Override
        public Component getTableCellRendererComponent(JTable table, Object value,
                boolean isSelected, boolean hasFocus, int row, int column) {
            Component c = super.getTableCellRendererComponent(table, value, isSelected, hasFocus, row, column);
            setHorizontalAlignment(SwingConstants.CENTER);
            c.setFont(c.getFont().deriveFont(Font.BOLD));

            // Azul fixo
            c.setForeground(new Color(0, 102, 204));
            if (isSelected) c.setForeground(Color.WHITE);

            // Usa o NumberFormat para exibir a moeda com vírgula
            if (value instanceof Number) {
                double val = ((Number) value).doubleValue();
                setText(moneyFormat.format(val)); // Usa o formatador pt-BR
            }

            return c;
        }
    };

    // Aplica centralização em todas as colunas, exceto Thumbnail
    for (int i = 0; i < table.getColumnModel().getColumnCount(); i++) {
        if (i != 3) { // Coluna 3 = Thumbnail
            table.getColumnModel().getColumn(i).setCellRenderer(centerRenderer);
            table.setRowHeight(80);
        }
    }

    // Substitui o renderer da coluna "Preço" pelo monetário
    table.getColumnModel().getColumn(2).setCellRenderer(moneyRenderer);

    // Ajuste de larguras
    table.getColumnModel().getColumn(0).setPreferredWidth(50); // ID
    table.getColumnModel().getColumn(1).setPreferredWidth(250);// Nome
    table.getColumnModel().getColumn(2).setPreferredWidth(100); // Preço
    table.getColumnModel().getColumn(3).setPreferredWidth(120); // Thumbnail
    table.removeColumn(table.getColumnModel().getColumn(4));// Remove caminho da imagem

        JScrollPane scrollPane = new JScrollPane(table);

        // Botões
        JPanel panelButtons = new JPanel();
        btnAdd = new JButton("Adicionar");
        btnRemove = new JButton("Remover");
        btnEdit = new JButton("Editar");
        btnPreview = new JButton("Visualizar Imagem");

        panelButtons.add(btnAdd);
        panelButtons.add(btnRemove);
        panelButtons.add(btnEdit);
        panelButtons.add(btnPreview);

        add(scrollPane, BorderLayout.CENTER);
        add(panelButtons, BorderLayout.SOUTH);

        // Carregar dados salvos (UTF-8)
        loadItems();

        // === AÇÕES ===
        btnAdd.addActionListener(e -> addItem());
        btnRemove.addActionListener(e -> removeItem());
        btnEdit.addActionListener(e -> editItem());
        btnPreview.addActionListener(e -> showPreview());

        // Preview em duplo clique
        table.addMouseListener(new java.awt.event.MouseAdapter() {
            public void mouseClicked(java.awt.event.MouseEvent evt) {
                if (evt.getClickCount() == 2) {
                    showPreview();
                }
            }
        });
    }

    // === FUNÇÕES ===
    private void loadItems() {
        List<String> lines = FileUtil.readLines(filename);
        int maxId = 0;
        for (String line : lines) {
            String[] parts = line.split(";");
            if (parts.length >= 4) {
                try {
                    int id = Integer.parseInt(parts[0]);
                    String name = parts[1];
                    // Adiciona robustez: substitui vírgula por ponto no arquivo, se houver
                    double price = Double.parseDouble(parts[2].replace(",", ".")); 
                    String imagePath = parts[3];

                    maxId = Math.max(maxId, id);

                    // APLICAÇÃO DA SOLUÇÃO WEBP/IMAGEM
                    ImageIcon thumbnail = getResizedIcon(imagePath, 60, 60);
                    model.addRow(new Object[]{id, name, price, thumbnail, imagePath});

                } catch (Exception ignored) {}
            }
        }
        nextId = maxId + 1;
    }

    private void addItem() {
        JDialog dialog = new JDialog(this, "Adicionar Produto", true);
        dialog.setSize(600, 500);
        dialog.setLocationRelativeTo(this);
        dialog.setLayout(new BorderLayout());

        JPanel panelFields = new JPanel(new GridLayout(2, 2, 10, 10));
        JTextField txtName = new JTextField();
        JTextField txtPrice = new JTextField();

        panelFields.add(new JLabel("Nome:"));
        panelFields.add(txtName);
        panelFields.add(new JLabel("Preço (use . ou ,):"));
        panelFields.add(txtPrice);

        dialog.add(panelFields, BorderLayout.NORTH);

        JFileChooser chooser = new JFileChooser();
        dialog.add(chooser, BorderLayout.CENTER);

        JPanel panelButtons = new JPanel(new FlowLayout(FlowLayout.RIGHT));
        JButton btnSalvar = new JButton("Salvar");
        JButton btnCancelar = new JButton("Cancelar");
        panelButtons.add(btnSalvar);
        panelButtons.add(btnCancelar);
        dialog.add(panelButtons, BorderLayout.SOUTH);

        btnCancelar.addActionListener(e -> dialog.dispose());

        btnSalvar.addActionListener(e -> {
            try {
                String name = txtName.getText().trim();
                // Converte input (virgula ou ponto) para ponto para o Double.parseDouble
                double price = Double.parseDouble(txtPrice.getText().trim().replace(",", "."));
                File selectedFile = chooser.getSelectedFile();

                if (selectedFile == null) {
                    JOptionPane.showMessageDialog(dialog, "Selecione uma imagem!");
                    return;
                }

                File dest = new File("images", selectedFile.getName());
                dest.getParentFile().mkdirs();
                FileUtil.copyFile(selectedFile, dest);

                String imagePath = dest.getPath();

                // Grava com ponto no arquivo para consistência
                FileUtil.appendLine(filename, nextId + ";" + name + ";" + String.format("%.2f", price).replace(",", ".") + ";" + imagePath);
                
                // APLICAÇÃO DA SOLUÇÃO WEBP/IMAGEM
                ImageIcon thumbnail = getResizedIcon(imagePath, 60, 60);
                model.addRow(new Object[]{nextId, name, price, thumbnail, imagePath});

                nextId++;
                dialog.dispose();

                } catch (NumberFormatException ex) {
                // Trata o erro de formato de número de forma mais clara
                JOptionPane.showMessageDialog(dialog, "Formato de preço inválido. Use apenas números. Ex: 19.99 ou 19,99.");


                } catch (Exception ex) {
                    JOptionPane.showMessageDialog(dialog, "Erro ao adicionar: " + ex.getMessage());
                }
        });

        dialog.setVisible(true);
    }

    private void removeItem() {
        int selectedRow = table.getSelectedRow();
        if (selectedRow >= 0) {
            int id = (int) model.getValueAt(selectedRow, 0);
            String name = (String) model.getValueAt(selectedRow, 1);
            int confirm = JOptionPane.showConfirmDialog(this,
                    "Tem certeza que deseja remover o produto ID " + id + " (" + name + ")?\n" +
                    "Todas as movimentações desse produto no estoque também serão excluídas.",
                    "Confirmação", JOptionPane.YES_NO_OPTION);

            if (confirm == JOptionPane.YES_OPTION) {
                model.removeRow(selectedRow);
                FileUtil.removeLineById(filename, id);
                removeFromStock(name);
            }
        } else {
            JOptionPane.showMessageDialog(this, "Selecione um produto para remover.");
        }
    }

    private void removeFromStock(String productName) {
        String estoqueFile = "txt/Controle_Estoque.txt";
        java.util.List<String> lines = FileUtil.readLines(estoqueFile);
        java.util.List<String> updated = new java.util.ArrayList<>();

        for (String l : lines) {
            String[] parts = l.split(";");
            if (parts.length >= 2) {
                String prod = parts[1];
                if (!prod.equals(productName)) {
                    updated.add(l);
                }
            }
        }
        FileUtil.saveLines(estoqueFile, updated);
    }

    private void editItem() {
    int selectedRow = table.getSelectedRow();
    if (selectedRow >= 0) {
        int id = (int) model.getValueAt(selectedRow, 0);
        String oldName = (String) model.getValueAt(selectedRow, 1);
        double oldPrice = (double) model.getValueAt(selectedRow, 2);
        // O índice 4 contém o caminho completo da imagem (a coluna está oculta)
        String oldImagePath = (String) model.getValueAt(selectedRow, 4); 

        JDialog dialog = new JDialog(this, "Editar Produto", true);
        dialog.setSize(600, 500);
        dialog.setLocationRelativeTo(this);
        dialog.setLayout(new BorderLayout());

        JPanel panelFields = new JPanel(new GridLayout(2, 2, 10, 10));
        // Exibe o preço inicial com formato de ponto para ser editável (ex: 19.99)
        JTextField txtName = new JTextField(oldName);
        JTextField txtPrice = new JTextField(String.valueOf(oldPrice)); 

        panelFields.add(new JLabel("Nome:"));
        panelFields.add(txtName);
        panelFields.add(new JLabel("Preço (use . ou ,):")); // Dica para o usuário
        panelFields.add(txtPrice);
        dialog.add(panelFields, BorderLayout.NORTH);

        JFileChooser chooser = new JFileChooser();
        if (oldImagePath != null && !oldImagePath.isEmpty()) {
            chooser.setSelectedFile(new File(oldImagePath));
        }
        dialog.add(chooser, BorderLayout.CENTER);

        JPanel panelButtons = new JPanel(new FlowLayout(FlowLayout.RIGHT));
        JButton btnSalvar = new JButton("Salvar");
        JButton btnCancelar = new JButton("Cancelar");
        panelButtons.add(btnSalvar);
        panelButtons.add(btnCancelar);
        dialog.add(panelButtons, BorderLayout.SOUTH);

        btnCancelar.addActionListener(e -> dialog.dispose());

        btnSalvar.addActionListener(e -> {
            try {
                String newName = txtName.getText().trim();
                
                // Trata a vírgula para permitir Double.parseDouble
                double newPrice = Double.parseDouble(txtPrice.getText().trim().replace(",", "."));
                
                File selectedFile = chooser.getSelectedFile();
                String newImagePath = oldImagePath;

                if (selectedFile != null) {
                    File dest = new File("images", selectedFile.getName());
                    dest.getParentFile().mkdirs();
                    FileUtil.copyFile(selectedFile, dest);
                    newImagePath = dest.getPath();
                }

                // Formata o novo preço para salvar no arquivo com ponto decimal 
                String priceForFile = String.format("%.2f", newPrice).replace(",", "."); 
                
                // Cria a string de linha de forma correta e única
                String newLine = id + ";" + newName + ";" + priceForFile + ";" + newImagePath;
                
                // Atualiza o arquivo
                FileUtil.updateLineById(filename, id, newLine);

                // Atualiza a tabela (view) - APLICAÇÃO DA SOLUÇÃO WEBP/IMAGEM
                ImageIcon thumbnail = getResizedIcon(newImagePath, 60, 60);
                model.setValueAt(newName, selectedRow, 1);
                model.setValueAt(newPrice, selectedRow, 2); // Mantém double no Model
                model.setValueAt(thumbnail, selectedRow, 3);
                model.setValueAt(newImagePath, selectedRow, 4);

                dialog.dispose();
            } catch (NumberFormatException ex) {
                JOptionPane.showMessageDialog(dialog, "Formato de preço inválido. Use apenas números. Ex: 19.99 ou 19,99.");
            } catch (Exception ex) {
                JOptionPane.showMessageDialog(dialog, "Erro ao editar: " + ex.getMessage());
            }
        });

        dialog.setVisible(true);

    } else {
        JOptionPane.showMessageDialog(this, "Selecione um produto para editar.");
    }
}

    // FUNÇÃO CORRIGIDA PARA USAR getResizedIcon
    private void showPreview() {
        int selectedRow = table.getSelectedRow();
        if (selectedRow >= 0) {
            String imagePath = (String) model.getValueAt(selectedRow, 4);
            if (imagePath != null && new File(imagePath).exists()) {
                
                // Reutiliza a função getResizedIcon para o preview em 300x300
                ImageIcon previewIcon = getResizedIcon(imagePath, 300, 300);

                if (previewIcon != null) {
                    JLabel label = new JLabel(previewIcon);
                    JOptionPane.showMessageDialog(this, label, "Preview da Imagem", JOptionPane.PLAIN_MESSAGE);
                } else {
                    JOptionPane.showMessageDialog(this, "Erro ao carregar a imagem ou formato não suportado (WebP requer plugin).", "Erro de Imagem", JOptionPane.ERROR_MESSAGE);
                }

            } else {
                JOptionPane.showMessageDialog(this, "Imagem não encontrada.");
            }
        } else {
            JOptionPane.showMessageDialog(this, "Selecione um item para visualizar.");
        }
    }


// FUNÇÃO AUXILIAR PARA CARREGAR IMAGEM (COPIADA DE YASAR.JAVA)
private ImageIcon getResizedIcon(String path, int w, int h) {
    if (path == null || path.isEmpty() || !(new File(path).exists())) {
        return null;
    }

    try {
        // Usa ImageIO.read, que suporta WebP se o plugin TwelveMonkeys estiver instalado
        BufferedImage original = ImageIO.read(new File(path));
        
        if (original == null) {
            // Se ImageIO.read retornar null, o formato não é suportado.
            return null;
        }

        // Redimensiona usando o método mais moderno (Graphics2D) para melhor qualidade
        BufferedImage resized = new BufferedImage(w, h, BufferedImage.TYPE_INT_ARGB);
        Graphics2D g2 = resized.createGraphics();
        g2.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BILINEAR);
        g2.drawImage(original, 0, 0, w, h, null);
        g2.dispose();

        return new ImageIcon(resized);

    } catch (IOException e) {
        System.err.println("Erro ao carregar imagem: " + path + ". Erro: " + e.getMessage());
        return null;
    }
}


    public static void main(String[] args) {
        SwingUtilities.invokeLater(() -> new ItemsStoreControl().setVisible(true));
    }
}