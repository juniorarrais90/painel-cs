# Cadastro pelo CPF — como aplicar (23/09/2026)

O que muda na Recepção (CS): o CPF passa a ser o primeiro campo do "+ Novo cliente".
Ao completar os 11 dígitos a tela confere na planilha e na ADVBOX, preenche o nome e,
se o CPF já existir, só cadastra depois da confirmação "Trata-se de novo processo?".

## 1. Backend (Apps Script "Painel Comercial-CS", conta do escritório)

1. Abra o projeto (conta arraisadvmg@gmail.com):
   https://script.google.com/u/2/home/projects/1sWOrVcF9FFcISRABVryqLTDCkrJCgnq1CUhTyp_lwhpRWI9iSdpFC8b3/edit
2. No editor, selecione todo o conteúdo de `Código.gs` e substitua pelo arquivo
   `apps-script/Codigo.gs` deste repositório. Salve (Ctrl+S).
3. Token da ADVBOX (para o nome vir da ADVBOX): engrenagem "Configurações do projeto"
   → "Propriedades do script" → "Adicionar propriedade":
   - Propriedade: `ADVBOX_API_TOKEN`
   - Valor: o mesmo token usado no painel da Vercel (variável `ADVBOX_API_TOKEN`).
   Sem essa propriedade a conferência funciona só com a planilha da recepção.
4. Teste: menu Executar → função `testarConsultaCpf` (troque o CPF de exemplo por um
   real na função antes). Na primeira vez o Google pede autorização de "conectar a um
   serviço externo" — clique em Permitir. O resultado aparece no registro de execução.
5. Publique a versão nova: "Implantar" → "Gerenciar implantações" → lápis da implantação
   ativa → Versão: "Nova versão" → "Implantar". A URL `/exec` continua a mesma, então o
   index.html não precisa mudar.

## 2. Front (este repositório, GitHub Pages)

```bash
cd /d/Junior/Projetos/painel-cs && git add index.html apps-script/Codigo.gs APLICAR-CPF.md && git commit -m "Cadastro pelo CPF: auto-preenchimento da ADVBOX e confirmação de novo processo" && git push origin main
```

Depois do push, no painel-arrais suba o `?v=` de `URL_PAINEL_CS` em `lib/ferramentas.mjs`
(de `?v=2` para `?v=3`) para furar o cache do GitHub Pages dentro do iframe de /cs.

## Ordem segura

Pode publicar o front antes do backend: se a ação `consultarCpf` ainda não existir, a
tela avisa "Backend sem a consulta à ADVBOX" e confere só na planilha. O backend novo
também aceita a tela antiga (o `save` só recusa ficha nova com CPF repetido sem a
confirmação).
