// --------------------------------------------
// File: EmailConfigDialog.java
// --------------------------------------------

import javax.swing.*;
import java.awt.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.Properties;

public class EmailConfigDialog extends JDialog {

    private JTextField txtEmail;
    private JPasswordField txtSenha;
    private JTextField txtServidor;
    private JTextField txtPorta;
    private final String configFile;

    public EmailConfigDialog(JFrame parent, String configFile) {
        super(parent, "Configurações de E-mail", true);
        this.configFile = configFile;

        setSize(420, 260);
        setLocationRelativeTo(parent);
        setLayout(new BorderLayout(10, 10));

        JPanel panel = new JPanel(new GridLayout(5, 2, 8, 8));
        panel.setBorder(BorderFactory.createEmptyBorder(15, 20, 15, 20));

        txtEmail = new JTextField();
        txtSenha = new JPasswordField();
        txtServidor = new JTextField("smtp.gmail.com");
        txtPorta = new JTextField("587");

        panel.add(new JLabel("E-mail remetente:"));
        panel.add(txtEmail);
        panel.add(new JLabel("Senha do app:"));
        panel.add(txtSenha);
        panel.add(new JLabel("Servidor SMTP:"));
        panel.add(txtServidor);
        panel.add(new JLabel("Porta:"));
        panel.add(txtPorta);

        JButton btnSalvar = new JButton("💾 Salvar Configurações");
        JButton btnCancelar = new JButton("Cancelar");

        JPanel botoes = new JPanel(new FlowLayout(FlowLayout.RIGHT));
        botoes.add(btnCancelar);
        botoes.add(btnSalvar);

        add(panel, BorderLayout.CENTER);
        add(botoes, BorderLayout.SOUTH);

        carregarConfig();

        // Eventos
        btnSalvar.addActionListener(e -> salvarConfig());
        btnCancelar.addActionListener(e -> dispose());
    }

    /** 📥 Lê o arquivo de configuração de e-mail (UTF-8) */
    private void carregarConfig() {
        File file = new File(configFile);
        if (!file.exists()) return;

        Properties props = new Properties();

        try (InputStreamReader reader = new InputStreamReader(
                new FileInputStream(file), StandardCharsets.UTF_8)) {

            props.load(reader);

            txtEmail.setText(props.getProperty("email", ""));
            txtSenha.setText(props.getProperty("senha", ""));
            txtServidor.setText(props.getProperty("smtp", "smtp.gmail.com"));
            txtPorta.setText(props.getProperty("porta", "587"));

        } catch (IOException e) {
            JOptionPane.showMessageDialog(this,
                    "Erro ao carregar configurações: " + e.getMessage(),
                    "Erro", JOptionPane.ERROR_MESSAGE);
        }
    }

    /** 💾 Salva as configurações de e-mail no arquivo (UTF-8) */
    private void salvarConfig() {
        String email = txtEmail.getText().trim();
        String senha = new String(txtSenha.getPassword()).trim();
        String servidor = txtServidor.getText().trim();
        String porta = txtPorta.getText().trim();

        if (email.isEmpty() || senha.isEmpty() || servidor.isEmpty() || porta.isEmpty()) {
            JOptionPane.showMessageDialog(this, "⚠️ Preencha todos os campos antes de salvar!");
            return;
        }

        Properties props = new Properties();
        props.setProperty("email", email);
        props.setProperty("senha", senha);
        props.setProperty("smtp", servidor);
        props.setProperty("porta", porta);

        try (OutputStreamWriter writer = new OutputStreamWriter(
                new FileOutputStream(configFile), StandardCharsets.UTF_8)) {

            props.store(writer, "Configurações de E-mail - UTF-8");
            JOptionPane.showMessageDialog(this, "✅ Configurações de e-mail salvas com sucesso!");
            dispose();

        } catch (IOException e) {
            JOptionPane.showMessageDialog(this,
                    "❌ Erro ao salvar configurações: " + e.getMessage(),
                    "Erro", JOptionPane.ERROR_MESSAGE);
        }
    }
}
