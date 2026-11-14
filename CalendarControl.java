// --------------------------------------------
// File: CalendarControl.java
// --------------------------------------------

import javax.swing.*;
import java.awt.*;
import java.awt.event.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.time.*;
import java.time.format.DateTimeFormatter;
import java.util.*;
import jakarta.mail.*;
import jakarta.mail.internet.*;

public class CalendarControl extends JFrame {

    private JPanel calendarPanel;
    private JLabel monthLabel;
    private LocalDate currentMonth;
    private java.util.List<Evento> eventos = new ArrayList<>();
    private final DateTimeFormatter fmt = DateTimeFormatter.ofPattern("dd/MM/yyyy");

    private final String calendarioFile = "txt/Controle_Calendario.txt";
    private final String clientesFile = "txt/Controle_Clientes.txt";
    private final String configEmailFile = "txt/Controle_config_email.txt";

    public CalendarControl() {
        setTitle("Calendário Completo");
        setSize(1300, 700);
        setDefaultCloseOperation(JFrame.DISPOSE_ON_CLOSE);
        setLocationRelativeTo(null);
        setLayout(new BorderLayout(8,8));

        currentMonth = LocalDate.now().withDayOfMonth(1);

        loadPersistedEventos();
        loadAniversariosFromClientes();

        JPanel topPanel = new JPanel(new BorderLayout(6,6));
        JButton prevMonth = new JButton("<");
        JButton nextMonth = new JButton(">");
        monthLabel = new JLabel("", SwingConstants.CENTER);
        monthLabel.setFont(new Font("SansSerif", Font.BOLD, 22));
        updateMonthLabel();

        prevMonth.addActionListener(e -> {
            currentMonth = currentMonth.minusMonths(1);
            updateMonthLabel();
            drawCalendar();
        });
        nextMonth.addActionListener(e -> {
            currentMonth = currentMonth.plusMonths(1);
            updateMonthLabel();
            drawCalendar();
        });

        JPanel navPanel = new JPanel(new BorderLayout());
        navPanel.add(prevMonth, BorderLayout.WEST);
        navPanel.add(monthLabel, BorderLayout.CENTER);
        navPanel.add(nextMonth, BorderLayout.EAST);

        JPanel actionPanel = new JPanel(new FlowLayout(FlowLayout.RIGHT, 6, 0));
        JButton addEventoBtn = new JButton("➕ Adicionar Evento");
        JButton btnConfig = new JButton("⚙ Configurações");
        JButton btnEmail = new JButton("📧 E-mail");

        addEventoBtn.addActionListener(e -> adicionarEventoDialog());
        btnConfig.addActionListener(e -> new EmailConfigDialog(this, configEmailFile).setVisible(true));
        btnEmail.addActionListener(e -> new EmailDialog(this).setVisible(true));

        actionPanel.add(addEventoBtn);
        actionPanel.add(btnConfig);
        actionPanel.add(btnEmail);

        topPanel.add(navPanel, BorderLayout.CENTER);
        topPanel.add(actionPanel, BorderLayout.EAST);
        add(topPanel, BorderLayout.NORTH);

        calendarPanel = new JPanel();
        calendarPanel.setBackground(Color.WHITE);
        add(new JScrollPane(calendarPanel), BorderLayout.CENTER);

        drawCalendar();
    }

    private void updateMonthLabel() {
        String mes = currentMonth.getMonth().toString().substring(0,1)
                + currentMonth.getMonth().toString().substring(1).toLowerCase();
        monthLabel.setText(mes + " " + currentMonth.getYear());
    }

