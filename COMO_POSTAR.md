# Como publicar no GitHub

1. Abra o PowerShell nesta pasta:
   ```
   cd C:\Users\ADMIN\Desktop\codex-desktop-github
   ```

2. Inicialize o repositório:
   ```
   git init
   git add .
   git commit -m "initial commit"
   ```

3. Crie o repositório no GitHub (sem README, sem .gitignore — já temos aqui).
   Use o site: https://github.com/new

4. Conecte e envie:
   ```
   git remote add origin https://github.com/SEU_USUARIO/codex-desktop.git
   git branch -M main
   git push -u origin main
   ```

5. Confira se `node_modules/` **não** foi enviado (o `.gitignore` bloqueia).

## Antes de postar

- O `README.md` já contém o aviso de que é projeto educacional e pode violar
  os Termos da OpenAI. Mantenha isso.
- Não inclua tokens, `settings.json`, `history.json`, `conversations.json` nem
  a transcrição/áudio do vídeo — o `.gitignore` cobre os dados locais, mas confira.
- Se quiser reduzir ainda mais o risco, troque o `client_id` fixo em
  `src/main/codexAuth.js` por `process.env.CODEX_CLIENT_ID` com placeholder e
  documente a variável no README.

## Para quem baixar

É só rodar `INSTALAR.bat` — ele instala as dependências e cria o atalho
"Codex Desktop" na Área de Trabalho.
