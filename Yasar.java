// -----------------------------
// File: Yasar.java
// -----------------------------

import javax.swing.*;
import java.awt.*;
import java.awt.event.*;
import java.awt.image.BufferedImage;
import java.io.*;
import java.util.concurrent.*;
import javax.imageio.ImageIO;

public class Yasar extends JFrame {
    private final String configGeral = "txt/configuracoes.txt";
    private Color corBotoes = Color.BLUE;
    private BufferedImage originalImage = null;
    private BufferedImage scaledImage = null;
    private final JPanel centerPanel;
    private String caminhoImagem = null;

    private final ExecutorService scalerExecutor = Executors.newSingleThreadExecutor();
    private final ScheduledExecutorService scheduledExec = Executors.newSingleThreadScheduledExecutor();
    private ScheduledFuture<?> scheduledRescale = null;

    public Yasar() {
        super("Sistema de Gestão - Menu Principal");
        setDefaultCloseOperation(JFrame.EXIT_ON_CLOSE);
        setSize(1300, 700);
        setLocationRelativeTo(null);
        setLayout(new BorderLayout());

        // Carrega configurações salvas
        carregarConfiguracoes();

        // ---------------------------
        // Painel central com imagem
        // ---------------------------
        centerPanel = new JPanel(null) {
            @Override
            protected void paintComponent(Graphics g) {
                super.paintComponent(g);
                Graphics2D g2 = (Graphics2D) g.create();
                if (scaledImage != null) g2.drawImage(scaledImage, 0, 0, null);
                else {
                    g2.setColor(new Color(240, 240, 240));
                    g2.fillRect(0, 0, getWidth(), getHeight());
                }
                g2.setColor(new Color(0, 0, 0, 80));
                g2.fillRect(0, 0, getWidth(), getHeight());
                g2.dispose();
            }
        };
        centerPanel.setLayout(new BorderLayout());
        add(centerPanel, BorderLayout.CENTER);

        // ---------------------------
        // Painel lateral com botões
        // ---------------------------
        JPanel leftPanel = new JPanel(new GridLayout(11,1,8,8));
        leftPanel.setPreferredSize(new Dimension(320,0));
        leftPanel.setOpaque(false);
        leftPanel.setBorder(BorderFactory.createEmptyBorder(10,10,10,10));

        String[] nomesBotoes = {"➕ Cadastro de Clientes", 
                                "📄 Itens da Loja", 
                                "📦 Estoque", 
                                "💸 Financeiro", 
                                "💰 Vendas", 
                                "🚚 Entregas",
                                "📊 Relatórios", 
                                "📅 Calendário", 
                                "⚙️ Configurações", 
                                "👋 Sair"};

        JButton[] botoes = new JButton[nomesBotoes.length];

        Font font = new Font("Segoe UI Emoji", Font.PLAIN, 14);

        for (int i=0; i<nomesBotoes.length; i++) {
            botoes[i] = criarBotaoVidro(nomesBotoes[i]);
            botoes[i].setFont(font);
            botoes[i].setForeground(corBotoes);
            leftPanel.add(botoes[i]);
        }

        add(leftPanel, BorderLayout.WEST);

        // ---------------------------
        // Ações dos botões
        // ---------------------------
        botoes[0].addActionListener(e -> new ClienteControl().setVisible(true));
        botoes[1].addActionListener(e -> new ItemsStoreControl().setVisible(true));
        botoes[2].addActionListener(e -> new StockControl().setVisible(true));
        botoes[3].addActionListener(e -> new FinancialControl().setVisible(true));
        botoes[4].addActionListener(e -> new SalesControl().setVisible(true));
        botoes[5].addActionListener(e -> new DeliveryControl().setVisible(true));
        botoes[6].addActionListener(e -> new DashboardControl().setVisible(true));
        botoes[7].addActionListener(e -> new CalendarControl().setVisible(true));
        botoes[9].addActionListener(e -> sair());

        botoes[8].addActionListener(e -> {
            String[] options = {"🎨 Alterar cor do texto dos botões", "🖼️ Alterar imagem de fundo","Cancelar"};
            int escolha = JOptionPane.showOptionDialog(this,"O que deseja configurar?","⚙️ Configurações",
                    JOptionPane.DEFAULT_OPTION,JOptionPane.QUESTION_MESSAGE,null,options,options[0]);
            switch(escolha){
                case 0: // Alterar cor
                    Color novaCor = JColorChooser.showDialog(this,"Escolher cor dos botões",corBotoes);
                    if(novaCor!=null){
                        corBotoes=novaCor;
                        for(JButton b:botoes) b.setForeground(corBotoes);
                        salvarConfiguracoes();
                    }
                    break;
                case 1: // Alterar imagem de fundo
                    escolherImagemFundo();
                    break;
                default: break;
            }
        });

        // Resize do painel central
        centerPanel.addComponentListener(new ComponentAdapter() {
            @Override
            public void componentResized(ComponentEvent e) { scheduleRescale(); }
        });
    }