    private void drawCalendar() {
    calendarPanel.removeAll();
    calendarPanel.setLayout(new GridLayout(0, 7, 6, 6));
    calendarPanel.setBorder(BorderFactory.createEmptyBorder(8, 8, 8, 8));

    String[] dias = {"Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"};
    for (String d : dias) {
        JLabel lbl = new JLabel(d, SwingConstants.CENTER);
        lbl.setFont(new Font("SansSerif", Font.BOLD, 14));
        lbl.setForeground(new Color(0, 80, 160));
        calendarPanel.add(lbl);
    }

    LocalDate firstDay = currentMonth;
    int startDay = firstDay.getDayOfWeek().getValue() % 7;
    for (int i = 0; i < startDay; i++) calendarPanel.add(new JLabel(""));

    int daysInMonth = currentMonth.lengthOfMonth();
    for (int day = 1; day <= daysInMonth; day++) {
        LocalDate date = currentMonth.withDayOfMonth(day);
        JButton dayBtn = new JButton(String.valueOf(day));
        dayBtn.setMargin(new Insets(6, 6, 6, 6));
        dayBtn.setHorizontalAlignment(SwingConstants.CENTER);
        dayBtn.setVerticalAlignment(SwingConstants.TOP);
        dayBtn.setBackground(Color.WHITE);
        dayBtn.setOpaque(true);

        boolean hasAniv = false, hasFeriado = false, hasComemorativo = false;

        for (Evento ev : eventos) {
            boolean sameDay = false;
            if ("Aniversário".equalsIgnoreCase(ev.tipo)) {
                // Verifica se o dia e mês coincidem, independente do ano
                sameDay = (ev.data.getDayOfMonth() == date.getDayOfMonth() &&
                           ev.data.getMonthValue() == date.getMonthValue());
            } else {
                sameDay = ev.data.equals(date);
            }

            if (sameDay) {
                String t = ev.tipo.toLowerCase();
                if (t.contains("anivers")) hasAniv = true;
                else if (t.contains("feriado")) hasFeriado = true;
                else if (t.contains("comemor")) hasComemorativo = true;
            }
        }

        if (hasAniv) dayBtn.setBackground(new Color(204, 255, 204));
        else if (hasFeriado) dayBtn.setBackground(new Color(255, 230, 230));
        else if (hasComemorativo) dayBtn.setBackground(new Color(220, 235, 255));

        if (date.equals(LocalDate.now())) {
            dayBtn.setBorder(BorderFactory.createLineBorder(Color.RED, 3));
        }

        dayBtn.addActionListener(e -> mostrarEventosDia(date));

        dayBtn.addMouseListener(new MouseAdapter() {
            @Override
            public void mousePressed(MouseEvent me) { if (me.isPopupTrigger()) doPopup(me); }
            @Override
            public void mouseReleased(MouseEvent me) { if (me.isPopupTrigger()) doPopup(me); }
            private void doPopup(MouseEvent me) { showDayPopup(me, date, dayBtn); }
        });

        calendarPanel.add(dayBtn);
        }

        calendarPanel.revalidate();
        calendarPanel.repaint();
        }


    // ---------- Leitura e Escrita UTF-8 ----------

    private void loadPersistedEventos() {
        eventos.clear();
        try (BufferedReader br = new BufferedReader(
                new InputStreamReader(new FileInputStream(calendarioFile), StandardCharsets.UTF_8))) {
            String l;
            while ((l = br.readLine()) != null) {
                String[] p = l.split(";");
                if (p.length >= 3) {
                    try {
                        LocalDate d = LocalDate.parse(p[0], fmt);
                        eventos.add(new Evento(d, p[1], p[2]));
                    } catch (Exception ignored) {}
                }
            }
        } catch (IOException ignored) {}
    }

private void persistSaveNonBirthdayEventos() {
    try (BufferedWriter bw = new BufferedWriter(
            new OutputStreamWriter(new FileOutputStream(calendarioFile), StandardCharsets.UTF_8))) {

        for (Evento ev : eventos) {
            if (!"Aniversário".equalsIgnoreCase(ev.tipo)) {
                bw.write(ev.data.format(fmt) + ";" + ev.descricao + ";" + ev.tipo);
                bw.newLine();
            }
        }

    } catch (IOException e) {
        JOptionPane.showMessageDialog(
            this,
            "❌ Erro ao salvar calendário:\n" + e.getMessage(),
            "Erro ao Salvar",
            JOptionPane.ERROR_MESSAGE
        );
    }
}



