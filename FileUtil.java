// --------------------------------------------
// File: FileUtil.java
// --------------------------------------------

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;

public class FileUtil {

    // 📖 Lê todas as linhas de um arquivo usando UTF-8
    public static List<String> readLines(String filePath) {
        List<String> lines = new ArrayList<>();
        File file = new File(filePath);

        if (!file.exists()) {
            return lines;
        }

        try (BufferedReader br = new BufferedReader(
                new InputStreamReader(new FileInputStream(file), StandardCharsets.UTF_8))) {
            String line;
            while ((line = br.readLine()) != null) {
                lines.add(line);
            }
        } catch (IOException e) {
            System.err.println("Erro ao ler arquivo: " + filePath + " -> " + e.getMessage());
        }

        return lines;
    }

    // ✅ Alias compatível com novas versões
    public static List<String> readLinesUTF8(String filePath) {
        return readLines(filePath);
    }

    // 💾 Salva todas as linhas (sobrescreve o arquivo) em UTF-8
    public static void saveLines(String filePath, List<String> lines) {
        try (BufferedWriter bw = new BufferedWriter(
                new OutputStreamWriter(new FileOutputStream(filePath), StandardCharsets.UTF_8))) {
            for (String line : lines) {
                bw.write(line);
                bw.newLine();
            }
        } catch (IOException e) {
            System.err.println("Erro ao salvar arquivo: " + filePath + " -> " + e.getMessage());
        }
    }

    // ✅ Alias compatível com novas versões
    public static void saveLinesUTF8(String filePath, List<String> lines) {
        saveLines(filePath, lines);
    }

    // ➕ Adiciona uma linha ao final do arquivo em UTF-8
    public static void appendLine(String filePath, String line) {
        try (BufferedWriter bw = new BufferedWriter(
                new OutputStreamWriter(new FileOutputStream(filePath, true), StandardCharsets.UTF_8))) {
            bw.write(line);
            bw.newLine();
        } catch (IOException e) {
            System.err.println("Erro ao adicionar linha em: " + filePath + " -> " + e.getMessage());
        }
    }

    // 🔄 Versão compatível UTF-8
    public static void appendLineUTF8(String filePath, String line) {
        appendLine(filePath, line);
    }

    // 🗑️ Remove uma linha com base em um ID numérico
    public static void removeLineById(String filePath, int id) {
        List<String> lines = readLines(filePath);
        List<String> updated = new ArrayList<>();

        for (String line : lines) {
            if (!line.startsWith(id + ";")) {
                updated.add(line);
            }
        }

        saveLines(filePath, updated);
    }

    // 🔄 Atualiza uma linha com base no ID
    public static void updateLineById(String filePath, int id, String newLine) {
        List<String> lines = readLines(filePath);
        List<String> updated = new ArrayList<>();

        for (String line : lines) {
            if (line.startsWith(id + ";")) {
                updated.add(newLine);
            } else {
                updated.add(line);
            }
        }

        saveLines(filePath, updated);
    }

    // 📦 Copia um arquivo (ex: imagens de produtos)
    public static void copyFile(File origem, File destino) {
        try {
            Files.copy(origem.toPath(), destino.toPath(), StandardCopyOption.REPLACE_EXISTING);
        } catch (IOException e) {
            System.err.println("Erro ao copiar arquivo: " + e.getMessage());
        }
    }

    // 🔍 Gera o próximo ID numérico baseado no conteúdo do arquivo
    public static int getNextId(String filePath) {
        List<String> lines = readLines(filePath);
        int maxId = 0;

        for (String line : lines) {
            try {
                String[] parts = line.split(";");
                int id = Integer.parseInt(parts[0]);
                if (id > maxId) {
                    maxId = id;
                }
            } catch (Exception ignored) {}
        }

        return maxId + 1;
    }

    // 🧹 Cria o arquivo se não existir
    public static void ensureFileExists(String filePath) {
        File file = new File(filePath);
        try {
            if (!file.exists()) {
                file.getParentFile().mkdirs(); // garante diretório
                file.createNewFile();
            }
        } catch (IOException e) {
            System.err.println("Erro ao criar arquivo: " + e.getMessage());
        }
    }

    // 🗂️ Cria um backup do arquivo antes de sobrescrever
    public static void backupFile(String filePath) {
        File original = new File(filePath);
        if (!original.exists()) return;

        String backupName = filePath.replace(".txt", "_backup_" + System.currentTimeMillis() + ".txt");
        File backup = new File(backupName);

        try (InputStream in = new FileInputStream(original);
             OutputStream out = new FileOutputStream(backup)) {
            byte[] buffer = new byte[1024];
            int length;
            while ((length = in.read(buffer)) > 0) {
                out.write(buffer, 0, length);
            }
            System.out.println("Backup criado: " + backup.getName());
        } catch (IOException e) {
            System.err.println("Erro ao criar backup: " + e.getMessage());
        }
    }
}
