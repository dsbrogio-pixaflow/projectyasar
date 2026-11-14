// --------------------------------------
// File: DashboardControl.java
// --------------------------------------

import javax.swing.*;
import java.awt.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

public class DashboardControl extends JFrame {

    private Map<String, Integer> estoqueEntradas = new LinkedHashMap<>();
    private Map<String, Integer> estoqueSaidas = new LinkedHashMap<>();
    private Map<String, Integer> vendasMensais = new LinkedHashMap<>();
    private Map<String, Double> financeiroMensal = new LinkedHashMap<>();

    private final String financeiroFile = "txt/Controle_Financeiro.txt";
    private final String vendasFile = "txt/Controle_Vendas.txt";
    private final String estoqueFile = "txt/Controle_Estoque.txt";

    public DashboardControl() {
        setTitle("Relatório Geral");
        setSize(1300, 700);
        setDefaultCloseOperation(JFrame.DISPOSE_ON_CLOSE);
        setLocationRelativeTo(null);
        setLayout(new GridLayout(2, 2, 15, 15));
        getContentPane().setBackground(new Color(245, 245, 250));

        loadData();

        add(new StockChartPanel("Estoque (Entradas / Saídas)", estoqueEntradas, estoqueSaidas));
        add(new SalesChartPanel("Vendas", vendasMensais));
        add(new FinancialChartPanel("Fluxo de Gastos", financeiroMensal));
        add(new JPanel()); // espaço vazio no grid
    }

    // -----------------------------
    // Carregamento de dados
    // -----------------------------
    private void loadData() {
        loadStockData();
        loadSalesData();
        loadFinanceData();
    }

    // ======= ESTOQUE =======
    private void loadStockData() {
        File file = new File(estoqueFile);
        if (!file.exists()) return;
        try (BufferedReader br = new BufferedReader(new InputStreamReader(new FileInputStream(file), StandardCharsets.UTF_8))) {
            String linha;
            while ((linha = br.readLine()) != null) {
                String[] p = linha.split(";");
                if (p.length >= 4) {
                    try {
                        String[] partes = p[0].split("/");
                        int dia = Integer.parseInt(partes[0].trim());
                        int mes = Integer.parseInt(partes[1].trim());
                        int ano = Integer.parseInt(partes[2].trim());
                        String mesKey = String.format("%04d-%02d", ano, mes);

                        String tipo = p[2].trim().toLowerCase();
                        int qty = Integer.parseInt(p[3].trim());

                        if ("entrada".equals(tipo))
                            estoqueEntradas.put(mesKey, estoqueEntradas.getOrDefault(mesKey, 0) + qty);
                        else if ("saída".equals(tipo) || "saida".equals(tipo))
                            estoqueSaidas.put(mesKey, estoqueSaidas.getOrDefault(mesKey, 0) + qty);
                    } catch (Exception ignored) {}
                }
            }
        } catch (Exception e) { e.printStackTrace(); }
    }

    // ======= VENDAS =======
    private void loadSalesData() {
        File file = new File(vendasFile);
        if (!file.exists()) return;
        try (BufferedReader br = new BufferedReader(new InputStreamReader(new FileInputStream(file), StandardCharsets.UTF_8))) {
            String linha;
            while ((linha = br.readLine()) != null) {
                String[] p = linha.split(";");
                if (p.length >= 5) {
                    try {
                        String[] partes = p[1].split("/");
                        int dia = Integer.parseInt(partes[0].trim());
                        int mes = Integer.parseInt(partes[1].trim());
                        int ano = Integer.parseInt(partes[2].trim());
                        String mesKey = String.format("%04d-%02d", ano, mes);

                        int qty = Integer.parseInt(p[4].trim());
                        vendasMensais.put(mesKey, vendasMensais.getOrDefault(mesKey, 0) + qty);
                    } catch (Exception ignored) {}
                }
            }
        } catch (Exception e) { e.printStackTrace(); }
    }

    // ======= FINANCEIRO =======
    private void loadFinanceData() {
        File file = new File(financeiroFile);
        if (!file.exists()) return;
        try (BufferedReader br = new BufferedReader(new InputStreamReader(new FileInputStream(file), StandardCharsets.UTF_8))) {
            String linha;
            while ((linha = br.readLine()) != null) {
                String[] p = linha.split(";");
                if (p.length >= 3) {
                    try {
                        // Converte qualquer formato de data para dd/MM/yyyy
                        String[] partes = p[0].split("/");
                        int dia = Integer.parseInt(partes[0].trim());
                        int mes = Integer.parseInt(partes[1].trim());
                        int ano = Integer.parseInt(partes[2].trim());
                        String data = String.format("%02d/%02d/%04d", dia, mes, ano);
                        String mesKey = data.substring(6, 10) + "-" + data.substring(3, 5); // AAAA-MM

                        double valor = Double.parseDouble(p[2].trim());
                        financeiroMensal.put(mesKey, financeiroMensal.getOrDefault(mesKey, 0.0) + valor);
                    } catch (Exception ignored) {}
                }
            }
        } catch (IOException e) { e.printStackTrace(); }
    }

    // -----------------------------
    // Gráfico de Estoque
    // -----------------------------
    static class StockChartPanel extends JPanel {
        private final String title;
        private final Map<String, Integer> entradas, saidas;