    private void loadAniversariosFromClientes() {
    eventos.removeIf(ev -> "Aniversário".equalsIgnoreCase(ev.tipo)); // remove antigos
    File file = new File(clientesFile);

    if (!file.exists()) {
        JOptionPane.showMessageDialog(
            this,
            "⚠️ Arquivo de clientes não encontrado:\n" + clientesFile,
            "Aviso", JOptionPane.WARNING_MESSAGE );
        return;
    }
    try (BufferedReader br = new BufferedReader(new InputStreamReader(new FileInputStream(file), StandardCharsets.UTF_8))) {

        String linha;
        int ignorados = 0;
        while ((linha = br.readLine()) != null) {
            linha = linha.trim();
            if (linha.isEmpty()) continue;
            String[] p = linha.split(";");
            if (p.length >= 6) {
                String nome = p[1].trim();
                String email = p[2].trim();
                String dataTexto = p[4].trim();
                try {
                    // aceita formatos dd/MM e d/M
                    if (!dataTexto.matches("\\d{1,2}/\\d{1,2}")) {
                        ignorados++;
                        continue;
                    }
                    // cria data manualmente usando o ano atual
                    String[] partes = dataTexto.split("/");
                    int dia = Integer.parseInt(partes[0]);
                    int mes = Integer.parseInt(partes[1]);
                    LocalDate aniversario = LocalDate.of(LocalDate.now().getYear(), mes, dia);

                    String descricao = "Aniversário de " + nome + " (" + email + ")";

                    boolean existe = eventos.stream()
                            .anyMatch(e -> e.descricao.equalsIgnoreCase(descricao)
                                    && e.data.equals(aniversario));

                    if (!existe) { eventos.add(new Evento(aniversario, descricao, "Aniversário")); }
                } 
                catch (Exception ex) { ignorados++; }
                }
        }

        long qtdAniversarios = eventos.stream()
                .filter(e -> "Aniversário".equalsIgnoreCase(e.tipo))
                .count();

        // JOptionPane.showMessageDialog(this,"Aniversários carregados:" + qtdAniversarios + (ignorados > 0 ? "\n⚠️ " + ignorados + " registro(s) ignorado(s) por erro de data." : ""), "Importação de Aniversários", JOptionPane.INFORMATION_MESSAGE);
        } 
        catch (IOException e) {
        JOptionPane.showMessageDialog(this, "❌ Erro ao ler clientes:\n" + e.getMessage(), "Erro", JOptionPane.ERROR_MESSAGE);
        }
        }

    // ---------- Métodos adicionados ----------

    private void adicionarEventoDialog() {
        JTextField txtData = new JTextField(LocalDate.now().format(fmt));
        JTextField txtDesc = new JTextField();
        String[] tipos = {"Feriado", "Comemorativo", "Outro"};
        JComboBox<String> tipoBox = new JComboBox<>(tipos);

        JPanel p = new JPanel(new GridLayout(3,2,8,8));
        p.add(new JLabel("Data (dd/MM/yyyy):"));
        p.add(txtData);
        p.add(new JLabel("Descrição:"));
        p.add(txtDesc);
        p.add(new JLabel("Tipo:"));
        p.add(tipoBox);

        int res = JOptionPane.showConfirmDialog(this, p, "Adicionar Evento", JOptionPane.OK_CANCEL_OPTION);
        if (res == JOptionPane.OK_OPTION) {
            try {
                LocalDate data = LocalDate.parse(txtData.getText(), fmt);
                String desc = txtDesc.getText().trim();
                String tipo = tipoBox.getSelectedItem().toString();
                if (desc.isEmpty()) {
                    JOptionPane.showMessageDialog(this, "Descrição não pode estar vazia!");
                    return;
                }
                eventos.add(new Evento(data, desc, tipo));
                persistSaveNonBirthdayEventos();
                drawCalendar();
            } catch (Exception ex) {
                JOptionPane.showMessageDialog(this, "Data inválida!");
            }
        }
    }