    // ============================
    // Escolher imagem sem copiar
    // ============================
    private void escolherImagemFundo(){
        JFileChooser chooser = new JFileChooser();
        chooser.setDialogTitle("Escolher imagem de fundo");
        chooser.setFileFilter(new javax.swing.filechooser.FileNameExtensionFilter("Imagens","jpg","jpeg","png","gif"));
        if(chooser.showOpenDialog(this)!=JFileChooser.APPROVE_OPTION) return;

        File f = chooser.getSelectedFile();
        if(!f.exists()) return;

        caminhoImagem = f.getAbsolutePath();
        loadImageAsync(f);
        salvarConfiguracoes();
    }

// ============================
// Carregamento de imagem assíncrono (WebP-ready)
// ============================
private void loadImageAsync(File f) {
    // Verifica se o arquivo é válido antes de enviar para o executor
    if (f == null || !f.exists()) {
        return;
    }
    
    // Envia o carregamento da imagem para o thread pool
    scalerExecutor.submit(() -> {
        try {
            // Se o plugin TwelveMonkeys estiver no classpath, esta linha lerá o WebP
            // Caso contrário, lerá JPG, PNG, GIF, etc.
            BufferedImage img = ImageIO.read(f);
            
            // ImageIO.read() retorna null se não encontrar um ImageReader compatível
            if (img == null) {
                throw new IOException("O arquivo não é uma imagem válida ou o formato não é suportado (WebP, JPG, PNG, etc.).");
            }
            
            // Acesso seguro (pois ocorre no thread de fundo)
            originalImage = img;
            
            // Atualiza caminhoImagem e salva configurações DEPOIS do carregamento bem-sucedido
            caminhoImagem = f.getAbsolutePath();
            salvarConfiguracoes();
            
            // Reajusta a imagem e repinta a interface gráfica
            rescaleForCurrentPanel();
            
        } catch (Exception ex) {
            // 🛑 CORREÇÃO do erro de lambda:
            // 1. Prepara a mensagem de erro no thread de fundo (caller)
            // 2. A variável mensagemDeErro é 'efetivamente final' para o lambda da GUI
            final String mensagemDeErro = "Erro ao carregar imagem: " + ex.getMessage() + "\nCaminho: " + f.getAbsolutePath();

            SwingUtilities.invokeLater(() -> {
                // 3. Executa o diálogo no Thread de Eventos do Swing (EDT)
                JOptionPane.showMessageDialog(Yasar.this, 
                                              mensagemDeErro,
                                              "Erro ao Carregar Imagem",
                                              JOptionPane.ERROR_MESSAGE);
            });
        }
    });
}

    private void scheduleRescale(){
        if(originalImage==null) return;
        if(scheduledRescale!=null && !scheduledRescale.isDone()) scheduledRescale.cancel(false);
        scheduledRescale=scheduledExec.schedule(this::rescaleForCurrentPanel,250,TimeUnit.MILLISECONDS);
    }

    private void rescaleForCurrentPanel(){
        if(originalImage==null) return;
        int w=Math.max(1,centerPanel.getWidth());
        int h=Math.max(1,centerPanel.getHeight());

        double scale = Math.max((double)w/originalImage.getWidth(),(double)h/originalImage.getHeight());
        int newW=(int)Math.ceil(originalImage.getWidth()*scale);
        int newH=(int)Math.ceil(originalImage.getHeight()*scale);

        BufferedImage tmp=new BufferedImage(w,h,BufferedImage.TYPE_INT_ARGB);
        Graphics2D g2=tmp.createGraphics();
        g2.setRenderingHint(RenderingHints.KEY_INTERPOLATION,RenderingHints.VALUE_INTERPOLATION_BILINEAR);
        g2.setRenderingHint(RenderingHints.KEY_RENDERING,RenderingHints.VALUE_RENDER_QUALITY);
        g2.setComposite(AlphaComposite.Src);
        g2.setColor(new Color(0,0,0,0));
        g2.fillRect(0,0,w,h);
        g2.drawImage(originalImage,(w-newW)/2,(h-newH)/2,newW,newH,null);
        g2.dispose();

        scaledImage=tmp;
        SwingUtilities.invokeLater(()->centerPanel.repaint());
    }