        public StockChartPanel(String title, Map<String, Integer> entradas, Map<String, Integer> saidas) {
            this.title = title;
            this.entradas = entradas;
            this.saidas = saidas;
            setBackground(Color.WHITE);
        }

        @Override
        protected void paintComponent(Graphics g) {
            super.paintComponent(g);
            drawTitle(g, title, getWidth());
            if (entradas.isEmpty() && saidas.isEmpty()) return;

            int heightMax = getHeight() - 120;
            int barWidth = 25;
            int baseY = getHeight() - 60;
            int max = Math.max(
                    entradas.values().stream().max(Integer::compareTo).orElse(1),
                    saidas.values().stream().max(Integer::compareTo).orElse(1)
            );

            int x = 80;
            for (String mes : entradas.keySet()) {
                int ent = entradas.getOrDefault(mes, 0);
                int sai = saidas.getOrDefault(mes, 0);
                int hEnt = (int) ((double) ent / max * heightMax);
                int hSai = (int) ((double) sai / max * heightMax);

                g.setColor(new Color(76, 175, 80));
                g.fillRect(x, baseY - hEnt, barWidth, hEnt);
                g.setColor(Color.BLACK);
                g.drawString(String.valueOf(ent), x, baseY - hEnt - 5);

                g.setColor(new Color(244, 67, 54));
                g.fillRect(x + barWidth + 5, baseY - hSai, barWidth, hSai);
                g.setColor(Color.BLACK);
                g.drawString(String.valueOf(sai), x + barWidth + 5, baseY - hSai - 5);

                g.setColor(Color.DARK_GRAY);
                g.drawString(mes, x, baseY + 20);
                x += 70;
            }

            drawLegend(g, new String[]{"Entradas", "Saídas"}, new Color[]{new Color(76, 175, 80), new Color(244, 67, 54)});
        }
    }

    // -----------------------------
    // Gráfico de Vendas
    // -----------------------------
    static class SalesChartPanel extends JPanel {
        private final String title;
        private final Map<String, Integer> data;

        public SalesChartPanel(String title, Map<String, Integer> data) {
            this.title = title;
            this.data = data;
            setBackground(Color.WHITE);
        }

        @Override
        protected void paintComponent(Graphics g) {
            super.paintComponent(g);
            drawTitle(g, title, getWidth());
            if (data.isEmpty()) return;

            int heightMax = getHeight() - 120;
            int baseY = getHeight() - 60;
            int barWidth = 35;
            int max = data.values().stream().max(Integer::compareTo).orElse(1);
            int x = 80;

            g.setColor(new Color(33, 150, 243));
            for (String mes : data.keySet()) {
                int val = data.get(mes);
                int h = (int) ((double) val / max * heightMax);
                g.fillRect(x, baseY - h, barWidth, h);
                g.setColor(Color.BLACK);
                g.drawString(String.valueOf(val), x + 5, baseY - h - 5);
                g.setColor(Color.DARK_GRAY);
                g.drawString(mes, x, baseY + 20);
                g.setColor(new Color(33, 150, 243));
                x += 70;
            }
        }
    }

    // -----------------------------
    // Gráfico Financeiro
    // -----------------------------
    static class FinancialChartPanel extends JPanel {
        private final String title;
        private final Map<String, Double> data;

        public FinancialChartPanel(String title, Map<String, Double> data) {
            this.title = title;
            this.data = data;
            setBackground(Color.WHITE);
        }

        @Override
        protected void paintComponent(Graphics g) {
            super.paintComponent(g);
            drawTitle(g, title, getWidth());
            if (data.isEmpty()) return;

            int heightMax = getHeight() - 120;
            int baseY = getHeight() - 60;
            int barWidth = 35;
            double max = data.values().stream().max(Double::compareTo).orElse(1.0);
            int x = 80;

            g.setColor(new Color(255, 193, 7));
            for (String mes : data.keySet()) {
                double val = data.get(mes);
                int h = (int) (val / max * heightMax);
                g.fillRect(x, baseY - h, barWidth, h);
                g.setColor(Color.BLACK);
                g.drawString(String.format("R$ %.2f", val), x - 10, baseY - h - 5);
                g.setColor(Color.DARK_GRAY);
                g.drawString(mes, x, baseY + 20);
                g.setColor(new Color(255, 193, 7));
                x += 70;
            }
        }
    }

    // -----------------------------
    // Utilitários de desenho
    // -----------------------------
    private static void drawTitle(Graphics g, String title, int panelWidth) {
        g.setColor(Color.BLACK);
        g.setFont(new Font("Segoe UI", Font.BOLD, 16));
        FontMetrics fm = g.getFontMetrics();
        int textWidth = fm.stringWidth(title);
        int x = (panelWidth - textWidth) / 2;
        g.drawString(title, x, 25);
    }

    private static void drawLegend(Graphics g, String[] labels, Color[] colors) {
        int x = 15;
        int y = 40;
        for (int i = 0; i < labels.length; i++) {
            g.setColor(colors[i]);
            g.fillRect(x, y - 10, 15, 15);
            g.setColor(Color.BLACK);
            g.drawRect(x, y - 10, 15, 15);
            g.drawString(labels[i], x + 25, y + 2);
            x += 130;
        }
    }

    public static void main(String[] args) {
        SwingUtilities.invokeLater(() -> new DashboardControl().setVisible(true));
    }
}