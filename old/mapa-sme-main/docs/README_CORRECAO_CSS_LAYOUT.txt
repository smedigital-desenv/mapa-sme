CORREÇÃO CSS / LAYOUT — MAPA SME

Este pacote substitui o index.html da migração pelo layout original do Apps Script, com:

1. Styles.html incluído corretamente dentro de <style>.
2. Templates.html incluído no corpo da página.
3. JS_*.html do Apps Script incluídos na ordem original.
4. Um adaptador temporário para evitar erro de google.script.run no GitHub Pages.

Importante:
- Este pacote corrige a aparência para ficar igual ao Apps Script.
- A conexão real com Supabase ainda deve substituir o adaptador temporário.
- O problema principal no pacote anterior era CSS do Styles.html colado diretamente no <head> sem a tag <style>, fazendo o navegador tratar o CSS como texto/HTML e quebrar a página.

Como aplicar:
1. Substitua o index.html do repositório pelo index.html deste pacote.
2. Faça commit e push.
3. Teste o GitHub Pages.
4. Depois migramos uma chamada por vez para o Supabase.