    // ============================
    // Botão vidro com hover
    // ============================
    private JButton criarBotaoVidro(String texto){
        JButton btn = new JButton(texto){
            @Override
            protected void paintComponent(Graphics g){
                Graphics2D g2=(Graphics2D) g.create();
                g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING,RenderingHints.VALUE_ANTIALIAS_ON);

                Color bg=(Color)getClientProperty("bgColor");
                if(bg==null) bg=new Color(255,255,255,36);
                g2.setColor(bg);
                int arc=14;
                g2.fillRoundRect(0,0,getWidth(),getHeight(),arc,arc);

                g2.setColor(new Color(255,255,255,60));
                g2.drawRoundRect(0,0,getWidth()-1,getHeight()-1,arc,arc);

                FontMetrics fm=g2.getFontMetrics(getFont());
                g2.setColor(getForeground());
                int tx=(getWidth()-fm.stringWidth(getText()))/2;
                int ty=(getHeight()+fm.getAscent())/2-2;
                g2.setFont(getFont());
                g2.drawString(getText(),tx,ty);
                g2.dispose();
            }

            @Override
            public boolean isOpaque(){return false;}
        };

        btn.setFocusPainted(false);
        btn.setBorder(BorderFactory.createEmptyBorder(10,16,10,16));
        btn.putClientProperty("bgColor",new Color(255,255,255,36));
        btn.addMouseListener(new MouseAdapter(){
            @Override
            public void mouseEntered(MouseEvent e){ btn.putClientProperty("bgColor",new Color(255,255,255,90)); btn.repaint(); }
            @Override
            public void mouseExited(MouseEvent e){ btn.putClientProperty("bgColor",new Color(255,255,255,36)); btn.repaint(); }
        });
        btn.setCursor(Cursor.getPredefinedCursor(Cursor.HAND_CURSOR));
        return btn;
    }

    // ============================
    // Configurações persistentes
    // ============================
    private void carregarConfiguracoes(){
        File cfg=new File(configGeral);
        if(!cfg.exists()) return;
        try(BufferedReader br=new BufferedReader(new FileReader(cfg))){
            String linha;
            while((linha=br.readLine())!=null){
                if(linha.startsWith("imagem=")){
                    String path=linha.substring("imagem=".length()).trim();
                    File f=new File(path);
                    if(f.exists()){ caminhoImagem=f.getAbsolutePath(); loadImageAsync(f);}
                }else if(linha.startsWith("corBotoes=")){
                    String[] rgb=linha.substring("corBotoes=".length()).split(",");
                    corBotoes=new Color(Integer.parseInt(rgb[0]),Integer.parseInt(rgb[1]),Integer.parseInt(rgb[2]));
                }
            }
        }catch(Exception e){ System.err.println("Erro ao ler configs: "+e.getMessage()); }
    }

    private void salvarConfiguracoes(){
        try{
            File dir=new File("txt");
            if(!dir.exists()) dir.mkdirs();
            try(PrintWriter pw=new PrintWriter(new FileWriter(configGeral))){
                pw.println("imagem="+(caminhoImagem!=null?caminhoImagem:""));
                pw.println("corBotoes="+corBotoes.getRed()+","+corBotoes.getGreen()+","+corBotoes.getBlue());
            }
        }catch(IOException ex){ System.err.println("Erro ao salvar configs: "+ex.getMessage()); }
    }

    private void sair(){
        salvarConfiguracoes();
        scalerExecutor.shutdownNow();
        scheduledExec.shutdownNow();
        dispose();
        System.exit(0);
    }

    public static void main(String[] args){
        SwingUtilities.invokeLater(()->new Yasar().setVisible(true));
    }
}