    private void mostrarEventosDia(LocalDate date) {
    StringBuilder sb = new StringBuilder();

    for (Evento ev : eventos) {
        boolean mesmoDia = false;

        if ("Aniversário".equalsIgnoreCase(ev.tipo)) {
            // compara apenas dia e mês (evento recorrente anual)
            mesmoDia = ev.data.getDayOfMonth() == date.getDayOfMonth() &&
                       ev.data.getMonthValue() == date.getMonthValue();
        } else {
            // eventos normais — compara a data completa
            mesmoDia = ev.data.equals(date);
        }

        if (mesmoDia) {
            sb.append("• ").append(ev.descricao).append(" (").append(ev.tipo).append(")\n");
        }
    }

    if (sb.length() == 0) {
        sb.append("Nenhum evento para este dia.");
    }

    JOptionPane.showMessageDialog(
        this,
        sb.toString(),
        "Eventos em " + date.format(fmt),
        JOptionPane.INFORMATION_MESSAGE
    );
}

    private void showDayPopup(MouseEvent me, LocalDate date, JButton dayBtn) {
        JPopupMenu menu = new JPopupMenu();
        JMenuItem add = new JMenuItem("Adicionar Evento");
        JMenuItem view = new JMenuItem("Ver Eventos");
        JMenuItem remove = new JMenuItem("Remover Eventos do Dia");

        add.addActionListener(e -> adicionarEventoDialog());
        view.addActionListener(e -> mostrarEventosDia(date));
        remove.addActionListener(e -> {
            eventos.removeIf(ev -> ev.data.equals(date));
            persistSaveNonBirthdayEventos();
            drawCalendar();
        });

        menu.add(add);
        menu.add(view);
        menu.add(remove);
        menu.show(dayBtn, me.getX(), me.getY());
    }

    // ---------- Classe auxiliar de evento ----------
    static class Evento {
        LocalDate data;
        String descricao;
        String tipo;
        Evento(LocalDate d, String desc, String t) {
            data = d; descricao = desc; tipo = t;
        }
    }
private class EmailDialog extends JDialog {
    private JTextArea txtMensagem;
    private JTextField txtAssunto;
    private JButton btnEnviar;

    EmailDialog(JFrame parent) {
        super(parent, "Enviar E-mails de Aniversário", true);
        setSize(560, 420);
        setLocationRelativeTo(parent);
        setLayout(new BorderLayout(8,8));

        JPanel north = new JPanel(new BorderLayout(6,6));
        txtAssunto = new JTextField("🎉 Feliz Aniversário!");
        north.add(new JLabel("Assunto:"), BorderLayout.WEST);
        north.add(txtAssunto, BorderLayout.CENTER);

        txtMensagem = new JTextArea("Olá [Nome],\n\nDesejamos a você um feliz aniversário!\n\n— Sistema de Eventos");
        txtMensagem.setLineWrap(true);
        txtMensagem.setWrapStyleWord(true);

        JScrollPane scroll = new JScrollPane(txtMensagem);

        btnEnviar = new JButton("Enviar E-mails");
        btnEnviar.addActionListener(e -> enviarEmailsDaJanela());

        add(north, BorderLayout.NORTH);
        add(scroll, BorderLayout.CENTER);
        add(btnEnviar, BorderLayout.SOUTH);
    }

