# Caderno de Estudos

Bloco de notas para estudos que transforma títulos e tópicos em mapa mental e organiza as notas por matéria e situação.

- `index.html`: página inicial, com a escolha do caderno
- `estudos/`: Caderno de Estudos geral
- `assets/comum.css` e `assets/tema.js`: cabeçalho, menus e tema claro, escuro ou do sistema, usados pelas três páginas
- `teologia/`: Caderno de Teologia, com modelos de exegese, doutrina, fichamento e sermão, e índice automático de passagens bíblicas

Sem conta, as notas ficam guardadas no navegador de quem usa (localStorage); **Exportar backup** e **Importar** levam as notas para outro aparelho.

Com conta (botão **Entrar**), as notas são sincronizadas pelo Supabase (`assets/conta.js`, configuração em `assets/config.js`). Cada caderno é uma linha da tabela `cadernos`, e as regras de acesso (RLS) só deixam cada pessoa ler e alterar as próprias linhas. A chave em `config.js` é a chave pública do projeto, feita para ficar no site.

## Testar no computador

```bash
node serve-local.js
```

Depois abra http://localhost:4320.