    private void enviarEmailsDaJanela() {
        String mensagemPadrao = txtMensagem.getText().trim();
        String assunto = txtAssunto.getText().trim();
        if (mensagemPadrao.isEmpty() || assunto.isEmpty()) {
            JOptionPane.showMessageDialog(this, "Assunto e mensagem não podem ficar vazios.", "Aviso", JOptionPane.WARNING_MESSAGE);
            return;
        }

        File cfg = new File(configEmailFile);
        if (!cfg.exists()) {
            JOptionPane.showMessageDialog(this, "Arquivo '" + configEmailFile + "' não encontrado.\nUse Configurações para criar.", "Erro", JOptionPane.ERROR_MESSAGE);
            return;
        }

        Properties propsArquivo = new Properties();
        try (InputStreamReader reader = new InputStreamReader(new FileInputStream(cfg), StandardCharsets.UTF_8)) {
            propsArquivo.load(reader);
        } catch (IOException ex) {
            JOptionPane.showMessageDialog(this, "Erro ao ler arquivo de configuração: " + ex.getMessage(), "Erro", JOptionPane.ERROR_MESSAGE);
            return;
        }

        String remetente = propsArquivo.getProperty("email", "").trim();
        String senha = propsArquivo.getProperty("senha", "").trim();
        String smtp = propsArquivo.getProperty("smtp", "").trim();
        String porta = propsArquivo.getProperty("porta", "").trim();

        if (remetente.isEmpty() || senha.isEmpty() || smtp.isEmpty() || porta.isEmpty()) {
            JOptionPane.showMessageDialog(this, "Arquivo de configuração incompleto.", "Erro", JOptionPane.ERROR_MESSAGE);
            return;
        }

        Properties mailProps = new Properties();
        mailProps.put("mail.smtp.auth", "true");
        mailProps.put("mail.smtp.starttls.enable", "true");
        mailProps.put("mail.smtp.host", smtp);
        mailProps.put("mail.smtp.port", porta);

        Session session = Session.getInstance(mailProps, new jakarta.mail.Authenticator() {
            protected PasswordAuthentication getPasswordAuthentication() {
                return new PasswordAuthentication(remetente, senha);
            }
        });

        LocalDate hoje = LocalDate.now();
        int enviados = 0;
        java.util.List<String> erros = new ArrayList<>();

        for (Evento ev : eventos) {
            if ("Aniversário".equalsIgnoreCase(ev.tipo) && ev.data.equals(hoje)) {
                String email = extrairEmail(ev.descricao);
                if (email != null && !email.isEmpty()) {
                    String nome = ev.descricao.replaceFirst("Aniversário de\\s*", "").replaceAll("\\(.*\\)", "").trim();
                    String mensagemPersonalizada = mensagemPadrao.replace("[Nome]", nome);
                    try {
                        enviarEmail(session, remetente, email, assunto, mensagemPersonalizada);
                        enviados++;
                    } catch (Exception ex) {
                        erros.add(email + ": " + ex.getMessage());
                    }
                }
            }
        }

        if (enviados > 0) {
            JOptionPane.showMessageDialog(this, "✅ " + enviados + " e-mail(s) enviados com sucesso!");
        } else {
            JOptionPane.showMessageDialog(this, "Nenhum aniversariante encontrado para hoje ou nenhum e-mail válido.");
        }

        if (!erros.isEmpty()) {
            StringBuilder sb = new StringBuilder("Erros ao enviar para:\n");
            for (String er : erros) sb.append(er).append("\n");
            JOptionPane.showMessageDialog(this, sb.toString(), "Erros", JOptionPane.ERROR_MESSAGE);
        }

        dispose();
    }

    // reaproveita método existente (extrair email)
    private String extrairEmail(String texto) {
        int ini = texto.indexOf("(");
        int fim = texto.indexOf(")");
        if (ini >= 0 && fim > ini) {
            return texto.substring(ini + 1, fim).trim();
        }
        return null;
    }

    private void enviarEmail(Session session, String from, String to, String assunto, String mensagem) throws MessagingException {
        Message msg = new MimeMessage(session);
        msg.setFrom(new InternetAddress(from));
        msg.setRecipients(Message.RecipientType.TO, InternetAddress.parse(to));
        msg.setSubject(assunto);
        msg.setText(mensagem);
        Transport.send(msg);
    }
}
    // ---------- Execução ----------
    public static void main(String[] args) {
        SwingUtilities.invokeLater(() -> new CalendarControl().setVisible(true));
    }
}
